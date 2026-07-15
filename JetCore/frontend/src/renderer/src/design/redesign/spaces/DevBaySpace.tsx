/**
 * JetCore redesign — DevBay space ("Hangar" warm-editorial port).
 *
 * A ground-up port of the Claude Design handoff (JetCore.dc.html):
 *   - renderDevBay / devPortfolio / devShip  (design 664–751)
 *   - the tab-strip pattern from spaceShell    (design 626–635)
 *
 * Wired to LIVE data — the GitHub token lives in main; the renderer only ever
 * sees sanitized DevBayData via window.decks.devbay. There is NO fake data:
 * unconnected / empty / error each get an honest state, never invented numbers.
 *
 * This component renders ONLY the scrollable body — the Hangar shell (Chrome)
 * draws the 60px chrome around it. The two tabs (Portfolio + Ship) live inside
 * a sticky tab strip ported from spaceShell.
 *
 * DevBay is the violet world (hue 300, c 0.16): tone(300, 0.16).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { DevBayData, DevBayRepo, DevBayReleaseResult } from '@shared/ipc'
import { Icon } from '../../icons'
import { tone, DOMAINS } from '../system'
import { DevBayRepoBrowser } from '../../apps/devbay/DevBayRepoBrowser'

/* ── language → dot colour (design 920) ──────────────────────────────────── */

const LANG: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  CSS: '#563d7c'
}
const langColor = (lang: string | null): string => (lang && LANG[lang]) || '#888'

/* ── staleness coding from pushedAt (design 665 staleMeta) ───────────────── */

const t = tone(DOMAINS.devbay.hue, DOMAINS.devbay.c) // hue 300, c 0.16

/** Days since an ISO timestamp. */
const daysSince = (iso: string): number => {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return 0
  return Math.max(0, (Date.now() - ms) / 86400000)
}

/** [dotColour, "Nd"/"today", word] for a staleness in days (design 665). */
function staleMeta(days: number): [string, string, string] {
  if (days < 7) return ['var(--pos)', days < 1 ? 'today' : Math.round(days) + 'd', 'active']
  if (days < 30) return [t.bright, Math.round(days) + 'd', 'recent']
  if (days < 90) return ['var(--warn)', Math.round(days) + 'd', 'aging']
  return ['var(--neg)', Math.round(days) + 'd', 'stale']
}

/* ── small presentational helpers (ported from the design) ───────────────── */

function SpaceHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
      <div>
        <h1 className="disp" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em' }}>
          {title}
        </h1>
        {sub ? <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 6 }}>{sub}</p> : null}
      </div>
      {right ?? null}
    </div>
  )
}

/** A KPI tile (design 640 kpi). */
function Kpi({ icon, label, value, sub, color }: { icon: string; label: string; value: string | number; sub: string; color?: string }): JSX.Element {
  return (
    <div className="lift" style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            background: color ? `color-mix(in oklch, ${color} 15%, transparent)` : 'var(--card-2)',
            color: color || 'var(--ink-2)'
          }}
        >
          <Icon name={icon} size={16} stroke={2} />
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>{label}</span>
      </div>
      <div className="mono disp" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div>
    </div>
  )
}

/** A mono uppercase pill label (design tabPlain). */
function TabPlain({ label, color }: { label: string; color: string }): JSX.Element {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '.1em',
        padding: '4px 10px',
        borderRadius: 999,
        background: t.soft,
        color
      }}
    >
      {label}
    </span>
  )
}

/** A small iOS-style switch (design 750 pillToggle). */
function PillToggle({ on, onClick }: { on: boolean; onClick?: () => void }): JSX.Element {
  const sty: CSSProperties = {
    width: 34,
    height: 20,
    borderRadius: 99,
    background: on ? 'var(--pos)' : 'var(--card-3)',
    display: 'inline-flex',
    alignItems: 'center',
    padding: 2,
    justifyContent: on ? 'flex-end' : 'flex-start',
    flex: '0 0 auto',
    border: 'none',
    cursor: onClick ? 'pointer' : 'default'
  }
  const knob = <span style={{ width: 16, height: 16, borderRadius: 99, background: '#fff' }} />
  return onClick ? (
    <button type="button" className="tap" onClick={onClick} style={sty}>
      {knob}
    </button>
  ) : (
    <span style={sty}>{knob}</span>
  )
}

