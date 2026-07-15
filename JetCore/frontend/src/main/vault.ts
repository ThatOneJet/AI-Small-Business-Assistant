/**
 * Decks — E2EE vault: auth + envelope encryption orchestration (MAIN ONLY).
 *
 * This is the layer that ties Supabase auth, the Argon2id KDF, the envelope
 * (data-key) scheme, and the recovery key together. It exposes a tiny IPC-facing
 * surface (signUp / signIn / signOut / status / vaultGet / vaultSet).
 *
 * ── Envelope scheme (E2EE = no server-side password reset) ──
 *  - A random 32-byte DATA KEY (DEK) encrypts every vault blob (AES-256-GCM,
 *    fresh nonce each). The DEK is generated once at account setup.
 *  - The DEK is WRAPPED TWICE and both wraps are stored (non-secret) in the
 *    `__keyring__` blob alongside the per-account salt:
 *      (a) wrapped with the PASSWORD-derived Argon2id key, and
 *      (b) wrapped with a random 32-byte RECOVERY KEY (shown once at setup).
 *    Either the password OR the recovery key can therefore unwrap the DEK, and a
 *    second device fetches `__keyring__` and unlocks with the password.
 *  - Forgetting BOTH the password and the recovery key = data is permanently
 *    unrecoverable, by design (the server only ever holds ciphertext).
 *
 * SECURITY: the password, the derived key, the DEK, and all plaintext live ONLY
 * in this process's memory. Supabase only ever receives ciphertext + the
 * password-as-auth-credential. Nothing secret is logged.
 */
import { getSupabase, isSupabaseConfigured, withColdStartRetry } from './supabase'
import { SupabaseBlobStore, type BlobStore } from './blobstore'
import { setCurrentUser, migrateUnscopedProviderTokens } from './accounts'
import { saveToken, getToken, removeToken } from './tokens'
import {
  deriveKey,
  encrypt,
  decrypt,
  randomKey,
  randomSalt,
  wrapKey,
  unwrapKey,
  toB64,
  fromB64,
  formatRecoveryKey,
  parseRecoveryKey,
  KEY_LEN
} from './crypto'

/** The non-secret keyring blob: salt + the two wrapped copies of the DEK. */
interface Keyring {
  /** Format version, for forward migration. */
  v: 1
  /** base64 per-account Argon2id salt (non-secret). */
  salt: string
  /** base64(iv||tag||DEK) wrapped under the PASSWORD-derived key. */
  wrappedByPassword: string
  /** base64(iv||tag||DEK) wrapped under the RECOVERY key. */
  wrappedByRecovery: string
}

/** Reserved key for the keyring blob inside the vault. */
const KEYRING_KEY = '__keyring__'

/**
 * In-memory unlocked state. The DEK and the BlobStore live ONLY here, only while
 * signed in. Cleared on sign-out. Never serialized, never sent over IPC.
 */
interface Unlocked {
  dek: Buffer
  store: BlobStore
  userId: string
  email: string
}
let unlocked: Unlocked | null = null

/**
 * "Stay logged in" — cache the unlocked DEK encrypted at rest via the OS keychain
 * (Electron safeStorage → DPAPI on Windows, Keychain on macOS), keyed per user, so
 * the next launch auto-unlocks the vault without re-entering the password.
 *
 * Tradeoff: this trades the per-session password requirement for convenience — on
 * this machine + OS account the vault opens automatically. It's the same posture as
 * the already-persisted Supabase session token (tokens.ts). safeStorage fails CLOSED:
 * if OS encryption is unavailable nothing is written and the user simply unlocks with
 * their password as before. Cleared on sign-out.
 */
