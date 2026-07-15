/**
 * JetCore redesign — Wave 1: the briefing-first "Hangar" shell.
 *
 * A ground-up port of the Claude Design handoff (JetCore.dc.html) onto LIVE data.
 * No rail, no app-switcher topbar — just a 60px contextual chrome over either
 * the Hangar Brief (home) or a space.
 *
 *   - Chrome        (design 195–214): back-to-Hangar chip + space identity left;
 *                    ⌘K search + theme toggle + account avatar right.
 *   - HangarBrief    (design 217–333): RIGHT NOW focus + "Across your worlds"
 *                    dispatches + tools + pulse strip + vault footer — WIRED to
 *                    window.decks.{pylon,devbay,summit,cloud}; skeletons while
 *                    loading; honest connect/empty states (never fake numbers).
 *   - Palette        (design 590–609): ⌘K command bar.
 *   - AccountMenu    (design 612–622): real email/name + sign-out.
 *   - SpaceStub      (design 335–342): keeps navigation working pre-spaces.
 *
 * The Brief reuses the foundation in ./system (tone, DOMAINS) and the shared
 * icons (Icon, coreGlyph). Later waves replace SpaceStub per domain.
 */
import { useEffect, useMemo, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import type { DevBayData, PylonData } from '@shared/ipc'
import { Icon, coreGlyph } from '../icons'
import { DOMAINS, tone, type DomainId, type Tone } from './system'

/* ── view model ──────────────────────────────────────────────────────────── */

export type SpaceId = DomainId
export type View = 'brief' | 'space'

/* ── cross-app jump hint ───────────────────────────────────────────────────
 * Hangar has no router beyond onEnter(space). To land a click on the RIGHT
 * spot inside a space, the radar writes a one-shot hint to the shared vault
 * BEFORE navigating; the target space reads + clears it on mount (see
 * consumeJump). Keep this shape + key stable — PylonSpace/SummitSpace read it.
 *   'jc.jump' → { space: SpaceId, tab?: string, at?: number }
 * `tab` is space-defined (Pylon nav.kind: 'week'|'planner'|'grades'|'calc';
 *  Summit tab: 'overview'|'schedule'|'labor'|'finances'|'integrations'). */
export const JUMP_KEY = 'jc.jump'
export interface JumpHint {
  space: SpaceId
  tab?: string
  at?: number
}

/** Write a jump hint to the vault, then enter the space. Best-effort: a vault
 *  failure still navigates (the space just opens on its default tab). */
async function jumpTo(onEnter: (s: SpaceId) => void, space: SpaceId, tab?: string): Promise<void> {
  try {
    const hint: JumpHint = { space, tab, at: Date.now() }
    await window.decks?.vault?.set({ key: JUMP_KEY, plaintext: JSON.stringify(hint) })
  } catch {
    /* navigate anyway — landing on the default tab is acceptable */
  }
  onEnter(space)
}

/**
 * Spaces call this on mount to consume a pending jump hint addressed to them.
 * Returns the requested `tab` (string) when the hint targets `space`, else null,
 * and clears the hint so it fires once. Exported so PylonSpace/SummitSpace reuse it.
 */
export async function consumeJump(space: SpaceId): Promise<string | null> {
  try {
    const raw = await window.decks?.vault?.get(JUMP_KEY)
    if (!raw) return null
    const hint = JSON.parse(raw) as Partial<JumpHint>
    if (hint?.space !== space) return null
    // stale hints (>30s old) are ignored so a fresh manual nav isn't hijacked
    if (typeof hint.at === 'number' && Date.now() - hint.at > 30000) return null
    await window.decks?.vault?.set({ key: JUMP_KEY, plaintext: '' }).catch(() => {})
    return typeof hint.tab === 'string' && hint.tab ? hint.tab : null
  } catch {
    return null
  }
}

/* ── small formatters (design money(), gradeTone()) ──────────────────────── */

/** Compact currency, e.g. money(12480,true) → "$12.5k". */
export function money(n: number, k = false): string {
  if (k && Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + Math.round(n).toLocaleString()
}

/** A grade-tinted colour for a 0–100 score (design 169). */
function gradeTone(s: number | null): string {
  if (s == null) return 'var(--ink-3)'
  if (s >= 93) return 'var(--pos)'
  if (s >= 83) return tone(250).bright
  if (s >= 73) return 'var(--warn)'
  return 'var(--neg)'
}

/** Days until an ISO due date (fractional; negative = past). null when none. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (t - Date.now()) / 86400000
}

/** Days since an ISO timestamp (for repo staleness). */
function daysSince(iso: string): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, (Date.now() - t) / 86400000)
}

/* ── presentational primitives (design tab/bigBtn) ───────────────────────── */

function Tab({ label, t, icon }: { label: string; t: Tone; icon?: string }): JSX.Element {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 11px',
        borderRadius: 999,
        background: t.soft,
        color: t.bright,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '.1em'
      }}
    >
      {icon ? <Icon name={icon} size={13} stroke={2} /> : null}
      {label}
    </span>
  )
}

function GlyphTile({ t, glyph, size, icon, radius }: { t: Tone; glyph: string; size: number; icon: number; radius: number }): JSX.Element {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        display: 'grid',
        placeItems: 'center',
        color: t.ink,
        background: `linear-gradient(140deg,${t.bright},${t.deep})`,
        flex: '0 0 auto'
      }}
    >
      <Icon name={glyph} size={icon} stroke={2} />
    </div>
  )
}

