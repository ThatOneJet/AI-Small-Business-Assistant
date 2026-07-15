/**
 * Decks — renderer state (zustand).
 *
 * Holds the workspace list, which workspace is active, the current "view"
 * (home vs a workspace's split panels), theme, and Cmd+K palette state.
 *
 * IMPORTANT: this store is UI state only. It never talks to the main process
 * directly — components call `window.decks` (the IPC contract) for side effects
 * (creating/positioning WebContentsViews, persistence) and then update this
 * store to reflect the result. Phase 2 wires the two together.
 */
import { create } from 'zustand'
import type {
  Workspace,
  WorkspaceId,
  PanelId,
  Panel,
  LayoutNode,
  Theme,
  JetCoreAccount
} from '@shared/types'
import { addLeaf, removeLeaf } from './lib/layout'
import { seedWorkspaces } from '@shared/seed'
import { JETCORE_ACCENT, type AppId } from './apps/registry'

/** The active JetCore app, remembered across launches (per machine). */
const ACTIVE_APP_KEY = 'jetcore.activeApp'
function readActiveApp(): AppId {
  try {
    const v = localStorage.getItem(ACTIVE_APP_KEY)
    if (v === 'hangar' || v === 'devbay' || v === 'summit' || v === 'pylon') return v
  } catch {
    /* ignore */
  }
  return 'hangar'
}
function writeActiveApp(id: AppId): void {
  try {
    localStorage.setItem(ACTIVE_APP_KEY, id)
  } catch {
    /* ignore */
  }
}

const deckCount = (n: number): string => `${n} deck${n === 1 ? '' : 's'}`

/** First-run guided tour: a "seen" flag persisted in localStorage. */
const TOUR_KEY = 'decks.tourSeen'
/** True if the guided tour hasn't been completed/skipped yet. */
export function tourUnseen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) !== '1'
  } catch {
    return false
  }
}
function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, '1')
  } catch {
    /* ignore */
  }
}
const EMPTY_LAYOUT: LayoutNode = { type: 'leaf', panelId: '' }
const isEmptyLayout = (l: LayoutNode): boolean => l.type === 'leaf' && l.panelId === ''

/** Which surface the content region is showing.
 *  Logged-out: `marketing` (homepage) / `pricing` / `login`. Post-signup:
 *  `intent` (the "what will you use JetCore for" step). Signed-in: `app` (the
 *  active native app), `operations` (Summit's WebContentsView), `settings`.
 *  `home`/`workspace` are the retired Decks surfaces (kept until file removal). */
export type View =
  | 'marketing'
  | 'pricing'
  | 'login'
  | 'intent'
  | 'home'
  | 'workspace'
  | 'settings'
  | 'operations'
  | 'app'

/** App-level settings (persisted). Minimal and typed. */
export interface Settings {
  /** Discard idle panels after this many minutes (1–60). */
  discardMinutes: number
  /** Accent color hex, applied live via the --accent CSS variable. */
  accent: string
}

export const DEFAULT_SETTINGS: Settings = { discardMinutes: 8, accent: JETCORE_ACCENT }

export interface DecksState {
  // ── data ──
  workspaces: Workspace[]
  activeWorkspaceId: WorkspaceId | null
  view: View
  /** The active JetCore app (drives the content area + the lightning switcher). */
  activeApp: AppId
  /** Which auth tab LoginShell opens on (set from the homepage CTAs). */
  loginMode: 'login' | 'signup'
  /** True while the lightning app-switcher dropdown is open. In Summit this hides
   *  the native Operations WebContentsView so the DOM dropdown isn't covered. */
  switcherOpen: boolean
  theme: Theme
  settings: Settings
  /**
   * The signed-in JetCore account (non-secret fields). Undefined when logged out.
   * The session JWT is NOT here — it lives in the OS keychain (main process).
   */
  account?: JetCoreAccount
  /**
   * The signed-in Supabase user id (cloud.status().userId), cached once on boot.
   * Used ONLY to PREFIX newly-created web/native session partitions so they can
   * never collide across accounts on the same machine even if a workspace id
   * repeats. Undefined when logged out / no cloud account. Cleared on logout.
   */
  accountId?: string
  /** True when the signed-in email is an admin (shared admin list; admin in both
   *  apps). Set from cloud.status().isAdmin on unlock; cleared on logout. */
  isAdmin?: boolean
  /**
   * Build the session partition for a workspace. When an account is signed in we
   * scope it as `persist:<accountId>:<workspaceId>` (bulletproof isolation); with
   * no account we keep the legacy `persist:<workspaceId>`. Only used for NEW
   * partitions — existing workspaces keep their stored `partition` string.
   */
  makePartition: (workspaceId: WorkspaceId) => string

