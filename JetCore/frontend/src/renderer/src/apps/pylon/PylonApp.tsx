/**
 * JetCore Pylon — for students. Connect Canvas (a personal access token, stored
 * encrypted in main) and see a legible dashboard: standing per class + what's due,
 * sorted by urgency. The token never touches the renderer; we only get data.
 */
import { useEffect, useState, type JSX } from 'react'
import { AppPage } from '../AppPage'
import AppNav from '../AppNav'
import { getApp } from '../registry'
import type { PylonData } from '@shared/ipc'

/** "in 3 days" / "today" / "2 days ago" from an ISO date. */
function relDue(iso: string | null): { text: string; tone: 'soon' | 'ok' | 'past' } {
  if (!iso) return { text: 'No due date', tone: 'ok' }
  const due = new Date(iso).getTime()
  const now = Date.now()
  const days = Math.round((due - now) / 86400000)
  if (days < 0) return { text: `${-days}d overdue`, tone: 'past' }
  if (days === 0) return { text: 'Due today', tone: 'soon' }
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' }
  if (days <= 3) return { text: `Due in ${days}d`, tone: 'soon' }
  return { text: `Due in ${days}d`, tone: 'ok' }
}

function gradeTone(score: number | null): string {
  if (score == null) return ''
  if (score >= 90) return 'a'
  if (score >= 80) return 'b'
  if (score >= 70) return 'c'
  return 'd'
}

export default function PylonApp(): JSX.Element {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [data, setData] = useState<PylonData | null>(null)
  const [busy, setBusy] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [section, setSection] = useState('dashboard')

  const load = async (): Promise<void> => {
    setBusy(true)
    const d = await window.decks?.pylon?.fetch().catch(() => null)
    setData(d ?? { connected: false, courses: [], upcoming: [] })
    setBusy(false)
  }

  useEffect(() => {
    let alive = true
    void window.decks?.pylon?.status().then((s) => {
      if (!alive) return
      setConnected(!!s?.connected)
      if (s?.connected) void load()
    })
    return () => {
      alive = false
    }
  }, [])

  async function connect(): Promise<void> {
    if (busy) return
    setErr(null)
    setBusy(true)
    const res = await window.decks?.pylon?.connect({ baseUrl, token }).catch(() => null)
    setBusy(false)
    if (res?.connected) {
      setConnected(true)
      setToken('')
      void load()
    } else {
      setErr(res?.error ?? 'Could not connect to Canvas.')
    }
  }

  async function disconnect(): Promise<void> {
    await window.decks?.pylon?.disconnect().catch(() => {})
    setConnected(false)
    setData(null)
  }

  const app = getApp('pylon')

  // ── Connect screen ──
  if (connected === false) {
    return (
      <AppPage app={app}>
        <div className="pylon-connect jc-rise">
          <h2 className="pylon-connect-h">Connect Canvas</h2>
          <p className="pylon-connect-p">
            In Canvas, go to <b>Account → Settings → New access token</b>, create one, and paste it here.
            Your token is encrypted and stored only on your device.
          </p>
          <label className="pylon-field">
            <span>Canvas URL</span>
            <input
              className="pylon-input"
              placeholder="yourschool.instructure.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
          <label className="pylon-field">
            <span>Access token</span>
            <input
              className="pylon-input"
              type="password"
              placeholder="Paste your Canvas token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          {err && <div className="pylon-err">{err}</div>}
          <button className="jc-btn" type="button" onClick={connect} disabled={busy} style={{ marginTop: 4 }}>
            {busy ? 'Connecting…' : 'Connect Canvas'}
          </button>
        </div>
      </AppPage>
    )
  }

  // ── Loading status ──
  if (connected === null) {
    return (
      <AppPage app={app}>
        <p className="jc-note">Checking Canvas…</p>
      </AppPage>
    )
  }

  // ── Dashboard ──
  const courses = data?.courses ?? []
  const upcoming = data?.upcoming ?? []
  const showClasses = section === 'dashboard' || section === 'grades'
  const showDue = section === 'dashboard' || section === 'calendar'
  const nav = (
    <AppNav
      active={section}
      onSelect={setSection}
      context={{
        current: 'All courses',
        items: courses.map((c) => ({ id: String(c.id), label: c.name })),
        addLabel: 'Add a course',
        onAdd: () => window.open('https://canvas.instructure.com/courses', '_blank')
      }}
      sections={[
        {
          label: 'Academics',
          items: [
            { id: 'dashboard', label: 'Dashboard' },
            { id: 'grades', label: 'Grades' },
            { id: 'calendar', label: "What's due", badge: upcoming.length ? String(upcoming.length) : undefined }
          ]
        }
      ]}
    />
  )
  return (
    <AppPage
      app={app}
      nav={nav}
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="jc-btn" type="button" onClick={load} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="jc-btn ghost" type="button" onClick={disconnect}>Disconnect</button>
        </div>
      }
    >
      {data?.error && <div className="pylon-err" style={{ marginBottom: 14 }}>{data.error}</div>}

      {showClasses && (
        <>
          <div className="pylon-sec-title">Your classes</div>
          <div className="jc-grid">
            {courses.length === 0 && <p className="jc-note">No active courses found.</p>}
            {courses.map((c, i) => (
              <div key={c.id} className="jc-card jc-rise" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="jc-card-title" style={{ marginBottom: 10 }}>{c.name}</div>
                <div className={'pylon-grade ' + gradeTone(c.score)}>
                  {c.score == null ? '—' : `${Math.round(c.score)}%`}
                  {c.grade && <span className="pylon-grade-letter">{c.grade}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showDue && (
        <>
          <div className="pylon-sec-title" style={{ marginTop: showClasses ? 28 : 0 }}>What's due</div>
          <div className="pylon-due-list">
            {upcoming.length === 0 && <p className="jc-note">Nothing upcoming — you're caught up. 🎉</p>}
            {upcoming.map((a, i) => {
              const r = relDue(a.dueAt)
              return (
                <div key={a.id} className="pylon-due jc-rise" style={{ animationDelay: `${i * 35}ms` }}>
                  <div className="pylon-due-main">
                    <div className="pylon-due-title">{a.title}</div>
                    <div className="pylon-due-meta">{a.courseName}{a.points != null && ` · ${a.points} pts`}</div>
                  </div>
                  <span className={'pylon-due-when ' + r.tone}>{r.text}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </AppPage>
  )
}
