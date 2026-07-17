import { useState, useEffect } from 'react'
import api from '../api.js'

function mmss(s) {
  if (s == null || isNaN(s)) return '—'
  const n = Math.max(0, Math.round(Number(s)))
  const m = Math.floor(n / 60)
  return `${m}:${String(n % 60).padStart(2, '0')}`
}

export default function AIStatusChip({ socket, portfolioId }) {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let alive = true
    api.get('/ai/status', { params: { portfolio_id: portfolioId } })
      .then(res => { if (alive) setStatus(res.data) })
      .catch(() => {})
    return () => { alive = false }
  }, [portfolioId])

  useEffect(() => {
    if (!socket) return
    const onStatus = (d) => {
      if (!d) return
      if (!d.pid || String(d.pid) === String(portfolioId)) setStatus(d)
    }
    socket.on('ai_status', onStatus)
    return () => socket.off('ai_status', onStatus)
  }, [socket, portfolioId])

  const s = status || {}
  const online     = !!s.online
  const scanning   = !!s.scanning
  const modelReady = !!s.model_ready

  const dot = !status ? 'var(--t-4)'
    : !online          ? 'var(--t-4)'
    : (online && modelReady) ? 'var(--ok)'
    : 'var(--warn)'

  const pl    = Number(s.ai_pl_today || 0)
  const plStr = `${pl >= 0 ? '+' : '-'}$${Math.abs(pl).toFixed(2)}`

  return (
    <span
      title="Autonomous AI trader status"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 9px', borderRadius: 999,
        border: '1px solid var(--hairline-2)',
        background: 'rgba(10,13,20,0.5)',
        fontFamily: 'var(--font-mono)', fontSize: 10.5,
        color: 'var(--t-2)', whiteSpace: 'nowrap', lineHeight: 1.4,
        letterSpacing: '0.02em',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: dot, boxShadow: `0 0 6px ${dot}`,
        animation: scanning ? 'ticker-pulse 1.6s infinite' : 'none',
      }} />

      {!status ? (
        <span style={{ color: 'var(--t-3)' }}>AI …</span>
      ) : (
        <>
          <span style={{ color: online ? 'var(--t-1)' : 'var(--t-3)', fontWeight: 700 }}>
            {online ? 'AI ONLINE' : 'AI OFFLINE'}
          </span>
          {s.universe_size != null && (
            <>
              <span style={{ color: 'var(--t-4)' }}>·</span>
              <span style={{ color: 'var(--t-3)' }}>scanning {s.universe_size}</span>
            </>
          )}
          {s.next_scan_secs != null && (
            <>
              <span style={{ color: 'var(--t-4)' }}>·</span>
              <span style={{ color: 'var(--t-3)' }}>next {mmss(s.next_scan_secs)}</span>
            </>
          )}
          <span style={{ color: 'var(--t-4)' }}>·</span>
          <span style={{ color: pl >= 0 ? 'var(--ok)' : 'var(--err)', fontWeight: 700 }}>
            {plStr}
          </span>
          {s.llm_up && (
            <span style={{
              marginLeft: 2, padding: '0 5px', borderRadius: 4,
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em',
              color: 'var(--cy)', background: 'rgba(74,217,255,0.12)',
              border: '1px solid rgba(74,217,255,0.3)',
            }}>
              LLM
            </span>
          )}
        </>
      )}
    </span>
  )
}
