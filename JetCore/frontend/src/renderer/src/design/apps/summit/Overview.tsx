/* Summit · Overview — profit, what's trending wrong, tender mix, top sellers.
   Mirrors design/jetcore/project/src/summit.jsx · SummitOverview, on real data:
   getProfit (KPIs + chart), getLaborInsights (trending wrong), getTenders
   (mix), getSales (top sellers). Deltas are week-over-week from the daily series
   the prototype hard-coded. */
import { useMemo, type JSX } from 'react'
import { Button, Card, SectionTitle } from '../../ui'
import { AnimatedList, Reveal } from '../../motion'
import { Icon } from '../../icons'
import { Bars, Donut, HBars, moneyK, type DonutDatum, type HBarDatum } from '../../charts'
import {
  getProfit,
  getTenders,
  getLaborInsights,
  getLabor,
  getSales,
  humanizeTender,
  isExcludedTender,
  type ProfitResponse,
  type TendersResponse,
  type InsightsResponse,
  type LaborResponse,
  type SalesResponse
} from './api'
import { DailyHero } from './signature/DailyHero'
import {
  ConnectEmpty,
  ErrorCard,
  Legend,
  MetricTile,
  OverviewSkeleton,
  Page,
  PageHead,
  SERIES_COLORS,
  useAsync,
  useMinDelay,
  type SummitTab
} from './shared'

interface OverviewData {
  profit: ProfitResponse
  tenders: TendersResponse
  insights: InsightsResponse
  sales: SalesResponse
  labor: LaborResponse
}

const loadOverview = (days: number) => async (): Promise<OverviewData> => {
  const [profit, tenders, insights, sales, labor] = await Promise.all([
    getProfit(days),
    getTenders(days),
    getLaborInsights(days),
    getSales(days),
    getLabor(days)
  ])
  return { profit, tenders, insights, sales, labor }
}

/** Sum the profit of the last `n` days of the daily series. */
function tailProfit(daily: ProfitResponse['daily'], from: number, to: number): number {
  return daily.slice(from, to).reduce((a, d) => a + d.profit, 0)
}
function tailRevenue(daily: ProfitResponse['daily'], from: number, to: number): number {
  return daily.slice(from, to).reduce((a, d) => a + d.revenue, 0)
}

