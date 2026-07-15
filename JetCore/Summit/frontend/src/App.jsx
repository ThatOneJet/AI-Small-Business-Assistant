import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import TitleBar from './pages/TitleBar'

function PrivateRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />
}

function OfflinePage() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', gap: 20, padding: 32, textAlign: 'center',
    }}>
      <svg width="96" height="96" viewBox="0 0 96 96" fill="none">
        <circle cx="48" cy="48" r="46" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
        {/* WiFi arcs */}
        <path d="M18 46 Q48 18 78 46" stroke="var(--border)" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M28 56 Q48 36 68 56" stroke="var(--border)" strokeWidth="4" fill="none" strokeLinecap="round" />
        <circle cx="48" cy="68" r="5" fill="var(--muted)" />
        {/* Red X */}
        <line x1="28" y1="24" x2="68" y2="72" stroke="var(--red)" strokeWidth="4" strokeLinecap="round" />
        <line x1="68" y1="24" x2="28" y2="72" stroke="var(--red)" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          No Internet Connection
        </h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, maxWidth: 380, lineHeight: 1.6 }}>
          JetCore needs a connection to reach your integrations and sync data.
          Check your network and try again.
        </p>
      </div>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        Retry
      </button>
    </div>
  )
}

export default function App() {
  const [isDesktop, setIsDesktop] = useState(false)
  const [offline,   setOffline]   = useState(!navigator.onLine)

  // Detect desktop context (Electron or pywebview)
  useEffect(() => {
    function activate() {
      setIsDesktop(true)
      document.documentElement.setAttribute('data-desktop', 'true')
    }
    if (window.electronAPI?.isElectron) {
      activate()
    } else if (window.pywebview) {
      activate()
    } else {
      window.addEventListener('pywebviewready', activate)
      return () => window.removeEventListener('pywebviewready', activate)
    }
  }, [])

  // Track online / offline
  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline  = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online',  goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online',  goOnline)
    }
  }, [])

  return (
    <>
      {isDesktop && <TitleBar />}

      {offline ? (
        <OfflinePage />
      ) : (
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
            <Route path="*" element={<Navigate to={localStorage.getItem('token') ? '/dashboard' : '/login'} replace />} />
          </Routes>
        </BrowserRouter>
      )}
    </>
  )
}
