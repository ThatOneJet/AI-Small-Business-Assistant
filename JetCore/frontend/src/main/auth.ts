/**
 * Decks — JetCore account auth (main process).
 *
 * The single JetCore account is authenticated against the Operations Flask
 * backend (`/api/login`, `/api/signup`). On success we persist:
 *  - the SESSION TOKEN (JWT) securely in the OS keychain via tokens.ts under
 *    `jetcore:session` (NEVER in the plaintext decks-state.json), and
 *  - the NON-SECRET account fields in decks-state.json (so we can skip the login
 *    screen on next launch without spawning the backend just to validate).
 *
 * Both Decks provider keys and Operations data are scoped under this account's
 * `userId` (see accounts.ts re-scoping), so one JetCore account owns everything.
 */
import { saveToken, getToken, removeToken, hasToken } from './tokens'
import { loadState, saveState } from './persistence'
import { startOperations } from './apps/summit/jetcore'
import { migrateUnscopedProviderTokens, setCurrentUser } from './accounts'
import type { JetCoreAccount, PersistedState } from '@shared/types'
import type { AuthLoginPayload, AuthSignupPayload, AuthResult } from '@shared/ipc'

/** Keychain key for the JetCore session JWT. */
const SESSION_KEY = 'jetcore:session'

/**
 * In-memory cache of the signed-in account, hydrated lazily from disk. The store
 * (renderer) and jetcore.ts (Operations injection) read this via getAccount().
 */
let cachedAccount: JetCoreAccount | null = null
let hydrated = false

/** Lazily load the persisted account from disk into the cache (once). */
async function hydrate(): Promise<void> {
  if (hydrated) return
  hydrated = true
  try {
    const state = await loadState()
    cachedAccount = state?.account ?? null
  } catch {
    cachedAccount = null
  }
  // NOTE: provider-key scoping is now owned by the SUPABASE account (vault.ts
  // bindUser), so this legacy Operations auth must NOT call setCurrentUser here —
  // doing so would clobber the Supabase user scope at startup.
}

/** The signed-in JetCore account (non-secret), or null if logged out. */
export function getAccount(): JetCoreAccount | null {
  return cachedAccount
}

/** The current JetCore session JWT from the keychain, or null. */
export function getSessionToken(): string | null {
  return getToken(SESSION_KEY)
}

/**
 * The localStorage entries the Operations page needs to be considered logged in
 * (the SAME JetCore account), or null when logged out. Consumed SYNCHRONOUSLY by
 * the Operations preload BEFORE the page's React bundle runs — so Operations
 * never shows its own login. (dom-ready injection was too late: React had already
 * routed to /login.)
 */
export function operationsSeed(): Record<string, string> | null {
  const account = cachedAccount
  const token = getSessionToken()
  if (!account || !token) return null
  return {
    token,
    user_id: String(account.userId),
    email: account.email,
    first_name: account.firstName,
    segment: account.segment,
    plan: account.plan,
    is_admin: account.isAdmin ? '1' : '',
    profile_pic: account.avatar ?? ''
  }
}

/** The shape the Operations backend returns from /api/login and /api/signup. */
interface BackendAuthResponse {
  token?: string
  user_id?: string | number
  email?: string
  first_name?: string
  segment?: string
  plan?: string
  is_admin?: boolean
  avatar?: string
  /** Some backends nest the error under `error` or `message`. */
  error?: string
  message?: string
}

/** Normalize the segment string from the backend to our union (safe default). */
function normalizeSegment(s: string | undefined): JetCoreAccount['segment'] {
  return s === 'small_biz' || s === 'restaurant' ? s : 'individual'
}

/** Build the non-secret account from a backend response + the request fields. */
function toAccount(
  body: BackendAuthResponse,
  fallback: { email: string; firstName?: string; segment?: JetCoreAccount['segment'] }
): JetCoreAccount {
  return {
    userId: String(body.user_id ?? ''),
    email: body.email ?? fallback.email,
    firstName: body.first_name ?? fallback.firstName ?? '',
    segment: normalizeSegment(body.segment ?? fallback.segment),
    plan: body.plan ?? 'free',
    isAdmin: body.is_admin === true,
    avatar: body.avatar
  }
}