const DEK_CACHE_PREFIX = 'vault.dek:'
function cacheDek(userId: string, dek: Buffer): void {
  if (!userId) return
  try {
    saveToken(DEK_CACHE_PREFIX + userId, toB64(dek))
  } catch {
    /* best-effort; fall back to password unlock next launch */
  }
}
function loadCachedDek(userId: string): Buffer | null {
  try {
    const b64 = getToken(DEK_CACHE_PREFIX + userId)
    return b64 ? fromB64(b64) : null
  } catch {
    return null
  }
}
function clearCachedDek(userId: string): void {
  try {
    removeToken(DEK_CACHE_PREFIX + userId)
  } catch {
    /* ignore */
  }
}

/**
 * Bind local provider storage (Notes, Calendar, provider tokens) to this Supabase
 * user, so each account's data is ISOLATED (keys become `jc:<userId>:…`). Without
 * this, providers fall back to unscoped keys and data leaks across accounts.
 * Also migrates any pre-existing unscoped blobs to the scoped keys once.
 */
function bindUser(userId: string): void {
  setCurrentUser(userId)
  migrateUnscopedProviderTokens(userId)
}

export interface VaultStatus {
  ok: boolean
  /** True when a Supabase session exists (restored or fresh). */
  signedIn: boolean
  /** True when the DEK is unlocked in memory (vault usable). */
  unlocked: boolean
  email?: string
  /** Supabase user id — used to scope local data (workspaces/partitions) per account. */
  userId?: string
  /** True when the signed-in email is in the shared admin list (admin in both apps). */
  isAdmin?: boolean
  error?: string
  /** True when .env is missing config (renderer can show a setup hint). */
  notConfigured?: boolean
  /** True when signup created the account but email confirmation is required
   *  (no session yet). The renderer shows a friendly "check your email" state,
   *  not an error — the keyring + recovery key are created on first sign-in. */
  pending?: boolean
}

export interface SignUpResult extends VaultStatus {
  /** The recovery key, returned ONCE at signup. Store offline. */
  recoveryKey?: string
}

/** Read + parse the keyring blob from the store, or null if none exists yet. */
async function loadKeyring(store: BlobStore): Promise<Keyring | null> {
  const raw = await store.get(KEYRING_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Keyring
    if (parsed && parsed.v === 1 && parsed.salt && parsed.wrappedByPassword) return parsed
  } catch {
    /* fall through */
  }
  return null
}

/** Persist the keyring blob (it is NON-secret: salt + wrapped DEKs only). */
async function saveKeyring(store: BlobStore, kr: Keyring): Promise<void> {
  await store.set(KEYRING_KEY, JSON.stringify(kr))
}

/**
 * Create a brand-new account.
 *  1. Sign up to Supabase with email + password (password used ONLY as the auth
 *     credential here).
 *  2. Derive the Argon2id key from the password + a fresh random salt.
 *  3. Generate the DEK + a random recovery key; wrap the DEK under BOTH.
 *  4. Store the keyring (salt + both wrapped DEKs) in the vault.
 *  5. Return the recovery key ONCE to show the user.
 */