function SectionHead({ title }: { title: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 2px 16px' }}>
      <h2 className="disp" style={{ fontSize: 15, fontWeight: 700, letterSpacing: '.01em', color: 'var(--ink-2)' }}>{title}</h2>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  )
}

/* ── CHROME (design 195–214) ─────────────────────────────────────────────── */

export function Chrome({
  view,
  space,
  theme,
  initials,
  onHome,
  onPalette,
  onToggleTheme,
  onAccount,
  winControls
}: {
  view: View
  space: SpaceId | ''
  theme: 'dark' | 'light'
  initials: string
  onHome: () => void
  onPalette: () => void
  onToggleTheme: () => void
  onAccount: () => void
  /** Frameless-window controls (min/max/close); rendered at the far right. */
  winControls?: ReactNode
}): JSX.Element {
  const inSpace = view === 'space' && !!space
  const d = inSpace ? DOMAINS[space as SpaceId] : null
  const t = d ? tone(d.hue, d.c) : null

  return (
    <div
      className="drag"
      style={{
        flex: '0 0 auto',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px 0 26px',
        position: 'relative',
        zIndex: 5
      }}
    >
      {/* left — wordmark (home) or space identity + back chip */}
      {inSpace && d && t ? (
        <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="tap"
            onClick={onHome}
            title="Back to Hangar"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 12px 7px 9px',
              borderRadius: 999,
              background: 'var(--card)',
              border: '1px solid var(--line)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--ink-2)'
            }}
          >
            <Icon name="chevL" size={16} stroke={2} />
            Hangar
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', color: t.ink, background: `linear-gradient(140deg,${t.bright},${t.deep})` }}>
              <Icon name={d.glyph} size={17} stroke={2} />
            </div>
            <div style={{ lineHeight: 1.05 }}>
              <div className="disp" style={{ fontSize: 16, fontWeight: 700 }}>{d.name}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '.02em' }}>{d.sub}</div>
            </div>
          </div>
        </div>
      ) : (
        <button className="tap no-drag" onClick={onHome} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', color: 'var(--bg)', background: 'var(--ink)' }}>
            {coreGlyph({ size: 20, spin: true })}
          </div>
          <span className="disp" style={{ fontSize: 18, fontWeight: 800 }}>JetCore</span>
        </button>
      )}

      {/* right — ⌘K pill, theme toggle, account avatar, window controls */}
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <button
          className="tap"
          onClick={onPalette}
          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 12px', borderRadius: 999, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink-3)' }}
        >
          <Icon name="search" size={15} stroke={2} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Jump to anything</span>
          <kbd className="mono" style={{ fontSize: 10.5, border: '1px solid var(--line-2)', borderRadius: 6, padding: '1px 6px', color: 'var(--ink-3)' }}>⌘K</kbd>
        </button>
        <button
          className="tap"
          onClick={onToggleTheme}
          title="Theme"
          style={{ width: 38, height: 38, borderRadius: 999, display: 'grid', placeItems: 'center', background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink-2)' }}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} stroke={2} />
        </button>
        <button
          className="tap"
          onClick={onAccount}
          style={{ width: 38, height: 38, borderRadius: 999, display: 'grid', placeItems: 'center', color: 'var(--bg)', fontWeight: 700, fontSize: 13, background: 'linear-gradient(140deg,oklch(0.7 0.15 250),oklch(0.62 0.16 300))' }}
        >
          {initials}
        </button>
        {winControls}
      </div>
    </div>
  )
}

/* ── PALETTE (design 590–609) ────────────────────────────────────────────── */

interface PaletteItem {
  label: string
  sub: string
  icon: string
  kind: string
  run: () => void
}