  // ── overlays ──
  paletteOpen: boolean
  addDeckOpen: boolean
  /** In-app feedback (suggestion/bug) modal. */
  feedbackOpen: boolean
  /** Focus mode — collapse the sidebar and focus the active deck. */
  focusMode: boolean
  /** User-toggled sidebar collapse (the topbar button). Narrow screens also force it. */
  sidebarCollapsed: boolean
  /** True while a rail tile is being dragged (exposes the page as a drop target). */
  dragging: boolean
  /** The workspace id currently being dragged (for same-section reorder hints). */
  draggingId: WorkspaceId | null

  // ── derived helpers ──
  activeWorkspace: () => Workspace | undefined
  panelById: (id: PanelId) => Panel | undefined

  // ── actions: workspaces ──
  setWorkspaces: (ws: Workspace[]) => void
  addWorkspace: (ws: Workspace) => void
  removeWorkspace: (id: WorkspaceId) => void
  activateWorkspace: (id: WorkspaceId) => void
  goHome: () => void
  /** Open the dedicated settings surface. */
  openSettings: () => void
  /** Switch the top-level surface directly. */
  setView: (view: View) => void
  /** Open the login gate on a specific tab (from the homepage CTAs). */
  gotoLogin: (mode: 'login' | 'signup') => void
  /** Set whether the app-switcher dropdown is open. */
  setSwitcherOpen: (open: boolean) => void
  /** Switch the active JetCore app (lightning switcher). Native apps render in the
   *  content area; Summit opens its Operations WebContentsView. */
  setActiveApp: (id: AppId) => void
  /** Set the signed-in JetCore account (after a successful login/signup). */
  setAccount: (account: JetCoreAccount) => void
  /** Cache the Supabase user id used to scope new partitions (or clear it). */
  setAccountId: (accountId: string | undefined) => void
  /**
   * True once the per-account state has been hydrated from disk this session.
   * Gates the debounced save in App so we never persist over a not-yet-loaded
   * account, and lets the login flow trigger hydration exactly once after unlock.
   */
  bootHydrated: boolean
  /**
   * Hydrate the PER-ACCOUNT persisted state after the vault is unlocked: cache
   * the Supabase user id (for partition scoping), load decks-state-<userId>.json
   * (seed if empty), apply theme/settings/account, and restore the last active
   * workspace. Idempotent — safe to call from both app-boot and the login screen.
   * Returns the active view to show ('workspace' or 'home').
   */
  hydrateAfterUnlock: () => Promise<View>
  /** Sign out: clear the account in main + here, and show the login gate. */
  logout: () => Promise<void>
  /** Show the native JetCore Operations app full-area. */
  openOperations: () => void
  /** Which Console slide-over panel is open (memory / help / none). */
  consolePanel: 'none' | 'help' | 'memory'
  openHelp: () => void
  openMemory: () => void
  closeConsolePanel: () => void
  /** First-run guided tour open-state (persisted "seen" flag in localStorage). */
  tourOpen: boolean
  /** Start the guided tour (replayable from Help / Settings). */
  openTour: () => void
  /** Close the tour and persist that it has been seen. */
  closeTour: () => void
  updateWorkspaceLive: (id: WorkspaceId, live: Partial<Workspace['live']>) => void
  renameWorkspace: (id: WorkspaceId, name: string) => void
  setNotes: (id: WorkspaceId, notes: string) => void
  setGroup: (id: WorkspaceId, group: string | undefined) => void
  /** Pin/unpin a workspace as keep-alive (its decks never auto-discard). */
  setKeepAlive: (id: WorkspaceId, on: boolean) => void
  /** Pin/unpin a workspace to the top of its dock section (sort only). */
  setPinned: (id: WorkspaceId, on: boolean) => void
  /**
   * Move `draggedId` to immediately BEFORE `targetId` in the workspaces array,
   * but ONLY when both are in the same dock section: same `group`, OR both
   * ungrouped AND the same kind (native vs web). Otherwise no-op.
   */
  reorderWorkspace: (draggedId: WorkspaceId, targetId: WorkspaceId) => void
  /** Rename a folder: move every workspace from `oldName` to `newName`. */
  renameGroup: (oldName: string, newName: string) => void
  /** Next default folder name: "Group N" where N = distinct group count + 1. */
  nextGroupName: () => string
  /** Replace a workspace's decks+layout (e.g. from a reset template). */
  setDecks: (id: WorkspaceId, panels: Panel[], layout: LayoutNode) => void

