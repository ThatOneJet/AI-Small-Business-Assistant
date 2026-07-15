/**
 * Decks — JetCore Operations integration.
 *
 * "Operations" is the already-built JetCore Flask backend (a packaged
 * PyInstaller `backend.exe` that serves a full web UI). This module spawns ONE
 * instance bound to a free loopback port, waits until it serves `/health`, and
 * shows its UI full-area inside a single owned `WebContentsView` overlaid on the
 * main window — switchable with the rest of Decks.
 *
 * Mirrors codeserver.ts (free port → spawn → health-poll → tree-kill) and uses
 * the lifecycle registry so the child is never orphaned. Teardown is idempotent
 * and never throws.
 */
import { spawn, type ChildProcess } from 'child_process'
import { createServer } from 'net'
import { get as httpGet } from 'http'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { app, WebContentsView, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  OperationsStartResult,
  OperationsBoundsPayload,
  SummitApiPayload,
  SummitApiResult,
  SummitAccountResult,
  SummitUploadPayload,
  SummitUploadResult
} from '@shared/ipc'
import type { PanelBounds } from '@shared/types'
import { registerChild, unregisterChild } from '../../lifecycle'
import { CHROME_UA } from '../../panels'
import { getAccount, getSessionToken } from '../../auth'
import { getCloudAccount } from '../../vault'
import { pullOnStart, pushIfChanged } from './opssync'

/** How long to wait for the backend to answer /health before giving up. */
const READY_TRIES = 140
/** Interval between /health poll attempts (140 × 150ms ≈ 21s). */
const POLL_INTERVAL_MS = 150
/** How often to push local Operations changes to the cloud while running. */
const SYNC_PUSH_INTERVAL_MS = 60_000

/** The running JetCore backend we own (at most one). */
interface ActiveBackend {
  child: ChildProcess
  pid: number
  url: string
  port: number
  /** Periodic cloud-sync push timer; cleared on stop. */
  syncTimer: NodeJS.Timeout | null
}

let active: ActiveBackend | null = null

/** The single Operations WebContentsView (lazily created once started). */
let view: WebContentsView | null = null
/** Whether the view is currently a child of the window's contentView. */
let attached = false
/** Whether loadURL has already been issued for the current view. */
let loaded = false

/** The main window the Operations view is overlaid onto (bound on first use). */
let mainWindowRef: BrowserWindow | null = null

/** Install the process-exit backstop exactly once. */
let exitHookInstalled = false

/** Bind the main window the Operations view overlays. Call once after creation. */
export function setOperationsWindow(win: BrowserWindow): void {
  mainWindowRef = win
}

/**
 * Resolve the JetCore Operations backend executable.
 *  - packaged: <resources>/jetcore-backend/backend.exe (bundled as an extra resource)
 *  - dev: the JetCore repo keeps Decks and Operations as SIBLING folders, so from
 *    the Decks app root (app.getAppPath() = <repo>/Decks) the Operations backend is
 *    at <repo>/Summit/dist-pyinstaller/backend/backend.exe.
 */
function resolveBackendExe(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'jetcore-backend', 'backend.exe')
  }
  return join(app.getAppPath(), '..', 'Summit', 'dist-pyinstaller', 'backend', 'backend.exe')
}

/**
 * Find a free localhost TCP port: bind to port 0, let the OS pick, then release.
 * Same trick as codeserver.ts; the brief gap before the backend binds is an
 * accepted (negligible) race.
 */
function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('Could not determine a free port for JetCore.')))
      }
    })
  })
}

/** One-shot GET http://127.0.0.1:<port>/health — resolves true on HTTP 200. */
function probeHealth(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const req = httpGet({ host: '127.0.0.1', port, path: '/health', timeout: 1500 }, (res) => {
      res.resume() // drain so the socket closes cleanly
      resolve(res.statusCode === 200)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
  })
}

/** Sleep helper. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Round a bounds rect to integer pixels (Electron rejects fractional bounds). */
function toIntBounds(b: PanelBounds): PanelBounds {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height)
  }
}

/** Best-effort tree kill of the backend. Never throws. */
function killChild(child: ChildProcess): void {
  const pid = child.pid
  try {
    if (process.platform === 'win32' && typeof pid === 'number') {
      // /T kills the whole process tree (PyInstaller bootloader + child), /F forces it.
      spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true }).on(
        'error',
        () => {
          /* taskkill missing/failed — nothing else to do */
        }
      )
    } else {
      child.kill('SIGKILL')
    }
  } catch {
    /* swallow — teardown must never throw */
  }
}

/**
 * Start (or reuse) the JetCore backend.
 *
 * @returns `{ url }` of the live backend, or `{ error }` with a clear message.
 *          Never rejects — failures are reported in the resolved result.
 */
