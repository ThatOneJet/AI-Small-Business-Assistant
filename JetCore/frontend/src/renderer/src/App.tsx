/**
 * Decks — app shell + Phase 2 integration seam.
 *
 * Lays out the four surfaces (Sidebar / Home / SplitView / CommandPalette) and
 * wires them to the main process through window.decks (the IPC contract):
 *   1. bootstrap   — hydrate persisted state, else seed; restore last workspace.
 *   2. ensure-create — every panel of the active workspace exists as a native
 *      WebContentsView before SplitView positions it via showOnly.
 *   3. live updates — onPanelUpdate → store.patchPanel (title/favicon/loading/nav).
 *   4. persistence — debounced save of the full PersistedState on any change.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store'
import Titlebar from './components/Titlebar'
import AppRail from './apps/AppRail'
import { JETCORE_ACCENT } from './apps/registry'
import Homepage from './apps/marketing/Homepage'
import Pricing from './apps/marketing/Pricing'
import IntentForm from './apps/marketing/IntentForm'
import OperationsView from './components/OperationsView'
import LoginShell from './components/LoginShell'
import SettingsDeck from './components/Settings/SettingsDeck'
import CommandPalette from './components/CommandPalette'
import FeedbackModal from './components/FeedbackModal'
import Tour from './components/Tour'
import UpdateOverlay from './components/UpdateOverlay'
import NativeAppHost from './apps/NativeAppHost'
import { Welcome, HelpPanel, MemoryPanel, welcomeUnseen } from './components/ConsolePanels'
import { tourUnseen } from './store'
import type { PersistedState } from '@shared/types'

const STATE_VERSION = 1

/** Vault key under which the persisted Decks state is E2EE-synced (the demo). */
const VAULT_STATE_KEY = 'decks.state'

/**
 * Pull the cloud-synced Decks state (decrypted in main) and merge its
 * workspaces/settings into the store. This is the additive demonstration that a
 * blob written on one login is decryptable after sign-out / sign-in on the same
 * (or another) device. Local persistence stays primary; this only fills in when
 * the local snapshot was empty or to reconcile after a fresh sign-in. Best-effort.
 */
async function hydrateFromVault(): Promise<void> {
  try {
    const plaintext = await window.decks?.vault?.get(VAULT_STATE_KEY)
    if (!plaintext) return
    const remote = JSON.parse(plaintext) as PersistedState
    if (!remote || !Array.isArray(remote.workspaces)) return
    const store = useStore.getState()
    // Only adopt remote workspaces when we have none locally (avoid clobbering a
    // live local session); settings are merged regardless.
    if (store.workspaces.length === 0 && remote.workspaces.length) {
      store.setWorkspaces(remote.workspaces)
    }
    if (remote.settings) store.setSettings(remote.settings)
    if (remote.theme) store.setTheme(remote.theme)
  } catch {
    /* offline / locked / no blob — local state remains authoritative */
  }
}

