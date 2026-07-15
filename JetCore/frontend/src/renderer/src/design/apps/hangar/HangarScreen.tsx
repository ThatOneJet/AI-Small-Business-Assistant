/* ============================================================
   JetCore — Hangar (the hub), ported from the Claude Design
   prototype (design/jetcore/project/src/hangar.jsx) onto REAL
   data: cloud account, vault intent, DevBay/Pylon providers and
   the Summit Flask backend. Every source loads independently
   (Skeletons while pending, nudges when not connected) so a slow
   backend never blocks the rest of the screen.

   HERO — the cross-app RADAR. The "Your apps" grid stays as the
   ground-truth status, but the signature surface is a spatial map:
   each active app orbits a center "core", and the SINGLE most
   important actionable item from each app springs an alert pip on
   its node. The user catches what needs them AT A GLANCE and acts
   on it (snooze / dismiss / jump) without entering each app.
   ============================================================ */
import { useEffect, useMemo, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import { Badge, Button, Card, SectionTitle, Skeleton } from '../../ui'
import { AnimatedList, BlurText, CountUp, Reveal, SpotlightCard, REDUCED } from '../../motion'
import { Icon } from '../../icons'
import { Sparkline } from '../../charts'
import type { JCAppId, JCScreenProps } from '../../contract'
import type { DevBayData, PylonData } from '@shared/ipc'

/* ---------------- static app metadata (mirrors the prototype's APPS) ---------------- */

// Borderless is a control/settings app with no live status card, so it's excluded
// from the Hangar "Your apps" status grid (it still appears on the rail + launcher).
type HubAppId = Exclude<JCAppId, 'hangar' | 'borderless' | 'forge'>

interface HubApp {
  id: HubAppId
  name: string
  glyph: string
  tagline: string
}

const HUB_APPS: HubApp[] = [
  { id: 'devbay', name: 'DevBay', glyph: 'devbay', tagline: 'Ship with confidence' },
  { id: 'summit', name: 'Summit', glyph: 'summit', tagline: 'Run the numbers' },
  { id: 'pylon', name: 'Pylon', glyph: 'pylon', tagline: 'Know where you stand' }
]

/** Inside-card nudge shown when an app's provider isn't connected yet. */
const CARD_NUDGE: Record<HubAppId, { icon: string; title: string; body: string }> = {
  devbay: { icon: 'github', title: 'Connect GitHub', body: 'Link a token to make scattered repos legible — stars, issues, staleness.' },
  summit: { icon: 'link', title: 'No integrations yet', body: 'Connect Homebase, your POS, or Plaid to light up your numbers.' },
  pylon: { icon: 'cap', title: 'Add your Canvas token', body: 'Decode the grades, weights and due dates Canvas buries.' }
}

/** First-run setup nudge cards under the grid (featured, not-connected apps). */
const SETUP_NUDGE: Record<HubAppId, { icon: string; title: string; body: string }> = {
  devbay: {
    icon: 'github',
    title: 'Finish setting up DevBay',
    body: "GitHub isn't linked yet — connect it to make scattered repos legible and ship in two steps."
  },
  summit: {
    icon: 'card',
    title: 'Finish connecting Summit',
    body: "Nothing is linked yet — connect Homebase, your POS, or Plaid to see what's trending wrong."
  },
  pylon: {
    icon: 'cap',
    title: 'Finish setting up Pylon',
    body: "Canvas isn't linked yet — add your token to decode grades and rank due dates by urgency."
  }
}

/** Summit credential services → display label + icon (matches the prototype's integration tiles). */
const SERVICE_META: Record<string, { label: string; icon: string }> = {
  homebase: { label: 'Homebase', icon: 'people' },
  oracle: { label: 'Oracle MICROS', icon: 'receipt' },
  plaid: { label: 'Plaid', icon: 'wallet' },
  square: { label: 'Square', icon: 'card' }
}
const SUMMIT_CORE_SERVICES = ['homebase', 'oracle', 'plaid'] as const

function serviceMeta(service: string): { label: string; icon: string } {
  const known = SERVICE_META[service.toLowerCase()]
  if (known) return known
  return { label: service.charAt(0).toUpperCase() + service.slice(1), icon: 'link' }
}

/* ---------------- helpers ---------------- */

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** "adityasrijeet12355@gmail.com" → "Adityasrijeet". */
function nameFromEmail(email: string): string {
  const raw = email.split('@')[0] ?? ''
  const seg = raw.split(/[._\-+]/)[0] ?? raw
  const letters = seg.replace(/\d+$/g, '')
  const base = letters || seg
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : ''
}

function daysSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000))
}

/** Hours until an ISO due date (negative = overdue). */
function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3600000
}

function dueLabel(iso: string): string {
  const h = hoursUntil(iso)
  if (h <= 0) return 'now'
  if (h < 1) return '<1h'
  if (h < 48) return `${Math.round(h)}h`
  return `${Math.round(h / 24)}d`
}

/** The prototype derived each repo's "commits" spark from push recency — same proxy here. */
function activityScore(pushedAt: string): number {
  const days = Math.min(daysSince(pushedAt), 100)
  return Math.round(40 + (1 - days / 100) * 280)
}