export function Palette({
  theme,
  onClose,
  onEnter,
  onHome,
  onToggleTheme
}: {
  theme: 'dark' | 'light'
  onClose: () => void
  onEnter: (s: SpaceId) => void
  onHome: () => void
  onToggleTheme: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const q = query.toLowerCase()
  const items: PaletteItem[] = [
    ...(Object.entries(DOMAINS) as [DomainId, (typeof DOMAINS)[DomainId]][]).map(([id, d]) => ({
      label: 'Go to ' + d.name,
      sub: d.sub,
      icon: d.glyph,
      kind: 'Space',
      run: () => onEnter(id)
    })),
    { label: 'Back to Hangar', sub: 'Home', icon: 'home', kind: 'Go', run: onHome },
    { label: "What's due next", sub: 'Pylon', icon: 'clock', kind: 'Action', run: () => onEnter('pylon') },
    { label: 'Draft a release', sub: 'DevBay', icon: 'ship', kind: 'Action', run: () => onEnter('devbay') },
    { label: 'Toggle theme', sub: theme === 'dark' ? 'Light' : 'Dark', icon: theme === 'dark' ? 'sun' : 'moon', kind: 'Action', run: onToggleTheme }
  ]
  const filtered = q ? items.filter((i) => (i.label + ' ' + i.sub).toLowerCase().includes(q)) : items

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background: 'oklch(0.1 0.02 60 / 0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '13vh'
      }}
    >
      <div
        className="pop"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(600px,92vw)', background: 'var(--glass)', backdropFilter: 'blur(26px)', border: '1px solid var(--line-2)', borderRadius: 22, boxShadow: 'var(--shadow)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '17px 20px', borderBottom: '1px solid var(--line)' }}>
          <Icon name="search" size={20} stroke={1.8} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search spaces and actions…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--ink)', fontSize: 16.5, fontWeight: 500 }}
          />
          <kbd className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '3px 7px' }}>ESC</kbd>
        </div>
        <div style={{ padding: 8, maxHeight: 360, overflowY: 'auto' }}>
          {filtered.map((it, i) => {
            const dd = Object.values(DOMAINS).find((d) => d.glyph === it.icon)
            const t = dd ? tone(dd.hue, dd.c) : tone(250)
            return (
              <button
                key={i}
                className="tap"
                onClick={() => {
                  it.run()
                  onClose()
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', padding: '12px 14px', borderRadius: 13, textAlign: 'left' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--card-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: t.soft, color: t.bright, flex: '0 0 auto' }}>
                  <Icon name={it.icon} size={17} stroke={2} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{it.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{it.sub}</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', padding: '3px 8px', borderRadius: 999, background: 'var(--card-2)' }}>{it.kind}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── ACCOUNT MENU (design 612–622) — wired to real email/name + sign-out ──── */

export function AccountMenu({
  name,
  email,
  initials,
  onClose,
  onSettings,
  onSignOut
}: {
  name: string
  email: string
  initials: string
  onClose: () => void
  onSettings: () => void
  onSignOut: () => void
}): JSX.Element {
  const pt = tone(250)
  const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '10px 12px', borderRadius: 11, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 99 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="pop"
        style={{ position: 'absolute', top: 58, right: 26, width: 268, background: 'var(--glass)', backdropFilter: 'blur(22px)', border: '1px solid var(--line-2)', borderRadius: 18, boxShadow: 'var(--shadow)', padding: 8 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 14px' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', color: 'var(--bg)', fontWeight: 700, background: 'linear-gradient(140deg,oklch(0.7 0.15 250),oklch(0.62 0.16 300))' }}>{initials}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email || 'Signed in'}</div>
          </div>
        </div>
        <div style={{ padding: '0 8px 8px' }}>
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 700, padding: '4px 9px', borderRadius: 999, background: pt.soft, color: pt.bright }}>
            <Icon name="shield" size={13} stroke={2} />
            Vault encrypted
          </span>
        </div>
        <div style={{ height: 1, background: 'var(--line)', margin: '4px 4px 8px' }} />
        <button
          className="tap"
          onClick={() => {
            onSettings()
            onClose()
          }}
          style={rowStyle}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--card-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Icon name="gear" size={17} stroke={2} />
          Settings
        </button>
        <div style={{ height: 1, background: 'var(--line)', margin: '8px 4px' }} />
        <button
          className="tap"
          onClick={() => {
            onClose()
            onSignOut()
          }}
          style={{ ...rowStyle, color: 'var(--neg)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--card-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Icon name="logout" size={17} stroke={2} />
          Sign out
        </button>
      </div>
    </div>
  )
}

/* ── SPACE STUB (design 335–342) ─────────────────────────────────────────── */

export function SpaceStub({ space, onEnter }: { space: SpaceId; onEnter: (s: SpaceId) => void }): JSX.Element {
  const dm = DOMAINS[space] ?? DOMAINS.pylon
  const t = tone(dm.hue, dm.c)
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '60px 26px', textAlign: 'center' }}>
      <div style={{ width: 86, height: 86, margin: '0 auto 22px', borderRadius: 26, display: 'grid', placeItems: 'center', color: t.ink, background: `linear-gradient(140deg,${t.bright},${t.deep})`, boxShadow: `0 18px 40px -16px ${t.line}` }}>
        <Icon name={dm.glyph} size={42} stroke={2} />
      </div>
      <h1 className="disp" style={{ fontSize: 30, fontWeight: 800 }}>{dm.name} space</h1>
      <p style={{ fontSize: 15, color: 'var(--ink-2)', marginTop: 10, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
        This space is next — the full {dm.name} experience arrives as the redesign rolls out wave by wave.
      </p>
      <button
        className="tap"
        onClick={() => onEnter('pylon')}
        style={{ marginTop: 20, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderRadius: 14, background: 'var(--ink)', color: 'var(--bg)', fontWeight: 700, fontSize: 14 }}
      >
        See Pylon
        <Icon name="arrowR" size={17} stroke={2} />
      </button>
    </div>
  )
}

/* ── live-data hook ──────────────────────────────────────────────────────── */

interface Stat {
  label: string
  val: string | number
  col: string | null
}

interface BriefData {
  pylon: PylonData | null
  devbay: DevBayData | null
  summit: { profit: number; margin: number | null; laborPct: number | null; connected: boolean } | null
  loading: boolean
}

function useBriefData(canSummit: boolean): BriefData {
  const [data, setData] = useState<BriefData>({ pylon: null, devbay: null, summit: null, loading: true })

  useEffect(() => {
    let alive = true
    const run = async (): Promise<void> => {
      const pylonP = window.decks?.pylon?.fetch().catch(() => null) ?? Promise.resolve(null)
      const devbayP = window.decks?.devbay?.fetch().catch(() => null) ?? Promise.resolve(null)
      // Summit is gated by entitlement + a slow cold-starting Flask backend;
      // only attempt it for entitled accounts. Profit is the headline summary.
      const summitP: Promise<BriefData['summit']> = canSummit
        ? (window.decks?.summit
            ?.api({ path: '/api/profit/:uid?days=30' })
            .then((res) => {
              if (!res?.ok || !res.data || typeof res.data !== 'object') return { profit: 0, margin: null, laborPct: null, connected: false }
              const s = (res.data as { summary?: { total_profit?: number; avg_margin_pct?: number | null; labor_pct?: number | null; total_revenue?: number } }).summary
              if (!s) return { profit: 0, margin: null, laborPct: null, connected: false }
              return {
                profit: s.total_profit ?? 0,
                margin: s.avg_margin_pct ?? null,
                laborPct: s.labor_pct ?? null,
                connected: (s.total_revenue ?? 0) > 0 || (s.total_profit ?? 0) !== 0
              }
            })
            .catch(() => ({ profit: 0, margin: null, laborPct: null, connected: false })) ?? Promise.resolve(null))
        : Promise.resolve(null)

      const [pylon, devbay, summit] = await Promise.all([pylonP, devbayP, summitP])
      if (!alive) return
      setData({ pylon, devbay, summit, loading: false })
    }
    void run()
    return () => {
      alive = false
    }
  }, [canSummit])

  return data
}

/* ── RADAR: read the OTHER apps' synced summaries from the shared vault ─────
 * Hangar holds NO token of its own. The Pylon + Summit hero features write a
 * stable-shape SUMMARY to the vault; the radar reads them (window.decks.vault.get
 * → JSON string | null). DevBay/Pulse/Forge/Borderless have no summary yet — they
 * show as calm "Open" nodes, except DevBay derives a light stale-repo signal live
 * from window.decks.devbay.fetch() when that's cheap. No fabricated alerts. */

type Severity = 'calm' | 'info' | 'warn' | 'crit'

interface PylonSummary {
  app: 'pylon'
  updatedAt: number
  headline: string
  nearest: { title: string; course: string; dueInHours: number; impact: 'high' | 'med' | 'low' } | null
  dueThisWeek: number
  heavyDay: string | null
  status: 'ok' | 'busy' | 'crunch'
}
interface SummitSummary {
  app: 'summit'
  updatedAt: number
  headline: string
  todayProfit: number | null
  leak: { label: string; amount: number } | null
  laborStatus: 'ok' | 'hot' | 'lean'
  published: boolean
}

/** One region on the radar: an app, its live read, and how it should signal. */
interface RadarNode {
  id: SpaceId
  /** When the app last reported (summary updatedAt); drives "primary" emphasis. */
  updatedAt: number | null
  /** True once we have a real reading (summary present, or DevBay fetched). */
  active: boolean
  severity: Severity
  /** One-line current state for the node body. */
  line: string
  /** Suggested next step shown on the dominant alert ("Sat understaffed — open the schedule"). */
  act: string | null
  /** Which tab to land on when this node is clicked (space-defined, optional). */
  tab?: string
}

interface RadarState {
  nodes: RadarNode[]
  loading: boolean
}

/** Severity → the existing JetCore colour semantics. */
function sevColor(s: Severity): string | null {
  return s === 'crit' ? 'var(--neg)' : s === 'warn' ? 'var(--warn)' : s === 'info' ? 'var(--pos)' : null
}
const SEV_RANK: Record<Severity, number> = { calm: 0, info: 1, warn: 2, crit: 3 }

function useRadar(canSummit: boolean): RadarState {
  const [state, setState] = useState<RadarState>({ nodes: [], loading: true })

  useEffect(() => {
    let alive = true
    const run = async (): Promise<void> => {
      const vget = (k: string): Promise<string | null> => window.decks?.vault?.get(k).catch(() => null) ?? Promise.resolve(null)

      const [pylonRaw, summitRaw, devbay] = await Promise.all([
        vget('jc.summary.pylon'),
        canSummit ? vget('jc.summary.summit') : Promise.resolve(null),
        // DevBay has no summary yet — derive a light signal live if it's connected.
        window.decks?.devbay?.fetch().catch(() => null) ?? Promise.resolve(null)
      ])
      if (!alive) return

      const parse = <T,>(raw: string | null): T | null => {
        if (!raw) return null
        try {
          return JSON.parse(raw) as T
        } catch {
          return null
        }
      }
      const pylon = parse<PylonSummary>(pylonRaw)
      const summit = parse<SummitSummary>(summitRaw)

      const nodes: RadarNode[] = []

      // ── Pylon node ──
      {
        let severity: Severity = 'calm'
        let line = 'Open Pylon'
        let act: string | null = null
        let tab: string | undefined
        if (pylon) {
          if (pylon.nearest) {
            const h = pylon.nearest.dueInHours
            const due = h < 0 ? 'overdue' : h < 24 ? `due in ${Math.max(1, Math.round(h))}h` : `due in ${Math.round(h / 24)}d`
            line = `${pylon.nearest.title} · ${due}`
            const overdue = h < 0
            const hi = pylon.nearest.impact === 'high'
            severity = overdue || (hi && h < 48) || pylon.status === 'crunch' ? 'crit' : hi || pylon.status === 'busy' ? 'warn' : 'info'
            if (overdue) {
              act = `${pylon.nearest.title} is overdue — open the planner`
              tab = 'planner'
            } else if (hi) {
              act = `${pylon.nearest.title} is high-impact — open the planner`
              tab = 'planner'
            }
          } else {
            line = pylon.headline || (pylon.dueThisWeek > 0 ? `${pylon.dueThisWeek} due this week` : 'All caught up')
            severity = pylon.status === 'crunch' ? 'warn' : 'calm'
            if (pylon.heavyDay) act = `${pylon.heavyDay} is a wall — open the planner`
            if (act) tab = 'planner'
          }
        }
        nodes.push({ id: 'pylon', updatedAt: pylon?.updatedAt ?? null, active: !!pylon, severity, line, act, tab })
      }

      // ── Summit node (only when entitled) ──
      if (canSummit) {
        let severity: Severity = 'calm'
        let line = 'Open Summit'
        let act: string | null = null
        let tab: string | undefined
        if (summit) {
          if (summit.leak) {
            line = `${summit.leak.label} · ${money(summit.leak.amount, true)}`
            severity = 'crit'
            // a leak headline like "Sat understaffed at peak" → jump to the schedule
            act = `${summit.headline} — open the schedule`
            tab = 'schedule'
          } else if (summit.laborStatus === 'hot') {
            line = 'Labor running hot'
            severity = 'warn'
            act = 'Labor over budget — open Labor'
            tab = 'labor'
          } else if (summit.laborStatus === 'lean') {
            line = 'Running lean — gaps to cover'
            severity = 'info'
            act = 'Open coverage gaps — open the schedule'
            tab = 'schedule'
          } else {
            line = summit.todayProfit != null ? `Today ${money(summit.todayProfit, true)}` : summit.headline || 'Operations nominal'
            severity = 'calm'
          }
          if (!summit.published && severity === 'calm') line = 'Schedule not published yet'
        }
        nodes.push({ id: 'summit', updatedAt: summit?.updatedAt ?? null, active: !!summit, severity, line, act, tab })
      }

      // ── DevBay node — live light signal from stale repos (no summary yet) ──
      {
        const connected = !!devbay?.connected
        const repos = devbay?.repos ?? []
        const stale = repos.filter((r) => daysSince(r.pushedAt) > 60).length
        let severity: Severity = 'calm'
        let line = connected ? `${repos.length} repo${repos.length === 1 ? '' : 's'}` : 'Open DevBay'
        let act: string | null = null
        if (connected && stale > 0) {
          severity = 'info'
          line = `${stale} repo${stale > 1 ? 's' : ''} quiet > 60 days`
          act = `${stale} repo${stale > 1 ? 's' : ''} going stale — review in DevBay`
        }
        nodes.push({ id: 'devbay', updatedAt: connected ? Date.now() : null, active: connected, severity, line, act })
      }

      // ── Neutral nodes — no summary yet, calm "Open" state, never a fake alert ──
      for (const id of ['summit', 'pulse', 'forge', 'borderless'] as SpaceId[]) {
        if (nodes.some((n) => n.id === id)) continue // summit handled above when entitled
        if (id === 'summit' && !canSummit) continue
        nodes.push({ id, updatedAt: null, active: false, severity: 'calm', line: 'Open', act: null })
      }

      // primary apps (those reporting in) float to the front; alerts outrank calm.
      nodes.sort((a, b) => {
        const sev = SEV_RANK[b.severity] - SEV_RANK[a.severity]
        if (sev) return sev
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      })

      setState({ nodes, loading: false })
    }
    void run()
    return () => {
      alive = false
    }
  }, [canSummit])

  return state
}

/* ── the dominant alert (largest / pulsing signal) ───────────────────────── */

function topAlert(nodes: RadarNode[]): RadarNode | null {
  const alerting = nodes.filter((n) => n.severity === 'warn' || n.severity === 'crit')
  if (!alerting.length) return null
  return alerting.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
}

/* ── a single radar node (region) ────────────────────────────────────────── */

function RadarBlip({
  node,
  dominant,
  onEnter
}: {
  node: RadarNode
  dominant: boolean
  onEnter: (s: SpaceId) => void
}): JSX.Element {
  const dm = DOMAINS[node.id]
  const t = tone(dm.hue, dm.c)
  const pip = sevColor(node.severity)
  const alerting = node.severity === 'warn' || node.severity === 'crit'
  return (
    <button
      className="lift"
      onClick={() => void jumpTo(onEnter, node.id, node.tab)}
      title={node.act ?? `Open ${dm.name}`}
      style={{
        display: 'block',
        textAlign: 'left',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 20,
        padding: '16px 16px 15px',
        background: alerting ? `linear-gradient(140deg, ${t.wash}, var(--card))` : 'var(--card)',
        border: `1px solid ${alerting ? t.line : 'var(--line)'}`,
        opacity: node.active || alerting ? 1 : 0.82
      }}
    >
      {/* severity pip — the at-a-glance signal; the dominant one pulses + is larger */}
      {pip ? (
        <span
          className={dominant ? 'jc-radar-pulse' : undefined}
          style={{
            position: 'absolute',
            top: 13,
            right: 13,
            width: dominant ? 13 : 9,
            height: dominant ? 13 : 9,
            borderRadius: 999,
            background: pip,
            boxShadow: `0 0 0 4px color-mix(in oklch, ${pip} 22%, transparent)`
          }}
        />
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <GlyphTile t={t} glyph={dm.glyph} size={40} icon={21} radius={12} />
        <div style={{ minWidth: 0 }}>
          <div className="disp" style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.1 }}>{dm.name}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, letterSpacing: '.02em' }}>{dm.sub}</div>
        </div>
      </div>
      <div
        style={{
          marginTop: 11,
          fontSize: 12.5,
          fontWeight: 600,
          lineHeight: 1.35,
          color: pip ?? 'var(--ink-2)',
          minHeight: 32,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }}
      >
        {node.line}
      </div>
    </button>
  )
}

/* ── THE RADAR MAP — nodes around a center JetCore core ───────────────────── */

function RadarMap({
  nodes,
  loading,
  firstName,
  onEnter
}: {
  nodes: RadarNode[]
  loading: boolean
  firstName: string
  onEnter: (s: SpaceId) => void
}): JSX.Element {
  const alert = topAlert(nodes)
  const anyActive = nodes.some((n) => n.active)
  const ct = tone(250, 0.15)

  // the dominant alert's tone (for the center ping ring)
  const at = alert ? tone(DOMAINS[alert.id].hue, DOMAINS[alert.id].c) : ct

  return (
    <div style={{ marginBottom: 34 }}>
      <SectionHead title="Your radar" />

      {/* center core + at-a-glance status line */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 26,
          background: `linear-gradient(125deg, ${at.wash}, var(--card))`,
          border: `1px solid ${alert ? at.line : 'var(--line)'}`,
          padding: '22px 24px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          flexWrap: 'wrap'
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 64,
            height: 64,
            borderRadius: 18,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--bg)',
            background: 'var(--ink)',
            flex: '0 0 auto'
          }}
        >
          {coreGlyph({ size: 38, spin: true })}
          {/* a sweeping ping ring tinted to the dominant alert (calm when clear) */}
          <span
            className="jc-radar-sweep"
            style={{ position: 'absolute', inset: -6, borderRadius: 22, border: `2px solid ${alert ? at.bright : ct.line}`, pointerEvents: 'none' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: alert ? sevColor(alert.severity) ?? 'var(--ink-3)' : 'var(--ink-3)' }}>
            {alert ? (alert.severity === 'crit' ? 'Needs attention' : 'Worth a look') : anyActive ? 'All clear' : 'Standing by'}
          </div>
          {alert ? (
            <button
              className="tap"
              onClick={() => void jumpTo(onEnter, alert.id, alert.tab)}
              style={{ display: 'block', textAlign: 'left', marginTop: 6 }}
            >
              <div className="disp" style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                {alert.act ?? `${DOMAINS[alert.id].name} needs a look`}
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-2)', display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                {DOMAINS[alert.id].name}
                <Icon name="arrowR" size={15} stroke={2} />
              </div>
            </button>
          ) : (
            <div className="disp" style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.02em', marginTop: 6 }}>
              {anyActive ? `Your worlds are calm, ${firstName}.` : 'Your radar fills in as you use your apps.'}
            </div>
          )}
        </div>
      </div>

      {/* the node grid — every app is a clickable region; alerts read as signals */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ ...skelStyle('100%', 116), borderRadius: 20 }} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12 }}>
          {nodes.map((n) => (
            <RadarBlip key={n.id} node={n} dominant={!!alert && n.id === alert.id} onEnter={onEnter} />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── dispatch card (design 288–304) ──────────────────────────────────────── */

function Dispatch({ id, stats, body, alert, onEnter }: { id: SpaceId; stats: Stat[]; body: ReactNode; alert: string; onEnter: (s: SpaceId) => void }): JSX.Element {
  const dm = DOMAINS[id]
  const t = tone(dm.hue, dm.c)
  return (
    <button
      className="lift"
      onClick={() => onEnter(id)}
      style={{ display: 'block', textAlign: 'left', width: '100%', position: 'relative', overflow: 'hidden', borderRadius: 22, background: 'var(--card)', border: '1px solid var(--line)', padding: '20px 22px 20px 24px' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: `linear-gradient(${t.bright},${t.deep})` }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <GlyphTile t={t} glyph={dm.glyph} size={46} icon={24} radius={14} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
              <span className="disp" style={{ fontSize: 20, fontWeight: 700 }}>{dm.name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600 }}>{dm.sub}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontSize: 12.5, color: 'var(--ink-3)' }}>
              <Icon name="bolt" size={13} fill="currentColor" />
              {alert}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          {stats.map((s, i) => (
            <div key={i} style={{ textAlign: 'right' }}>
              <div className="mono disp" style={{ fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em', color: s.col || 'var(--ink)' }}>{s.val}</div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
          <span style={{ color: t.bright, marginLeft: 2 }}>
            <Icon name="arrowR" size={20} stroke={2} />
          </span>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>{body}</div>
    </button>
  )
}

/* ── tool tile (design 273–280) ──────────────────────────────────────────── */

function ToolTile({ id, line, stat, onEnter }: { id: SpaceId; line: string; stat: string; onEnter: (s: SpaceId) => void }): JSX.Element {
  const dm = DOMAINS[id]
  const t = tone(dm.hue, dm.c)
  return (
    <button
      className="lift"
      onClick={() => onEnter(id)}
      style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', width: '100%', borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: '16px 18px' }}
    >
      <GlyphTile t={t} glyph={dm.glyph} size={44} icon={22} radius={13} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="disp" style={{ fontSize: 16, fontWeight: 700 }}>{dm.name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>{line}</div>
      </div>
      <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
        <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: t.bright }}>{stat}</div>
      </div>
      <span style={{ color: 'var(--ink-3)' }}>
        <Icon name="arrowR" size={18} stroke={2} />
      </span>
    </button>
  )
}

/* ── pulse strip (design 306–333) — no live source yet → honest connect ──── */

function PulseStrip({ onEnter }: { onEnter: (s: SpaceId) => void }): JSX.Element {
  const t = tone(350, 0.16)
  const bt = tone(205, 0.13)
  const connectCard = (label: string, icon: string, ct: Tone, copy: string): JSX.Element => (
    <button
      className="lift"
      onClick={() => onEnter('pulse')}
      style={{ textAlign: 'left', borderRadius: 20, padding: 18, background: 'var(--card)', border: '1px solid var(--line)' }}
    >
      <Tab label={label} t={ct} icon={icon} />
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: ct.soft, color: ct.bright, flex: '0 0 auto' }}>
          <Icon name={icon} size={18} stroke={2} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{copy}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>Nothing connected yet</div>
        </div>
      </div>
    </button>
  )
  return (
    <div style={{ marginTop: 30 }}>
      <SectionHead title="On in the background" />
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 14 }}>
        {connectCard('NOW PLAYING', 'music', t, 'Connect a player')}
        {connectCard('FEEDS', 'rss', tone(350, 0.16), 'Connect a feed')}
        {connectCard('NEXT UP', 'calendar', bt, 'Connect a calendar')}
      </div>
    </div>
  )
}

/* ── skeletons ───────────────────────────────────────────────────────────── */

function skelStyle(w: number | string, h: number, mt = 0): CSSProperties {
  return { width: w, height: h, marginTop: mt, borderRadius: 8, background: 'var(--card-2)', animation: 'jc-pulse 1.4s ease-in-out infinite' }
}

function BriefSkeleton(): JSX.Element {
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '14px 26px 80px' }}>
      <div style={skelStyle(160, 12)} />
      <div style={skelStyle(420, 40, 16)} />
      <div style={skelStyle(540, 20, 14)} />
      <div style={{ ...skelStyle('100%', 150, 34), borderRadius: 26 }} />
      <div style={{ ...skelStyle('100%', 110, 18), borderRadius: 22 }} />
      <div style={{ ...skelStyle('100%', 110, 14), borderRadius: 22 }} />
      <div style={{ ...skelStyle('100%', 110, 14), borderRadius: 22 }} />
    </div>
  )
}

