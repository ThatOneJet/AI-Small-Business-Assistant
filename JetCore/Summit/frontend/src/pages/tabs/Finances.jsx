import { useEffect, useState, useMemo } from 'react'
import {
  ComposedChart, Bar, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ResponsiveContainer,
} from 'recharts'
import { api } from '../../api'
import { meetsRequired, PlanGate } from '../../planGating'
import UploadButton from './UploadButton'

const LOGO_PAIRS = [
  ['#ff6a1a','#ff9a5c'], ['#00c6fb','#005bea'], ['#f7971e','#ffd200'],
  ['#11998e','#38ef7d'], ['#8b5cf6','#c084fc'], ['#ec4899','#f9a8d4'],
  ['#29b6f6','#0288d1'], ['#ef4444','#ff6b6b'],
]

function merchantColorPair(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return LOGO_PAIRS[h % LOGO_PAIRS.length]
}

function MerchantLogo({ name, logoUrl }) {
  const letter   = (name || '?')[0].toUpperCase()
  const [c1, c2] = merchantColorPair(name || '?')
  const [imgErr, setImgErr] = useState(false)

  const wrapStyle = {
    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
    overflow: 'hidden', userSelect: 'none',
  }

  let imgSrc = null
  if (logoUrl) {
    imgSrc = (logoUrl.startsWith('http') || logoUrl.startsWith('data:'))
      ? logoUrl
      : `data:image/png;base64,${logoUrl}`
  }

  if (imgSrc && !imgErr) {
    return (
      <div style={{ ...wrapStyle, background: '#fff' }}>
        <img
          src={imgSrc}
          alt={name}
          onError={() => setImgErr(true)}
          style={{
            width: '100%', height: '100%',
            objectFit: 'contain',
            transform: 'scale(1.45)',
            display: 'block',
          }}
        />
      </div>
    )
  }

  return (
    <div style={{
      ...wrapStyle,
      background: `linear-gradient(135deg, ${c1}, ${c2})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 10px ${c1}66`,
    }}>
      <span style={{ color: '#fff', fontWeight: 800, fontSize: 16, letterSpacing: '.02em' }}>{letter}</span>
    </div>
  )
}

const PERIOD_OPTS = [
  { value: '30',  label: 'Last 30 days' },
  { value: '60',  label: 'Last 60 days' },
  { value: '90',  label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: '730', label: 'All history' },
]

function chartStyle() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  return {
    tooltip: {
      contentStyle: {
        background: dark ? '#161b22' : '#ffffff',
        border: `1px solid ${dark ? '#30363d' : '#d0d7de'}`,
        borderRadius: 8,
      },
      labelStyle: { color: dark ? '#e6edf3' : '#1f2328', fontWeight: 600 },
      itemStyle:  { color: dark ? '#8b949e' : '#656d76' },
    },
    axis: { fill: dark ? '#8b949e' : '#656d76', fontSize: 11 },
    grid: dark ? '#30363d' : '#d0d7de',
  }
}

function IconSync({ spinning }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" width="14" height="14"
         style={spinning ? { animation: 'spin .7s linear infinite' } : undefined}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  )
}