export function Overview({ days, onConnect, onTab }: { days: number; onConnect: () => void; onTab: (t: SummitTab) => void }): JSX.Element {
  const { state, reload } = useAsync(useMemo(() => loadOverview(days), [days]), days)
  const show = useMinDelay(state.phase !== 'loading')

  if (!show || state.phase === 'loading') return <OverviewSkeleton />
  if (state.phase === 'error') {
    return (
      <Page>
        <PageHead title="Overview" sub="How your location is performing — and what's trending wrong." />
        <ErrorCard message={state.message} onRetry={reload} />
      </Page>
    )
  }

  const { profit, tenders, insights, sales, labor } = state.data
  const s = profit.summary
  const daily = profit.daily

  // Show the Overview when there's ANY data — labor (Homebase) often arrives
  // before revenue (POS), and the old `&& total_revenue > 0` hid labor entirely.
  const hasData = daily.length > 0 || s.total_labor > 0
  const hasRevenue = s.total_revenue > 0
  if (!hasData) {
    return (
      <Page>
        <PageHead title="Overview" sub="How your location is performing — and what's trending wrong." />
        <ConnectEmpty
          icon="trend"
          title="No numbers yet"
          body="Connect your POS, scheduling, and bank to see profit, labor, and what's trending wrong — all in one view."
          onConnect={onConnect}
        />
      </Page>
    )
  }

  /* week-over-week deltas from the daily series (the prototype's wow). */
  const thisWeekProfit = tailProfit(daily, -7, daily.length)
  const prevWeekProfit = tailProfit(daily, -14, -7)
  const profitWow = prevWeekProfit ? ((thisWeekProfit - prevWeekProfit) / Math.abs(prevWeekProfit)) * 100 : null
  const thisWeekRev = tailRevenue(daily, -7, daily.length)
  const prevWeekRev = tailRevenue(daily, -14, -7)
  const revWow = prevWeekRev ? ((thisWeekRev - prevWeekRev) / Math.abs(prevWeekRev)) * 100 : null

  const sparkRev = daily.slice(-12).map((d) => d.revenue)
  const sparkProfit = daily.slice(-12).map((d) => d.profit)
  const sparkMargin = daily.slice(-12).map((d) => d.margin_pct ?? 0)
  const sparkLaborPct = daily.slice(-12).map((d) => (d.revenue ? (d.labor / d.revenue) * 100 : 0))

  const barData = daily.map((d) => ({ label: d.date.slice(5), value: d.revenue, margin: d.margin_pct ?? 0 }))

  /* tender mix donut (exclude comps/voids; card share for the centre label). */
  const tenderEntries = Object.entries(tenders.by_type).filter(([t]) => !isExcludedTender(t))
  const tenderTotal = tenderEntries.reduce((a, [, v]) => a + v.amount, 0)
  const donut: DonutDatum[] = tenderEntries
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([t, v], i) => ({ label: humanizeTender(t), value: v.amount, color: SERIES_COLORS[i % SERIES_COLORS.length] }))
  const cardAmount = tenderEntries
    .filter(([t]) => /card|credit|debit|visa|master|amex|discover/i.test(t))
    .reduce((a, [, v]) => a + v.amount, 0)
  const cardSharePct = tenderTotal ? Math.round((cardAmount / tenderTotal) * 100) : 0

  /* top sellers by revenue (aggregate sales rows by item). */
  const byItem = new Map<string, number>()
  for (const row of sales.sales) {
    const name = row.item?.trim()
    if (!name) continue
    byItem.set(name, (byItem.get(name) ?? 0) + row.revenue)
  }
  const topSellers: HBarDatum[] = [...byItem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value], i) => ({ label, value, color: SERIES_COLORS[i % SERIES_COLORS.length] }))

  return (
    <Reveal>
      <Page>
        <PageHead title="Overview" sub="How your location is performing — and what's trending wrong." />

        {/* signature home: today's verdict + this week's biggest leak */}
        <DailyHero profit={profit} sales={sales} labor={labor} insights={insights} days={days} onOpenLabor={() => onTab('labor')} />

        {/* KPI row */}
      <AnimatedList stagger={70} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 }}>
        <MetricTile icon="trend" label="Revenue" value={s.total_revenue} prefix="$" delta={revWow} spark={sparkRev} sub="this period" />
        <MetricTile icon="bolt" label="Net profit" value={s.total_profit} prefix="$" delta={profitWow} spark={sparkProfit} sub="revenue − labor" />
        <MetricTile icon="donut" label="Avg margin" value={s.avg_margin_pct ?? 0} suffix="%" decimals={1} spark={sparkMargin} sub="across period" />
        {hasRevenue ? (
          <MetricTile icon="people" label="Labor %" value={s.labor_pct ?? 0} suffix="%" decimals={1} deltaInvert spark={sparkLaborPct} sparkColor="var(--warn)" sub="of revenue" />
        ) : (
          <MetricTile icon="people" label="Labor cost" value={s.total_labor} prefix="$" spark={daily.slice(-12).map((d) => d.labor)} sparkColor="var(--warn)" sub="this period" />
        )}
      </AnimatedList>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, alignItems: 'start' }}>
        {/* profit + margin */}
        <Reveal delay={120}>
          <Card>
            <SectionTitle
              icon="chart"
              title="Profit & margin"
              sub="Daily revenue with margin overlay"
              action={
                <div style={{ display: 'flex', gap: 16 }}>
                  <Legend color="var(--accent)" label="Revenue" />
                  <Legend color="var(--warn)" label="Margin %" />
                </div>
              }
            />
            <Bars
              data={barData}
              height={250}
              valueKey="value"
              lineKey="margin"
              lineColor="var(--warn)"
              lineFormat={(v) => Number(v).toFixed(1) + '% margin'}
              maxBars={30}
            />
          </Card>
        </Reveal>

        {/* trending wrong */}
        <Reveal delay={200}>
          <Card>
            <SectionTitle icon="alert" title="Trending wrong" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {insights.insights.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: 14, borderRadius: 'var(--r-md)', background: 'color-mix(in oklch, var(--pos) 10%, transparent)', color: 'var(--pos)', fontSize: 13, fontWeight: 600 }}>
                  <Icon name="check" size={16} />
                  Nothing trending wrong this period.
                </div>
              ) : (
                insights.insights.map((ins, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 14,
                      borderRadius: 'var(--r-md)',
                      background: ins.type === 'overstaffed' ? 'color-mix(in oklch, var(--warn) 9%, transparent)' : 'var(--surface-2)',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <Icon name={ins.type === 'overstaffed' ? 'arrowUp' : 'info'} size={15} style={{ color: ins.type === 'overstaffed' ? 'var(--warn)' : 'var(--accent-h)' }} />
                      <span style={{ fontSize: 13, fontWeight: 700 }}>
                        {ins.dow} · {ins.labor_pct.toFixed(1)}% labor
                      </span>
                    </div>
                    <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.5 }}>{ins.message}</p>
                  </div>
                ))
              )}
              <button
                className="tap"
                onClick={() => onTab('labor')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', fontSize: 13, fontWeight: 600, color: 'var(--accent-h)' }}
              >
                See labor breakdown <Icon name="arrowR" size={15} />
              </button>
            </div>
          </Card>
        </Reveal>
      </div>

      {/* secondary row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <Reveal delay={160}>
          <Card>
            <SectionTitle
              icon="receipt"
              title="Tender mix"
              sub="How guests are paying"
              action={
                <Button variant="ghost" size="sm" iconRight="arrowR" onClick={() => onTab('sales')}>
                  Details
                </Button>
              }
            />
            {donut.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>No tender data for this period.</div>
            ) : (
              <Donut data={donut} centerLabel="card share" centerValue={`${cardSharePct}%`} />
            )}
          </Card>
        </Reveal>
        <Reveal delay={220}>
          <Card>
            <SectionTitle icon="fire" title="Top sellers" sub="By revenue, this period" />
            {topSellers.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>No itemised sales yet — connect your POS to break out menu performance.</div>
            ) : (
              <HBars data={topSellers} format={moneyK} />
            )}
          </Card>
        </Reveal>
        </div>
      </Page>
    </Reveal>
  )
}
