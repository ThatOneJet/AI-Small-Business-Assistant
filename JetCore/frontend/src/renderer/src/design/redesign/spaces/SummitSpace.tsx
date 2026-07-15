/**
 * JetCore redesign — the Summit space (warm-editorial "Hangar" port).
 *
 * A ground-up redesign of the operations space onto LIVE data, rendered ONLY as
 * the scrollable body (the Hangar shell draws the chrome). Self-contained: owns
 * its tab + range + simulator + savings state, loads from the PyInstaller Flask
 * backend through `window.decks.summit.api` (reusing the typed endpoint helpers
 * + interfaces + signature engine from ../../apps/summit), and never fabricates
 * numbers — when a source is missing it shows an honest "connect your shop" state.
 *
 * Ported from JetCore.dc.html · renderSummit (752–847): Overview (KPIs + daily
 * bars + tender mix + top sellers + a working 7d/30d/90d range), Labor (the
 * signature labor simulator + today's shifts), Finances (balance + transactions
 * + top costs), Integrations (status tiles + apply-able recommendations with a
 * running savings tally).
 *
 * Signature touch (per the brief): EVERY big numeral ticks up on open via
 * <CountUp> — revenue, profit, margin, labor %, balance, costs, savings.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type JSX, type ReactNode } from 'react'
import { tone, DOMAINS } from '../system'
import { CountUp } from '../anim'
import { consumeJump } from '../Hangar'
import { Icon } from '../../icons'
import {
  getProfit,
  getTenders,
  getLaborInsights,
  getLabor,
  getSales,
  getFinances,
  getTransactions,
  getConnectedAccounts,
  getCredentials,
  getRecommendations,
  verifyCredential,
  startSync,
  getSyncProgress,
  clearSummitCache,
  humanizeTender,
  isExcludedTender,
  fmtDay,
  timeAgo,
  SummitError,
  type ProfitResponse,
  type TendersResponse,
  type InsightsResponse,
  type LaborResponse,
  type SalesResponse,
  type FinancesResponse,
  type TransactionsResponse,
  type ConnectedAccountRow,
  type CredentialRow,
  type RecommendationRow,
  type SyncService
} from '../../apps/summit/api'
import { dowName, dowIndex, fmtHour, buildBoard, computeCoverage, type BoardModel } from '../../apps/summit/signature/engine'

/* ── palette + tiny formatters ───────────────────────────────────────────── */

const T = tone(DOMAINS.summit.hue, DOMAINS.summit.c) // green hue 150 — tone(150, 0.13)
const GREEN = T.bright

/** "$12,480" — rounded, grouped. */
function money(n: number): string {
  return '$' + Math.round(n).toLocaleString()
}
/** "$12.5k" — compact for tight legend / cost rows. */
function moneyK(n: number): string {
  if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + Math.round(n).toLocaleString()
}
/** A CountUp that renders compacted ($12.5k) values while ticking. */
function MoneyUp({ value, k = false }: { value: number; k?: boolean }): JSX.Element {
  return <CountUp value={value} format={k ? moneyK : money} />
}

type SummitTab = 'overview' | 'schedule' | 'labor' | 'finances' | 'integrations'
type Range = '7d' | '30d' | '90d'
function daysFor(r: Range): number {
  return r === '7d' ? 7 : r === '30d' ? 30 : 90
}

/* tender / series colours harmonised with the Summit green */
const SERIES = [GREEN, tone(200, 0.13).base, tone(110, 0.14).base, tone(280, 0.14).base, tone(165, 0.12).base, tone(95, 0.13).base]

/* ── shared presentational primitives (design kpi/spaceHead/card) ─────────── */

function Card({ children, style }: { children: ReactNode; style?: CSSProperties }): JSX.Element {
  return <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 20, ...style }}>{children}</div>
}

function SpaceHead({ title, sub, right }: { title: string; sub: string; right?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
      <div>
        <h1 className="disp" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</h1>
        <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 6 }}>{sub}</p>
      </div>
      {right ?? null}
    </div>
  )
}

/** A KPI tile whose value ticks up on open (CountUp). */
function Kpi({
  icon,
  label,
  value,
  sub,
  color = GREEN,
  delta
}: {
  icon: string
  label: string
  /** the rendered, animating value (already wrapped in CountUp) */
  value: ReactNode
  sub?: string
  color?: string
  delta?: string | null
}): JSX.Element {
  return (
    <div className="lift" style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: `color-mix(in oklch, ${color} 15%, transparent)`, color }}>
            <Icon name={icon} size={16} stroke={2} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }}>{label}</span>
        </div>
        {delta ? (
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: delta[0] === '-' ? 'var(--neg)' : 'var(--pos)' }}>{delta}</span>
        ) : null}
      </div>
      <div className="mono disp" style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{sub}</div> : null}
    </div>
  )
}

/** Daily bars (height-scaled, value on hover) — design bars(). */
function Bars({ data, color = GREEN, h = 150 }: { data: { v: number; label: string }[]; color?: string; h?: number }): JSX.Element {
  const mx = Math.max(1, ...data.map((d) => d.v))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: h, padding: '0 2px' }}>
      {data.map((d, i) => (
        <div
          key={i}
          title={`${d.label}: ${money(d.v)}`}
          style={{ flex: 1, height: Math.max(3, (d.v / mx) * h) + 'px', background: color, borderRadius: '4px 4px 2px 2px', opacity: 0.5 + 0.5 * (d.v / mx) }}
        />
      ))}
    </div>
  )
}

