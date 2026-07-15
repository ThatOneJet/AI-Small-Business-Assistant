import { useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { api } from '../../api'
import { meetsRequired, PlanGate } from '../../planGating'

function exportCsv(rows, filename) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const lines   = [
    headers.join(','),
    ...rows.map(r => headers.map(h => {
      const v = r[h] ?? ''
      return typeof v === 'string' && (v.includes(',') || v.includes('"') || v.includes('\n'))
        ? `"${v.replace(/"/g, '""')}"`
        : v
    }).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function Sales({ uid, plan, onUpgrade, range = '30' }) {
  const days = Number(range)
  const [tenders,    setTenders]    = useState({})
  const [sales,      setSales]      = useState({})
  const [loading,    setLoading]    = useState(false)
  const [logOpen,    setLogOpen]    = useState(false)
  const [tipData,    setTipData]    = useState(null)
  const [uploading,  setUploading]  = useState(null)   // 'sales' | 'tenders' | null
  const [uploadMsg,  setUploadMsg]  = useState(null)   // { ok, text }
  const salesFileRef   = useRef(null)
  const tenderFileRef  = useRef(null)

  const canPro = meetsRequired(plan, 'pro')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get(`/api/tenders/${uid}`, { days }).catch(() => ({ data: {} })),
      api.get(`/api/sales/${uid}`,   { days }).catch(() => ({ data: {} })),
    ]).then(([t, s]) => {
      setTenders(t.data || {})
      setSales(s.data || {})
      setLoading(false)
    })
  }, [uid, days])

  useEffect(() => {
    if (!canPro) return
    api.get(`/api/tips/${uid}`, { days })
      .then(r => setTipData(r.data))
      .catch(() => {})
  }, [uid, days, canPro])

  const tSummary   = tenders.summary   || {}
  const sSummary   = sales.summary     || {}
  const byType     = tenders.by_type   || {}
  const tenderRows = tenders.tenders   || []
  const salesRows  = sales.sales       || []
  const totalRev   = tSummary.total_amount || 0

  const topItems = useMemo(() => {
    const totals = {}
    salesRows.forEach(s => {
      if (s.item && s.item !== 'None')
        totals[s.item] = (totals[s.item] || 0) + (s.revenue || 0)
    })
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [salesRows])

  const hasData = tenderRows.length > 0 || salesRows.length > 0

  function handleExportTenders() {
    exportCsv(tenderRows.map(t => ({
      date:              (t.date || '').slice(0, 10),
      tender_type:       t.tender_type || '',
      amount:            (t.amount || 0).toFixed(2),
      transaction_count: t.transaction_count ?? '',
      revenue_center:    t.revenue_center || '',
    })), `tenders_${days}d.csv`)
  }

  function handleExportSales() {
    exportCsv(salesRows.map(s => ({
      date:         (s.date || '').slice(0, 10),
      item:         s.item || '',
      revenue:      (s.revenue || 0).toFixed(2),
      quantity:     s.quantity ?? '',
      category:     s.category || '',
    })), `sales_${days}d.csv`)
  }

  async function handleUpload(type, file) {
    if (!file) return
    setUploading(type)
    setUploadMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/upload/${type}/${uid}`, {
        method: 'POST', body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      let json
      try { json = await res.json() } catch { throw new Error(`Server error (${res.status})`) }
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      setUploadMsg({ ok: true, text: `Imported ${json.inserted} rows${json.skipped ? ` (${json.skipped} skipped)` : ''}` })
      setLoading(true)
      Promise.all([
        api.get(`/api/tenders/${uid}`, { days }).catch(() => ({ data: {} })),
        api.get(`/api/sales/${uid}`,   { days }).catch(() => ({ data: {} })),
      ]).then(([t, s]) => { setTenders(t.data || {}); setSales(s.data || {}); setLoading(false) })
    } catch (e) {
      setUploadMsg({ ok: false, text: e.message || 'Upload failed' })
    } finally {
      setUploading(null)
    }
  }

  async function clearData(type) {
    const nice = type === 'tenders' ? 'tender' : 'sales'
    if (!window.confirm(`Delete the uploaded ${nice} data? You can then import a replacement file.`)) return
    setUploading(type); setUploadMsg(null)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/data/${type}/${uid}`, {
        method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Delete failed')
      setUploadMsg({ ok: true, text: `Deleted ${json.deleted} ${nice} row${json.deleted === 1 ? '' : 's'}` })
      setLoading(true)
      Promise.all([
        api.get(`/api/tenders/${uid}`, { days }).catch(() => ({ data: {} })),
        api.get(`/api/sales/${uid}`,   { days }).catch(() => ({ data: {} })),
      ]).then(([t, s]) => { setTenders(t.data || {}); setSales(s.data || {}); setLoading(false) })
    } catch (e) {
      setUploadMsg({ ok: false, text: e.message || 'Delete failed' })
    } finally {
      setUploading(null)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {hasData && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button
              className="btn btn-sm"
              onClick={handleExportTenders}
              disabled={tenderRows.length === 0}
              title="Export tender data as CSV"
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Tenders CSV
            </button>
            <button
              className="btn btn-sm"
              onClick={handleExportSales}
              disabled={salesRows.length === 0}
              title="Export sales data as CSV"
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Sales CSV
            </button>
          </div>
        )}
      </div>

      {/* ── Upload section ──────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Import Excel:</span>

        <input ref={salesFileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" style={{ display: 'none' }}
          onChange={e => { handleUpload('sales', e.target.files[0]); e.target.value = '' }} />
        <button className="btn btn-sm" onClick={() => salesFileRef.current?.click()}
          disabled={uploading === 'sales'}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
          {uploading === 'sales' ? 'Importing…' : 'Sales .xlsx'}
        </button>
        {salesRows.length > 0 && (
          <button className="btn btn-sm" onClick={() => clearData('sales')} disabled={uploading === 'sales'}
            title="Delete uploaded sales data" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--err)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
            Delete
          </button>
        )}

        <input ref={tenderFileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv" style={{ display: 'none' }}
          onChange={e => { handleUpload('tenders', e.target.files[0]); e.target.value = '' }} />
        <button className="btn btn-sm" onClick={() => tenderFileRef.current?.click()}
          disabled={uploading === 'tenders'}
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
          {uploading === 'tenders' ? 'Importing…' : 'Tenders .xlsx'}
        </button>
        {tenderRows.length > 0 && (
          <button className="btn btn-sm" onClick={() => clearData('tenders')} disabled={uploading === 'tenders'}
            title="Delete uploaded tender data" style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--err)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>
            Delete
          </button>
        )}

        {uploadMsg && (
          <span style={{ fontSize: 12, color: uploadMsg.ok ? 'var(--ok)' : 'var(--err)', marginLeft: 4 }}>
            {uploadMsg.ok ? '✓' : '✗'} {uploadMsg.text}
          </span>
        )}
      </div>

      {loading && (
        <div>
          <div className="metrics-row">
            {[0,1,2,3].map(i => (
              <div key={i} className="metric-card">
                <div className="skeleton" style={{ height: 10, width: '52%', marginBottom: 10 }} />
                <div className="skeleton" style={{ height: 24, width: '65%' }} />
              </div>
            ))}
          </div>
          <div className="two-col">
            {[0,1].map(i => (
              <div key={i} className="card" style={{ minHeight: 110 }}>
                <div className="skeleton" style={{ height: 13, width: '38%', marginBottom: 16 }} />
                {[0,1,2,3].map(j => (
                  <div key={j} className="skeleton" style={{ height: 10, width: `${55+j*9}%`, marginBottom: 9 }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !hasData && (
        <p className="empty-state">No sales or tender data. Connect Oracle in the Accounts tab and click Sync Now.</p>
      )}

      {!loading && hasData && (
        <>
          <div className="metrics-row">
            {[
              { label: 'Total Revenue',    value: `$${totalRev.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'green',  border: 'var(--green)' },
              { label: 'Transactions',     value: tSummary.total_transactions ?? 0,                                         color: '',       border: null },
              { label: 'Top Tender',       value: (tSummary.top_tender_type || '—').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—', color: 'blue', border: 'var(--blue)' },
              { label: 'Top Item Revenue', value: `$${(sSummary.top_item_revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'purple', border: 'var(--accent)' },
            ].map(m => (
              <div key={m.label} className="metric-card" style={m.border ? { borderTop: `3px solid ${m.border}`, paddingTop: 13 } : undefined}>
                <div className="metric-label">{m.label}</div>
                <div className={`metric-value ${m.color || ''}`}>{m.value}</div>
              </div>
            ))}
          </div>

          <div className="two-col">
            <div className="card">
              <h3 style={{ marginBottom: 14, fontSize: 15 }}>Tender Breakdown</h3>
              {Object.entries(byType)
                .sort((a, b) => (b[1]?.amount ?? b[1]) - (a[1]?.amount ?? a[1]))
                .map(([type, info]) => {
                  const amount = info?.amount ?? info
                  const pct = totalRev > 0 ? amount / totalRev * 100 : 0
                  const label = type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                  return (
                    <div key={type} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span>
                          <span style={{ fontWeight: 600 }}>${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                          <span style={{ color: 'var(--muted)', marginLeft: 6, fontSize: 12 }}>{pct.toFixed(1)}%</span>
                        </span>
                      </div>
                      <div className="progress-bar-bg">
                        <div className="progress-bar-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                    </div>
                  )
                })}
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 14, fontSize: 15, fontWeight: 700 }}>Top Items by Revenue</h3>
              {topItems.length > 0 ? (() => {
                const topTotal = topItems.reduce((s, [, r]) => s + r, 0)
                return (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Item</th><th>Revenue</th><th>Share</th></tr></thead>
                      <tbody>
                        {topItems.map(([name, rev]) => {
                          const pct = topTotal > 0 ? rev / topTotal * 100 : 0
                          return (
                            <tr key={name}>
                              <td style={{ fontWeight: 500 }}>{name}</td>
                              <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>${rev.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                              <td style={{ minWidth: 100 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                  <div className="progress-bar-bg" style={{ flex: 1, margin: 0 }}>
                                    <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 34, textAlign: 'right' }}>
                                    {pct.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })() : (
                <p className="empty-state">No item-level data available.</p>
              )}
            </div>
          </div>

          {/* ── Tip Analysis — Pro+ ─────────────────────────────────────────── */}
          {!canPro ? (
            <div style={{ marginBottom: 20 }}>
              <PlanGate plan={plan} requiredPlan="pro" feature="Tip Analysis" onUpgrade={onUpgrade} />
            </div>
          ) : tipData && (
            <div className="card" style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Tip Analysis</h3>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                Tip and gratuity tender lines detected from Oracle data
              </p>
              {!tipData.has_tip_data ? (
                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  No tip/gratuity tender types found in this period. Oracle must include "tip", "gratuity", or "service charge" tender lines.
                </p>
              ) : (
                <>
                  <div className="metrics-row" style={{ marginBottom: 20 }}>
                    <div className="metric-card" style={{ borderTop: '3px solid var(--green)', paddingTop: 13 }}>
                      <div className="metric-label">Total Tips</div>
                      <div className="metric-value green">
                        ${(tipData.total_tips || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                    <div className="metric-card" style={{ borderTop: '3px solid var(--blue)', paddingTop: 13 }}>
                      <div className="metric-label">Tip Rate</div>
                      <div className="metric-value blue">
                        {tipData.tip_pct != null ? `${tipData.tip_pct.toFixed(1)}%` : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>of food & bev revenue</div>
                    </div>
                    <div className="metric-card">
                      <div className="metric-label">Tipped Revenue</div>
                      <div className="metric-value">
                        ${(tipData.non_tip_revenue || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </div>
                  {tipData.daily?.length > 1 && (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={tipData.daily} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false}
                          tickFormatter={d => d.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} axisLine={false} tickLine={false}
                          tickFormatter={v => `$${v.toLocaleString()}`} width={60} />
                        <Tooltip
                          formatter={v => [`$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, 'Tips']}
                          contentStyle={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 8 }}
                          labelStyle={{ fontWeight: 600 }}
                        />
                        <Bar dataKey="tips" fill="#3fb950" radius={[3, 3, 0, 0]} maxBarSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </>
              )}
            </div>
          )}

          {tenderRows.length > 0 && (
            <div className="expansion">
              <div className="expansion-header" onClick={() => setLogOpen(o => !o)}>
                <span>Tender Log ({tenderRows.length} records)</span>
                <span className={`expansion-chevron${logOpen ? ' open' : ''}`}>▼</span>
              </div>
              <div className={`expansion-body-grid${logOpen ? ' open' : ''}`}>
                <div>
                  <div className="expansion-body">
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr><th>Date</th><th>Type</th><th>Amount</th><th>Transactions</th><th>Revenue Center</th></tr>
                        </thead>
                        <tbody>
                          {tenderRows.map((t, i) => (
                            <tr key={i}>
                              <td>{(t.date || '').slice(0, 10)}</td>
                              <td>{(t.tender_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
                              <td>${(t.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td>{t.transaction_count}</td>
                              <td>{t.revenue_center}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
