/**
 * JetCore — DevBay (developers). The repo portfolio + release ceremony.
 *
 * Ported from the Claude Design prototype (design/jetcore/project/src/devbay.jsx)
 * onto REAL data via window.decks.devbay — the GitHub token lives in main; the
 * renderer only ever sees sanitized DevBayData.
 *
 * The prototype's three "tabs" (Portfolio / Ship / Quick panel) collapse here:
 *  - Portfolio is the screen — search, language chips, staleness coding, per-repo
 *    cards with stars/issues/private/fork badges, Open + Draft release actions.
 *  - Ship becomes a 2-step draft-release modal (Overlay) launched from a card.
 *  - The Quick panel ships as its own always-on-top window (DevBayQuickPanel).
 */
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type JSX, type ReactNode } from 'react'
import type { DevBayData, DevBayRepo, DevBayReleaseResult, DevBayStatusResult } from '@shared/ipc'
import { Badge, Button, Card, Field, IconButton, Input, Skeleton, Spinner, Toggle } from '../../ui'
import { AnimatedList, CountUp, Overlay, Reveal, SpotlightCard } from '../../motion'
import { Icon } from '../../icons'
import type { JCScreenProps } from '../../contract'
import { DevBayRepoBrowser } from './DevBayRepoBrowser'

/* ── language palette (from the prototype's data) ────────────────────── */

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  Swift: '#F05138',
  'C++': '#f34b7d',
  C: '#555555',
  Ruby: '#701516',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Kotlin: '#A97BFF'
}
const langColor = (lang: string | null): string => (lang ? LANG_COLORS[lang] ?? '#888888' : '#888888')

/* ── staleness coding from pushedAt ──────────────────────────────────── */

type StaleTone = 'pos' | 'accent' | 'warn' | 'neg'
interface StaleMeta {
  tone: StaleTone
  label: string
  word: string
}
const staleDays = (iso: string): number => Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400000)

function staleMeta(days: number): StaleMeta {
  if (days < 7) return { tone: 'pos', label: days < 1 ? 'today' : `${Math.round(days)}d ago`, word: 'active' }
  if (days < 30) return { tone: 'accent', label: `${Math.round(days)}d ago`, word: 'recent' }
  if (days < 90) return { tone: 'warn', label: `${Math.round(days)}d ago`, word: 'aging' }
  return { tone: 'neg', label: `${Math.round(days)}d ago`, word: 'stale' }
}
const staleDot = (tone: StaleTone): string =>
  tone === 'pos' ? 'var(--pos)' : tone === 'warn' ? 'var(--warn)' : tone === 'neg' ? 'var(--neg)' : 'var(--accent)'

/* ── shared page wrapper (prototype geometry) ────────────────────────── */

function Page({ children, max = 1240 }: { children: ReactNode; max?: number }): JSX.Element {
  return <div style={{ maxWidth: max, margin: '0 auto', padding: '30px 40px 64px' }}>{children}</div>
}

/* ── metric tile (mirrors the prototype's MetricTile) ────────────────── */

function MetricTile({
  icon,
  label,
  value,
  sub,
  tone
}: {
  icon: string
  label: string
  value: number
  sub: string
  tone?: string
}): JSX.Element {
  return (
    <Card pad={20} hover spotlight style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-3)' }}>{label}</span>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 'var(--r-sm)',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--accent-soft)',
            color: tone ?? 'var(--accent-h)'
          }}
        >
          <Icon name={icon} size={16} />
        </div>
      </div>
      <div className="mono" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', color: tone ?? 'var(--text)' }}>
        <CountUp value={value} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{sub}</span>
    </Card>
  )
}

/* ── connect state (paste a GitHub token) ────────────────────────────── */

const CONNECT_STEPS: [string, string][] = [
  ['Open token settings', 'GitHub → Settings → Developer settings → Personal access tokens.'],
  ['Grant the right scope', 'Repo read lists your portfolio; add Contents: Read & write to draft releases.'],
  ['Paste it here', 'Drop the token below. It’s encrypted on this device and only ever talks to GitHub.']
]