interface Seg {
  label: string
  value: number
  color: string
}
/** Donut (SVG arcs) with a centred label — design donutSvg(). */
function Donut({ segs, size = 150, topLabel, botLabel }: { segs: Seg[]; size?: number; topLabel: string; botLabel: string }): JSX.Element {
  const total = Math.max(1, segs.reduce((a, s) => a + s.value, 0))
  const R = size / 2
  const sw = size * 0.16
  const r = R - sw / 2
  const cir = 2 * Math.PI * r
  let acc = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {segs.map((s, i) => {
          const len = (s.value / total) * cir
          const off = cir - acc
          acc += len
          return <circle key={i} cx={R} cy={R} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${len} ${cir - len}`} strokeDashoffset={off} />
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <div className="mono disp" style={{ fontSize: 20, fontWeight: 700 }}>{botLabel}</div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 600 }}>{topLabel}</div>
        </div>
      </div>
    </div>
  )
}
function Legend({ segs, fmt }: { segs: Seg[]; fmt: (v: number) => string }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 16 }}>
      {segs.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: '0 0 auto' }} />
          <span style={{ flex: 1, color: 'var(--ink-2)', fontWeight: 500 }}>{s.label}</span>
          <span className="mono" style={{ fontWeight: 700 }}>{fmt(s.value)}</span>
        </div>
      ))}
    </div>
  )
}

function PillTag({ label }: { label: string }): JSX.Element {
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 999, background: T.soft, color: GREEN, fontSize: 11, fontWeight: 700, letterSpacing: '.1em' }}>
      {label}
    </span>
  )
}

/* ── load / empty / error states ─────────────────────────────────────────── */

function skel(w: number | string, h: number, mt = 0, br = 8): CSSProperties {
  return { width: w, height: h, marginTop: mt, borderRadius: br, background: 'var(--card-2)', animation: 'jc-pulse 1.4s ease-in-out infinite' }
}
function Loading(): JSX.Element {
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '26px 26px 80px' }}>
      <div style={skel(220, 36)} />
      <div style={skel(420, 18, 10)} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginTop: 22 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={skel('100%', 104, 0, 18)} />
        ))}
      </div>
      <div style={skel('100%', 230, 18, 18)} />
    </div>
  )
}

function EmptyConnect({ title, body, onConnect }: { title: string; body: string; onConnect: () => void }): JSX.Element {
  return (
    <div style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', borderRadius: 26, background: `linear-gradient(135deg, ${T.wash}, var(--card))`, border: `1px solid ${T.line}`, padding: '46px 32px' }}>
      <div style={{ width: 76, height: 76, margin: '0 auto 22px', borderRadius: 22, display: 'grid', placeItems: 'center', color: T.ink, background: `linear-gradient(140deg,${T.bright},${T.deep})`, boxShadow: `0 16px 36px -14px ${T.line}` }}>
        <Icon name="link" size={36} stroke={2} />
      </div>
      <h2 className="disp" style={{ fontSize: 24, fontWeight: 800 }}>{title}</h2>
      <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 10, maxWidth: 400, marginInline: 'auto', lineHeight: 1.5 }}>{body}</p>
      <button
        className="tap"
        onClick={onConnect}
        style={{ marginTop: 22, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 14, background: `linear-gradient(140deg,${T.bright},${T.deep})`, color: T.ink, fontWeight: 700, fontSize: 14.5, boxShadow: `0 10px 26px -10px ${T.line}` }}
      >
        Connect your shop
        <Icon name="arrowR" size={17} stroke={2} />
      </button>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div style={{ maxWidth: 560, margin: '40px auto', textAlign: 'center', borderRadius: 22, background: 'var(--card)', border: '1px solid var(--line)', padding: '40px 32px' }}>
      <div style={{ width: 64, height: 64, margin: '0 auto 18px', borderRadius: 18, display: 'grid', placeItems: 'center', color: 'var(--warn)', background: 'color-mix(in oklch, var(--warn) 14%, transparent)' }}>
        <Icon name="alert" size={30} stroke={2} />
      </div>
      <h2 className="disp" style={{ fontSize: 22, fontWeight: 800 }}>Couldn’t reach Summit</h2>
      <p style={{ fontSize: 14, color: 'var(--ink-2)', marginTop: 10, maxWidth: 420, marginInline: 'auto', lineHeight: 1.5 }}>{message}</p>
      <button className="tap" onClick={onRetry} style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 17px', borderRadius: 13, background: 'var(--ink)', color: 'var(--bg)', fontWeight: 700, fontSize: 14 }}>
        <Icon name="refresh" size={16} stroke={2} />
        Try again
      </button>
    </div>
  )
}

/* ── data model ──────────────────────────────────────────────────────────── */

interface SummitData {
  profit: ProfitResponse
  tenders: TendersResponse
  insights: InsightsResponse
  sales: SalesResponse
  labor: LaborResponse
  finances: FinancesResponse
  transactions: TransactionsResponse
  accounts: ConnectedAccountRow[]
  /** API credentials (Homebase/Oracle) — the source of truth for what's connected
   *  even before a sync has imported any data or created a ConnectedAccount row. */
  credentials: CredentialRow[]
  recs: RecommendationRow[]
}

type Phase =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: SummitData }

/** Honest empty fallbacks so one unconnected source (e.g. no bank yet) degrades
 *  to an empty section instead of erroring the whole space. */
const EMPTY_FINANCES: FinancesResponse = { total_balance: 0, deposits: 0, large_transactions: [], daily_deposits: {}, daily_sales: {}, important_costs: [] }
const EMPTY_TXNS: TransactionsResponse = { transactions: [], chart_data: [], current_balance: 0, totals: { income: 0, expenses: 0, net: 0 } }

async function loadSummit(days: number): Promise<SummitData> {
  // `getProfit` is the critical call: its failure is a real backend/cold-start
  // error worth surfacing. Everything else degrades to an honest empty shape so
  // a missing POS / bank / scheduler shows an empty section, not an error page.
  const soft = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback)
  const [profit, tenders, insights, sales, labor, finances, transactions, accounts, credentials, recs] = await Promise.all([
    getProfit(days),
    soft(getTenders(days), { tenders: [], by_type: {}, summary: { total_amount: 0, total_transactions: 0 } }),
    soft(getLaborInsights(days), { by_dow: [], insights: [], avg_labor_pct: null }),
    soft(getSales(days), { sales: [], summary: { total_revenue: 0, record_count: 0, order_count: 0 } }),
    soft(getLabor(days), {
      shifts: [],
      summary: {
        total_scheduled_hours: 0,
        total_actual_hours: 0,
        total_labor_cost: 0,
        overtime_shifts: 0,
        shift_count: 0,
        comparison: { cost_pct: null, hours_pct: null, ot_pct: null, prev_cost: 0, prev_hours: 0, prev_ot: 0, label: '' }
      },
      chart_data: { labels: [], cost: [], hours: [], ot: [] }
    }),
    soft(getFinances(days), EMPTY_FINANCES),
    soft(getTransactions(days), EMPTY_TXNS),
    soft(getConnectedAccounts(), [] as ConnectedAccountRow[]),
    soft(getCredentials(), [] as CredentialRow[]),
    soft(getRecommendations(), [] as RecommendationRow[])
  ])
  return { profit, tenders, insights, sales, labor, finances, transactions, accounts, credentials, recs }
}

/* ── the space ───────────────────────────────────────────────────────────── */

export function SummitSpace(): JSX.Element {
  const [tab, setTab] = useState<SummitTab>('overview')
  // Land on the right tab when the Hangar radar jumped here (one-shot vault hint).
  useEffect(() => {
    let alive = true
    void consumeJump('summit').then((hint) => {
      if (!alive || !hint) return
      const valid: SummitTab[] = ['overview', 'schedule', 'labor', 'finances', 'integrations']
      if ((valid as string[]).includes(hint)) setTab(hint as SummitTab)
    })
    return () => {
      alive = false
    }
  }, [])
  const [range, setRange] = useState<Range>('30d')
  const [state, setState] = useState<Phase>({ phase: 'loading' })
  const [nonce, setNonce] = useState(0)

  const days = daysFor(range)

  // Range control re-pulls + recomputes; a nonce drives manual retry.
  useEffect(() => {
    let alive = true
    setState({ phase: 'loading' })
    loadSummit(days)
      .then((data) => {
        if (alive) setState({ phase: 'ready', data })
      })
      .catch((e: unknown) => {
        if (!alive) return
        const message = e instanceof SummitError ? e.message : e instanceof Error ? e.message : 'Something went wrong'
        setState({ phase: 'error', message })
      })
    return () => {
      alive = false
    }
  }, [days, nonce])

  const retry = useCallback(() => setNonce((n) => n + 1), [])
  const goIntegrations = useCallback(() => setTab('integrations'), [])

  const tabs: [SummitTab, string, string][] = [
    ['overview', 'Overview', 'chart'],
    ['schedule', 'Schedule', 'calendar'],
    ['labor', 'Labor', 'people'],
    ['finances', 'Finances', 'wallet'],
    ['integrations', 'Integrations', 'link']
  ]

  // Sub-nav (warm pills) lives at the top of the scrollable body.
  const nav = (
    <div style={{ position: 'sticky', top: 0, zIndex: 4, background: 'color-mix(in oklch, var(--bg) 86%, transparent)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '12px 26px', display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto' }}>
        {tabs.map(([id, label, icon]) => {
          const on = tab === id
          return (
            <button
              key={id}
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
                color: on ? T.ink : 'var(--ink-2)',
                background: on ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'var(--card)',
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
  )

  let body: ReactNode
  if (state.phase === 'loading') {
    body = <Loading />
  } else if (state.phase === 'error') {
    body = (
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '26px 26px 80px' }}>
        <ErrorState message={state.message} onRetry={retry} />
      </div>
    )
  } else {
    const d = state.data
    // Honest gate: the DATA tabs (Overview / Labor / Finances) need the backend AND
    // at least one connected source. The Integrations tab is the place you CONNECT,
    // so it must ALWAYS be reachable — it never gets gated behind this empty state.
    const connected =
      d.accounts.length > 0 ||
      d.credentials.length > 0 ||
      d.profit.summary.total_revenue > 0 ||
      d.profit.summary.total_labor > 0 ||
      d.profit.daily.length > 0
    let inner: ReactNode
    if (tab === 'integrations') {
      // Always reachable — pass `retry` so a fresh connect re-pulls the whole space.
      inner = <IntegrationsTab data={d} onChanged={retry} />
    } else if (!connected) {
      // Data tabs only: show the honest "connect your shop" state, with a CTA that
      // jumps to Integrations (where you actually connect).
      inner = (
        <EmptyConnect
          title="Connect your shop"
          body="Link your POS, scheduling, and bank to see revenue, labor, and cash flow for your location — all on real numbers."
          onConnect={goIntegrations}
        />
      )
    } else if (tab === 'schedule') {
      inner = <ScheduleTab data={d} onConnect={goIntegrations} />
    } else if (tab === 'labor') {
      inner = <LaborTab data={d} range={range} days={days} onConnect={goIntegrations} />
    } else if (tab === 'finances') {
      inner = <FinancesTab data={d} range={range} />
    } else {
      inner = <OverviewTab data={d} range={range} onRange={setRange} />
    }
    // key on tab so the CountUp + .rise entrance replays when you switch tabs.
    body = (
      <div key={tab} className="rise" style={{ maxWidth: 1040, margin: '0 auto', padding: '26px 26px 80px' }}>
        {inner}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300, background: `linear-gradient(${T.wash}, transparent)`, pointerEvents: 'none' }} />
      {nav}
      {body}
    </div>
  )
}

/* ── range control (7d / 30d / 90d) ──────────────────────────────────────── */

function RangeControl({ range, onRange }: { range: Range; onRange: (r: Range) => void }): JSX.Element {
  const opts: [Range, string][] = [
    ['7d', '7d'],
    ['30d', '30d'],
    ['90d', '90d']
  ]
  return (
    <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 999, background: 'var(--card)', border: '1px solid var(--line)' }}>
      {opts.map(([id, label]) => {
        const on = range === id
        return (
          <button
            key={id}
            className="tap"
            onClick={() => onRange(id)}
            style={{
              padding: '6px 13px',
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              border: 'none',
              background: on ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'transparent',
              color: on ? T.ink : 'var(--ink-3)'
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

const RANGE_LABEL: Record<Range, string> = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days' }

/** % change vs the prior equal window, as a "+8.4%" string (null when no base). */
function deltaStr(curr: number, prev: number): string | null {
  if (!prev) return null
  const p = ((curr - prev) / Math.abs(prev)) * 100
  return (p >= 0 ? '+' : '') + p.toFixed(1) + '%'
}

/* ── OVERVIEW ────────────────────────────────────────────────────────────── */

function OverviewTab({ data, range, onRange }: { data: SummitData; range: Range; onRange: (r: Range) => void }): JSX.Element {
  const { profit, tenders, insights, sales } = data
  const s = profit.summary
  const daily = profit.daily
  const hasRevenue = s.total_revenue > 0

  // KPI values straight off the backend summary (rounded on display via CountUp).
  const rev = s.total_revenue
  const prof = s.total_profit
  const margin = s.avg_margin_pct ?? 0
  const laborPct = s.labor_pct ?? 0

  // week-over-week deltas from the daily series (matches the prototype's wow).
  const tailSum = (from: number, to: number, pick: (d: ProfitResponse['daily'][number]) => number): number =>
    daily.slice(from, to).reduce((a, dd) => a + pick(dd), 0)
  const revWow = deltaStr(tailSum(-7, daily.length, (x) => x.revenue), tailSum(-14, -7, (x) => x.revenue))
  const profWow = deltaStr(tailSum(-7, daily.length, (x) => x.profit), tailSum(-14, -7, (x) => x.profit))

  // daily-profit bars across the whole range
  const bars = daily.map((dd) => ({ v: Math.max(0, dd.profit), label: fmtDay(dd.date) }))
  const lastProfit = daily.length ? daily[daily.length - 1].profit : 0

  // tender mix donut (exclude comps/voids; card share for the centre)
  const tenderEntries = Object.entries(tenders.by_type).filter(([t]) => !isExcludedTender(t))
  const tenderTotal = tenderEntries.reduce((a, [, v]) => a + v.amount, 0)
  const segs: Seg[] = tenderEntries
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([t, v], i) => ({ label: humanizeTender(t), value: v.amount, color: SERIES[i % SERIES.length] }))
  const cardAmount = tenderEntries.filter(([t]) => /card|credit|debit|visa|master|amex|discover/i.test(t)).reduce((a, [, v]) => a + v.amount, 0)
  const cardSharePct = tenderTotal ? Math.round((cardAmount / tenderTotal) * 100) : 0

  // top sellers by revenue (aggregate sales rows by item)
  const byItem = new Map<string, number>()
  for (const row of sales.sales) {
    const name = row.item?.trim()
    if (!name) continue
    byItem.set(name, (byItem.get(name) ?? 0) + row.revenue)
  }
  const items = [...byItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([item, r]) => ({ item, rev: r }))
  const maxItem = Math.max(1, ...items.map((i) => i.rev))

  return (
    <div>
      <SpaceHead
        title="Overview"
        sub="How your location is performing — and what’s trending wrong."
        right={<RangeControl range={range} onRange={onRange} />}
      />

      {/* KPI tiles — every numeral ticks up on open */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
        <Kpi icon="trend" label="Revenue" value={<MoneyUp value={rev} />} sub={RANGE_LABEL[range]} delta={revWow} />
        <Kpi icon="bolt" label="Net profit" value={<MoneyUp value={prof} />} sub="revenue − labor" delta={profWow} />
        <Kpi icon="donut" label="Avg margin" value={<CountUp value={margin} decimals={1} suffix="%" />} sub="across period" />
        {hasRevenue ? (
          <Kpi icon="people" label="Labor %" value={<CountUp value={laborPct} decimals={1} suffix="%" />} sub="of revenue" color={laborPct > 30 ? 'var(--warn)' : GREEN} />
        ) : (
          <Kpi icon="people" label="Labor cost" value={<MoneyUp value={s.total_labor} />} sub={RANGE_LABEL[range]} color="var(--warn)" />
        )}
      </div>

      {/* daily profit + trending-wrong */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start', marginBottom: 18 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div>
              <div className="disp" style={{ fontSize: 16, fontWeight: 700 }}>Daily profit</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Revenue minus labor, {RANGE_LABEL[range]}</div>
            </div>
            <span className="mono disp" style={{ fontSize: 18, fontWeight: 700, color: GREEN }}>
              <MoneyUp value={lastProfit} />
            </span>
          </div>
          {bars.length ? <Bars data={bars} /> : <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '30px 0' }}>No daily profit yet for this period.</div>}
        </Card>

        <div style={{ borderRadius: 18, background: 'linear-gradient(135deg, color-mix(in oklch,var(--warn) 8%,var(--card)), var(--card))', border: '1px solid var(--line)', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
            <span style={{ color: 'var(--warn)' }}><Icon name="alert" size={18} stroke={2} /></span>
            <span className="disp" style={{ fontSize: 16, fontWeight: 700 }}>Trending wrong</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {insights.insights.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 13, borderRadius: 12, background: 'color-mix(in oklch,var(--pos) 10%,transparent)', color: 'var(--pos)', fontSize: 13, fontWeight: 600 }}>
                <Icon name="check" size={16} stroke={2} />
                Nothing trending wrong this period.
              </div>
            ) : (
              insights.insights.map((ins, i) => {
                const over = ins.type === 'overstaffed'
                return (
                  <div key={i} style={{ padding: 13, borderRadius: 12, background: over ? 'color-mix(in oklch,var(--warn) 10%,transparent)' : 'var(--card-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                      <span style={{ color: over ? 'var(--warn)' : GREEN }}><Icon name={over ? 'arrowUp' : 'info'} size={14} stroke={2} /></span>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{ins.dow} · {ins.labor_pct.toFixed(1)}% labor</span>
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{ins.message}</p>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* tender mix + top sellers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Card>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Tender mix</div>
          {segs.length ? (
            <>
              <Donut segs={segs} topLabel="card share" botLabel={`${cardSharePct}%`} />
              <Legend segs={segs} fmt={(v) => moneyK(v)} />
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '20px 0' }}>No tender data for this period.</div>
          )}
        </Card>
        <Card>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Top sellers</div>
          {items.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {items.map((it, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span style={{ fontWeight: 600 }}>{it.item}</span>
                    <span className="mono" style={{ fontWeight: 700 }}>{moneyK(it.rev)}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 99, background: 'var(--card-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (it.rev / maxItem) * 100 + '%', background: GREEN, borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '20px 0' }}>No itemised sales yet — connect your POS to break out menu performance.</div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   SCHEDULE BUILDER — the hero feature.

   The owner BUILDS the week they actually commit. We pre-fill a SUGGESTED weekly
   schedule from ~4 weeks of their REAL history (sales-by-hour/day → expected
   demand per day×daypart → a suggested staff count per shift). They then build by
   hand: DRAG staff chips from a roster onto day×shift slots, set ORDER quantities
   for key supplies, and we GUIDE LIVE (over/under-staffed flags, running labor
   cost vs a settable budget) as they place people. COMMIT publishes the plan +
   order and persists it to the E2EE vault. Nothing is fabricated — when the
   sources are thin the suggestion degrades and we say so.

   Vault keys:
     'summit.schedule.week' → { weekOf, assignments:{slotKey:staffId[]}, orders, laborBudget, published }
     'summit.roster'        → Staff[]  (only when none can be derived from labor data)
     'jc.summary.summit'    → cross-app summary for Hangar Radar (stable shape)
   ════════════════════════════════════════════════════════════════════════════ */

const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The three dayparts the week grid is built on (hours are [start, end) 24h). */
interface Daypart {
  id: 'morning' | 'midday' | 'evening'
  label: string
  hours: [number, number]
}
const DAYPARTS: Daypart[] = [
  { id: 'morning', label: 'Morning', hours: [6, 11] },
  { id: 'midday', label: 'Midday', hours: [11, 16] },
  { id: 'evening', label: 'Evening', hours: [16, 23] }
]

/** A slot is one day × one daypart. Its key is the persisted assignment key. */
function slotKey(dow: number, part: Daypart['id']): string {
  return `${dow}:${part}`
}

interface Staff {
  id: string
  name: string
  role: string
  /** hourly rate, used for live labor cost; 0 when unknown (falls back to blended). */
  rate: number
}

/** One supply line the owner orders against the weekend/peak demand. */
interface OrderItem {
  key: string
  label: string
  unit: string
  /** suggested qty sized to the week's projected demand */
  suggested: number
}
const ORDER_ITEMS: OrderItem[] = [
  { key: 'produce', label: 'Produce', unit: 'cases', suggested: 0 },
  { key: 'protein', label: 'Protein', unit: 'lbs', suggested: 0 },
  { key: 'dry', label: 'Dry goods', unit: 'units', suggested: 0 },
  { key: 'beverage', label: 'Beverage', unit: 'cases', suggested: 0 }
]

/** The persisted week plan (vault 'summit.schedule.week'). */
interface WeekPlan {
  weekOf: string
  assignments: Record<string, string[]>
  orders: Record<string, number>
  laborBudget: number
  published: boolean
}

const WEEK_KEY = 'summit.schedule.week'
const ROSTER_KEY = 'summit.roster'
const SUMMARY_KEY = 'jc.summary.summit'

/** Monday-anchored ISO date of the current week (stable per render via Date.now). */
function currentWeekOf(): string {
  const now = new Date()
  const dow = now.getDay() // 0=Sun
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset)
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
}

/* ── SUGGESTION DERIVATION ────────────────────────────────────────────────────
   From the REAL last-~4-weeks pull (getSales hourly rows + getLabor shifts), we
   derive expected demand per day×daypart and a suggested staff count per slot.

   demand[dow][part] = average $ that day-of-week pulls in that daypart's hours,
   across the weeks present in the data (so a quiet café and a busy bar both get a
   right-sized count). The suggested staff = ceil(demand / salesPerStaffTarget),
   where the target is the location's OWN realised sales-per-staffed-hour from the
   labor data (median rate's worth of coverage) — falling back to a sane default
   only when there's no labor history at all. */

interface Suggestion {
  /** suggested staff per slotKey */
  staff: Record<string, number>
  /** projected sales per slotKey (rounded $) */
  demand: Record<string, number>
  /** weeks of history the suggestion is built from */
  weeks: number
  /** blended hourly rate from the labor data (0 when none) */
  avgRate: number
  /** realised sales each staffed hour pulls (the staffing target) */
  salesPerStaffHour: number
  /** the busiest day×daypart (label) for the ordering hint */
  peakLabel: string | null
  /** total projected weekly sales */
  weeklySales: number
}

function deriveSuggestion(sales: SalesResponse, labor: LaborResponse): Suggestion {
  // ── 1. expected demand per dow×daypart, averaged over distinct weeks seen ──
  // sum revenue into [dow][part], and track how many distinct (dow, week) pairs
  // contributed so we can average to a typical single day.
  const sums = new Map<string, number>()
  const dayWeeks = new Map<number, Set<string>>() // dow → set of ISO week-of strings
  for (const r of sales.sales) {
    if (!r.date || r.hour === null) continue
    const iso = r.date.slice(0, 10)
    const dow = dowIndex(iso)
    const part = DAYPARTS.find((p) => r.hour! >= p.hours[0] && r.hour! < p.hours[1])
    if (!part) continue
    const k = slotKey(dow, part.id)
    sums.set(k, (sums.get(k) ?? 0) + r.revenue)
    // bucket the date into its Monday-week to count distinct occurrences
    const d = new Date(`${iso}T12:00:00Z`)
    const wd = d.getUTCDay()
    const monOff = wd === 0 ? -6 : 1 - wd
    const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + monOff))
    const weekId = mon.toISOString().slice(0, 10)
    if (!dayWeeks.has(dow)) dayWeeks.set(dow, new Set())
    dayWeeks.get(dow)!.add(weekId)
  }

  const allWeeks = new Set<string>()
  for (const set of dayWeeks.values()) for (const w of set) allWeeks.add(w)
  const weeks = Math.max(1, allWeeks.size)

  // ── 2. the staffing target: realised sales per staffed hour from labor data ──
  const totalStaffedHours = labor.shifts.reduce((a, s) => a + (s.scheduled_hours || s.actual_hours || 0), 0)
  const realisedSales = sales.summary.total_revenue || sales.sales.reduce((a, r) => a + r.revenue, 0)
  const rates = labor.shifts.map((s) => s.hourly_rate).filter((r) => r > 0)
  const avgRate = rates.length ? rates.reduce((a, r) => a + r, 0) / rates.length : 0
  // $/staffed-hour the location actually runs at; default ~$140/hr/head when no
  // labor history exists (a deliberately conservative full-service number).
  const salesPerStaffHour = totalStaffedHours > 0 && realisedSales > 0 ? realisedSales / totalStaffedHours : 140

  // ── 3. demand + suggested staff per slot ──
  const demand: Record<string, number> = {}
  const staff: Record<string, number> = {}
  let weeklySales = 0
  let peakLabel: string | null = null
  let peakVal = -1
  for (let dow = 0; dow < 7; dow++) {
    for (const part of DAYPARTS) {
      const k = slotKey(dow, part.id)
      const occ = dayWeeks.get(dow)?.size ?? 0
      const avg = occ > 0 ? (sums.get(k) ?? 0) / occ : 0
      const rounded = Math.round(avg)
      demand[k] = rounded
      weeklySales += rounded
      // staff this slot: enough heads so each covers ~salesPerStaffHour×(daypart
      // hours). A slot with real demand always gets ≥1; zero demand gets 0.
      const partHours = part.hours[1] - part.hours[0]
      const capacityPerHead = salesPerStaffHour * partHours
      staff[k] = rounded <= 0 ? 0 : Math.max(1, Math.round(rounded / Math.max(1, capacityPerHead)))
      if (rounded > peakVal) {
        peakVal = rounded
        peakLabel = `${DAYS_SHORT[dow]} ${part.label.toLowerCase()}`
      }
    }
  }

  return { staff, demand, weeks, avgRate, salesPerStaffHour, peakLabel, weeklySales: Math.round(weeklySales) }
}

/** Derive a roster from real shift data (distinct names + their role/rate). */
function deriveRoster(labor: LaborResponse): Staff[] {
  const byName = new Map<string, { roles: Map<string, number>; rates: number[] }>()
  for (const s of labor.shifts) {
    const name = s.employee_name?.trim()
    if (!name) continue
    if (!byName.has(name)) byName.set(name, { roles: new Map(), rates: [] })
    const entry = byName.get(name)!
    const role = s.role?.trim() || s.department?.trim() || ''
    if (role) entry.roles.set(role, (entry.roles.get(role) ?? 0) + 1)
    if (s.hourly_rate > 0) entry.rates.push(s.hourly_rate)
  }
  const out: Staff[] = []
  for (const [name, info] of byName) {
    const role = [...info.roles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Staff'
    const rate = info.rates.length ? info.rates.reduce((a, r) => a + r, 0) / info.rates.length : 0
    out.push({ id: `hb:${name.toLowerCase().replace(/\s+/g, '-')}`, name, role, rate: Math.round(rate * 100) / 100 })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/* ── live per-slot guidance verdict ──────────────────────────────────────────── */
type SlotVerdict = 'over' | 'under' | 'good' | 'idle'
interface SlotEval {
  verdict: SlotVerdict
  /** $ wasted (over) — labor cost with little projected sales */
  wasted: number
  /** $ at risk (under) — projected sales a thin crew can't capture */
  atRisk: number
  /** labor cost booked into this slot */
  cost: number
}

/** Evaluate one placed slot against its projected demand (the live guide). */
function evalSlot(part: Daypart, demand: number, placed: Staff[], avgRate: number, salesPerStaffHour: number): SlotEval {
  const partHours = part.hours[1] - part.hours[0]
  const heads = placed.length
  const cost = placed.reduce((a, s) => a + (s.rate > 0 ? s.rate : avgRate) * partHours, 0)
  if (demand <= 0 && heads === 0) return { verdict: 'idle', wasted: 0, atRisk: 0, cost: 0 }
  // capacity one head can serve in this daypart, and what the placed crew covers
  const capacityPerHead = salesPerStaffHour * partHours
  const covered = heads * capacityPerHead
  if (heads === 0) {
    // demand with nobody on → all of it is at risk
    return { verdict: 'under', wasted: 0, atRisk: Math.round(demand), cost: 0 }
  }
  if (demand <= 0 || covered > demand * 1.6) {
    // over-covered: the heads beyond what demand needs are wasted spend
    const needed = demand <= 0 ? 0 : Math.max(1, Math.ceil(demand / Math.max(1, capacityPerHead)))
    const extra = Math.max(0, heads - needed)
    const perHead = cost / heads
    return { verdict: 'over', wasted: Math.round(extra * perHead), atRisk: 0, cost: Math.round(cost) }
  }
  if (covered < demand * 0.7) {
    // under-staffed busy slot: the uncovered demand is lost-sales risk
    return { verdict: 'under', wasted: 0, atRisk: Math.round(demand - covered), cost: Math.round(cost) }
  }
  return { verdict: 'good', wasted: 0, atRisk: 0, cost: Math.round(cost) }
}

const VERDICT_TONE: Record<SlotVerdict, string> = {
  over: 'var(--warn)',
  under: 'var(--neg)',
  good: GREEN,
  idle: 'var(--ink-3)'
}

/* ── the Schedule Builder tab ──────────────────────────────────────────────── */

function ScheduleTab({ data, onConnect }: { data: SummitData; onConnect: () => void }): JSX.Element {
  const { sales, labor, profit } = data

  // suggestion + roster are pure derivations of the real pull (memoised).
  const suggestion = useMemo(() => deriveSuggestion(sales, labor), [sales, labor])
  const derivedRoster = useMemo(() => deriveRoster(labor), [labor])

  // the suggestion needs hourly sales AND/OR shift data to be meaningful.
  const hasBasis = suggestion.weeklySales > 0 || derivedRoster.length > 0 || labor.shifts.length > 0
  if (!hasBasis) return <ScheduleUnavailable onConnect={onConnect} />

  return (
    <Builder
      key={suggestion.weeklySales + ':' + derivedRoster.length}
      suggestion={suggestion}
      derivedRoster={derivedRoster}
      profit={profit}
    />
  )
}

function ScheduleUnavailable({ onConnect }: { onConnect: () => void }): JSX.Element {
  return (
    <div>
      <SpaceHead title="Schedule" sub="Build the week you commit — pre-filled from your history, guided as you place people." />
      <div style={{ borderRadius: 18, background: `linear-gradient(135deg, ${T.wash}, var(--card))`, border: `1px solid ${T.line}`, padding: 22 }}>
        <PillTag label="SCHEDULE BUILDER" />
        <div className="disp" style={{ fontSize: 19, fontWeight: 700, margin: '12px 0 6px' }}>Not enough history to pre-fill a week yet</div>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 520 }}>
          The builder pre-fills a suggested week from your sales-by-hour and your roster. Connect your POS and scheduler
          and it’ll size each shift from your real demand — then you drag staff and place the order.
        </p>
        <button className="tap" onClick={onConnect} style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderRadius: 12, background: 'var(--ink)', color: 'var(--bg)', fontWeight: 700, fontSize: 13 }}>
          Connect sources <Icon name="arrowR" size={15} stroke={2} />
        </button>
      </div>
    </div>
  )
}

/** Seed an empty week plan from the suggestion (used on first open / auto-fill). */
function seedPlan(weekOf: string, suggestion: Suggestion): WeekPlan {
  // suggested order sizes from projected weekly sales: rough food-cost split, sized
  // up to the peak. These are STARTING numbers the owner adjusts.
  const wk = suggestion.weeklySales
  const orders: Record<string, number> = {
    produce: Math.max(0, Math.round((wk * 0.06) / 60)), // ~$60/case
    protein: Math.max(0, Math.round((wk * 0.1) / 6)), // ~$6/lb
    dry: Math.max(0, Math.round((wk * 0.04) / 20)),
    beverage: Math.max(0, Math.round((wk * 0.05) / 45))
  }
  return { weekOf, assignments: {}, orders, laborBudget: 0, published: false }
}

function Builder({ suggestion, derivedRoster, profit }: { suggestion: Suggestion; derivedRoster: Staff[]; profit: ProfitResponse }): JSX.Element {
  const weekOf = useMemo(() => currentWeekOf(), [])
  const [roster, setRoster] = useState<Staff[]>(derivedRoster)
  // assignments: slotKey → staffId[]
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [orders, setOrders] = useState<Record<string, number>>(() => seedPlan(weekOf, suggestion).orders)
  // labor budget defaults to ~28% of projected weekly sales (a healthy target).
  const [laborBudget, setLaborBudget] = useState<number>(Math.round((suggestion.weeklySales * 0.28) / 10) * 10)
  const [published, setPublished] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const hydrated = useRef(false)

  const staffById = useMemo(() => new Map(roster.map((s) => [s.id, s])), [roster])

  // ── hydrate from the vault once (this week only) + load a typed roster ──
  useEffect(() => {
    let alive = true
    Promise.all([window.decks.vault.get(WEEK_KEY), window.decks.vault.get(ROSTER_KEY)])
      .then(([weekRaw, rosterRaw]) => {
        if (!alive) return
        if (rosterRaw && derivedRoster.length === 0) {
          try {
            const typed = JSON.parse(rosterRaw) as Staff[]
            if (Array.isArray(typed) && typed.length) setRoster(typed)
          } catch {
            /* ignore malformed roster */
          }
        }
        if (weekRaw) {
          try {
            const plan = JSON.parse(weekRaw) as WeekPlan
            if (plan?.weekOf === weekOf) {
              setAssignments(plan.assignments ?? {})
              if (plan.orders) setOrders(plan.orders)
              if (typeof plan.laborBudget === 'number' && plan.laborBudget > 0) setLaborBudget(plan.laborBudget)
              setPublished(!!plan.published)
            }
          } catch {
            /* ignore malformed plan */
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        hydrated.current = true
      })
    return () => {
      alive = false
    }
  }, [weekOf, derivedRoster.length])

  // ── persist the plan (debounced-ish: called on every committed change) ──
  const persist = useCallback(
    async (next: WeekPlan): Promise<void> => {
      try {
        await window.decks.vault.set({ key: WEEK_KEY, plaintext: JSON.stringify(next) })
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      } catch {
        /* vault locked — keep the in-memory edit */
      }
    },
    []
  )

  const planNow = useCallback(
    (over?: Partial<WeekPlan>): WeekPlan => ({ weekOf, assignments, orders, laborBudget, published, ...over }),
    [weekOf, assignments, orders, laborBudget, published]
  )

  // ── live cost + guidance, recomputed on every placement ──
  const slotEvals = useMemo(() => {
    const out = new Map<string, SlotEval>()
    for (let dow = 0; dow < 7; dow++) {
      for (const part of DAYPARTS) {
        const k = slotKey(dow, part.id)
        const placed = (assignments[k] ?? []).map((id) => staffById.get(id)).filter((s): s is Staff => !!s)
        out.set(k, evalSlot(part, suggestion.demand[k] ?? 0, placed, suggestion.avgRate, suggestion.salesPerStaffHour))
      }
    }
    return out
  }, [assignments, staffById, suggestion])

  const totals = useMemo(() => {
    let cost = 0
    let wasted = 0
    let atRisk = 0
    let over = 0
    let under = 0
    let good = 0
    for (const ev of slotEvals.values()) {
      cost += ev.cost
      wasted += ev.wasted
      atRisk += ev.atRisk
      if (ev.verdict === 'over') over++
      else if (ev.verdict === 'under') under++
      else if (ev.verdict === 'good') good++
    }
    return { cost: Math.round(cost), wasted: Math.round(wasted), atRisk: Math.round(atRisk), over, under, good }
  }, [slotEvals])

  const budgetPct = laborBudget > 0 ? Math.round((totals.cost / laborBudget) * 100) : 0
  const overBudget = laborBudget > 0 && totals.cost > laborBudget

  // labor status for the cross-app summary
  const laborStatus: 'ok' | 'hot' | 'lean' = overBudget || totals.over > totals.good ? 'hot' : totals.under > 0 ? 'lean' : 'ok'

  // ── cross-app summary write (Hangar Radar reads 'jc.summary.summit') ──
  const writeSummary = useCallback(
    (isPublished: boolean): void => {
      const todayProfit = profit.daily.length ? profit.daily[profit.daily.length - 1].profit : null
      // the single biggest live problem becomes the headline + leak
      let headline = 'Week looks balanced'
      let leak: { label: string; amount: number } | null = null
      // find the worst under-staffed slot (lost-sales risk), else worst over slot
      let worstUnder: { label: string; amount: number } | null = null
      let worstOver: { label: string; amount: number } | null = null
      for (let dow = 0; dow < 7; dow++) {
        for (const part of DAYPARTS) {
          const ev = slotEvals.get(slotKey(dow, part.id))
          if (!ev) continue
          const label = `${DAYS_SHORT[dow]} ${part.label.toLowerCase()}`
          if (ev.verdict === 'under' && (!worstUnder || ev.atRisk > worstUnder.amount)) worstUnder = { label, amount: ev.atRisk }
          if (ev.verdict === 'over' && (!worstOver || ev.wasted > worstOver.amount)) worstOver = { label, amount: ev.wasted }
        }
      }
      if (worstUnder) {
        headline = `${worstUnder.label} understaffed at peak`
        leak = { label: `Lost sales risk · ${worstUnder.label}`, amount: Math.round(worstUnder.amount) }
      } else if (worstOver) {
        headline = `${worstOver.label} overstaffed`
        leak = { label: `Wasted labor · ${worstOver.label}`, amount: Math.round(worstOver.amount) }
      } else if (overBudget) {
        headline = `Labor over budget by ${money(totals.cost - laborBudget)}`
        leak = { label: 'Over labor budget', amount: Math.round(totals.cost - laborBudget) }
      }
      const summary = {
        app: 'summit' as const,
        updatedAt: Date.now(),
        headline,
        todayProfit: typeof todayProfit === 'number' ? Math.round(todayProfit) : null,
        leak,
        laborStatus,
        published: isPublished
      }
      void window.decks.vault.set({ key: SUMMARY_KEY, plaintext: JSON.stringify(summary) }).catch(() => {})
    },
    [slotEvals, profit, laborStatus, overBudget, totals.cost, laborBudget]
  )

  // refresh the cross-app summary whenever the live picture changes (so Hangar
  // sees the current build even before publish), throttled to the eval change.
  useEffect(() => {
    if (!hydrated.current) return
    writeSummary(published)
  }, [writeSummary, published])

  // ── drag-build actions ──
  const placeStaff = useCallback(
    (key: string, staffId: string): void => {
      setAssignments((cur) => {
        const list = cur[key] ?? []
        if (list.includes(staffId)) return cur
        const next = { ...cur, [key]: [...list, staffId] }
        void persist(planNow({ assignments: next }))
        return next
      })
    },
    [persist, planNow]
  )
  const removeStaff = useCallback(
    (key: string, staffId: string): void => {
      setAssignments((cur) => {
        const list = cur[key] ?? []
        if (!list.includes(staffId)) return cur
        const next = { ...cur, [key]: list.filter((id) => id !== staffId) }
        void persist(planNow({ assignments: next }))
        return next
      })
    },
    [persist, planNow]
  )

  // auto-fill untouched slots from the suggestion (round-robin the roster).
  const autoFill = useCallback((): void => {
    setAssignments((cur) => {
      const next: Record<string, string[]> = { ...cur }
      let cursor = 0
      const pool = roster.length ? roster : []
      for (let dow = 0; dow < 7; dow++) {
        for (const part of DAYPARTS) {
          const k = slotKey(dow, part.id)
          if (next[k] && next[k].length) continue // owner already touched it
          const want = suggestion.staff[k] ?? 0
          if (want <= 0 || !pool.length) continue
          const ids: string[] = []
          for (let i = 0; i < want; i++) {
            ids.push(pool[cursor % pool.length].id)
            cursor++
          }
          next[k] = ids
        }
      }
      void persist(planNow({ assignments: next }))
      return next
    })
  }, [roster, suggestion, persist, planNow])

  const clearAll = useCallback((): void => {
    setAssignments({})
    setPublished(false)
    void persist(planNow({ assignments: {}, published: false }))
  }, [persist, planNow])

  const setOrder = useCallback(
    (key: string, qty: number): void => {
      setOrders((cur) => {
        const next = { ...cur, [key]: Math.max(0, qty) }
        void persist(planNow({ orders: next }))
        return next
      })
    },
    [persist, planNow]
  )

  const onBudget = useCallback(
    (v: number): void => {
      setLaborBudget(Math.max(0, v))
      void persist(planNow({ laborBudget: Math.max(0, v) }))
    },
    [persist, planNow]
  )

  const publish = useCallback((): void => {
    setPublished(true)
    void persist(planNow({ published: true }))
    writeSummary(true)
  }, [persist, planNow, writeSummary])

  // typed-roster fallback (when nothing could be derived from labor data)
  const addTypedStaff = useCallback(
    (name: string, role: string): void => {
      const trimmed = name.trim()
      if (!trimmed) return
      const member: Staff = { id: `manual:${Date.now()}`, name: trimmed, role: role.trim() || 'Staff', rate: 0 }
      setRoster((cur) => {
        const next = [...cur, member]
        void window.decks.vault.set({ key: ROSTER_KEY, plaintext: JSON.stringify(next) }).catch(() => {})
        return next
      })
    },
    []
  )

  const placedCount = useMemo(() => Object.values(assignments).reduce((a, l) => a + l.length, 0), [assignments])

  return (
    <div>
      <SpaceHead
        title="Schedule"
        sub={`Week of ${fmtDay(weekOf)} · pre-filled from ${suggestion.weeks} week${suggestion.weeks === 1 ? '' : 's'} of your history — drag staff and place the order.`}
        right={
          published ? (
            <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 999, background: 'color-mix(in oklch,var(--pos) 16%,transparent)', color: 'var(--pos)', fontSize: 12, fontWeight: 700 }}>
              <Icon name="check" size={14} stroke={2} /> Published
            </span>
          ) : savedAt ? (
            <span style={{ fontSize: 12, color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="check" size={13} stroke={2} /> Draft saved {savedAt}
            </span>
          ) : null
        }
      />

      {/* live budget / guidance KPIs — recompute on every placement */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
        <Kpi icon="people" label="Staff placed" value={<CountUp value={placedCount} format={(n) => String(Math.round(n))} />} sub={`${totals.good} slots covered well`} />
        <Kpi icon="cash" label="Labor cost" value={<MoneyUp value={totals.cost} />} sub={laborBudget > 0 ? `${budgetPct}% of budget` : 'set a budget →'} color={overBudget ? 'var(--warn)' : GREEN} />
        <Kpi icon="alert" label="Over-staffed $" value={<MoneyUp value={totals.wasted} />} sub={`${totals.over} slot${totals.over === 1 ? '' : 's'} wasting spend`} color={totals.wasted > 0 ? 'var(--warn)' : GREEN} />
        <Kpi icon="trend" label="Lost-sales risk" value={<MoneyUp value={totals.atRisk} />} sub={`${totals.under} slot${totals.under === 1 ? '' : 's'} too thin`} color={totals.atRisk > 0 ? 'var(--neg)' : GREEN} />
      </div>

      {/* budget bar */}
      <BudgetBar cost={totals.cost} budget={laborBudget} onBudget={onBudget} overBudget={overBudget} pct={budgetPct} />

      {/* the build surface: roster sidebar + week grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr', gap: 16, marginTop: 16, alignItems: 'start' }}>
        <RosterSidebar roster={roster} dragId={dragId} onDragId={setDragId} onAddTyped={addTypedStaff} canType={derivedRoster.length === 0} />
        <WeekGrid
          suggestion={suggestion}
          assignments={assignments}
          slotEvals={slotEvals}
          staffById={staffById}
          dragId={dragId}
          onDropStaff={placeStaff}
          onRemoveStaff={removeStaff}
        />
      </div>

      {/* ordering */}
      <OrderPanel suggestion={suggestion} orders={orders} onOrder={setOrder} />

      {/* commit row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
        <button
          className="tap"
          onClick={autoFill}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderRadius: 13, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', fontWeight: 700, fontSize: 13.5 }}
        >
          <Icon name="spark" size={16} stroke={2} /> Auto-fill the rest
        </button>
        <button
          className="tap"
          onClick={clearAll}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 15px', borderRadius: 13, background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-3)', fontWeight: 600, fontSize: 13 }}
        >
          <Icon name="refresh" size={15} stroke={2} /> Clear
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="tap"
          onClick={publish}
          disabled={placedCount === 0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            padding: '13px 20px',
            borderRadius: 14,
            border: 'none',
            cursor: placedCount === 0 ? 'default' : 'pointer',
            opacity: placedCount === 0 ? 0.5 : 1,
            background: published ? 'color-mix(in oklch,var(--pos) 18%,transparent)' : `linear-gradient(140deg,${T.bright},${T.deep})`,
            color: published ? 'var(--pos)' : T.ink,
            fontWeight: 800,
            fontSize: 14.5,
            boxShadow: published ? 'none' : `0 10px 26px -10px ${T.line}`
          }}
        >
          <Icon name={published ? 'check' : 'send'} size={17} stroke={2} />
          {published ? 'Published — update plan' : 'Publish schedule + place order'}
        </button>
      </div>
    </div>
  )
}

/* ── budget bar ────────────────────────────────────────────────────────────── */

function BudgetBar({ cost, budget, onBudget, overBudget, pct }: { cost: number; budget: number; onBudget: (v: number) => void; overBudget: boolean; pct: number }): JSX.Element {
  const fill = budget > 0 ? Math.min(100, pct) : 0
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: overBudget ? 'var(--warn)' : GREEN }}><Icon name="target" size={17} stroke={2} /></span>
          <span className="disp" style={{ fontSize: 15.5, fontWeight: 700 }}>Weekly labor budget</span>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-2)' }}>
          <span>Budget</span>
          <span className="mono" style={{ color: 'var(--ink-3)' }}>$</span>
          <input
            type="number"
            min={0}
            step={50}
            value={budget || ''}
            placeholder="0"
            onChange={(e) => onBudget(Number(e.target.value))}
            className="mono"
            style={{ width: 96, padding: '7px 10px', borderRadius: 10, background: 'var(--card-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 700, outline: 'none', textAlign: 'right' }}
          />
        </label>
      </div>
      <div style={{ height: 12, borderRadius: 99, background: 'var(--card-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: fill + '%', borderRadius: 99, background: overBudget ? 'var(--warn)' : `linear-gradient(90deg,${T.bright},${T.deep})`, transition: 'width .25s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12.5 }}>
        <span className="mono" style={{ fontWeight: 700, color: overBudget ? 'var(--warn)' : 'var(--ink-2)' }}>
          {money(cost)} booked{budget > 0 ? ` · ${pct}%` : ''}
        </span>
        <span style={{ color: 'var(--ink-3)' }}>
          {budget <= 0 ? 'Set a weekly cap to track spend live.' : overBudget ? `Over by ${money(cost - budget)} — trim a slow slot.` : `${money(budget - cost)} of headroom left.`}
        </span>
      </div>
    </Card>
  )
}

/* ── roster sidebar (draggable staff chips) ────────────────────────────────── */

function RosterSidebar({ roster, dragId, onDragId, onAddTyped, canType }: { roster: Staff[]; dragId: string | null; onDragId: (id: string | null) => void; onAddTyped: (name: string, role: string) => void; canType: boolean }): JSX.Element {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  return (
    <Card style={{ padding: 16, position: 'sticky', top: 70 }}>
      <div className="disp" style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 4 }}>Roster</div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 12 }}>Drag onto a shift</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roster.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>No staff yet — add a few below to start placing them.</div>
        ) : (
          roster.map((s) => {
            const initials = s.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
            return (
              <div
                key={s.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', s.id)
                  e.dataTransfer.effectAllowed = 'copy'
                  onDragId(s.id)
                }}
                onDragEnd={() => onDragId(null)}
                className="tap"
                title={`Drag ${s.name} onto a shift`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '8px 9px',
                  borderRadius: 11,
                  cursor: 'grab',
                  background: dragId === s.id ? T.soft : 'var(--card-2)',
                  border: '1px solid var(--line)'
                }}
              >
                <span className="mono" style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: T.soft, color: GREEN, fontSize: 11, fontWeight: 700, flex: '0 0 auto' }}>{initials}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{s.role}{s.rate > 0 ? ` · $${s.rate}/h` : ''}</div>
                </div>
              </div>
            )
          })
        )}
      </div>
      {canType ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onAddTyped(name, role)
            setName('')
            setRole('')
          }}
          style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ ...FIELD_STYLE, padding: '8px 10px', fontSize: 12.5, marginBottom: 7 }} />
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. Server)" style={{ ...FIELD_STYLE, padding: '8px 10px', fontSize: 12.5, marginBottom: 8 }} />
          <button type="submit" className="tap" style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', background: `linear-gradient(140deg,${T.bright},${T.deep})`, color: T.ink, fontSize: 12.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="plus" size={14} stroke={2} /> Add staff
          </button>
        </form>
      ) : null}
    </Card>
  )
}

/* ── the week grid (days × dayparts, drop targets + live flags) ────────────── */

function WeekGrid({
  suggestion,
  assignments,
  slotEvals,
  staffById,
  dragId,
  onDropStaff,
  onRemoveStaff
}: {
  suggestion: Suggestion
  assignments: Record<string, string[]>
  slotEvals: Map<string, SlotEval>
  staffById: Map<string, Staff>
  dragId: string | null
  onDropStaff: (key: string, staffId: string) => void
  onRemoveStaff: (key: string, staffId: string) => void
}): JSX.Element {
  return (
    <Card style={{ padding: 14, overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `72px repeat(7, minmax(116px, 1fr))`, gap: 6, minWidth: 880 }}>
        {/* header row */}
        <div />
        {DAYS_SHORT.map((label, dow) => (
          <div key={dow} style={{ textAlign: 'center', padding: '4px 0 8px' }}>
            <div className="disp" style={{ fontSize: 13, fontWeight: 700 }}>{label}</div>
          </div>
        ))}
        {/* one row per daypart */}
        {DAYPARTS.map((part) => (
          <Fragment key={part.id}>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '6px 4px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink-2)' }}>{part.label}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{fmtHourRange(part.hours)}</div>
            </div>
            {DAYS_FULL.map((_, dow) => {
              const key = slotKey(dow, part.id)
              const ev = slotEvals.get(key) ?? { verdict: 'idle' as SlotVerdict, wasted: 0, atRisk: 0, cost: 0 }
              const placed = (assignments[key] ?? []).map((id) => staffById.get(id)).filter((s): s is Staff => !!s)
              return (
                <SlotCell
                  key={key}
                  demand={suggestion.demand[key] ?? 0}
                  suggested={suggestion.staff[key] ?? 0}
                  placed={placed}
                  ev={ev}
                  dragActive={dragId !== null}
                  onDrop={(staffId) => onDropStaff(key, staffId)}
                  onRemove={(staffId) => onRemoveStaff(key, staffId)}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
      {/* legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap', fontSize: 11.5, color: 'var(--ink-2)' }}>
        <LegendChip color={GREEN} label="Good coverage" />
        <LegendChip color="var(--warn)" label="Over-staffed ($ wasted)" />
        <LegendChip color="var(--neg)" label="Under-staffed (lost sales)" />
      </div>
    </Card>
  )
}

function LegendChip({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
      {label}
    </span>
  )
}

function fmtHourRange([a, b]: [number, number]): string {
  return `${fmtHour(a)}–${fmtHour(b)}`
}

/* ── one slot cell: a drop target with live verdict + placed chips ─────────── */

function SlotCell({
  demand,
  suggested,
  placed,
  ev,
  dragActive,
  onDrop,
  onRemove
}: {
  demand: number
  suggested: number
  placed: Staff[]
  ev: SlotEval
  dragActive: boolean
  onDrop: (staffId: string) => void
  onRemove: (staffId: string) => void
}): JSX.Element {
  const [over, setOver] = useState(false)
  const tone = VERDICT_TONE[ev.verdict]
  const flagged = ev.verdict === 'over' || ev.verdict === 'under'
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData('text/plain')
        if (id) onDrop(id)
      }}
      style={{
        minHeight: 92,
        borderRadius: 12,
        padding: 7,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        background: over ? T.soft : flagged ? `color-mix(in oklch, ${tone} 7%, var(--card-2))` : 'var(--card-2)',
        border: over ? `1px dashed ${T.base}` : `1px solid ${flagged ? `color-mix(in oklch, ${tone} 32%, var(--line))` : 'var(--line)'}`,
        transition: 'background .15s ease, border-color .15s ease'
      }}
    >
      {/* projected demand + suggested count */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{demand > 0 ? moneyK(demand) : '—'}</span>
        {suggested > 0 ? (
          <span className="mono" title="Suggested staff" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--ink-3)' }}>sug {suggested}</span>
        ) : null}
      </div>

      {/* placed chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, alignContent: 'flex-start' }}>
        {placed.map((s) => {
          const initials = s.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
          return (
            <button
              key={s.id}
              onClick={() => onRemove(s.id)}
              className="tap"
              title={`${s.name} — click to remove`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px 2px 3px', borderRadius: 999, border: 'none', cursor: 'pointer', background: T.soft, color: GREEN, fontSize: 10.5, fontWeight: 700 }}
            >
              <span className="mono" style={{ width: 16, height: 16, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'color-mix(in oklch,' + GREEN + ' 22%,transparent)', fontSize: 8 }}>{initials}</span>
              {s.name.split(/\s+/)[0]}
            </button>
          )
        })}
        {placed.length === 0 ? (
          <span style={{ fontSize: 10.5, color: dragActive ? GREEN : 'var(--ink-3)', alignSelf: 'center', margin: 'auto' }}>{dragActive ? 'drop here' : demand > 0 ? 'empty' : ''}</span>
        ) : null}
      </div>

      {/* live verdict line */}
      {ev.verdict === 'over' ? (
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: tone }}>−{moneyK(ev.wasted)} wasted</span>
      ) : ev.verdict === 'under' ? (
        <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: tone }}>{moneyK(ev.atRisk)} at risk</span>
      ) : ev.verdict === 'good' ? (
        <span style={{ fontSize: 9.5, fontWeight: 700, color: tone, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="check" size={10} stroke={2.4} /> good</span>
      ) : (
        <span style={{ height: 12 }} />
      )}
    </div>
  )
}

/* ── ordering panel (size supplies to the projected demand) ────────────────── */

function OrderPanel({ suggestion, orders, onOrder }: { suggestion: Suggestion; orders: Record<string, number>; onOrder: (key: string, qty: number) => void }): JSX.Element {
  const seeded = useMemo(() => seedPlan('', suggestion).orders, [suggestion])
  return (
    <Card style={{ marginTop: 16, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: GREEN }}><Icon name="ship" size={18} stroke={2} /></span>
          <span className="disp" style={{ fontSize: 16, fontWeight: 700 }}>Place the order</span>
        </div>
        {suggestion.peakLabel ? (
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Sized for the peak — <b style={{ color: 'var(--ink-2)' }}>{suggestion.peakLabel}</b></span>
        ) : null}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 14 }}>Quantities are pre-sized from your projected week. Adjust before you commit.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {ORDER_ITEMS.map((item) => {
          const qty = orders[item.key] ?? seeded[item.key] ?? 0
          const sug = seeded[item.key] ?? 0
          const short = qty < sug
          return (
            <div key={item.key} style={{ padding: 14, borderRadius: 13, background: 'var(--card-2)', border: `1px solid ${short ? 'color-mix(in oklch,var(--warn) 32%,var(--line))' : 'var(--line)'}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 10 }}>{item.unit} · suggests {sug}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button className="tap" aria-label={`Less ${item.label}`} onClick={() => onOrder(item.key, qty - 1)} disabled={qty <= 0} style={stepBtn(qty <= 0)}>
                  <Icon name="close" size={12} stroke={2.4} />
                </button>
                <input
                  type="number"
                  min={0}
                  value={qty}
                  onChange={(e) => onOrder(item.key, Number(e.target.value))}
                  className="mono"
                  style={{ flex: 1, width: 0, minWidth: 0, padding: '7px 8px', borderRadius: 9, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 15, fontWeight: 800, textAlign: 'center', outline: 'none' }}
                />
                <button className="tap" aria-label={`More ${item.label}`} onClick={() => onOrder(item.key, qty + 1)} style={stepBtn(false)}>
                  <Icon name="plus" size={12} stroke={2.4} />
                </button>
              </div>
              {short ? <div className="mono" style={{ fontSize: 10, color: 'var(--warn)', marginTop: 6 }}>under suggested — shortfall risk</div> : null}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function stepBtn(disabled: boolean): CSSProperties {
  return {
    width: 26,
    height: 30,
    borderRadius: 9,
    display: 'grid',
    placeItems: 'center',
    flex: '0 0 auto',
    background: 'var(--card)',
    border: '1px solid var(--line)',
    color: 'var(--ink-2)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1
  }
}

/* ── LABOR — the signature interactive simulator ─────────────────────────── */

function LaborTab({ data, range, days, onConnect }: { data: SummitData; range: Range; days: number; onConnect: () => void }): JSX.Element {
  const { labor, sales } = data
  const sum = labor.summary
  const cmp = sum.comparison

  // The labor SIMULATOR trims staff-hours off the busiest scheduled hours of the
  // open day and recomputes labor cost + coverage live from the real board model.
  const board = useMemo<BoardModel | null>(() => buildBoard(sales, labor), [sales, labor])

  return (
    <div>
      <SpaceHead title="Labor" sub="Shifts and cost from your scheduler — where you’re lean and where you’re heavy." />

      {/* KPIs — cost ticks up */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
        <Kpi icon="people" label="Labor cost" value={<MoneyUp value={sum.total_labor_cost} />} sub={RANGE_LABEL[range]} delta={cmp.cost_pct != null ? (cmp.cost_pct >= 0 ? '+' : '') + cmp.cost_pct.toFixed(1) + '%' : null} />
        <Kpi
          icon="clock"
          label="Actual hours"
          value={<CountUp value={sum.total_actual_hours} format={(n) => Math.round(n).toLocaleString()} />}
          sub={`vs ${Math.round(sum.total_scheduled_hours).toLocaleString()} scheduled`}
          color={sum.total_actual_hours > sum.total_scheduled_hours ? 'var(--warn)' : GREEN}
        />
        <Kpi icon="alert" label="OT shifts" value={<CountUp value={sum.overtime_shifts} format={(n) => String(Math.round(n))} />} sub={sum.shift_count ? Math.round((sum.overtime_shifts / sum.shift_count) * 100) + '% of shifts' : '—'} color={sum.overtime_shifts > 0 ? 'var(--warn)' : GREEN} />
        <Kpi icon="receipt" label="Shifts" value={<CountUp value={sum.shift_count} format={(n) => String(Math.round(n))} />} sub="this period" />
      </div>

      {/* the signature simulator */}
      {board ? <LaborSimulator board={board} range={range} days={days} /> : <SimUnavailable onConnect={onConnect} />}

      {/* shift list */}
      <Card style={{ marginTop: 16 }}>
        <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Recent shifts</div>
        {labor.shifts.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 0' }}>No shifts imported for this period.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {labor.shifts.slice(0, 12).map((sh, i) => {
              const name = sh.employee_name?.trim() || 'Unknown'
              const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
              return (
                <div key={sh.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                  <span className="mono" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--card-2)', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, flex: '0 0 auto' }}>{initials}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{[sh.role, sh.department].filter(Boolean).join(' · ') || '—'}</div>
                  </div>
                  {sh.is_overtime ? <span className="mono" style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: 'var(--warn)', background: 'color-mix(in oklch,var(--warn) 15%,transparent)' }}>OT</span> : null}
                  <span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)', width: 54, textAlign: 'right' }}>{Math.round(sh.actual_hours * 10) / 10}h</span>
                  <span className="mono" style={{ fontSize: 13.5, fontWeight: 700, width: 70, textAlign: 'right' }}>{money(sh.labor_cost)}</span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function SimUnavailable({ onConnect }: { onConnect: () => void }): JSX.Element {
  return (
    <div style={{ borderRadius: 18, background: `linear-gradient(135deg, ${T.wash}, var(--card))`, border: `1px solid ${T.line}`, padding: 22, marginBottom: 16 }}>
      <PillTag label="LABOR SIMULATOR" />
      <div className="disp" style={{ fontSize: 19, fontWeight: 700, margin: '12px 0 6px' }}>Not enough data to model coverage yet</div>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, maxWidth: 520 }}>
        The simulator needs sales-by-hour and scheduled shifts for a day. Connect your POS and scheduler and it’ll let you trim hours and see the savings live.
      </p>
      <button className="tap" onClick={onConnect} style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderRadius: 12, background: 'var(--ink)', color: 'var(--bg)', fontWeight: 700, fontSize: 13 }}>
        Connect sources <Icon name="arrowR" size={15} stroke={2} />
      </button>
    </div>
  )
}

