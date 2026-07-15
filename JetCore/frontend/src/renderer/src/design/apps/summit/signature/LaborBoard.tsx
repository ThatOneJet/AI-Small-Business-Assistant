/* Summit signature — the LABOR BOARD (drill-down, the manipulable fix).
   An hourly view of the open day: SALES VOLUME vs STAFF SCHEDULED per hour.
   Hours where staff is high but sales low are flagged WASTED labor; hours where
   sales are high but staff low are flagged LOST sales. The owner DRAGS staff
   between hours to reschedule and labor cost vs coverage updates LIVE — that live
   drag is the core interaction. Edits persist to vault 'summit.schedule'.

   Built only from REAL data: sales-by-hour rows + scheduled shifts. When neither
   exists, an honest connect empty state is shown instead of fabricated hours. */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Badge, Button, Card, SectionTitle } from '../../../ui'
import { Reveal, REDUCED } from '../../../motion'
import { Icon } from '../../../icons'
import { money } from '../../../charts'
import { getSales, getLabor, fmtDay, type SalesResponse, type LaborResponse } from '../api'
import {
  ConnectEmpty,
  ErrorCard,
  LaborSkeleton,
  Page,
  PageHead,
  useAsync,
  useMinDelay
} from '../shared'
import {
  buildBoard,
  computeCoverage,
  flagHours,
  fmtHour,
  type BoardModel,
  type HourCell,
  type HourFlag
} from './engine'

const VAULT_KEY = 'summit.schedule'

interface BoardData {
  sales: SalesResponse
  labor: LaborResponse
}
const loadBoard = (days: number) => async (): Promise<BoardData> => {
  const [sales, labor] = await Promise.all([getSales(days), getLabor(days)])
  return { sales, labor }
}

/** Persisted edit shape: a per-date staff-by-hour override. */
interface SavedSchedule {
  date: string
  staff: Record<number, number>
}

export function LaborBoard({ days, onConnect }: { days: number; onConnect: () => void }): JSX.Element {
  const { state, reload } = useAsync(useMemo(() => loadBoard(days), [days]), days)
  const show = useMinDelay(state.phase !== 'loading')

  if (!show || state.phase === 'loading') return <LaborSkeleton />
  if (state.phase === 'error') {
    return (
      <Page>
        <PageHead title="Labor board" sub="Move staff across the day — see cost and coverage update live." />
        <ErrorCard message={state.message} onRetry={reload} />
      </Page>
    )
  }

  const board = buildBoard(state.data.sales, state.data.labor)
  if (!board) {
    return (
      <Page>
        <PageHead title="Labor board" sub="Move staff across the day — see cost and coverage update live." />
        <ConnectEmpty
          icon="people"
          title="No hourly schedule yet"
          body="Connect your POS for sales-by-hour and your scheduling tool for shifts, then drag staff across the day to fix over- and understaffed hours."
          onConnect={onConnect}
        />
      </Page>
    )
  }

  return <Board key={board.date} model={board} />
}

/* ── the interactive board ─────────────────────────────────────────────────── */

