import { useState } from 'react'
import { api } from '../api'
import { PLANS_BY_SEGMENT } from './PricingModal'

// ── Icons ─────────────────────────────────────────────────────────────────────
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <line x1="3" y1="3" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15" y1="3" x2="3" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
function StoreIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l1.5-5h15L21 9M4 9v10a1 1 0 001 1h14a1 1 0 001-1V9M3 9h18M9 20v-6h6v6" />
    </svg>
  )
}
function WalletIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20M16 14h2" />
    </svg>
  )
}

const SEGMENTS = [
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'small_biz',  label: 'Small Business' },
  { key: 'individual', label: 'Individual' },
]

const KINDS = [
  { key: 'location',        label: 'Location',        desc: 'A physical business location with sales, labor & POS data', Icon: StoreIcon },
  { key: 'expense_account', label: 'Expense Account', desc: 'A money/expense-tracking profile tied to bank accounts',     Icon: WalletIcon },
]

// AddWorkspaceModal — two-step flow:
//   step 1: name + type (location / expense account) + segment
//   step 2: plan selection (reuses the segment pricing data)
export default function AddWorkspaceModal({ uid, defaultSegment = 'restaurant', onClose, onCreated }) {
  const [step,     setStep]     = useState(1)
  const [name,     setName]     = useState('')
  const [kind,     setKind]     = useState('location')
  const [segment,  setSegment]  = useState(defaultSegment || 'restaurant')
  const [plan,     setPlan]     = useState('free')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const plans = PLANS_BY_SEGMENT[segment] || PLANS_BY_SEGMENT.restaurant

  function goNext() {
    if (!name.trim()) { setError('Please enter a name'); return }
    setError('')
    setStep(2)
  }

  async function handleCreate() {
    if (!uid) { setError('Not signed in'); return }
    setSaving(true)
    setError('')
    try {
      const r = await api.post(`/api/workspaces/${uid}`, {
        name: name.trim(), kind, plan, segment,
      })
      if (r.data?.id) {
        onCreated?.(r.data)
      } else {
        setError(r.data?.error || 'Could not create workspace')
        setSaving(false)
      }
    } catch (ex) {
      setError(ex.response?.data?.error || ex.message || 'Could not create workspace')
      setSaving(false)
    }
  }

  return (
    <div className="ws-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ws-modal">
        <button className="ws-close" onClick={onClose} title="Close"><CloseIcon /></button>

        <div className="ws-head">
          <h2>{step === 1 ? 'Add a new profile' : 'Choose a plan'}</h2>
          <p>
            {step === 1
              ? 'Create a new location or expense-tracking account. Each profile keeps its own data and plan.'
              : `Pick the plan for "${name.trim()}". You can change it anytime.`}
          </p>
          <div className="ws-steps">
            <span className={`ws-step-dot${step >= 1 ? ' on' : ''}`} />
            <span className="ws-step-line" />
            <span className={`ws-step-dot${step >= 2 ? ' on' : ''}`} />
          </div>
        </div>

        {step === 1 && (
          <div className="ws-body">
            <label className="ws-label">Name</label>
            <input
              className="input-field"
              placeholder={kind === 'location' ? 'e.g. Downtown Cafe' : 'e.g. Operating Expenses'}
              value={name}
              autoFocus
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && goNext()}
            />

            <label className="ws-label" style={{ marginTop: 16 }}>Type</label>
            <div className="ws-kinds">
              {KINDS.map(k => (
                <button
                  key={k.key}
                  type="button"
                  className={`ws-kind${kind === k.key ? ' on' : ''}`}
                  onClick={() => setKind(k.key)}
                >
                  <span className="ws-kind-icn"><k.Icon /></span>
                  <span className="ws-kind-name">{k.label}</span>
                  <span className="ws-kind-desc">{k.desc}</span>
                </button>
              ))}
            </div>

            <label className="ws-label" style={{ marginTop: 16 }}>Profile category</label>
            <div className="ws-seg">
              {SEGMENTS.map(s => (
                <button
                  key={s.key}
                  type="button"
                  className={segment === s.key ? 'on' : ''}
                  onClick={() => setSegment(s.key)}
                >{s.label}</button>
              ))}
            </div>

            {error && <div className="ws-error">{error}</div>}

            <div className="ws-actions">
              <button className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={goNext}>Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="ws-body">
            <div className="ws-plan-grid">
              {plans.map(p => {
                const selected = p.key === plan
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`ws-plan${selected ? ' on' : ''}${p.highlight ? ' hl' : ''}`}
                    onClick={() => setPlan(p.key)}
                  >
                    {p.badge && <span className="ws-plan-badge">{p.badge}</span>}
                    <span className="ws-plan-name">{p.name}</span>
                    <span className="ws-plan-price">
                      <span className="amt">{p.price}</span>
                      {p.period && <span className="per">{p.period}</span>}
                    </span>
                    <span className="ws-plan-tag">{p.tagline}</span>
                    {selected && <span className="ws-plan-check">Selected</span>}
                  </button>
                )
              })}
            </div>

            {error && <div className="ws-error">{error}</div>}

            <div className="ws-actions">
              <button className="btn btn-outline" onClick={() => setStep(1)} disabled={saving}>Back</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating…' : 'Create profile'}
              </button>
            </div>
            <p className="ws-note">
              No payment is collected here — the selected plan is saved with the profile.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
