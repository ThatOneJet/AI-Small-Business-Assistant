/**
 * JetCore — Borderless control client (MAIN process).
 *
 * Drives the native `borderlessd` software-KVM agent (the Rust/Win32 daemon) over
 * its localhost control socket (127.0.0.1:52008, newline-delimited JSON). This
 * REPLACES the old in-app Node engine: the daemon does the real low-level input
 * capture + suppression and SendInput injection that Electron/Node cannot.
 *
 * We spawn `borderlessd run`, connect to its control socket, send ControlRequests
 * (SetConfig/Start/Stop/Pair/Unpair), and map its ControlEvents (State/Peers/Cursor)
 * back onto the exact IPC shapes the renderer already consumes — so the preload,
 * IPC channels, and BorderlessScreen need no changes.
 *
 * Daemon wire protocol mirrors borderless-agent/crates/protocol:
 *   - ControlRequest  (internal-tagged): {"type":"Start"} | {"type":"SetConfig",name,secret,layout} | {"type":"Pair",peer} | …
 *   - ControlEvent    (adjacent-tagged): {"type":"State","data":{…}} | {"type":"Peers","data":[…]} | {"type":"Cursor","data":{…}}
 */
import { spawn, type ChildProcess } from 'child_process'
import { connect, type Socket } from 'net'
import { existsSync } from 'fs'
import { join } from 'path'
import { hostname } from 'os'
import { app } from 'electron'
import type {
  BorderlessConfigPayload,
  BorderlessCursorEvent,
  BorderlessPeer,
  BorderlessState
} from '@shared/ipc'

const CONTROL_HOST = '127.0.0.1'
const CONTROL_PORT = 52008
const RECONNECT_MS = 800

/* ── daemon wire types (mirror crates/protocol) ───────────────────────────── */

type DaemonControlState = 'Stopped' | 'Starting' | 'Running' | 'Stopping' | 'Errored'
type DaemonConnState = 'Disconnected' | 'Connecting' | 'Connected' | 'Failed'

interface DaemonPeer {
  id: string
  name: string
  host: string
  port: number
  online: boolean
  paired: boolean
  conn_state: DaemonConnState
  error: string | null
}
interface DaemonState {
  running: boolean
  machine_id: string
  machine_name: string
  control_state: DaemonControlState
}
type ControlEvent =
  | { type: 'State'; data: DaemonState }
  | { type: 'Peers'; data: DaemonPeer[] }
  | { type: 'Cursor'; data: { x: number; y: number; edge: string | null; crossing_to: string | null } }

/* ── module state ─────────────────────────────────────────────────────── */

let child: ChildProcess | null = null
let sock: Socket | null = null
let rxBuf = ''
let running = false
let wantRunning = false
let machineName = ''
let secret = ''
let lastDaemon: DaemonState | null = null
let peers: BorderlessPeer[] = []
let reconnectTimer: NodeJS.Timeout | null = null
let send: ((channel: string, payload: unknown) => void) | null = null

/** Wire the renderer event sender (called from index.ts with the main window). */
export function setBorderlessSender(fn: (channel: string, payload: unknown) => void): void {
  send = fn
}

/* ── exe resolution (mirrors resolveBackendExe in summit/jetcore.ts) ───────── */

function resolveDaemonExe(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'borderless-agent', 'borderlessd.exe')
  // dev: app.getAppPath() = <repo>/frontend → the agent is built at <repo>/borderless-agent
  return join(app.getAppPath(), '..', 'borderless-agent', 'target', 'release', 'borderlessd.exe')
}

/* ── mapping: daemon shapes → renderer shapes ─────────────────────────────── */

function mapConnState(s: DaemonConnState): BorderlessPeer['connState'] {
  switch (s) {
    case 'Connected':
      return 'connected'
    case 'Connecting':
      return 'pairing'
    case 'Failed':
      return 'error'
    default:
      return 'idle'
  }
}

function mapEdge(e: string | null): BorderlessCursorEvent['edge'] {
  if (!e) return null
  const l = e.toLowerCase()
  return l === 'left' || l === 'right' || l === 'top' || l === 'bottom' ? l : null
}

function buildState(): BorderlessState {
  return {
    running,
    machineId: lastDaemon?.machine_id ?? '',
    machineName: lastDaemon?.machine_name ?? machineName,
    secretSet: secret.length > 0,
    peers
  }
}

function emitState(): void {
  send?.('borderless:state-changed', buildState())
}

/* ── control socket ───────────────────────────────────────────────────── */

function sendReq(req: object): void {
  if (!sock || sock.destroyed) return
  try {
    sock.write(JSON.stringify(req) + '\n')
  } catch {
    /* socket closing */
  }
}

