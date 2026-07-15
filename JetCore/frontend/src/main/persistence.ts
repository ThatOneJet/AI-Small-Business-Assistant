/**
 * Decks — persistence.
 *
 * Reads/writes the full `PersistedState` snapshot to a JSON file in the app's
 * userData directory. Loads tolerate a missing/corrupt file (return null).
 * Saves are atomic-ish: write a temp file, then rename over the target.
 *
 * PER-ACCOUNT SCOPING: when a Supabase user is signed in (vault unlocked), the
 * snapshot lives in `decks-state-<userId>.json` so two JetCore accounts on the
 * same machine never share workspaces/settings/active-deck. When NO user is
 * signed in (locked / logged out), we fall back to the legacy unscoped
 * `decks-state.json`. The path is resolved at every call because the signed-in
 * user can change between a load and a later save.
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { PersistedState } from '@shared/types'
import { getCloudAccount } from './vault'

/** Legacy / logged-out (unscoped) snapshot file. */
const LEGACY_FILE_NAME = 'decks-state.json'

/**
 * Sanitize a Supabase user id for safe use in a filename. The id is a UUID
 * (already filename-safe), but we guard anyway: keep only [A-Za-z0-9_-] so a
 * malformed/unexpected id can never escape the userData directory.
 */
function safeUserId(userId: string): string {
  return userId.replace(/[^A-Za-z0-9_-]/g, '')
}

/**
 * Resolve the snapshot path AT CALL TIME from the currently signed-in account.
 * Signed in → `decks-state-<userId>.json`; otherwise the legacy unscoped file.
 */
function statePath(): string {
  const account = getCloudAccount()
  const id = account ? safeUserId(account.userId) : ''
  const fileName = id ? `decks-state-${id}.json` : LEGACY_FILE_NAME
  return join(app.getPath('userData'), fileName)
}

/** Read the persisted snapshot, or null if missing/corrupt. Never throws. */
export async function loadState(): Promise<PersistedState | null> {
  const file = statePath()
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as PersistedState
    // Minimal shape sanity-check; treat anything unexpected as "no state".
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.workspaces)) {
      return null
    }
    return parsed
  } catch {
    // Missing file, bad JSON, permission error — all mean "nothing to hydrate".
    return null
  }
}

/** Persist the snapshot atomically (temp file + rename). Never throws. */
export async function saveState(state: PersistedState): Promise<void> {
  const file = statePath()
  const tmp = `${file}.${process.pid}.tmp`
  try {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    // Best-effort cleanup of the temp file; swallow so a failed save never
    // crashes the renderer call.
    try {
      await fs.unlink(tmp)
    } catch {
      /* ignore */
    }
    console.error('[decks] failed to save state:', err)
  }
}
