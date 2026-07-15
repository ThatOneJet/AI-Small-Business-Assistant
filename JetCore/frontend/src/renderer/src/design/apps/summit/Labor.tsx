/* Summit · Labor — from scheduling. Mirrors summit_b.jsx · SummitLabor on real
   data: getLabor (KPIs + cost/OT chart + shifts) and getLaborInsights (avg
   labor % + per-day-of-week breakdown). Deltas come from summary.comparison
   (vs. the previous period); overruns/overtime are flagged. */
import { useMemo, type JSX } from 'react'
import { Avatar, Badge, Card, SectionTitle } from '../../ui'
import { AnimatedList, Reveal, REDUCED } from '../../motion'
import { Bars, money } from '../../charts'
import { getLabor, getLaborInsights, fmtDay, type LaborResponse, type InsightsResponse } from './api'
import {
  ConnectEmpty,
  ErrorCard,
  LaborSkeleton,
  Legend,
  MetricTile,
  Page,
  PageHead,
  useAsync,
  useMinDelay
} from './shared'

interface LaborData {
  labor: LaborResponse
  insights: InsightsResponse
}

const loadLabor = (days: number) => async (): Promise<LaborData> => {
  const [labor, insights] = await Promise.all([getLabor(days), getLaborInsights(days)])
  return { labor, insights }
}

