import { useEffect, useState } from 'react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Cell,
} from 'recharts'
import { api } from '../../api'
import UploadButton from './UploadButton'
import EmptyState from './EmptyState'

const BAR_COLORS = ['#e5534b', '#3fb950', '#d29922', '#58a6ff', '#a371f7', '#ec4899', '#14b8a6', '#f78166']
const money = n => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function chartStyle() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  return {
    tooltip: { contentStyle: { background: dark ? '#161b22' : '#fff', border: `1px solid ${dark ? '#30363d' : '#d0d7de'}`, borderRadius: 8 },
      labelStyle: { color: dark ? '#e6edf3' : '#1f2328', fontWeight: 600 }, itemStyle: { color: dark ? '#8b949e' : '#656d76' } },
    axis: { fill: dark ? '#8b949e' : '#656d76', fontSize: 11 },
    grid: dark ? '#30363d' : '#d0d7de',
  }
}

function Kpi({ label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: '14px 16px', flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function Expenses({ uid, range = '0' }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [reload,  setReload]  = useState(0)
  const cs = chartStyle()

  useEffect(() => {
    setLoading(true)
    const params = (range && range !== '0') ? { days: range } : {}
    api.get(`/api/expenses/${uid}`, params)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [uid, range, reload])

  const s        = data?.summary || {}
  const catData  = Object.entries(data?.by_category || {}).map(([name, amount]) => ({ name, amount }))
  const vendData = Object.entries(data?.by_vendor || {}).map(([name, amount]) => ({ name, amount }))
  const monthly  = data?.monthly || []
  const rows     = data?.expenses || []
  const topCat   = catData[0]?.name || '—'
  const hasData  = rows.length > 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <UploadButton type="expenses" uid={uid} label="Import expenses" hasData={hasData} onDone={() => setReload(r => r + 1)} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>CSV/Excel with date, category, vendor, amount</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>
      ) : !hasData ? (
        <EmptyState title="No expenses yet" kpis={['Total spend', 'Entries', 'Top category']}
          message="Import an expense report (date, category, vendor, amount) and this fills with spend by category, your top vendors, and the monthly trend." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <Kpi label="Total spend"  value={money(s.total)} color="var(--err)" />
            <Kpi label="Expenses"     value={s.count} />
            <Kpi label="Avg expense"  value={money(s.avg)} />
            <Kpi label="Top category" value={topCat} sub={money(catData[0]?.amount)} />
          </div>

          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Spend by category</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={catData} margin={{ top: 4, right: 10, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                <XAxis dataKey="name" tick={cs.axis} />
                <YAxis tick={cs.axis} tickFormatter={v => '$' + v} />
                <Tooltip {...cs.tooltip} formatter={v => money(v)} />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                  {catData.map((e, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="card" style={{ padding: 16, flex: 1, minWidth: 300 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Monthly trend</div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={monthly} margin={{ top: 4, right: 10, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                  <XAxis dataKey="month" tick={cs.axis} />
                  <YAxis tick={cs.axis} tickFormatter={v => '$' + v} />
                  <Tooltip {...cs.tooltip} formatter={v => money(v)} />
                  <Line type="monotone" dataKey="amount" stroke="#e5534b" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="card" style={{ padding: 16, flex: 1, minWidth: 300 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Top vendors</div>
              {vendData.map((v, i) => (
                <div key={v.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: BAR_COLORS[i % BAR_COLORS.length], flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{money(v.amount)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Recent expenses</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '6px 8px' }}>Date</th><th style={{ padding: '6px 8px' }}>Category</th>
                    <th style={{ padding: '6px 8px' }}>Vendor</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 40).map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{(r.date || '').slice(0, 10)}</td>
                      <td style={{ padding: '6px 8px' }}>{r.category}</td>
                      <td style={{ padding: '6px 8px' }}>{r.vendor || '—'}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