function ConnectGitHub({ onConnected }: { onConnected: () => void }): JSX.Element {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    if (!token.trim()) {
      setError('Paste a GitHub personal access token.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res: DevBayStatusResult = await window.decks.devbay.connect(token.trim())
      if (res.connected) {
        onConnected()
        return
      }
      setError(res.error ?? 'Could not connect to GitHub.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to GitHub.')
    }
    setBusy(false)
  }, [busy, token, onConnected])

  return (
    <Page max={620}>
      <Reveal style={{ textAlign: 'center', marginBottom: 26 }}>
        <div
          style={{
            width: 68,
            height: 68,
            margin: '0 auto 18px',
            borderRadius: 'var(--r-lg)',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--accent-soft)',
            color: 'var(--accent-h)'
          }}
        >
          <Icon name="github" size={32} />
        </div>
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.025em' }}>Connect GitHub</h1>
        <p
          style={{
            fontSize: 14.5,
            color: 'var(--text-3)',
            marginTop: 7,
            lineHeight: 1.55,
            maxWidth: 460,
            marginLeft: 'auto',
            marginRight: 'auto'
          }}
        >
          Make scattered repos legible — what&rsquo;s active, what&rsquo;s neglected, what needs you — then ship a release
          in two steps.
        </p>
      </Reveal>

      <Reveal delay={90}>
        <Card pad={26}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
            {CONNECT_STEPS.map(([title, body], i) => (
              <div key={title} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                <div
                  className="mono"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 99,
                    flex: '0 0 auto',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--accent-soft)',
                    color: 'var(--accent-h)',
                    fontSize: 12.5,
                    fontWeight: 700
                  }}
                >
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.5 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="GitHub token" hint="Classic or fine-grained — github_pat_… or ghp_…">
              <Input
                icon="lock"
                type="password"
                placeholder="github_pat_… or ghp_…"
                value={token}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') void submit()
                }}
              />
            </Field>

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '11px 14px',
                  borderRadius: 'var(--r-sm)',
                  background: 'color-mix(in oklch, var(--neg) 10%, transparent)',
                  color: 'var(--neg)',
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                <Icon name="alert" size={16} />
                <span style={{ flex: 1 }}>{error}</span>
              </div>
            )}

            <Button
              full
              size="lg"
              iconRight={busy ? undefined : 'arrowR'}
              onClick={() => void submit()}
              disabled={busy}
              style={busy ? { opacity: 0.75 } : undefined}
            >
              {busy ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                  <Spinner size={17} /> Connecting…
                </span>
              ) : (
                'Connect GitHub'
              )}
            </Button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                justifyContent: 'center',
                fontSize: 12,
                color: 'var(--text-3)'
              }}
            >
              <Icon name="shield" size={14} />
              Your token is encrypted on this device and only ever talks to GitHub.
            </div>
          </div>
        </Card>
      </Reveal>
    </Page>
  )
}

/* ── loading + error states ──────────────────────────────────────────── */

function LoadingView(): JSX.Element {
  return (
    <Page>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22 }}>
        <div>
          <Skeleton w={220} h={27} />
          <Skeleton w={360} h={14} style={{ marginTop: 10 }} />
        </div>
        <Skeleton w={150} h={16} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} pad={20}>
            <Skeleton w={90} h={12} />
            <Skeleton w={70} h={30} style={{ marginTop: 14 }} />
            <Skeleton w={120} h={11} style={{ marginTop: 12 }} />
          </Card>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Card key={i} pad={20} style={{ minHeight: 188 }}>
            <Skeleton w="60%" h={16} />
            <Skeleton h={12} style={{ marginTop: 16 }} />
            <Skeleton w="80%" h={12} style={{ marginTop: 8 }} />
            <div style={{ display: 'flex', gap: 14, marginTop: 20 }}>
              <Skeleton w={60} h={12} />
              <Skeleton w={40} h={12} />
              <Skeleton w={40} h={12} />
            </div>
          </Card>
        ))}
      </div>
    </Page>
  )
}

function ErrorView({
  message,
  onRetry,
  onDisconnect
}: {
  message: string | null
  onRetry: () => void
  onDisconnect: () => void
}): JSX.Element {
  return (
    <Page max={920}>
      <Reveal style={{ textAlign: 'center', padding: '48px 32px', maxWidth: 400, margin: '0 auto' }}>
        <div
          style={{
            width: 68,
            height: 68,
            margin: '0 auto 18px',
            borderRadius: 'var(--r-lg)',
            display: 'grid',
            placeItems: 'center',
            background: 'color-mix(in oklch, var(--neg) 14%, transparent)',
            color: 'var(--neg)'
          }}
        >
          <Icon name="alert" size={30} />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8 }}>
          GitHub didn&rsquo;t answer
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 22 }}>
          {message ?? 'Something went wrong while talking to GitHub. It happens — try again in a moment.'}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Button icon="refresh" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="ghost" icon="logout" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      </Reveal>
    </Page>
  )
}

/* ── draft-release modal (the 2-step ship ceremony) ──────────────────── */

type ShipStep = 'compose' | 'done'

