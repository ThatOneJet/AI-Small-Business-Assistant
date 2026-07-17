import { useState, useEffect, useRef } from 'react'

const MAX_TOASTS = 4
const DISMISS_MS  = 5000
const MUTE_KEY   = 'aiToastsMuted'

export default function AIToasts({ socket }) {
  const [toasts, setToasts] = useState([])
  const [muted, setMuted]   = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) === '1' } catch { return false }
  })
  const idRef     = useRef(0)
  const mutedRef  = useRef(muted)
  const timersRef = useRef([])

  useEffect(() => { mutedRef.current = muted }, [muted])

  useEffect(() => {
    if (!socket) return
    const onTrade = (d) => {
      if (!d || mutedRef.current) return
      const side = String(d.side || '').toLowerCase()
      const verb = side === 'buy' ? 'AI bought' : 'AI sold'
      const color = side === 'buy' ? 'var(--ok)' : 'var(--err)'
      idRef.current += 1
      const id = idRef.current
      const toast = { id, text: `${verb} ${d.shares ?? ''} ${d.symbol || ''}`.trim(), color, side }
      setToasts(prev => [...prev, toast].slice(-MAX_TOASTS))
      const t = setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== id))
      }, DISMISS_MS)
      timersRef.current.push(t)
    }
    socket.on('ai_trade', onTrade)
    return () => socket.off('ai_trade', onTrade)
  }, [socket])

  useEffect(() => () => { timersRef.current.forEach(clearTimeout) }, [])

  function toggleMute() {
    setMuted(m => {
      const next = !m
      try { localStorage.setItem(MUTE_KEY, next ? '1' : '0') } catch {}
      if (next) setToasts([])
      return next
    })
  }

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 9999,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
      pointerEvents: 'none',
    }}>
      {!muted && toasts.map(t => (
        <div
          key={t.id}
          style={{
            pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 180, maxWidth: 300,
            padding: '9px 13px', borderRadius: 8,
            background: 'rgba(18,23,36,0.96)',
            border: `1px solid ${t.color}`,
            boxShadow: `0 6px 22px rgba(0,0,0,0.5), 0 0 14px -6px ${t.color}`,
            backdropFilter: 'blur(6px)',
            fontFamily: 'var(--font-sans)', fontSize: 12,
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: t.color, boxShadow: `0 0 8px ${t.color}`,
          }} />
          <span style={{ color: 'var(--t-1)', fontWeight: 600 }}>{t.text}</span>
        </div>
      ))}

      <button
        onClick={toggleMute}
        title={muted ? 'AI trade alerts muted — click to unmute' : 'Mute AI trade alerts'}
        style={{
          pointerEvents: 'auto',
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 9px', borderRadius: 999,
          background: 'rgba(18,23,36,0.9)',
          border: '1px solid var(--hairline-2)',
          color: muted ? 'var(--t-3)' : 'var(--cy)',
          fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '0.06em', cursor: 'pointer',
        }}
      >
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: muted ? 'var(--t-4)' : 'var(--cy)',
          boxShadow: muted ? 'none' : '0 0 6px var(--cy)',
        }} />
        {muted ? 'AI MUTED' : 'AI ALERTS'}
      </button>
    </div>
  )
}
