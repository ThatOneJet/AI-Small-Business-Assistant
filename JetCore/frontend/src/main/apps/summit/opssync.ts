/**
 * Operations cross-device sync (MAIN PROCESS ONLY).
 *
 * Operations data (Homebase/Plaid connections, sales/labor/transactions) lives in
 * a local SQLite DB per machine. This module makes it cross-device by piggy-backing
 * on the E2EE vault:
 *   - PULL on login: fetch the encrypted snapshot from Supabase (vaultGet),
 *     decrypt in-process, and POST it into the local backend (/api/jetcore_import)
 *     so a fresh machine is seeded with the account's data.
 *   - PUSH on change: GET /api/jetcore_export from the backend, encrypt with the
 *     account's DEK (vaultSet), and store the ciphertext in Supabase.
 *
 * Secrets (Homebase api_key, Plaid access tokens) are inside the snapshot, so the
 * vault's AES-256-GCM-under-the-DEK encryption is what keeps them out of Supabase
 * in plaintext — the server only ever sees ciphertext.
 *
 * Ordering is a device-independent monotonic `rev` carried INSIDE the snapshot,
 * mirrored locally per account (ops-sync-<userId>.json). Conflict policy is
 * last-writer-wins (fine for one user across a few devices); pushes happen on
 * leaving Operations and on a periodic timer, so changes propagate within ~a
 * minute without an explicit save.
 */
import { app } from 'electron'
import { get as httpGet, request as httpRequest } from 'http'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { gzipSync, gunzipSync } from 'zlib'
import { vaultGet, vaultSet, isUnlocked, getCloudAccount } from '../../vault'

/** Vault key the encrypted Operations snapshot is stored under (per account). */
const VAULT_KEY = 'operations.snapshot'

interface Snapshot {
  v: number
  rev: number
  exported_at: string
  tables: Record<string, unknown[]>
}
/** Locally-mirrored sync state: the rev this device's DB currently represents,
 *  and the hash of the data it last pushed (to skip no-op pushes). */
interface LocalMeta {
  rev: number
  hash: string
}

function metaPath(userId: string): string {
  return join(app.getPath('userData'), `ops-sync-${userId}.json`)
}
function readMeta(userId: string): LocalMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath(userId), 'utf8')) as LocalMeta
  } catch {
    return null
  }
}
function writeMeta(userId: string, m: LocalMeta): void {
  try {
    writeFileSync(metaPath(userId), JSON.stringify(m))
  } catch {
    /* best-effort */
  }
}

function hashTables(tables: unknown): string {
  return createHash('sha256').update(JSON.stringify(tables)).digest('base64')
}

/** Operations snapshots can be multiple MB of JSON (highly compressible). Gzip
 *  before the vault encrypts it, so Supabase stores a small ciphertext blob. */
function encodeSnapshot(snap: Snapshot): string {
  return 'gz:' + gzipSync(Buffer.from(JSON.stringify(snap), 'utf8')).toString('base64')
}
function decodeSnapshot(raw: string): Snapshot | null {
  try {
    const json = raw.startsWith('gz:')
      ? gunzipSync(Buffer.from(raw.slice(3), 'base64')).toString('utf8')
      : raw // tolerate an uncompressed blob (forward/back compatibility)
    return JSON.parse(json) as Snapshot
  } catch {
    return null
  }
}

/** GET JSON from the loopback backend. */
function backendGet(port: number, path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = httpGet({ host: '127.0.0.1', port, path, timeout: 15000 }, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('backend GET timeout')))
  })
}

/** POST JSON to the loopback backend. */
function backendPost(port: number, path: string, payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload))
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        timeout: 30000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(body || '{}'))
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('backend POST timeout')))
    req.write(data)
    req.end()
  })
}

/**
 * Export local data + push it to the vault if it changed since the last push.
 * `baseRev` lets the caller guarantee the new rev exceeds a known cloud rev, so a
 * populated device claiming the cloud can't regress the monotonic counter.
 */
async function pushNow(
  port: number,
  userId: string,
  meta: LocalMeta | null,
  baseRev = 0
): Promise<void> {
  let exp: Record<string, unknown>
  try {
    exp = await backendGet(port, '/api/jetcore_export')
  } catch (err) {
    console.error('[opssync] export failed:', err)
    return
  }
  const tables = (exp.tables as Record<string, unknown[]>) ?? {}
  const h = hashTables(tables)
  if (meta && meta.hash === h && (meta.rev ?? 0) >= baseRev) return // unchanged → no-op
  const rev = Math.max(meta?.rev ?? 0, baseRev) + 1
  const snap: Snapshot = { v: 1, rev, exported_at: new Date().toISOString(), tables }
  try {
    await vaultSet(VAULT_KEY, encodeSnapshot(snap))
    writeMeta(userId, { rev, hash: h })
    console.log(`[opssync] pushed rev ${rev} (${exp.row_count ?? '?'} rows)`)
  } catch (err) {
    console.error('[opssync] push failed:', err)
  }
}

/**
 * On Operations start: seed the local DB from the cloud snapshot when the cloud is
 * newer than what this device last synced. Safe-guards:
 *  - cloud empty → if local has data, seed the cloud from local (first device).
 *  - this device never synced (no meta) but already has local data → DON'T clobber
 *    it; push local up instead (local wins on first sync of a populated device).
 */
export async function pullOnStart(port: number): Promise<void> {
  if (!isUnlocked()) return
  const acct = getCloudAccount()
  if (!acct) return

  let cloudRaw: string | null = null
  try {
    cloudRaw = await vaultGet(VAULT_KEY)
  } catch (err) {
    console.error('[opssync] vaultGet failed:', err)
    return
  }

  const meta = readMeta(acct.userId)

  let local: Record<string, unknown>
  try {
    local = await backendGet(port, '/api/jetcore_export')
  } catch {
    return
  }
  const localHasData = ((local.row_count as number) ?? 0) > 0

  if (!cloudRaw) {
    // Nothing in the cloud yet. If this machine has data (e.g. the existing
    // primary device), seed the cloud from it so other devices can pull.
    if (localHasData) await pushNow(port, acct.userId, meta)
    return
  }

  const snap = decodeSnapshot(cloudRaw)
  if (!snap) return

  const localRev = meta?.rev ?? -1
  if (snap.rev <= localRev) return // already in sync (or local ahead)

  if (meta == null && localHasData) {
    // Never synced here AND we already have local data → importing would wipe it.
    // Treat this device as the source and push up instead, at a rev above the
    // cloud's so the counter stays monotonic and other devices see the change.
    await pushNow(port, acct.userId, meta, snap.rev)
    return
  }

  try {
    await backendPost(port, '/api/jetcore_import', { tables: snap.tables })
    writeMeta(acct.userId, { rev: snap.rev, hash: hashTables(snap.tables) })
    console.log(`[opssync] pulled rev ${snap.rev} from cloud`)
  } catch (err) {
    console.error('[opssync] import failed:', err)
  }
}

/** Push local changes to the cloud if anything changed. Safe to call often. */
export async function pushIfChanged(port: number): Promise<void> {
  if (!isUnlocked()) return
  const acct = getCloudAccount()
  if (!acct) return
  await pushNow(port, acct.userId, readMeta(acct.userId))
}