/** One shared in-flight spawn, so concurrent callers (the boot warm-up + Summit's
 *  probe + a tab's several fetches all firing during the ~1.2s spawn) DON'T each
 *  spawn their own backend — which orphaned extra processes and spammed the sync
 *  timer with ECONNREFUSED on dead ports. */
let startingPromise: Promise<OperationsStartResult> | null = null

export async function startOperations(): Promise<OperationsStartResult> {
  if (active) return { url: active.url }
  if (startingPromise) return startingPromise
  startingPromise = doStartOperations()
  try {
    return await startingPromise
  } finally {
    startingPromise = null
  }
}

async function doStartOperations(): Promise<OperationsStartResult> {
  // Singleton: reuse the existing instance.
  if (active) return { url: active.url }

  const exe = resolveBackendExe()
  if (!existsSync(exe)) {
    return {
      error:
        `JetCore backend not found at ${exe}. ` +
        'Build it (JetCore/Summit/dist-pyinstaller/backend/backend.exe) and try again.'
    }
  }

  if (!exitHookInstalled) {
    // Backstop: if the app dies without going through cleanup()/stopOperations(),
    // still take our child with us. `process.on('exit')` must be synchronous.
    const onExit = (): void => {
      if (active) {
        killChild(active.child)
        active = null
      }
    }
    process.once('exit', onExit)
    exitHookInstalled = true
  }

  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}`

  // Shell-authenticated single-user mode: pass the signed-in JetCore (Supabase)
  // identity to the backend so ALL Operations data is scoped to that account
  // instead of the backend's own separate Flask login. We are the only caller
  // (loopback), so the backend can trust this env-supplied identity.
  // NOTE: the backend is spawned ONCE per session, so the bound user is whoever
  // was signed in at the first Operations open. Switching JetCore accounts
  // mid-session without an app restart is a known follow-up.
  const cloud = getCloudAccount()
  const shellEnv: NodeJS.ProcessEnv = { ...process.env, JETCORE_PORT: String(port) }
  if (cloud) {
    shellEnv.JETCORE_USER_ID = cloud.userId
    shellEnv.JETCORE_USER_EMAIL = cloud.email
  }

  let child: ChildProcess
  try {
    child = spawn(exe, [], {
      cwd: dirname(exe),
      env: shellEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    return { error: `Failed to start JetCore: ${err instanceof Error ? err.message : String(err)}` }
  }

  return new Promise<OperationsStartResult>((resolve) => {
    let settled = false
    let stderrTail = ''

    const finishOk = (): void => {
      if (settled) return
      settled = true
      cleanupListeners()
      const pid = child.pid
      if (typeof pid === 'number') registerChild(pid)
      const timer = setInterval(() => {
        void pushIfChanged(port)
      }, SYNC_PUSH_INTERVAL_MS)
      if (typeof timer.unref === 'function') timer.unref()
      active = { child, pid: pid ?? -1, url, port, syncTimer: timer }
      // Resolve AS SOON AS the backend is healthy (~1s) so Summit's native screens
      // load immediately. Cross-device sync (a Supabase round-trip + a full DB
      // export/import) runs in the BACKGROUND — it must never gate readiness. The
      // native screens re-fetch their data, so a pulled snapshot shows on refresh.
      resolve({ url })
      void pullOnStart(port).catch(() => {
        /* sync is best-effort */
      })
    }

    const finishErr = (message: string): void => {
      if (settled) return
      settled = true
      cleanupListeners()
      killChild(child)
      resolve({ error: message })
    }

    const onError = (err: NodeJS.ErrnoException): void => {
      finishErr(`Failed to start JetCore: ${err?.message ?? String(err)}`)
    }

    const onExit = (code: number | null): void => {
      // Early exit before readiness → failure; surface the stderr tail for context.
      finishErr(
        `JetCore backend exited before it was ready (code ${code ?? 'null'}). ` +
          (stderrTail ? `Last output: ${stderrTail.trim().slice(-300)}` : '')
      )
    }

    const cleanupListeners = (): void => {
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
    }

    child.on('error', onError)
    child.on('exit', onExit)
    // Keep the tail of stderr so an early exit can explain itself; drain the pipe.
    child.stderr?.on('data', (buf: Buffer) => {
      stderrTail = (stderrTail + buf.toString()).slice(-2000)
    })
    child.stdout?.resume()

    // Readiness via /health polling (the only reliable signal — the backend
    // doesn't print a stable "listening" line we can rely on).
    void (async () => {
      for (let i = 0; i < READY_TRIES && !settled; i++) {
        if (await probeHealth(port)) {
          finishOk()
          return
        }
        if (settled) return
        await delay(POLL_INTERVAL_MS)
      }
      if (!settled) {
        finishErr(
          `JetCore did not become ready within ${(READY_TRIES * POLL_INTERVAL_MS) / 1000}s on ${url}.`
        )
      }
    })()
  })
}

/**
 * Inject the signed-in JetCore session into the Operations page's localStorage so
 * the embedded Flask app is authenticated as the SAME JetCore account (single
 * sign-on). Only runs when a session token + account exist. ALL values are
 * serialized with JSON.stringify (never string-interpolated) so a stray quote or
 * script in any field can't break or inject into the page.
 */
function injectSession(wc: WebContentsView['webContents']): void {
  const account = getAccount()
  const token = getSessionToken()
  if (!account || !token) return
  // The keys Operations reads from localStorage to consider itself logged in.
  const entries: Record<string, string> = {
    token,
    user_id: account.userId,
    email: account.email,
    first_name: account.firstName,
    segment: account.segment,
    plan: account.plan,
    is_admin: account.isAdmin ? '1' : '',
    profile_pic: account.avatar ?? ''
  }
  // Build a safe script: each value goes through JSON.stringify.
  const sets = Object.entries(entries)
    .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
    .join('')
  const script = `(function(){try{${sets}}catch(e){}})();`
  wc.executeJavaScript(script).catch(() => {
    /* page may have navigated away — injection is best-effort */
  })
}

/** Lazily create the Operations WebContentsView (the URL is loaded by the caller). */
function ensureView(): WebContentsView {
  if (view) return view
  view = new WebContentsView({
    webPreferences: {
      // Its own persistent session so JetCore logins survive restarts.
      partition: 'persist:jetcore-ops',
      // The separate preload for this view (built by electron-vite to out/preload/).
      // Mirrors how index.ts references the main preload (../preload/index.js).
      preload: join(__dirname, '../preload/operations.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  // Present as plain Chrome, consistent with the rest of the app's embedded views.
  view.webContents.setUserAgent(CHROME_UA)
  // Single sign-on: seed the JetCore session into the page's localStorage on every
  // load so Operations authenticates as the same account as the Decks shell.
  view.webContents.on('dom-ready', () => {
    if (view) injectSession(view.webContents)
  })
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  view.setVisible(false)
  return view
}

/**
 * Show the Operations view full-area over the renderer at `bounds`. Ensures the
 * backend is started and the view created/loaded first. Resolves with no value.
 */
export async function showOperations(payload: OperationsBoundsPayload): Promise<void> {
  const result = await startOperations()
  if (!result.url) return // start failed — renderer already has the error from start()
  const win = mainWindowRef
  if (!win || win.isDestroyed()) return

  const v = ensureView()
  if (!loaded) {
    loaded = true
    void v.webContents.loadURL(result.url).catch((err: NodeJS.ErrnoException) => {
      if (err?.code === 'ERR_ABORTED' || err?.errno === -3) return // benign superseded nav
      console.error('[decks] Operations view failed to load:', err)
    })
  }
  if (!attached) {
    win.contentView.addChildView(v)
    attached = true
  }
  v.setVisible(true)
  v.setBounds(toIntBounds(payload.bounds))
}

/**
 * Pre-load Summit in the background: start the backend AND load the Operations
 * page into the (hidden) WebContentsView, so the FIRST switch to Summit just
 * reveals an already-loaded view — instant, like the native apps. Idempotent.
 */
export async function preloadOperations(): Promise<void> {
  const result = await startOperations()
  if (!result.url) return
  const v = ensureView()
  if (!loaded) {
    loaded = true
    void v.webContents.loadURL(result.url).catch((err: NodeJS.ErrnoException) => {
      if (err?.code === 'ERR_ABORTED' || err?.errno === -3) return
      console.error('[decks] Operations preload failed:', err)
    })
  }
}

/**
 * Summit native-UI bridge: proxy one REST call from the renderer to the spawned
 * Flask backend. Runs in MAIN so there's no CORS and the backend session JWT
 * never reaches the renderer. `:uid` in the path is replaced with the bound
 * shell user's numeric id (from /api/jetcore_session, cached per backend run).
 */
let summitSession: { token: string; userId: number } | null = null

async function getSummitSession(base: string): Promise<{ token: string; userId: number } | null> {
  if (summitSession) return summitSession
  try {
    const r = await fetch(`${base}/api/jetcore_session`)
    if (!r.ok) return null
    const j = (await r.json()) as { token?: string; user_id?: number }
    if (!j.token || j.user_id == null) return null
    summitSession = { token: j.token, userId: j.user_id }
    return summitSession
  } catch {
    return null
  }
}

/**
 * Non-secret JetCore account profile (segment / plan / is_admin / email) for the
 * bound shell user — used by the shell to decide app entitlements (who can use
 * Summit). Reads /api/jetcore_session in MAIN and strips the JWT, so the token
 * never reaches the renderer.
 */
export async function summitAccount(): Promise<SummitAccountResult> {
  const started = await startOperations()
  if (!started.url) return { ok: false, error: started.error ?? 'Summit backend not available.' }
  try {
    const r = await fetch(`${started.url}/api/jetcore_session`)
    if (!r.ok) return { ok: false, error: `session ${r.status}` }
    const j = (await r.json()) as {
      email?: string
      first_name?: string
      segment?: string
      plan?: string
      is_admin?: boolean
    }
    return {
      ok: true,
      account: {
        email: j.email,
        firstName: j.first_name,
        segment: j.segment,
        plan: j.plan,
        isAdmin: j.is_admin === true
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'session failed' }
  }
}

export async function summitApi(payload: SummitApiPayload): Promise<SummitApiResult> {
  const started = await startOperations()
  if (!started.url) return { ok: false, status: 0, error: started.error ?? 'Summit backend not available.' }
  const sess = await getSummitSession(started.url)
  if (!sess) return { ok: false, status: 0, error: 'Could not establish a Summit session.' }
  const path = payload.path.replace(':uid', String(sess.userId))
  try {
    const r = await fetch(started.url + path, {
      method: payload.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.token}` },
      body: payload.body != null ? JSON.stringify(payload.body) : undefined
    })
    const text = await r.text()
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
    return { ok: r.ok, status: r.status, data }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Upload an Excel/CSV file to a Summit import endpoint (`/api/upload/sales/:uid`
 * or `/api/upload/tenders/:uid`). The backend auto-detects columns and maps them
 * into the right categories. We post a multipart body here in main (with the
 * session JWT) from the bytes the renderer read.
 */
