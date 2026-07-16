import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'

// Live product recognition: enroll items by holding them to the Jetson's USB
// webcam, then scan & count them checkout-style. The camera is captured
// server-side and streamed as MJPEG, so this works on localhost AND over the LAN
// (no browser camera permission / HTTPS needed).

const ACC = 'var(--acc-hi, #ff6161)'

function ScoreBar({ score, matched }) {
  const pct = Math.max(0, Math.min(100, Math.round((score || 0) * 100)))
  return (
    <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4,
        background: matched ? 'var(--ok, #3fb950)' : ACC, transition: 'width .2s' }} />
    </div>
  )
}

export default function CameraScan({ uid, onClose, onApplied }) {
  const [tab, setTab]           = useState('scan')      // 'scan' | 'enroll'
  const [enrolled, setEnrolled] = useState([])
  const [tally, setTally]       = useState({})          // sku -> {product, count}
  const [live, setLive]         = useState(false)
  const [status, setStatus]     = useState(null)        // last recognize result
  const [camRunning, setCam]    = useState(null)

  // enroll form
  const [name, setName]         = useState('')
  const [sku, setSku]           = useState('')
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState(null)
  const [refs, setRefs]         = useState([])   // manually captured references: [{blob, url}]

  const cooldown = useRef({})   // sku -> last-counted timestamp
  const loopRef  = useRef(null)
  const fileRef  = useRef(null)
  const refsRef  = useRef(refs); refsRef.current = refs
  useEffect(() => () => { refsRef.current.forEach(r => URL.revokeObjectURL(r.url)) }, [])

  const loadEnrolled = () =>
    api.get(`/api/inventory/enrolled/${uid}`).then(r => setEnrolled(r.data.enrolled || [])).catch(() => {})

  useEffect(() => { loadEnrolled() }, [uid])

  // The guided tour switches between the Scan and Enroll tabs via a window event.
  useEffect(() => {
    const onTab = e => { if (e.detail === 'scan' || e.detail === 'enroll') setTab(e.detail) }
    window.addEventListener('summit-scan-tab', onTab)
    return () => window.removeEventListener('summit-scan-tab', onTab)
  }, [])

  // poll camera status for the "camera ready / not detected" badge
  useEffect(() => {
    let stop = false
    const check = () => api.get('/api/camera/status')
      .then(r => { if (!stop) setCam(!!(r.data.running || r.data.has_frame)) })
      .catch(() => { if (!stop) setCam(false) })
    check(); const id = setInterval(check, 3000)
    return () => { stop = true; clearInterval(id) }
  }, [])

  // scan loop — recognize the latest live frame ~1.4×/sec, count with a per-SKU cooldown
  useEffect(() => {
    if (!live) return
    let stopped = false
    async function tick() {
      if (stopped) return
      try {
        const r = await api.post(`/api/inventory/recognize/${uid}`, {})
        const m = r.data || {}
        if (!stopped) setStatus(m)
        if (m.matched && m.sku) {
          const now = Date.now()
          if (now - (cooldown.current[m.sku] || 0) > 2500) {   // 2.5s per-item cooldown
            cooldown.current[m.sku] = now
            setTally(t => ({ ...t, [m.sku]: { product: m.product, count: (t[m.sku]?.count || 0) + 1 } }))
          }
        }
      } catch { /* keep looping */ }
      if (!stopped) loopRef.current = setTimeout(tick, 700)
    }
    tick()
    return () => { stopped = true; clearTimeout(loopRef.current) }
  }, [live, uid])

  // Capture ONE reference from the ROI hitbox (server returns just the cropped
  // region, so it matches exactly what the scanner will embed).
  async function captureRef() {
    if (!camRunning) { setMsg({ ok: false, text: 'No camera detected — plug in the USB webcam.' }); return }
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/camera/snapshot?roi=1&t=${Date.now()}`)
      const blob = await res.blob()
      setRefs(r => [...r, { blob, url: URL.createObjectURL(blob) }])
    } catch {
      setMsg({ ok: false, text: 'Capture failed.' })
    } finally { setBusy(false) }
  }

  function addFiles(files) {
    const add = [...files].map(f => ({ blob: f, url: URL.createObjectURL(f) }))
    if (add.length) setRefs(r => [...r, ...add])
    if (fileRef.current) fileRef.current.value = ''
  }

  function removeRef(i) {
    setRefs(r => { const n = [...r]; const [x] = n.splice(i, 1); if (x) URL.revokeObjectURL(x.url); return n })
  }

  async function saveProduct() {
    if (!name.trim()) { setMsg({ ok: false, text: 'Enter a product name.' }); return }
    if (!refs.length) { setMsg({ ok: false, text: 'Capture at least one reference first.' }); return }
    setBusy(true); setMsg(null)
    const fd = new FormData()
    fd.append('product', name.trim()); if (sku.trim()) fd.append('sku', sku.trim())
    refs.forEach((r, i) => fd.append('file', r.blob, `ref${i}.jpg`))
    try {
      const r = await api.post(`/api/inventory/enroll/${uid}`, fd)
      setMsg({ ok: true, text: `Enrolled “${r.data.product}” — ${r.data.ref_count} reference photo${r.data.ref_count === 1 ? '' : 's'}.` })
      setName(''); setSku('')
      refs.forEach(x => URL.revokeObjectURL(x.url)); setRefs([])
      loadEnrolled()
    } catch {
      setMsg({ ok: false, text: 'Enroll failed.' })
    } finally { setBusy(false) }
  }

  async function removeEnrolled(s) {
    await api.del(`/api/inventory/enroll/${uid}/${encodeURIComponent(s)}`).catch(() => {})
    loadEnrolled()
  }

  function bump(s, product, d) {
    setTally(t => {
      const c = (t[s]?.count || 0) + d
      const n = { ...t }
      if (c <= 0) delete n[s]; else n[s] = { product, count: c }
      return n
    })
  }

  async function applyCount() {
    const items = Object.entries(tally).map(([s, v]) => ({ sku: s, delta: v.count, product: v.product })).filter(i => i.delta > 0)
    if (!items.length) return
    setBusy(true)
    try {
      await api.post(`/api/inventory/count/${uid}`, { items })
      setTally({}); cooldown.current = {}
      onApplied?.()
      onClose?.()
    } finally { setBusy(false) }
  }

  const tallyRows  = Object.entries(tally)
  const tallyTotal = tallyRows.reduce((a, [, v]) => a + v.count, 0)

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{
        width: 'min(940px, 96vw)', padding: 0, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.5)',
      }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={ACC} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
          </svg>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Visual inventory scanner</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: camRunning ? 'var(--ok,#3fb950)' : 'var(--muted)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: camRunning ? 'var(--ok,#3fb950)' : 'var(--muted)' }} />
            {camRunning === null ? 'checking camera…' : camRunning ? 'camera live' : 'no camera detected'}
          </span>
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
        </div>

        {/* tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '10px 18px 0' }}>
          {[['scan', 'Scan & count'], ['enroll', 'Enrolled products']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className="btn btn-sm"
              style={{ background: tab === k ? ACC : 'transparent', color: tab === k ? '#fff' : 'var(--text)',
                border: tab === k ? 'none' : '1px solid var(--border)' }}>{label}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16, padding: 18 }}>
          {/* left: shared livestream */}
          <div>
            <div data-tour="scan-stream" style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#111', border: '1px solid var(--border)' }}>
              <img src="/api/camera/stream" alt="Live camera" style={{ width: '100%', display: 'block', aspectRatio: '4 / 3', objectFit: 'cover' }} />
              {/* ROI hitbox — must match ROI in analysis/vision_embed.py (0.215,0.12 → 0.785,0.88) */}
              <div style={{ position: 'absolute', left: '21.5%', top: '12%', width: '57%', height: '76%',
                border: `2px solid ${ACC}`, borderRadius: 10, boxShadow: '0 0 0 2000px rgba(0,0,0,.30)', pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', bottom: 5, left: 0, right: 0, textAlign: 'center',
                  fontSize: 10.5, fontWeight: 600, color: '#fff', textShadow: '0 1px 3px #000', letterSpacing: '.02em' }}>
                  hold item in the box
                </span>
              </div>
              {tab === 'scan' && live && (
                <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(0,0,0,.55)', color: '#fff', padding: '4px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4b4b', animation: 'camrec 1.1s infinite' }} />
                  scanning
                </div>
              )}
              <style>{`@keyframes camrec{0%,100%{opacity:1}50%{opacity:.25}}`}</style>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
              Live feed from the Jetson's USB webcam. Hold a product steady in the frame.
            </div>
          </div>

          {/* right: mode-specific panel */}
          <div>
            {tab === 'scan' ? (
              <div data-tour="scan-count">
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setLive(v => !v)} disabled={!enrolled.length}
                    style={{ opacity: enrolled.length ? 1 : .5 }}>
                    {live ? '❚❚ Pause' : '▶ Start scanning'}
                  </button>
                  {!enrolled.length && <span style={{ fontSize: 11.5, color: 'var(--muted)', alignSelf: 'center' }}>Enroll a product first →</span>}
                </div>

                {live && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, color: status?.matched ? 'var(--ok,#3fb950)' : 'var(--muted)' }}>
                        {status?.matched ? `✓ ${status.product}` : (status?.product ? 'unsure…' : 'looking…')}
                      </span>
                      <span style={{ color: 'var(--muted)' }}>{status ? `${Math.round((status.score || 0) * 100)}%` : ''}</span>
                    </div>
                    <ScoreBar score={status?.score} matched={status?.matched} />
                    {status && !status.matched && status.product && status.score >= 0.5 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Unsure — tap to add:</span>
                        <button className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={() => bump(status.sku, status.product, +1)}>{status.product} +1</button>
                        {status.runner_up_sku && (
                          <button className="btn btn-sm" style={{ padding: '2px 8px' }} onClick={() => bump(status.runner_up_sku, status.runner_up, +1)}>{status.runner_up} +1</button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>
                  TALLY {tallyTotal ? `· ${tallyTotal} item${tallyTotal === 1 ? '' : 's'}` : ''}
                </div>
                {tallyRows.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 0' }}>
                    Nothing counted yet. Start scanning and hold items up one at a time.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto' }}>
                    {tallyRows.map(([s, v]) => (
                      <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'var(--hairline, rgba(140,170,220,.08))' }}>
                        <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.product}</span>
                        <button className="btn btn-sm" style={{ padding: '2px 9px' }} onClick={() => bump(s, v.product, -1)}>−</button>
                        <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{v.count}</span>
                        <button className="btn btn-sm" style={{ padding: '2px 9px' }} onClick={() => bump(s, v.product, +1)}>+</button>
                      </div>
                    ))}
                  </div>
                )}

                <button className="btn btn-primary btn-sm" style={{ marginTop: 14, width: '100%' }}
                  disabled={!tallyTotal || busy} onClick={applyCount}>
                  {busy ? 'Applying…' : `Apply ${tallyTotal || ''} to inventory`}
                </button>
              </div>
            ) : (
              <div data-tour="scan-enroll">
                <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Product name (e.g. iPhone 15 / AirPods Pro)"
                    style={inp} />
                  <input value={sku} onChange={e => setSku(e.target.value)} placeholder="SKU (optional — auto-generated if blank)"
                    style={inp} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={captureRef} disabled={busy || !camRunning}>
                      {busy ? 'Capturing…' : `＋ Capture reference${refs.length ? ` · ${refs.length}` : ''}`}
                    </button>
                    <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}>Upload</button>
                    <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                      onChange={e => addFiles(e.target.files)} />
                  </div>
                </div>

                {/* captured references — remove any bad shot before saving */}
                {refs.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {refs.map((r, i) => (
                      <div key={i} style={{ position: 'relative' }}>
                        <img src={r.url} alt="" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 7, border: '1px solid var(--border)', display: 'block' }} />
                        <button onClick={() => removeRef(i)} title="Remove"
                          style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none',
                            background: 'var(--err,#e5534b)', color: '#fff', fontSize: 12, lineHeight: '18px', cursor: 'pointer', padding: 0 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}

                <button className="btn btn-primary btn-sm" style={{ width: '100%' }}
                  onClick={saveProduct} disabled={busy || !name.trim() || !refs.length}>
                  {busy ? 'Saving…' : `Save product${refs.length ? ` · ${refs.length} photo${refs.length === 1 ? '' : 's'}` : ''}`}
                </button>
                {msg && <div style={{ fontSize: 11.5, marginTop: 8, color: msg.ok ? 'var(--ok,#3fb950)' : 'var(--err,#e5534b)' }}>{msg.text}</div>}
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
                  Hold the item inside the box on the left and click <b>Capture reference</b> from 3–5 angles (rotate &amp; tilt it between shots), then <b>Save product</b>. More varied angles = more accurate scanning.
                </div>

                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', margin: '14px 0 8px' }}>
                  ENROLLED · {enrolled.length}
                </div>
                {enrolled.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>No products enrolled yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                    {enrolled.map(e => (
                      <div key={e.sku} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'var(--hairline, rgba(140,170,220,.08))' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.product}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', fontFamily: 'monospace' }}>{e.sku} · {e.ref_count} ref{e.ref_count === 1 ? '' : 's'}</div>
                        </div>
                        <button className="btn btn-sm" style={{ padding: '2px 9px', color: 'var(--err,#e5534b)' }} onClick={() => removeEnrolled(e.sku)}>Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const inp = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
  background: 'var(--bg-input, var(--bg-card))', color: 'var(--text)', border: '1px solid var(--border)',
}
