import { useEffect, useState, Fragment } from 'react'
import { api } from '../../api'

const LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR']

const LEVEL_COLOR = {
  ERROR: 'var(--red)',
  WARN:  'var(--orange)',
  INFO:  'var(--muted)',
}

function Badge({ text, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 4,
      fontSize: 11, fontWeight: 700, color, border: `1px solid ${color}`,
      whiteSpace: 'nowrap',
    }}>{text}</span>
  )
}

function LogsPanel() {
  const [logs,       setLogs]       = useState([])
  const [level,      setLevel]      = useState('ALL')
  const [search,     setSearch]     = useState('')
  const [expanded,   setExpanded]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [autoRefresh, setAuto]      = useState(false)

  function load() {
    return api.get('/api/admin/logs', level !== 'ALL' ? { level } : {})
      .then(r => setLogs(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [level])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [autoRefresh, level])

  const filtered = logs.filter(l => {
    if (!search) return true
    const q = search.toLowerCase()
    return l.message.toLowerCase().includes(q) ||
           l.category.toLowerCase().includes(q) ||
           String(l.details?.path || '').toLowerCase().includes(q) ||
           String(l.details?.user_id || '').includes(q)
  })

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {LEVELS.map(l => (
            <button key={l} onClick={() => setLevel(l)}
              className={`btn btn-sm ${level === l ? 'btn-primary' : 'btn-outline'}`}>
              {l}
            </button>
          ))}
        </div>
        <input className="input-field" style={{ maxWidth: 260, marginBottom: 0 }}
          placeholder="Search message, path, user…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', marginLeft: 'auto' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAuto(e.target.checked)} />
          Auto-refresh (3s)
        </label>
        <button className="btn btn-outline btn-sm" onClick={load}>Refresh</button>
      </div>

      {loading
        ? <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /></div>
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 170 }}>Time</th>
                  <th style={{ width: 60 }}>Level</th>
                  <th style={{ width: 80 }}>Category</th>
                  <th>Message</th>
                  <th style={{ width: 60 }}>Status</th>
                  <th style={{ width: 70 }}>User ID</th>
                  <th style={{ width: 60 }}>ms</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l, i) => (
                  <Fragment key={i}>
                    <tr
                      style={{ background: l.level === 'ERROR' ? 'rgba(239,68,68,.06)' : l.level === 'WARN' ? 'rgba(249,115,22,.04)' : undefined, cursor: 'pointer' }}
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      title="Click to expand details"
                    >
                      <td style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{l.ts}</td>
                      <td><Badge text={l.level} color={LEVEL_COLOR[l.level] || 'var(--muted)'} /></td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.category}</td>
                      <td style={{ fontSize: 13, maxWidth: 380 }}>{l.message}</td>
                      <td style={{ fontWeight: 600, color: (l.details?.status || 0) >= 400 ? 'var(--red)' : 'var(--green)' }}>
                        {l.details?.status || '—'}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.details?.user_id ?? '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.details?.elapsed_ms ?? '—'}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{expanded === i ? '▲' : '▼'}</td>
                    </tr>
                    {expanded === i && (
                      <tr>
                        <td colSpan={8} style={{ background: 'var(--bg)', padding: 0 }}>
                          <pre style={{
                            margin: 0, padding: '12px 16px', fontSize: 11,
                            color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            fontFamily: 'monospace', lineHeight: 1.6,
                          }}>
                            {JSON.stringify(l, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
                No log entries match the current filter.
              </p>
            )}
          </div>
        )
      }
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
        Showing {filtered.length} of {logs.length} entries (last 1,000 kept in memory — resets on server restart)
      </p>
    </>
  )
}

function UsersPanel() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')

  useEffect(() => {
    api.get('/api/admin/users')
      .then(r => setUsers(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return u.email.toLowerCase().includes(q) ||
           (u.first_name || '').toLowerCase().includes(q) ||
           (u.last_name  || '').toLowerCase().includes(q) ||
           (u.company_name || '').toLowerCase().includes(q)
  })

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <input className="input-field" style={{ maxWidth: 300, marginBottom: 0 }}
          placeholder="Search by email, name, company…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {loading
        ? <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" /></div>
        : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Segment</th>
                  <th>Plan</th>
                  <th>Integrations</th>
                  <th>Admin</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{u.id}</td>
                    <td style={{ fontSize: 13 }}>{u.email}</td>
                    <td style={{ fontSize: 13 }}>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{u.company_name || '—'}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{u.segment}</td>
                    <td>
                      <Badge
                        text={u.plan === 'pro' ? 'Pro' : 'Free'}
                        color={u.plan === 'pro' ? 'var(--accent)' : 'var(--muted)'}
                      />
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{u.acct_count}</td>
                    <td style={{ fontSize: 13, color: u.is_admin ? 'var(--green)' : 'var(--muted)' }}>
                      {u.is_admin ? '✓' : '—'}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {(u.created_at || '').slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted)', fontSize: 13 }}>
                No users found.
              </p>
            )}
          </div>
        )
      }
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</p>
    </>
  )
}

const ADMIN_TABS = ['Users', 'Logs']

export default function Admin() {
  const [tab, setTab] = useState('Users')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', border: '1px solid var(--red)', borderRadius: 4, padding: '2px 7px', letterSpacing: .5 }}>ADMIN</span>
        {ADMIN_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Logs'  && <LogsPanel />}
      {tab === 'Users' && <UsersPanel />}
    </div>
  )
}
