import { useEffect, useState } from 'react'
import { api } from '../../api'
import { getLimits, PlanGate, meetsRequired } from '../../planGating'

const uid_from_storage = () => Number(localStorage.getItem('user_id'))

function IconSync({ spinning }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" width="14" height="14"
         style={spinning ? { animation: 'spin .7s linear infinite' } : undefined}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  )
}

function IconHistory() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
      <polyline points="12 8 12 12 14 14" />
      <path d="M3.05 11a9 9 0 1 0 .5-4H1" />
      <polyline points="1 2 1 7 6 7" />
    </svg>
  )
}

export default function Accounts({ uid, plan, onUpgrade }) {
  const limits = getLimits(plan)
  const [creds,   setCreds]   = useState([])
  const [accts,   setAccts]   = useState([])
  const [service, setService] = useState('Homebase (Labor & Shifts)')
  const [loading, setLoading] = useState(false)
  const [syncing,   setSyncing]   = useState({})
  const [credProg,  setCredProg]  = useState({})   // { [credId]: {pct,done,total,eta_sec} }
  const [plaidProg, setPlaidProg] = useState(null)
  const [msg,     setMsg]     = useState({ text: '', type: '' })

  const SERVICES = ['Homebase (Labor & Shifts)', 'Oracle MICROS / Simphony (POS Tenders)', 'Bank Account (Plaid)']

  function notify(text, type = 'success') {
    setMsg({ text, type })
    setTimeout(() => setMsg({ text: '', type: '' }), 4000)
  }

  function reload() {
    return Promise.all([
      api.get(`/api/credentials/${uid}`).catch(() => ({ data: [] })),
      api.get(`/api/accounts/${uid}`).catch(() => ({ data: [] })),
    ]).then(([c, a]) => { setCreds(c.data || []); setAccts(a.data || []) })
  }

  useEffect(() => { reload() }, [uid])

  const normalSyncDays = limits.syncDays ?? 90
  const fullSyncDays   = limits.fullSyncDays   // 0 = not allowed, null = unlimited (use 1825)
  const canFullSync    = fullSyncDays !== 0

  async function doSync(svc, credId) {
    setSyncing(s => ({ ...s, [credId]: 'sync' }))
    setCredProg(p => ({ ...p, [credId]: { pct: 0, done: 0, total: 0, eta_sec: null } }))

    const pollId = setInterval(async () => {
      try {
        const r = await api.get(`/api/sync/progress/${svc}/${uid}`)
        if (r.data.status === 'running' || r.data.status === 'done') {
          setCredProg(p => ({ ...p, [credId]: r.data }))
        }
        if (r.data.status === 'done' || r.data.status === 'error') clearInterval(pollId)
      } catch {}
    }, 1000)

    try {
      await api.post(`/api/sync/${svc}/${uid}`, { days: normalSyncDays })
      notify(`Synced ${svc.charAt(0).toUpperCase() + svc.slice(1)}!`)
      reload()
    } catch (ex) {
      notify(ex.response?.data?.error || 'Sync failed', 'error')
    } finally {
      clearInterval(pollId)
      setSyncing(s => ({ ...s, [credId]: false }))
      setCredProg(p => ({ ...p, [credId]: { pct: 100, done: p[credId]?.total || 1, total: p[credId]?.total || 1, eta_sec: null } }))
      setTimeout(() => setCredProg(p => { const n = { ...p }; delete n[credId]; return n }), 1500)
    }
  }

  async function doFullSync(svc, credId) {
    if (!canFullSync) { notify('Upgrade your plan to access full history sync', 'error'); return }
    setSyncing(s => ({ ...s, [credId]: 'full' }))
    setCredProg(p => ({ ...p, [credId]: { pct: 0, done: 0, total: 0, eta_sec: null } }))

    const pollId = setInterval(async () => {
      try {
        const r = await api.get(`/api/sync/progress/${svc}/${uid}`)
        if (r.data.status === 'running' || r.data.status === 'done') {
          setCredProg(p => ({ ...p, [credId]: r.data }))
        }
        if (r.data.status === 'done' || r.data.status === 'error') clearInterval(pollId)
      } catch {}
    }, 1000)

    try {
      const days = fullSyncDays ?? 1825
      const r = await api.post(`/api/sync/${svc}/${uid}`, { days })
      const ct = r.data?.shifts ?? r.data?.tenders ?? ''
      notify(`Full history synced!${ct ? ` ${ct} records` : ''}`)
      reload()
    } catch (ex) {
      notify(ex.response?.data?.error || 'Full sync failed', 'error')
    } finally {
      clearInterval(pollId)
      setSyncing(s => ({ ...s, [credId]: false }))
      setCredProg(p => ({ ...p, [credId]: { pct: 100, done: p[credId]?.total || 1, total: p[credId]?.total || 1, eta_sec: null } }))
      setTimeout(() => setCredProg(p => { const n = { ...p }; delete n[credId]; return n }), 1500)
    }
  }

  async function doRemoveCred(id) {
    await api.del(`/api/credentials/${id}`).catch(() => {})
    notify('Removed', 'warning')
    reload()
  }

  async function doRemoveAcct(id) {
    await api.post(`/api/accounts/delete/${id}`).catch(() => {})
    reload()
  }

  async function doSyncPlaid(days) {
    setSyncing(s => ({ ...s, plaid: days > 365 ? 'full' : 'sync' }))
    setPlaidProg({ pct: 0, done: 0, total: 0, eta_sec: null })

    const pollId = setInterval(async () => {
      try {
        const r = await api.get(`/api/sync/plaid/progress/${uid}`)
        if (r.data.status === 'running' || r.data.status === 'done') {
          setPlaidProg(r.data)
        }
        if (r.data.status === 'done' || r.data.status === 'error') clearInterval(pollId)
      } catch {}
    }, 1000)

    try {
      const r = await api.post(`/api/sync/plaid/${uid}`, { days })
      notify(`Plaid synced! ${r.data?.transactions ?? ''} new transactions`)
      reload()
    } catch (ex) {
      notify(ex.response?.data?.error || 'Plaid sync failed', 'error')
    } finally {
      clearInterval(pollId)
      setSyncing(s => ({ ...s, plaid: false }))
      setPlaidProg(p => ({ pct: 100, done: p?.total || 1, total: p?.total || 1, eta_sec: null }))
      setTimeout(() => setPlaidProg(null), 1500)
    }
  }

  return (
    <div>
      {msg.text && (
        <div className={`alert alert-${msg.type === 'error' ? 'error' : msg.type === 'warning' ? 'warning' : 'success'}`}
             style={{ marginBottom: 16 }}>
          {msg.text}
        </div>
      )}

      {creds.length > 0 && (
        <>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>API Integrations</h3>
          {creds.map(c => (
            <div key={c.id}>
              <div className="cred-card">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{c.service.charAt(0).toUpperCase() + c.service.slice(1)}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>Last synced: {(c.last_synced || '').slice(0, 10) || 'Never'}</div>
                </div>
                <div className="cred-actions">
                  <button
                    className="btn btn-outline btn-sm btn-icon"
                    disabled={!!syncing[c.id]}
                    onClick={() => doSync(c.service, c.id)}
                    title={`Sync Now (${normalSyncDays} days)`}
                  >
                    {syncing[c.id] === 'sync' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconSync />}
                  </button>
                  {canFullSync ? (
                    <button
                      className="btn btn-outline btn-sm btn-icon"
                      style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                      disabled={!!syncing[c.id]}
                      onClick={() => doFullSync(c.service, c.id)}
                      title={`Full History Sync (${fullSyncDays ? fullSyncDays + ' days' : 'unlimited'})`}
                    >
                      {syncing[c.id] === 'full' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconHistory />}
                    </button>
                  ) : (
                    <button
                      className="btn btn-outline btn-sm btn-icon"
                      style={{ opacity: 0.35, cursor: 'not-allowed' }}
                      onClick={onUpgrade}
                      title="Full history sync requires Plus or higher"
                    >
                      <IconHistory />
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" onClick={() => doRemoveCred(c.id)}>Remove</button>
                </div>
              </div>
              {credProg[c.id] && (
                <div style={{ marginTop: 6, marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
                    <span>
                      {credProg[c.id].pct >= 100
                        ? '✓ Done!'
                        : credProg[c.id].total > 0
                          ? c.service === 'oracle'
                            ? ['Syncing tenders…', 'Syncing item sales…', 'Syncing hourly data…'][credProg[c.id].done] || 'Finalizing…'
                            : `${Math.min(credProg[c.id].done * 30, credProg[c.id].total * 30)} / ${credProg[c.id].total * 30} days synced`
                          : 'Connecting…'}
                    </span>
                    <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                      {credProg[c.id].pct >= 100 ? '100%' : `${credProg[c.id].pct || 0}%`}
                      {credProg[c.id].eta_sec != null && credProg[c.id].pct < 100 && (
                        <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
                          ~{credProg[c.id].eta_sec < 60 ? `${credProg[c.id].eta_sec}s` : `${Math.ceil(credProg[c.id].eta_sec / 60)}m`}
                        </span>
                      )}
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3, background: 'var(--accent)',
                      width: `${credProg[c.id].pct || 0}%`, transition: 'width .4s ease',
                    }} />
                  </div>
                </div>
              )}
            </div>
          ))}
          <hr className="separator" />
        </>
      )}

      {accts.filter(a => a.service === 'plaid').length > 0 && (
        <>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Bank Accounts (Plaid)</h3>
          {accts.filter(a => a.service === 'plaid').map(a => (
            <div key={a.id} className="cred-card">
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>🏦 {a.account_name}</div>
                {a.institution_name && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.institution_name}</div>}
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Last synced: {(a.last_synced || '').slice(0, 10) || 'Never'}</div>
              </div>
              <div className="cred-actions">
                <button
                  className="btn btn-outline btn-sm btn-icon"
                  disabled={!!syncing['plaid']}
                  onClick={() => doSyncPlaid(normalSyncDays)}
                  title={`Sync Plaid (${normalSyncDays} days)`}
                >
                  {syncing['plaid'] === 'sync' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconSync />}
                </button>
                {canFullSync ? (
                  <button
                    className="btn btn-outline btn-sm btn-icon"
                    style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                    disabled={!!syncing['plaid']}
                    onClick={() => doSyncPlaid(fullSyncDays ?? 730)}
                    title={`Full History Sync (${fullSyncDays ? fullSyncDays + ' days' : 'unlimited'})`}
                  >
                    {syncing['plaid'] === 'full' ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <IconHistory />}
                  </button>
                ) : (
                  <button
                    className="btn btn-outline btn-sm btn-icon"
                    style={{ opacity: 0.35, cursor: 'not-allowed' }}
                    onClick={onUpgrade}
                    title="Full history sync requires Plus or higher"
                  >
                    <IconHistory />
                  </button>
                )}
                <button className="btn btn-danger btn-sm" onClick={() => doRemoveAcct(a.id)}>Remove</button>
              </div>
            </div>
          ))}
          {plaidProg && (
            <div style={{ marginTop: 10, marginBottom: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
                <span>
                  {plaidProg.pct >= 100 ? '✓ Done!' : plaidProg.total > 0
                    ? `${plaidProg.done.toLocaleString()} / ${plaidProg.total.toLocaleString()} transactions`
                    : 'Connecting to Plaid…'}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                  {plaidProg.pct >= 100 ? '100%' : `${plaidProg.pct || 0}%`}
                  {plaidProg.eta_sec != null && plaidProg.pct < 100 && (
                    <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
                      ~{plaidProg.eta_sec < 60 ? `${plaidProg.eta_sec}s` : `${Math.ceil(plaidProg.eta_sec / 60)}m`}
                    </span>
                  )}
                </span>
              </div>
              <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3, background: 'var(--accent)',
                  width: `${plaidProg.pct || 0}%`, transition: 'width .4s ease',
                }} />
              </div>
            </div>
          )}
          <hr className="separator" />
        </>
      )}

      <h3 style={{ marginBottom: 12, fontSize: 15 }}>Connect New Data Source</h3>
      <div style={{ marginBottom: 16 }}>
        <select className="select-field" style={{ width: 360 }} value={service} onChange={e => setService(e.target.value)}>
          {SERVICES.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>

      {service.includes('Homebase') && (
        <HomebaseForm uid={uid} creds={creds} onDone={() => { reload(); notify('Homebase credentials saved!') }} />
      )}
      {service.includes('Oracle') && (
        meetsRequired(plan, 'plus')
          ? <OracleForm uid={uid} creds={creds} onDone={() => { reload(); notify('Oracle credentials saved!') }} />
          : <PlanGate plan={plan} requiredPlan="plus" feature="Oracle POS integration" onUpgrade={onUpgrade} />
      )}
      {service.includes('Plaid') && (
        <PlaidConnect uid={uid} plan={plan} onUpgrade={onUpgrade} plaidAccts={accts.filter(a => a.service === 'plaid')} />
      )}
    </div>
  )
}

function Steps({ steps }) {
  return (
    <ol style={{ margin: '8px 0 14px', paddingLeft: 18 }}>
      {steps.map((s, i) => (
        <li key={i} style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.5 }}>{s}</li>
      ))}
    </ol>
  )
}