/**
 * The labor simulator. A slider trims up to N staff-hours off the busiest
 * scheduled hours of the open day; coverage + labor cost recompute LIVE from the
 * real board model (computeCoverage), and the projected weekly/annual savings
 * tick alongside. Over/understaffed hours are flagged from the day's own norm.
 */
function LaborSimulator({ board, range, days }: { board: BoardModel; range: Range; days: number }): JSX.Element {
  // hours that actually have scheduled staff, busiest-first (trim the fat first).
  const staffedHours = useMemo(() => board.hours.filter((h) => h.staff > 0).length, [board])
  const maxTrim = Math.max(0, Math.min(8, board.hours.reduce((a, h) => a + h.staff, 0) - staffedHours))
  const [trim, setTrim] = useState(0)

  // baseline vs. simulated arrangement: remove `trim` staff-hours from the hours
  // with the LOWEST sales-per-staff (the genuinely over-covered slots).
  const base = useMemo(() => computeCoverage(board.hours, board.avgRate), [board])
  const sim = useMemo(() => {
    if (trim <= 0) return base
    const order = [...board.hours]
      .map((h, idx) => ({ idx, ratio: h.staff > 0 ? h.sales / h.staff : Infinity }))
      .filter((x) => board.hours[x.idx].staff > 0)
      .sort((a, b) => a.ratio - b.ratio)
    const next = board.hours.map((h) => ({ ...h }))
    let left = trim
    for (const { idx } of order) {
      if (left <= 0) break
      const cut = Math.min(next[idx].staff, left)
      next[idx].staff -= cut
      left -= cut
    }
    return computeCoverage(next, board.avgRate)
  }, [trim, board, base])

  // scale a single day's labor saving to the selected window + a year.
  const dailySave = Math.max(0, base.laborCost - sim.laborCost)
  const periodSave = dailySave * days
  const annualSave = dailySave * 365
  const projLaborPct = sim.totalSales > 0 ? (sim.laborCost / sim.totalSales) * 100 : 0
  const baseLaborPct = base.totalSales > 0 ? (base.laborCost / base.totalSales) * 100 : 0

  return (
    <div style={{ borderRadius: 18, background: `linear-gradient(135deg, ${T.wash}, var(--card))`, border: `1px solid ${T.line}`, padding: 22, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <PillTag label="LABOR SIMULATOR" />
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Trim the over-covered hours — see the impact live</span>
      </div>
      <div className="disp" style={{ fontSize: 19, fontWeight: 700, margin: '12px 0 4px' }}>
        What if I trim staff on {dowName(board.date)}, {fmtDay(board.date)}?
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 8px' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>Staff-hours to trim</span>
        <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: GREEN }}>{trim}</span>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(1, maxTrim)}
        value={trim}
        disabled={maxTrim === 0}
        onChange={(e) => setTrim(Number(e.target.value))}
        style={{ width: '100%', accentColor: T.base }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 20 }}>
        <div style={{ padding: 18, borderRadius: 14, background: 'var(--card-2)', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>Projected labor %</div>
          <div className="mono disp" style={{ fontSize: 38, fontWeight: 800, color: trim > 0 ? GREEN : baseLaborPct > 30 ? 'var(--warn)' : GREEN }}>
            <CountUp value={projLaborPct} decimals={1} suffix="%" />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>{trim > 0 ? `down from ${baseLaborPct.toFixed(1)}%` : baseLaborPct > 30 ? 'running hot' : 'on the day'}</div>
        </div>
        <div style={{ padding: 18, borderRadius: 14, background: trim > 0 ? 'color-mix(in oklch,var(--pos) 12%,transparent)' : 'var(--card-2)', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>Est. savings · {RANGE_LABEL[range]}</div>
          <div className="mono disp" style={{ fontSize: 38, fontWeight: 800, color: trim > 0 ? 'var(--pos)' : 'var(--ink-3)' }}>
            <MoneyUp value={periodSave} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>{trim > 0 ? `≈ ${moneyK(annualSave)}/yr` : 'no change'}</div>
        </div>
      </div>

      {/* live coverage flags from the real board model */}
      <div style={{ display: 'flex', gap: 18, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <CoverageFlag tone="var(--warn)" label="Over-covered hours" before={base.wasted} after={sim.wasted} />
        <CoverageFlag tone="var(--neg)" label="Understaffed hours" before={base.lost} after={sim.lost} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {sim.lost > base.lost ? 'Careful — trimming further leaves peak hours short.' : trim > 0 ? 'Coverage holds — these hours were over-staffed.' : 'Drag to trim the slowest-selling staffed hours.'}
        </span>
      </div>
    </div>
  )
}

function CoverageFlag({ tone: col, label, before, after }: { tone: string; label: string; before: number; after: number }): JSX.Element {
  const changed = after !== before
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: col, flex: '0 0 auto' }} />
      <span style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{label}</span>
      <span className="mono" style={{ fontWeight: 700, color: changed ? col : 'var(--ink-2)' }}>
        {after}
        {changed ? <span style={{ color: 'var(--ink-3)', fontWeight: 500 }}> (was {before})</span> : null}
      </span>
    </div>
  )
}

/* ── FINANCES ────────────────────────────────────────────────────────────── */

function FinancesTab({ data, range }: { data: SummitData; range: Range }): JSX.Element {
  const { finances, transactions } = data
  const balance = finances.total_balance || transactions.current_balance || 0
  const deposits = finances.deposits || transactions.totals.income || 0
  const payouts = transactions.totals.expenses || 0
  const costs = [...finances.important_costs].sort((a, b) => b.total - a.total).slice(0, 6)
  const maxCost = Math.max(1, ...costs.map((c) => c.total))
  const recent = transactions.transactions.slice(0, 8)

  return (
    <div>
      <SpaceHead title="Finances" sub="Cash flow from your bank — balance, what cleared, and where the money goes." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 18 }}>
        <Kpi icon="wallet" label="Cash balance" value={<MoneyUp value={balance} />} sub="across accounts" />
        <Kpi icon="arrowDn" label="Deposits" value={<MoneyUp value={deposits} />} sub={RANGE_LABEL[range]} />
        <Kpi icon="card" label="Payouts" value={<MoneyUp value={payouts} />} sub={RANGE_LABEL[range]} color="var(--warn)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18, alignItems: 'start' }}>
        <Card>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Recent transactions</div>
          {recent.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 0' }}>No transactions imported yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recent.map((tx, i) => {
                const label = tx.merchant_name?.trim() || tx.description?.trim() || 'Transaction'
                return (
                  <div key={tx.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: tx.is_deposit ? 'color-mix(in oklch,var(--pos) 15%,transparent)' : 'var(--card-2)', color: tx.is_deposit ? 'var(--pos)' : 'var(--ink-2)', flex: '0 0 auto' }}>
                      <Icon name={tx.is_deposit ? 'arrowDn' : 'arrowUp'} size={16} stroke={2} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fmtDay(tx.date)}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: tx.is_deposit ? 'var(--pos)' : 'var(--ink)' }}>
                      {(tx.is_deposit ? '+' : '−') + money(Math.abs(tx.amount))}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Top costs</div>
          {costs.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 0' }}>No recurring costs flagged yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {costs.map((c, i) => (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span className="mono" style={{ fontWeight: 700 }}><MoneyUp value={c.total} /></span>
                  </div>
                  <div style={{ height: 7, borderRadius: 99, background: 'var(--card-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: (c.total / maxCost) * 100 + '%', background: 'var(--warn)', borderRadius: 99 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ── INTEGRATIONS + recommendations (apply → running savings tally) ───────── */

/** A connectable service in the catalogue. `key` is the backend service id used
 *  by /api/credentials + /api/sync; `connect` is the real flow we drive. */
interface ServiceDef {
  /** Display name. */
  service: string
  /** Backend service id (credential.service / sync route). null = no backend support yet. */
  key: SyncService | null
  /** Matches a ConnectedAccount/credential row to this service. */
  match: RegExp
  what: string
  icon: string
  /** How clicking "Connect" actually links it. */
  connect: 'homebase' | 'oracle' | 'plaid' | 'unsupported'
}

const KNOWN_SERVICES: ServiceDef[] = [
  { service: 'Homebase', key: 'homebase', match: /homebase|labor|schedul/i, what: 'Labor & scheduling', icon: 'people', connect: 'homebase' },
  { service: 'Oracle MICROS', key: 'oracle', match: /oracle|micros|simphony|pos/i, what: 'Sales & tenders', icon: 'receipt', connect: 'oracle' },
  { service: 'Plaid', key: 'plaid', match: /plaid|bank/i, what: 'Banking & cash flow', icon: 'wallet', connect: 'plaid' },
  { service: 'Square', key: null, match: /square|stripe|card/i, what: 'Card payments', icon: 'card', connect: 'unsupported' }
]

/** The live connection state for a catalogue tile, derived from credentials + accounts. */
interface TileState {
  def: ServiceDef
  connected: boolean
  lastSynced: string | null
}

function IntegrationsTab({ data, onChanged }: { data: SummitData; onChanged: () => void }): JSX.Element {
  const { accounts, credentials, recs } = data

  // A service is CONNECTED when it has an API credential (Homebase/Oracle) OR a
  // ConnectedAccount row (Plaid items / verified services). Credentials are the
  // source of truth even before the first sync imports any data.
  const tiles: TileState[] = KNOWN_SERVICES.map((def) => {
    const cred = credentials.find((c) => (def.key && c.service.toLowerCase() === def.key) || def.match.test(c.service))
    const acct = accounts.find((a) => def.match.test(a.service) || (a.institution_name ? def.match.test(a.institution_name) : false))
    const connected = !!cred || !!acct
    const lastSynced = cred?.last_synced ?? acct?.last_synced ?? null
    return { def, connected, lastSynced }
  })

  // Which service's connect modal is open (null = closed).
  const [connecting, setConnecting] = useState<ServiceDef | null>(null)

  // open recs (not yet implemented) + a running applied-savings tally.
  const open = recs.filter((r) => !r.is_implemented)
  const baseApplied = recs.filter((r) => r.is_implemented).reduce((a, r) => a + (r.actual_savings ?? r.monthly_savings), 0)
  const [appliedIds, setAppliedIds] = useState<Set<number>>(new Set())
  const sessionApplied = open.filter((r) => appliedIds.has(r.id)).reduce((a, r) => a + r.monthly_savings, 0)
  const totalApplied = baseApplied + sessionApplied

  const apply = (id: number): void =>
    setAppliedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })

  // A successful connect: drop the memoised GETs and re-pull the whole space so
  // the freshly-linked source lights up across every tab.
  const onConnected = useCallback(() => {
    setConnecting(null)
    clearSummitCache()
    onChanged()
  }, [onChanged])

  return (
    <div>
      <SpaceHead
        title="Integrations"
        sub="Your connected services and what JetCore recommends you fix."
        right={
          <div style={{ textAlign: 'right' }}>
            <div className="mono disp" style={{ fontSize: 22, fontWeight: 800, color: 'var(--pos)' }}>
              <MoneyUp value={totalApplied} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Savings applied /mo</div>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 26 }}>
        {tiles.map((t) => (
          <IntegrationTile key={t.def.service} tile={t} onConnect={() => setConnecting(t.def)} onSynced={onChanged} />
        ))}
      </div>

      {connecting ? <ConnectModal def={connecting} onClose={() => setConnecting(null)} onConnected={onConnected} /> : null}

      <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Recommendations</div>
      {open.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 16, borderRadius: 16, background: 'color-mix(in oklch,var(--pos) 9%,transparent)', color: 'var(--pos)', fontSize: 13.5, fontWeight: 600 }}>
          <Icon name="check" size={17} stroke={2} />
          You’re all caught up — no open recommendations right now.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {open.map((r) => {
            const applied = appliedIds.has(r.id)
            return (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 16, background: 'var(--card)', border: applied ? '1px solid color-mix(in oklch,var(--pos) 40%,var(--line))' : '1px solid var(--line)' }}>
                <span style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'color-mix(in oklch,var(--pos) 14%,transparent)', color: 'var(--pos)', flex: '0 0 auto' }}>
                  <Icon name="spark" size={19} stroke={2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{r.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 2, lineHeight: 1.45 }}>
                    {r.description ? r.description + ' ' : ''}
                    <b className="mono" style={{ color: 'var(--pos)' }}>{money(r.monthly_savings)}/mo</b>
                  </div>
                </div>
                {r.ai_confidence != null ? (
                  <span className="mono" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, background: 'var(--card-2)', color: 'var(--ink-3)' }}>{Math.round(r.ai_confidence)}% sure</span>
                ) : null}
                <button
                  className="tap"
                  onClick={() => apply(r.id)}
                  disabled={applied}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 11,
                    fontSize: 12.5,
                    fontWeight: 700,
                    border: 'none',
                    cursor: applied ? 'default' : 'pointer',
                    background: applied ? 'color-mix(in oklch,var(--pos) 16%,transparent)' : `linear-gradient(140deg,${T.bright},${T.deep})`,
                    color: applied ? 'var(--pos)' : T.ink
                  }}
                >
                  {applied ? <><Icon name="check" size={15} stroke={2} /> Applied</> : 'Apply'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── a single integration tile (connect / synced / re-sync) ──────────────── */

function IntegrationTile({ tile, onConnect, onSynced }: { tile: TileState; onConnect: () => void; onSynced: () => void }): JSX.Element {
  const { def, connected, lastSynced } = tile
  const [syncing, setSyncing] = useState(false)
  const [syncErr, setSyncErr] = useState<string | null>(null)

  // Re-sync a connected, syncable service: kick the backend job, poll progress,
  // then clear the cache + re-pull so fresh numbers land across the space.
  const sync = useCallback(async (): Promise<void> => {
    if (!def.key || syncing) return
    const service = def.key
    setSyncing(true)
    setSyncErr(null)
    try {
      await startSync(service, 30)
      // poll ~1.2s until the backend reports it's no longer running (capped).
      for (let i = 0; i < 500; i++) {
        await new Promise<void>((r) => setTimeout(r, 1200))
        let running = true
        try {
          const p = await getSyncProgress(service)
          running = p.status === 'running'
        } catch {
          break // progress endpoint quiet — assume finished
        }
        if (!running) break
      }
      clearSummitCache()
      onSynced()
    } catch (e) {
      setSyncErr(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [def.key, syncing, onSynced])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderRadius: 16, background: 'var(--card)', border: '1px solid var(--line)' }}>
      <span style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: connected ? 'color-mix(in oklch,var(--pos) 14%,transparent)' : 'var(--card-2)', color: connected ? 'var(--pos)' : 'var(--ink-3)', flex: '0 0 auto' }}>
        <Icon name={def.icon} size={20} stroke={2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{def.service}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{syncErr ?? def.what}</div>
      </div>
      {connected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--pos)' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--pos)' }} />
            {lastSynced ? (timeAgo(lastSynced) ?? 'connected') : 'connected'}
          </span>
          {def.key ? (
            <button
              className="tap"
              onClick={() => void sync()}
              disabled={syncing}
              title="Sync now"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--card-2)', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, cursor: syncing ? 'default' : 'pointer' }}
            >
              <Icon name="refresh" size={14} stroke={2} style={syncing ? { animation: 'jc-spin 0.7s linear infinite' } : undefined} />
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          ) : null}
        </div>
      ) : (
        <button
          className="tap"
          onClick={onConnect}
          style={{ padding: '8px 14px', borderRadius: 11, border: 'none', cursor: 'pointer', background: `linear-gradient(140deg,${T.bright},${T.deep})`, color: T.ink, fontSize: 12.5, fontWeight: 700 }}
        >
          Connect
        </button>
      )}
    </div>
  )
}