/* ── THE BRIEF (design 217–333) — WIRED TO LIVE DATA ─────────────────────── */

export function HangarBrief({
  firstName,
  vaultUnlocked,
  canSummit,
  onEnter
}: {
  firstName: string
  vaultUnlocked: boolean
  canSummit: boolean
  onEnter: (s: SpaceId) => void
}): JSX.Element {
  const { pylon, devbay, summit, loading } = useBriefData(canSummit)
  // The radar is the centerpiece: it reads the OTHER apps' synced summaries
  // (jc.summary.*) + a live DevBay signal, independent of the dispatch data.
  const radar = useRadar(canSummit)

  const now = useMemo(() => new Date(), [])
  const hour = now.getHours()
  const partOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'

  if (loading) return <BriefSkeleton />

  // ── Pylon derivations ──
  const pylonConnected = !!pylon?.connected
  const courses = pylon?.courses ?? []
  const upcoming = pylon?.upcoming ?? []
  const scored = courses.filter((c): c is typeof c & { score: number } => c.score != null)
  const termAvg = scored.length ? scored.reduce((a, c) => a + c.score, 0) / scored.length : null
  const dueThisWeek = upcoming.filter((u) => {
    const d = daysUntil(u.dueAt)
    return d != null && d >= 0 && d <= 7
  }).length
  // nearest upcoming (soonest non-past due) for the RIGHT NOW focus
  const sortedUpcoming = [...upcoming]
    .map((u) => ({ u, d: daysUntil(u.dueAt) }))
    .filter((x) => x.d != null && x.d >= 0)
    .sort((a, b) => (a.d as number) - (b.d as number))
  const next = sortedUpcoming[0]?.u ?? null

  // ── DevBay derivations ──
  const devConnected = !!devbay?.connected
  const repos = devbay?.repos ?? []
  const stale = repos.filter((r) => daysSince(r.pushedAt) > 60).length
  const starSum = repos.reduce((a, r) => a + (r.stars || 0), 0)

  // ── Summit derivations ──
  const summitConnected = !!summit?.connected

  /* hero copy — driven by the radar (the centerpiece source of truth). Count the
   * apps signalling for attention; never fabricate when nothing is connected. */
  const alerts = radar.nodes.filter((n) => n.severity === 'warn' || n.severity === 'crit')
  const anyReporting = radar.nodes.some((n) => n.active)
  const heroLine = radar.loading
    ? 'Reading your radar…'
    : alerts.length === 0
      ? anyReporting
        ? 'Nothing urgent on the radar. Jump into any world below to keep things moving.'
        : 'Your radar fills in as you use your apps — every world below is a click away.'
      : alerts.length === 1
        ? `One thing wants your attention — ${(alerts[0].act ?? `${DOMAINS[alerts[0].id].name} needs a look`).toLowerCase()}.`
        : `${alerts.length} things want your attention across your worlds.`

  const hero = (
    <div style={{ marginBottom: 28 }}>
      <div className="mono" style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 14 }}>
        {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </div>
      <h1 className="disp" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.02, letterSpacing: '-0.03em' }}>
        Good {partOfDay}, {firstName}.
      </h1>
      <p style={{ fontSize: 18, color: 'var(--ink-2)', marginTop: 12, maxWidth: 600, lineHeight: 1.45 }}>{heroLine}</p>
    </div>
  )

  /* dispatches — Pylon / DevBay / Summit (the radar's deeper drill-down) */
  const courseChips = (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      {courses.slice(0, 5).map((c) => (
        <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: 'var(--card-2)', fontSize: 12, fontWeight: 600 }}>
          {c.name.length > 22 ? c.name.slice(0, 22) + '…' : c.name}
          {c.score != null ? <span className="mono" style={{ color: gradeTone(c.score) }}>{Math.round(c.score)}</span> : null}
        </span>
      ))}
    </div>
  )
  const repoChips = (
    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
      {repos.slice(0, 4).map((r) => (
        <span key={r.fullName} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, background: 'var(--card-2)', fontSize: 12, fontWeight: 600 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: langColor(r.language) }} />
          {r.name}
        </span>
      ))}
    </div>
  )

  const pylonStats: Stat[] = pylonConnected
    ? [
        { label: 'Term', val: termAvg != null ? Math.round(termAvg) + '%' : '—', col: gradeTone(termAvg) },
        { label: 'Due this week', val: dueThisWeek, col: null }
      ]
    : []
  const devStats: Stat[] = devConnected
    ? [
        { label: 'Repos', val: repos.length, col: null },
        { label: 'Going stale', val: stale, col: stale > 0 ? 'var(--warn)' : null },
        { label: 'Stars', val: starSum >= 1000 ? (starSum / 1000).toFixed(1) + 'k' : starSum, col: null }
      ]
    : []
  const summitStats: Stat[] = summitConnected && summit
    ? [
        { label: 'Profit', val: money(summit.profit, true), col: 'var(--pos)' },
        ...(summit.margin != null ? [{ label: 'Margin', val: Math.round(summit.margin) + '%', col: null }] : []),
        ...(summit.laborPct != null ? [{ label: 'Labor', val: summit.laborPct.toFixed(1) + '%', col: summit.laborPct > 30 ? 'var(--warn)' : null }] : [])
      ]
    : []

  const dispatches = (
    <div>
      <SectionHead title="Across your worlds" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Dispatch
          id="pylon"
          stats={pylonStats}
          body={pylonConnected ? courseChips : <ConnectLine text="Connect Canvas to track grades and what's due" />}
          alert={pylonConnected ? (next ? `Next: ${next.title}` : 'All caught up') : 'Not connected'}
          onEnter={onEnter}
        />
        <Dispatch
          id="devbay"
          stats={devStats}
          body={devConnected ? repoChips : <ConnectLine text="Connect a repo to see your portfolio" />}
          alert={devConnected ? (stale > 0 ? `${stale} repo${stale > 1 ? 's' : ''} quiet > 60 days` : 'All repos active') : 'Not connected'}
          onEnter={onEnter}
        />
        {canSummit ? (
          <Dispatch
            id="summit"
            stats={summitStats}
            body={summitConnected ? <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Last 30 days at your shop</div> : <ConnectLine text="Connect your shop to see profit and labor" />}
            alert={summitConnected && summit && summit.laborPct != null && summit.laborPct > 30 ? 'Labor running hot' : summitConnected ? 'Operations nominal' : 'Not connected'}
            onEnter={onEnter}
          />
        ) : null}
      </div>
    </div>
  )

  /* tools — Forge + Borderless */
  const tools = (
    <div style={{ marginTop: 30 }}>
      <SectionHead title="Your tools" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ToolTile id="forge" line="Plan any system visually" stat="Open" onEnter={onEnter} />
        <ToolTile id="borderless" line="One keyboard, every machine" stat="Open" onEnter={onEnter} />
      </div>
    </div>
  )

  const footer = (
    <div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
      <Icon name="shield" size={15} stroke={2} />
      {vaultUnlocked ? 'Every token encrypted on this device · vault unlocked' : 'Every token is end-to-end encrypted on this device'}
    </div>
  )

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '14px 26px 80px' }}>
      {hero}
      <RadarMap nodes={radar.nodes} loading={radar.loading} firstName={firstName} onEnter={onEnter} />
      {dispatches}
      {tools}
      <PulseStrip onEnter={onEnter} />
      {footer}
    </div>
  )
}

function ConnectLine({ text }: { text: string }): JSX.Element {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600 }}>
      <Icon name="link" size={14} stroke={2} />
      {text}
    </div>
  )
}

/* language → dot colour (from the design's LANG map, design 920) */
const LANG: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  CSS: '#563d7c'
}
function langColor(lang: string | null): string {
  return (lang && LANG[lang]) || '#888888'
}