function HowTo({ title, children }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ marginBottom: 14, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--accent)', display: 'flex', justifyContent: 'space-between' }}
      >
        {title} <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding: '0 12px 10px' }}>{children}</div>}
    </div>
  )
}

function HomebaseForm({ uid, creds, onDone }) {
  const [key,  setKey]  = useState('')
  const [err,  setErr]  = useState('')
  const [busy, setBusy] = useState(false)

  if (creds.some(c => c.service === 'homebase')) {
    return <p style={{ color: '#2563eb', fontSize: 13 }}>Homebase credentials already saved. Use Sync Now above.</p>
  }

  async function save(e) {
    e.preventDefault()
    if (!key) { setErr('API key is required.'); return }
    setErr('Verifying...'); setBusy(true)
    try {
      await api.post('/api/credentials/verify', {
        user_id: uid, service: 'homebase',
        config: { api_key: key },
      })
      setErr(''); onDone()
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Verification failed')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={save} style={{ maxWidth: 420 }}>
      <HowTo title="How to get your Homebase API key">
        <Steps steps={[
          'Sign in at app.joinhomebase.com',
          'Click your name or avatar in the top-right corner → Settings',
          'Open the Integrations tab in the left sidebar',
          'Scroll to the API section and click Generate API Key',
          'Copy the key — it starts with hb_live_…',
          'Paste it below and click Save & Verify',
        ]} />
        <p style={{ fontSize: 11, color: 'var(--muted)' }}>
          Need an account? Sign up free at joinhomebase.com. API access is available on all paid plans.
        </p>
      </HowTo>
      <div className="form-group">
        <label>API Key</label>
        <input className="input-field" type="password" placeholder="hb_live_..." value={key} onChange={e => setKey(e.target.value)} />
      </div>
      {err && <p style={{ color: err === 'Verifying...' ? 'var(--muted)' : 'var(--red)', fontSize: 12, marginBottom: 8 }}>{err}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Save & Verify'}</button>
    </form>
  )
}

function OracleForm({ uid, creds, onDone }) {
  const [url,      setUrl]    = useState('')
  const [authType, setAuth]   = useState('OAuth 2.0 (Simphony Cloud)')
  const [cliId,    setCliId]  = useState('')
  const [secret,   setSecret] = useState('')
  const [loc,      setLoc]    = useState('')
  const [err,      setErr]    = useState('')
  const [busy,     setBusy]   = useState(false)
  const isCloud = authType.includes('OAuth')

  if (creds.some(c => c.service === 'oracle')) {
    return <p style={{ color: '#2563eb', fontSize: 13 }}>Oracle credentials already saved. Use Sync Now above.</p>
  }

  async function save(e) {
    e.preventDefault()
    if (!url || !cliId || !secret || !loc) { setErr('All fields are required.'); return }
    setErr('Verifying...'); setBusy(true)
    try {
      await api.post('/api/credentials/verify', {
        user_id: uid, service: 'oracle',
        config: {
          environment_url: url, client_id: cliId,
          client_secret: secret, location_ref: loc,
          auth_type: isCloud ? 'oauth' : 'api_key',
        },
      })
      setErr(''); onDone()
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Verification failed')
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={save} style={{ maxWidth: 420 }}>
      <div style={{ background: '#7c3aed18', border: '1px solid #7c3aed44', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text)' }}>Oracle API access requires enrollment.</strong> The Simphony Cloud REST API is only available to Oracle PartnerNetwork members who have completed the Simphony Integration Partner Program. Contact your Oracle account rep or apply at{' '}
        <strong>go.oracle.com/LP=111816</strong> before proceeding.
      </div>

      <div className="form-group">
        <label>System Type</label>
        <select className="select-field" style={{ width: '100%' }} value={authType} onChange={e => setAuth(e.target.value)}>
          <option>OAuth 2.0 (Simphony Cloud)</option>
          <option>API Key (MICROS On-Premise)</option>
        </select>
      </div>

      {isCloud ? (
        <HowTo title="How to get Simphony Cloud credentials">
          <Steps steps={[
            'Complete Oracle PartnerNetwork enrollment at partner.oracle.com',
            'Apply for Simphony Integration Partner access — Oracle will provision a sandbox environment',
            'Once approved, sign in to your Oracle Cloud Console',
            'Go to Identity & Security → Domains → your domain → OAuth Clients',
            'Create or open a client application — copy the Client ID and Client Secret',
            'Your Environment URL is the hostname Oracle provided (e.g. https://your-org.simphony.us.oracleindustry.com)',
            'Find your Revenue Center GUID in the Simphony back-office: Configuration → Revenue Centers → select your location → copy the GUID from the URL or detail panel',
          ]} />
        </HowTo>
      ) : (
        <HowTo title="How to get MICROS On-Premise credentials">
          <Steps steps={[
            'Note: MICROS 3700 / RES on-premise systems do not have a native REST API — they use SOAP/XML Transaction Services',
            'Contact your Oracle dealer or system integrator to enable Transaction Services and get a service account',
            'Your Environment URL is your MICROS server address (e.g. https://192.168.1.100:9300)',
            'Client ID: leave as the service account username',
            'API Key / Secret: the password or token provided by your integrator',
            'Location GUID: your revenue center ID from the MICROS Manager application',
            'Consider upgrading to Simphony Cloud for full REST API support',
          ]} />
        </HowTo>
      )}

      <div className="form-group">
        <label>Environment URL</label>
        <input className="input-field" placeholder={isCloud ? 'https://your-org.simphony.us.oracleindustry.com' : 'https://your-micros-server:9300'} value={url} onChange={e => setUrl(e.target.value)} />
      </div>
      <div className="form-group">
        <label>{isCloud ? 'Client ID' : 'Username / Client ID'}</label>
        <input className="input-field" placeholder={isCloud ? 'your-client-id' : 'service account username'} value={cliId} onChange={e => setCliId(e.target.value)} />
      </div>
      <div className="form-group">
        <label>{isCloud ? 'Client Secret' : 'API Key / Password'}</label>
        <input className="input-field" type="password" value={secret} onChange={e => setSecret(e.target.value)} />
      </div>
      <div className="form-group">
        <label>Location / Revenue Center GUID</label>
        <input className="input-field" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={loc} onChange={e => setLoc(e.target.value)} />
      </div>
      {err && <p style={{ color: err === 'Verifying...' ? 'var(--muted)' : 'var(--red)', fontSize: 12, marginBottom: 8 }}>{err}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Save & Verify'}</button>
    </form>
  )
}

function PlaidConnect({ uid, plan, onUpgrade, plaidAccts }) {
  const limits = getLimits(plan)
  const maxConns = limits.bankConnections

  if (maxConns === 0) {
    return <PlanGate plan={plan} requiredPlan="plus" feature="Bank account connection" onUpgrade={onUpgrade} />
  }

  if (maxConns !== null && plaidAccts.length >= maxConns) {
    return (
      <div style={{ maxWidth: 420 }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', fontSize: 13, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>Connection limit reached ({plaidAccts.length}/{maxConns}).</strong>
          <p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 12 }}>
            Your current plan allows up to {maxConns} bank connection{maxConns > 1 ? 's' : ''}. Remove an existing connection to add a different bank, or upgrade your plan for more connections.
          </p>
          {onUpgrade && (
            <button className="btn btn-primary btn-sm" onClick={onUpgrade} style={{ marginTop: 10 }}>
              View Plans
            </button>
          )}
        </div>
      </div>
    )
  }

  if (plaidAccts.length >= 1 && maxConns === 1) {
    return (
      <div style={{ maxWidth: 420 }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 16px', fontSize: 13, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>One bank already connected.</strong>
          <p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 12 }}>
            Your Plus plan includes 1 bank connection. When you authorize a bank with Plaid, <em>all accounts at that institution</em> (checking, savings, etc.) are included automatically.
          </p>
          <p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 12 }}>
            To switch banks, remove your current connection above and reconnect. Upgrade to Pro or Max for more connections.
          </p>
          {onUpgrade && (
            <button className="btn btn-outline btn-sm" onClick={onUpgrade} style={{ marginTop: 10 }}>
              Upgrade for more connections
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <HowTo title="What you'll need to connect your bank">
        <Steps steps={[
          'Have your online banking username and password ready — Plaid uses them to verify your account',
          'Click Connect Bank Account below — a secure Plaid popup will open',
          'Search for your bank or select it from the list',
          'Enter your banking credentials directly into the Plaid window (JetCore never sees them)',
          'Select the account(s) you want to link and confirm',
          'The window will close automatically and your account will appear here',
        ]} />
        <p style={{ fontSize: 11, color: 'var(--muted)' }}>
          Plaid supports 12,000+ US financial institutions including Chase, Bank of America, Wells Fargo, and most credit unions. All accounts at your bank (checking, savings) are included in one connection.
        </p>
      </HowTo>
      <a
        href={`http://localhost:5000/link?user_id=${uid}&products=transactions`}
        target="_blank"
        rel="noreferrer"
        className="btn btn-primary"
        style={{ display: 'inline-block', marginBottom: 8 }}
      >
        Connect Bank Account
      </a>
      <p style={{ fontSize: 11, color: 'var(--muted)' }}>Powered by Plaid · Bank-level 256-bit encryption · Your credentials are never stored by JetCore</p>
    </div>
  )
}
