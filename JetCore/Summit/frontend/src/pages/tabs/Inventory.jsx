import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell,
} from 'recharts'
import { api } from '../../api'
import UploadButton from './UploadButton'
import EmptyState from './EmptyState'
import CameraScan from './CameraScan'

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
    <div className="card" style={{ padding: '14px 16px', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function Inventory({ uid }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [reload,  setReload]  = useState(0)
  const [scanOpen, setScanOpen] = useState(false)
  const cs = chartStyle()

  useEffect(() => {
    setLoading(true)
    api.get(`/api/inventory/${uid}`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [uid, reload])

  // The guided tour opens/closes the scanner via a window event.
  useEffect(() => {
    const onScan = e => setScanOpen(e.detail === 'open')
    window.addEventListener('summit-scan', onScan)
    return () => window.removeEventListener('summit-scan', onScan)
  }, [])

  const s        = data?.summary || {}
  const items    = data?.items || []
  const low      = data?.low_stock || []
  const hasData  = items.length > 0
  const valueBar = [...items].sort((a, b) => b.stock_value - a.stock_value).slice(0, 10)
    .map(i => ({ name: i.product, value: i.stock_value }))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <UploadButton type="inventory" uid={uid} label="Import inventory" hasData={hasData} onDone={() => setReload(r => r + 1)} />
        <button className="btn btn-primary btn-sm" data-tour="scan" onClick={() => setScanOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
          </svg>
          Scan &amp; count
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Import a CSV, or enroll products by photo and count them with the webcam</span>
      </div>

      {scanOpen && <CameraScan uid={uid} onClose={() => setScanOpen(false)} onApplied={() => setReload(r => r + 1)} />}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>
      ) : !hasData ? (
        <EmptyState title="No inventory yet" kpis={['Value at cost', 'SKUs', 'Low stock']}
          message="Import a stock snapshot (sku, product, unit_cost, unit_price, stock_qty, reorder_level) to see valuation, per-SKU margins, and low-stock alerts." />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <Kpi label="SKUs"             value={s.sku_count} />
            <Kpi label="Units in stock"   value={(s.total_units || 0).toLocaleString()} />
            <Kpi label="Inventory value"  value={money(s.inventory_value)} sub="at cost" />
            <Kpi label="Retail value"     value={money(s.retail_value)} sub="at sell price" />
            <Kpi label="Potential profit" value={money(s.potential_profit)} color="var(--ok)" />
            <Kpi label="Low stock"        value={s.low_stock_count} color={s.low_stock_count ? 'var(--err)' : 'var(--ok)'} />
          </div>

          {low.length > 0 && (
            <div className="card" style={{ padding: 16, marginBottom: 16, border: '1px solid rgba(229,83,75,0.4)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--err)' }}>
                ⚠ {low.length} item{low.length === 1 ? '' : 's'} at or below reorder level
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {low.map(i => (
                  <div key={i.sku || i.product} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(229,83,75,0.08)', fontSize: 12.5 }}>
                    <div style={{ fontWeight: 600 }}>{i.product}</div>
                    <div style={{ color: 'var(--muted)' }}>{i.stock_qty} left · reorder at {i.reorder_level}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Stock value by product (at cost)</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={valueBar} margin={{ top: 4, right: 10, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={cs.grid} vertical={false} />
                <XAxis dataKey="name" tick={cs.axis} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={cs.axis} tickFormatter={v => '$' + v} />
                <Tooltip {...cs.tooltip} formatter={v => money(v)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {valueBar.map((_, i) => <Cell key={i} fill="#58a6ff" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>All items</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '6px 8px' }}>SKU</th><th style={{ padding: '6px 8px' }}>Product</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cost</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Price</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Margin</th><th style={{ padding: '6px 8px', textAlign: 'right' }}>Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: r.low_stock ? 'rgba(229,83,75,0.06)' : 'transparent' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--muted)', fontFamily: 'monospace' }}>{r.sku || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{r.product}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.unit_cost)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{money(r.unit_price)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--ok)' }}>{r.margin_pct}%</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: r.low_stock ? 'var(--err)' : 'inherit' }}>{r.stock_qty}</td>
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