  // ── actions: panels ──
  addPanel: (workspaceId: WorkspaceId, panel: Panel) => void
  removePanel: (workspaceId: WorkspaceId, panelId: PanelId) => void
  /** Move a panel out of a split into its own new workspace (rail tile). */
  popPanelOut: (workspaceId: WorkspaceId, panelId: PanelId) => void
  /** Per-panel reload counter — bump to remount a native deck (force refresh). */
  panelReloadNonce: Record<PanelId, number>
  bumpPanelReload: (panelId: PanelId) => void
  /** Cross-deck request: open a specific Canvas assignment (set by the Calendar
   *  deck when a classwork item is clicked; consumed + cleared by CanvasDeck). */
  pendingCanvasAction: { courseId: string; assignmentId: string } | null
  requestCanvasAssignment: (courseId: string, assignmentId: string) => void
  clearCanvasAction: () => void
  patchPanel: (panelId: PanelId, patch: Partial<Panel>) => void
  setLayout: (workspaceId: WorkspaceId, layout: LayoutNode) => void

  // ── actions: ui ──
  setTheme: (t: Theme) => void
  /** Merge a partial settings patch. */
  setSettings: (patch: Partial<Settings>) => void
  openPalette: () => void
  closePalette: () => void
  togglePalette: () => void
  openAddDeck: () => void
  closeAddDeck: () => void
  openFeedback: () => void
  closeFeedback: () => void
  toggleFocusMode: () => void
  toggleSidebar: () => void
  /** Set the rail-drag flag. */
  setDragging: (dragging: boolean) => void
  /** Set the id of the workspace currently being dragged (or null). */
  setDraggingId: (id: WorkspaceId | null) => void
}

