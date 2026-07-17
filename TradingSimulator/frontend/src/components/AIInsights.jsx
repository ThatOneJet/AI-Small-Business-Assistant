import { useEffect, useState } from 'react'
import api from '../api.js'

const money = n => (Number(n) >= 0 ? '+$' : '−$') + Math.abs(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })

// Trade outcomes + accepted entries + per-regime win rate, from /ai/insights. Sits
// under the decision log (which already shows the rejected breakdown).
export default function AIInsights({ portfolioId }) {
  const [d, setD] = useState(null)
  useEffect(() => {
    if (!portfolioId) return
    let stop = false
    const load = () => api.get(`/portfolios/${portfolioId}/ai/insights`, { params: { days: 7 } })
      .then(r => { if (!stop) setD(r.data) }).catch(() => {})
    load(); const id = setInterval(load, 20000)
    return () => { stop = true; clearInterval(id) }
  }, [portfolioId])

  if (!d) return null
  const o = d.outcomes || {}

  const Card = ({ label, b, color }) => (
    <div style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 7, background: 'rgba(140,170,220,0.05)', border: '1px solid rgba(140,170,220,0.10)' }}>
      <div style={{ fontSize: 9, color: 'var(--t-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{b?.count || 0}</div>
      <div style={{ fontSize: 10, color, fontFamily: 'var(--font-mono)' }}>{money(b?.total_pl || 0)}</div>
    </div>
  )

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(140,170,220,0.08)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        Trade Outcomes — 7 days
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Card label="Won"  b={o.won}  color="#3ddc97" />
        <Card label="Lost" b={o.lost} color="#ff476f" />
        <Card label="Flat" b={o.flat} color="#8b98a9" />
      </div>

      {d.by_regime?.length > 0 && (
        <>
          <div style={{ fontSize: 9.5, color: 'var(--t-4)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Win rate by regime</div>
          {d.by_regime.slice(0, 6).map(r => (
            <div key={r.regime} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11 }}>
              <span style={{ flex: 1, color: 'var(--t-2)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.regime}</span>
              <span style={{ width: 64, height: 5, borderRadius: 3, background: 'rgba(140,170,220,0.12)', overflow: 'hidden', flexShrink: 0 }}>
                <span style={{ display: 'block', height: '100%', width: `${r.win_rate}%`, background: r.win_rate >= 50 ? '#3ddc97' : '#f5b342' }} />
              </span>
              <span style={{ width: 34, textAlign: 'right', color: 'var(--t-3)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{r.win_rate}%</span>
              <span style={{ width: 58, textAlign: 'right', color: r.total_pl >= 0 ? '#3ddc97' : '#ff476f', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{money(r.total_pl)}</span>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 9.5, color: 'var(--t-4)', margin: '12px 0 5px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Accepted entries ({d.accepted_total || 0})
      </div>
      {(d.accepted || []).slice(0, 8).map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, fontSize: 10.5 }}>
          <span style={{ fontWeight: 700, color: a.action === 'BUY' ? '#3ddc97' : '#ff476f', fontFamily: 'var(--font-mono)', width: 42, flexShrink: 0 }}>{a.action}</span>
          <span style={{ flex: 1, color: 'var(--t-2)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.symbol}</span>
          <span style={{ color: 'var(--t-4)', fontSize: 9.5 }}>{a.regime}</span>
          <span style={{ color: 'var(--t-3)', fontFamily: 'var(--font-mono)', width: 38, textAlign: 'right', flexShrink: 0 }}>{a.score > 0 ? '+' : ''}{a.score}</span>
        </div>
      ))}
      {(d.accepted || []).length === 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--t-4)' }}>No entries accepted in this window — the AI is being selective.</div>
      )}
    </div>
  )
}
