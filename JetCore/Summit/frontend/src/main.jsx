import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyAccent, getStoredAccent } from './accent'

// Apply saved theme + accent before first paint to avoid flash
const theme = localStorage.getItem('theme') || 'dark'
document.documentElement.setAttribute('data-theme', theme)
applyAccent(getStoredAccent())

// Embedded mode: when rendered inside the Decks Electron shell, the host preload
// injects window.jetcoreShell. Mark the document so the embedded-only CSS overrides
// (hide own titlebar, match the Decks rail + blue brand square) apply before paint.
if (window.jetcoreShell) {
  document.documentElement.setAttribute('data-embedded', 'true')
}

/**
 * Embedded auto-session: when running inside the Decks shell, the backend is
 * spawned with the signed-in JetCore (Supabase) identity and exposes
 * GET /api/jetcore_session. Fetch it and seed the SAME localStorage keys the
 * normal Login flow writes, so PrivateRoute passes and the app goes straight to
 * the dashboard with NO Operations login screen. Standalone (no jetcoreShell)
 * keeps the normal email/password login untouched. We do this BEFORE rendering
 * React so there is no login flash.
 */
async function bootstrap() {
  if (window.jetcoreShell) {
    try {
      const res = await fetch('/api/jetcore_session')
      if (res.ok) {
        const d = await res.json()
        if (d && d.token) {
          localStorage.setItem('token', d.token)
          localStorage.setItem('user_id', String(d.user_id))
          localStorage.setItem('email', d.email || '')
          localStorage.setItem('first_name', d.first_name || '')
          localStorage.setItem('segment', d.segment || 'individual')
          localStorage.setItem('plan', d.plan || 'free')
          localStorage.setItem('is_admin', d.is_admin ? '1' : '0')
          if (d.avatar) localStorage.setItem('profile_pic', d.avatar)
        }
      }
    } catch {
      // Network/backend hiccup — fall through; PrivateRoute will show login if
      // no token got stored. Auto-session retries on next reload.
    }
  }
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap()
