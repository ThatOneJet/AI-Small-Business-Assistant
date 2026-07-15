/**
 * JetCore DevBay — for builders. Connect GitHub (token stored encrypted in main),
 * see a legible repo portfolio (staleness, issues, stars), and automate shipping:
 * draft a release/tag in a couple of clicks. The token never touches the renderer.
 */
import { useEffect, useState, type JSX } from 'react'
import { AppPage } from '../AppPage'
import AppNav from '../AppNav'
import { getApp } from '../registry'
import type { DevBayData, DevBayRepo, DevBayReleaseResult } from '@shared/ipc'

function rel(iso: string): string {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.round(d / 30)}mo ago`
  return `${Math.round(d / 365)}y ago`
}
const LANG: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5', Rust: '#dea584',
  Go: '#00ADD8', Java: '#b07219', 'C++': '#f34b7d', C: '#555', Ruby: '#701516',
  Swift: '#F05138', Kotlin: '#A97BFF', HTML: '#e34c26', CSS: '#563d7c', Shell: '#89e051'
}

export default function DevBayApp(): JSX.Element {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [data, setData] = useState<DevBayData | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [rel_, setRel] = useState<DevBayRepo | null>(null) // repo being released

  const load = async (): Promise<void> => {
    setBusy(true)
    const d = await window.decks?.devbay?.fetch().catch(() => null)
    setData(d ?? { connected: false, repos: [] })
    setBusy(false)
  }

  useEffect(() => {
    let alive = true
    void window.decks?.devbay?.status().then((s) => {
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
    const res = await window.decks?.devbay?.connect(token).catch(() => null)
    setBusy(false)
    if (res?.connected) {
      setConnected(true)
      setToken('')
      void load()
    } else setErr(res?.error ?? 'Could not connect to GitHub.')
  }

  async function disconnect(): Promise<void> {
    await window.decks?.devbay?.disconnect().catch(() => {})
    setConnected(false)
    setData(null)
  }

  const app = getApp('devbay')

  if (connected === false) {
    return (
      <AppPage app={app}>
        <div className="pylon-connect jc-rise">
          <h2 className="pylon-connect-h">Connect GitHub</h2>
          <p className="pylon-connect-p">
            Create a token at <b>GitHub → Settings → Developer settings → Tokens</b> with
            repo read access (and <b>Contents: Read &amp; write</b> if you want DevBay to draft
            releases). It’s encrypted and stored only on your device.
          </p>
          <label className="pylon-field">
            <span>GitHub token</span>
            <input className="pylon-input" type="password" placeholder="github_pat_… or ghp_…"
              value={token} onChange={(e) => setToken(e.target.value)} />
          </label>
          {err && <div className="pylon-err">{err}</div>}
          <button className="jc-btn" type="button" onClick={connect} disabled={busy} style={{ marginTop: 4 }}>
            {busy ? 'Connecting…' : 'Connect GitHub'}
          </button>
        </div>
      </AppPage>
    )
  }
  if (connected === null) {
    return <AppPage app={app}><p className="jc-note">Checking GitHub…</p></AppPage>
  }

  const repos = data?.repos ?? []
  const nav = (
    <AppNav
      active="repos"
      onSelect={() => {}}
      context={{
        current: data?.login ? `@${data.login}` : 'GitHub',
        items: repos.slice(0, 12).map((r) => ({ id: r.fullName, label: r.name })),
        onPick: (id) => {
          const r = repos.find((x) => x.fullName === id)
          if (r) window.open(r.url, '_blank')
        },
        addLabel: 'New repository',
        onAdd: () => window.open('https://github.com/new', '_blank')
      }}
      sections={[
        { label: 'Code', items: [{ id: 'repos', label: 'Repositories', badge: String(repos.length) }] }
      ]}
    />
  )
  return (
    <AppPage app={app} nav={nav} actions={
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="jc-btn" type="button" onClick={load} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
        <button className="jc-btn ghost" type="button" onClick={disconnect}>Disconnect</button>
      </div>
    }>
      {data?.error && <div className="pylon-err" style={{ marginBottom: 14 }}>{data.error}</div>}
      <div className="pylon-sec-title">{data?.login ? `@${data.login}` : 'Your repositories'} · {repos.length} repos</div>
      <div className="jc-grid">
        {repos.length === 0 && <p className="jc-note">No repositories found.</p>}
        {repos.map((r, i) => {
          const stale = Math.round((Date.now() - new Date(r.pushedAt).getTime()) / 86400000) > 60
          return (
            <div key={r.fullName} className="jc-card jc-rise db-repo" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="db-repo-head">
                <span className="jc-card-title">{r.name}</span>
                {r.private && <span className="db-badge">Private</span>}
                {r.fork && <span className="db-badge ghost">Fork</span>}
              </div>
              {r.description && <div className="jc-card-body">{r.description}</div>}
              <div className="db-meta">
                {r.language && <span className="db-lang"><i style={{ background: LANG[r.language] ?? '#888' }} />{r.language}</span>}
                {r.stars > 0 && <span title="Stars">★ {r.stars}</span>}
                {r.openIssues > 0 && <span title="Open issues">⊙ {r.openIssues}</span>}
                <span className={'db-push' + (stale ? ' stale' : '')}>pushed {rel(r.pushedAt)}</span>
              </div>
              <div className="db-actions">
                <button className="jc-btn" type="button" onClick={() => setRel(r)}>Draft release</button>
                <a className="jc-btn ghost" href={r.url} target="_blank" rel="noreferrer">Open ↗</a>
              </div>
            </div>
          )
        })}
      </div>
      {rel_ && <ReleaseModal repo={rel_} onClose={() => setRel(null)} />}
    </AppPage>
  )
}

/** Draft-a-release modal — the shipping ceremony in a couple of clicks. */
function ReleaseModal({ repo, onClose }: { repo: DevBayRepo; onClose: () => void }): JSX.Element {
  const [tag, setTag] = useState('v')
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ url?: string; error?: string } | null>(null)

  async function go(): Promise<void> {
    setBusy(true)
    const res = await window.decks?.devbay
      ?.draftRelease({ fullName: repo.fullName, tag, name, body })
      .catch((): DevBayReleaseResult => ({ ok: false, error: 'Failed.' }))
    setBusy(false)
    setDone(res?.ok ? { url: res.url } : { error: res?.error ?? 'Failed.' })
  }

  return (
    <div className="db-modal-bg" onMouseDown={onClose}>
      <div className="db-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="db-modal-h">Draft release · {repo.name}</div>
        {done?.url ? (
          <>
            <p className="pylon-connect-p">Draft release created. Review &amp; publish it on GitHub.</p>
            <a className="jc-btn" href={done.url} target="_blank" rel="noreferrer">Open release ↗</a>
            <button className="jc-btn ghost" type="button" onClick={onClose} style={{ marginTop: 8 }}>Close</button>
          </>
        ) : (
          <>
            <label className="pylon-field"><span>Tag</span>
              <input className="pylon-input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="v1.0.0" /></label>
            <label className="pylon-field"><span>Title (optional)</span>
              <input className="pylon-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the tag" /></label>
            <label className="pylon-field"><span>Notes (optional — auto-generated if blank)</span>
              <textarea className="pylon-input" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></label>
            {done?.error && <div className="pylon-err">{done.error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="jc-btn" type="button" onClick={go} disabled={busy}>{busy ? 'Drafting…' : 'Create draft'}</button>
              <button className="jc-btn ghost" type="button" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
