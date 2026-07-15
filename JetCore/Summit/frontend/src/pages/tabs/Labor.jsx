import { useEffect, useState, useMemo } from 'react'
import {
  ComposedChart, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  ResponsiveContainer, Cell, LabelList,
} from 'recharts'
import { api } from '../../api'
import { getLimits, PlanGate, meetsRequired } from '../../planGating'
import UploadButton from './UploadButton'

const BAR_COLORS  = ['#e5534b','#3fb950','#d29922','#58a6ff','#a371f7','#ec4899','#14b8a6','#f78166']
const YOY_COLORS  = ['#7c3aed','#16a34a','#ea580c','#2563eb','#dc2626','#0891b2','#d97706','#be185d']
const MONTHS      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const PERIOD_OPTS = [
  { value: '7',       label: 'Last 7 days' },
  { value: '14',      label: 'Last 14 days' },
  { value: '30',      label: 'Last 30 days' },
  { value: '60',      label: 'Last 60 days' },
  { value: '365',     label: 'Last 12 Months' },
  { value: 'ytd',     label: 'Year to Date' },
  { value: 'history', label: 'Year-over-Year History' },
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

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d.toISOString().slice(0, 10)
}

function groupShifts(shifts, groupBy) {
  const map = {}
  shifts.forEach(s => {
    const raw = (s.shift_date || '').slice(0, 10)
    if (!raw) return
    let key
    if (groupBy === 'daily')   key = raw
    if (groupBy === 'weekly')  key = weekStart(raw)
    if (groupBy === 'monthly') key = raw.slice(0, 7)
    if (groupBy === 'yearly')  key = raw.slice(0, 4)
    map[key] = (map[key] || 0) + (s.labor_cost || 0)
  })
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, cost]) => {
      let label
      if (groupBy === 'daily')   label = key.slice(5)
      if (groupBy === 'weekly')  label = 'Wk ' + key.slice(5)
      if (groupBy === 'monthly') {
        const [y, m] = key.split('-')
        label = new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: '2-digit' })
      }
      if (groupBy === 'yearly')  label = key
      return { label, key, cost: Math.round(cost) }
    })
}