/* ---------------- data slices (each card loads independently) ---------------- */

type Slice<T> =
  | { phase: 'loading' }
  | { phase: 'nudge' } // provider not connected → setup nudge
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: T }

interface SummitCredential {
  id: number
  service: string
  last_synced: string | null
  created_at: string
}

function parseCredentials(data: unknown): SummitCredential[] {
  if (!Array.isArray(data)) return []
  const out: SummitCredential[] = []
  for (const item of data) {
    if (item && typeof item === 'object' && typeof (item as { service?: unknown }).service === 'string') {
      const o = item as { id?: unknown; service: string; last_synced?: unknown; created_at?: unknown }
      out.push({
        id: typeof o.id === 'number' ? o.id : 0,
        service: o.service,
        last_synced: typeof o.last_synced === 'string' ? o.last_synced : null,
        created_at: typeof o.created_at === 'string' ? o.created_at : ''
      })
    }
  }
  return out
}

/** Minimal shape of Summit's GET /api/profit/:uid summary — labor_pct drives the
 *  leak signal. We DON'T import from the Summit app folder (it's being rebuilt in
 *  parallel); we read the already-synced numbers off the same bridge the rest of
 *  Hangar uses, then defensively parse only what we need. */
interface SummitProfit {
  laborPct: number | null
  revenue: number | null
}

function parseProfit(data: unknown): SummitProfit {
  const empty: SummitProfit = { laborPct: null, revenue: null }
  if (!data || typeof data !== 'object') return empty
  const summary = (data as { summary?: unknown }).summary
  if (!summary || typeof summary !== 'object') return empty
  const s = summary as { labor_pct?: unknown; total_revenue?: unknown }
  return {
    laborPct: typeof s.labor_pct === 'number' && isFinite(s.labor_pct) ? s.labor_pct : null,
    revenue: typeof s.total_revenue === 'number' && isFinite(s.total_revenue) ? s.total_revenue : null
  }
}

/** Healthy restaurant labor runs ~25–30% of revenue; >32% is a real, actionable
 *  leak worth surfacing on the radar. (Threshold is conservative on purpose.) */
const LABOR_LEAK_PCT = 32

/* ---------------- per-card view-model (mirrors the prototype's appStatus()) ---------------- */

type BadgeTone = 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'

interface CardAlert {
  icon: string
  text: string
  tone: 'warn' | 'neg' | 'neutral'
}

interface CardStat {
  metric: number
  unit: string
  note: string
  noteTone: BadgeTone
  spark?: number[]
  chips?: { icon: string; label: string }[]
  alert?: CardAlert
}

function devbayStat(d: DevBayData): CardStat {
  const stale = d.repos.filter((r) => daysSince(r.pushedAt) > 60)
  const stalest = stale.reduce<{ name: string; days: number } | null>((acc, r) => {
    const days = daysSince(r.pushedAt)
    return !acc || days > acc.days ? { name: r.name, days } : acc
  }, null)
  return {
    metric: d.repos.length,
    unit: d.repos.length === 1 ? 'repo' : 'repos',
    note: `${stale.length} need attention`,
    noteTone: stale.length ? 'warn' : 'pos',
    spark: d.repos.slice(0, 8).map((r) => activityScore(r.pushedAt)),
    alert: stalest ? { icon: 'alert', text: `${stalest.name} quiet for ${stalest.days} days`, tone: 'warn' } : undefined
  }
}

function pylonStat(d: PylonData): CardStat {
  const upcoming = d.upcoming.filter((u) => u.dueAt && !u.submitted)
  const dueSoon = upcoming.filter((u) => hoursUntil(u.dueAt as string) <= 48).length
  const next = upcoming
    .slice()
    .sort((a, b) => new Date(a.dueAt as string).getTime() - new Date(b.dueAt as string).getTime())[0]
  const scores = d.courses.map((c) => c.score).filter((s): s is number => s !== null)
  return {
    metric: d.courses.length,
    unit: d.courses.length === 1 ? 'course' : 'courses',
    note: `${dueSoon} due within 48h`,
    noteTone: dueSoon ? 'neg' : 'pos',
    spark: scores.length > 1 ? scores : undefined,
    alert: next
      ? {
          icon: 'clock',
          text: `Next: ${next.title} · due in ${dueLabel(next.dueAt as string)}`,
          tone: hoursUntil(next.dueAt as string) <= 48 ? 'neg' : 'neutral'
        }
      : undefined
  }
}

function summitStat(creds: SummitCredential[]): CardStat {
  const linked = new Set(creds.map((c) => c.service.toLowerCase()))
  const missing = SUMMIT_CORE_SERVICES.find((s) => !linked.has(s))
  return {
    metric: creds.length,
    unit: creds.length === 1 ? 'integration' : 'integrations',
    note: `${creds.length} connected`,
    noteTone: 'pos',
    chips: creds.slice(0, 4).map((c) => serviceMeta(c.service)),
    alert: missing ? { icon: 'link', text: `${serviceMeta(missing).label} isn't linked yet`, tone: 'warn' } : undefined
  }
}

/* ============================================================
   RADAR ALERT MODEL — each app contributes AT MOST ONE alert:
   its single most important actionable item, derived from real
   synced data. Severity orders the radar (the worst pip pulses).
   ============================================================ */