function ReleaseModal({ repo, onClose }: { repo: DevBayRepo; onClose: () => void }): JSX.Element {
  const [step, setStep] = useState<ShipStep>('compose')
  const [tag, setTag] = useState('v')
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DevBayReleaseResult | null>(null)

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    if (!tag.trim() || tag.trim() === 'v') {
      setResult({ ok: false, error: 'Enter a tag (e.g. v1.4.0).' })
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const res = await window.decks.devbay.draftRelease({
        fullName: repo.fullName,
        tag: tag.trim(),
        name: name.trim(),
        body: auto ? '' : body
      })
      setResult(res)
      if (res.ok) setStep('done')
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'Could not draft the release.' })
    }
    setBusy(false)
  }, [busy, repo.fullName, tag, name, body, auto])

  return (
    <Overlay open onClose={onClose} panelStyle={{ width: 'min(560px, 92vw)' }}>
      <Card pad={26}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--r-sm)',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--accent-soft)',
              color: 'var(--accent-h)'
            }}
          >
            <Icon name="ship" size={19} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>Draft a release</h3>
            <div className="mono" style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2 }}>
              {repo.fullName}
            </div>
          </div>
          <IconButton name="close" label="Close" onClick={onClose} />
        </div>

        {step === 'compose' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)'
              }}
            >
              <Icon name={repo.private ? 'lock' : 'repo'} size={18} style={{ color: 'var(--accent-h)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{repo.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  default branch · {repo.defaultBranch}
                  {repo.language ? ` · ${repo.language}` : ''}
                </div>
              </div>
              {repo.private ? <Badge size="sm" icon="lock">private</Badge> : null}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Tag" hint="Creates the git tag if it doesn’t exist.">
                <Input
                  icon="tag"
                  value={tag}
                  placeholder="v1.4.0"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTag(e.target.value)}
                />
              </Field>
              <Field label="Release title" hint="Defaults to the tag.">
                <Input
                  icon="flag"
                  value={name}
                  placeholder={tag || 'v1.4.0'}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                />
              </Field>
            </div>

            <div>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>Release notes</span>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12.5,
                    color: 'var(--text-3)',
                    cursor: 'pointer'
                  }}
                >
                  <Toggle checked={auto} onChange={setAuto} size={0.85} /> Auto-generate from commits
                </label>
              </div>
              <textarea
                value={auto ? '' : body}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
                disabled={auto}
                placeholder={
                  auto
                    ? 'GitHub will generate notes from merged PRs since the last release…'
                    : 'What changed in this release?'
                }
                style={{
                  width: '100%',
                  minHeight: 110,
                  padding: 14,
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)',
                  fontSize: 13.5,
                  lineHeight: 1.6,
                  resize: 'vertical',
                  outline: 'none',
                  opacity: auto ? 0.6 : 1,
                  fontFamily: 'var(--font)'
                }}
              />
            </div>

            {result?.error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '11px 14px',
                  borderRadius: 'var(--r-sm)',
                  background: 'color-mix(in oklch, var(--neg) 10%, transparent)',
                  color: 'var(--neg)',
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                <Icon name="alert" size={16} />
                <span style={{ flex: 1 }}>{result.error}</span>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                icon={busy ? undefined : 'ship'}
                onClick={() => void submit()}
                disabled={busy}
                style={busy ? { opacity: 0.75 } : undefined}
              >
                {busy ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                    <Spinner size={16} /> Drafting…
                  </span>
                ) : (
                  'Draft release'
                )}
              </Button>
            </div>
          </div>
        ) : (
          <Reveal style={{ textAlign: 'center', padding: '14px 8px 6px' }}>
            <div
              style={{
                width: 72,
                height: 72,
                margin: '0 auto 18px',
                borderRadius: 'var(--r-lg)',
                display: 'grid',
                placeItems: 'center',
                background: 'color-mix(in oklch, var(--pos) 16%, transparent)',
                color: 'var(--pos)',
                animation: 'jc-pop .5s var(--spring)'
              }}
            >
              <Icon name="check" size={34} />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>
              Draft release created
            </h3>
            <p
              style={{
                fontSize: 14,
                color: 'var(--text-3)',
                marginBottom: 22,
                maxWidth: 380,
                marginInline: 'auto',
                lineHeight: 1.55
              }}
            >
              <span className="mono">{tag.trim()}</span> is drafted on {repo.fullName}. Review the notes on GitHub, then
              publish when you&rsquo;re ready.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              {result?.url && (
                <Button
                  variant="primary"
                  iconRight="external"
                  onClick={() => {
                    if (result.url) window.open(result.url, '_blank')
                  }}
                >
                  Open on GitHub
                </Button>
              )}
              <Button
                variant="surface"
                onClick={() => {
                  setStep('compose')
                  setResult(null)
                  setTag('v')
                  setName('')
                  setBody('')
                }}
              >
                Draft another
              </Button>
            </div>
          </Reveal>
        )}
      </Card>
    </Overlay>
  )
}