/** A labelled mono input row (design 738 inputF). */
function InputF({
  label,
  value,
  onChange,
  icon,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  icon: string
  placeholder: string
}): JSX.Element {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 7 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 13px', height: 42, borderRadius: 11, background: 'var(--card-2)', border: '1px solid var(--line)' }}>
        <span style={{ color: 'var(--ink-3)' }}>
          <Icon name={icon} size={15} stroke={2} />
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mono"
          style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', color: 'var(--ink)', fontSize: 13.5 }}
        />
      </div>
    </div>
  )
}

/* ── full-bleed states (honest: loading / connect / error) ───────────────── */

function CenteredState({ icon, color, title, body, action }: { icon: string; color: string; title: string; body: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="rise" style={{ textAlign: 'center', maxWidth: 440, margin: '40px auto 0', padding: '20px' }}>
      <div
        style={{
          width: 78,
          height: 78,
          margin: '0 auto 20px',
          borderRadius: 22,
          display: 'grid',
          placeItems: 'center',
          background: `color-mix(in oklch, ${color} 16%, transparent)`,
          color
        }}
      >
        <Icon name={icon} size={36} stroke={2} />
      </div>
      <h2 className="disp" style={{ fontSize: 23, fontWeight: 800 }}>
        {title}
      </h2>
      <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 10, lineHeight: 1.5 }}>{body}</p>
      {action ? <div style={{ marginTop: 22, display: 'flex', justifyContent: 'center', gap: 10 }}>{action}</div> : null}
    </div>
  )
}

function skelStyle(w: number | string, h: number, mt = 0, radius = 8): CSSProperties {
  return { width: w, height: h, marginTop: mt, borderRadius: radius, background: 'var(--card-2)', animation: 'jc-pulse 1.4s ease-in-out infinite' }
}

function PortfolioSkeleton(): JSX.Element {
  return (
    <div className="rise">
      <div style={skelStyle(180, 30)} />
      <div style={skelStyle(420, 16, 12)} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, margin: '22px 0' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ ...skelStyle('100%', 110, 0, 18) }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ ...skelStyle('100%', 130, 0, 16) }} />
        ))}
      </div>
    </div>
  )
}

/* ── PORTFOLIO tab (design 675–702) ──────────────────────────────────────── */

type SortKey = 'fresh' | 'stale' | 'stars' | 'issues'
const SORTERS: { id: SortKey; label: string }[] = [
  { id: 'fresh', label: 'Freshest' },
  { id: 'stale', label: 'Most stale' },
  { id: 'stars', label: 'Stars' },
  { id: 'issues', label: 'Open issues' }
]