export async function signUp(email: string, password: string): Promise<SignUpResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, signedIn: false, unlocked: false, notConfigured: true, error: 'Cloud sync is not configured.' }
  }
  const supabase = getSupabase()

  // (1) Supabase auth — password is the AUTH credential only.
  const { data, error } = await withColdStartRetry(() =>
    supabase.auth.signUp({ email, password })
  )
  if (error) return { ok: false, signedIn: false, unlocked: false, error: error.message }
  const user = data.user
  // When email confirmation is ON, there is no session yet (and RLS would block
  // writing the keyring). That's fine — the keyring + recovery key are created on
  // the FIRST sign-in after the user confirms. Report a friendly pending state.
  if (!data.session) {
    return {
      ok: false,
      signedIn: false,
      unlocked: false,
      pending: true,
      email,
      error: 'Check your email to confirm your account, then sign in to finish setup.'
    }
  }
  if (!user) return { ok: false, signedIn: false, unlocked: false, error: 'Sign-up failed.' }

  const store = new SupabaseBlobStore(supabase, user.id)

  // (2) Derive the password key from a fresh per-account salt.
  const salt = randomSalt()
  const passwordKey = deriveKey(password, salt)

  // (3) Fresh DEK + fresh recovery key; wrap the DEK under both.
  const dek = randomKey(KEY_LEN)
  const recoveryRaw = randomKey(KEY_LEN)
  const keyring: Keyring = {
    v: 1,
    salt: toB64(salt),
    wrappedByPassword: wrapKey(dek, passwordKey),
    wrappedByRecovery: wrapKey(dek, recoveryRaw)
  }

  // (4) Persist the (non-secret) keyring.
  try {
    await saveKeyring(store, keyring)
  } catch (err) {
    return {
      ok: false,
      signedIn: true,
      unlocked: false,
      email,
      error: `Couldn't save your encryption keyring: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  // Unlock in-memory for the rest of this session.
  unlocked = { dek, store, userId: user.id, email }
  bindUser(user.id)
  cacheDek(user.id, dek) // stay logged in across launches

  // (5) Show the recovery key ONCE.
  return {
    ok: true,
    signedIn: true,
    unlocked: true,
    email,
    recoveryKey: formatRecoveryKey(recoveryRaw)
  }
}

/**
 * Sign in an existing account: authenticate to Supabase, derive the password
 * key, fetch the keyring, and unwrap the DEK with the password. The DEK is kept
 * in memory in main only.
 */
export async function signIn(email: string, password: string): Promise<SignUpResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, signedIn: false, unlocked: false, notConfigured: true, error: 'Cloud sync is not configured.' }
  }
  const supabase = getSupabase()

  const { data, error } = await withColdStartRetry(() =>
    supabase.auth.signInWithPassword({ email, password })
  )
  if (error) return { ok: false, signedIn: false, unlocked: false, error: error.message }
  const user = data.user
  if (!user) return { ok: false, signedIn: false, unlocked: false, error: 'Sign-in failed.' }

  const store = new SupabaseBlobStore(supabase, user.id)
  const keyring = await loadKeyring(store)
  if (!keyring) {
    // Authenticated but no keyring yet (e.g. signup happened before email
    // confirmation). Bootstrap one now from this password.
    const salt = randomSalt()
    const passwordKey = deriveKey(password, salt)
    const dek = randomKey(KEY_LEN)
    const recoveryRaw = randomKey(KEY_LEN)
    const kr: Keyring = {
      v: 1,
      salt: toB64(salt),
      wrappedByPassword: wrapKey(dek, passwordKey),
      wrappedByRecovery: wrapKey(dek, recoveryRaw)
    }
    try {
      await saveKeyring(store, kr)
    } catch (err) {
      return {
        ok: false,
        signedIn: true,
        unlocked: false,
        email,
        error: `Couldn't initialize your encryption keyring: ${err instanceof Error ? err.message : String(err)}`
      }
    }
    unlocked = { dek, store, userId: user.id, email }
    bindUser(user.id)
    cacheDek(user.id, dek) // stay logged in across launches
    // First sign-in after email confirmation: the keyring is BORN here, so this
    // is where the one-time recovery key must be surfaced (same as signup when
    // email confirmation is off).
    return {
      ok: true,
      signedIn: true,
      unlocked: true,
      email,
      recoveryKey: formatRecoveryKey(recoveryRaw)
    }
  }

  // Derive the password key from the STORED salt and unwrap the DEK.
  const passwordKey = deriveKey(password, fromB64(keyring.salt))
  let dek: Buffer
  try {
    dek = unwrapKey(keyring.wrappedByPassword, passwordKey)
  } catch {
    // GCM tag mismatch ⇒ wrong password for E2EE (even though Supabase auth
    // succeeded, which should not normally happen unless the password changed
    // server-side without re-wrapping). Surface a clear, safe error.
    return {
      ok: false,
      signedIn: true,
      unlocked: false,
      email,
      error: 'Your password could not decrypt the vault. Use your recovery key to unlock.'
    }
  }

  unlocked = { dek, store, userId: user.id, email }
  bindUser(user.id)
  cacheDek(user.id, dek) // stay logged in across launches
  return { ok: true, signedIn: true, unlocked: true, email }
}

