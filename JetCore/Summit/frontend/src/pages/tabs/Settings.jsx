import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { ACCENT_OPTIONS, getStoredAccent, setStoredAccent } from '../../accent'

function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const size = Math.min(img.width, img.height)
      const dim  = Math.min(size, 256)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = dim
      const ctx = canvas.getContext('2d')
      const sx = (img.width  - size) / 2
      const sy = (img.height - size) / 2
      ctx.drawImage(img, sx, sy, size, size, 0, 0, dim, dim)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = url
  })
}

const SEGMENT_META = {
  individual: { label: 'Individual',     icon: '👤', desc: 'Personal finance & budgeting' },
  small_biz:  { label: 'Small Business', icon: '🏪', desc: 'Cash flow & expense tracking' },
  restaurant: { label: 'Restaurant',     icon: '🍽️', desc: 'Labor, POS & reconciliation' },
}

const PRICING = {
  individual: 7.99,
  small_biz:  12.99,
  restaurant: 19.99,
}

function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark'
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem('theme', t)
}

export default function Settings({ uid, plan, onUpgrade }) {
  const nav = useNavigate()
  const [user,           setUser]           = useState(null)
  const [showDanger,     setShowDanger]     = useState(false)
  const [clearing,       setClearing]       = useState(false)
  const [theme,          setTheme]          = useState(getTheme)
  const [accent,         setAccent]         = useState(getStoredAccent)
  const [profilePic,     setProfilePic]     = useState(() => localStorage.getItem('profile_pic') || '')
  const [threshold,      setThreshold]      = useState(35)
  const [alertsEnabled,  setAlertsEnabled]  = useState(true)
  const [settingsSaved,  setSettingsSaved]  = useState(false)
  const [segmentEditing, setSegmentEditing] = useState(false)
  const [segmentNew,     setSegmentNew]     = useState('')
  const [segmentPw,      setSegmentPw]      = useState('')
  const [segmentSaving,  setSegmentSaving]  = useState(false)
  const [segmentErr,     setSegmentErr]     = useState('')
  const [segmentDone,    setSegmentDone]    = useState('')
  const picInputRef = useRef(null)
  const isAdmin = localStorage.getItem('is_admin') === '1'
  const [segment, setSegment] = useState(localStorage.getItem('segment') || 'individual')
  const canAlerts = ['pro', 'max', 'enterprise'].includes(plan)

  const firstName = localStorage.getItem('first_name') || ''
  const lastName  = localStorage.getItem('last_name')  || ''
  const email     = localStorage.getItem('email') || ''
  const initials  = (firstName?.[0] || email?.[0] || '?').toUpperCase() +
                    (lastName?.[0] || '').toUpperCase()

  async function handlePicChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const compressed = await compressImage(file)
    localStorage.setItem('profile_pic', compressed)
    setProfilePic(compressed)
    window.dispatchEvent(new CustomEvent('jetcore:profile-updated'))
    e.target.value = ''
    api.put(`/api/user/${uid}/avatar`, { avatar: compressed }).catch(() => {})
  }

  function removePic() {
    localStorage.removeItem('profile_pic')
    setProfilePic('')
    window.dispatchEvent(new CustomEvent('jetcore:profile-updated'))
    api.put(`/api/user/${uid}/avatar`, { avatar: null }).catch(() => {})
  }

  useEffect(() => {
    api.get(`/api/user/${uid}`).then(r => {
      setUser(r.data)
      if (!localStorage.getItem('profile_pic') && r.data.avatar) {
        localStorage.setItem('profile_pic', r.data.avatar)
        setProfilePic(r.data.avatar)
        window.dispatchEvent(new CustomEvent('jetcore:profile-updated'))
      }
    }).catch(() => {})
    api.get(`/api/settings/${uid}`).then(r => {
      setThreshold(r.data.labor_threshold_pct ?? 35)
      setAlertsEnabled(r.data.alerts_enabled ?? true)
    }).catch(() => {})
  }, [uid])

  async function saveAlertSettings() {
    await api.post(`/api/settings/${uid}`, { labor_threshold_pct: Number(threshold), alerts_enabled: alertsEnabled })
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2500)
  }

  function switchTheme(t) {
    applyTheme(t)
    setTheme(t)
  }

  function switchAccent(hex) {
    setStoredAccent(hex)   // persists to localStorage + applies --acc* live
    setAccent(hex)
  }

  async function saveSegment() {
    if (!segmentNew || segmentNew === segment) { setSegmentEditing(false); return }
    if (!segmentPw) { setSegmentErr('Enter your password to confirm this change'); return }
    setSegmentSaving(true); setSegmentErr('')
    try {
      const r = await api.put(`/api/user/${uid}/segment`, {
        segment: segmentNew,
        password: segmentPw,
        email: localStorage.getItem('email') || '',
      })
      localStorage.setItem('segment', r.data.segment)
      setSegment(r.data.segment)
      setSegmentEditing(false)
      setSegmentPw('')
      setSegmentNew('')
      setSegmentDone('Account type updated!')
      setTimeout(() => setSegmentDone(''), 3000)
    } catch (ex) {
      setSegmentErr(ex.response?.data?.error || 'Update failed')
    } finally { setSegmentSaving(false) }
  }

  async function clearDb() {
    if (!window.confirm('Clear ALL data? This cannot be undone.')) return
    setClearing(true)
    try {
      await api.post('/admin/clear-database-dev', { user_id: uid })
      localStorage.clear()
      nav('/login')
    } catch (ex) {
      alert(ex.response?.data?.error || 'Failed')
    } finally { setClearing(false) }
  }

  function logoutAll() {
    localStorage.clear()
    nav('/login')
  }

  return (
    <div>
      {/* ── Profile Picture ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 700 }}>Profile Picture</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            className="sb-avatar"
            style={{ width: 72, height: 72, fontSize: 22, cursor: 'pointer', flexShrink: 0 }}
            onClick={() => picInputRef.current?.click()}
            title="Click to change photo"
          >
            {profilePic
              ? <img src={profilePic} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              : initials}
          </div>
          <div>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
              Click the avatar or use the button below. Square images crop best — resized automatically to 256×256.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => picInputRef.current?.click()}>
                Change Photo
              </button>
              {profilePic && (
                <button className="btn btn-outline btn-sm" onClick={removePic}>Remove</button>
              )}
            </div>
          </div>
        </div>
        <input ref={picInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePicChange} />
      </div>

      {/* ── Appearance ──────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 700 }}>Appearance</h3>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Theme</p>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              {theme === 'dark' ? 'GitHub Dark' : 'GitHub Light'}
            </p>
          </div>
          <div className="theme-toggle">
            <button className={theme === 'light' ? 'active' : ''} onClick={() => switchTheme('light')}>
              Light
            </button>
            <button className={theme === 'dark' ? 'active' : ''} onClick={() => switchTheme('dark')}>
              Dark
            </button>
          </div>
        </div>

        <hr className="separator" style={{ margin: '16px 0' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Accent color</p>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              Used for highlights, buttons & active states
            </p>
          </div>
          <div className="accent-swatches">
            {ACCENT_OPTIONS.map(opt => (
              <button
                key={opt.hex}
                type="button"
                className={`accent-swatch${accent.toLowerCase() === opt.hex.toLowerCase() ? ' active' : ''}`}
                style={{ '--sw': opt.hex }}
                title={opt.name}
                aria-label={opt.name}
                onClick={() => switchAccent(opt.hex)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Account Type ────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: segmentEditing ? 16 : 0 }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Account Type</h3>
            {!segmentEditing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ fontSize: 18 }}>{SEGMENT_META[segment]?.icon}</span>
                <span style={{ fontWeight: 600 }}>{SEGMENT_META[segment]?.label}</span>
                <span style={{ color: 'var(--muted)' }}>— {SEGMENT_META[segment]?.desc}</span>
              </div>
            )}
          </div>
          {!segmentEditing && (
            <button className="btn btn-outline btn-sm" onClick={() => { setSegmentEditing(true); setSegmentNew(segment); setSegmentErr('') }}>
              Change
            </button>
          )}
        </div>

        {segmentEditing && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {Object.entries(SEGMENT_META).map(([key, meta]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSegmentNew(key)}
                  style={{
                    padding: '12px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                    border: `2px solid ${segmentNew === key ? 'var(--accent)' : 'var(--border)'}`,
                    background: segmentNew === key ? 'rgba(255,106,26,.1)' : 'var(--surface)',
                    transition: 'border-color .15s, background .15s',
                  }}
                >
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{meta.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: segmentNew === key ? 'var(--accent)' : 'var(--text)' }}>{meta.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{meta.desc}</div>
                </button>
              ))}
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Confirm your password to save this change
              </label>
              <input
                className="input-field"
                type="password"
                placeholder="Current password"
                value={segmentPw}
                onChange={e => setSegmentPw(e.target.value)}
                style={{ maxWidth: 280, marginBottom: 0 }}
                onKeyDown={e => e.key === 'Enter' && saveSegment()}
              />
            </div>

            {segmentErr && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>{segmentErr}</p>}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={saveSegment} disabled={segmentSaving}>
                {segmentSaving ? <span className="spinner" /> : 'Save Change'}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => { setSegmentEditing(false); setSegmentErr(''); setSegmentPw('') }}>
                Cancel
              </button>
            </div>
          </>
        )}

        {segmentDone && <p style={{ fontSize: 12, color: 'var(--green)', marginTop: 10 }}>{segmentDone}</p>}
      </div>

      {/* ── Subscription + Account ───────────────────────────────────────────── */}
      <div className="two-col" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 15, fontWeight: 700 }}>Subscription</h3>
          {plan === 'free' ? (
            <>
              <p style={{ fontSize: 13, marginBottom: 8 }}>You are on the <strong>Free</strong> plan.</p>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                Upgrade to <strong>Pro</strong> for <strong>${PRICING[segment]?.toFixed(2) ?? '9.99'}/month</strong> to unlock
                unlimited connected accounts, 60+ days history, and priority support.
              </p>
              <button className="btn btn-primary" onClick={() => alert('Stripe checkout coming soon. Contact us to upgrade.')}>
                Upgrade to Pro
              </button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, marginBottom: 8 }}>You are on the <strong>Pro</strong> plan.</p>
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Enjoy unlimited accounts and full historical data access.</p>
            </>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 15, fontWeight: 700 }}>Account Info</h3>
          {user ? (
            <div style={{ fontSize: 13 }}>
              <p style={{ marginBottom: 6 }}><strong>Email:</strong> {user.email}</p>
              <p style={{ marginBottom: 6 }}><strong>Segment:</strong> {(user.segment || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
              {user.company_name && <p style={{ marginBottom: 6 }}><strong>Company:</strong> {user.company_name}</p>}
              <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Member since: {(user.created_at || '').slice(0, 10)}</p>
            </div>
          ) : (
            <span className="spinner" />
          )}
        </div>
      </div>

      {/* ── Cost Alerts ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 4, fontSize: 15, fontWeight: 700 }}>Cost Alerts & Thresholds</h3>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
          Get warned when your labor cost percentage is on pace to exceed your target.
        </p>
        {!canAlerts ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Cost alerts require Pro or higher.</p>
            {onUpgrade && <button className="btn btn-primary btn-sm" onClick={onUpgrade}>Upgrade</button>}
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Labor Cost % Threshold
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="number"
                    className="input-field"
                    style={{ width: 80, marginBottom: 0 }}
                    min={10} max={80} step={0.5}
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                  />
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>%</span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  Industry benchmark: 25–35% for most restaurants
                </p>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Alerts</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={alertsEnabled}
                    onChange={e => setAlertsEnabled(e.target.checked)}
                  />
                  Show alerts on dashboard
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="btn btn-primary btn-sm" onClick={saveAlertSettings}>Save</button>
              {settingsSaved && <span style={{ fontSize: 12, color: 'var(--green)' }}>Saved!</span>}
            </div>
          </div>
        )}
      </div>

      <hr className="separator" />

      {/* ── Danger zone ─────────────────────────────────────────────────────── */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--red)', marginBottom: 12 }}>Danger Zone</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 16, color: 'var(--muted)' }}>
          <input type="checkbox" checked={showDanger} onChange={e => setShowDanger(e.target.checked)} />
          Show dangerous options
        </label>

        {showDanger && (
          <div>
            <div className="alert alert-warning" style={{ marginBottom: 12 }}>These actions cannot be undone!</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {isAdmin ? (
                <button className="btn btn-danger" disabled={clearing} onClick={clearDb}>
                  {clearing ? <span className="spinner" /> : 'Clear All Data'}
                </button>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>Database clear is admin-only.</p>
              )}
              <button className="btn btn-danger" onClick={logoutAll}>Log Out Everywhere</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
