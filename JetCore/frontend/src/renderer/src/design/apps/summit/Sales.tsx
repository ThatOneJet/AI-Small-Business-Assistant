/* Summit · Sales & tenders — from the POS. Mirrors summit.jsx · SummitSales on
   real data: getTenders (mix + revenue centres + KPIs) and getSales (menu
   performance). Tips are derived from tip-keyword tenders; checks = total
   transactions. The prototype's per-item colours don't exist in the backend,
   so the menu table uses one accent share bar (like the prototype's table). */
import { useCallback, useMemo, type JSX } from 'react'
import { Card, SectionTitle } from '../../ui'
import { AnimatedList, Reveal, REDUCED } from '../../motion'
import { Donut, money, moneyK, type DonutDatum } from '../../charts'
import {
  getTenders,
  getSales,
  humanizeTender,
  isTipTender,
  isExcludedTender,
  clearSummitCache,
  type TendersResponse,
  type SalesResponse
} from './api'
import {
  ConnectEmpty,
  ErrorCard,
  ImportButton,
  MetricTile,
  Page,
  PageHead,
  SalesSkeleton,
  SERIES_COLORS,
  useAsync,
  useMinDelay
} from './shared'

interface SalesData {
  tenders: TendersResponse
  sales: SalesResponse
}

const loadSales = (days: number) => async (): Promise<SalesData> => {
  const [tenders, sales] = await Promise.all([getTenders(days), getSales(days)])
  return { tenders, sales }
}

interface ItemAgg {
  item: string
  qty: number
  revenue: number
}

