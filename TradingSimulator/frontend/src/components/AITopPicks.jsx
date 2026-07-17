import { useState, useEffect } from 'react'
import api from '../api.js'

function scoreColor(s) {
  if (s == null || isNaN(s)) return '#475264'
  const n = Number(s)
  if (n >= 6) return '#3ddc97'
  if (n >= 3) return '#5fd39a'
  if (n >= 1) return '#6e7a8e'
  if (n > -1) return '#475264'
  if (n > -3) return '#f5b342'
  return '#ff476f'
}
function actionLabel(s) {
  if (s == null || isNaN(s)) return '—'
  const n = Number(s)
  if (n >= 5) return 'BUY'
  if (n <= -4) return 'AVOID'
  return 'HOLD'
}
function fmtScore(s) {
  if (s == null || isNaN(s)) return '–'
  const n = Number(s)
  return (n >= 0 ? '+' : '') + n.toFixed(1)
}
function confish(s) {
  if (s == null || isNaN(s)) return 0
  return Math.min(99, Math.round((Math.abs(Number(s)) / 10) * 100))
}

export default function AITopPicks({ portfolioId, onSelectSymbol }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    let alive = true
    const load = () => {
      api.get('/rankings', { params: { portfolio_id: portfolioId } })
        .then(res => { if (alive) setRows(Array.isArray(res.data) ? res.data : []) })
        .catch(() => {})
    }
    load()
    const id = setInterval(load, 20 * 1000)
    return () => { alive = false; clearInterval(id) }
  }, [portfolioId])

  const picks = [...rows]
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
    .slice(0, 6)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 12px', overflowX: 'auto',
      background: 'var(--card-bg)',
      border: 'var(--card-border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--card-shadow)',
    }}>
      <span style={{
        flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 9,
        fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--cy)', lineHeight: 1.2, maxWidth: 70,
      }}>
        AI'S BEST SETUPS
      </span>

      {picks.length === 0 ? (
        <span style={{ color: 'var(--t-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          scanning…
        </span>
      ) : picks.map((p) => {
        const c = scoreColor(p.score)
        return (
          <button
            key={p.symbol}
            onClick={() => onSelectSymbol?.(p.symbol)}
            title={p.summary || ''}
            style={{
              flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2,
              alignItems: 'flex-start', minWidth: 68,
              padding: '5px 9px', borderRadius: 6,
              border: `1px solid ${c}44`, background: `${c}12`,
              cursor: 'pointer', fontFamily: 'var(--font-mono)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ color: 'var(--cy)', fontSize: 11, fontWeight: 700, letterSpacing: '0.03em' }}>
                {p.symbol}
              </span>
              <span style={{ color: c, fontSize: 11, fontWeight: 800 }}>
                {fmtScore(p.score)}
              </span>
            </span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ color: c, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em' }}>
                {actionLabel(p.score)}
              </span>
              <span style={{ color: 'var(--t-3)', fontSize: 8.5 }}>
                {confish(p.score)}%
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
