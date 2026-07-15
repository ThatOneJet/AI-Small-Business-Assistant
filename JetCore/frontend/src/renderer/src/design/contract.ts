/**
 * JetCore redesign — the SCREEN CONTRACT every app surface implements.
 *
 * The new shell (design/shell.tsx) mounts exactly one screen at a time inside
 * `.jc-root` with `data-app` set on a wrapping element (so the per-app accent
 * hue applies). Screens receive ONLY these props; cross-app navigation goes
 * through `go`, never by touching the legacy store/views directly.
 */
export type JCAppId = 'hangar' | 'devbay' | 'summit' | 'pylon' | 'borderless' | 'forge'

export interface JCScreenProps {
  /** Navigate to another app (optionally a specific tab inside it). */
  go: (app: JCAppId, tab?: string) => void
  /** Open the universal Settings surface. */
  openSettings: () => void
}

export interface JCSettingsProps {
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
  /** Sign the account out (the shell returns to the entry flow). */
  signOut: () => Promise<void>
  back: () => void
}

/** Persisted UI prefs (theme), localStorage-backed. */
export const THEME_KEY = 'jc.theme'
export function readTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}
export function applyTheme(t: 'dark' | 'light'): void {
  try {
    localStorage.setItem(THEME_KEY, t)
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('data-theme', t)
}
