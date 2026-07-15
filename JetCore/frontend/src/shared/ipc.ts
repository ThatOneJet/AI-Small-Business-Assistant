/**
 * Decks — IPC contract.
 *
 * The exact, typed boundary between the main process and the renderer.
 * - `IPC` holds every channel name (no string literals anywhere else).
 * - The payload/result interfaces type each call.
 * - `DecksApi` is the shape the preload exposes as `window.decks`, and the
 *   only thing the renderer is allowed to touch in the main process.
 *
 * Renderer → main calls are request/response (ipcRenderer.invoke).
 * Main → renderer messages are events the renderer subscribes to.
 */
import type {
  PanelBounds,
  PersistedState,
  PanelId,
  WorkspaceId,
  ProviderId,
  ProviderStatus,
  AccountSummary,
  JetCoreAccount
} from './types'

export const IPC = {
  // ── Panel (WebContentsView) lifecycle — renderer → main (invoke) ──
  PanelCreate: 'panel:create',
  PanelDestroy: 'panel:destroy',
  PanelNavigate: 'panel:navigate',
  PanelReload: 'panel:reload',
  /** Open a real top-level login window sharing the deck's partition. */
  PanelSignIn: 'panel:sign-in',
  PanelGoBack: 'panel:go-back',
  PanelGoForward: 'panel:go-forward',
  PanelSetBounds: 'panel:set-bounds',
  /** Attach the given panels to the window and detach all others. */
  PanelShowOnly: 'panel:show-only',
  /** Detach every panel view (so pure-renderer UI like Home/Cmd+K is visible). */
  PanelHideAll: 'panel:hide-all',
  /** Pin/unpin a panel as keep-alive (never auto-discarded). */
  PanelSetKeepAlive: 'panel:set-keep-alive',
  /** Pop a deck out into its own standalone window (drag a deck out of the app). */
  PanelTearOff: 'panel:tear-off',

  // ── Native deck providers — renderer → main (invoke) ──
  /** Connect a provider (paste a token, or run the OAuth helper). */
  ProviderConnect: 'provider:connect',
  /** Fetch a sanitized resource from a connected provider. */
  ProviderFetch: 'provider:fetch',
  /** Disconnect a provider (forget its stored token). */
  ProviderDisconnect: 'provider:disconnect',
  /** Query one account's connection status. */
  ProviderStatus: 'provider:status',
  /** List a provider's connected accounts. */
  ProviderAccounts: 'provider:accounts',

  // ── code-server (local VS Code in a deck) — renderer → main (invoke) ──
  /** Pick a folder + spawn code-server; resolves its loopback URL. */
  CodeServerStart: 'codeserver:start',
  /** Stop the running code-server (also torn down on quit). */
  CodeServerStop: 'codeserver:stop',

  // ── JetCore Operations (embedded Flask app in a full-area WebContentsView) ──
  /** Spawn (or reuse) the JetCore backend; resolves its loopback URL. */
  OperationsStart: 'operations:start',
  /** Pre-load Summit (backend + hidden webview) so the first open is instant. */
  OperationsPreload: 'operations:preload',
  /** Attach + position the Operations view over the given bounds. */
  OperationsShow: 'operations:show',
  /** Detach/hide the Operations view (Decks UI shows through underneath). */
  OperationsHide: 'operations:hide',
  /** Kill the JetCore backend + destroy its view (also torn down on quit). */
  OperationsStop: 'operations:stop',
  /** operations-view preload → main (send): the JetCore page asked to go back to Decks. */
  OperationsRequestDecks: 'operations:request-decks',
  /** main → the MAIN renderer (event): flip the UI back from Operations to Decks. */
  OperationsExit: 'operations:exit',

  // ── JetCore account auth — renderer → main (invoke) ──
  /** Log in against the Operations backend; persists token + account on success. */
  AuthLogin: 'auth:login',
  /** Sign up against the Operations backend; persists token + account on success. */
  AuthSignup: 'auth:signup',
  /** Clear the stored session token + persisted account (sign out). */
  AuthLogout: 'auth:logout',
  /** Return the persisted account (+ whether a session token exists). No spawn. */
  AuthStatus: 'auth:status',
  /** SYNC (sendSync): the Operations preload reads the JetCore session seed
   *  (localStorage entries) before the page's bundle runs → no second login. */
  AuthOperationsBootstrap: 'auth:operations-bootstrap',

  // ── Supabase cloud account (E2EE) — renderer → main (invoke) ──
  // The renderer NEVER receives the Supabase client, tokens, the master
  // password, or the derived/data key — only already-decrypted plaintext (vault
  // get) or a one-time recovery key (signup). All crypto happens in main.
  /** Sign up: Supabase auth + generate DEK + recovery key (returned ONCE). */
  CloudSignUp: 'cloud:signup',
  /** Sign in: Supabase auth + derive key + unwrap the DEK into main memory. */
  CloudSignIn: 'cloud:signin',
  /** Sign out: clear the Supabase session + wipe the in-memory DEK. */
  CloudSignOut: 'cloud:signout',
  /** Status: signed-in / unlocked / configured (no key derivation). */
  CloudStatus: 'cloud:status',
  /** Unlock the vault with the recovery key (forgotten-password path). */
  CloudRecover: 'cloud:recover',
  /** Encrypt {plaintext} with the DEK in main and store ciphertext at {key}. */
  VaultSet: 'vault:set',
  /** Fetch ciphertext at {key} and return DECRYPTED plaintext (or null). */
  VaultGet: 'vault:get',

  // ── Pylon (Canvas) — renderer → main (invoke) ──
  /** Verify a Canvas token + base URL, and save it (encrypted) on success. */
  PylonConnect: 'pylon:connect',
  /** Whether Canvas is connected (+ base URL). */
  PylonStatus: 'pylon:status',
  /** Pull the legible snapshot: courses + grades + upcoming work. */
  PylonFetch: 'pylon:fetch',
  /** Forget the stored Canvas token. */
  PylonDisconnect: 'pylon:disconnect',
  /** Generic authenticated Canvas proxy (token stays in main) — lets the Pylon UI
   *  read/submit anything: assignments, quizzes, pages, modules, files, submissions. */
  PylonApi: 'pylon:api',

  // ── DevBay (GitHub) — renderer → main (invoke) ──
  DevBayConnect: 'devbay:connect',
  DevBayStatus: 'devbay:status',
  DevBayFetch: 'devbay:fetch',
  DevBayDisconnect: 'devbay:disconnect',
  DevBayDraftRelease: 'devbay:draft-release',
  /** Generic authenticated GitHub proxy (token stays in main) — lets the DevBay UI
   *  browse repo contents / read files / list commits / anything on api.github.com. */
  DevBayApi: 'devbay:api',
  /** main → overlay renderer: the overlay was just shown (focus input + refresh). */
  DevBayOverlayShown: 'devbay:overlay-shown',
  /** overlay renderer → main: hide the overlay (Escape / action picked). */
  DevBayOverlayHide: 'devbay:overlay-hide',

  // ── Summit (native UI → Flask backend bridge) — renderer → main (invoke) ──
  /** Proxy an API call to the spawned Summit/Flask backend (no CORS, JWT in main). */
  SummitApi: 'summit:api',
  /** Upload an Excel/CSV file to a Summit import endpoint (multipart, auto-parsed
   *  + column-mapped by the backend). The renderer reads the file bytes; main
   *  posts the multipart body with the JWT. */
  SummitUpload: 'summit:upload',
  SummitAccount: 'summit:account',
  Displays: 'displays',
  CursorPoint: 'cursor-point',
  BorderlessStart: 'borderless:start',
  BorderlessStop: 'borderless:stop',
  BorderlessState: 'borderless:state',
  BorderlessPair: 'borderless:pair',
  BorderlessUnpair: 'borderless:unpair',
  BorderlessConfig: 'borderless:config',
  BorderlessStateChanged: 'borderless:state-changed',
  BorderlessCursor: 'borderless:cursor',

  // ── Auto-update — main → renderer (event) + renderer → main (send) ──
  /** Lifecycle of the in-app updater so the renderer can show the update UI. */
  UpdateStatus: 'update:status',
  /** Renderer asks main to quit and install the downloaded update now. */
  UpdateRestart: 'update:restart',

  // ── Persistence — renderer → main (invoke) ──
  StateLoad: 'state:load',
  StateSave: 'state:save',

  // ── In-app feedback (suggestions + bug reports → GitHub issue) ──
  FeedbackSubmit: 'feedback:submit',

  // ── Save a generated file to disk (native save dialog) — renderer → main ──
  /** Show a save dialog and write the given text to the chosen path. */
  FileSave: 'file:save',

  // ── Process metrics — renderer → main (invoke) ──
  /** Total RAM + live/discarded panel counts for the sidebar readout. */
  MetricsGet: 'metrics:get',
  /** Real per-panel memory (MB) for each live web deck. */
  PanelMetricsGet: 'metrics:panels',

  // ── Window controls — renderer → main (send) ──
  WindowMinimize: 'window:minimize',
  WindowMaximize: 'window:maximize',
  WindowClose: 'window:close',

  // ── Floating hover card overlay — renderer → main (send) ──
  /** Show the always-on-top hover card for a rail tile at a position. */
  HoverShow: 'hover:show',
  /** Hide the hover card. */
  HoverHide: 'hover:hide',

  // ── Settings applied to the main process — renderer → main (send) ──
  /** Apply settings that affect main (e.g. discard timeout). */
  SettingsApply: 'settings:apply',

  // ── Custom context menu (rendered in the overlay window, floats over pages) ──
  MenuShow: 'menu:show', // renderer → main
  MenuPick: 'menu:pick', // overlay → main (an item was chosen)
  MenuDismiss: 'menu:dismiss', // overlay → main (clicked outside)

  // ── YouTube corner mini-player (overlay control bar over a corner video) ──
  /** main → the OVERLAY window: show/update/hide the mini-player control bar. */
  OverlayMiniPlayer: 'overlay:miniplayer',
  /** main → the OVERLAY window: live audio levels for the visualizer (0..1[]). */
  OverlayMiniLevels: 'overlay:mini-levels',
  /** overlay → main (send): a mini-player control button was pressed. */
  MiniPlayerControl: 'miniplayer:control',
  /** main → the MAIN renderer: focus/expand a panel's deck back to full size. */
  FocusPanel: 'panel:focus',

  // ── Events — main → renderer (on) ──
  /** main → the OVERLAY window only: render/hide the hover card. */
  OverlayRender: 'overlay:render',
  /** main → the OVERLAY window only: render/hide the custom context menu. */
  OverlayMenu: 'overlay:menu',
  /** main → the MAIN renderer: a folder menu item was chosen. */
  FolderMenuAction: 'folder:menu-action',
  /** A panel's live WebContents changed (title/url/favicon/loading/nav state). */
  PanelUpdate: 'panel:update',
  /** A native workspace menu item was chosen. */
  WorkspaceMenuAction: 'workspace:menu-action',
  /**
   * The discard manager freed a panel's renderer (event carries the saved URL),
   * or recreated it on return (discarded:false). Renderer applies via patchPanel.
   */
  PanelDiscardState: 'panel:discard-state'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** payload: PanelCreate */
export interface PanelCreatePayload {
  panelId: PanelId
  workspaceId: WorkspaceId
  /** Always `persist:<workspaceId>` — keeps logins across restarts. */
  partition: string
  url: string
  /** Initial placement; may be updated later via PanelSetBounds. */
  bounds: PanelBounds
}

/** payload: ProviderConnect — connect a native deck's backing provider. */
export interface ProviderConnectPayload {
  provider: ProviderId
  /** Which account to connect (a provider may hold several). */
  accountId: string
  /** 'token' = the user pastes a personal access token; 'oauth' = run the helper. */
  mode: 'token' | 'oauth'
  /** The pasted token. Only used (and required) when mode === 'token'. */
  token?: string
  /**
   * Extra non-secret connection fields a provider needs alongside (or instead
   * of) a token — e.g. Canvas/Mastodon `instanceUrl`, Bluesky `handle` +
   * `appPassword`, an OAuth `clientId`. The client persists whatever it needs
   * via the secure token store (as a JSON blob); nothing here is logged.
   */
  fields?: Record<string, string>
}

/** payload: ProviderFetch — request a sanitized resource from a provider. */
export interface ProviderFetchPayload {
  provider: ProviderId
  /** Which connected account to read. */
  accountId: string
  /** Provider-defined resource name (e.g. 'courses', 'feed', 'repos'). */
  resource: string
  /** Optional provider-defined query params. */
  params?: Record<string, unknown>
}

/** payload: ProviderDisconnect / ProviderStatus — scope to one account. */
export interface ProviderAccountPayload {
  provider: ProviderId
  accountId: string
}

/** payload: AuthLogin — JetCore account credentials. */
export interface AuthLoginPayload {
  email: string
  password: string
}

/** payload: AuthSignup — new JetCore account fields. */
export interface AuthSignupPayload {
  email: string
  password: string
  firstName: string
  segment: JetCoreAccount['segment']
}

/**
 * result: AuthLogin / AuthSignup / AuthStatus / AuthLogout.
 * On success `account` is the signed-in (non-secret) JetCore account; on failure
 * `error` is a short, user-safe message. `hasSession` (status only) reflects
 * whether a session token exists in the keychain.
 */
export interface AuthResult {
  ok: boolean
  account?: JetCoreAccount
  hasSession?: boolean
  error?: string
}

/** payload: CloudSignUp / CloudSignIn — Supabase email + master password. */
export interface CloudAuthPayload {
  email: string
  /** Used as BOTH the Supabase auth credential AND (separately) to derive the
   *  local encryption key in main. NEVER sent to Supabase as data, NEVER stored. */
  password: string
}

/** payload: CloudRecover — unlock with the recovery key, optionally set a new password. */
export interface CloudRecoverPayload {
  recoveryKey: string
  newPassword?: string
}

/**
 * result: CloudSignUp / CloudSignIn / CloudStatus / CloudSignOut / CloudRecover.
 * Mirrors VaultStatus in main. `recoveryKey` is present ONLY on signup (once).
 */
export interface CloudResult {
  ok: boolean
  /** A Supabase session exists (restored or fresh). */
  signedIn: boolean
  /** The DEK is unlocked in main memory (the vault is usable). */
  unlocked: boolean
  email?: string
  /** Supabase user id — lets the renderer scope workspaces/partitions per account. */
  userId?: string
  /** True when the signed-in email is an admin (shared admin list; admin in both apps). */
  isAdmin?: boolean
  error?: string
  /** .env missing SUPABASE_URL/ANON_KEY — cloud sync unavailable. */
  notConfigured?: boolean
  /** Signup created the account but email confirmation is required (no session
   *  yet). The renderer shows a friendly "check your email" state, not an error. */
  pending?: boolean
  /** The one-time recovery key — shown when the keyring is first created (at
   *  signup if email confirmation is off, else at the first sign-in after it). */
  recoveryKey?: string
}

/** payload: VaultSet — renderer sends PLAINTEXT; main encrypts with the DEK. */
export interface VaultSetPayload {
  key: string
  plaintext: string
}

/** payload: PanelNavigate */
export interface PanelNavigatePayload {
  panelId: PanelId
  url: string
}

/** payload: PanelSetBounds */
export interface PanelSetBoundsPayload {
  panelId: PanelId
  bounds: PanelBounds
}

/** payload: PanelShowOnly — show these (in z-order), detach everything else. */
export interface PanelShowOnlyPayload {
  panelIds: PanelId[]
  /** Bounds keyed by panelId for the panels being shown. */
  bounds: Record<PanelId, PanelBounds>
}

/** payload: PanelTearOff — pop a web deck into its own standalone window. */
export interface PanelTearOffPayload {
  url: string
  /** The deck's session partition, so the new window is logged-in too. */
  partition: string
  title?: string
}

/** event: WorkspaceMenuAction (main → renderer) */
export interface WorkspaceMenuActionEvent {
  workspaceId: WorkspaceId
  action: 'rename' | 'reset' | 'note' | 'keepalive' | 'pin' | 'delete'
}

/** What kind of target a custom context menu is acting on. */
export type MenuKind = 'workspace' | 'folder'

/** payload: MenuShow (renderer → main). x/y are main-window-relative px. */
export interface MenuShowPayload {
  kind: MenuKind
  /** workspace id (kind='workspace') or group name (kind='folder'). */
  targetId: string
  x: number
  y: number
  hasNotes?: boolean
  /** Current keep-alive state, so the menu renders the toggle on/off. */
  keepAlive?: boolean
  /** Current pinned (sort-to-top) state, so the menu labels Pin/Unpin. */
  pinned?: boolean
}

/** event: OverlayMenu (main → the overlay window). */
export interface OverlayMenuEvent {
  kind: MenuKind
  targetId: string
  hasNotes: boolean
  /** Current keep-alive state for the toggle item. */
  keepAlive?: boolean
  /** Current pinned (sort-to-top) state, so the menu labels Pin/Unpin. */
  pinned?: boolean
  /** When true, the menu should be cleared (overlay reverts to hover mode). */
  hide?: boolean
}

/** payload: MenuPick (overlay → main). An item was chosen. */
export interface MenuPickPayload {
  kind: MenuKind
  targetId: string
  action: string
}

/** payload: FeedbackSubmit (renderer → main). An in-app suggestion or bug report. */
export interface FeedbackPayload {
  type: 'suggestion' | 'bug'
  title: string
  description: string
  /** Optional screenshot as a data URL (data:image/...;base64,...). */
  imageDataUrl?: string
}

/** payload: FileSave (renderer → main). Write generated text to a user-chosen path. */
export interface FileSavePayload {
  /** Suggested file name (with extension) shown in the save dialog. */
  defaultName: string
  /** The file contents to write (UTF-8 text, e.g. a self-contained HTML doc). */
  contents: string
  /** Dialog title (e.g. "Export note"). */
  title?: string
  /** File-type filters for the save dialog. */
  filters?: { name: string; extensions: string[] }[]
}

/** result: FileSave. `path` is set on success; `canceled` when the user dismissed. */
export interface FileSaveResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

/** result of FeedbackSubmit. `queued` = stored locally because the network/token failed. */
export interface FeedbackResult {
  ok: boolean
  number?: number
  url?: string
  queued?: boolean
  error?: string
}

/** Now-playing metadata for the corner mini-player control bar. */
export interface MiniPlayerMeta {
  title: string
  artist: string
  /** Artwork URL from the page's mediaSession metadata (may be absent). */
  artwork?: string
  /** True while playback is paused. */
  paused: boolean
  /** True while the corner video is set to loop. */
  loop?: boolean
  /** Current playback position (seconds), for the progress bar. */
  currentTime?: number
  /** Total media duration (seconds); 0/absent when unknown (e.g. live). */
  duration?: number
  /** True while a YouTube ad is playing — the progress bar turns yellow. */
  adShowing?: boolean
}

/** event: OverlayMiniPlayer (main → the overlay window). */
export interface OverlayMiniPlayerEvent {
  show: boolean
  meta?: MiniPlayerMeta
  /** When true, render the collapsed side-tab (arrow) instead of the full card. */
  collapsed?: boolean
  /** Which screen edge the collapsed tab is docked to (arrow points inward). */
  edge?: 'left' | 'right'
}

/** payload: MiniPlayerControl (overlay → main). A control button / drag event. */
export interface MiniPlayerControlEvent {
  action:
    | 'play'
    | 'pause'
    | 'next'
    | 'prev'
    | 'loop'
    | 'close'
    | 'reload'
    | 'collapse'
    | 'expand'
    | 'seek'
    | 'search'
    | 'move-start'
    | 'move'
    | 'move-end'
  /** Seek target (seconds), for action === 'seek'. */
  time?: number
  /** Search query, for action === 'search' (play another song/video). */
  query?: string
  /** For action === 'move': drag delta (screen px) since 'move-start'. */
  dx?: number
  dy?: number
}

/** event: FocusPanel (main → the MAIN renderer). Expand a panel's deck full-size. */
export interface FocusPanelEvent {
  panelId: PanelId
}

/** event: FolderMenuAction (main → the MAIN renderer). */
export interface FolderMenuActionEvent {
  name: string
  action: 'rename' | 'ungroup' | 'keepalive'
}

/** event: UpdateStatus (main → renderer) — drives the in-app update popup. */
export interface UpdateStatusEvent {
  /**
   * idle: up to date / no update. available: a newer version exists and is being
   * fetched. downloading: in progress (see percent). downloaded: ready to install
   * (show Restart). error: the update check/download failed.
   */
  state: 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'
  /** The new version (when known), e.g. "1.0.14". */
  version?: string
  /** Download progress 0–100 (state === 'downloading'). */
  percent?: number
  /** Human-readable error (state === 'error'). */
  error?: string
}

/** Pylon (Canvas) shapes shared by main + renderer. */
export interface PylonStatusResult {
  connected: boolean
  baseUrl?: string
  name?: string
  error?: string
}
export interface PylonCourse {
  id: number
  name: string
  score: number | null
  grade: string | null
}
export interface PylonAssignment {
  id: string
  title: string
  courseName: string
  dueAt: string | null
  points: number | null
  submitted: boolean
}
export interface PylonData {
  connected: boolean
  name?: string
  courses: PylonCourse[]
  upcoming: PylonAssignment[]
  error?: string
}

/** DevBay (GitHub) shapes shared by main + renderer. */
export interface DevBayStatusResult {
  connected: boolean
  login?: string
  error?: string
}
export interface DevBayRepo {
  name: string
  fullName: string
  private: boolean
  url: string
  description: string | null
  language: string | null
  pushedAt: string
  stars: number
  openIssues: number
  defaultBranch: string
  fork: boolean
}
export interface DevBayData {
  connected: boolean
  login?: string
  repos: DevBayRepo[]
  error?: string
}
export interface DevBayReleaseResult {
  ok: boolean
  url?: string
  error?: string
}

/** Generic Canvas proxy (Pylon): one authenticated call to the student's Canvas.
 *  `path` is a Canvas API path (e.g. `/api/v1/courses/123/assignments?per_page=50`).
 *  Use `form` for Canvas's urlencoded write bodies (submissions/quizzes); `body`
 *  for JSON. */
export interface PylonApiPayload {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  form?: Record<string, string>
}
export interface PylonApiResult {
  ok: boolean
  status: number
  data?: unknown
  /** When the endpoint paginated, the path to the next page (Canvas Link header). */
  nextPath?: string
  error?: string
}

/** Generic GitHub proxy (DevBay): one authenticated call to api.github.com.
 *  `path` is a GitHub API path (e.g. `/repos/owner/name/contents/src`). For raw
 *  file bytes set `raw: true` (returns text via the raw media type). */
export interface DevBayApiPayload {
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  raw?: boolean
}
export interface DevBayApiResult {
  ok: boolean
  status: number
  data?: unknown
  nextPath?: string
  error?: string
}

/** Summit native-UI bridge: one proxied REST call to the Flask backend. */
export interface SummitApiPayload {
  /** API path beginning with /api/… The shell user id is substituted for the
   *  literal `:uid` segment in main (e.g. `/api/profit/:uid`). */
  path: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** JSON body for POST/PUT. */
  body?: unknown
}
export interface SummitApiResult {
  ok: boolean
  status: number
  /** Parsed JSON response (when the backend returned JSON). */
  data?: unknown
  error?: string
}

/** A physical monitor on THIS machine, from Electron's `screen` API — real
 *  virtual-desktop bounds (DIP), scale, and identity. Used by Borderless to draw
 *  the machine's true monitor layout (like Windows Display settings). */
export interface DisplayInfo {
  id: number
  label: string
  /** Virtual-desktop bounds in DIP (the real spatial arrangement). */
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
  internal: boolean
  primary: boolean
  rotation: number
}

/* ── Borderless (software KVM) ─────────────────────────────────────────── */

/** A machine seen on the LAN (discovery) and its pairing/connection state. */
export interface BorderlessPeer {
  id: string
  name: string
  host: string
  port: number
  /** Seen via discovery within the freshness window. */
  online: boolean
  /** An encrypted session is established with this peer. */
  paired: boolean
  connState: 'idle' | 'pairing' | 'connected' | 'error'
  error?: string
}

export interface BorderlessState {
  running: boolean
  machineId: string
  machineName: string
  /** A pairing secret has been set (required to pair). */
  secretSet: boolean
  peers: BorderlessPeer[]
}

/** Live cursor read from the OS — used to sense edge crossings. */
export interface BorderlessCursorEvent {
  x: number
  y: number
  /** Which virtual-desktop edge the cursor is touching, if any. */
  edge: 'left' | 'right' | 'top' | 'bottom' | null
  /** Peer id the cursor would cross to (the edge is assigned to a paired peer). */
  crossingTo: string | null
}

export interface BorderlessConfigPayload {
  machineName?: string
  secret?: string
}
export interface BorderlessResult {
  ok: boolean
  error?: string
}

/** Non-secret JetCore account profile for the bound shell user. The JWT from
 *  jetcore_session is deliberately NOT included — it never leaves main. Used by the
 *  shell to decide app entitlements (e.g. who can use Summit). */
export interface SummitAccountResult {
  ok: boolean
  account?: {
    email?: string
    firstName?: string
    segment?: string
    plan?: string
    isAdmin?: boolean
  }
  error?: string
}

/** Upload an Excel/CSV file to Summit's auto-parsing import endpoints. */
export interface SummitUploadPayload {
  kind: 'sales' | 'tenders'
  filename: string
  /** Raw file bytes (read in the renderer via File.arrayBuffer()). */
  data: ArrayBuffer
}
export interface SummitUploadResult {
  ok: boolean
  /** Rows inserted / skipped (the backend reports these on success). */
  inserted?: number
  skipped?: number
  error?: string
}

/** event: PanelUpdate (main → renderer) */
export interface PanelUpdateEvent {
  panelId: PanelId
  patch: {
    title?: string
    url?: string
    favicon?: string
    loading?: boolean
    canGoBack?: boolean
    canGoForward?: boolean
    badge?: number
    playing?: boolean
  }
}

/** event: PanelDiscardState (main → renderer) */
export interface PanelDiscardStateEvent {
  panelId: PanelId
  /** True = renderer was discarded (free RAM); false = view recreated on return. */
  discarded: boolean
  /** The saved URL to reload on return. Only meaningful when discarded === true. */
  url?: string
}

/** A workspace summary for the floating hover card. */
export interface HoverSummary {
  name: string
  iconUrl: string
  color: string
  deckCount: number
  unread: number
  playing: boolean
  notes?: string
}

/** payload: HoverShow (renderer → main). x/y are window-relative (px). */
export interface HoverShowPayload {
  summary: HoverSummary
  x: number
  y: number
}

/** event: OverlayRender (main → the overlay window). */
export interface OverlayRenderEvent {
  show: boolean
  summary?: HoverSummary
}

/** payload: SettingsApply (renderer → main). */
export interface SettingsApplyPayload {
  /** Discard idle panels after this many minutes (0/undefined = leave unchanged). */
  discardMinutes?: number
}

/** result: MetricsGet (main → renderer) */
export interface MetricsResult {
  /** Summed workingSetSize across all app processes, in MB. */
  ramMB: number
  /** Number of live WebContentsViews (renderer processes for panels). */
  liveRenderers: number
  /** Number of panels currently discarded (renderer freed, URL remembered). */
  discarded: number
}

/** result entry: PanelMetricsGet — one live panel's real memory in MB. */
export interface PanelMetric {
  panelId: PanelId
  /** Resident working set of this panel's renderer process, in MB. */
  mb: number
}

/** result: CodeServerStart — outcome of trying to launch local code-server. */
export interface CodeServerResult {
  /** The loopback URL to load as a web deck, when it started. */
  url?: string
  /** A human-readable error when it didn't (e.g. not installed, cancelled). */
  error?: string
  /** True when the failure was specifically "code-server isn't installed". */
  notInstalled?: boolean
  /** True when the user cancelled the folder picker. */
  cancelled?: boolean
}

/** result: OperationsStart — outcome of trying to launch the JetCore backend. */
export interface OperationsStartResult {
  /** The loopback URL of the live JetCore app, when it started. */
  url?: string
  /** A human-readable error when it didn't (e.g. exe missing, never became ready). */
  error?: string
}

/** payload: OperationsShow — where to position the full-area Operations view. */
export interface OperationsBoundsPayload {
  bounds: PanelBounds
}

/**
 * The full API surface exposed on `window.decks` by the preload.
 * Renderer code depends ONLY on this interface.
 */
export interface DecksApi {
  panel: {
    create(payload: PanelCreatePayload): Promise<void>
    destroy(panelId: PanelId): Promise<void>
    navigate(payload: PanelNavigatePayload): Promise<void>
    reload(panelId: PanelId): Promise<void>
    /** Open a real top-level login window for this deck (Google OAuth fix). */
    signIn(panelId: PanelId): Promise<void>
    goBack(panelId: PanelId): Promise<void>
    goForward(panelId: PanelId): Promise<void>
    setBounds(payload: PanelSetBoundsPayload): Promise<void>
    showOnly(payload: PanelShowOnlyPayload): Promise<void>
    hideAll(): Promise<void>
    /** Pin/unpin a panel as keep-alive (never auto-discarded/evicted). */
    setKeepAlive(panelId: PanelId, keepAlive: boolean): Promise<void>
    /** Pop a web deck out into its own standalone window (drag it out of the app). */
    tearOff(payload: PanelTearOffPayload): Promise<void>
  }
  /**
   * Native deck providers. The renderer never holds tokens or talks to a service
   * directly — it asks main to connect/fetch and gets back sanitized JSON.
   */
  provider: {
    /** Connect (token paste or OAuth). Resolves with the resulting status. */
    connect(payload: ProviderConnectPayload): Promise<ProviderStatus>
    /** Fetch a sanitized resource from a connected provider. */
    fetch(payload: ProviderFetchPayload): Promise<unknown>
    /** Disconnect one connected account (forget its stored credential). */
    disconnect(provider: ProviderId, accountId: string): Promise<void>
    /** Query one account's connection status. */
    status(provider: ProviderId, accountId: string): Promise<ProviderStatus>
    /** List a provider's connected accounts. */
    accounts(provider: ProviderId): Promise<AccountSummary[]>
  }
  codeserver: {
    /** Pick a folder + spawn code-server; resolves a result with the URL. */
    start(): Promise<CodeServerResult>
    /** Stop the running code-server. */
    stop(): Promise<void>
  }
  /**
   * JetCore Operations — the embedded Flask app shown full-area in its own
   * WebContentsView. start() spawns/reuses the backend; show/hide toggle the view
   * over the renderer; stop() kills it. The view runs its own preload that can
   * ask to return to Decks (see onOperationsExit).
   */
  operations: {
    /** Spawn (or reuse) the JetCore backend; resolves a result with the URL. */
    start(): Promise<OperationsStartResult>
    /** Pre-load Summit (backend + hidden webview) so the first open is instant. */
    preload(): Promise<void>
    /** Attach + position the Operations view over the given bounds. */
    show(payload: OperationsBoundsPayload): Promise<void>
    /** Detach/hide the Operations view. */
    hide(): Promise<void>
    /** Kill the backend + destroy the view. */
    stop(): Promise<void>
  }
  /**
   * JetCore account auth. login/signup ensure the Operations backend is running,
   * authenticate against it, then persist the session token (keychain) + the
   * account (decks-state.json). status reads the persisted account WITHOUT
   * spawning the backend; logout clears both.
   */
  auth: {
    login(payload: AuthLoginPayload): Promise<AuthResult>
    signup(payload: AuthSignupPayload): Promise<AuthResult>
    logout(): Promise<AuthResult>
    status(): Promise<AuthResult>
  }
  /**
   * Supabase cloud account + END-TO-END-ENCRYPTED vault. SECURITY BOUNDARY: the
   * Supabase client, tokens, master password, and derived key live ONLY in main.
   * The renderer sends the password (auth + KDF happen in main) and receives only
   * status — plus, on signup ONCE, the recovery key to display.
   */
  cloud: {
    /** Create an account; resolves with the one-time recovery key on success. */
    signUp(payload: CloudAuthPayload): Promise<CloudResult>
    /** Sign in; main derives the key and unlocks the DEK in memory. */
    signIn(payload: CloudAuthPayload): Promise<CloudResult>
    /** Sign out; main clears the session and wipes the in-memory DEK. */
    signOut(): Promise<CloudResult>
    /** Current signed-in / unlocked / configured status (no key derivation). */
    status(): Promise<CloudResult>
    /** Unlock with the recovery key when the password is forgotten. */
    recover(payload: CloudRecoverPayload): Promise<CloudResult>
  }
  /**
   * E2EE vault blobs. The renderer sends/receives ONLY plaintext; encryption with
   * the in-memory DEK and storage of ciphertext happen entirely in main.
   */
  vault: {
    /** Encrypt plaintext with the DEK in main and store it at `key`. */
    set(payload: VaultSetPayload): Promise<void>
    /** Fetch + decrypt the blob at `key`; resolves plaintext or null. */
    get(key: string): Promise<string | null>
  }
  /** Pylon (Canvas). Token lives in the vault (main); the renderer only sees data. */
  pylon: {
    connect(payload: { baseUrl: string; token: string }): Promise<PylonStatusResult>
    status(): Promise<PylonStatusResult>
    fetch(): Promise<PylonData>
    disconnect(): Promise<void>
    /** Generic authenticated Canvas proxy — read/submit anything (token in main). */
    api(payload: PylonApiPayload): Promise<PylonApiResult>
  }
  /** DevBay (GitHub). Token lives in the vault (main); renderer sees only data. */
  devbay: {
    connect(token: string): Promise<DevBayStatusResult>
    status(): Promise<DevBayStatusResult>
    fetch(): Promise<DevBayData>
    disconnect(): Promise<void>
    draftRelease(payload: { fullName: string; tag: string; name: string; body: string }): Promise<DevBayReleaseResult>
    /** Generic authenticated GitHub proxy — browse repo contents / read files. */
    api(payload: DevBayApiPayload): Promise<DevBayApiResult>
    /** Hide the always-on-top overlay window. */
    overlayHide(): void
    /** Subscribe to "overlay shown" (overlay renderer only). Returns unsubscribe. */
    onOverlayShown(cb: () => void): () => void
  }
  /** Summit (native UI): proxy REST calls to the spawned Flask backend via main
   *  (no CORS; the session JWT stays in the main process). */
  summit: {
    api(payload: SummitApiPayload): Promise<SummitApiResult>
    /** Upload an Excel/CSV file to a Summit import endpoint (auto-parsed). */
    upload(payload: SummitUploadPayload): Promise<SummitUploadResult>
    /** Non-secret account profile (segment/plan/is_admin) for app entitlements. */
    account(): Promise<SummitAccountResult>
  }
  /** This machine's real monitors (Borderless layout). */
  displays(): Promise<DisplayInfo[]>
  /** Current OS cursor position in virtual-desktop coords (always available, for the live layout marker). */
  cursorPoint(): Promise<{ x: number; y: number }>
  /** Borderless — software KVM: discovery, encrypted pairing, cursor-edge sensing. */
  borderless: {
    start(cfg: BorderlessConfigPayload): Promise<BorderlessState>
    stop(): Promise<BorderlessState>
    state(): Promise<BorderlessState>
    setConfig(cfg: BorderlessConfigPayload): Promise<BorderlessState>
    pair(peerId: string): Promise<BorderlessResult>
    unpair(peerId: string): Promise<BorderlessResult>
    /** Subscribe to live state (peers/pairing). Returns an unsubscribe fn. */
    onState(cb: (s: BorderlessState) => void): () => void
    /** Subscribe to live cursor/edge sensing. Returns an unsubscribe fn. */
    onCursor(cb: (e: BorderlessCursorEvent) => void): () => void
  }
  /** Auto-update: subscribe to the updater lifecycle + trigger the install. */
  update: {
    /** Subscribe to update lifecycle events. Returns an unsubscribe fn. */
    onStatus(cb: (e: UpdateStatusEvent) => void): () => void
    /** Quit and install the already-downloaded update. */
    restart(): void
  }
  state: {
    load(): Promise<PersistedState | null>
    save(state: PersistedState): Promise<void>
  }
  feedback: {
    /** File an in-app suggestion/bug as a GitHub issue (or queue it offline). */
    submit(payload: FeedbackPayload): Promise<FeedbackResult>
  }
  file: {
    /** Show a native save dialog and write the given text to the chosen path. */
    save(payload: FileSavePayload): Promise<FileSaveResult>
  }
  metrics: {
    /** Total RAM + live/discarded panel counts for the sidebar readout. */
    get(): Promise<MetricsResult>
    /** Real per-panel memory (MB) for each live web deck, keyed by panelId. */
    panels(): Promise<PanelMetric[]>
  }
  window: {
    minimize(): void
    maximize(): void
    close(): void
  }
  menu: {
    /** Ask main to float the custom context menu in the overlay at the cursor. */
    show(payload: MenuShowPayload): void
    /** Report (from the overlay) that a menu item was chosen. */
    pick(payload: MenuPickPayload): void
    /** Report (from the overlay) that the menu was dismissed (clicked outside). */
    dismiss(): void
  }
  hover: {
    /** Show the always-on-top floating hover card (over live web pages). */
    show(payload: HoverShowPayload): void
    /** Hide the floating hover card. */
    hide(): void
  }
  miniPlayer: {
    /** (Overlay window only) report a mini-player control button press. */
    control(e: MiniPlayerControlEvent): void
  }
  settings: {
    /** Apply settings that affect the main process (discard timeout, …). */
    apply(payload: SettingsApplyPayload): void
  }
  /** Subscribe to live panel updates. Returns an unsubscribe fn. */
  onPanelUpdate(cb: (e: PanelUpdateEvent) => void): () => void
  /** Subscribe to workspace-menu choices. Returns an unsubscribe fn. */
  onWorkspaceMenuAction(cb: (e: WorkspaceMenuActionEvent) => void): () => void
  /** Subscribe to folder-menu choices. Returns an unsubscribe fn. */
  onFolderMenuAction(cb: (e: FolderMenuActionEvent) => void): () => void
  /** Subscribe to discard/recreate state changes. Returns an unsubscribe fn. */
  onPanelDiscardState(cb: (e: PanelDiscardStateEvent) => void): () => void
  /** (Overlay window only) subscribe to hover-card render events. */
  onOverlayRender(cb: (e: OverlayRenderEvent) => void): () => void
  /** (Overlay window only) subscribe to custom context-menu render events. */
  onOverlayMenu(cb: (e: OverlayMenuEvent) => void): () => void
  /** (Overlay window only) subscribe to mini-player render events. */
  onMiniPlayer(cb: (e: OverlayMiniPlayerEvent) => void): () => void
  /** (Overlay window only) subscribe to live mini-player audio levels (0..1[]). */
  onMiniLevels(cb: (levels: number[]) => void): () => void
  /** (Main renderer only) subscribe to focus-panel requests. */
  onFocusPanel(cb: (e: FocusPanelEvent) => void): () => void
  /**
   * (Main renderer only) subscribe to "return to Decks" requests fired from the
   * Operations view (the JetCore page's shell bridge). Returns an unsubscribe fn.
   */
  onOperationsExit(cb: () => void): () => void
}