export async function summitUpload(payload: SummitUploadPayload): Promise<SummitUploadResult> {
  const started = await startOperations()
  if (!started.url) return { ok: false, error: started.error ?? 'Summit backend not available.' }
  const sess = await getSummitSession(started.url)
  if (!sess) return { ok: false, error: 'Could not establish a Summit session.' }
  try {
    const fd = new FormData()
    fd.append('file', new Blob([payload.data]), payload.filename || 'upload.csv')
    const r = await fetch(`${started.url}/api/upload/${payload.kind}/${sess.userId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sess.token}` },
      body: fd
    })
    const j = (await r.json().catch(() => ({}))) as { inserted?: number; skipped?: number; error?: string }
    if (!r.ok) return { ok: false, error: j.error ?? `Upload failed (${r.status}).` }
    return { ok: true, inserted: j.inserted, skipped: j.skipped }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Upload failed.' }
  }
}

/** Hide the Operations view (detach + zero bounds). The backend keeps running. */
export function hideOperations(): void {
  // Leaving Operations is a natural sync point — push any local changes to the
  // cloud so another device sees them (best-effort, fire-and-forget).
  if (active) void pushIfChanged(active.port)
  if (!view) return
  try {
    view.setVisible(false)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    if (attached && mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.contentView.removeChildView(view)
    }
  } catch {
    /* view may already be gone — ignore */
  }
  attached = false
}

