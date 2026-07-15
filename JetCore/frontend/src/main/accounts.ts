/**
 * Decks — per-provider account index (main process).
 *
 * A provider can have several connected accounts (two Canvas schools, two
 * GitHubs, …). Each account's credentials live in the secure token store under
 * `accountKey(provider, accountId)`; this module keeps the small NON-secret index
 * of which accounts exist (id + display label) under `<provider>#index`, so the
 * Settings UI can list them and a native deck can bind to one.
 *
 * The index is stored via the same encrypted token store for simplicity (it's
 * not sensitive, but keeping one persistence path is tidier).
 */
import { saveToken, getToken, getRawBlob, setRawBlob, listTokenKeys } from './tokens'
import type { ProviderId, AccountSummary } from '@shared/types'

const INDEX_SUFFIX = '#index'

/**
 * The signed-in JetCore user id, set by auth.ts when an account is loaded/logged
 * in (and cleared on logout). When set, provider credentials are scoped under it
 * so each JetCore account owns its own keys (cloud-sync ready). When NOT set
 * (logged out, or pre-account installs), we fall back to the legacy unscoped
 * scheme so nothing breaks.
 */
let currentUserId: string | null = null

/** Set/clear the JetCore user that provider keys are scoped under. */
export function setCurrentUser(userId: string | null): void {
  currentUserId = userId && userId.length ? userId : null
}

/** The legacy (unscoped) secure-store key for one account's credentials. */
function legacyAccountKey(provider: ProviderId, accountId: string): string {
  return `${provider}:${accountId}`
}

/**
 * Secure-store key for one account's credentials. Scoped under the signed-in
 * JetCore user (`jc:<userId>:<provider>:<accountId>`) when one is set; otherwise
 * the legacy unscoped `<provider>:<accountId>`.
 */
export function accountKey(provider: ProviderId, accountId: string): string {
  const base = legacyAccountKey(provider, accountId)
  return currentUserId ? `jc:${currentUserId}:${base}` : base
}

/**
 * One-time, best-effort migration: when a user logs in for the first time, copy
 * any existing UNSCOPED provider tokens (`<provider>:<accountId>` and the
 * `<provider>#index` lists) to the new `jc:<userId>:…` scoped keys so the user's
 * already-connected providers carry over. Never overwrites an existing scoped key
 * and never deletes the originals (so nothing is lost if something goes wrong).
 */
export function migrateUnscopedProviderTokens(userId: string): void {
  if (!userId) return
  const prefix = `jc:`
  for (const key of listTokenKeys()) {
    // Skip already-scoped keys and our session token; only migrate legacy keys.
    if (key.startsWith(prefix)) continue
    if (key === 'jetcore:session') continue
    const scoped = `jc:${userId}:${key}`
    // Don't clobber a value the user already has under their account.
    if (getRawBlob(scoped) !== null) continue
    const blob = getRawBlob(key)
    if (blob !== null) setRawBlob(scoped, blob)
  }
}

/** The list of connected accounts for a provider (empty if none). */
export function listAccounts(provider: ProviderId): AccountSummary[] {
  const raw = getToken(`${provider}${INDEX_SUFFIX}`)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (a): a is AccountSummary =>
        !!a && typeof a === 'object' && typeof (a as AccountSummary).id === 'string'
    )
  } catch {
    return []
  }
}

/** Add or update an account in the provider's index (id is the key). */
export function upsertAccount(provider: ProviderId, account: AccountSummary): void {
  const next = listAccounts(provider).filter((a) => a.id !== account.id)
  next.push(account)
  saveToken(`${provider}${INDEX_SUFFIX}`, JSON.stringify(next))
}

/** Remove an account from the provider's index. */
export function removeAccount(provider: ProviderId, accountId: string): void {
  const next = listAccounts(provider).filter((a) => a.id !== accountId)
  saveToken(`${provider}${INDEX_SUFFIX}`, JSON.stringify(next))
}
