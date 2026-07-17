import { useState, useEffect } from 'react'
import api from '../api.js'

// The learning milestone the model is working toward.
const SAMPLE_GOAL = 200

// Human labels for the common rejection reasons the decision log records.
function reasonLabel(r) {
  if (!r) return 'other'
  return String(r).replace(/_/g, ' ')
}

export default function ModelCard({ portfolioId }) {
  const pid = portfolioId || localStorage.getItem('portfolioId') || '2'

  const [status,    setStatus]    = useState(null)
  const [decisions, setDecisions] = useState(null)
  const [retraining, setRetraining] = useState(false)
  const [retrainRes, setRetrainRes] = useState(null)   // { synthetic_samples, real_samples, features } | { error }

  // ── Fetch model status + decision summary (poll gently) ──
  useEffect(() => {
    if (!pid) return
    let alive = true

    function load() {
      api.get('/ai/status', { params: { portfolio_id: pid } })
        .then(r => { if (alive) setStatus(r.data) })
        .catch(() => {})
      api.get(`/portfolios/${pid}/decisions/summary`, { params: { days: 7 } })
        .then(r => { if (alive) setDecisions(r.data) })
        .catch(() => {})
    }

    load()
    const id = setInterval(load, 20000)
    return () => { alive = false; clearInterval(id) }
  }, [pid])

  function handleRetrain() {
    setRetraining(true); setRetrainRes(null)
    api.post('/ai/model/retrain')
      .then(r => {
        const d = r.data || {}
        if (d.ok === false) setRetrainRes({ error: d.error || 'failed' })
        else setRetrainRes({
          synthetic_samples: d.synthetic_samples,
          real_samples:      d.real_samples,
          features:          d.features,
        })
        // Refresh status so the learning bar reflects the new count.
        api.get('/ai/status', { params: { portfolio_id: pid } })
          .then(res => setStatus(res.data)).catch(() => {})
      })
      .catch(() => setRetrainRes({ error: 'failed' }))
      .finally(() => setRetraining(false))
  }

  const s          = status || {}
  const ready      = !!s.model_ready
  const real       = Number(s.real_samples || 0)
  const universe   = s.universe_size
  const features   = s.features   // not always present in status payload
  const pct        = Math.min(100, Math.round((real / SAMPLE_GOAL) * 100))

  const dotColor   = ready ? '#3ddc97' : '#f5b342'
  const readyLabel = ready ? 'READY' : 'WARMING UP'

  // by_reason: { reason: { count, pct } }
  const byReason = decisions?.by_reason && typeof decisions.by_reason === 'object'
    ? Object.entries(decisions.by_reason)
        .map(([reason, v]) => ({ reason, count: v?.count ?? 0, pct: v?.pct ?? 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
    : []
  const maxReason = byReason.reduce((m, r) => Math.max(m, r.count), 0) || 1

  return (
    <div style={{
      fontFamily: 'var(--font-sans)',
      background: 'var(--card-bg)',
      border: 'var(--card-border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--card-shadow)',
      padding: '12px 14px',
    }}>
      {/* ── Header: ready dot + label ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: dotColor, boxShadow: `0 0 7px ${dotColor}`,
          animation: ready ? 'ap-pulse 2s ease-in-out infinite' : 'none',
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700, color: 'var(--t-2)',
          letterSpacing: '0.1em', textTransform: 'uppercase',
        }}>
          Trading Model
        </span>
        <span style={{
          fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
          color: dotColor, letterSpacing: '0.06em',
        }}>
          {readyLabel}
        </span>

        <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {features != null && (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-4)' }}>
              features: <span style={{ color: 'var(--t-3)' }}>{features}</span>
            </span>
          )}
          {universe != null && (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-4)' }}>
              universe: <span style={{ color: 'var(--t-3)' }}>{universe}</span>
            </span>
          )}
        </span>
      </div>

      {/* ── LEARNING progress toward sample goal ── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{
            fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: '#b39dff',
          }}>
            Learning
          </span>
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-4)' }}>
            {real} / {SAMPLE_GOAL}
          </span>
        </div>
        <div style={{
          height: 7, borderRadius: 4, overflow: 'hidden',
          background: 'rgba(140,170,220,0.08)',
        }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: 'linear-gradient(90deg, #b39dff, #3ddc97)',
            borderRadius: 4, transition: 'width 0.5s ease',
          }} />
        </div>
        <div style={{ fontSize: 9.5, color: 'var(--t-3)', marginTop: 5, lineHeight: 1.5 }}>
          AI has learned from <span style={{ color: 'var(--t-1)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{real}</span> closed trade{real === 1 ? '' : 's'}
        </div>
      </div>

      {/* ── Retrain button + result ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: byReason.length ? 12 : 0 }}>
        <button
          onClick={handleRetrain}
          disabled={retraining}
          title="Retrain the model on the synthetic prior + every closed-trade outcome logged so far"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 6,
            border: '1px solid rgba(179,157,255,0.4)',
            background: 'rgba(179,157,255,0.12)', color: '#b39dff',
            fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--font-sans)',
            cursor: retraining ? 'default' : 'pointer',
            opacity: retraining ? 0.7 : 1, whiteSpace: 'nowrap',
          }}
        >
          {retraining && (
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              border: '2px solid rgba(179,157,255,0.35)', borderTopColor: '#b39dff',
              animation: 'ap-spin .7s linear infinite', display: 'inline-block',
            }} />
          )}
          {retraining ? 'Retraining…' : 'Retrain now'}
        </button>

        {retrainRes && !retraining && (
          retrainRes.error ? (
            <span style={{ fontSize: 9.5, color: 'var(--err)', fontFamily: 'var(--font-mono)' }}>
              ✕ {retrainRes.error}
            </span>
          ) : (
            <span style={{ fontSize: 9.5, color: 'var(--t-3)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
              <span style={{ color: '#3ddc97', fontWeight: 700 }}>✓ trained</span>
              {' · '}
              <span style={{ color: 'var(--t-2)' }}>{retrainRes.real_samples ?? 0}</span> real
              {' + '}
              <span style={{ color: 'var(--t-2)' }}>{retrainRes.synthetic_samples ?? 0}</span> synthetic
              {retrainRes.features != null && (
                <> {' · '}<span style={{ color: 'var(--t-2)' }}>{retrainRes.features}</span> feats</>
              )}
            </span>
          )
        )}
      </div>

      {/* ── Top rejection reasons (decision log) ── */}
      {byReason.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(140,170,220,0.08)', paddingTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{
              fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--t-4)',
            }}>
              Why trades were rejected
            </span>
            {decisions?.accept_rate != null && (
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--t-4)' }}>
                accept {decisions.accept_rate}% · {decisions.total ?? 0} decisions
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {byReason.map(({ reason, count }) => {
              const w = Math.max(4, (count / maxReason) * 100)
              return (
                <div key={reason}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                    <span style={{ fontSize: 9.5, color: 'var(--t-3)', fontFamily: 'var(--font-mono)' }}>
                      {reasonLabel(reason)}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--t-4)', fontFamily: 'var(--font-mono)' }}>{count}</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 3, background: 'rgba(140,170,220,0.07)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${w}%`, background: '#f5b342', opacity: 0.7, borderRadius: 3, transition: 'width 0.4s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
