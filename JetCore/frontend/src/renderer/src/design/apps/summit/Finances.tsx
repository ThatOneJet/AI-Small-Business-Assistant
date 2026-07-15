/* Summit · Finances — from the linked bank. Mirrors summit_b.jsx ·
   SummitFinances on real data: getFinances (balance, deposits, tracked costs,
   large outflows), getTransactions (running-balance chart + recent feed + net
   cash flow), and the star toggle persists via setImportantByMerchant. */
import { useCallback, useMemo, useState, type JSX } from 'react'
import { Badge, Card, SectionTitle } from '../../ui'
import { AnimatedList, Reveal } from '../../motion'
import { Icon } from '../../icons'
import { AreaLine, HBars, money, moneyK, type HBarDatum } from '../../charts'
import {
  getFinances,
  getTransactions,
  setImportantByMerchant,
  fmtDay,
  type FinancesResponse,
  type TransactionsResponse,
  type TxnRow
} from './api'
import {
  ConnectEmpty,
  ErrorCard,
  FinancesSkeleton,
  MerchantLogo,
  MetricTile,
  Page,
  PageHead,
  useAsync,
  useMinDelay
} from './shared'

interface FinanceData {
  finances: FinancesResponse
  txns: TransactionsResponse
}

const loadFinances = (days: number) => async (): Promise<FinanceData> => {
  const [finances, txns] = await Promise.all([getFinances(days), getTransactions(days)])
  return { finances, txns }
}

function txnLabel(t: TxnRow): string {
  return t.merchant_name?.trim() || t.description?.trim() || 'Transaction'
}

export function Finances({ days, onConnect }: { days: number; onConnect: () => void }): JSX.Element {
  const { state, reload } = useAsync(useMemo(() => loadFinances(days), [days]), days)
  const [starred, setStarred] = useState<Record<string, boolean>>({})

  const toggleStar = useCallback((merchant: string, important: boolean) => {
    setStarred((s) => ({ ...s, [merchant]: important }))
    void setImportantByMerchant(merchant, important).catch(() => {
      /* optimistic — revert on failure */
      setStarred((s) => ({ ...s, [merchant]: !important }))
    })
  }, [])

  const show = useMinDelay(state.phase !== 'loading')

  if (!show || state.phase === 'loading') return <FinancesSkeleton />
  if (state.phase === 'error') {
    return (
      <Page>
        <PageHead title="Finances" sub="From your bank — balances, cash flow, and the costs you track." />
        <ErrorCard message={state.message} onRetry={reload} />
      </Page>
    )
  }

  const { finances, txns } = state.data
  const balance = finances.total_balance || txns.current_balance
  const hasData = balance !== 0 || txns.transactions.length > 0 || finances.deposits !== 0
  if (!hasData) {
    return (
      <Page>
        <PageHead title="Finances" sub="From your bank — balances, cash flow, and the costs you track." />
        <ConnectEmpty
          icon="wallet"
          title="No accounts linked"
          body="Securely connect your bank to see cash on hand, deposits, large outflows, and the suppliers you want to track."
          onConnect={onConnect}
        />
      </Page>
    )
  }

  const balanceSeries = txns.chart_data.map((p) => ({ label: fmtDay(p.date), value: p.balance }))
  const trackedCosts: HBarDatum[] = finances.important_costs
    .slice()
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ label: c.name, value: c.total, color: 'var(--accent)' }))
  const recent = txns.transactions.slice(0, 12)

  return (
    <Reveal>
    <Page>
      <PageHead title="Finances" sub="From your bank — balances, cash flow, and the costs you track." />

      <AnimatedList stagger={70} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, margin: '22px 0 18px' }}>
        <MetricTile icon="wallet" label="Cash on hand" value={balance} prefix="$" sub="across linked accounts" big />
        <MetricTile icon="arrowDn" label="Deposits" value={finances.deposits} prefix="$" sub="sales payouts + transfers" />
        <MetricTile icon="trend" label="Net cash flow" value={txns.totals.net} prefix="$" sub="in − out, this period" />
      </AnimatedList>

      <Reveal delay={120}>
        <Card>
          <SectionTitle
            icon="chart"
            title="Balance & cash flow"
            sub="Running account balance"
            action={
              <Badge tone="accent" icon="spark">
                {moneyK(txns.totals.income)} in · {moneyK(txns.totals.expenses)} out
              </Badge>
            }
          />
          {balanceSeries.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>No balance history for this period.</div>
          ) : (
            <AreaLine data={balanceSeries} height={230} format={moneyK} />
          )}
        </Card>
      </Reveal>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <Reveal delay={160}>
          <Card>
            <SectionTitle icon="star" title="Tracked costs" sub="Suppliers you've starred" />
            {trackedCosts.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>
                Star a merchant below to track its spend here and on Overview.
              </div>
            ) : (
              <HBars data={trackedCosts} format={moneyK} />
            )}
          </Card>
        </Reveal>
        <Reveal delay={200}>
          <Card>
            <SectionTitle icon="alert" title="Large outflows" sub="Single charges worth a look" />
            {finances.large_transactions.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>No outsized charges in this window.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {finances.large_transactions.map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'color-mix(in oklch, var(--neg) 14%, transparent)', color: 'var(--neg)' }}>
                      <Icon name="arrowUp" size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmtDay(t.date)}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: 'var(--neg)' }}>−{money(Math.abs(t.amount))}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Reveal>
      </div>

      <Reveal delay={240}>
        <Card style={{ marginTop: 18 }}>
          <SectionTitle icon="receipt" title="Recent transactions" sub="Star a merchant to track it on Overview" />
          {recent.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '12px 0' }}>No transactions in this window.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recent.map((t, i) => {
                const label = txnLabel(t)
                const isStar = starred[label] ?? t.is_important
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 6px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                    <MerchantLogo name={label} logoUrl={t.logo_url} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{fmtDay(t.date)}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 14, fontWeight: 700, color: t.is_deposit ? 'var(--pos)' : 'var(--text)' }}>
                      {t.is_deposit ? '+' : '−'}
                      {money(Math.abs(t.amount))}
                    </span>
                    <button
                      className="tap"
                      aria-label={isStar ? 'Untrack merchant' : 'Track merchant'}
                      onClick={() => toggleStar(label, !isStar)}
                      style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', color: isStar ? 'var(--warn)' : 'var(--text-3)' }}
                    >
                      <Icon name="star" size={17} fill={isStar ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </Reveal>
    </Page>
    </Reveal>
  )
}