function App(): JSX.Element {
  const view = useStore((s) => s.view)
  const workspaces = useStore((s) => s.workspaces)
  const theme = useStore((s) => s.theme)
  const settings = useStore((s) => s.settings)
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId)
  const account = useStore((s) => s.account)
  const activateWorkspace = useStore((s) => s.activateWorkspace)
  const patchPanel = useStore((s) => s.patchPanel)
  const togglePalette = useStore((s) => s.togglePalette)
  const closePalette = useStore((s) => s.closePalette)
  const paletteOpen = useStore((s) => s.paletteOpen)
  const openAddDeck = useStore((s) => s.openAddDeck)
  const feedbackOpen = useStore((s) => s.feedbackOpen)
  const closeFeedback = useStore((s) => s.closeFeedback)
  const closeAddDeck = useStore((s) => s.closeAddDeck)
  const focusMode = useStore((s) => s.focusMode)
  const toggleFocusMode = useStore((s) => s.toggleFocusMode)
  const goHome = useStore((s) => s.goHome)
  const setView = useStore((s) => s.setView)
  const openPalette = useStore((s) => s.openPalette)
  const consolePanel = useStore((s) => s.consolePanel)
  const openHelp = useStore((s) => s.openHelp)
  const openMemory = useStore((s) => s.openMemory)
  const closeConsolePanel = useStore((s) => s.closeConsolePanel)
  const openTour = useStore((s) => s.openTour)
  const [welcomeOpen, setWelcomeOpen] = useState(() => welcomeUnseen())

  // ── Console dock: collapse to a slim rail (⌘/Ctrl+B or the topbar button), and
  // AUTO-collapse on narrow screens so small laptops feel as roomy as big ones. ──
  const dockCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1080
  )
  useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth < 1080)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const collapsed = dockCollapsed || narrow

  // Per-account hydration gate (set by store.hydrateAfterUnlock). Gates the
  // debounced save + keep-alive/settings push so we never persist or act on a
  // not-yet-loaded account. Re-renders these effects when hydration completes.
  const bootHydrated = useStore((s) => s.bootHydrated)
  const createdPanels = useRef<Set<string>>(new Set())

  // ── Responsive shape: portrait windows turn the rail into a bottom dock. ──
  const [portrait, setPortrait] = useState(
    () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth
  )
  useEffect(() => {
    const onResize = (): void => setPortrait(window.innerHeight > window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // When the rail moves (vertical rail ⇄ bottom dock), the page area changes
  // size, so re-measure the deck views on the next frame.
  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 0)
    return () => clearTimeout(id)
  }, [portrait])

  // ── 1. Bootstrap: cloud gate FIRST, then (only when unlocked) hydrate the
  // PER-ACCOUNT persisted state, else seed; restore last workspace. ──
  //
  // ORDER MATTERS: persistence in main is keyed by the signed-in Supabase user
  // (decks-state-<userId>.json). That user is only known to main AFTER the vault
  // is unlocked, so we must check cloud.status() BEFORE calling state.load() —
  // otherwise we'd read the legacy/wrong file. When the vault is locked or there
  // is no account, we do NOT load workspaces at all; we just show the login gate
  // (LoginShell). This effect runs ONCE at boot; after the user signs in,
  // LoginShell.proceed() calls store.hydrateAfterUnlock() to load that account.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const store = useStore.getState()
      // ── Cloud account gate (Supabase + E2EE) ──
      // The DEK is NEVER persisted, so a restored session is still LOCKED until
      // the user re-enters their password in LoginShell. Only an unlocked vault
      // loads the (now correctly-scoped) per-account state; otherwise show login.
      const cloud = await window.decks?.cloud?.status().catch(() => null)
      if (cancelled) return
      if (!cloud?.unlocked) {
        // Locked / no account: load NOTHING (so we never read another account's
        // file). A RESTORED-but-locked session goes straight to the password gate;
        // a brand-new / signed-out visitor sees the marketing homepage first.
        store.setView(cloud?.signedIn ? 'login' : 'marketing')
        return
      }

      // Unlocked at boot (session restored AND vault already open): hydrate the
      // per-account state from disk and land on the restored surface.
      const next = await store.hydrateAfterUnlock()
      if (cancelled) return
      store.setView(next)
      // Demonstration round-trip: pull the cloud-synced Decks state and merge
      // its workspaces/settings if present (decrypted in main from the vault).
      void hydrateFromVault()
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── Apply the active theme to <html> so the [data-theme="light"] token set in
  // index.css actually flips. (Dark is the default — no attribute.) ──
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
  }, [theme])


  // Unified JetCore accent: force red everywhere (the trademark), regardless of
  // any older persisted per-user accent. (Re-enable settings.accent here if/when
  // per-user accent customization comes back.)
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', JETCORE_ACCENT)
  }, [settings.accent])

  // ── First-run: auto-start the guided tour once (persisted "seen" flag). ──
  // Slightly delayed so the shell has painted and targets can be measured.
  useEffect(() => {
    if (!tourUnseen()) return
    const id = setTimeout(() => {
      // Don't pop the tour over the login gate — wait until the user is in.
      if (useStore.getState().view === 'login') return
      useStore.getState().openTour()
    }, 700)
    return () => clearTimeout(id)
  }, [view])

  // ── 2. Ensure every panel of the active workspace exists as a native view. ──
  // SplitView reports slot rects via showOnly; the view must exist first.
  // LAZY: views are created only when a workspace is active — nothing at boot,
  // and never for inactive workspaces. Discarded panels are intentionally NOT
  // recreated here; main recreates them automatically when SplitView's showOnly
  // references them, so they stay freed until actually shown.
  useEffect(() => {
    if (view !== 'workspace' || !activeWorkspaceId) return
    const ws = workspaces.find((w) => w.id === activeWorkspaceId)
    if (!ws) return
    for (const panel of ws.panels) {
      // Native decks have NO WebContentsView in main — they render entirely in the
      // renderer (NativeDeckHost). Never call panel.create for them.
      if (panel.kind === 'native') continue
      if (panel.discarded) continue
      if (createdPanels.current.has(panel.id)) continue
      createdPanels.current.add(panel.id)
      window.decks?.panel
        .create({
          panelId: panel.id,
          workspaceId: ws.id,
          partition: ws.partition,
          url: panel.url,
          bounds: { x: 0, y: 0, width: 800, height: 600 }
        })
        .catch(() => createdPanels.current.delete(panel.id))
    }
  }, [view, activeWorkspaceId, workspaces])

  // ── 2b. Keep-alive: push pin state to main for every web panel, and eagerly
  // create pinned decks so they render + stay loaded even when not active. ──
  const keepAliveKey = useMemo(
    () =>
      workspaces
        .map((w) => `${w.id}:${w.keepAlive ? 1 : 0}:${w.panels.map((p) => p.id).join(',')}`)
        .join('|'),
    [workspaces]
  )
  useEffect(() => {
    if (!bootHydrated) return
    for (const ws of useStore.getState().workspaces) {
      const pinned = !!ws.keepAlive
      for (const p of ws.panels) {
        if (p.kind === 'native') continue
        window.decks?.panel.setKeepAlive(p.id, pinned)
        if (pinned && !p.discarded && !createdPanels.current.has(p.id)) {
          createdPanels.current.add(p.id)
          window.decks?.panel
            .create({
              panelId: p.id,
              workspaceId: ws.id,
              partition: ws.partition,
              url: p.url,
              bounds: { x: 0, y: 0, width: 800, height: 600 }
            })
            .catch(() => createdPanels.current.delete(p.id))
        }
      }
    }
  }, [keepAliveKey, bootHydrated])

  // ── Operations mode: hide every Decks web view so the native JetCore
  // Operations view (positioned by OperationsView) owns the area below the
  // titlebar. Restore the deck views (re-measure) when leaving. ──
  useEffect(() => {
    if (view !== 'operations') return
    window.decks?.panel.hideAll()
    return () => {
      window.dispatchEvent(new Event('resize'))
    }
  }, [view])

  // ── In-Operations "switch back" button → return to Decks. ──
  useEffect(() => {
    const off = window.decks?.onOperationsExit?.(() => {
      // Go back to the last meaningful Decks surface.
      const s = useStore.getState()
      setView(s.activeWorkspaceId ? 'workspace' : 'home')
    })
    return () => off?.()
  }, [setView])

  // ── 3. Live panel updates from main → store. ──
  useEffect(() => {
    const off = window.decks?.onPanelUpdate(({ panelId, patch }) => {
      patchPanel(panelId, patch)
    })
    return () => off?.()
  }, [patchPanel])

  // ── 3b. Discard/recreate state from the main-process discard manager. ──
  // On discard: mark the panel discarded with its saved URL (persists across
  // restart). On recreate (return): clear the flag. `createdPanels` is updated
  // so effect 2's idempotence stays in sync with main's actual view set.
  useEffect(() => {
    const off = window.decks?.onPanelDiscardState(({ panelId, discarded, url }) => {
      if (discarded) {
        createdPanels.current.delete(panelId)
        patchPanel(panelId, url ? { discarded: true, url } : { discarded: true })
      } else {
        createdPanels.current.add(panelId)
        patchPanel(panelId, { discarded: false })
      }
    })
    return () => off?.()
  }, [patchPanel])

  // ── 3c. Mini-player "close" → expand that deck back to full size. ──
  // Main sends only the panelId (it doesn't track workspaces); the renderer owns
  // the store, so we look up which workspace contains the panel and activate it.
  // The next showOnly puts the panel in the show-set, clearing mini-player mode.
  useEffect(() => {
    const off = window.decks?.onFocusPanel(({ panelId }) => {
      const ws = useStore
        .getState()
        .workspaces.find((w) => w.panels.some((p) => p.id === panelId))
      if (ws) activateWorkspace(ws.id)
    })
    return () => off?.()
  }, [activateWorkspace])

  // ── 3d. Background unread counts: show a native deck's notification badge in
  // the dock BEFORE it's opened. (Web decks can't report a count without loading
  // their page, so this covers the native providers that have an inbox.) ──
  useEffect(() => {
    const UNREAD: Record<string, string> = {
      github: 'notifications',
      canvas: 'todo',
      mastodon: 'notifications',
      bluesky: 'notifications'
    }
    let alive = true
    const poll = async (): Promise<void> => {
      for (const w of useStore.getState().workspaces) {
        for (const p of w.panels) {
          if (p.kind !== 'native' || !p.provider) continue
          const resource = UNREAD[p.provider]
          if (!resource) continue
          try {
            const r = await window.decks?.provider.fetch({
              provider: p.provider,
              accountId: p.accountId ?? 'default',
              resource
            })
            const count = Array.isArray(r) ? r.length : 0
            if (alive) patchPanel(p.id, { badge: count })
          } catch {
            /* not connected / failed — leave the badge as-is */
          }
        }
      }
    }
    const first = setTimeout(poll, 4000)
    const id = setInterval(poll, 180_000) // every 3 min
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(id)
    }
  }, [patchPanel])

  // ── 4. Debounced persistence on any meaningful change. ──
  useEffect(() => {
    if (!bootHydrated) return
    const t = setTimeout(() => {
      const snapshot: PersistedState = {
        version: STATE_VERSION,
        theme,
        workspaces,
        activeWorkspaceId,
        settings,
        // Keep the signed-in account in the snapshot so the debounced save never
        // clobbers what main persisted on login (the JWT stays in the keychain).
        account
      }
      window.decks?.state.save(snapshot).catch(() => {})
      // Additive E2EE cloud sync (the round-trip demo): also push the snapshot to
      // the vault, encrypted in main with the DEK. No-ops (throws, caught) when
      // the vault is locked / signed out — local persistence above is primary.
      window.decks?.vault
        ?.set({ key: VAULT_STATE_KEY, plaintext: JSON.stringify(snapshot) })
        .catch(() => {})
    }, 500)
    return () => clearTimeout(t)
  }, [workspaces, theme, activeWorkspaceId, settings, account, bootHydrated])

  // ── Keep the main-process idle-discard timeout in sync with settings. ──
  useEffect(() => {
    if (!bootHydrated) return
    window.decks?.settings.apply({ discardMinutes: settings.discardMinutes })
  }, [settings.discardMinutes, bootHydrated])

  // ── Global shortcuts: ⌘/Ctrl+K (search), ⌘/Ctrl+N (add deck), Esc (close). ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        togglePalette()
      } else if (mod && (e.key.toLowerCase() === 'n' || e.key === '+' || e.key === '=')) {
        e.preventDefault()
        openAddDeck()
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (mod && e.key === '.') {
        e.preventDefault()
        toggleFocusMode()
      } else if (!mod && e.key === '?') {
        const tag = (document.activeElement as HTMLElement | null)?.tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          e.preventDefault()
          openHelp()
        }
      } else if (e.key === 'Escape') {
        closePalette()
        closeAddDeck()
        if (useStore.getState().consolePanel !== 'none') closeConsolePanel()
        if (useStore.getState().focusMode) toggleFocusMode()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePalette, closePalette, openAddDeck, closeAddDeck, toggleFocusMode, openHelp, closeConsolePanel])

  // Hide native web views while the palette is open so it isn't covered by them.
  useEffect(() => {
    if (!paletteOpen) return
    window.decks?.panel.hideAll()
    return () => {
      window.dispatchEvent(new Event('resize'))
    }
  }, [paletteOpen])

  // Re-measure deck views when focus mode or the dock rail collapses/expands the
  // workspace. The grid column width animates over ~0.32s, so the slot rects keep
  // shifting; fire several re-measures ACROSS and just AFTER the transition so the
  // native WebContentsViews never get left at a stale position ("monstrosity").
  useEffect(() => {
    const ids = [0, 120, 240, 360, 420].map((d) =>
      setTimeout(() => window.dispatchEvent(new Event('resize')), d)
    )
    return () => ids.forEach(clearTimeout)
  }, [focusMode, collapsed])

  const showSplit = view === 'workspace' && workspaces.length > 0
  const inFocus = focusMode && showSplit
  const inOperations = view === 'operations'

  // Portrait: dock at the BOTTOM → stack [main | dock] vertically.
  // Landscape: rail on the LEFT → [rail | main] horizontally.
  const dockMode = portrait && !inFocus

  // The active surface. Summit = its Operations WebContentsView; Settings = the
  // settings deck; everything else = the active native JetCore app. (The retired
  // Decks home/split surfaces are no longer routed.)
  const surface = inOperations ? (
    <OperationsView />
  ) : view === 'settings' ? (
    <SettingsDeck />
  ) : (
    <NativeAppHost />
  )

  // Exit focus is the topbar "Focus" button (a left-edge handle would be covered
  // by the deck's native view, which always paints above the DOM).

  // ── Login gate: when logged out, show ONLY the Titlebar (window controls) and
  // the native LoginShell — never the dock/Sidebar/workspace. ──
  // Logged-out marketing surfaces (full-page, scrollable).
  if (view === 'marketing' || view === 'pricing') {
    return (
      <div className="console is-public">
        <Titlebar />
        <div className="public-surface">{view === 'marketing' ? <Homepage /> : <Pricing />}</div>
        <UpdateOverlay />
      </div>
    )
  }
  // Auth gate + the post-signup intent step (centered card).
  if (view === 'login' || view === 'intent') {
    return (
      <div className="console is-login">
        <Titlebar />
        {view === 'intent' ? <IntentForm /> : <LoginShell />}
        <UpdateOverlay />
      </div>
    )
  }

  return (
    // STABLE tree: Titlebar + Sidebar + workspace are ALWAYS rendered in the same
    // positions; focus mode / portrait only toggle CSS classes (no remount), so a
    // native deck keeps its state when you focus/fullscreen it. Layout is driven
    // by `.console` + `.is-focus` / `.is-portrait` / `.rail` in the CSS grid.
    <div
      className={
        'console' +
        // In focus mode the dock is hidden, so `rail` is meaningless there —
        // dropping it makes collapsed+focus and expanded+focus render IDENTICALLY
        // (full-bleed), instead of leaving the card at the smaller rail size.
        (collapsed && !inFocus ? ' rail' : '') +
        (inFocus ? ' is-focus' : '') +
        // Summit (operations): the app rail stays; the native webview fills the
        // content column edge-to-edge (no page-card padding), like the other apps.
        (inOperations ? ' is-operations' : '') +
        (dockMode && !inOperations ? ' is-portrait' : '')
      }
    >
      {/* HEADER — full-width Console chrome (brand + command bar + controls).
          Always visible, including in Operations mode (window controls). */}
      <Titlebar />

      {/* STABLE grid children (direct children of .console so the CSS grid
          positions them): the dock + the workspace. Operations mode hides the
          dock and full-bleeds the workspace (via .console.is-operations, same
          mechanism as focus mode) so the native JetCore view fills the area
          below the titlebar — no nested-grid wrapper (that broke the layout). */}
      {/* JetCore app rail — the four apps + account/settings (replaces the dock). */}
      <AppRail />

      {/* WORKSPACE — the active surface (Decks deck, home, settings, or the
          Operations slot the native JetCore view overlays). */}
      <div className="workspace relative">{surface}</div>

      <CommandPalette />

      {feedbackOpen && <FeedbackModal onClose={closeFeedback} />}

      {/* Console redesign — slide-over panels + first-run tutorial */}
      {consolePanel === 'help' && (
        <HelpPanel
          onClose={closeConsolePanel}
          onAction={(id) => {
            closeConsolePanel()
            if (id === 'palette') openPalette()
            else if (id === 'home') goHome()
            else if (id === 'focus') toggleFocusMode()
            else if (id === 'add') openAddDeck()
            else if (id === 'memory') openMemory()
          }}
        />
      )}
      {/* Replay the guided tour from the Help slide-over (docked to its footer). */}
      {consolePanel === 'help' && (
        <button
          className="help-tour-btn btn-ghost"
          onClick={() => {
            closeConsolePanel()
            openTour()
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
          Replay the guided tour
        </button>
      )}
      {consolePanel === 'memory' && <MemoryPanel onClose={closeConsolePanel} />}
      {welcomeOpen && !paletteOpen && (
        <Welcome onClose={() => setWelcomeOpen(false)} onHelp={() => { setWelcomeOpen(false); openHelp() }} />
      )}

      {/* First-run guided spotlight tour (replayable from Help / Settings). */}
      <Tour />

      {/* Auto-update popup — floats above everything when an update is detected. */}
      <UpdateOverlay />
    </div>
  )
}

export default App