/* ── portfolio (the screen body) ─────────────────────────────────────── */

type SortKey = 'pushed' | 'stale' | 'stars' | 'issues'
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'pushed', label: 'Freshest' },
  { value: 'stale', label: 'Most stale' },
  { value: 'stars', label: 'Stars' },
  { value: 'issues', label: 'Open issues' }
]

function Portfolio({
  login,
  repos,
  dataError,
  onRefresh,
  onDisconnect,
  busy
}: {
  login?: string
  repos: DevBayRepo[]
  dataError?: string
  onRefresh: () => void
  onDisconnect: () => void
  busy: boolean
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('pushed')
  const [lang, setLang] = useState('all')
  const [ship, setShip] = useState<DevBayRepo | null>(null)
  const [browse, setBrowse] = useState<DevBayRepo | null>(null)

  const langs = useMemo(() => {
    const seen = new Set<string>()
    for (const r of repos) if (r.language) seen.add(r.language)
    return ['all', ...Array.from(seen)]
  }, [repos])

  const totalStars = useMemo(() => repos.reduce((a, r) => a + r.stars, 0), [repos])
  const activeCount = useMemo(() => repos.filter((r) => staleDays(r.pushedAt) < 7).length, [repos])
  const staleCount = useMemo(() => repos.filter((r) => staleDays(r.pushedAt) > 60).length, [repos])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let r = lang === 'all' ? repos.slice() : repos.filter((x) => x.language === lang)
    if (q)
      r = r.filter(
        (x) =>
          x.name.toLowerCase().includes(q) ||
          x.fullName.toLowerCase().includes(q) ||
          (x.description?.toLowerCase().includes(q) ?? false)
      )
    r.sort((a, b) => {
      if (sort === 'stars') return b.stars - a.stars
      if (sort === 'issues') return b.openIssues - a.openIssues
      const da = staleDays(a.pushedAt)
      const db = staleDays(b.pushedAt)
      return sort === 'stale' ? db - da : da - db
    })
    return r
  }, [repos, query, lang, sort])

  const open = (r: DevBayRepo): void => {
    window.open(r.url, '_blank')
  }

  // View switch: a selected repo swaps the portfolio body for the repo browser.
  if (browse) return <DevBayRepoBrowser repo={browse} onBack={() => setBrowse(null)} />

  return (
    <Page>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22, gap: 16, flexWrap: 'wrap' }}>
        <Reveal>
          <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.025em' }}>Portfolio</h1>
          <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>
            Every repo, made legible — what&rsquo;s active, what&rsquo;s neglected, what needs you.
          </p>
        </Reveal>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {login && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)' }}>
              <Icon name="github" size={16} /> connected as{' '}
              <strong style={{ color: 'var(--text-2)' }}>@{login}</strong>
            </span>
          )}
          <IconButton name="refresh" label="Refresh" onClick={onRefresh} active={busy} />
          <Button variant="ghost" size="sm" icon="logout" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      </div>

      {dataError && (
        <Reveal style={{ marginBottom: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '11px 14px',
              borderRadius: 'var(--r-sm)',
              background: 'color-mix(in oklch, var(--warn) 12%, transparent)',
              color: 'var(--warn)',
              fontSize: 13,
              fontWeight: 600
            }}
          >
            <Icon name="alert" size={16} />
            <span style={{ flex: 1 }}>{dataError}</span>
          </div>
        </Reveal>
      )}

      <AnimatedList stagger={60} style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 }}>
        <MetricTile icon="repo" label="Repositories" value={repos.length} sub="owned + collaborating" />
        <MetricTile icon="branch" label="Active this week" value={activeCount} sub="pushed in last 7 days" />
        <MetricTile icon="alert" label="Going stale" value={staleCount} sub="no activity in 60+ days" tone="var(--warn)" />
        <MetricTile icon="star" label="Total stars" value={totalStars} sub="across all repos" />
      </AnimatedList>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input
          icon="search"
          placeholder="Search repositories…"
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          style={{ height: 40, width: 280, maxWidth: '100%' }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SORTS.map((s) => {
            const on = sort === s.value
            return (
              <button
                key={s.value}
                className="tap"
                onClick={() => setSort(s.value)}
                style={{
                  padding: '7px 13px',
                  borderRadius: 'var(--r-pill)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                  color: on ? 'var(--accent-h)' : 'var(--text-2)',
                  border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>
        <div style={{ flex: 1, minWidth: 12 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {langs.slice(0, 7).map((l) => {
            const on = lang === l
            return (
              <button
                key={l}
                className="tap"
                onClick={() => setLang(l)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 'var(--r-pill)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                  color: on ? 'var(--accent-h)' : 'var(--text-2)',
                  border: '1px solid var(--border)'
                }}
              >
                {l !== 'all' && (
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: langColor(l) }} />
                )}
                {l === 'all' ? 'All languages' : l}
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Reveal style={{ textAlign: 'center', padding: '56px 32px', maxWidth: 420, margin: '0 auto' }}>
          <div
            style={{
              width: 68,
              height: 68,
              margin: '0 auto 18px',
              borderRadius: 'var(--r-lg)',
              display: 'grid',
              placeItems: 'center',
              background: 'var(--accent-soft)',
              color: 'var(--accent-h)'
            }}
          >
            <Icon name="repo" size={30} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8 }}>
            {repos.length === 0 ? 'No repositories yet' : 'No repos match'}
          </h3>
          <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55 }}>
            {repos.length === 0
              ? 'GitHub didn’t return any repositories for this token. Check its scope, then refresh.'
              : 'Nothing matches your search and filters. Try clearing them.'}
          </p>
        </Reveal>
      ) : (
        <AnimatedList fill stagger={45} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, alignItems: 'stretch' }}>
          {filtered.map((r) => {
            const sm = staleMeta(staleDays(r.pushedAt))
            return (
              <SpotlightCard
                key={r.fullName}
                className="jc-card jc-card-hover"
                strength={0.12}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  flex: 1,
                  minHeight: 188
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <button
                    className="tap"
                    onClick={() => setBrowse(r)}
                    title="Browse repository"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      minWidth: 0,
                      textAlign: 'left',
                      color: 'inherit'
                    }}
                  >
                    <Icon
                      name={r.private ? 'lock' : 'repo'}
                      size={17}
                      style={{ color: 'var(--text-3)', flex: '0 0 auto' }}
                    />
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {r.name}
                    </span>
                  </button>
                  <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                    {r.private && (
                      <Badge size="sm" icon="lock">
                        private
                      </Badge>
                    )}
                    {r.fork && (
                      <Badge size="sm" icon="branch">
                        fork
                      </Badge>
                    )}
                  </div>
                </div>

                <p
                  style={{
                    fontSize: 12.8,
                    color: 'var(--text-3)',
                    lineHeight: 1.5,
                    flex: 1,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}
                >
                  {r.description ?? 'No description.'}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12.5, color: 'var(--text-2)' }}>
                  {r.language && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: langColor(r.language) }} />
                      {r.language}
                    </span>
                  )}
                  <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="star" size={13} />
                    {r.stars}
                  </span>
                  <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="alert" size={13} />
                    {r.openIssues}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 12,
                    borderTop: '1px solid var(--border)'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: staleDot(sm.tone) }} />
                    <span className="mono" style={{ color: 'var(--text-3)' }}>
                      {sm.label}
                    </span>
                    <Badge size="sm" tone={sm.tone}>
                      {sm.word}
                    </Badge>
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button variant="surface" size="sm" icon="eye" onClick={() => setBrowse(r)}>
                      Browse
                    </Button>
                    <Button variant="surface" size="sm" icon="external" onClick={() => open(r)} aria-label="Open on GitHub" />
                    <Button variant="soft" size="sm" icon="ship" onClick={() => setShip(r)}>
                      Draft release
                    </Button>
                  </div>
                </div>
              </SpotlightCard>
            )
          })}
        </AnimatedList>
      )}

      {ship && <ReleaseModal repo={ship} onClose={() => setShip(null)} />}
    </Page>
  )
}

/* ── screen ──────────────────────────────────────────────────────────── */

type Phase = 'loading' | 'connect' | 'ready' | 'error'

export function DevBayScreen(props: JCScreenProps): JSX.Element {
  void props // go/openSettings unused — DevBay is self-contained.
  const [phase, setPhase] = useState<Phase>('loading')
  const [data, setData] = useState<DevBayData | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

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

  if (phase === 'loading') return <LoadingView />
  if (phase === 'connect') return <ConnectGitHub onConnected={() => void load()} />
  if (phase === 'error')
    return <ErrorView message={fetchError} onRetry={() => void load()} onDisconnect={() => void disconnect()} />

  return (
    <Portfolio
      login={data?.login}
      repos={data?.repos ?? []}
      dataError={data?.error}
      busy={refreshing}
      onRefresh={() => void load(true)}
      onDisconnect={() => void disconnect()}
    />
  )
}