/* ── connect modal — the REAL credential flow per service ────────────────────
   Homebase / Oracle: POST /api/credentials/verify (verifies the live service AND
   persists the credential + ConnectedAccount). Plaid: needs its hosted Link UI,
   so we open the backend's /link page in the browser. Square: no backend support
   yet — we say so honestly instead of faking a connection. */

function ModalShell({ def, onClose, children }: { def: ServiceDef; onClose: () => void; children: ReactNode }): JSX.Element {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'oklch(0.1 0.02 60 / 0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}
    >
      <div
        className="pop"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(480px,92vw)', maxHeight: '80vh', overflowY: 'auto', background: 'var(--glass)', backdropFilter: 'blur(26px)', border: '1px solid var(--line-2)', borderRadius: 22, boxShadow: 'var(--shadow)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '20px 22px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', color: T.ink, background: `linear-gradient(140deg,${T.bright},${T.deep})`, flex: '0 0 auto' }}>
            <Icon name={def.icon} size={20} stroke={2} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="disp" style={{ fontSize: 18, fontWeight: 800 }}>Connect {def.service}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{def.what}</div>
          </div>
          <button className="tap" onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
            <Icon name="close" size={17} stroke={2} />
          </button>
        </div>
        <div style={{ padding: '20px 22px 24px' }}>{children}</div>
      </div>
    </div>
  )
}