function Portfolio({
  data,
  busy,
  onRefresh,
  onDisconnect,
  onOpenRepo
}: {
  data: DevBayData
  busy: boolean
  onRefresh: () => void
  onDisconnect: () => void
  onOpenRepo: (repo: DevBayRepo) => void
}): JSX.Element {
  const [sort, setSort] = useState<SortKey>('fresh')
  const [lang, setLang] = useState('all')

  const repos = data.repos

  const langs = useMemo(() => {
    const seen = new Set<string>()
    for (const r of repos) if (r.language) seen.add(r.language)
    return ['all', ...Array.from(seen)]
  }, [repos])

  const view = useMemo(() => {
    const list = lang === 'all' ? repos.slice() : repos.filter((r) => r.language === lang)
    list.sort((a, b) => {
      if (sort === 'stars') return b.stars - a.stars
      if (sort === 'issues') return b.openIssues - a.openIssues
      const da = daysSince(a.pushedAt)
      const db = daysSince(b.pushedAt)
      return sort === 'stale' ? db - da : da - db
    })
    return list
  }, [repos, lang, sort])

  const staleCount = useMemo(() => repos.filter((r) => daysSince(r.pushedAt) > 60).length, [repos])
  const activeCount = useMemo(() => repos.filter((r) => daysSince(r.pushedAt) < 7).length, [repos])
  const starSum = useMemo(() => repos.reduce((a, r) => a + (r.stars || 0), 0), [repos])

  return (
    <div className="rise">
      <SpaceHead
        title="Portfolio"
        sub="Every repo made legible — what’s active, what’s neglected, what needs you."
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {data.login ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-3)' }}>
                <Icon name="code" size={16} stroke={2} /> connected as <b style={{ color: 'var(--ink-2)' }}>@{data.login}</b>
              </span>
            ) : null}
            <button
              type="button"
              className="tap"
              onClick={onRefresh}
              title="Refresh"
              style={{ width: 38, height: 38, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink-2)', opacity: busy ? 0.55 : 1 }}
            >
              <Icon name="refresh" size={16} stroke={2} />
            </button>
            <button
              type="button"
              className="tap"
              onClick={onDisconnect}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink-2)' }}
            >
              <Icon name="logout" size={15} stroke={2} /> Disconnect
            </button>
          </div>
        }
      />

      {data.error ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 12, marginBottom: 18, background: 'color-mix(in oklch, var(--warn) 12%, transparent)', color: 'var(--warn)', fontSize: 13, fontWeight: 600 }}>
          <Icon name="alert" size={16} stroke={2} />
          <span style={{ flex: 1 }}>{data.error}</span>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
        <Kpi icon="repo" label="Repositories" value={repos.length} sub="owned + collaborating" color={t.bright} />
        <Kpi icon="branch" label="Active this week" value={activeCount} sub="pushed in last 7d" color="var(--pos)" />
        <Kpi icon="alert" label="Going stale" value={staleCount} sub="no activity 60d+" color="var(--warn)" />
        <Kpi icon="star" label="Total stars" value={starSum.toLocaleString()} sub="across all repos" color={t.bright} />
      </div>

      {/* sort + language filter — both re-sort/filter the live list live */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {SORTERS.map((s) => {
          const on = sort === s.id
          return (
            <button
              key={s.id}
              type="button"
              className="tap"
              onClick={() => setSort(s.id)}
              style={{ padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: on ? t.soft : 'var(--card)', color: on ? t.bright : 'var(--ink-3)', border: '1px solid var(--line)' }}
            >
              {s.label}
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        {langs.slice(0, 6).map((l) => {
          const on = lang === l
          return (
            <button
              key={l}
              type="button"
              className="tap"
              onClick={() => setLang(l)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, background: on ? t.soft : 'var(--card-2)', color: on ? t.bright : 'var(--ink-2)', border: '1px solid var(--line)' }}
            >
              {l !== 'all' ? <span style={{ width: 9, height: 9, borderRadius: 99, background: langColor(l) }} /> : null}
              {l === 'all' ? 'All langs' : l}
            </button>
          )
        })}
      </div>

      {view.length === 0 ? (
        <CenteredState
          icon="repo"
          color={t.bright}
          title={repos.length === 0 ? 'No repositories yet' : 'No repos match'}
          body={
            repos.length === 0
              ? 'GitHub didn’t return any repositories for this token. Check its scope, then refresh.'
              : 'Nothing matches the current language filter. Try “All langs”.'
          }
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
          {view.map((r) => {
            const sm = staleMeta(daysSince(r.pushedAt))
            return (
              <button
                key={r.fullName}
                type="button"
                className="lift tap"
                onClick={() => onOpenRepo(r)}
                title="Browse repository"
                style={{ borderRadius: 16, background: 'var(--card)', border: '1px solid var(--line)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 130, color: 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name={r.private ? 'lock' : 'repo'} size={16} stroke={2} />
                  <span style={{ fontSize: 14.5, fontWeight: 700, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12.5, color: 'var(--ink-2)' }}>
                  {r.language ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: langColor(r.language) }} />
                      {r.language}
                    </span>
                  ) : null}
                  <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="star" size={13} stroke={2} />
                    {r.stars}
                  </span>
                  <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="alert" size={13} stroke={2} />
                    {r.openIssues}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--line)', marginTop: 'auto' }}>
                  <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: sm[0] }} />
                    {sm[1]} ago
                  </span>
                  <span className="mono" style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: sm[0], background: `color-mix(in oklch, ${sm[0]} 15%, transparent)` }}>
                    {sm[2]}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── SHIP tab (design 703–737) — live release composer ───────────────────── */

function Ship({ data }: { data: DevBayData }): JSX.Element {
  // The release ceremony defaults to the freshest repo (the one you just pushed).
  const repos = data.repos
  const fresh = useMemo(() => repos.slice().sort((a, b) => daysSince(a.pushedAt) - daysSince(b.pushedAt))[0] ?? null, [repos])

  const [repoFull, setRepoFull] = useState<string>(fresh?.fullName ?? '')
  const repo = useMemo(() => repos.find((r) => r.fullName === repoFull) ?? fresh, [repos, repoFull, fresh])

  const [tag, setTag] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [auto, setAuto] = useState(true)
  const [pre, setPre] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DevBayReleaseResult | null>(null)
  const [done, setDone] = useState(false)

  const liveTitle = title || tag || 'New release'

  const reset = useCallback((): void => {
    setDone(false)
    setResult(null)
    setError(null)
    setTag('')
    setTitle('')
    setNotes('')
    setAuto(true)
    setPre(false)
  }, [])

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    const tg = tag.trim()
    if (!tg || tg === 'v') {
      setError('Enter a tag (e.g. v1.4.0).')
      return
    }
    if (!repo) {
      setError('No repository to ship to.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await window.decks.devbay.draftRelease({ fullName: repo.fullName, tag: tg, name: title.trim(), body: auto ? '' : notes })
      setResult(res)
      if (res.ok) setDone(true)
      else setError(res.error ?? 'Could not draft the release.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft the release.')
    }
    setBusy(false)
  }, [busy, tag, title, notes, auto, repo])

  if (!repo) {
    return (
      <div className="rise">
        <SpaceHead title="Ship" sub="The release ceremony, in two steps." />
        <CenteredState icon="ship" color={t.bright} title="No repo to ship" body="GitHub didn’t return any repositories for this token, so there’s nothing to draft a release on yet." />
      </div>
    )
  }

  if (done) {
    return (
      <div className="rise">
        <SpaceHead title="Ship" sub="The release ceremony, in two steps." />
        <div
          className="pop"
          style={{
            maxWidth: 560,
            margin: '20px auto 0',
            textAlign: 'center',
            borderRadius: 22,
            background: 'linear-gradient(135deg, color-mix(in oklch,var(--pos) 10%,var(--card)), var(--card))',
            border: '1px solid color-mix(in oklch,var(--pos) 28%,transparent)',
            padding: '40px 30px'
          }}
        >
          <div style={{ width: 78, height: 78, margin: '0 auto 20px', borderRadius: 22, display: 'grid', placeItems: 'center', background: 'color-mix(in oklch,var(--pos) 18%,transparent)', color: 'var(--pos)' }}>
            <Icon name="check" size={38} stroke={2.4} />
          </div>
          <h2 className="disp" style={{ fontSize: 24, fontWeight: 800 }}>
            Draft release created
          </h2>
          <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 10, lineHeight: 1.5, maxWidth: 400, marginInline: 'auto' }}>
            <b className="mono" style={{ color: 'var(--ink)' }}>{tag.trim()}</b> is drafted on {repo.fullName}. Review the notes on GitHub, then publish when you’re ready.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22 }}>
            {result?.url ? (
              <a
                className="tap"
                href={result.url}
                target="_blank"
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 13, background: `linear-gradient(140deg,${t.bright},${t.deep})`, color: t.ink, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}
              >
                <Icon name="external" size={16} stroke={2} /> Open on GitHub
              </a>
            ) : null}
            <button type="button" className="tap" onClick={reset} style={{ padding: '12px 18px', borderRadius: 13, background: 'var(--card-2)', border: '1px solid var(--line)', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
              Draft another
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rise">
      <SpaceHead title="Ship" sub="The release ceremony, in two steps — type a tag, toggle the options, watch it draft live." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start' }}>
        {/* composer */}
        <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* target repo — picks the freshest by default; switchable when you have many */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 13, background: 'var(--card-2)' }}>
            <span style={{ color: t.bright }}>
              <Icon name={repo.private ? 'lock' : 'repo'} size={18} stroke={2} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {repos.length > 1 ? (
                <select
                  value={repo.fullName}
                  onChange={(e) => setRepoFull(e.target.value)}
                  style={{ width: '100%', background: 'none', border: 'none', outline: 'none', color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  {repos.map((r) => (
                    <option key={r.fullName} value={r.fullName}>
                      {r.fullName}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 14, fontWeight: 700 }}>{repo.fullName}</div>
              )}
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                default branch · {repo.defaultBranch}
                {repo.language ? ` · ${repo.language}` : ''}
              </div>
            </div>
            <TabPlain label="TARGET" color={t.bright} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <InputF label="Tag" value={tag} onChange={setTag} icon="tag" placeholder="v1.4.0" />
            <InputF label="Release title" value={title} onChange={setTitle} icon="flag" placeholder={tag || 'v1.4.0'} />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Release notes</span>
              <button
                type="button"
                className="tap"
                onClick={() => setAuto((a) => !a)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: auto ? t.bright : 'var(--ink-3)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <PillToggle on={auto} /> Auto-generate from commits
              </button>
            </div>
            {auto ? (
              <div style={{ minHeight: 96, padding: 14, borderRadius: 12, background: 'var(--card-2)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
                GitHub will generate the release notes from the merged PRs and commits since your last release on{' '}
                <b className="mono" style={{ color: 'var(--ink-2)' }}>{repo.name}</b>.
              </div>
            ) : (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What changed in this release?"
                style={{ width: '100%', minHeight: 96, padding: 14, borderRadius: 12, background: 'var(--card-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13, lineHeight: 1.6, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }}
              />
            )}
          </div>

          {error ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 12, background: 'color-mix(in oklch, var(--neg) 10%, transparent)', color: 'var(--neg)', fontSize: 13, fontWeight: 600 }}>
              <Icon name="alert" size={16} stroke={2} />
              <span style={{ flex: 1 }}>{error}</span>
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              type="button"
              className="tap"
              onClick={() => setPre((p) => !p)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink)' }}
            >
              <PillToggle on={pre} /> Mark as pre-release
            </button>
            <button
              type="button"
              className="tap"
              onClick={() => void submit()}
              disabled={busy}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 13, background: `linear-gradient(140deg,${t.bright},${t.deep})`, color: t.ink, fontWeight: 700, fontSize: 14, opacity: busy ? 0.7 : 1, border: 'none', cursor: 'pointer' }}
            >
              <Icon name="ship" size={17} stroke={2} />
              {busy ? 'Drafting…' : 'Draft release'}
            </button>
          </div>
        </div>

        {/* live preview + recent releases */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ borderRadius: 18, background: `linear-gradient(135deg,${t.wash},var(--card))`, border: `1px solid ${t.line}`, padding: 18 }}>
            <TabPlain label="LIVE PREVIEW" color={t.base} />
            <div style={{ marginTop: 14, padding: 15, borderRadius: 13, background: 'var(--card-2)', border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9, flexWrap: 'wrap' }}>
                <span
                  className="mono"
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    padding: '3px 9px',
                    borderRadius: 999,
                    color: pre ? 'var(--warn)' : 'var(--pos)',
                    background: pre ? 'color-mix(in oklch,var(--warn) 15%,transparent)' : 'color-mix(in oklch,var(--pos) 15%,transparent)'
                  }}
                >
                  {pre ? 'Pre-release' : 'Latest'}
                </span>
                <span className="disp" style={{ fontSize: 15, fontWeight: 700 }}>
                  {liveTitle}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="tag" size={13} stroke={2} />
                {(tag || 'v0.0.0') + ' · draft'}
              </div>
            </div>
          </div>

          <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 14 }}>Target repository</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: t.soft, color: t.bright, flex: '0 0 auto' }}>
                <Icon name={repo.private ? 'lock' : 'repo'} size={15} stroke={2} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{repo.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {repo.stars.toLocaleString()} stars · {repo.openIssues} open
                </div>
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 13 }}>{repo.description ?? 'No description.'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── space body (tab strip from spaceShell + content) ────────────────────── */

type TabId = 'portfolio' | 'ship'
type Phase = 'loading' | 'connect' | 'ready' | 'error'

export function DevBaySpace(): JSX.Element {
  const [tab, setTab] = useState<TabId>('portfolio')
  const [phase, setPhase] = useState<Phase>('loading')
  const [data, setData] = useState<DevBayData | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // The repo currently opened "over" the Portfolio in the embedded browser.
  const [openRepo, setOpenRepo] = useState<DevBayRepo | null>(null)

  const load = useCallback(async (soft = false): Promise<void> => {
    if (soft) setRefreshing(true)
    else setPhase('loading')
    setFetchError(null)
    try {
      const st = await window.decks.devbay.status()
      if (!st.connected) {
        setPhase('connect')
        setRefreshing(false)
        return
      }
      const d = await window.decks.devbay.fetch()
      if (!d.connected) {
        setPhase('connect')
        setRefreshing(false)
        return
      }
      if (d.error && d.repos.length === 0) {
        setFetchError(d.error)
        setPhase('error')
        setRefreshing(false)
        return
      }
      setData(d)
      setPhase('ready')
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Could not reach GitHub.')
      setPhase('error')
    }
    setRefreshing(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await window.decks.devbay.disconnect()
    } catch {
      /* ignore */
    }
    setData(null)
    setPhase('connect')
  }, [])

  /* the tab strip (ported from spaceShell 628–630) */
  const tabs: [TabId, string, string][] = [
    ['portfolio', 'Portfolio', 'repo'],
    ['ship', 'Ship', 'ship']
  ]
  // While a repo is open the browser is a full-takeover detail view that brings
  // its OWN back affordance + Files/Commits tabs — the Portfolio/Ship strip would
  // double up the chrome (and at a different max-width), so we hide it then.
  const browsingNow = phase === 'ready' && tab === 'portfolio' && openRepo !== null
  const strip =
    phase === 'ready' && !browsingNow ? (
      <div style={{ position: 'sticky', top: 0, zIndex: 4, background: 'color-mix(in oklch, var(--bg) 86%, transparent)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '12px 26px', display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto' }}>
          {tabs.map(([id, label, icon]) => {
            const on = tab === id
            return (
              <button
                key={id}
                type="button"
                className="tap"
                onClick={() => setTab(id)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '8px 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  color: on ? t.ink : 'var(--ink-2)',
                  background: on ? `linear-gradient(140deg,${t.bright},${t.deep})` : 'var(--card)',
                  border: on ? '1px solid transparent' : '1px solid var(--line)'
                }}
              >
                <Icon name={icon} size={15} stroke={2} />
                {label}
              </button>
            )
          })}
        </div>
      </div>
    ) : null

  let content: ReactNode
  if (phase === 'loading') {
    content = <PortfolioSkeleton />
  } else if (phase === 'connect') {
    content = (
      <CenteredState
        icon="github"
        color={t.bright}
        title="Connect GitHub"
        body="Link a GitHub token to make scattered repos legible — what’s active, what’s neglected, what needs you — then ship a release in two steps. Your token is encrypted on this device and only ever talks to GitHub."
        action={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>
            <Icon name="link" size={15} stroke={2} /> Connect from DevBay settings to begin
          </span>
        }
      />
    )
  } else if (phase === 'error') {
    content = (
      <CenteredState
        icon="alert"
        color="var(--neg)"
        title="GitHub didn’t answer"
        body={fetchError ?? 'Something went wrong while talking to GitHub. It happens — try again in a moment.'}
        action={
          <>
            <button
              type="button"
              className="tap"
              onClick={() => void load()}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 13, background: `linear-gradient(140deg,${t.bright},${t.deep})`, color: t.ink, fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer' }}
            >
              <Icon name="refresh" size={16} stroke={2} /> Try again
            </button>
            <button type="button" className="tap" onClick={() => void disconnect()} style={{ padding: '12px 18px', borderRadius: 13, background: 'var(--card-2)', border: '1px solid var(--line)', fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>
              Disconnect
            </button>
          </>
        }
      />
    )
  } else if (data) {
    content =
      tab === 'ship' ? (
        <Ship data={data} />
      ) : (
        <Portfolio data={data} busy={refreshing} onRefresh={() => void load(true)} onDisconnect={() => void disconnect()} onOpenRepo={setOpenRepo} />
      )
  }

  // The repo browser opens "over" the Portfolio — only on the Portfolio tab.
  // (Switching to Ship yields the Portfolio body; the open repo is kept.)
  const browsing = browsingNow

  /* the violet wash + content column (ported from spaceShell 631–634) */
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300, background: `linear-gradient(${t.wash}, transparent)`, pointerEvents: 'none' }} />
      {strip}
      {browsing && openRepo ? (
        // Full-width detail view — the browser brings its own centered 1240px
        // container + scrolls its own panels; the wrapper just fills the space
        // column under the chrome (z above the violet wash so it reads cleanly).
        <div key={`browse-${openRepo.fullName}`} className="rise" style={{ position: 'relative', zIndex: 1, width: '100%' }}>
          <DevBayRepoBrowser repo={openRepo} onBack={() => setOpenRepo(null)} />
        </div>
      ) : (
        <div key={`${phase}-${tab}`} className="rise" style={{ position: 'relative', maxWidth: 1040, margin: '0 auto', padding: '26px 26px 80px' }}>
          {content}
        </div>
      )}
    </div>
  )
}