type AlertSeverity = 'critical' | 'warn' | 'info'

interface RadarAlert {
  /** Stable id so dismiss/snooze persist across reloads for the SAME problem. */
  id: string
  app: HubAppId
  severity: AlertSeverity
  icon: string
  /** Short headline (the pip's reason). */
  title: string
  /** One line of context. */
  detail: string
  /** Compact time/age chip (e.g. "6h", "74d"). */
  chip?: string
  /** Where a one-click JUMP lands. */
  jumpApp: HubAppId
  jumpTab?: string
  /** Verb shown on the jump button. */
  jumpLabel: string
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warn: 1, info: 2 }

/** Pylon → the nearest unsubmitted assignment with a due date. */
function pylonAlert(d: PylonData): RadarAlert | null {
  const next = d.upcoming
    .filter((u) => u.dueAt && !u.submitted)
    .sort((a, b) => new Date(a.dueAt as string).getTime() - new Date(b.dueAt as string).getTime())[0]
  if (!next || !next.dueAt) return null
  const h = hoursUntil(next.dueAt)
  // Only actionable if it's in the next two weeks or already overdue (within 24h grace).
  if (h > 24 * 14 || h < -24) return null
  const overdue = h <= 0
  return {
    id: `pylon:due:${next.id}`,
    app: 'pylon',
    severity: overdue ? 'critical' : h <= 48 ? 'warn' : 'info',
    icon: 'clock',
    title: overdue ? `Overdue: ${next.title}` : `${next.title} due in ${dueLabel(next.dueAt)}`,
    detail: next.courseName,
    chip: dueLabel(next.dueAt),
    jumpApp: 'pylon',
    jumpTab: 'grades',
    jumpLabel: 'Open Pylon'
  }
}

/** DevBay → the single stalest repo (the one most likely forgotten). */
function devbayAlert(d: DevBayData): RadarAlert | null {
  const stalest = d.repos
    .filter((r) => daysSince(r.pushedAt) > 60)
    .reduce<DevBayData['repos'][number] | null>((acc, r) => (!acc || daysSince(r.pushedAt) > daysSince(acc.pushedAt) ? r : acc), null)
  if (!stalest) return null
  const days = daysSince(stalest.pushedAt)
  return {
    id: `devbay:stale:${stalest.fullName}`,
    app: 'devbay',
    severity: days > 180 ? 'warn' : 'info',
    icon: 'alert',
    title: `${stalest.name} going stale`,
    detail: `${days} days since the last push.`,
    chip: `${days}d`,
    jumpApp: 'devbay',
    jumpLabel: 'Open DevBay'
  }
}

/** Summit → a labor-cost leak (labor running hot as a share of revenue). */
function summitAlert(p: SummitProfit): RadarAlert | null {
  if (p.laborPct === null || p.laborPct < LABOR_LEAK_PCT) return null
  const pct = Math.round(p.laborPct)
  return {
    id: 'summit:labor-leak',
    app: 'summit',
    severity: pct >= 40 ? 'critical' : 'warn',
    icon: 'people',
    title: `Labor at ${pct}% of revenue`,
    detail: 'Running hot — trim a shift or two.',
    chip: `${pct}%`,
    jumpApp: 'summit',
    jumpTab: 'labor',
    jumpLabel: 'Open Labor'
  }
}

/* ---------------- snooze / dismiss persistence (vault) ---------------- */

const VAULT_KEY = 'hangar.alerts'
/** Snooze duration when the user defers an alert. */
const SNOOZE_MS = 24 * 3600 * 1000

interface AlertState {
  /** Permanently dismissed alert ids (until the same problem recurs with a new id). */
  dismissed: string[]
  /** alert id → epoch ms the snooze expires. */
  snoozed: Record<string, number>
}

const EMPTY_STATE: AlertState = { dismissed: [], snoozed: {} }

function parseAlertState(raw: string | null): AlertState {
  if (!raw) return EMPTY_STATE
  try {
    const o = JSON.parse(raw) as Partial<AlertState>
    return {
      dismissed: Array.isArray(o.dismissed) ? o.dismissed.filter((x): x is string => typeof x === 'string') : [],
      snoozed:
        o.snoozed && typeof o.snoozed === 'object'
          ? Object.fromEntries(
              Object.entries(o.snoozed).filter(([, v]) => typeof v === 'number') as [string, number][]
            )
          : {}
    }
  } catch {
    return EMPTY_STATE
  }
}

/** Drop snoozes that have already expired (so state doesn't grow unbounded). */
function pruneState(s: AlertState): AlertState {
  const now = Date.now()
  const snoozed: Record<string, number> = {}
  for (const [id, until] of Object.entries(s.snoozed)) if (until > now) snoozed[id] = until
  return { dismissed: s.dismissed, snoozed }
}


/* ---------------- card body states ---------------- */

function LoadingBody(): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <Skeleton w={86} h={30} />
        <Skeleton w={132} h={20} r={99} style={{ marginTop: 10 }} />
      </div>
      <Skeleton w={104} h={40} />
    </div>
  )
}