function handleEvent(ev: ControlEvent): void {
  if (ev.type === 'State') {
    lastDaemon = ev.data
    running = ev.data.running
    if (ev.data.machine_name) machineName = ev.data.machine_name
    emitState()
  } else if (ev.type === 'Peers') {
    peers = ev.data
      .map((p) => ({
        id: p.id,
        name: p.name,
        host: p.host,
        port: p.port,
        online: p.online,
        paired: p.paired,
        connState: mapConnState(p.conn_state),
        error: p.error ?? undefined
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    emitState()
  } else if (ev.type === 'Cursor') {
    send?.('borderless:cursor', {
      x: ev.data.x,
      y: ev.data.y,
      edge: mapEdge(ev.data.edge),
      crossingTo: ev.data.crossing_to ?? null
    } satisfies BorderlessCursorEvent)
  }
}

function connectSocket(): void {
  if (sock || !wantRunning) return
  const s = connect({ host: CONTROL_HOST, port: CONTROL_PORT }, () => {
    rxBuf = ''
    // Push our config (applies the pairing secret + name) and ensure the engine runs.
    sendReq({ type: 'SetConfig', name: machineName, secret, layout: null })
    sendReq({ type: 'Start' })
    sendReq({ type: 'Status' })
  })
  sock = s
  s.setNoDelay(true)
  s.on('data', (chunk) => {
    rxBuf += chunk.toString()
    let nl: number
    while ((nl = rxBuf.indexOf('\n')) >= 0) {
      const line = rxBuf.slice(0, nl).trim()
      rxBuf = rxBuf.slice(nl + 1)
      if (!line) continue
      try {
        handleEvent(JSON.parse(line) as ControlEvent)
      } catch {
        /* ignore malformed line */
      }
    }
  })
  const drop = (): void => {
    if (sock === s) sock = null
    if (wantRunning) scheduleReconnect()
  }
  s.on('error', drop)
  s.on('close', drop)
}

function scheduleReconnect(): void {
  if (reconnectTimer || !wantRunning) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectSocket()
  }, RECONNECT_MS)
}

/* ── daemon process ───────────────────────────────────────────────────── */

function spawnDaemon(): boolean {
  if (child && !child.killed) return true
  const exe = resolveDaemonExe()
  if (!existsSync(exe)) {
    console.error(
      `[borderless] daemon not found at ${exe} — build it (cargo build --release in borderless-agent).`
    )
    return false
  }
  try {
    child = spawn(exe, ['run'], { stdio: 'ignore', windowsHide: true })
    child.on('exit', () => {
      child = null
      if (wantRunning) {
        running = false
        emitState()
      }
    })
    return true
  } catch (err) {
    console.error('[borderless] failed to spawn daemon:', err)
    child = null
    return false
  }
}

function killDaemon(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  try {
    sock?.destroy()
  } catch {
    /* ignore */
  }
  sock = null
  try {
    child?.kill()
  } catch {
    /* ignore */
  }
  child = null
}

// Always tear the daemon down with the app so no input hooks are left installed.
app.on('will-quit', killDaemon)

/* ── public API (called from IPC handlers — unchanged signatures) ──────────── */

export function getBorderlessState(): BorderlessState {
  return buildState()
}

export function startBorderless(cfg: BorderlessConfigPayload): BorderlessState {
  if (cfg.machineName !== undefined) machineName = cfg.machineName
  if (cfg.secret !== undefined) secret = cfg.secret
  if (!machineName) machineName = hostname()
  wantRunning = true
  if (!spawnDaemon()) {
    wantRunning = false
    running = false
    emitState()
    return buildState()
  }
  running = true // optimistic; the daemon's State event confirms/corrects it
  emitState()
  // The daemon needs a beat to bind 52008; connect now and retry on refusal.
  connectSocket()
  scheduleReconnect()
  return buildState()
}

export function stopBorderless(): BorderlessState {
  wantRunning = false
  running = false
  sendReq({ type: 'Stop' })
  killDaemon()
  peers = []
  emitState()
  return buildState()
}

export function setBorderlessConfig(cfg: BorderlessConfigPayload): BorderlessState {
  if (cfg.machineName !== undefined) machineName = cfg.machineName
  if (cfg.secret !== undefined) secret = cfg.secret
  sendReq({ type: 'SetConfig', name: machineName, secret, layout: null })
  emitState()
  return buildState()
}

export function pairBorderless(peerId: string): { ok: boolean; error?: string } {
  if (!wantRunning) return { ok: false, error: 'Borderless is not running.' }
  if (!secret) return { ok: false, error: 'Set a pairing secret first.' }
  sendReq({ type: 'Pair', peer: peerId })
  return { ok: true }
}

export function unpairBorderless(peerId: string): { ok: boolean } {
  sendReq({ type: 'Unpair', peer: peerId })
  return { ok: true }
}
