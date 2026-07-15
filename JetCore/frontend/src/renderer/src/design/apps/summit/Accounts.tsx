/* Summit · Accounts & integrations. Mirrors summit_b.jsx · SummitAccounts on
   real data: getCredentials + getConnectedAccounts (connection tiles, each with
   a Sync button that calls startSync + polls getSyncProgress until done),
   getRecommendations (AI findings), and getSettings/saveSettings (alert prefs).
   The "implemented" tick on a recommendation is a local view-state — the backend
   exposes no implement mutation, so we don't fabricate one. */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Badge, Button, Card, Divider, SectionTitle, Skeleton, Spinner, Toggle } from '../../ui'
import { AnimatedList, Reveal } from '../../motion'
import { Icon } from '../../icons'
import { money } from '../../charts'
import {
  getCredentials,
  getConnectedAccounts,
  getRecommendations,
  getSettings,
  saveSettings,
  startSync,
  getSyncProgress,
  clearSummitCache,
  timeAgo,
  type CredentialRow,
  type ConnectedAccountRow,
  type RecommendationRow,
  type SettingsResponse,
  type SyncProgress,
  type SyncService
} from './api'
import { ErrorCard, Page, PageHead, useAsync, useMinDelay } from './shared'

const SERVICE_META: Record<string, { label: string; icon: string; what: string }> = {
  homebase: { label: 'Homebase', icon: 'people', what: 'Schedules, shifts & labor cost' },
  oracle: { label: 'Oracle MICROS', icon: 'receipt', what: 'POS sales, checks & tenders' },
  plaid: { label: 'Plaid', icon: 'wallet', what: 'Bank balances & transactions' }
}
/** Services that support a manual sync (everything else is read-only metadata). */
const SYNCABLE: SyncService[] = ['homebase', 'oracle', 'plaid']

function meta(service: string): { label: string; icon: string; what: string } {
  return SERVICE_META[service.toLowerCase()] ?? { label: service.charAt(0).toUpperCase() + service.slice(1), icon: 'link', what: 'Connected integration' }
}

const DIFFICULTY_TONE: Record<string, 'pos' | 'warn' | 'neg'> = { easy: 'pos', medium: 'warn', hard: 'neg' }

interface AccountsData {
  credentials: CredentialRow[]
  accounts: ConnectedAccountRow[]
  recommendations: RecommendationRow[]
  settings: SettingsResponse
}

const loadAccounts = async (): Promise<AccountsData> => {
  const [credentials, accounts, recommendations, settings] = await Promise.all([
    getCredentials(),
    getConnectedAccounts(),
    getRecommendations(),
    getSettings()
  ])
  return { credentials, accounts, recommendations, settings }
}

interface Connection {
  service: string
  connected: boolean
  lastSynced: string | null
  syncable: boolean
}

export function Accounts(): JSX.Element {
  const { state, reload } = useAsync(loadAccounts, 'accounts')
  const show = useMinDelay(state.phase !== 'loading')

  if (!show || state.phase === 'loading') return <AccountsSkeleton />
  if (state.phase === 'error') {
    return (
      <Page>
        <PageHead title="Accounts & integrations" sub="What Summit ingests, what it found, and your alert preferences." />
        <ErrorCard message={state.message} onRetry={reload} />
      </Page>
    )
  }

  return (
    <Reveal>
      <AccountsBody data={state.data} reload={reload} />
    </Reveal>
  )
}

function AccountsBody({ data, reload }: { data: AccountsData; reload: () => void }): JSX.Element {
  /* Merge credentials + connected accounts into one tile per known service. */
  const linked = new Map<string, string | null>()
  for (const c of data.credentials) linked.set(c.service.toLowerCase(), c.last_synced)
  for (const a of data.accounts) {
    const k = a.service.toLowerCase()
    if (!linked.has(k)) linked.set(k, a.last_synced)
  }
  const connections: Connection[] = []
  for (const s of SYNCABLE) {
    connections.push({ service: s, connected: linked.has(s), lastSynced: linked.get(s) ?? null, syncable: true })
  }
  for (const [k, last] of linked) {
    if (!SYNCABLE.includes(k as SyncService)) connections.push({ service: k, connected: true, lastSynced: last, syncable: false })
  }

  return (
    <Page>
      <PageHead title="Accounts & integrations" sub="What Summit ingests, what it found, and your alert preferences." />

      <SectionTitle icon="link" title="Connections" sub="Tokens stay encrypted on this device" />
      <AnimatedList stagger={70} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 26 }}>
        {connections.map((c) => (
          <ConnectionTile key={c.service} conn={c} onSynced={reload} />
        ))}
      </AnimatedList>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start' }}>
        <Reveal delay={120}>
          <Recommendations recs={data.recommendations} />
        </Reveal>
        <Reveal delay={180}>
          <Alerts initial={data.settings} />
        </Reveal>
      </div>
    </Page>
  )
}

