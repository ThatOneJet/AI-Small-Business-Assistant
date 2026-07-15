import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell,
} from 'recharts'
import { api } from '../../api'
import UploadButton from './UploadButton'

const STAR_COLORS = { 5: '#3fb950', 4: '#7bc96f', 3: '#d29922', 2: '#f0883e', 1: '#e5534b' }

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

const Stars = ({ n }) => (
  <span style={{ color: '#d29922', letterSpacing: 1 }}>{'★'.repeat(Math.round(n))}<span style={{ color: 'var(--border)' }}>{'★'.repeat(5 - Math.round(n))}</span></span>
)

export default function Reviews({ uid, range = '0' }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [reload,  setReload]  = useState(0)
  const cs = chartStyle()

  useEffect(() => {
    setLoading(true)
    const params = (range && range !== '0') ? { days: range } : {}
    api.get(`/api/reviews/${uid}`, params)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [uid, range, reload])

  const s       = data?.summary || {}
  const dist    = data?.distribution || {}
  const distBar = [5, 4, 3, 2, 1].map(k => ({ stars: `${k}★`, count: dist[k] || 0, k }))
  const byProd  = data?.by_product || []
  const rows    = data?.reviews || []
  const hasData = rows.length > 0
  const avg     = s.avg_rating || 0

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <UploadButton type="reviews" uid={uid} label="Import reviews" hasData={hasData} onDone={() => setReload(r => r + 1)} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>CSV/Excel with date, product, rating, review_text</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>
      ) : !hasData ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
          No reviews yet — import a reviews export to see average rating, star distribution, and your best/worst products.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <Kpi label="Average rating" value={<span>{avg.toFixed(2)} <span style={{ fontSize: 14 }}><Stars n={avg} /></span></span>}
                 color={avg >= 4 ? 'var(--ok)' : avg >= 3 ? '#d29922' : 'var(--err)'} />
            <Kpi label="Reviews"  value={s.count} />
            <Kpi label="Positive" value={`${s.positive_pct}%`} sub="4–5 stars" color="var(--ok)" />
            <Kpi label="Best product"  value={byProd[byProd.length - 1]?.product || '—'} sub={byProd.length ? `${byProd[byProd.length - 1].avg}★` : ''} color="var(--ok)" />
            <Kpi label="Worst product" value={byProd[0]?.product || '—'} sub={byProd.length ? `${byProd[0].avg}★` : ''} color="var(--err)" />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div className="card" style={{ padding: 16, flex: 1, minWidth: 300 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Star distribution</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={distBar} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} horizontal={false} />
                  <XAxis type="number" tick={cs.axis} allowDecimals={false} />
                  <YAxis type="category" dataKey="stars" tick={cs.axis} width={32} />
                  <Tooltip {...cs.tooltip} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {distBar.map(d => <Cell key={d.k} fill={STAR_COLORS[d.k]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card" style={{ padding: 16, flex: 1, minWidth: 300 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Rating by product</div>
              {byProd.slice().reverse().map(p => (
                <div key={p.product} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                  <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product}</span>
                  <span style={{ fontSize: 12 }}><Stars n={p.avg} /></span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, width: 34, textAlign: 'right' }}>{p.avg}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', width: 46, textAlign: 'right' }}>({p.count})</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Recent reviews</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.slice(0, 30).map((r, i) => (
                <div key={i} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <Stars n={r.rating} />
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.product || r.sku}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>{(r.date || '').slice(0, 10)}</span>
                  </div>
                  {r.review_text && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{r.review_text}</div>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