function ConnectModal({ def, onClose, onConnected }: { def: ServiceDef; onClose: () => void; onConnected: () => void }): JSX.Element {
  return (
    <ModalShell def={def} onClose={onClose}>
      {def.connect === 'homebase' ? (
        <HomebaseForm onConnected={onConnected} />
      ) : def.connect === 'oracle' ? (
        <OracleForm onConnected={onConnected} />
      ) : def.connect === 'plaid' ? (
        <PlaidConnect />
      ) : (
        <UnsupportedConnect service={def.service} />
      )}
    </ModalShell>
  )
}

/* ── shared form primitives (redesign language) ─────────────────────────── */

const FIELD_STYLE: CSSProperties = {
  width: '100%',
  padding: '11px 13px',
  borderRadius: 11,
  background: 'var(--card)',
  border: '1px solid var(--line)',
  color: 'var(--ink)',
  fontSize: 14,
  outline: 'none'
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }): JSX.Element {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>{label}</div>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={FIELD_STYLE} />
    </label>
  )
}

function SubmitBtn({ busy, label }: { busy: boolean; label: string }): JSX.Element {
  return (
    <button
      type="submit"
      className="tap"
      disabled={busy}
      style={{ width: '100%', marginTop: 4, padding: '12px 16px', borderRadius: 13, border: 'none', cursor: busy ? 'default' : 'pointer', background: `linear-gradient(140deg,${T.bright},${T.deep})`, color: T.ink, fontWeight: 700, fontSize: 14.5, opacity: busy ? 0.7 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
    >
      {busy ? <Icon name="refresh" size={16} stroke={2} style={{ animation: 'jc-spin 0.7s linear infinite' }} /> : null}
      {busy ? 'Verifying…' : label}
    </button>
  )
}

function FormError({ message }: { message: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 11, background: 'color-mix(in oklch,var(--neg) 12%,transparent)', color: 'var(--neg)', fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>
      <Icon name="alert" size={15} stroke={2} />
      {message}
    </div>
  )
}

/* ── Homebase — single API-key field → verify + save ─────────────────────── */

function HomebaseForm({ onConnected }: { onConnected: () => void }): JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!key.trim()) {
      setErr('API key is required.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await verifyCredential('homebase', { api_key: key.trim() })
      if (res.success === false) {
        setErr(res.error || 'Verification failed — check the key and try again.')
        return
      }
      onConnected()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Verification failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 16 }}>
        Paste your Homebase API key. In Homebase, open <b>Settings → Integrations → API</b> and generate a key (it starts
        with <span className="mono">hb_live_…</span>). We verify it live, then sync your shifts.
      </p>
      {err ? <FormError message={err} /> : null}
      <Field label="API key" value={key} onChange={setKey} placeholder="hb_live_…" type="password" />
      <SubmitBtn busy={busy} label="Save & connect" />
    </form>
  )
}

