// Placeholder shown when a data tab is empty — faded ghost KPIs + a demo chart
// behind a centered call-to-action, so the page looks designed (and demos well).
// Fills the tab body to the screen edge (background bleeds off-screen, no scroll)
// via the .empty-fill / .empty-card hooks in index.css.

const SAMPLE = [42, 58, 35, 72, 50, 66, 44, 78, 55, 63, 48, 70]

function GhostChart() {
  const max = Math.max(...SAMPLE)
  const pts = SAMPLE.map((v, i) => `${i * 40 + 20},${170 - (v / max) * 140}`).join(' ')
  return (
    // Absolutely fills the card and stretches to its height, so it bleeds at the
    // edges however tall the empty state grows.
    <svg viewBox="0 0 480 180" preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.4, display: 'block' }}>
      {[0, 1, 2, 3].map(g => (
        <line key={g} x1="0" x2="480" y1={g * 45 + 12} y2={g * 45 + 12} stroke="var(--border)" strokeWidth="1" />
      ))}
      {SAMPLE.map((v, i) => {
        const h = (v / max) * 140
        return <rect key={i} x={i * 40 + 9} y={170 - h} width="22" height={h} rx="3" fill="var(--acc-hi, #ff6161)" opacity="0.3" />
      })}
      <polyline points={pts} fill="none" stroke="var(--acc-hi, #ff6161)" strokeWidth="2" opacity="0.55" />
    </svg>
  )
}

export default function EmptyState({ title, message, kpis = [], children }) {
  return (
    <div className="empty-fill">
      {kpis.length > 0 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14, flex: '0 0 auto' }}>
          {kpis.map((k, i) => (
            <div key={i} className="card" style={{ flex: 1, minWidth: 130, padding: '14px 16px', opacity: 0.5 }}>
              <div style={{ height: 8, width: '55%', borderRadius: 4, background: 'var(--border)', marginBottom: 12 }} />
              <div style={{ height: 20, width: '72%', borderRadius: 4, background: 'var(--hairline-3, rgba(140,170,220,.22))' }} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 9 }}>{k}</div>
            </div>
          ))}
        </div>
      )}
      <div className="card empty-card" style={{ position: 'relative', padding: 20, minHeight: 230, overflow: 'hidden' }}>
        <GhostChart />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 10, padding: 16,
          background: 'radial-gradient(ellipse 60% 55% at center, var(--bg-card) 45%, transparent 100%)',
        }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 440, lineHeight: 1.55 }}>{message}</div>
          {children && <div style={{ marginTop: 4 }}>{children}</div>}
        </div>
      </div>
    </div>
  )
}