/* ── connection tile (with sync + progress polling) ─────────────────────── */

function ConnectionTile({ conn, onSynced }: { conn: Connection; onSynced: () => void }): JSX.Element {
  const m = meta(conn.service)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const polling = useRef(false)

  const sync = useCallback(async (): Promise<void> => {
    if (!conn.syncable || polling.current) return
    polling.current = true
    setError(null)
    setProgress({ status: 'running', pct: 0 })
    const service = conn.service as SyncService
    try {
      await startSync(service, 30)
      // Poll ~1.2s until the backend reports it's no longer running (capped so a
      // stuck job can't poll forever — ~10 min at 1.2s intervals).
      let running = true
      for (let i = 0; running && i < 500; i++) {
        await new Promise<void>((r) => setTimeout(r, 1200))
        let p: SyncProgress
        try {
          p = await getSyncProgress(service)
        } catch {
          break // progress endpoint gone quiet — assume finished
        }
        setProgress(p)
        running = p.status === 'running'
      }
      clearSummitCache() // fresh data on the next tab open
      onSynced()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      polling.current = false
      setTimeout(() => setProgress(null), 1400)
    }
  }, [conn, onSynced])

  const running = progress?.status === 'running'
  const pct = progress?.pct ?? (progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : 0)

  return (
    <Card hover style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ width: 42, height: 42, borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
          <Icon name={m.icon} size={20} />
        </div>
        {conn.connected ? (
          <Badge tone="pos" dot>Live</Badge>
        ) : (
          <Badge>Not linked</Badge>
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{m.label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2, marginBottom: 16 }}>{m.what}</div>

      {running ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: 'var(--accent-h)', marginBottom: 8 }}>
            <Spinner size={14} />
            Syncing… {pct > 0 ? `${pct}%` : ''}
          </div>
          <div style={{ height: 5, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(4, pct)}%`, background: 'var(--accent)', borderRadius: 99, transition: 'width .4s var(--ease)' }} />
          </div>
        </div>
      ) : progress?.status === 'done' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: 'var(--pos)' }}>
          <Icon name="check" size={15} />
          Synced
        </div>
      ) : error ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--neg)', fontWeight: 600 }} title={error}>
            Sync failed
          </span>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => void sync()}>
            Retry
          </Button>
        </div>
      ) : conn.connected ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }} className="mono">
            {conn.lastSynced ? `synced ${timeAgo(conn.lastSynced) ?? '—'}` : 'never synced'}
          </span>
          {conn.syncable && (
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => void sync()}>
              Sync
            </Button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text-3)', fontWeight: 600 }}>
          <Icon name="lock" size={15} />
          Connect from the Hangar
        </div>
      )}
    </Card>
  )
}

/* ── recommendations ────────────────────────────────────────────────────── */

function Recommendations({ recs }: { recs: RecommendationRow[] }): JSX.Element {
  const [done, setDone] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(recs.map((r) => [r.id, r.is_implemented]))
  )

  if (recs.length === 0) {
    return (
      <Card>
        <SectionTitle icon="spark" title="What we found" sub="AI recommendations, ranked by monthly savings" />
        <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 0 4px', lineHeight: 1.55 }}>
          Nothing to flag yet. As Summit ingests more of your sales, labor, and spend, money-saving recommendations will
          land here — ranked by impact.
        </div>
      </Card>
    )
  }

  const ranked = recs.slice().sort((a, b) => b.monthly_savings - a.monthly_savings)

  return (
    <Card>
      <SectionTitle icon="spark" title="What we found" sub="AI recommendations, ranked by monthly savings" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {ranked.map((r) => {
          const isDone = done[r.id] ?? false
          const tone = r.implementation_difficulty ? DIFFICULTY_TONE[r.implementation_difficulty.toLowerCase()] : undefined
          const confidence = r.ai_confidence ?? 0
          return (
            <div
              key={r.id}
              style={{ display: 'flex', gap: 14, padding: 16, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)', opacity: isDone ? 0.6 : 1, transition: 'opacity .3s' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, textDecoration: isDone ? 'line-through' : 'none' }}>{r.title}</span>
                  {r.implementation_difficulty && <Badge size="sm" tone={tone}>{r.implementation_difficulty}</Badge>}
                </div>
                <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
                  {r.description ? `${r.description} ` : ''}
                  {r.monthly_savings > 0 && <strong style={{ color: 'var(--pos)' }}>{money(r.monthly_savings)}/mo</strong>}
                </p>
                {confidence > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
                    <div style={{ flex: 1, height: 5, borderRadius: 99, background: 'var(--surface-3)', maxWidth: 120 }}>
                      <div style={{ height: '100%', width: `${Math.min(100, confidence * 100)}%`, background: 'var(--accent)', borderRadius: 99 }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }} className="mono">{Math.round(confidence * 100)}% confidence</span>
                  </div>
                )}
              </div>
              <button
                className="tap"
                aria-label={isDone ? 'Mark not done' : 'Mark implemented'}
                onClick={() => setDone((s) => ({ ...s, [r.id]: !isDone }))}
                style={{ alignSelf: 'center', display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 'var(--r-sm)', background: isDone ? 'var(--accent)' : 'var(--surface-3)', color: isDone ? 'var(--accent-ink)' : 'var(--text-2)' }}
              >
                <Icon name="check" size={18} />
              </button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/* ── alerts (settings) ──────────────────────────────────────────────────── */

function Alerts({ initial }: { initial: SettingsResponse }): JSX.Element {
  const [alerts, setAlerts] = useState(initial.alerts_enabled)
  const [threshold, setThreshold] = useState(initial.labor_threshold_pct)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* debounce-persist any change to the backend. */
  const persist = useCallback((patch: Partial<SettingsResponse>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void saveSettings(patch).catch(() => {
        /* keep the optimistic UI; a reload will reconcile */
      })
    }, 400)
  }, [])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  return (
    <Card>
      <SectionTitle icon="bell" title="Alerts" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>Enable alerts</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Flag when metrics trend wrong</div>
        </div>
        <Toggle
          checked={alerts}
          onChange={(v) => {
            setAlerts(v)
            persist({ alerts_enabled: v })
          }}
        />
      </div>
      <Divider style={{ margin: '4px 0 18px' }} />
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>Labor % threshold</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 14 }}>Alert when labor cost exceeds this share of revenue.</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <input
          type="range"
          min={20}
          max={50}
          value={threshold}
          onChange={(e) => {
            const v = Number(e.target.value)
            setThreshold(v)
            persist({ labor_threshold_pct: v })
          }}
          style={{ flex: 1, accentColor: 'var(--accent)' }}
        />
        <span className="mono" style={{ fontSize: 18, fontWeight: 800, minWidth: 52, textAlign: 'right' }}>{threshold}%</span>
      </div>
    </Card>
  )
}

/* ── loading skeleton ───────────────────────────────────────────────────── */

function AccountsSkeleton(): JSX.Element {
  return (
    <Page>
      <PageHead title="Accounts & integrations" sub="What Summit ingests, what it found, and your alert preferences." />
      <SectionTitle icon="link" title="Connections" sub="Tokens stay encrypted on this device" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, marginBottom: 26 }}>
        {[0, 1, 2].map((i) => (
          <Card key={i} pad={18}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <Skeleton w={42} h={42} r={12} />
              <Skeleton w={52} h={22} r={99} />
            </div>
            <Skeleton w={120} h={15} />
            <Skeleton w={160} h={12} style={{ marginTop: 8 }} />
            <Skeleton w="100%" h={14} style={{ marginTop: 18 }} />
          </Card>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
        <Card>
          <Skeleton w={180} h={16} />
          <Skeleton w="100%" h={88} r={14} style={{ marginTop: 16 }} />
          <Skeleton w="100%" h={88} r={14} style={{ marginTop: 12 }} />
        </Card>
        <Card>
          <Skeleton w={120} h={16} />
          <Skeleton w="100%" h={48} r={12} style={{ marginTop: 16 }} />
          <Skeleton w="100%" h={48} r={12} style={{ marginTop: 12 }} />
        </Card>
      </div>
    </Page>
  )
}