function YoYTooltip({ active, payload, label, yoyChartData, yearList }) {
  if (!active || !payload?.length) return null
  const dark      = document.documentElement.getAttribute('data-theme') === 'dark'
  const textCol   = dark ? '#e6edf3' : '#1f2328'
  const mutedCol  = dark ? '#8b949e' : '#656d76'
  const monthData = yoyChartData.find(d => d.month === label) || {}
  const baseYr    = yearList[yearList.length - 1]
  const baseCost  = monthData[baseYr]
  return (
    <div style={{
      background: dark ? '#161b22' : '#ffffff',
      border: `1px solid ${dark ? '#30363d' : '#d0d7de'}`,
      borderRadius: 8, padding: '10px 14px', fontSize: 13,
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 2, color: textCol }}>{label}</div>
      <div style={{ fontSize: 11, color: mutedCol, marginBottom: 10 }}>% change vs {baseYr}</div>
      {yearList.map((yr, i) => {
        const cost  = monthData[yr]
        const delta = yr !== baseYr && cost != null && baseCost != null && baseCost > 0
          ? (cost - baseCost) / baseCost * 100 : null
        return (
          <div key={yr} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: YOY_COLORS[i % YOY_COLORS.length], flexShrink: 0 }} />
            <span style={{ fontWeight: 600, minWidth: 36, color: textCol }}>{yr}</span>
            <span style={{ color: textCol }}>{cost != null ? `$${cost.toLocaleString()}` : '—'}</span>
            {delta != null && (
              <span style={{ fontSize: 11, fontWeight: 600, color: delta > 0 ? 'var(--red)' : 'var(--green)' }}>
                {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DeltaBadge({ pct, higherIsBad = true }) {
  if (pct == null) return null
  const up = pct > 0
  const bad = higherIsBad ? up : !up
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, marginLeft: 6,
      color: bad ? 'var(--red)' : 'var(--green)',
    }}>
      {bad ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
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

export default function Labor({ uid, plan, onUpgrade, range = '30' }) {
  const limits = getLimits(plan)
  const period = range
  const [data,      setData]      = useState(null)
  const [yoyData,   setYoyData]   = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [syncing,   setSyncing]   = useState(false)
  const [syncProg,  setSyncProg]  = useState(null)
  const [syncKey,   setSyncKey]   = useState(0)
  const [otOpen,    setOtOpen]    = useState(false)
  const [logSearch, setLogSearch] = useState('')
  const [logOtOnly, setLogOtOnly] = useState(false)
  const [logOpen,   setLogOpen]   = useState(false)
  const [empView,   setEmpView]   = useState('bar')
  const [groupBy,   setGroupBy]   = useState('daily')
  const [yoyView,      setYoyView]      = useState('line')
  const [yoyEmpView,   setYoyEmpView]   = useState('bar')
  const [insights,     setInsights]     = useState(null)

  const syncDays = limits.syncDays ?? 90
  const canPro   = meetsRequired(plan, 'pro')

  useEffect(() => {
    if (groupBy === 'yearly' && limits.days !== null) setGroupBy('daily')
    if (groupBy === 'monthly' && limits.days !== null && limits.days < 30) setGroupBy('daily')
  }, [plan])

  async function handleSync() {
    setSyncing(true)
    setSyncProg({ pct: 0, done: 0, total: 0, eta_sec: null })

    const pollId = setInterval(async () => {
      try {
        const r = await api.get(`/api/sync/progress/homebase/${uid}`)
        if (r.data.status === 'running' || r.data.status === 'done') setSyncProg(r.data)
        if (r.data.status === 'done' || r.data.status === 'error') clearInterval(pollId)
      } catch {}
    }, 1000)

    try {
      await api.post(`/api/sync/homebase/${uid}`, { days: syncDays })
      setSyncKey(k => k + 1)
    } catch {}
    finally {
      clearInterval(pollId)
      setSyncing(false)
      setSyncProg(p => ({ pct: 100, done: p?.total || 1, total: p?.total || 1, eta_sec: null }))
      setTimeout(() => setSyncProg(null), 1500)
    }
  }

  useEffect(() => {
    setLoading(true)
    setData(null)
    setYoyData(null)

    if (period === 'history') {
      api.get(`/api/labor/${uid}/yearly`)
        .then(r => setYoyData(r.data))
        .catch(() => setYoyData({}))
        .finally(() => setLoading(false))
    } else {
      const params = period === 'ytd' ? { period: 'ytd' } : { days: Number(period) }
      api.get(`/api/labor/${uid}`, params)
        .then(r => setData(r.data))
        .catch(() => setData({}))
        .finally(() => setLoading(false))
    }
  }, [uid, period, syncKey])

  // When "Yearly" grouping is selected outside history mode, fetch all-time yearly totals
  useEffect(() => {
    if (groupBy === 'yearly' && period !== 'history') {
      api.get(`/api/labor/${uid}/yearly`)
        .then(r => setYoyData(r.data))
        .catch(() => {})
    }
  }, [uid, groupBy, period])

  // Staffing insights — Pro+
  useEffect(() => {
    if (!canPro) return
    api.get(`/api/labor/${uid}/insights`)
      .then(r => setInsights(r.data))
      .catch(() => {})
  }, [uid, syncKey, canPro])

  const summary  = data?.summary    || {}
  const cmp      = summary.comparison || {}
  const shifts   = data?.shifts      || []
  const otShifts = shifts.filter(s => s.is_overtime)

  const { empRows, empTotal } = useMemo(() => {
    const map = {}
    shifts.forEach(s => {
      const n = s.employee_name || 'Unknown'
      map[n] = (map[n] || 0) + (s.labor_cost || 0)
    })
    const rows = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 15)
    return { empRows: rows, empTotal: rows.reduce((acc, [, v]) => acc + v, 0) }
  }, [shifts])

  const costData = useMemo(() => groupShifts(shifts, groupBy), [shifts, groupBy])

  // For monthly view, drop partial months at the edges of the data window.
  // A month is partial if the sync window starts after the 1st or ends before the last day.
  const chartCostData = useMemo(() => {
    if (groupBy !== 'monthly' || costData.length <= 1) return costData
    const allDates = shifts.map(s => (s.shift_date || '').slice(0, 10)).filter(Boolean).sort()
    if (!allDates.length) return costData
    const minDate = allDates[0]
    const maxDate = allDates[allDates.length - 1]
    const todayMonth = new Date().toISOString().slice(0, 7)
    return costData.filter(d => {
      const [y, m] = d.key.split('-').map(Number)
      const monthStart = `${d.key}-01`
      const lastDay    = new Date(y, m, 0).getDate()
      const monthEnd   = `${d.key}-${String(lastDay).padStart(2, '0')}`
      const fullyCovered = minDate <= monthStart && maxDate >= monthEnd
      const isCurrentMonth = d.key === todayMonth
      return fullyCovered && !isCurrentMonth
    })
  }, [costData, shifts, groupBy])
  const empChartData = useMemo(() => empRows.map(([name, cost]) => ({
    name: name.split(' ')[0], fullName: name, cost: Math.round(cost),
  })), [empRows])

  const trendData = useMemo(() => {
    const n = chartCostData.length
    if (n < 3) return chartCostData
    const xMean = (n - 1) / 2
    const yMean = chartCostData.reduce((s, d) => s + d.cost, 0) / n
    let num = 0, den = 0
    chartCostData.forEach((d, i) => { num += (i - xMean) * (d.cost - yMean); den += (i - xMean) ** 2 })
    const slope = den ? num / den : 0
    const intercept = yMean - slope * xMean
    return chartCostData.map((d, i) => ({ ...d, trend: Math.max(0, Math.round(slope * i + intercept)) }))
  }, [chartCostData])

  const filteredShifts = useMemo(() => {
    const q = logSearch.toLowerCase()
    return shifts.filter(s => {
      const matchName = !q || (s.employee_name || '').toLowerCase().includes(q) || (s.role || '').toLowerCase().includes(q)
      const matchOt   = !logOtOnly || s.is_overtime
      return matchName && matchOt
    })
  }, [shifts, logSearch, logOtOnly])

  const dollarFmt = v => `$${(v || 0).toLocaleString()}`
  const cs = chartStyle()

  // ── Year-over-Year chart data ─────────────────────────────────────────────
  const yearList     = yoyData?.year_list || []
  const yoyYears     = yoyData?.years     || {}
  const yoyTotals    = yoyData?.totals    || {}
  const yoyEmployees = yoyData?.employees || {}

  const yoyChartData = useMemo(() => MONTHS.map((month, i) => {
    const point = { month }
    yearList.forEach(yr => {
      const cost = yoyYears[yr]?.cost?.[i] ?? 0
      point[yr] = cost > 0 ? cost : null
    })
    return point
  }), [yearList, yoyYears])

  const yearlyBarData = useMemo(() => yearList.map((yr, i) => ({
    label: yr, key: yr,
    cost: Math.round(yoyTotals[yr]?.cost || 0),
    colorIndex: i,
  })), [yearList, yoyTotals])

  // ── YTD-adjusted totals ───────────────────────────────────────────────────
  // Find how many months the latest year actually has data for, then truncate
  // ALL years to that same period so comparisons are apples-to-apples.
  const { yoyYtdTotals, ytdMonths, ytdLabel } = useMemo(() => {
    if (!yearList.length) return { yoyYtdTotals: {}, ytdMonths: 12, ytdLabel: '' }
    const latestYr = yearList[yearList.length - 1]
    const costArr  = yoyYears[latestYr]?.cost || []
    // Find the last month index with any data
    let lastIdx = -1
    costArr.forEach((v, i) => { if (v > 0) lastIdx = i })
    const months = lastIdx >= 0 ? lastIdx + 1 : 12

    const sumSlice = (arr, n) => (arr || []).slice(0, n).reduce((s, v) => s + v, 0)
    const adjusted = {}
    yearList.forEach(yr => {
      const c = yoyYears[yr]?.cost  || []
      const h = yoyYears[yr]?.hours || []
      const o = yoyYears[yr]?.ot    || []
      adjusted[yr] = {
        cost:  Math.round(sumSlice(c, months)),
        hours: Math.round(sumSlice(h, months) * 10) / 10,
        ot:    sumSlice(o, months),
      }
    })

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const label = months < 12 ? `Jan–${monthNames[months - 1]}` : 'Full year'
    return { yoyYtdTotals: adjusted, ytdMonths: months, ytdLabel: label }
  }, [yearList, yoyYears])

  const yoyBenchmarkData = useMemo(() => yearList.map((yr, i) => {
    const t    = yoyYtdTotals[yr] || {}
    const prev = i > 0 ? yoyYtdTotals[yearList[i - 1]] || {} : null
    const delta = prev && prev.cost > 0 ? (t.cost - prev.cost) / prev.cost * 100 : null
    return { year: yr, cost: t.cost || 0, delta, colorIndex: i }
  }), [yearList, yoyYtdTotals])

  const yoyEmpAllTime = useMemo(() => {
    const rows = Object.entries(yoyEmployees).map(([name, yrs]) => ({
      name: name.split(' ')[0], fullName: name,
      cost: Math.round(Object.values(yrs).reduce((s, v) => s + v, 0)),
    })).sort((a, b) => b.cost - a.cost).slice(0, 15)
    const total = rows.reduce((s, r) => s + r.cost, 0)
    return { rows, total }
  }, [yoyEmployees])

  return (
    <div>
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
        {limits.days !== null && (
          <button
            className="btn btn-outline btn-sm"
            onClick={onUpgrade}
            style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
            title="Unlock more history with a higher plan"
          >
            Unlock more history
          </button>
        )}
        <button
          className="btn btn-outline btn-sm btn-icon"
          onClick={handleSync}
          disabled={syncing}
          title={`Sync Homebase data (${syncDays} days)`}
        >
          <IconSync spinning={syncing} />
        </button>
        <UploadButton type="labor" uid={uid} label="Import timesheet" hasData={shifts.length > 0}
          onDone={() => setSyncKey(k => k + 1)} />
        {syncProg ? (
          <div style={{ flex: 1, maxWidth: 320 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
              <span>
                {syncProg.pct >= 100 ? '✓ Done!' : syncProg.total > 0
                  ? `${Math.min(syncProg.done * 30, syncProg.total * 30)} / ${syncProg.total * 30} days synced`
                  : 'Connecting…'}
              </span>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                {syncProg.pct >= 100 ? '100%' : `${syncProg.pct || 0}%`}
                {syncProg.eta_sec != null && syncProg.pct < 100 && syncProg.total > 0 && (
                  <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
                    ~{syncProg.eta_sec < 60 ? `${syncProg.eta_sec}s` : `${Math.ceil(syncProg.eta_sec / 60)}m`}
                  </span>
                )}
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3, background: 'var(--accent)',
                width: `${syncProg.pct || 0}%`, transition: 'width .4s ease',
              }} />
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Syncs {syncDays >= 365 ? `${Math.round(syncDays / 365)} year${syncDays >= 730 ? 's' : ''}` : `${syncDays} days`} of shifts
          </span>
        )}
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>}

      {/* ── Year-over-Year History view ────────────────────────────────────── */}
      {!loading && period === 'history' && limits.days !== null && (
        <PlanGate plan={plan} requiredPlan="max" feature="Year-over-Year History" onUpgrade={onUpgrade} />
      )}
      {!loading && period === 'history' && limits.days === null && (
        <>
          {yearList.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <p style={{ color: 'var(--muted)', marginBottom: 8 }}>No historical data found.</p>
              <p style={{ color: 'var(--muted)', fontSize: 12 }}>
                Go to <strong style={{ color: 'var(--accent)' }}>Accounts → Full History Sync</strong> to pull all available data.
              </p>
            </div>
          ) : (
            <>
              {/* Chart card */}
              <div className="card" style={{ marginBottom: 20 }}>
                {/* Header row: title + line/bar toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700 }}>Labor Cost by Month — Year-over-Year</h3>
                  <div className="chart-toggle">
                    <button
                      className={`btn btn-sm ${yoyView === 'line' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setYoyView('line')}
                    >Line</button>
                    <button
                      className={`btn btn-sm ${yoyView === 'bar' ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setYoyView('bar')}
                    >Bar</button>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                  {yoyView === 'line'
                    ? 'Each line is one calendar year · hover a point to see cost · future months appear as gaps'
                    : 'Bars clustered by month, color-coded by year (chronological order)'}
                </p>

                <ResponsiveContainer width="100%" height={320}>
                  {yoyView === 'line' ? (
                    <LineChart data={yoyChartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} />
                      <XAxis dataKey="month" tick={cs.axis} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} width={72} />
                      <Tooltip content={p => <YoYTooltip {...p} yoyChartData={yoyChartData} yearList={yearList} />} offset={20} />
                      <Legend />
                      {yearList.map((yr, i) => (
                        <Line
                          key={yr}
                          type="monotone"
                          dataKey={yr}
                          name={yr}
                          stroke={YOY_COLORS[i % YOY_COLORS.length]}
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: YOY_COLORS[i % YOY_COLORS.length] }}
                          activeDot={{ r: 7 }}
                          connectNulls={false}
                        />
                      ))}
                    </LineChart>
                  ) : (
                    <BarChart data={yoyChartData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                      <XAxis dataKey="month" tick={cs.axis} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} width={72} />
                      <Tooltip content={p => <YoYTooltip {...p} yoyChartData={yoyChartData} yearList={yearList} />} offset={20} />
                      <Legend />
                      {/* Bars in chronological year order, NOT sorted by cost */}
                      {yearList.map((yr, i) => (
                        <Bar
                          key={yr}
                          dataKey={yr}
                          name={yr}
                          fill={YOY_COLORS[i % YOY_COLORS.length]}
                          radius={[3, 3, 0, 0]}
                          maxBarSize={28}
                        />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>

              {/* YoY summary metrics */}
              {yearList.length > 0 && (() => {
                const latestYr = yearList[yearList.length - 1]
                const prevYr = yearList.length > 1 ? yearList[yearList.length - 2] : null
                const t = yoyYtdTotals[latestYr] || {}
                const p = prevYr ? yoyYtdTotals[prevYr] || {} : null
                const costDelta = p && p.cost > 0 ? (t.cost - p.cost) / p.cost * 100 : null
                const hoursDelta = p && p.hours > 0 ? (t.hours - p.hours) / p.hours * 100 : null
                return (
                  <div className="metrics-row" style={{ marginBottom: 20 }}>
                    <div className="metric-card" style={{ borderTop: '3px solid var(--orange)', paddingTop: 13 }}>
                      <div className="metric-label">Total Cost ({latestYr})</div>
                      <div className="metric-value">
                        ${(t.cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        {costDelta != null && <DeltaBadge pct={costDelta} higherIsBad={true} />}
                      </div>
                      {prevYr && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>vs {prevYr} ({ytdLabel})</div>}
                    </div>
                    <div className="metric-card" style={{ borderTop: '3px solid var(--green)', paddingTop: 13 }}>
                      <div className="metric-label">Total Hours ({latestYr})</div>
                      <div className="metric-value green">
                        {(t.hours || 0).toFixed(1)} h
                        {hoursDelta != null && <DeltaBadge pct={hoursDelta} higherIsBad={false} />}
                      </div>
                      {prevYr && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>vs {prevYr} ({ytdLabel})</div>}
                    </div>
                    <div className="metric-card" style={{ borderTop: '3px solid var(--blue)', paddingTop: 13 }}>
                      <div className="metric-label">OT Shifts ({latestYr})</div>
                      <div className="metric-value" style={{ color: 'var(--blue)' }}>{t.ot ?? 0}</div>
                      {ytdLabel && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{ytdLabel}</div>}
                    </div>
                    {t.hours > 0 && t.cost > 0 && (
                      <div className="metric-card">
                        <div className="metric-label">Avg Cost/Hour ({latestYr})</div>
                        <div className="metric-value">${(t.cost / t.hours).toFixed(2)}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>blended rate · {ytdLabel}</div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* YoY Benchmark */}
              {yoyBenchmarkData.length > 1 && (() => {
                const deltas   = yoyBenchmarkData.slice(1).map(d => d.delta).filter(d => d != null)
                const avgGrowth = deltas.length > 0 ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null
                const dark = document.documentElement.getAttribute('data-theme') === 'dark'
                return (
                  <div className="card" style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <h3 style={{ fontSize: 15, fontWeight: 700 }}>Year-over-Year Benchmark</h3>
                      {avgGrowth != null && (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                          avg annual change:{' '}
                          <strong style={{ color: avgGrowth > 0 ? 'var(--orange)' : 'var(--green)', fontSize: 13 }}>
                            {avgGrowth > 0 ? '+' : ''}{avgGrowth.toFixed(1)}%
                          </strong>
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                      Labor cost per year · all years compared on same period ({ytdLabel})
                    </p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={yoyBenchmarkData} margin={{ top: 24, right: 16, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                        <XAxis dataKey="year" tick={cs.axis} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} width={72} />
                        <Tooltip
                          formatter={(v, _n, props) => {
                            const d = props.payload?.delta
                            const deltaStr = d != null ? `  (${d > 0 ? '+' : ''}${d.toFixed(1)}% vs prior yr)` : ''
                            return [`${dollarFmt(v)}${deltaStr}`, 'Annual Cost']
                          }}
                          {...cs.tooltip}
                        />
                        <Bar dataKey="cost" radius={[4, 4, 0, 0]} maxBarSize={64}>
                          {yoyBenchmarkData.map((d, i) => (
                            <Cell key={d.year} fill={YOY_COLORS[d.colorIndex % YOY_COLORS.length]} />
                          ))}
                          <LabelList
                            dataKey="delta"
                            position="top"
                            formatter={v => v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}
                            style={{ fontSize: 11, fontWeight: 700, fill: dark ? '#8b949e' : '#656d76' }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )
              })()}

              {/* Cost by Employee — all-time YoY */}
              {yoyEmpAllTime.rows.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700 }}>Cost by Employee — All Time</h3>
                    <div className="chart-toggle">
                      <button className={`btn btn-sm ${yoyEmpView === 'bar' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setYoyEmpView('bar')}>Bar</button>
                      <button className={`btn btn-sm ${yoyEmpView === 'table' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setYoyEmpView('table')}>Table</button>
                    </div>
                  </div>

                  {yoyEmpView === 'bar' ? (
                    <ResponsiveContainer width="100%" height={Math.max(200, yoyEmpAllTime.rows.length * 38)}>
                      <BarChart data={yoyEmpAllTime.rows} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} horizontal={false} />
                        <XAxis type="number" tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={cs.axis} axisLine={false} tickLine={false} width={80} />
                        <Tooltip formatter={(v, _, p) => [dollarFmt(v), p.payload.fullName]} {...cs.tooltip} />
                        <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={28}>
                          {yoyEmpAllTime.rows.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Employee</th><th>All-Time Cost</th><th>Share</th></tr></thead>
                        <tbody>
                          {yoyEmpAllTime.rows.map((r, i) => (
                            <tr key={r.fullName}>
                              <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: BAR_COLORS[i % BAR_COLORS.length], flexShrink: 0 }} />
                                {r.fullName}
                              </td>
                              <td>${r.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div className="progress-bar-bg" style={{ flex: 1, margin: 0 }}>
                                    <div className="progress-bar-fill" style={{ width: `${yoyEmpAllTime.total > 0 ? r.cost / yoyEmpAllTime.total * 100 : 0}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                                  </div>
                                  <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 36 }}>
                                    {yoyEmpAllTime.total > 0 ? (r.cost / yoyEmpAllTime.total * 100).toFixed(1) : 0}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Annual totals table with YoY comparison deltas */}
              <div className="card">
                <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Annual Totals</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th>Total Cost</th>
                        <th>Total Hours</th>
                        <th>OT Shifts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...yearList].reverse().map(yr => {
                        const t = yoyTotals[yr] || {}
                        return (
                          <tr key={yr}>
                            <td style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                              <span style={{
                                width: 10, height: 10, borderRadius: '50%',
                                background: YOY_COLORS[yearList.indexOf(yr) % YOY_COLORS.length],
                                flexShrink: 0,
                              }} />
                              {yr}
                            </td>
                            <td>${(t.cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                            <td>{(t.hours || 0).toFixed(1)} h</td>
                            <td>{t.ot ?? 0}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Standard rolling-window view ──────────────────────────────────── */}
      {!loading && period !== 'history' && (
        <>
          {!shifts.length ? (
            <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <p style={{ color: 'var(--muted)', marginBottom: 8 }}>No shifts found for this period.</p>
              <p style={{ color: 'var(--muted)', fontSize: 12 }}>
                Try a wider range, or go to <strong style={{ color: 'var(--accent)' }}>Accounts → Sync Now</strong>.
              </p>
            </div>
          ) : (
            <>
              {/* Labor Cost chart — total only, with trend line */}
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 700 }}>Labor Cost</h3>
                  <div className="chart-toggle">
                    {[
                      { key: 'daily',   label: 'Daily',   minDays: 0 },
                      { key: 'weekly',  label: 'Weekly',  minDays: 0 },
                      { key: 'monthly', label: 'Monthly', minDays: 30 },
                      { key: 'yearly',  label: 'Yearly',  minDays: null },
                    ].filter(opt =>
                      opt.minDays === null
                        ? limits.days === null
                        : limits.days === null || limits.days >= opt.minDays
                    ).map(opt => (
                      <button
                        key={opt.key}
                        className={`btn btn-sm ${groupBy === opt.key ? 'btn-primary' : 'btn-outline'}`}
                        onClick={() => setGroupBy(opt.key)}
                      >{opt.label}</button>
                    ))}
                  </div>
                </div>

                {groupBy === 'yearly' ? (
                  yearlyBarData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={yearlyBarData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                        <XAxis dataKey="label" tick={cs.axis} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} width={68} />
                        <Tooltip formatter={(v, _, p) => [dollarFmt(v), p.payload.label]} {...cs.tooltip} />
                        <Bar dataKey="cost" radius={[4, 4, 0, 0]} maxBarSize={64}>
                          {yearlyBarData.map(d => (
                            <Cell key={d.key} fill={YOY_COLORS[d.colorIndex % YOY_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="empty-state">Loading yearly totals…</p>
                ) : trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <ComposedChart data={trendData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                      <XAxis dataKey="label" tick={cs.axis} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} width={68} />
                      <Tooltip
                        formatter={(v, name) => [dollarFmt(v), name === 'trend' ? 'Trend' : 'Cost']}
                        labelFormatter={(_, p) => p?.[0]?.payload?.key || ''}
                        {...cs.tooltip}
                      />
                      <Bar dataKey="cost" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                      <Line
                        type="monotone"
                        dataKey="trend"
                        stroke="#29b6f6"
                        strokeWidth={2}
                        dot={false}
                        strokeDasharray="6 3"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <p className="empty-state">No cost data available.</p>}
              </div>

              {/* Comparison banner for YTD */}
              {period === 'ytd' && cmp.prev_cost > 0 && (
                <div className="card" style={{ marginBottom: 16, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Comparing vs {cmp.label}:</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    Cost: ${(cmp.prev_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <DeltaBadge pct={cmp.cost_pct} higherIsBad={true} />
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    Hours: {(cmp.prev_hours || 0).toFixed(1)} h
                    <DeltaBadge pct={cmp.hours_pct} higherIsBad={false} />
                  </span>
                </div>
              )}

              {/* Metric summary */}
              <div className="metrics-row" style={{ marginBottom: 20 }}>
                <div className="metric-card" style={{ borderTop: '3px solid var(--orange)', paddingTop: 13 }}>
                  <div className="metric-label">Total Labor Cost</div>
                  <div className="metric-value">
                    ${(summary.total_labor_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    <DeltaBadge pct={cmp.cost_pct} higherIsBad={true} />
                  </div>
                  {cmp.label && cmp.cost_pct != null && (
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>vs {cmp.label}</div>
                  )}
                </div>

                <div className="metric-card" style={{ flex: 1.6 }}>
                  <div className="metric-label">
                    {{ daily: 'Avg Daily Cost', weekly: 'Avg Weekly Cost', monthly: 'Avg Monthly Cost', yearly: 'Avg Yearly Cost' }[groupBy] || 'Avg Cost'}
                  </div>
                  <div className="metric-value" style={{ fontSize: 32 }}>
                    {chartCostData.length > 0
                      ? `$${Math.round(chartCostData.reduce((s, d) => s + d.cost, 0) / chartCostData.length).toLocaleString()}`
                      : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                    across {chartCostData.length} {groupBy === 'daily' ? 'days' : groupBy === 'weekly' ? 'weeks' : groupBy === 'monthly' ? 'months' : 'years'}
                  </div>
                </div>

                <div className="metric-card" style={{ borderTop: '3px solid var(--green)', paddingTop: 13 }}>
                  <div className="metric-label">Actual Hours</div>
                  <div className="metric-value green">
                    {(summary.total_actual_hours || 0).toFixed(1)} h
                    <DeltaBadge pct={cmp.hours_pct} higherIsBad={false} />
                  </div>
                  {cmp.label && cmp.hours_pct != null && (
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>vs {cmp.label}</div>
                  )}
                </div>

                {summary.total_actual_hours > 0 && summary.total_labor_cost > 0 && (
                  <div className="metric-card" style={{ borderTop: '3px solid var(--blue)', paddingTop: 13 }}>
                    <div className="metric-label">Avg Cost / Hour</div>
                    <div className="metric-value" style={{ color: 'var(--blue)' }}>
                      ${(summary.total_labor_cost / summary.total_actual_hours).toFixed(2)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>blended rate</div>
                  </div>
                )}
              </div>

              {/* Overtime alerts */}
              {otShifts.length > 0 && (
                <div className="expansion" style={{ marginBottom: 20 }}>
                  <div className="expansion-header" onClick={() => setOtOpen(o => !o)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>Overtime Alerts</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4,
                        background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.3)',
                        color: 'var(--orange)',
                      }}>{otShifts.length} shifts</span>
                    </div>
                    <span>{otOpen ? '▲' : '▼'}</span>
                  </div>
                  {otOpen && (
                    <div className="expansion-body" style={{ padding: '4px 16px' }}>
                      {otShifts.slice(0, 10).map((s, i) => {
                        const initials = (s.employee_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                        return (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '10px 0',
                            borderBottom: i < Math.min(otShifts.length, 10) - 1 ? '1px solid var(--border)' : 'none',
                          }}>
                            <div style={{
                              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                              background: 'rgba(234,88,12,.12)', border: '1px solid rgba(234,88,12,.3)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 11, fontWeight: 800, color: 'var(--orange)',
                            }}>{initials}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{s.employee_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                {s.role}{s.department ? ` · ${s.department}` : ''}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(s.shift_date || '').slice(0, 10)}</div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--orange)' }}>
                                {(s.actual_hours || s.scheduled_hours || 0).toFixed(1)} h · ${(s.labor_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                      {otShifts.length > 10 && (
                        <div style={{ fontSize: 12, color: 'var(--muted)', padding: '10px 0', textAlign: 'center' }}>
                          +{otShifts.length - 10} more — filter to "Overtime only" in Shift Log below
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Staffing Insights — Pro+ */}
              {!canPro ? (
                <div style={{ marginBottom: 20 }}>
                  <PlanGate plan={plan} requiredPlan="pro" feature="Staffing Insights" onUpgrade={onUpgrade} />
                </div>
              ) : insights && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700 }}>
                      Staffing Insights
                      {insights.insights?.length > 0 && (
                        <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--orange)', fontWeight: 600 }}>
                          {insights.insights.length} flag{insights.insights.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </h3>
                    {insights.avg_labor_pct != null && (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        avg <strong style={{ color: 'var(--text)' }}>{insights.avg_labor_pct}%</strong> labor
                      </span>
                    )}
                  </div>

                  {insights.insights?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      {insights.insights.map((ins, i) => (
                        <div key={i} className="alert alert-warning" style={{ marginBottom: 6, fontSize: 12 }}>
                          {ins.message}
                        </div>
                      ))}
                    </div>
                  )}

                  {(insights.by_dow || []).length > 0 && (
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart
                        data={(insights.by_dow || []).map(d => {
                          const ratio = d.labor_pct != null && insights.avg_labor_pct
                            ? d.labor_pct / insights.avg_labor_pct : null
                          return {
                            ...d,
                            flag: ratio === null ? 'no-data' : ratio >= 1.25 ? 'over' : ratio <= 0.75 ? 'under' : 'normal',
                          }
                        })}
                        margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                        <XAxis dataKey="dow" tick={cs.axis} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={v => `${v}%`} tick={cs.axis} axisLine={false} tickLine={false} width={40} />
                        <Tooltip
                          formatter={(v, _name, props) => {
                            const flag = props.payload?.flag
                            const label = flag === 'over' ? '▲ Overstaffed' : flag === 'under' ? '↑ High Revenue' : '✓ On target'
                            return [`${v}% — ${label}`, 'Labor %']
                          }}
                          {...cs.tooltip}
                        />
                        <Bar dataKey="labor_pct" radius={[4, 4, 0, 0]} maxBarSize={44}>
                          {(insights.by_dow || []).map((d, i) => {
                            const ratio = d.labor_pct != null && insights.avg_labor_pct
                              ? d.labor_pct / insights.avg_labor_pct : null
                            const color = ratio === null ? 'var(--border)'
                              : ratio >= 1.25 ? 'var(--orange)'
                              : ratio <= 0.75 ? '#29b6f6' : 'var(--green)'
                            return <Cell key={i} fill={color} />
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}

                  <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                    Labor % by day of week · based on last 90 days ·{' '}
                    <span style={{ color: 'var(--orange)' }}>▲ overstaffed</span>
                    {' · '}
                    <span style={{ color: '#29b6f6' }}>↑ high revenue</span>
                    {' · '}
                    <span style={{ color: 'var(--green)' }}>✓ on target</span>
                  </p>
                </div>
              )}

              {/* Cost by Employee — graph/table toggle */}
              {empRows.length > 0 && (
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700 }}>Cost by Employee</h3>
                    <div className="chart-toggle">
                      <button className={`btn btn-sm ${empView === 'bar' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setEmpView('bar')}>Bar</button>
                      <button className={`btn btn-sm ${empView === 'table' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setEmpView('table')}>Table</button>
                    </div>
                  </div>

                  {empView === 'bar' ? (
                    empChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={Math.max(200, empChartData.length * 38)}>
                        <BarChart data={empChartData} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} horizontal={false} />
                          <XAxis type="number" tickFormatter={dollarFmt} tick={cs.axis} axisLine={false} tickLine={false} />
                          <YAxis type="category" dataKey="name" tick={cs.axis} axisLine={false} tickLine={false} width={80} />
                          <Tooltip formatter={(v, _, p) => [dollarFmt(v), p.payload.fullName]} {...cs.tooltip} />
                          <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={28}>
                            {empChartData.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : <p className="empty-state">No employee cost data available.</p>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr><th>Employee</th><th>Cost</th><th>Share</th></tr>
                        </thead>
                        <tbody>
                          {empRows.map(([name, cost], i) => (
                            <tr key={name}>
                              <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ width: 10, height: 10, borderRadius: '50%', background: BAR_COLORS[i % BAR_COLORS.length], flexShrink: 0 }} />
                                {name}
                              </td>
                              <td>${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div className="progress-bar-bg" style={{ flex: 1, margin: 0 }}>
                                    <div className="progress-bar-fill" style={{ width: `${empTotal > 0 ? cost / empTotal * 100 : 0}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                                  </div>
                                  <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 36 }}>
                                    {empTotal > 0 ? (cost / empTotal * 100).toFixed(1) : 0}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Shift log — bottom of page */}
              <div className="expansion" style={{ marginBottom: 8 }}>
                <div className="expansion-header" onClick={() => setLogOpen(o => !o)}>
                  <span>Shift Log ({shifts.length} records)</span>
                  <span>{logOpen ? '▲' : '▼'}</span>
                </div>
                {logOpen && (
                  <div className="expansion-body" style={{ padding: '12px 16px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                      <input
                        className="input-field"
                        style={{ maxWidth: 260, marginBottom: 0 }}
                        placeholder="Search employee or role…"
                        value={logSearch}
                        onChange={e => setLogSearch(e.target.value)}
                      />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={logOtOnly} onChange={e => setLogOtOnly(e.target.checked)} />
                        Overtime only
                      </label>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {filteredShifts.length} of {shifts.length}
                      </span>
                    </div>
                    <div className="table-wrap" style={{ padding: 0 }}>
                      <table>
                        <thead>
                          <tr>
                            {['Date','Employee','Role','Dept','Sched Hrs','Actual Hrs','Rate','Cost','OT'].map(h => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredShifts.map((s, i) => (
                            <tr key={i}>
                              <td>{(s.shift_date || '').slice(0, 10)}</td>
                              <td>{s.employee_name}</td>
                              <td>{s.role}</td>
                              <td>{s.department}</td>
                              <td>{(s.scheduled_hours || 0).toFixed(2)}</td>
                              <td>{(s.actual_hours || 0).toFixed(2)}</td>
                              <td>${(s.hourly_rate || 0).toFixed(2)}</td>
                              <td>${(s.labor_cost || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td>
                                {s.is_overtime
                                  ? <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: 'rgba(245,158,11,.12)', border: '1px solid rgba(245,158,11,.3)', color: 'var(--orange)' }}>OT</span>
                                  : <span style={{ color: 'var(--border)', fontSize: 12 }}>—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