function ErrorBody({ message }: { message: string }): JSX.Element {
  return (
    <div
      title={message}
      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--warn)', fontWeight: 600, minHeight: 40 }}
    >
      <Icon name="alert" size={15} />
      Couldn&rsquo;t load live status — open to retry
    </div>
  )
}

function NudgeBody({ app, go }: { app: HubAppId; go: JCScreenProps['go'] }): JSX.Element {
  const n = CARD_NUDGE[app]
  // Title/body get the full card width (the Connect button sits on its own line),
  // so short cards don't squish "No integrations yet" into three wrapped lines.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 'var(--r-sm)',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--accent-soft)',
            color: 'var(--accent-h)',
            flex: '0 0 auto'
          }}
        >
          <Icon name={n.icon} size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{n.title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.45 }}>{n.body}</div>
        </div>
      </div>
      <Button
        variant="soft"
        size="sm"
        iconRight="arrowR"
        onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
          e.stopPropagation()
          go(app)
        }}
        style={{ alignSelf: 'flex-start' }}
      >
        Connect
      </Button>
    </div>
  )
}

function StatBody({ stat }: { stat: CardStat }): JSX.Element {
  const alertColor =
    stat.alert?.tone === 'neg' ? 'var(--neg)' : stat.alert?.tone === 'neutral' ? 'var(--text-2)' : 'var(--warn)'
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }} className="mono">
              <CountUp value={stat.metric} />
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--text-3)', fontWeight: 600 }}>{stat.unit}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <Badge tone={stat.noteTone} dot>
              {stat.note}
            </Badge>
          </div>
        </div>
        {stat.spark && stat.spark.length > 1 ? (
          <Sparkline data={stat.spark} width={104} height={40} color="var(--accent)" />
        ) : stat.chips && stat.chips.length ? (
          <div style={{ display: 'flex', gap: 6 }}>
            {stat.chips.map((c) => (
              <div
                key={c.label}
                title={c.label}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 'var(--r-xs)',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--accent-soft)',
                  color: 'var(--accent-h)'
                }}
              >
                <Icon name={c.icon} size={15} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {stat.alert && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
            color: alertColor,
            fontWeight: 600
          }}
        >
          <Icon name={stat.alert.icon} size={15} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat.alert.text}</span>
        </div>
      )}
    </>
  )
}

/* ============================================================
   THE RADAR — apps orbit a center core; each app's worst live
   alert springs a pulsing pip on its node. The visual IS the
   tool: hover a node to read its alert, click to focus it below.
   ============================================================ */

const SEV_COLOR: Record<AlertSeverity, string> = {
  critical: 'var(--neg)',
  warn: 'var(--warn)',
  info: 'var(--accent-h)'
}

interface RadarNode {
  app: HubApp
  alert: RadarAlert | null
  connected: boolean
  loading: boolean
}