/** Merge the account into decks-state.json (load → merge → save). Never throws. */
async function persistAccount(account: JetCoreAccount | null): Promise<void> {
  try {
    const current = (await loadState()) ?? ({} as Partial<PersistedState>)
    const next: PersistedState = {
      version: current.version ?? 1,
      theme: current.theme ?? 'dark',
      workspaces: current.workspaces ?? [],
      activeWorkspaceId: current.activeWorkspaceId ?? null,
      settings: current.settings,
      account: account ?? undefined
    }
    await saveState(next)
  } catch (err) {
    console.error('[decks] failed to persist account:', err)
  }
}

/**
 * POST credentials to the Operations backend and, on success, persist the token
 * + account and migrate provider keys under the new user. Shared by login/signup.
 */
async function authenticate(
  path: '/api/login' | '/api/signup',
  payload: Record<string, unknown>,
  fallback: { email: string; firstName?: string; segment?: JetCoreAccount['segment'] }
): Promise<AuthResult> {
  // Ensure the backend is running and get its loopback base URL.
  const started = await startOperations()
  if (!started.url) {
    return { ok: false, error: started.error ?? 'JetCore backend is unavailable.' }
  }

  let res: Response
  try {
    res = await fetch(`${started.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } catch (err) {
    return { ok: false, error: `Couldn't reach JetCore: ${err instanceof Error ? err.message : String(err)}` }
  }

  let body: BackendAuthResponse = {}
  try {
    body = (await res.json()) as BackendAuthResponse
  } catch {
    /* non-JSON body — fall through to the status-code handling */
  }

  if (!res.ok || !body.token) {
    const error = body.error || body.message || `Authentication failed (HTTP ${res.status}).`
    return { ok: false, error }
  }

  const account = toAccount(body, fallback)
  // Persist the JWT in the keychain (fail-closed inside saveToken).
  saveToken(SESSION_KEY, body.token)
  // Migrate any existing un-scoped provider tokens under this user (best-effort),
  // THEN scope all future provider keys under this user.
  if (account.userId) {
    try {
      migrateUnscopedProviderTokens(account.userId)
    } catch (err) {
      console.error('[decks] provider-token migration failed (non-fatal):', err)
    }
  }
  setCurrentUser(account.userId || null)
  // Persist the non-secret account + update the in-memory cache.
  cachedAccount = account
  hydrated = true
  await persistAccount(account)

  return { ok: true, account }
}

/** Log in an existing JetCore account. */
export async function login(payload: AuthLoginPayload): Promise<AuthResult> {
  return authenticate(
    '/api/login',
    { email: payload.email, password: payload.password },
    { email: payload.email }
  )
}

/** Create a new JetCore account. */
export async function signup(payload: AuthSignupPayload): Promise<AuthResult> {
  return authenticate(
    '/api/signup',
    {
      email: payload.email,
      password: payload.password,
      first_name: payload.firstName,
      segment: payload.segment
    },
    { email: payload.email, firstName: payload.firstName, segment: payload.segment }
  )
}

/**
 * Return the persisted account (+ whether a session token exists) WITHOUT
 * spawning the backend. Validation is intentionally lazy — startup stays fast.
 */
export async function status(): Promise<AuthResult> {
  await hydrate()
  return { ok: true, account: cachedAccount ?? undefined, hasSession: hasToken(SESSION_KEY) }
}

/** Sign out: forget the session token and the persisted account. */
export async function logout(): Promise<AuthResult> {
  removeToken(SESSION_KEY)
  cachedAccount = null
  hydrated = true
  setCurrentUser(null)
  await persistAccount(null)
  return { ok: true }
}