export function Sales({ days, onConnect }: { days: number; onConnect: () => void }): JSX.Element {
  const { state, reload } = useAsync(useMemo(() => loadSales(days), [days]), days)
  const show = useMinDelay(state.phase !== 'loading')

  /* After an import the POS tables changed — drop the memoised GETs so the
     reload pulls fresh sales + tenders (and Overview picks them up on revisit). */
  const onImported = useCallback(() => {
    clearSummitCache()
    reload()
  }, [reload])

  if (!show || state.phase === 'loading') return <SalesSkeleton />
  if (state.phase === 'error') {
    return (
      <Page>
        <PageHead title="Sales & tenders" sub="From your POS — what sold and how it was paid." />
        <ErrorCard message={state.message} onRetry={reload} />
      </Page>
    )
  }

  const { tenders, sales } = state.data

  /* tender aggregates (exclude comp/void; tips split out). */
  const typeEntries = Object.entries(tenders.by_type).filter(([t]) => !isExcludedTender(t))
  const tenderGross = typeEntries.filter(([t]) => !isTipTender(t)).reduce((a, [, v]) => a + v.amount, 0)
  const tipsTotal = typeEntries.filter(([t]) => isTipTender(t)).reduce((a, [, v]) => a + v.amount, 0)
  // Revenue/orders come from tender payments when present; otherwise fall back to
  // the itemised SALES upload (each line's Line Total = revenue; orders = distinct
  // check numbers) so a sales-only import still shows gross sales + check count.
  const grossSales = tenderGross > 0 ? tenderGross : sales.summary.total_revenue
  const checks = tenders.summary.total_transactions || sales.summary.order_count
  const avgCheck = checks ? grossSales / checks : 0
  const tipPct = grossSales ? (tipsTotal / grossSales) * 100 : 0

  const hasData = typeEntries.length > 0 || sales.summary.record_count > 0
  if (!hasData) {
    return (
      <Page>
        <PageHead
          title="Sales & tenders"
          sub="From your POS — what sold and how it was paid."
          action={<ImportButton onImported={onImported} />}
        />
        <ConnectEmpty
          icon="receipt"
          title="No sales data yet"
          body="Connect your point-of-sale — or import a spreadsheet — to see tender mix, revenue centres, and which menu items are pulling their weight."
          onConnect={onConnect}
        />
      </Page>
    )
  }

  const byTypeDonut: DonutDatum[] = typeEntries
    .filter(([t]) => !isTipTender(t))
    .sort((a, b) => b[1].amount - a[1].amount)
    .map(([t, v], i) => ({ label: humanizeTender(t), value: v.amount, color: SERIES_COLORS[i % SERIES_COLORS.length] }))
  const byTypeTotal = byTypeDonut.reduce((a, d) => a + d.value, 0)

  /* revenue centres from the raw tender rows. */
  const centerMap = new Map<string, number>()
  for (const r of tenders.tenders) {
    if (isExcludedTender(r.tender_type) || isTipTender(r.tender_type)) continue
    const c = r.revenue_center?.trim() || 'Unassigned'
    centerMap.set(c, (centerMap.get(c) ?? 0) + r.amount)
  }
  const centerDonut: DonutDatum[] = [...centerMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: SERIES_COLORS[i % SERIES_COLORS.length] }))

  /* menu performance: aggregate sales rows by item. */
  const itemMap = new Map<string, ItemAgg>()
  for (const row of sales.sales) {
    const name = row.item?.trim()
    if (!name) continue
    const cur = itemMap.get(name) ?? { item: name, qty: 0, revenue: 0 }
    cur.qty += row.quantity_sold
    cur.revenue += row.revenue
    itemMap.set(name, cur)
  }
  const items = [...itemMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 12)
  const maxItemRev = Math.max(...items.map((x) => x.revenue), 1)

  return (
    <Reveal>
    <Page>
      <PageHead
        title="Sales & tenders"
        sub="From your POS — what sold and how it was paid."
        action={<ImportButton onImported={onImported} />}
      />

      <AnimatedList stagger={70} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, margin: '22px 0 18px' }}>
        <MetricTile icon="cash" label="Gross sales" value={grossSales} prefix="$" sub="all tenders, ex. tips" />
        <MetricTile icon="receipt" label="Checks" value={checks} sub={checks ? `avg ${money(avgCheck, 2)} / check` : 'no transactions'} />
        <MetricTile icon="spark" label="Tips & gratuity" value={tipsTotal} prefix="$" sub={`${tipPct.toFixed(1)}% of sales`} />
      </AnimatedList>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <Reveal delay={120}>
          <Card>
            <SectionTitle icon="donut" title="By tender type" />
            {byTypeDonut.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>No tender breakdown for this period.</div>
            ) : (
              <Donut data={byTypeDonut} centerLabel="total" centerValue={moneyK(byTypeTotal)} />
            )}
          </Card>
        </Reveal>
        <Reveal delay={180}>
          <Card>
            <SectionTitle icon="pin" title="By revenue center" />
            {centerDonut.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>No revenue-centre tags on these tenders.</div>
            ) : (
              <Donut data={centerDonut} centerLabel="centres" centerValue={String(centerDonut.length)} />
            )}
          </Card>
        </Reveal>
      </div>

      <Reveal delay={220}>
        <Card style={{ marginTop: 18 }}>
          <SectionTitle icon="fire" title="Menu performance" sub="Units sold and revenue contribution" />
          {items.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>
              No itemised sales — your POS isn’t reporting line items for this period.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 12 }}>
                  <th style={{ padding: '8px 0', fontWeight: 600 }}>Item</th>
                  <th style={{ fontWeight: 600 }}>Qty</th>
                  <th style={{ fontWeight: 600 }}>Revenue</th>
                  <th style={{ width: '32%', fontWeight: 600 }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.item} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '13px 0', fontSize: 13.5, fontWeight: 600 }}>{it.item}</td>
                    <td className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>{it.qty.toLocaleString('en-US')}</td>
                    <td className="mono" style={{ fontSize: 13.5, fontWeight: 700 }}>{money(it.revenue)}</td>
                    <td>
                      <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden', marginRight: 12 }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${(it.revenue / maxItemRev) * 100}%`,
                            background: SERIES_COLORS[i % SERIES_COLORS.length],
                            borderRadius: 99,
                            animation: REDUCED ? 'none' : `jc-grow .9s var(--ease-out) ${i * 60}ms backwards`
                          }}
                        />
                      </div>
                    </td>
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