function Radar({
  nodes,
  topId,
  selectedApp,
  onSelect,
  totalAlerts
}: {
  nodes: RadarNode[]
  topId: string | null
  selectedApp: HubAppId | null
  onSelect: (app: HubAppId) => void
  totalAlerts: number
}): JSX.Element {
  const size = 236
  const cx = size / 2
  const cy = size / 2
  const orbit = 88
  const n = nodes.length
  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <svg width={size} height={size} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
        {/* concentric rings */}
        {[0.42, 0.72, 1].map((f, i) => (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={orbit * f}
            fill="none"
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray={i === 2 ? undefined : '3 6'}
          />
        ))}
        {/* spokes from the core to each node */}
        {nodes.map((node, i) => {
          const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n
          const x = cx + Math.cos(ang) * orbit
          const y = cy + Math.sin(ang) * orbit
          const active = !!node.alert
          return (
            <line
              key={node.app.id}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={active ? SEV_COLOR[node.alert!.severity] : 'var(--border)'}
              strokeWidth={active ? 1.6 : 1}
              strokeOpacity={active ? 0.5 : 0.6}
            />
          )
        })}
        {/* slow sweep line (pure decoration — paused under reduced-motion) */}
        {!REDUCED && (
          <line x1={cx} y1={cy} x2={cx} y2={cy - orbit} stroke="var(--accent)" strokeWidth="1.5" strokeOpacity="0.45">
            <animateTransform attributeName="transform" type="rotate" from={`0 ${cx} ${cy}`} to={`360 ${cx} ${cy}`} dur="9s" repeatCount="indefinite" />
          </line>
        )}
      </svg>

      {/* center CORE */}
      <button
        className="tap"
        onClick={() => onSelect('devbay')}
        title="Cross-app radar"
        style={{
          position: 'absolute',
          left: cx,
          top: cy,
          transform: 'translate(-50%, -50%)',
          width: 70,
          height: 70,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          cursor: 'default',
          background: 'radial-gradient(circle at 50% 38%, var(--accent-soft), var(--surface))',
          border: '1px solid var(--border-2)',
          boxShadow: '0 8px 30px -12px var(--accent-glow)'
        }}
      >
        <div style={{ textAlign: 'center', lineHeight: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: totalAlerts ? 'var(--text)' : 'var(--pos)' }} className="mono">
            {totalAlerts || <Icon name="check" size={22} style={{ color: 'var(--pos)' }} />}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 2, fontWeight: 600, letterSpacing: '0.04em' }}>
            {totalAlerts ? (totalAlerts === 1 ? 'ALERT' : 'ALERTS') : 'CLEAR'}
          </div>
        </div>
      </button>

      {/* app NODES around the orbit */}
      {nodes.map((node, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n
        const x = cx + Math.cos(ang) * orbit
        const y = cy + Math.sin(ang) * orbit
        const a = node.alert
        const isTop = !!a && a.id === topId
        const selected = selectedApp === node.app.id
        return (
          <button
            key={node.app.id}
            data-app={node.app.id}
            className="tap"
            onClick={() => onSelect(node.app.id)}
            title={a ? `${node.app.name}: ${a.title}` : node.app.name}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              transform: 'translate(-50%, -50%)',
              width: 58,
              height: 58,
              borderRadius: 'var(--r-md)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              background: a ? 'var(--surface)' : 'var(--surface-2)',
              border: `1.5px solid ${selected ? 'var(--accent)' : a ? SEV_COLOR[a.severity] : 'var(--border)'}`,
              color: a ? SEV_COLOR[a.severity] : node.connected ? 'var(--text-2)' : 'var(--text-3)',
              opacity: node.connected || node.loading ? 1 : 0.55,
              boxShadow: selected ? '0 8px 22px -10px var(--accent-glow)' : '0 6px 16px -12px hsl(var(--shadow-c) / .5)',
              transition: 'border-color .2s, box-shadow .2s, transform .2s'
            }}
          >
            <Icon name={node.app.glyph} size={24} />
            {/* alert PIP */}
            {a && (
              <span
                style={
                  {
                    position: 'absolute',
                    top: -5,
                    right: -5,
                    width: isTop ? 16 : 13,
                    height: isTop ? 16 : 13,
                    borderRadius: 99,
                    background: SEV_COLOR[a.severity],
                    border: '2px solid var(--surface)',
                    ['--pulse-c' as string]: SEV_COLOR[a.severity],
                    animation: REDUCED || !isTop ? 'none' : 'jc-pulse 1.8s var(--ease-out) infinite'
                  } as CSSProperties
                }
              />
            )}
            {node.loading && (
              <span
                style={{
                  position: 'absolute',
                  bottom: -4,
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: 'var(--text-3)',
                  opacity: 0.7
                }}
              />
            )}
          </button>
        )
      })}

      {/* keyframes for the top-pip pulse (scoped, design-system var-driven) */}
      <style>{`
        @keyframes jc-pulse {
          0% { box-shadow: 0 0 0 0 var(--pulse-c, currentColor); }
          70% { box-shadow: 0 0 0 9px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>
    </div>
  )
}

/* ---------------- an actionable alert row (snooze / dismiss / jump) ---------------- */

function AlertRow({
  alert,
  highlight,
  onJump,
  onSnooze,
  onDismiss
}: {
  alert: RadarAlert
  highlight: boolean
  onJump: (a: RadarAlert) => void
  onSnooze: (a: RadarAlert) => void
  onDismiss: (a: RadarAlert) => void
}): JSX.Element {
  const color = SEV_COLOR[alert.severity]
  const tint =
    alert.severity === 'critical'
      ? 'color-mix(in oklch, var(--neg) 16%, transparent)'
      : alert.severity === 'warn'
        ? 'color-mix(in oklch, var(--warn) 16%, transparent)'
        : 'var(--accent-soft)'
  return (
    <div
      data-app={alert.app}
      style={{
        display: 'flex',
        gap: 12,
        padding: '13px 12px',
        borderRadius: 'var(--r-md)',
        border: highlight ? `1px solid ${color}` : '1px solid transparent',
        background: highlight ? 'var(--surface-2)' : 'transparent',
        transition: 'background .2s, border-color .2s'
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 'var(--r-sm)',
          display: 'grid',
          placeItems: 'center',
          flex: '0 0 auto',
          background: tint,
          color
        }}
      >
        <Icon name={alert.icon} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
              minWidth: 0
            }}
          >
            {alert.title}
          </span>
          {alert.chip && (
            <span style={{ fontSize: 11.5, color, flex: '0 0 auto', fontWeight: 700 }} className="mono">
              {alert.chip}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.45, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {alert.detail}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <Button variant="soft" size="sm" iconRight="arrowR" onClick={() => onJump(alert)}>
            {alert.jumpLabel}
          </Button>
          <Button variant="ghost" size="sm" icon="clock" onClick={() => onSnooze(alert)} title="Snooze for a day">
            Snooze
          </Button>
          <button
            className="tap jc-iconbtn"
            aria-label="Dismiss alert"
            title="Dismiss"
            onClick={() => onDismiss(alert)}
            style={{ width: 30, height: 30, marginLeft: 'auto', color: 'var(--text-3)' }}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- the screen ---------------- */

export function HangarScreen(props: JCScreenProps): JSX.Element {
  const { go } = props
  const [user, setUser] = useState<{ email: string | null; unlocked: boolean; loaded: boolean }>({
    email: null,
    unlocked: false,
    loaded: false
  })
  const [intent, setIntent] = useState<Set<string> | null>(null)
  const [devbay, setDevbay] = useState<Slice<DevBayData>>({ phase: 'loading' })
  const [summit, setSummit] = useState<Slice<SummitCredential[]>>({ phase: 'loading' })
  const [pylon, setPylon] = useState<Slice<PylonData>>({ phase: 'loading' })
  /** Summit profit (labor leak signal) — only meaningful once integrations exist. */
  const [profit, setProfit] = useState<SummitProfit | null>(null)

  /** Persisted dismiss/snooze state (vault). null = still loading. */
  const [alertState, setAlertState] = useState<AlertState | null>(null)
  /** Which app the user is focusing on the radar (drives the alert list highlight). */
  const [selectedApp, setSelectedApp] = useState<HubAppId | null>(null)

  /* signed-in account (greeting + vault status) */
  useEffect(() => {
    let alive = true
    window.decks?.cloud
      .status()
      .then((st) => {
        if (alive) setUser({ email: st.email ?? null, unlocked: st.unlocked, loaded: true })
      })
      .catch(() => {
        if (alive) setUser({ email: null, unlocked: false, loaded: true })
      })
    return () => {
      alive = false
    }
  }, [])

  /* signup intent → featured apps */
  useEffect(() => {
    let alive = true
    window.decks?.vault
      .get('jetcore.intent')
      .then((raw) => {
        if (!alive || !raw) return
        try {
          const apps = (JSON.parse(raw) as { apps?: string[] }).apps ?? []
          setIntent(new Set(apps))
        } catch {
          /* malformed intent — ignore */
        }
      })
      .catch(() => {
        /* vault locked / unavailable — no featured apps */
      })
    return () => {
      alive = false
    }
  }, [])

  /* persisted alert (dismiss/snooze) state */
  useEffect(() => {
    let alive = true
    window.decks?.vault
      .get(VAULT_KEY)
      .then((raw) => {
        if (alive) setAlertState(pruneState(parseAlertState(raw)))
      })
      .catch(() => {
        if (alive) setAlertState(EMPTY_STATE)
      })
    return () => {
      alive = false
    }
  }, [])

  /* DevBay: status → fetch (repo count + stalest repo) */
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const st = await window.decks.devbay.status()
        if (!alive) return
        if (!st.connected) {
          setDevbay({ phase: 'nudge' })
          return
        }
        const data = await window.decks.devbay.fetch()
        if (!alive) return
        if (!data.connected) setDevbay({ phase: 'nudge' })
        else setDevbay({ phase: 'ready', data })
      } catch (e) {
        if (alive) setDevbay({ phase: 'error', message: e instanceof Error ? e.message : 'Failed to load' })
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  /* Pylon: status → fetch (courses + next due) */
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const st = await window.decks.pylon.status()
        if (!alive) return
        if (!st.connected) {
          setPylon({ phase: 'nudge' })
          return
        }
        const data = await window.decks.pylon.fetch()
        if (!alive) return
        if (!data.connected) setPylon({ phase: 'nudge' })
        else setPylon({ phase: 'ready', data })
      } catch (e) {
        if (alive) setPylon({ phase: 'error', message: e instanceof Error ? e.message : 'Failed to load' })
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  /* Summit: connected integrations via the Flask backend (cold-starts — never block on it) */
  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const res = await window.decks.summit.api({ path: '/api/credentials/:uid' })
        if (!alive) return
        if (!res.ok) {
          setSummit({ phase: 'error', message: res.error ?? `Backend error (${res.status})` })
          return
        }
        const creds = parseCredentials(res.data)
        if (creds.length === 0) setSummit({ phase: 'nudge' })
        else setSummit({ phase: 'ready', data: creds })
      } catch (e) {
        if (alive) setSummit({ phase: 'error', message: e instanceof Error ? e.message : 'Failed to load' })
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  /* Summit profit → labor leak signal. Only once integrations are confirmed, so we
     never hammer the cold-starting backend on a fresh/empty account. */
  useEffect(() => {
    if (summit.phase !== 'ready') return
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const res = await window.decks.summit.api({ path: '/api/profit/:uid?days=30' })
        if (!alive || !res.ok) return
        setProfit(parseProfit(res.data))
      } catch {
        /* leave profit null → simply no Summit leak alert (honest empty state) */
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [summit.phase])

  /* derived: featured-first ordering, feed, nudges, header badge */
  const ordered = useMemo(() => {
    const arr = [...HUB_APPS]
    if (intent && intent.size) arr.sort((a, b) => Number(intent.has(b.id)) - Number(intent.has(a.id)))
    return arr
  }, [intent])


  /* raw alerts (one per app, before snooze/dismiss filtering) */
  const rawAlerts = useMemo(() => {
    const map = new Map<HubAppId, RadarAlert>()
    if (pylon.phase === 'ready') {
      const a = pylonAlert(pylon.data)
      if (a) map.set('pylon', a)
    }
    if (devbay.phase === 'ready') {
      const a = devbayAlert(devbay.data)
      if (a) map.set('devbay', a)
    }
    if (profit) {
      const a = summitAlert(profit)
      if (a) map.set('summit', a)
    }
    return map
  }, [pylon, devbay, profit])

  /* visible alerts = raw minus dismissed/snoozed, sorted worst-first */
  const visibleAlerts = useMemo(() => {
    if (!alertState) return []
    const now = Date.now()
    return [...rawAlerts.values()]
      .filter((a) => !alertState.dismissed.includes(a.id) && (alertState.snoozed[a.id] ?? 0) <= now)
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  }, [rawAlerts, alertState])

  const topAlert = visibleAlerts[0] ?? null

  const slices: Record<HubAppId, { phase: Slice<unknown>['phase'] }> = { devbay, summit, pylon }

  /* radar nodes — one per app, carrying its currently-visible alert (if any) */
  const radarNodes: RadarNode[] = useMemo(
    () => {
      const phase: Record<HubAppId, Slice<unknown>['phase']> = {
        devbay: devbay.phase,
        summit: summit.phase,
        pylon: pylon.phase
      }
      return ordered.map((app) => ({
        app,
        alert: visibleAlerts.find((a) => a.app === app.id) ?? null,
        connected: phase[app.id] === 'ready',
        loading: phase[app.id] === 'loading'
      }))
    },
    [ordered, visibleAlerts, devbay.phase, summit.phase, pylon.phase]
  )

  const nudgeApps = HUB_APPS.filter(
    (a) => slices[a.id].phase === 'nudge' && (!intent || intent.size === 0 || intent.has(a.id))
  ).map((a) => a.id)

  const connectedCount = HUB_APPS.filter((a) => slices[a.id].phase === 'ready').length
  const setupPct = Math.max(8, Math.round((connectedCount / HUB_APPS.length) * 100))
  const anyLoading = HUB_APPS.some((a) => slices[a.id].phase === 'loading')
  const urgent = visibleAlerts.length

  const firstName = user.email ? nameFromEmail(user.email) : ''
  const headline = firstName ? `${greeting()}, ${firstName}.` : `${greeting()}.`
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  /* ---- alert actions (persist to the vault) ---- */
  const persist = (next: AlertState): void => {
    const pruned = pruneState(next)
    setAlertState(pruned)
    void window.decks?.vault.set({ key: VAULT_KEY, plaintext: JSON.stringify(pruned) }).catch(() => {})
  }
  const onJump = (a: RadarAlert): void => go(a.jumpApp, a.jumpTab)
  const onSnooze = (a: RadarAlert): void => {
    const base = alertState ?? EMPTY_STATE
    persist({ ...base, snoozed: { ...base.snoozed, [a.id]: Date.now() + SNOOZE_MS } })
  }
  const onDismiss = (a: RadarAlert): void => {
    const base = alertState ?? EMPTY_STATE
    if (base.dismissed.includes(a.id)) return
    persist({ ...base, dismissed: [...base.dismissed, a.id] })
  }

  const bodyFor = (id: HubAppId): JSX.Element => {
    switch (id) {
      case 'devbay':
        return devbay.phase === 'ready' ? (
          <StatBody stat={devbayStat(devbay.data)} />
        ) : devbay.phase === 'nudge' ? (
          <NudgeBody app="devbay" go={go} />
        ) : devbay.phase === 'error' ? (
          <ErrorBody message={devbay.message} />
        ) : (
          <LoadingBody />
        )
      case 'summit':
        return summit.phase === 'ready' ? (
          <StatBody stat={summitStat(summit.data)} />
        ) : summit.phase === 'nudge' ? (
          <NudgeBody app="summit" go={go} />
        ) : summit.phase === 'error' ? (
          <ErrorBody message={summit.message} />
        ) : (
          <LoadingBody />
        )
      case 'pylon':
        return pylon.phase === 'ready' ? (
          <StatBody stat={pylonStat(pylon.data)} />
        ) : pylon.phase === 'nudge' ? (
          <NudgeBody app="pylon" go={go} />
        ) : pylon.phase === 'error' ? (
          <ErrorBody message={pylon.message} />
        ) : (
          <LoadingBody />
        )
    }
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '34px 40px 60px' }}>
      {/* greeting */}
      <div style={{ marginBottom: 30 }}>
        <Reveal delay={40}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Badge tone="accent" icon="spark">
              {dateLabel}
            </Badge>
            {anyLoading ? (
              <Badge dot tone="neutral">
                Syncing live status
              </Badge>
            ) : urgent > 0 ? (
              <Badge dot tone={topAlert?.severity === 'critical' ? 'neg' : 'warn'}>
                {urgent} {urgent === 1 ? 'alert needs' : 'alerts need'} attention
              </Badge>
            ) : (
              <Badge dot tone="pos">
                All systems nominal
              </Badge>
            )}
          </div>
        </Reveal>
        <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
          <BlurText text={headline} />
        </h1>
        <Reveal delay={420}>
          <p style={{ fontSize: 16, color: 'var(--text-2)', marginTop: 10, maxWidth: 560 }}>
            Here&rsquo;s everything, and here&rsquo;s what needs you. Your numbers, your repos, and your coursework —
            one radar.
          </p>
        </Reveal>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 22, alignItems: 'start' }}>
        {/* app status grid */}
        <div>
          <SectionTitle icon="grid" title="Your apps" sub="Live status across the collection" />
          <AnimatedList stagger={90} baseDelay={120} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            {ordered.map((a) => {
              const featured = !!intent && intent.has(a.id)
              return (
                <div key={a.id} data-app={a.id} style={{ height: '100%' }}>
                  <SpotlightCard
                    className="jc-card jc-card-hover"
                    strength={0.12}
                    onClick={() => go(a.id)}
                    style={{
                      cursor: 'pointer',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-lg)',
                      padding: 22,
                      height: '100%'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: 'var(--r-md)',
                            display: 'grid',
                            placeItems: 'center',
                            color: 'var(--accent-ink)',
                            background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))',
                            boxShadow: '0 8px 20px -10px var(--accent-glow)'
                          }}
                        >
                          <Icon name={a.glyph} size={24} />
                        </div>
                        <div>
                          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{a.name}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{a.tagline}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {featured && (
                          <Badge tone="accent" size="sm">
                            For you
                          </Badge>
                        )}
                        <Icon name="arrowR" size={18} style={{ color: 'var(--text-3)' }} />
                      </div>
                    </div>
                    {bodyFor(a.id)}
                  </SpotlightCard>
                </div>
              )
            })}
            {/* vault status — fills the empty grid cell next to the last app */}
            <div key="vault" data-app="hangar" style={{ height: '100%' }}>
              <Card style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 'var(--r-md)',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--accent-soft)',
                      color: 'var(--accent-h)',
                      flex: '0 0 auto'
                    }}
                  >
                    <Icon name="shield" size={22} />
                  </div>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Encrypted on your device</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>One account unlocks everything</div>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 14, flex: 1 }}>
                  All integration tokens stay end-to-end encrypted on this device.
                </div>
                {!user.loaded ? (
                  <Skeleton w={170} h={14} />
                ) : user.unlocked ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--pos)', fontSize: 12.5, fontWeight: 600 }}>
                    <Icon name="shield" size={16} />
                    Vault unlocked · end-to-end encrypted
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-3)', fontSize: 12.5, fontWeight: 600 }}>
                    <Icon name="lock" size={16} />
                    Vault locked — sign in to unlock
                  </div>
                )}
              </Card>
            </div>
          </AnimatedList>

          {/* first-run setup nudges (featured apps that aren't connected yet) */}
          {nudgeApps.map((id, i) => {
            const n = SETUP_NUDGE[id]
            return (
              <Reveal key={id} delay={420 + i * 90}>
                <div data-app={id}>
                  <Card style={{ marginTop: 16, padding: 0, overflow: 'hidden', background: 'var(--surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 22px' }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 'var(--r-md)',
                          display: 'grid',
                          placeItems: 'center',
                          background: 'var(--accent-soft)',
                          color: 'var(--accent-h)',
                          flex: '0 0 auto'
                        }}
                      >
                        <Icon name={n.icon} size={20} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700 }}>{n.title}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{n.body}</div>
                      </div>
                      <Button variant="soft" size="sm" iconRight="arrowR" onClick={() => go(id)}>
                        Connect
                      </Button>
                    </div>
                    <div style={{ height: 3, background: 'var(--surface-3)' }}>
                      <div style={{ height: '100%', width: `${setupPct}%`, background: 'var(--accent)', borderRadius: 99 }} />
                    </div>
                  </Card>
                </div>
              </Reveal>
            )
          })}
        </div>

        {/* ===== HERO: cross-app radar + actionable alerts ===== */}
        <div style={{ position: 'sticky', top: 0 }}>
          <SectionTitle icon="target" title="Radar" sub="Every app, every alert — at a glance" />
          <Card>
            <Reveal delay={120}>
              <Radar
                nodes={radarNodes}
                topId={topAlert?.id ?? null}
                selectedApp={selectedApp}
                onSelect={(app) => setSelectedApp((prev) => (prev === app ? null : app))}
                totalAlerts={visibleAlerts.length}
              />
            </Reveal>

            {/* the single most important signal, spelled out under the radar */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              {alertState === null || anyLoading ? (
                <div style={{ display: 'flex', gap: 12, padding: '4px 2px' }}>
                  <Skeleton w={34} h={34} r={10} />
                  <div style={{ flex: 1 }}>
                    <Skeleton w="65%" h={13} />
                    <Skeleton w="88%" h={11} style={{ marginTop: 7 }} />
                  </div>
                </div>
              ) : visibleAlerts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '14px 8px' }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      margin: '0 auto 10px',
                      borderRadius: 'var(--r-md)',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'color-mix(in oklch, var(--pos) 14%, transparent)',
                      color: 'var(--pos)'
                    }}
                  >
                    <Icon name="check" size={20} />
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>All clear</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>
                    Nothing across your apps needs you right now.
                  </div>
                </div>
              ) : (
                <AnimatedList stagger={70} baseDelay={120}>
                  {visibleAlerts.map((a) => (
                    <AlertRow
                      key={a.id}
                      alert={a}
                      highlight={selectedApp === a.app || (selectedApp === null && a.id === topAlert?.id)}
                      onJump={onJump}
                      onSnooze={onSnooze}
                      onDismiss={onDismiss}
                    />
                  ))}
                </AnimatedList>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