/* ── Oracle MICROS / Simphony — OAuth or on-prem creds → verify + save ────── */

function OracleForm({ onConnected }: { onConnected: () => void }): JSX.Element {
  const [cloud, setCloud] = useState(true) // OAuth (Simphony Cloud) vs on-prem API key
  const [url, setUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [loc, setLoc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!url.trim() || !clientId.trim() || !secret.trim() || !loc.trim()) {
      setErr('All fields are required.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const res = await verifyCredential('oracle', {
        environment_url: url.trim(),
        client_id: clientId.trim(),
        client_secret: secret.trim(),
        location_ref: loc.trim(),
        auth_type: cloud ? 'oauth' : 'api_key'
      })
      if (res.success === false) {
        setErr(res.error || 'Verification failed — check your credentials and try again.')
        return
      }
      onConnected()
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Verification failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 16 }}>
        Connect Oracle Simphony Cloud (OAuth) or MICROS on-premise (API key). Find these in your Oracle Cloud Console /
        Simphony back-office. We verify them live before saving.
      </p>
      {err ? <FormError message={err} /> : null}

      {/* system type toggle */}
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: 'var(--card-2)', marginBottom: 16 }}>
        {[
          [true, 'Simphony Cloud (OAuth)'],
          [false, 'MICROS on-premise']
        ].map(([v, label]) => {
          const on = cloud === v
          return (
            <button
              key={String(v)}
              type="button"
              className="tap"
              onClick={() => setCloud(v as boolean)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: on ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'transparent', color: on ? T.ink : 'var(--ink-3)' }}
            >
              {label as string}
            </button>
          )
        })}
      </div>

      <Field label="Environment URL" value={url} onChange={setUrl} placeholder={cloud ? 'https://your-org.simphony.us.oracleindustry.com' : 'https://your-micros-server:9300'} />
      <Field label={cloud ? 'Client ID' : 'Username / Client ID'} value={clientId} onChange={setClientId} placeholder="your-client-id" />
      <Field label={cloud ? 'Client secret' : 'API key / password'} value={secret} onChange={setSecret} type="password" />
      <Field label="Location / Revenue Center GUID" value={loc} onChange={setLoc} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
      <SubmitBtn busy={busy} label="Save & connect" />
    </form>
  )
}

