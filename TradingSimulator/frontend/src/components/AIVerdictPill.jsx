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
function fmtScore(s) {
  if (s == null || isNaN(s)) return '–'
  const n = Number(s)
  return (n >= 0 ? '+' : '') + n.toFixed(1)
}
function fallbackAction(s) {
  if (s == null || isNaN(s)) return '—'
  const n = Number(s)
  if (n >= 5) return 'BUY'
  if (n <= -4) return 'AVOID'
  return 'HOLD'
}

export default function AIVerdictPill({ symbol, portfolioId }) {
  const [op, setOp] = useState(null)

  useEffect(() => {
    if (!symbol) { setOp(null); return }
    let alive = true
    const load = () => {
      api.get('/ai/opinion/' + symbol, { params: { portfolio_id: portfolioId } })
        .then(res => { if (alive) setOp(res.data) })
        .catch(() => {})
    }
    setOp(null)
    load()
    const id = setInterval(load, 15 * 1000)
    return () => { alive = false; clearInterval(id) }
  }, [symbol, portfolioId])

  if (!symbol) return null

  const score  = op ? op.score : null
  const action = op ? (op.action || fallbackAction(score)) : null
  const conf   = op && op.confidence != null ? Math.round(op.confidence) : null
  const c      = scoreColor(score)

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 9px', borderRadius: 5,
      border: `1px solid ${op ? c + '55' : 'var(--hairline-2)'}`,
      background: op ? `${c}14` : 'rgba(10,13,20,0.5)',
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
      color: op ? c : 'var(--t-3)', whiteSpace: 'nowrap', lineHeight: 1.3,
      letterSpacing: '0.02em',
    }}>
      {!op ? (
        <>AI …</>
      ) : (
        <>
          <span style={{ color: 'var(--t-3)', fontWeight: 700 }}>AI</span>
          <span>{fmtScore(score)}</span>
          <span style={{ color: 'var(--t-4)' }}>·</span>
          <span>{action}</span>
          {conf != null && (
            <>
              <span style={{ color: 'var(--t-4)' }}>·</span>
              <span>{conf}%</span>
            </>
          )}
        </>
      )}
    </span>
  )
}