function Board({ model }: { model: BoardModel }): JSX.Element {
  // working copy of staff counts (the original sales are fixed real data)
  const [hours, setHours] = useState<HourCell[]>(model.hours)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const hydrated = useRef(false)

  // load any saved edits for this date from the vault (once)
  useEffect(() => {
    let alive = true
    void window.decks.vault
      .get(VAULT_KEY)
      .then((raw) => {
        if (!alive || !raw) return
        const saved = JSON.parse(raw) as SavedSchedule
        if (saved?.date === model.date && saved.staff) {
          setHours((cur) => cur.map((h) => ({ ...h, staff: saved.staff[h.hour] ?? h.staff })))
          setSavedAt('loaded')
        }
      })
      .catch(() => {})
      .finally(() => {
        hydrated.current = true
      })
    return () => {
      alive = false
    }
  }, [model.date])

  // baseline (the originally-scheduled arrangement) for the "vs scheduled" delta
  const baseCoverage = useMemo(() => computeCoverage(model.hours, model.avgRate), [model])
  const coverage = useMemo(() => computeCoverage(hours, model.avgRate), [hours, model.avgRate])
  const flags = useMemo(() => flagHours(hours), [hours])
  const maxSales = useMemo(() => Math.max(1, ...hours.map((h) => h.sales)), [hours])
  const maxStaff = useMemo(() => Math.max(1, ...hours.map((h) => h.staff)), [hours])

  const dirty = useMemo(
    () => hours.some((h, i) => h.staff !== model.hours[i].staff),
    [hours, model.hours]
  )

  const persist = useCallback(
    async (next: HourCell[]): Promise<void> => {
      const staff: Record<number, number> = {}
      for (const h of next) staff[h.hour] = h.staff
      const payload: SavedSchedule = { date: model.date, staff }
      try {
        await window.decks.vault.set({ key: VAULT_KEY, plaintext: JSON.stringify(payload) })
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      } catch {
        /* vault locked — keep the in-memory edit, just don't show a saved time */
      }
    },
    [model.date]
  )

  // move one staff member from hour `from` → `to` (the core drag action)
  const moveStaff = useCallback(
    (from: number, to: number): void => {
      if (from === to) return
      setHours((cur) => {
        const fi = cur.findIndex((h) => h.hour === from)
        const ti = cur.findIndex((h) => h.hour === to)
        if (fi < 0 || ti < 0 || cur[fi].staff <= 0) return cur
        const next = cur.map((h) => ({ ...h }))
        next[fi].staff -= 1
        next[ti].staff += 1
        void persist(next)
        return next
      })
    },
    [persist]
  )

  // +/- buttons (keyboard/non-drag fallback that still feels live)
  const bump = useCallback(
    (hour: number, delta: number): void => {
      setHours((cur) => {
        const i = cur.findIndex((h) => h.hour === hour)
        if (i < 0) return cur
        const v = cur[i].staff + delta
        if (v < 0) return cur
        const next = cur.map((h) => ({ ...h }))
        next[i].staff = v
        void persist(next)
        return next
      })
    },
    [persist]
  )

  const reset = useCallback((): void => {
    setHours(model.hours.map((h) => ({ ...h })))
    void persist(model.hours)
    setSavedAt(null)
  }, [model.hours, persist])

  const costDelta = coverage.laborCost - baseCoverage.laborCost

  return (
    <Reveal>
      <Page>
        <PageHead
          title="Labor board"
          sub={`${fmtDay(model.date)} · drag staff across the day — cost and coverage update live.`}
          action={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {savedAt && savedAt !== 'loaded' && (
                <span style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Icon name="check" size={13} style={{ color: 'var(--pos)' }} /> Saved {savedAt}
                </span>
              )}
              {dirty && (
                <Button variant="ghost" size="sm" icon="refresh" onClick={reset}>
                  Reset
                </Button>
              )}
            </div>
          }
        />

        {/* live coverage summary — recomputes on every drag */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
          <LiveStat icon="cash" label="Labor cost" value={money(coverage.laborCost)} delta={dirty ? costDelta : null} />
          <LiveStat icon="clock" label="Staff-hours" value={`${coverage.staffHours}h`} />
          <LiveStat icon="hourglass" label="Wasted hours" value={String(coverage.wasted)} tone={coverage.wasted > 0 ? 'warn' : 'pos'} />
          <LiveStat icon="alert" label="Understaffed" value={String(coverage.lost)} tone={coverage.lost > 0 ? 'neg' : 'pos'} />
        </div>

        <Card>
          <SectionTitle
            icon="people"
            title="Sales vs staff, by hour"
            sub="Drag a staff chip from an overstaffed hour onto an understaffed one"
            action={
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <LegendDot color="var(--warn)" label="Wasted labor" />
                <LegendDot color="var(--neg)" label="Lost sales" />
              </div>
            }
          />
          <div style={{ display: 'flex', gap: 4, alignItems: 'stretch', overflowX: 'auto', paddingBottom: 6 }}>
            {hours.map((h, i) => (
              <HourColumn
                key={h.hour}
                cell={h}
                flag={flags[i]}
                maxSales={maxSales}
                maxStaff={maxStaff}
                dragging={dragFrom !== null}
                isDragOver={dragOver === h.hour}
                onDragStart={() => setDragFrom(h.hour)}
                onDragEnd={() => {
                  setDragFrom(null)
                  setDragOver(null)
                }}
                onDragOver={() => setDragOver(h.hour)}
                onDrop={() => {
                  if (dragFrom !== null) moveStaff(dragFrom, h.hour)
                  setDragFrom(null)
                  setDragOver(null)
                }}
                onBump={(d) => bump(h.hour, d)}
              />
            ))}
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
              {coverage.wasted === 0 && coverage.lost === 0 ? (
                <span style={{ color: 'var(--pos)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={14} /> Coverage looks balanced across the day.
                </span>
              ) : (
                <>
                  {coverage.wasted > 0 && `${coverage.wasted} hour${coverage.wasted === 1 ? '' : 's'} paying for idle staff`}
                  {coverage.wasted > 0 && coverage.lost > 0 && ' · '}
                  {coverage.lost > 0 && `${coverage.lost} hour${coverage.lost === 1 ? '' : 's'} losing sales to thin coverage`}
                </>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
              Blended rate <span className="mono" style={{ fontWeight: 700 }}>{money(model.avgRate, 2)}/h</span>
              {dirty && (
                <>
                  {' · '}
                  <span style={{ color: costDelta <= 0 ? 'var(--pos)' : 'var(--neg)', fontWeight: 700 }} className="mono">
                    {costDelta <= 0 ? '−' : '+'}
                    {money(Math.abs(costDelta))} vs scheduled
                  </span>
                </>
              )}
            </div>
          </div>
        </Card>
      </Page>
    </Reveal>
  )
}

/* ── one hour column: stacked staff chips (draggable) + a sales bar ────────── */

const FLAG_COLOR: Record<HourFlag, string> = {
  wasted: 'var(--warn)',
  lost: 'var(--neg)',
  ok: 'var(--border)'
}

function HourColumn({
  cell,
  flag,
  maxSales,
  maxStaff,
  dragging,
  isDragOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onBump
}: {
  cell: HourCell
  flag: HourFlag
  maxSales: number
  maxStaff: number
  dragging: boolean
  isDragOver: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDrop: () => void
  onBump: (delta: number) => void
}): JSX.Element {
  const salesH = Math.round((cell.sales / maxSales) * 96)
  const flagged = flag !== 'ok'
  const accent = FLAG_COLOR[flag]
  const chipArea = 132 // px reserved for stacked staff chips (≈ maxStaff slots)
  const slotH = Math.max(20, Math.min(30, chipArea / Math.max(maxStaff, 1)))

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      style={{
        flex: '1 0 56px',
        minWidth: 56,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: '8px 4px',
        borderRadius: 'var(--r-md)',
        background: isDragOver
          ? 'var(--accent-soft)'
          : flagged
            ? `color-mix(in oklch, ${accent} 8%, transparent)`
            : 'transparent',
        border: isDragOver ? '1px dashed var(--accent)' : '1px solid transparent',
        transition: 'background .15s var(--ease), border-color .15s var(--ease)'
      }}
    >
      {/* flag pill */}
      <div style={{ height: 18 }}>
        {flag === 'wasted' && <Badge size="sm" tone="warn">idle</Badge>}
        {flag === 'lost' && <Badge size="sm" tone="neg">thin</Badge>}
      </div>

      {/* staff chips — draggable, stacked */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column-reverse',
          alignItems: 'center',
          gap: 4,
          minHeight: chipArea,
          justifyContent: 'flex-start',
          width: '100%'
        }}
      >
        {Array.from({ length: cell.staff }).map((_, i) => (
          <div
            key={i}
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            title="Drag to another hour"
            className="tap"
            style={{
              width: 30,
              height: slotH,
              borderRadius: 'var(--r-sm)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'grab',
              background: flag === 'wasted' ? 'color-mix(in oklch, var(--warn) 22%, var(--surface-2))' : 'var(--accent-soft)',
              color: flag === 'wasted' ? 'var(--warn)' : 'var(--accent-h)',
              border: '1px solid var(--border)',
              boxShadow: '0 1px 2px hsl(var(--shadow-c) / .12)'
            }}
          >
            <Icon name="user" size={14} />
          </div>
        ))}
        {cell.staff === 0 && (
          <div
            style={{
              width: 30,
              height: slotH,
              borderRadius: 'var(--r-sm)',
              border: `1px dashed ${flag === 'lost' ? 'var(--neg)' : 'var(--border-2)'}`,
              opacity: dragging ? 1 : 0.5
            }}
          />
        )}
      </div>

      {/* staff count + nudge controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          className="tap"
          aria-label={`Remove staff at ${fmtHour(cell.hour)}`}
          onClick={() => onBump(-1)}
          disabled={cell.staff <= 0}
          style={{ width: 18, height: 18, borderRadius: 6, display: 'grid', placeItems: 'center', color: 'var(--text-3)', opacity: cell.staff <= 0 ? 0.3 : 1 }}
        >
          <Icon name="close" size={11} />
        </button>
        <span className="mono" style={{ fontSize: 13, fontWeight: 700, minWidth: 12, textAlign: 'center', color: flagged ? accent : 'var(--text)' }}>{cell.staff}</span>
        <button
          className="tap"
          aria-label={`Add staff at ${fmtHour(cell.hour)}`}
          onClick={() => onBump(1)}
          style={{ width: 18, height: 18, borderRadius: 6, display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}
        >
          <Icon name="plus" size={11} />
        </button>
      </div>

      {/* sales bar */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: 104 }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 3 }}>
          {cell.sales >= 1000 ? `$${Math.round(cell.sales / 100) / 10}k` : `$${cell.sales}`}
        </span>
        <div
          style={{
            width: 22,
            height: Math.max(3, salesH),
            borderRadius: 6,
            background: flag === 'lost' ? 'var(--neg)' : 'var(--accent)',
            opacity: flag === 'lost' ? 1 : 0.82,
            animation: REDUCED ? 'none' : `jc-bargrow .5s var(--ease-out) backwards`,
            transformOrigin: 'bottom'
          }}
        />
      </div>

      {/* hour label */}
      <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)' }}>{fmtHour(cell.hour)}</span>
    </div>
  )
}

/* ── small presentational helpers ──────────────────────────────────────────── */

function LiveStat({
  icon,
  label,
  value,
  delta,
  tone
}: {
  icon: string
  label: string
  value: string
  delta?: number | null
  tone?: 'pos' | 'neg' | 'warn'
}): JSX.Element {
  const toneColor = tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : tone === 'warn' ? 'var(--warn)' : 'var(--text)'
  return (
    <Card pad={16}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
          <Icon name={icon} size={14} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="mono" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: toneColor }}>{value}</span>
        {delta !== null && delta !== undefined && delta !== 0 && (
          <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: delta <= 0 ? 'var(--pos)' : 'var(--neg)' }}>
            {delta <= 0 ? '−' : '+'}
            {money(Math.abs(delta))}
          </span>
        )}
      </div>
    </Card>
  )
}

function LegendDot({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
      {label}
    </span>
  )
}
