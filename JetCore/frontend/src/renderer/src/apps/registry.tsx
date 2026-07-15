/**
 * JetCore app registry — the core module contract.
 *
 * JetCore is one shell hosting several apps. Each app declares its identity here;
 * the shell renders the active one in the content area and the lightning switcher
 * (top-left) lists them with a short "who it's for" blurb. Native apps render as
 * React pages inside the shell (see NativeAppHost); Summit is the existing
 * Operations backend shown as a WebContentsView overlay (kind: 'operations').
 *
 * Adding an app = add an entry here + (for native apps) a component in
 * NativeAppHost. Everything else (switcher, routing, shared look) is automatic.
 */
import type { JSX } from 'react'

export type AppId = 'hangar' | 'devbay' | 'summit' | 'pylon'

export interface JetCoreApp {
  id: AppId
  /** Short label shown in the titlebar + switcher (e.g. "Summit"). */
  short: string
  /** Full product name (e.g. "JetCore Summit"). */
  name: string
  /** One-line audience tag shown in the switcher (e.g. "for business owners"). */
  audience: string
  /**
   * 'native' → a React page rendered in the shell content area (NativeAppHost).
   * 'operations' → the embedded Operations/Summit backend (WebContentsView).
   */
  kind: 'native' | 'operations'
  /** The app's mark (inherits the unified red accent via currentColor). */
  Icon: (p: { size?: number }) => JSX.Element
}

/** Unified accent (user choice): red across every app — the JetCore trademark. */
export const JETCORE_ACCENT = '#ff3b3b'

const HangarIcon = ({ size = 18 }: { size?: number }): JSX.Element => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 4l9 6.5" />
    <path d="M5 10v9h14v-9" />
    <path d="M9 19v-5h6v5" />
  </svg>
)
const DevBayIcon = ({ size = 18 }: { size?: number }): JSX.Element => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m8 9-3 3 3 3" />
    <path d="m16 9 3 3-3 3" />
    <path d="m13 7-2 10" />
  </svg>
)
const SummitIcon = ({ size = 18 }: { size?: number }): JSX.Element => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 18 5-9 4 5 3-4 6 8z" />
  </svg>
)
const PylonIcon = ({ size = 18 }: { size?: number }): JSX.Element => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 10 12 4 2 10l10 6 10-6Z" />
    <path d="M6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5" />
  </svg>
)

/** All registered JetCore apps, in switcher order (Hangar = the hub, first). */
export const JETCORE_APPS: JetCoreApp[] = [
  { id: 'hangar', short: 'Hangar', name: 'JetCore Hangar', audience: 'your overview', kind: 'native', Icon: HangarIcon },
  { id: 'devbay', short: 'DevBay', name: 'JetCore DevBay', audience: 'for developers', kind: 'native', Icon: DevBayIcon },
  { id: 'summit', short: 'Summit', name: 'JetCore Summit', audience: 'for business owners', kind: 'operations', Icon: SummitIcon },
  { id: 'pylon', short: 'Pylon', name: 'JetCore Pylon', audience: 'for students', kind: 'native', Icon: PylonIcon }
]

export function getApp(id: AppId): JetCoreApp {
  return JETCORE_APPS.find((a) => a.id === id) ?? JETCORE_APPS[0]
}
