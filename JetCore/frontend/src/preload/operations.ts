/**
 * Decks — Operations (JetCore) view preload.
 *
 * A SEPARATE, tiny preload loaded ONLY into the Operations WebContentsView (the
 * embedded JetCore Flask page). It exposes a single shell bridge the JetCore UI
 * can call to ask the host to switch back to Decks. Deliberately minimal — no
 * access to the full DecksApi.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'

// ── Single sign-on ──────────────────────────────────────────────────────────
// Seed the JetCore session into localStorage SYNCHRONOUSLY, before the page's
// own React bundle runs, so Operations is already authenticated as the same
// JetCore account and never shows its own login. (Runs on every navigation.)
try {
  const seed = ipcRenderer.sendSync(IPC.AuthOperationsBootstrap) as Record<string, string> | null
  if (seed && typeof window !== 'undefined' && window.localStorage) {
    for (const [k, v] of Object.entries(seed)) window.localStorage.setItem(k, v)
  }
} catch {
  /* no session / storage unavailable — Operations falls back to its own login */
}

/** The shell bridge available to the JetCore page as `window.jetcoreShell`. */
const jetcoreShell = {
  /** Ask the Decks host to leave Operations and return to the Decks UI. */
  switchToDecks: (): void => ipcRenderer.send('operations:request-decks')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('jetcoreShell', jetcoreShell)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (no contextIsolation)
  window.jetcoreShell = jetcoreShell
}