/**
 * Unlock the vault using the RECOVERY KEY when the password is forgotten. The
 * user must already have a Supabase session (they reset their Supabase password
 * the normal way, or are still signed in). This unwraps the DEK with the
 * recovery key and (optionally) re-wraps it under a new password.
 */
export async function unlockWithRecovery(
  recoveryKey: string,
  newPassword?: string
): Promise<VaultStatus> {
  if (!isSupabaseConfigured()) {
    return { ok: false, signedIn: false, unlocked: false, notConfigured: true }
  }
  const supabase = getSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    return { ok: false, signedIn: false, unlocked: false, error: 'You must be signed in first.' }
  }
  const user = data.user
  const store = new SupabaseBlobStore(supabase, user.id)
  const keyring = await loadKeyring(store)
  if (!keyring) return { ok: false, signedIn: true, unlocked: false, error: 'No keyring found.' }

  let dek: Buffer
  try {
    dek = unwrapKey(keyring.wrappedByRecovery, parseRecoveryKey(recoveryKey))
  } catch {
    return { ok: false, signedIn: true, unlocked: false, error: 'That recovery key is invalid.' }
  }

  // Optionally re-wrap the DEK under a new password (rotates the salt too).
  if (newPassword) {
    const salt = randomSalt()
    const passwordKey = deriveKey(newPassword, salt)
    const updated: Keyring = {
      ...keyring,
      salt: toB64(salt),
      wrappedByPassword: wrapKey(dek, passwordKey)
    }
    await saveKeyring(store, updated)
  }

  unlocked = { dek, store, userId: user.id, email: user.email ?? '' }
  bindUser(user.id)
  cacheDek(user.id, dek) // stay logged in across launches
  return { ok: true, signedIn: true, unlocked: true, email: user.email ?? '' }
}

/** Sign out: clear the Supabase session, the persisted "stay logged in" DEK, and
 *  wipe the in-memory DEK. */
export async function signOut(): Promise<VaultStatus> {
  // Forget the cached DEK so the next launch does NOT auto-unlock. Resolve the
  // user id from memory, or from the live session if we're locked-but-signed-in.
  let uid = unlocked?.userId
  if (!uid && isSupabaseConfigured()) {
    try {
      const { data } = await getSupabase().auth.getUser()
      uid = data.user?.id
    } catch {
      /* ignore */
    }
  }
  if (uid) clearCachedDek(uid)
  try {
    if (isSupabaseConfigured()) await getSupabase().auth.signOut()
  } catch {
    /* ignore — we still clear local state */
  }
  // Best-effort zeroize the DEK before dropping the reference.
  if (unlocked) unlocked.dek.fill(0)
  unlocked = null
  setCurrentUser(null) // un-scope provider data on sign-out
  return { ok: true, signedIn: false, unlocked: false }
}

/**
 * SESSION RESTORE on app start: ask supabase-js to restore its persisted session
 * (from our encrypted storage adapter). If a session exists, build the store but
 * leave the vault LOCKED — the DEK can only be recovered from the password (or
 * recovery key), which we deliberately do NOT persist. The renderer shows the
 * password prompt to unlock; auth itself is already restored.
 */