/* ── Plaid — needs Plaid's hosted Link; open the backend /link page ───────── */

function PlaidConnect(): JSX.Element {
  return (
    <div>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55, marginBottom: 14 }}>
        Bank connections go through <b>Plaid Link</b> — a secure popup where you authorize your bank directly. JetCore
        never sees your banking password. Plaid supports 12,000+ US institutions.
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '12px 14px', borderRadius: 12, background: T.soft, color: 'var(--ink-2)', fontSize: 12.5, lineHeight: 1.5, marginBottom: 16 }}>
        <span style={{ color: GREEN, flex: '0 0 auto', marginTop: 1 }}><Icon name="shield" size={15} stroke={2} /></span>
        Once your bank is authorized, it appears here automatically — then hit <b>Sync</b> on the Plaid tile to pull
        balances and transactions.
      </div>
      <button
        className="tap"
        onClick={() => window.open('https://plaid.com/link/', '_blank', 'noopener,noreferrer')}
        style={{ width: '100%', padding: '12px 16px', borderRadius: 13, border: 'none', cursor: 'pointer', background: `linear-gradient(140deg,${T.bright},${T.deep})`, color: T.ink, fontWeight: 700, fontSize: 14.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        Connect a bank with Plaid
        <Icon name="external" size={16} stroke={2} />
      </button>
      <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 10, textAlign: 'center' }}>Powered by Plaid · bank-level encryption</p>
    </div>
  )
}

/* ── Square — no backend support yet; be honest, don't fake it ───────────── */

function UnsupportedConnect({ service }: { service: string }): JSX.Element {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '14px 16px', borderRadius: 12, background: 'color-mix(in oklch,var(--warn) 10%,transparent)', color: 'var(--ink-2)', fontSize: 13, lineHeight: 1.55 }}>
        <span style={{ color: 'var(--warn)', flex: '0 0 auto', marginTop: 1 }}><Icon name="info" size={16} stroke={2} /></span>
        <span>
          {service} isn’t wired into Summit’s backend yet — there’s no live connect endpoint for it, so we won’t pretend
          there is. For card payments today, connect your <b>POS (Oracle MICROS)</b> for tenders or your <b>bank (Plaid)</b>
          {' '}for deposits. {service} support is on the roadmap.
        </span>
      </div>
    </div>
  )
}
