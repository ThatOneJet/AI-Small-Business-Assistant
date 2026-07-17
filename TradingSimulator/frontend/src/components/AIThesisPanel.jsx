import { useState, useEffect, useMemo } from 'react'
import api from '../api.js'

// Named market regimes the backend can return (market_state field) → chip label + color.
const STATE_META = {
  trending_up:        { label: 'Trending Up',        color: '#3ddc97' },
  trending_down:      { label: 'Trending Down',      color: '#ff476f' },
  breakout:           { label: 'Breakout',           color: '#3ddc97' },
  accumulation:       { label: 'Accumulation',       color: '#5fd39a' },
  oversold_extreme:   { label: 'Oversold Extreme',   color: '#5fd39a' },
  overbought_extreme: { label: 'Overbought Extreme', color: '#ff476f' },
  euphoric:           { label: 'Euphoric',           color: '#ff9a3c' },
  panic:              { label: 'Panic',              color: '#ff476f' },
  high_volatility:    { label: 'High Volatility',    color: '#ff9a3c' },
  ranging:            { label: 'Ranging',            color: '#f5b342' },
  consolidating:      { label: 'Consolidating',      color: '#f5b342' },
  neutral:            { label: 'Neutral',            color: '#6b7689' },
}

function stateMeta(ms) {
  if (!ms) return null
  return STATE_META[ms] || {
    label: String(ms).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    color: '#6b7689',
  }
}

// Color-grade the numeric AI score (scale −10..+10, positive = bullish).
function gradeColor(score) {
  if (score >= 6)  return '#3ddc97'
  if (score >= 3)  return '#5fd39a'
  if (score >= 1)  return 'var(--t-3)'
  if (score > -1)  return 'var(--t-4)'
  if (score > -3)  return '#ff8fa3'
  return '#ff476f'
}

function actionColors(action) {
  if (action === 'BUY')  return { fg: '#3ddc97', bg: 'rgba(61,220,151,0.12)' }
  if (action === 'SELL') return { fg: '#ff476f', bg: 'rgba(255,71,111,0.12)' }
  return { fg: '#f5b342', bg: 'rgba(245,179,66,0.12)' }
}

// Fallback action derivation (only used when the backend didn't hand us one).
function deriveAction(score) {
  if (score >= 5)  return 'BUY'
  if (score <= -4) return 'SELL'
  return 'HOLD'
}

function fmtVal(v) {
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return String(v)
}

export default function AIThesisPanel({ data, price, symbol }) {
  const [opinion, setOpinion] = useState(null)
  const [loading, setLoading] = useState(false)
  const [failed,  setFailed]  = useState(false)

  // Fetch the REAL backend model's opinion — the same pipeline the autonomous AI uses.
  useEffect(() => {
    if (!symbol) { setOpinion(null); setFailed(false); setLoading(false); return }
    let cancelled = false
    setLoading(true); setFailed(false); setOpinion(null)
    api.get(`/ai/opinion/${symbol}`, {
      params: { portfolio_id: localStorage.getItem('portfolioId') || '2' },
    })
      .then(r => {
        if (cancelled) return
        if (r.data && !r.data.error) setOpinion(r.data)
        else setFailed(true)
        setLoading(false)
      })
      .catch(() => { if (!cancelled) { setFailed(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [symbol])

  // Degraded fallback built from the analysis data prop — used ONLY if the fetch fails.
  const fallback = useMemo(() => {
    if (!data) return null
    const score = Number(data.score ?? 0)
    return {
      score,
      action:       deriveAction(score),
      confidence:   data.strategy?.confidence ?? data.confidence ?? null,
      market_state: data.market_state || data.regime || 'neutral',
      summary:      data.summary || '',
      reasoning:    Array.isArray(data.reasoning) ? data.reasoning : [],
    }
  }, [data])

  const view = opinion || (failed ? fallback : null)

  if (!view) return (
    <div style={{ padding: '24px', textAlign: 'center', color: '#6b7689', fontSize: '13px' }}>
      {loading && symbol ? `Analyzing ${symbol}…` : 'Load a symbol to see AI analysis'}
    </div>
  )

  const score   = Number(view.score ?? 0)
  const action  = view.action || deriveAction(score)
  const conf    = view.confidence
  const ac      = actionColors(action)
  const scoreCol = gradeColor(score)
  const state   = stateMeta(view.market_state)

  const reasons = Array.isArray(view.reasoning) ? view.reasoning.slice(0, 6) : []
  const maxContrib = reasons.reduce((m, r) => Math.max(m, Math.abs(Number(r.contribution) || 0)), 0) || 1

  return (
    <div style={{ fontFamily: 'var(--font-sans)', fontSize: '13px' }}>
      {/* Header — real action, score, confidence + market regime */}
      <div style={{
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(0,0,0,0.15)',
        borderBottom: '1px solid rgba(140,170,220,0.07)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            padding: '3px 12px', borderRadius: '5px', fontSize: '13px', fontWeight: 700,
            background: ac.bg, color: ac.fg, border: `1px solid ${ac.fg}`,
            fontFamily: 'var(--font-mono)',
          }}>{action}</span>
          <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
            <span style={{ color: scoreCol, fontWeight: 700 }}>
              {score > 0 ? '+' : ''}{score.toFixed(1)}
            </span>
            {conf != null && (
              <span style={{ color: '#8b95a7' }}>&nbsp;·&nbsp;{Math.round(conf)}%</span>
            )}
          </span>
        </div>
        {state && (
          <span style={{ fontSize: '11px', color: state.color }}>{state.label}</span>
        )}
      </div>

      <div style={{ padding: '14px' }}>
        {/* Backend summary */}
        {view.summary && (
          <>
            <div style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#6b7689', textTransform: 'uppercase', marginBottom: '8px' }}>
              AI Summary
            </div>
            <p style={{
              margin: 0, color: '#aab4c5', lineHeight: '1.7', fontSize: '12px',
              padding: '10px 12px',
              background: `${ac.fg}08`,
              borderLeft: `2px solid ${ac.fg}44`,
              borderRadius: '0 6px 6px 0',
            }}>
              {view.summary}
            </p>
          </>
        )}

        {/* Ranked signal drivers — width ∝ |contribution|, colored by direction */}
        {reasons.length > 0 && (
          <div style={{ marginTop: view.summary ? '16px' : 0 }}>
            <div style={{ fontSize: '9px', letterSpacing: '0.08em', color: '#6b7689', textTransform: 'uppercase', marginBottom: '10px' }}>
              Signal Drivers
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
              {reasons.map((r, i) => {
                const contrib = Number(r.contribution) || 0
                const bull    = r.direction === 'bullish' || contrib > 0
                const barCol  = bull ? '#3ddc97' : '#ff476f'
                const pct     = Math.max(4, (Math.abs(contrib) / maxContrib) * 100)
                return (
                  <div key={`${r.signal}-${i}`}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11.5px', color: '#c5cdda' }}>
                        {r.signal}
                        <span style={{ color: '#6b7689', fontFamily: 'var(--font-mono)', marginLeft: '6px', fontSize: '10.5px' }}>
                          {fmtVal(r.value)}
                        </span>
                      </span>
                      <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: barCol }}>
                        {contrib > 0 ? '+' : ''}{contrib.toFixed(1)}
                      </span>
                    </div>
                    <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(140,170,220,0.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: barCol, opacity: 0.85, borderRadius: '3px', transition: 'width 0.4s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!view.summary && reasons.length === 0 && (
          <p style={{ margin: 0, color: '#6b7689', fontSize: '12px' }}>
            No strong signals from the model right now.
          </p>
        )}
      </div>
    </div>
  )
}
