import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'

const ISpark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
  </svg>
)

// Build a flat, ordered list of styled lines from the API's section objects.
function toLines(sections) {
  const out = []
  sections.forEach((s, i) => {
    if (i > 0) out.push({ kind: 'blank', text: '' })
    out.push({ kind: 'head', text: `▸ ${s.title.toUpperCase()}`, ok: s.has_data })
    s.lines.forEach(l => out.push({ kind: s.has_data ? 'line' : 'nodata', text: l }))
  })
  return out
}

// Types an array of styled lines out sequentially, character by character.
function Typewriter({ lines, speed = 5 }) {
  const [doneCount, setDoneCount] = useState(0)   // fully-typed lines
  const [partial,   setPartial]   = useState('')  // current line so far
  const idxRef = useRef(0)

  useEffect(() => { setDoneCount(0); setPartial(''); idxRef.current = 0 }, [lines])

  useEffect(() => {
    const i = idxRef.current
    if (i >= lines.length) return
    const full = lines[i].text
    if (partial.length < full.length) {
      const t = setTimeout(() => setPartial(full.slice(0, partial.length + 1)), speed)
      return () => clearTimeout(t)
    }
    // line complete → advance (short pause after headers)
    const t = setTimeout(() => {
      idxRef.current = i + 1
      setDoneCount(i + 1)
      setPartial('')
    }, lines[i].kind === 'head' ? 70 : 16)
    return () => clearTimeout(t)
  }, [partial, doneCount, lines, speed])

  const styleFor = (ln) => (
    ln.kind === 'head'   ? { fontWeight: 700, color: ln.ok ? 'var(--acc-hi, #ff6161)' : 'var(--t-4, #6b7280)', marginTop: 4 }
    : ln.kind === 'nodata' ? { color: 'var(--muted)', fontStyle: 'italic', paddingLeft: 14 }
    : { color: 'var(--t-2, #c7d0dc)', paddingLeft: 14 }
  )

  const typing = idxRef.current < lines.length

  return (
    <div style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12.5, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
      {lines.slice(0, doneCount).map((ln, i) => (
        <div key={i} style={styleFor(ln)}>{ln.text || ' '}</div>
      ))}
      {typing && (
        <div style={styleFor(lines[idxRef.current])}>
          {partial}<span className="tw-caret">▋</span>
        </div>
      )}
    </div>
  )
}

const FILTERS = [
  { key: 'all', label: 'All' }, { key: 'priorities', label: 'Priorities' },
  { key: 'sales', label: 'Sales' }, { key: 'expenses', label: 'Expenses' },
  { key: 'inventory', label: 'Inventory' }, { key: 'reviews', label: 'Reviews' },
  { key: 'labor', label: 'Labor' }, { key: 'cash', label: 'Cash' },
]

export default function AIOptimize({ uid, refreshKey }) {
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [lines,   setLines]   = useState(null)
  const [error,   setError]   = useState(null)
  const [sel,     setSel]     = useState(['all'])

  async function run(selection = sel) {
    setOpen(true); setLoading(true); setError(null); setLines(null)
    try {
      const keys = selection.filter(k => k !== 'all')
      // cache-bust so profile/settings changes are always reflected
      const qs = `?t=${Date.now()}` + (keys.length ? `&sections=${keys.join(',')}` : '')
      const r = await api.get(`/api/optimize/${uid}${qs}`)
      setLines(toLines(r.data.sections || []))
    } catch (e) {
      setError('Could not run optimization. Is the server reachable?')
    } finally {
      setLoading(false)
    }
  }

  // Re-run when the business profile changes, so the tuning shows immediately.
  useEffect(() => { if (open) run(sel) }, [refreshKey])   // eslint-disable-line

  function toggle(key) {
    let next
    if (key === 'all') next = ['all']
    else {
      const base = sel.filter(k => k !== 'all')
      next = base.includes(key) ? base.filter(k => k !== key) : [...base, key]
      if (next.length === 0) next = ['all']
    }
    setSel(next)
    if (open) run(next)
  }

  const isOn = k => sel.includes(k)
  const fewer = sel.filter(k => k !== 'all').length > 0 && sel.filter(k => k !== 'all').length <= 2

  return (
    <div style={{ marginBottom: 18 }}>
      <style>{`@keyframes twblink{0%,49%{opacity:1}50%,100%{opacity:0}} .tw-caret{animation:twblink 1s steps(1) infinite;color:var(--acc-hi,#ff6161);margin-left:1px}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => run(sel)} disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <ISpark />
          {loading ? 'Analyzing…' : 'AI Optimize'}
        </button>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => toggle(f.key)}
              className="btn btn-sm"
              style={{
                fontSize: 11.5, padding: '3px 10px',
                background: isOn(f.key) ? 'var(--acc-soft, rgba(255,59,59,.14))' : 'transparent',
                color: isOn(f.key) ? 'var(--acc-hi, #ff6161)' : 'var(--muted)',
                border: `1px solid ${isOn(f.key) ? 'var(--acc-line, rgba(255,59,59,.3))' : 'var(--border)'}`,
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div className="card" style={{ marginTop: 12, padding: '16px 18px', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ color: 'var(--acc-hi, #ff6161)' }}><ISpark /></span>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.03em' }}>AI OPTIMIZATION</span>
            {fewer && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>· focused deep-dive</span>}
            <button onClick={() => setOpen(false)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
              title="Close">×</button>
          </div>
          {loading && <div style={{ color: 'var(--muted)', fontSize: 12.5, fontFamily: 'var(--font-mono, monospace)' }}>reading your numbers<span className="tw-caret">▋</span></div>}
          {error && <div style={{ color: 'var(--err)', fontSize: 12.5 }}>{error}</div>}
          {lines && <Typewriter lines={lines} />}
        </div>
      )}
    </div>
  )
}
