import { useEffect, useState } from 'react'
import { api } from '../../api'

const INDUSTRIES = [
  ['', 'Select industry…'], ['retail', 'Retail / shop'], ['ecommerce', 'E-commerce / online'],
  ['restaurant', 'Restaurant / food'], ['services', 'Services'],
  ['manufacturing', 'Manufacturing / maker'], ['other', 'Other'],
]
const GOALS = [
  ['grow_revenue', 'Grow revenue'], ['improve_margins', 'Improve margins'],
  ['cut_costs', 'Cut costs'], ['balance', 'Balanced growth'],
]

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--bg-input, var(--bg-card))', color: 'var(--text)',
  border: '1px solid var(--border)', boxSizing: 'border-box',
}
const labelStyle = { fontSize: 11, color: 'var(--muted)', marginBottom: 4, display: 'block', letterSpacing: '.02em' }

export default function BusinessProfile({ uid, onSaved }) {
  const [p, setP] = useState(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    api.get(`/api/business/${uid}`).then(r => {
      setP(r.data)
      if (!r.data.configured) setOpen(true)   // first-time: open the form
    }).catch(() => setP({ configured: false, goal: 'balance' }))
  }, [uid])

  function set(k, v) { setP(prev => ({ ...prev, [k]: v })) }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      await api.put(`/api/business/${uid}`, {
        name: p.name, industry: p.industry, description: p.description, goal: p.goal,
        target_margin: p.target_margin, target_labor_pct: p.target_labor_pct,
      })
      const r = await api.get(`/api/business/${uid}`)
      setP(r.data); setOpen(false); setMsg({ ok: true, text: 'Saved — the AI will use this.' })
      onSaved?.()
    } catch (e) {
      setMsg({ ok: false, text: 'Could not save.' })
    } finally {
      setSaving(false)
    }
  }

  if (!p) return null

  const industryLabel = (INDUSTRIES.find(i => i[0] === p.industry) || [])[1]
  const goalLabel = (GOALS.find(g => g[0] === (p.goal || 'balance')) || [])[1]

  return (
    <div className="card" data-tour="profile" style={{ padding: '14px 16px', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--acc-hi, #ff6161)' }}>
          <path d="M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Business profile</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {p.configured
            ? `${p.name || 'Your business'}${industryLabel ? ' · ' + industryLabel : ''} · ${goalLabel}`
            : 'Tell the AI about your business for sharper, tailored suggestions'}
        </span>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(o => !o)}>
          {open ? 'Close' : (p.configured ? 'Edit' : 'Set up')}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Business name</label>
              <input style={inputStyle} value={p.name || ''} placeholder="Ember & Oak"
                onChange={e => set('name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Industry</label>
              <select style={inputStyle} value={p.industry || ''} onChange={e => set('industry', e.target.value)}>
                {INDUSTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Describe your business — what you sell, who you serve, seasonality, current challenges</label>
            <textarea style={{ ...inputStyle, minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }}
              value={p.description || ''} maxLength={2000}
              placeholder="e.g. Small candle & home-fragrance brand selling online and at local markets. Peak season is Oct–Dec. Trying to grow repeat customers while keeping ad spend under control."
              onChange={e => set('description', e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Primary goal</label>
              <select style={inputStyle} value={p.goal || 'balance'} onChange={e => set('goal', e.target.value)}>
                {GOALS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Target gross margin %</label>
              <input style={inputStyle} type="number" value={p.target_margin ?? ''} placeholder="optional"
                onChange={e => set('target_margin', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Target labor % of sales</label>
              <input style={inputStyle} type="number" value={p.target_labor_pct ?? ''} placeholder="optional"
                onChange={e => set('target_labor_pct', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
            {msg && <span style={{ fontSize: 12, color: msg.ok ? 'var(--ok, #3fb950)' : 'var(--err, #e5534b)' }}>{msg.text}</span>}
          </div>
        </div>
      )}
      {!open && msg && <div style={{ fontSize: 12, color: msg.ok ? 'var(--ok, #3fb950)' : 'var(--err)', marginTop: 8 }}>{msg.text}</div>}
    </div>
  )
}