export async function restoreSession(): Promise<VaultStatus> {
  if (!isSupabaseConfigured()) {
    return { ok: true, signedIn: false, unlocked: false, notConfigured: true }
  }
  try {
    const supabase = getSupabase()
    const { data } = await withColdStartRetry(() => supabase.auth.getSession())
    const session = data.session
    if (!session?.user) return { ok: true, signedIn: false, unlocked: false }
    // "Stay logged in": if we cached the DEK on this device (safeStorage), restore
    // it and open the vault automatically — no password prompt. Otherwise stay
    // signed-in-but-locked and let the renderer ask for the password.
    const cachedDek = loadCachedDek(session.user.id)
    if (cachedDek) {
      unlocked = {
        dek: cachedDek,
        store: new SupabaseBlobStore(supabase, session.user.id),
        userId: session.user.id,
        email: session.user.email ?? ''
      }
      bindUser(session.user.id)
      return {
        ok: true,
        signedIn: true,
        unlocked: true,
        email: session.user.email ?? '',
        userId: session.user.id,
        isAdmin: isAdminEmail(session.user.email ?? undefined)
      }
    }
    // Signed in, but vault locked until the password re-derives the DEK. Scope
    // provider data to this user now so Notes/Calendar isolate per account.
    setCurrentUser(session.user.id)
    return {
      ok: true,
      signedIn: true,
      unlocked: false,
      email: session.user.email ?? '',
      userId: session.user.id,
      isAdmin: isAdminEmail(session.user.email ?? undefined)
    }
  } catch (err) {
    return { ok: false, signedIn: false, unlocked: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Current status (does not derive any key). */
export async function status(): Promise<VaultStatus> {
  if (!isSupabaseConfigured()) {
    return { ok: true, signedIn: false, unlocked: false, notConfigured: true }
  }
  if (unlocked)
    return {
      ok: true,
      signedIn: true,
      unlocked: true,
      email: unlocked.email,
      userId: unlocked.userId,
      isAdmin: isAdminEmail(unlocked.email)
    }
  return restoreSession()
}

/**
 * Admin emails — anyone who signs in with one of these is an admin in BOTH apps.
 * MUST match Operations' ADMIN_EMAILS (Operations/backend.py) so the same login is
 * admin in Decks and Operations. Compared case-insensitively.
 */
const ADMIN_EMAILS = new Set(['thatonejet@jetcore.local', 'srijoy@gmail.com'])

/** True when this email is an admin (in the shared admin list). */
export function isAdminEmail(email?: string): boolean {
  return !!email && ADMIN_EMAILS.has(email.trim().toLowerCase())
}

/** The signed-in Supabase account (id + email + admin), or null. For scoping local
 *  data (workspaces, web partitions, Operations) by the JetCore account. */
export function getCloudAccount(): { userId: string; email: string; isAdmin: boolean } | null {
  return unlocked
    ? { userId: unlocked.userId, email: unlocked.email, isAdmin: isAdminEmail(unlocked.email) }
    : null
}

/**
 * Store plaintext under `key`: encrypt with the in-memory DEK (fresh nonce) and
 * write the ciphertext to the BlobStore. The store NEVER sees plaintext or keys.
 * Throws if the vault is locked.
 */
export async function vaultSet(key: string, plaintext: string): Promise<void> {
  if (key === KEYRING_KEY) throw new Error('Reserved key.')
  if (!unlocked) throw new Error('Vault is locked.')
  const ciphertext = encrypt(plaintext, unlocked.dek) // fresh random nonce inside
  await unlocked.store.set(key, ciphertext)
}

/**
 * Fetch ciphertext at `key` and decrypt with the in-memory DEK. Returns the
 * plaintext, or null if the key is absent. Throws on tamper/locked.
 */
export async function vaultGet(key: string): Promise<string | null> {
  if (key === KEYRING_KEY) throw new Error('Reserved key.')
  if (!unlocked) throw new Error('Vault is locked.')
  const ciphertext = await unlocked.store.get(key)
  if (ciphertext == null) return null
  return decrypt(ciphertext, unlocked.dek) // throws loudly on tamper/wrong key
}

/** True when the DEK is unlocked in memory. */
export function isUnlocked(): boolean {
  return unlocked !== null
}