export const useStore = create<DecksState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: null,
  view: 'home',
  activeApp: readActiveApp(),
  loginMode: 'login',
  switcherOpen: false,
  theme: 'dark',
  settings: { ...DEFAULT_SETTINGS },
  paletteOpen: false,
  addDeckOpen: false,
  feedbackOpen: false,
  focusMode: false,
  // Start collapsed (icon rail) to match JetCore's compact rail for the merge.
  sidebarCollapsed: true,
  dragging: false,
  draggingId: null,
  bootHydrated: false,
  panelReloadNonce: {},
  pendingCanvasAction: null,

  activeWorkspace: () => {
    const { workspaces, activeWorkspaceId } = get()
    return workspaces.find((w) => w.id === activeWorkspaceId)
  },
  panelById: (id) => {
    for (const w of get().workspaces) {
      const p = w.panels.find((p) => p.id === id)
      if (p) return p
    }
    return undefined
  },
  makePartition: (workspaceId) => {
    const acct = get().accountId
    return acct ? `persist:${acct}:${workspaceId}` : `persist:${workspaceId}`
  },

  setWorkspaces: (workspaces) => set({ workspaces }),
  addWorkspace: (ws) => set((s) => ({ workspaces: [...s.workspaces, ws] })),
  removeWorkspace: (id) =>
    set((s) => {
      const workspaces = s.workspaces.filter((w) => w.id !== id)
      const stillActive = s.activeWorkspaceId === id ? null : s.activeWorkspaceId
      return {
        workspaces,
        activeWorkspaceId: stillActive,
        view: stillActive ? s.view : 'home'
      }
    }),
  activateWorkspace: (id) => set({ activeWorkspaceId: id, view: 'workspace' }),
  goHome: () => set({ view: 'home' }),
  openSettings: () => set({ view: 'settings' }),
  setView: (view) => set({ view }),
  gotoLogin: (mode) => set({ loginMode: mode, view: 'login' }),
  setSwitcherOpen: (open) => set({ switcherOpen: open }),
  setActiveApp: (id) => {
    writeActiveApp(id)
    if (id === 'summit') {
      // Summit = the embedded Operations backend (WebContentsView overlay).
      set({ activeApp: id })
      get().openOperations()
    } else {
      set({ activeApp: id, view: 'app' })
    }
  },
  setAccount: (account) => set({ account }),
  setAccountId: (accountId) => set({ accountId }),
  hydrateAfterUnlock: async () => {
    // Read the Supabase user id and cache it for partition scoping (item 3). It
    // must be set BEFORE state.load() conceptually — but main resolves the file
    // from getCloudAccount() (already set once unlocked), so order is safe here.
    const cloud = await window.decks?.cloud?.status().catch(() => null)
    if (cloud?.userId) set({ accountId: cloud.userId })
    // Admin status (detected from the signed-in email against the shared admin
    // list, in main) — so Decks UI can gate admin-only features.
    set({ isAdmin: !!cloud?.isAdmin })

    // Vault is unlocked → state.load() resolves decks-state-<userId>.json.
    const persisted = await window.decks?.state.load().catch(() => null)
    // Seed only when this account's file is empty. Seed workspaces use FIXED ids
    // (e.g. "youtube") so their default partition string is identical across
    // accounts — re-scope freshly-seeded partitions with makePartition so two
    // accounts' seeded decks never share a web session. Persisted workspaces keep
    // their stored partition (already per-account via their own state file).
    const ws =
      persisted && persisted.workspaces.length
        ? persisted.workspaces
        : seedWorkspaces().map((w) => ({ ...w, partition: get().makePartition(w.id) }))
    set({ workspaces: ws })
    if (persisted?.theme) get().setTheme(persisted.theme)
    if (persisted?.settings) get().setSettings(persisted.settings)
    const applied = get().settings
    document.documentElement.style.setProperty('--accent', applied.accent)
    window.decks?.settings.apply({ discardMinutes: applied.discardMinutes })
    if (persisted?.account) set({ account: persisted.account })
    set({ bootHydrated: true })

    // Pre-load Summit in the background (spawn the backend AND load the webview,
    // hidden, while the user is in Hangar) so the first switch to Summit just
    // reveals an already-loaded view — instant, like the native apps.
    void window.decks?.operations?.preload().catch(() => {})

    // Remember the legacy Decks active workspace (harmless), but LAND in the
    // active JetCore app — the shell is app-first now (Hangar by default).
    if (
      persisted?.activeWorkspaceId &&
      ws.some((w) => w.id === persisted.activeWorkspaceId)
    ) {
      set({ activeWorkspaceId: persisted.activeWorkspaceId })
    }
    const app = get().activeApp
    if (app === 'summit') {
      set({ view: 'operations' })
      return 'operations'
    }
    set({ view: 'app' })
    return 'app'
  },
  logout: async () => {
    // Sign out BOTH the Supabase cloud account (primary; wipes the in-memory DEK
    // in main) and the legacy Operations account, then show the login gate.
    await window.decks?.cloud?.signOut().catch(() => {})
    await window.decks?.auth.logout().catch(() => {})
    // Clear the cached account id AND the in-memory workspaces so the next
    // account's per-user state is loaded fresh on the next unlock (and no
    // partitions are derived under the previous account).
    set({ account: undefined, accountId: undefined, isAdmin: false, workspaces: [], view: 'login', activeWorkspaceId: null })
  },
  openOperations: () => {
    writeActiveApp('summit')
    set({ view: 'operations', activeApp: 'summit' })
  },
  consolePanel: 'none',
  openHelp: () => set({ consolePanel: 'help' }),
  openMemory: () => set({ consolePanel: 'memory' }),
  closeConsolePanel: () => set({ consolePanel: 'none' }),
  tourOpen: false,
  // Open the tour (and clear any slide-over so the spotlight isn't obscured).
  openTour: () => set({ tourOpen: true, consolePanel: 'none' }),
  closeTour: () => {
    markTourSeen()
    set({ tourOpen: false })
  },
  updateWorkspaceLive: (id, live) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === id ? { ...w, live: { ...w.live, ...live } } : w
      )
    })),
  renameWorkspace: (id, name) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w))
    })),
  setNotes: (id, notes) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, notes } : w))
    })),
  setGroup: (id, group) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, group } : w))
    })),
  setKeepAlive: (id, on) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, keepAlive: on } : w))
    })),
  setPinned: (id, on) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, pinned: on } : w))
    })),
  reorderWorkspace: (draggedId, targetId) =>
    set((s) => {
      if (draggedId === targetId) return {}
      const dragged = s.workspaces.find((w) => w.id === draggedId)
      const target = s.workspaces.find((w) => w.id === targetId)
      if (!dragged || !target) return {}
      // Same-section guard: same group, OR both ungrouped AND same kind.
      const isNative = (w: Workspace): boolean => w.panels[0]?.kind === 'native'
      const sameSection =
        dragged.group || target.group
          ? dragged.group === target.group
          : isNative(dragged) === isNative(target)
      if (!sameSection) return {}
      const rest = s.workspaces.filter((w) => w.id !== draggedId)
      const at = rest.findIndex((w) => w.id === targetId)
      if (at < 0) return {}
      const workspaces = [...rest.slice(0, at), dragged, ...rest.slice(at)]
      return { workspaces }
    }),
  renameGroup: (oldName, newName) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.group === oldName ? { ...w, group: newName } : w
      )
    })),
  nextGroupName: () => {
    const groups = new Set<string>()
    for (const w of get().workspaces) if (w.group) groups.add(w.group)
    return `Group ${groups.size + 1}`
  },
  setDecks: (id, panels, layout) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === id ? { ...w, panels, layout, subtitle: deckCount(panels.length) } : w
      )
    })),

  // Add a deck: append it and graft a leaf into the split layout.
  addPanel: (workspaceId, panel) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        const panels = [...w.panels, panel]
        const layout = isEmptyLayout(w.layout)
          ? { type: 'leaf' as const, panelId: panel.id }
          : addLeaf(w.layout, panel.id, 'row')
        return { ...w, panels, layout, subtitle: deckCount(panels.length) }
      })
    })),
  // Delete a deck: drop it and prune its leaf from the layout (collapsing splits).
  removePanel: (workspaceId, panelId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== workspaceId) return w
        const panels = w.panels.filter((p) => p.id !== panelId)
        const layout = removeLeaf(w.layout, panelId) ?? EMPTY_LAYOUT
        return { ...w, panels, layout, subtitle: deckCount(panels.length) }
      })
    })),
  // Pull a panel out of a split into its OWN new workspace (rail tile), so a
  // split-screened deck can become a standalone deck. No-op if it's already the
  // workspace's only deck. The panel keeps its id (and thus its existing view),
  // so a web deck's session/login is preserved.
  popPanelOut: (workspaceId, panelId) =>
    set((s) => {
      const from = s.workspaces.find((w) => w.id === workspaceId)
      const panel = from?.panels.find((p) => p.id === panelId)
      if (!from || !panel || from.panels.length <= 1) return {}
      const remaining = from.panels.filter((p) => p.id !== panelId)
      const prunedLayout = removeLeaf(from.layout, panelId) ?? EMPTY_LAYOUT
      const id = `ws_${crypto.randomUUID().slice(0, 8)}`
      const newWs: Workspace = {
        id,
        name: panel.title || 'Deck',
        subtitle: '1 deck',
        color: from.color,
        glyph: from.glyph,
        // Native decks have no view/session; web decks keep the source partition
        // so the moved view's login carries over. New (native) partitions are
        // account-scoped via makePartition so they can't collide across accounts.
        partition: panel.kind === 'native' ? get().makePartition(id) : from.partition,
        live: { status: 'idle' },
        panels: [panel],
        layout: { type: 'leaf', panelId }
      }
      return {
        workspaces: [
          ...s.workspaces.map((w) =>
            w.id === workspaceId
              ? { ...w, panels: remaining, layout: prunedLayout, subtitle: deckCount(remaining.length) }
              : w
          ),
          newWs
        ],
        activeWorkspaceId: id,
        view: 'workspace'
      }
    }),
  bumpPanelReload: (panelId) =>
    set((s) => ({
      panelReloadNonce: { ...s.panelReloadNonce, [panelId]: (s.panelReloadNonce[panelId] ?? 0) + 1 }
    })),
  requestCanvasAssignment: (courseId, assignmentId) =>
    set({ pendingCanvasAction: { courseId, assignmentId } }),
  clearCanvasAction: () => set({ pendingCanvasAction: null }),
  patchPanel: (panelId, patch) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => ({
        ...w,
        panels: w.panels.map((p) => (p.id === panelId ? { ...p, ...patch } : p))
      }))
    })),
  setLayout: (workspaceId, layout) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === workspaceId ? { ...w, layout } : w
      )
    })),

  setTheme: (theme) => set({ theme }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  openAddDeck: () => set({ addDeckOpen: true }),
  closeAddDeck: () => set({ addDeckOpen: false }),
  openFeedback: () => set({ feedbackOpen: true }),
  closeFeedback: () => set({ feedbackOpen: false }),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setDragging: (dragging) => set({ dragging }),
  setDraggingId: (id) => set({ draggingId: id })
}))
