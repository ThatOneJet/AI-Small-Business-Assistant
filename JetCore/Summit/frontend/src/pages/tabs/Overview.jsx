import { useEffect, useState } from 'react'
import { api } from '../../api'
import AIOptimize from './AIOptimize'
import BusinessProfile from './BusinessProfile'
import AskAI from './AskAI'

const money = n => '$' + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
const money2 = n => '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Each dashboard card maps a summary key → the tab it links to + the KPIs to show.
// A card only renders when its summary entry is present (data has been uploaded).
const CARDS = [
  { key: 'sales', tab: 'Sales', title: 'Sales', accent: '#3fb950',
    kpis: s => [['Revenue', money2(s.revenue)], ['Orders', s.orders], ['Line items', s.count]] },
  { key: 'expenses', tab: 'Expenses', title: 'Expenses', accent: '#e5534b',
    kpis: s => [['Total spend', money2(s.total)], ['Entries', s.count]] },
  { key: 'inventory', tab: 'Inventory', title: 'Inventory', accent: '#58a6ff',
    kpis: s => [['Value at cost', money2(s.value)], ['SKUs', s.count], ['Low stock', s.low_stock]] },
  { key: 'reviews', tab: 'Reviews', title: 'Reviews', accent: '#d29922',
    kpis: s => [['Avg rating', `${s.avg}★`], ['Reviews', s.count]] },
  { key: 'labor', tab: 'Labor', title: 'Labor', accent: '#a371f7',
    kpis: s => [['Cost', money2(s.cost)], ['Hours', s.hours], ['Shifts', s.shifts]] },
]

function StatCard({ card, data, onNavigate }) {
  return (
    <div className="card" onClick={() => onNavigate?.(card.tab)}
      style={{ padding: 18, cursor: 'pointer', borderLeft: `3px solid ${card.accent}`, transition: 'transform .1s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{card.title}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>View →</span>
      </div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        {card.kpis(data).map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Overview({ uid, onNavigate }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [profileV, setProfileV] = useState(0)   // bumps when the business profile is saved

  useEffect(() => {
    setLoading(true)
    api.get(`/api/summary/${uid}`)
      .then(r => setSummary(r.data || {}))
      .catch(() => setSummary({}))
      .finally(() => setLoading(false))
  }, [uid])

  const present = CARDS.filter(c => summary && summary[c.key])
  const empty = !loading && present.length === 0

  return (
    <div>
      {/* Business profile — context that tailors the AI's benchmarks & priorities */}
      <BusinessProfile uid={uid} onSaved={() => setProfileV(v => v + 1)} />

      {/* AI optimization — analyzes every section, types out recommendations */}
      <AIOptimize uid={uid} refreshKey={profileV} />

      {/* Ask the AI — data-grounded chat for deeper dives */}
      <AskAI uid={uid} />

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner" /></div>
      ) : empty ? (
        <div className="card" style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No data yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>
            Import your files to build the dashboard — each one you upload appears here.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {CARDS.map(c => (
              <button key={c.key} className="btn btn-sm" onClick={() => onNavigate?.(c.tab)}>
                Import {c.title.toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div data-tour="cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {present.map(c => (
            <StatCard key={c.key} card={c} data={summary[c.key]} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}
