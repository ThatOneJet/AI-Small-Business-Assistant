import React from 'react'
import ReactDOM from 'react-dom/client'
import JetCoreApp from './design/JetCoreApp'
import { DevBayQuickPanel } from './design/apps/devbay'
import OverlayApp from './overlay/OverlayApp'
import './index.css'
import './design/tokens.css'

// The same renderer bundle is loaded twice: once as the main app, and once (by
// the always-on-top overlay window) with a `#overlay` hash. In overlay mode we
// render ONLY the floating hover card on a fully transparent surface — no app
// chrome — so the empty area shows through and stays click-through.
const isOverlay = window.location.hash === '#overlay'
const isDevBayOverlay = window.location.hash === '#devbay-overlay'

// Both overlay windows are transparent — let the window show through behind the
// floating card. (The DevBay quick panel manages its own JetCore theme/accent.)
if (isOverlay || isDevBayOverlay) {
  document.documentElement.classList.add('overlay-mode')
}
if (isOverlay) {
  // The mini-player overlay is a SEPARATE window with the legacy CSS; hydrate its
  // theme from persisted state so it matches the app.
  const applyOverlayTheme = async (): Promise<void> => {
    const persisted = await window.decks?.state.load().catch(() => null)
    const root = document.documentElement
    if (persisted?.theme === 'light') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
  }
  void applyOverlayTheme()
  window.decks?.onMiniPlayer(() => void applyOverlayTheme())
  window.decks?.onOverlayRender(() => void applyOverlayTheme())
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isOverlay ? <OverlayApp /> : isDevBayOverlay ? <DevBayQuickPanel /> : <JetCoreApp />}
  </React.StrictMode>
)