/**
 * Push the active account's local Operations changes to ITS cloud snapshot and
 * await it. Call this on sign-out BEFORE the vault DEK is wiped, so the outgoing
 * account's data is saved (encryptable) — then stopOperations() can safely kill the
 * backend so it re-binds to whoever signs in next (account isolation).
 */
export async function flushOperations(): Promise<void> {
  if (!active) return
  try {
    await pushIfChanged(active.port)
  } catch {
    /* best-effort — local data persists and reconciles on next login */
  }
}

/**
 * Stop Operations entirely: kill the backend, destroy the view, reset state.
 * Idempotent; never throws. Safe to call from cleanup().
 */
export function stopOperations(): void {
  // Tear down the view first.
  if (view) {
    try {
      hideOperations()
      const wc = view.webContents
      if (!wc.isDestroyed()) {
        wc.removeAllListeners()
        wc.close()
      }
    } catch {
      /* ignore */
    }
    view = null
  }
  attached = false
  loaded = false

  // Then kill the backend child.
  summitSession = null // JWT belongs to this backend run
  const current = active
  active = null
  if (!current) return
  // Stop the periodic sync timer and make a best-effort final push (the app may
  // be quitting, so this can't be awaited — the 60s timer + push-on-hide are the
  // reliable paths; this just catches changes made right before quit).
  if (current.syncTimer) clearInterval(current.syncTimer)
  void pushIfChanged(current.port)
  try {
    if (current.pid > 0) unregisterChild(current.pid)
  } catch {
    /* ignore */
  }
  killChild(current.child)
}

/**
 * Wire the "return to Decks" bridge: when the Operations view's preload sends
 * OperationsRequestDecks, forward OperationsExit to the MAIN renderer so it can
 * flip the UI back from Operations to Decks. Call once from registerIpc().
 */
export function forwardOperationsExit(): void {
  const win = mainWindowRef
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC.OperationsExit)
}