const DOW_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function Labor({ days, onConnect }: { days: number; onConnect: () => void }): JSX.Element {
  const { state, reload } = useAsync(useMemo(() => loadLabor(days), [days]), days)
  const show = useMinDelay(state.phase !== 'loading')

  if (!show || state.phase === 'loading') return <LaborSkeleton />
  if (state.phase === 'error') {
    return (
      <Page>
        <PageHead title="Labor" sub="From scheduling — cost, hours, and overtime vs. last period." />
        <ErrorCard message={state.message} onRetry={reload} />
      </Page>
    )
  }

  const { labor, insights } = state.data
  const sum = labor.summary
  const c = sum.comparison

  if (sum.shift_count === 0) {
    return (
      <Page>
        <PageHead title="Labor" sub="From scheduling — cost, hours, and overtime vs. last period." />
        <ConnectEmpty
          icon="people"
          title="No shifts yet"
          body="Connect your scheduling tool to track labor cost, overtime, and which days are over- or understaffed."
          onConnect={onConnect}
        />
      </Page>
    )
  }

  const avgLaborPct = insights.avg_labor_pct ?? 0
  const compLabel = c.label || 'last period'

  /* cost & overtime chart from the backend's chart_data series. */
  const chart = labor.chart_data.labels.map((lbl, i) => ({
    label: fmtDay(lbl),
    cost: labor.chart_data.cost[i] ?? 0,
    ot: labor.chart_data.ot[i] ?? 0
  }))

  /* per-day-of-week labor %, ordered Mon→Sun, with the weekly average rule. */
  const dowByName = new Map(insights.by_dow.map((d) => [d.dow.slice(0, 3), d] as const))
  const dow = DOW_ORDER.map((label) => ({ label, value: dowByName.get(label)?.labor_pct ?? 0 })).filter((d) => d.value > 0)
  const dowMax = Math.max(45, ...dow.map((d) => d.value))

  const headerBadge =
    c.cost_pct === null ? null : c.cost_pct > 0 ? (
      <Badge tone="warn" icon="alert">
        Labor up {c.cost_pct.toFixed(1)}% vs. {compLabel}
      </Badge>
    ) : (
      <Badge tone="pos" icon="check">
        Labor down {Math.abs(c.cost_pct).toFixed(1)}% vs. {compLabel}
      </Badge>
    )

  return (
    <Reveal>
    <Page>
      <PageHead title="Labor" sub={`From scheduling — cost, hours, and overtime vs. ${compLabel}.`} action={headerBadge ?? undefined} />

      <AnimatedList stagger={70} style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 18 }}>
        <MetricTile icon="cash" label="Labor cost" value={sum.total_labor_cost} prefix="$" delta={c.cost_pct} deltaInvert sub={`${sum.shift_count} shifts`} />
        <MetricTile icon="clock" label="Actual hours" value={sum.total_actual_hours} decimals={1} delta={c.hours_pct} deltaInvert sub={`${sum.total_scheduled_hours.toFixed(0)}h scheduled`} />
        <MetricTile icon="hourglass" label="Overtime shifts" value={sum.overtime_shifts} delta={c.ot_pct} deltaInvert sub="watch this" />
        <MetricTile icon="people" label="Labor %" value={avgLaborPct} suffix="%" decimals={1} sparkColor="var(--warn)" sub="of revenue" />
      </AnimatedList>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, alignItems: 'start' }}>
        <Reveal delay={120}>
          <Card>
            <SectionTitle
              icon="chart"
              title="Labor cost & overtime"
              sub="Daily cost with overtime overlay"
              action={
                <div style={{ display: 'flex', gap: 16 }}>
                  <Legend color="var(--accent)" label="Cost" />
                  <Legend color="var(--warn)" label="OT shifts" />
                </div>
              }
            />
            {chart.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>No daily labor series for this period.</div>
            ) : (
              <Bars data={chart} valueKey="cost" lineKey="ot" lineColor="var(--warn)" lineFormat={(v) => `${v} OT`} height={250} maxBars={14} />
            )}
          </Card>
        </Reveal>

        <Reveal delay={200}>
          <Card>
            <SectionTitle icon="calendar" title="By day of week" sub="Avg labor % — flagged vs. average" />
            {dow.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>Not enough history to break down by weekday yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {dow.map((d, i) => {
                  const ratio = avgLaborPct ? d.value / avgLaborPct : 1
                  const tone = ratio >= 1.2 ? 'var(--warn)' : ratio <= 0.82 ? 'var(--pos)' : 'var(--accent)'
                  return (
                    <div key={d.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 5 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{d.label}</span>
                        <span className="mono" style={{ fontWeight: 700, color: tone }}>{d.value.toFixed(1)}%</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-3)', position: 'relative' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${(d.value / dowMax) * 100}%`,
                            background: tone,
                            borderRadius: 99,
                            animation: REDUCED ? 'none' : `jc-grow .8s var(--ease-out) ${i * 50}ms backwards`
                          }}
                        />
                        {avgLaborPct > 0 && (
                          <div style={{ position: 'absolute', left: `${(avgLaborPct / dowMax) * 100}%`, top: -3, bottom: -3, width: 2, background: 'var(--text-3)', opacity: 0.6 }} />
                        )}
                      </div>
                    </div>
                  )
                })}
                {avgLaborPct > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 2, height: 12, background: 'var(--text-3)' }} />
                    Weekly average {avgLaborPct.toFixed(1)}%
                  </div>
                )}
              </div>
            )}
          </Card>
        </Reveal>
      </div>

      <Reveal delay={240}>
        <Card style={{ marginTop: 18 }}>
          <SectionTitle icon="people" title="Shifts" sub="Recent timesheets" />
          {labor.shifts.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>No individual shifts in this window.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 12 }}>
                  {['Employee', 'Role', 'Dept', 'Sched', 'Actual', 'Rate', 'Cost', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 0', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labor.shifts.slice(0, 40).map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <Avatar name={s.employee_name ?? '—'} size={28} />
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.employee_name ?? 'Unknown'}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-2)' }}>{s.role ?? '—'}</td>
                    <td>{s.department ? <Badge size="sm">{s.department}</Badge> : <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                    <td className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{s.scheduled_hours.toFixed(1)}h</td>
                    <td className="mono" style={{ fontSize: 13, fontWeight: 600, color: s.actual_hours > s.scheduled_hours ? 'var(--warn)' : 'var(--text)' }}>
                      {s.actual_hours.toFixed(1)}h
                    </td>
                    <td className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{money(s.hourly_rate, 2)}</td>
                    <td className="mono" style={{ fontSize: 13.5, fontWeight: 700 }}>{money(s.labor_cost)}</td>
                    <td>{s.is_overtime && <Badge size="sm" tone="warn" dot>OT</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </Reveal>
    </Page>
    </Reveal>
  )
}