export default function Finances({ uid, plan, onUpgrade, range = '90' }) {
  const [txns,       setTxns]       = useState([])
  const [chartData,  setChartData]  = useState([])
  const [balance,    setBalance]    = useState(null)
  const [totals,     setTotals]     = useState({})
  const period = range
  const [search,     setSearch]     = useState('')
  const [impOnly,    setImpOnly]    = useState(false)
  const [loading,    setLoading]    = useState(true)
  const [syncing,    setSyncing]    = useState(false)
  const [syncProg,   setSyncProg]   = useState(null)   // {pct, done, total, eta_sec}
  const [hasPlaid,   setHasPlaid]   = useState(true)
  const [instLogos,  setInstLogos]  = useState({})     // institution_id -> base64 logo
  const [cashflow,   setCashflow]   = useState(null)
  const [cfOpen,     setCfOpen]     = useState(false)

  const canMax = meetsRequired(plan, 'max')

  function loadData() {
    setLoading(true)
    return api.get(`/api/transactions/${uid}`, { days: period })
      .then(r => {
        setTxns(r.data.transactions || [])
        setChartData(r.data.chart_data || [])
        setBalance(r.data.current_balance ?? null)
        setTotals(r.data.totals || {})
        setHasPlaid(true)
      })
      .catch(() => setHasPlaid(false))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [uid, period])

  // Cash flow projection — Max+
  useEffect(() => {
    if (!canMax) return
    api.get(`/api/cashflow/${uid}`, { days: 90 })
      .then(r => setCashflow(r.data))
      .catch(() => {})
  }, [uid, canMax])

  // Fetch institution logos for transactions that lack a merchant logo
  useEffect(() => {
    const ids = [...new Set(txns.filter(t => !t.logo_url && t.institution_id).map(t => t.institution_id))]
    ids.forEach(id => {
      if (instLogos[id] !== undefined) return
      setInstLogos(prev => ({ ...prev, [id]: null }))  // mark as fetching
      api.get(`/api/institution-logo/${id}`)
        .then(r => setInstLogos(prev => ({ ...prev, [id]: r.data.logo })))
        .catch(() => {})
    })
  }, [txns])

  async function handleSync() {
    setSyncing(true)
    setSyncProg({ pct: 0, done: 0, total: 0, eta_sec: null })

    // Poll progress while sync runs in background
    const pollId = setInterval(async () => {
      try {
        const r = await api.get(`/api/sync/plaid/progress/${uid}`)
        if (r.data.status === 'running' || r.data.status === 'done') {
          setSyncProg(r.data)
        }
        if (r.data.status === 'done' || r.data.status === 'error') {
          clearInterval(pollId)
        }
      } catch {}
    }, 1000)

    try {
      await api.post(`/api/sync/plaid/${uid}`, { days: 730 })
      await loadData()
    } catch {}
    finally {
      clearInterval(pollId)
      setSyncing(false)
      setSyncProg(p => ({ pct: 100, done: p?.total || 1, total: p?.total || 1, eta_sec: null }))
      setTimeout(() => setSyncProg(null), 1500)
    }
  }

  async function toggleImportant(txn) {
    const displayName = txn.merchant_name || txn.description || '—'
    // Toggle based on the clicked transaction — all rows under the same company follow
    const newVal = !txn.is_important
    setTxns(prev => prev.map(t =>
      (t.merchant_name || t.description || '—') === displayName
        ? { ...t, is_important: newVal }
        : t
    ))
    try {
      await api.post('/api/transactions/important-by-merchant', {
        user_id: uid, merchant_name: displayName, is_important: newVal,
      })
    } catch {
      // revert all rows in the group on failure
      setTxns(prev => prev.map(t =>
        (t.merchant_name || t.description || '—') === displayName
          ? { ...t, is_important: txn.is_important }
          : t
      ))
    }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return txns.filter(t => {
      const matchSearch = !q ||
        (t.description   || '').toLowerCase().includes(q) ||
        (t.merchant_name || '').toLowerCase().includes(q)
      return matchSearch && (!impOnly || t.is_important)
    })
  }, [txns, search, impOnly])

  // Share logos across all rows with the same merchant name — fixes inconsistent logo display
  // when Plaid provides logo_url on some transactions but not others for the same company
  const merchantLogoMap = useMemo(() => {
    const map = {}
    txns.forEach(t => {
      const name = t.merchant_name || t.description || '—'
      if (t.logo_url && !map[name]) map[name] = t.logo_url
    })
    return map
  }, [txns])

  const dollarFmt = v => v != null ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'
  const cs = chartStyle()

  if (!hasPlaid && !loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: 'var(--muted)', marginBottom: 8 }}>No bank account connected.</p>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>
          Go to <strong style={{ color: 'var(--accent)' }}>Accounts</strong> and connect your primary business bank.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <button
          className="btn btn-outline btn-sm btn-icon"
          onClick={handleSync}
          disabled={syncing}
          title="Sync full history (2 years)"
        >
          <IconSync spinning={syncing} />
        </button>
        <UploadButton type="finances" uid={uid} label="Import statement" hasData={txns.length > 0}
          onDone={() => loadData()} />
        {syncProg ? (
          <div style={{ flex: 1, maxWidth: 320 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
              <span>
                {syncProg.pct >= 100 ? '✓ Done!' : syncProg.total > 0
                  ? `${syncProg.done.toLocaleString()} / ${syncProg.total.toLocaleString()} transactions`
                  : 'Connecting to Plaid…'}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                {syncProg.pct >= 100 ? '100%' : `${syncProg.pct || 0}%`}
                {syncProg.eta_sec != null && syncProg.pct < 100 && (
                  <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
                    ~{syncProg.eta_sec < 60 ? `${syncProg.eta_sec}s` : `${Math.ceil(syncProg.eta_sec / 60)}m`}
                  </span>
                )}
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3,
                background: 'var(--accent)',
                width: `${syncProg.pct || 0}%`,
                transition: 'width .4s ease',
              }} />
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Syncs 2 years of transactions</span>
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>}

      {!loading && (
        <>
          {/* ── Metric cards ────────────────────────────────────────────────── */}
          <div className="metrics-row">
            <div className="metric-card" style={{ borderTop: '3px solid #29b6f6', paddingTop: 13 }}>
              <div className="metric-label">Current Balance</div>
              <div className="metric-value" style={{ color: '#29b6f6' }}>{dollarFmt(balance)}</div>
            </div>
            <div className="metric-card" style={{ borderTop: '3px solid var(--green)', paddingTop: 13 }}>
              <div className="metric-label">Income</div>
              <div className="metric-value green">{dollarFmt(totals.income)}</div>
            </div>
            <div className="metric-card" style={{ borderTop: '3px solid var(--red)', paddingTop: 13 }}>
              <div className="metric-label">Expenses</div>
              <div className="metric-value red">{dollarFmt(totals.expenses)}</div>
            </div>
            <div className="metric-card" style={{ borderTop: `3px solid ${(totals.net || 0) >= 0 ? 'var(--green)' : 'var(--red)'}`, paddingTop: 13 }}>
              <div className="metric-label">Net Cash Flow</div>
              <div className={`metric-value ${(totals.net || 0) >= 0 ? 'green' : 'red'}`}>
                {totals.net != null ? `${totals.net >= 0 ? '+' : ''}${dollarFmt(Math.abs(totals.net))}` : '—'}
              </div>
            </div>
          </div>

          {/* ── Cash flow chart ──────────────────────────────────────────────── */}
          {chartData.length > 0 && (
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700 }}>Cash Flow</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  {[
                    { color: 'var(--green)', label: 'Income', isLine: false },
                    { color: 'var(--red)',   label: 'Expenses', isLine: false },
                    { color: '#29b6f6',      label: 'Balance', isLine: true },
                  ].map(({ color, label, isLine }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)' }}>
                      {isLine
                        ? <span style={{ width: 20, height: 2, background: color, flexShrink: 0, display: 'inline-block' }} />
                        : <span style={{ width: 12, height: 12, borderRadius: 2, background: color, opacity: 0.8, flexShrink: 0, display: 'inline-block' }} />}
                      {label}
                    </div>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                  <XAxis dataKey="date" tick={cs.axis} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="bar" tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} width={68} />
                  <YAxis yAxisId="line" orientation="right" tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} width={72} />
                  <Tooltip {...cs.tooltip} formatter={(v, name) => [dollarFmt(v), name]} />
                  <Legend />
                  <Bar yAxisId="bar" dataKey="income"   name="Income"   fill="var(--green)" opacity={0.75} maxBarSize={20} radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="bar" dataKey="expenses" name="Expenses" fill="var(--red)"   opacity={0.75} maxBarSize={20} radius={[2, 2, 0, 0]} />
                  <Line yAxisId="line" type="monotone" dataKey="balance" name="Balance" stroke="#29b6f6" strokeWidth={2.5} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Cash Flow Projection — Max+ ──────────────────────────────────── */}
          {!canMax ? (
            <div style={{ marginBottom: 20 }}>
              <PlanGate plan={plan} requiredPlan="max" feature="Cash Flow Projection" onUpgrade={onUpgrade} />
            </div>
          ) : (
            <div className="expansion" style={{ marginBottom: 20 }}>
              <div className="expansion-header" onClick={() => setCfOpen(o => !o)}>
                <span>30-Day Cash Flow Projection</span>
                <span>{cfOpen ? '▲' : '▼'}</span>
              </div>
              {cfOpen && (
                <div className="expansion-body">
                  {!cashflow ? (
                    <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" /></div>
                  ) : (
                    <>
                      <div className="metrics-row" style={{ marginBottom: 20 }}>
                        {(() => {
                          const net = cashflow.avg_daily_net || 0
                          const projBal = cashflow.projection?.length
                            ? cashflow.projection[cashflow.projection.length - 1].projected_balance || 0
                            : null
                          return (
                            <>
                              <div className="metric-card" style={{ borderTop: `3px solid ${net >= 0 ? 'var(--green)' : 'var(--red)'}`, paddingTop: 13 }}>
                                <div className="metric-label">Avg Daily Net</div>
                                <div className={`metric-value ${net >= 0 ? 'green' : 'red'}`}>
                                  {net >= 0 ? '+' : ''}${Math.abs(net).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>trailing 90 days</div>
                              </div>
                              <div className="metric-card" style={{ borderTop: '3px solid var(--green)', paddingTop: 13 }}>
                                <div className="metric-label">Avg Weekly Income</div>
                                <div className="metric-value green">
                                  ${(cashflow.avg_weekly_in || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                              </div>
                              <div className="metric-card" style={{ borderTop: '3px solid var(--red)', paddingTop: 13 }}>
                                <div className="metric-label">Avg Weekly Spend</div>
                                <div className="metric-value red">
                                  ${Math.abs(cashflow.avg_weekly_out || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                              </div>
                              <div className="metric-card" style={{ borderTop: `3px solid ${projBal != null && projBal < 0 ? 'var(--red)' : '#29b6f6'}`, paddingTop: 13 }}>
                                <div className="metric-label">Projected 30d Balance</div>
                                <div className={`metric-value ${projBal != null && projBal < 0 ? 'red' : ''}`} style={projBal != null && projBal >= 0 ? { color: '#29b6f6' } : undefined}>
                                  {projBal != null ? `$${projBal.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                                </div>
                              </div>
                            </>
                          )
                        })()}
                      </div>
                      {cashflow.projection?.length > 0 && (
                        <>
                          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--muted)' }}>
                            Projected account balance — next 30 days
                          </h4>
                          <ResponsiveContainer width="100%" height={200}>
                            <ComposedChart
                              data={cashflow.projection}
                              margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                              <XAxis
                                dataKey="date"
                                tick={cs.axis}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={d => d.slice(5)}
                                interval={4}
                              />
                              <YAxis
                                tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
                                tick={cs.axis}
                                axisLine={false}
                                tickLine={false}
                                width={56}
                              />
                              <Tooltip
                                formatter={v => [`$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 'Projected Balance']}
                                {...cs.tooltip}
                              />
                              <Line
                                type="monotone"
                                dataKey="projected_balance"
                                stroke="#29b6f6"
                                strokeWidth={2.5}
                                dot={false}
                                strokeDasharray="6 3"
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
                            Projection based on 90-day trailing average · Actual results will vary
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Transaction table ────────────────────────────────────────────── */}
          <div className="card">
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Transactions</h3>

            {/* Search + filter row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <input
                className="input-field"
                style={{ maxWidth: 300, marginBottom: 0 }}
                placeholder="Search by name or merchant…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={impOnly} onChange={e => setImpOnly(e.target.checked)} />
                Starred only
              </label>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
                {filtered.length} of {txns.length}
              </span>
            </div>

            {txns.length === 0 ? (
              <p className="empty-state">
                No transactions found. Click the sync button to pull your bank history.
              </p>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Merchant</th>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Type</th>
                        <th title="Star a company to track all its transactions on Overview">★</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.slice(0, 300).map(t => {
                        const displayName = t.merchant_name || t.description || '—'
                        const logoUrl = t.logo_url
                          || merchantLogoMap[displayName]
                          || (t.institution_id ? instLogos[t.institution_id] : null)
                        return (
                          <tr key={t.id}>
                            <td style={{ maxWidth: 300 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <MerchantLogo name={displayName} logoUrl={logoUrl} />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: t.is_important ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {displayName}
                                  </div>
                                  {t.merchant_name && t.description && t.merchant_name !== t.description && (
                                    <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12 }}>{t.date}</td>
                            <td style={{ fontWeight: 600, whiteSpace: 'nowrap', color: t.is_deposit ? 'var(--green)' : 'var(--red)' }}>
                              {t.is_deposit ? '+' : '−'}{dollarFmt(t.amount)}
                            </td>
                            <td>
                              <span style={{
                                fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                                background: t.is_deposit ? 'rgba(63,185,80,.1)' : 'rgba(239,68,68,.08)',
                                border: `1px solid ${t.is_deposit ? 'rgba(63,185,80,.25)' : 'rgba(239,68,68,.2)'}`,
                                color: t.is_deposit ? 'var(--green)' : 'var(--red)',
                              }}>
                                {t.is_deposit ? 'IN' : 'OUT'}
                              </span>
                            </td>
                            <td>
                              <button
                                onClick={() => toggleImportant(t)}
                                title={t.is_important ? 'Untrack company — removes all transactions from Overview' : 'Track company — all transactions under this name show on Overview'}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer',
                                  fontSize: 16, padding: '2px 6px', lineHeight: 1,
                                  color: t.is_important ? '#f59e0b' : 'var(--border)',
                                  transition: 'color .15s',
                                }}
                              >★</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {filtered.length > 300 && (
                  <p style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: '10px 0 0' }}>
                    Showing 300 of {filtered.length} — use the search bar to narrow results
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
