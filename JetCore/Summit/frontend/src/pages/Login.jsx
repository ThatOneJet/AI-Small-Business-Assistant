import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const SEGMENTS = { 'Individual': 'individual', 'Small Business': 'small_biz', 'Restaurant': 'restaurant' }

function saveSession(data) {
  localStorage.setItem('token',      data.token)
  localStorage.setItem('user_id',    data.user_id)
  localStorage.setItem('email',      data.email)
  localStorage.setItem('first_name', data.first_name || '')
  localStorage.setItem('segment',    data.segment || 'individual')
  localStorage.setItem('plan',       data.plan || 'free')
  localStorage.setItem('is_admin',   data.is_admin ? '1' : '0')
  if (data.avatar) {
    localStorage.setItem('profile_pic', data.avatar)
  } else {
    localStorage.removeItem('profile_pic')
  }
}

export default function Login() {
  const nav = useNavigate()
  const [tab, setTab] = useState('login')

  useEffect(() => {
    document.documentElement.style.setProperty('--sb-w', '0px')
  }, [])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  // login form
  const [email, setEmail]   = useState('')
  const [pass,  setPass]    = useState('')

  // signup form
  const [fn,    setFn]      = useState('')
  const [ln,    setLn]      = useState('')
  const [co,    setCo]      = useState('')
  const [seg,   setSeg]     = useState('Restaurant')
  const [em2,   setEm2]     = useState('')
  const [pw2,   setPw2]     = useState('')
  const [pw3,   setPw3]     = useState('')

  async function doLogin(e) {
    e.preventDefault()
    setErr(''); setLoading(true)
    try {
      const r = await api.post('/api/login', { email, password: pass })
      saveSession(r.data)
      nav('/dashboard')
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Login failed')
    } finally { setLoading(false) }
  }

  async function doSignup(e) {
    e.preventDefault()
    setErr('')
    if (pw2 !== pw3) { setErr('Passwords do not match'); return }
    if (pw2.length < 6) { setErr('Password must be at least 6 characters'); return }
    setLoading(true)
    try {
      const r = await api.post('/api/signup', {
        email: em2, password: pw2,
        first_name: fn, last_name: ln, company_name: co,
        segment: SEGMENTS[seg] || 'restaurant',
      })
      saveSession(r.data)
      nav('/dashboard')
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Signup failed')
    } finally { setLoading(false) }
  }

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-logo">
          <div className="icon">⚡</div>
          <h2>JetCore</h2>
          <p>Financial intelligence for every business</p>
        </div>

        <div className="tab-switch">
          <button className={tab === 'login' ? 'active' : ''} onClick={() => { setTab('login'); setErr('') }}>Log In</button>
          <button className={tab === 'signup' ? 'active' : ''} onClick={() => { setTab('signup'); setErr('') }}>Create Account</button>
        </div>

        <p className="error-msg">{err}</p>

        {tab === 'login' ? (
          <form onSubmit={doLogin}>
            <div className="form-group">
              <label>Email</label>
              <input className="input-field" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="input-field" type="password" value={pass} onChange={e => setPass(e.target.value)} required />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Log In'}
            </button>
          </form>
        ) : (
          <form onSubmit={doSignup}>
            <div className="form-row" style={{ marginBottom: 14 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>First Name</label>
                <input className="input-field" value={fn} onChange={e => setFn(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Last Name</label>
                <input className="input-field" value={ln} onChange={e => setLn(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Company / Restaurant Name</label>
              <input className="input-field" value={co} onChange={e => setCo(e.target.value)} />
            </div>
            <div className="form-group">
              <label>I am a...</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 4 }}>
                {[
                  { key: 'Individual',    icon: '👤', desc: 'Personal finance & budgeting' },
                  { key: 'Small Business',icon: '🏪', desc: 'Cash flow & expenses' },
                  { key: 'Restaurant',    icon: '🍽️', desc: 'Labor, POS & analytics' },
                ].map(s => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSeg(s.key)}
                    style={{
                      padding: '10px 8px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                      border: `2px solid ${seg === s.key ? 'var(--accent)' : 'var(--border)'}`,
                      background: seg === s.key ? 'rgba(255,106,26,.1)' : 'var(--surface)',
                      transition: 'border-color .15s, background .15s',
                    }}
                  >
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{s.icon}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: seg === s.key ? 'var(--accent)' : 'var(--text)', lineHeight: 1.2 }}>{s.key}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, lineHeight: 1.3 }}>{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group">
              <label>Email</label>
              <input className="input-field" type="email" placeholder="you@example.com" value={em2} onChange={e => setEm2(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password (min 6 chars)</label>
              <input className="input-field" type="password" value={pw2} onChange={e => setPw2(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Confirm Password</label>
              <input className="input-field" type="password" value={pw3} onChange={e => setPw3(e.target.value)} required />
            </div>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 4 }} disabled={loading}>
              {loading ? <span className="spinner" /> : 'Create Account'}
            </button>
          </form>
        )}

        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 11, marginTop: 16 }}>
          Your data is encrypted and never sold.
        </p>
      </div>
    </div>
  )
}
