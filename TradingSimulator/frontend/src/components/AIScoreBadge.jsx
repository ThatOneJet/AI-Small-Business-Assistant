// Small color-graded pill showing the AI's score for a symbol.
// Convention (score scale -10..+10, positive = bullish):
//   >= 6  STRONG bullish   3..6 bullish   1..3 mild   -1..1 neutral   -3..-1 mild bearish   <= -3 STRONG bearish
function grade(score) {
  if (score >= 6)  return { c: '#3ddc97',   bg: 'rgba(61,220,151,0.14)', bd: 'rgba(61,220,151,0.45)' }
  if (score >= 3)  return { c: '#5fd39a',   bg: 'rgba(95,211,154,0.12)', bd: 'rgba(95,211,154,0.36)' }
  if (score >= 1)  return { c: 'var(--t-3)', bg: 'rgba(110,122,142,0.14)', bd: 'rgba(110,122,142,0.30)' }
  if (score > -1)  return { c: 'var(--t-4)', bg: 'rgba(71,82,100,0.16)',  bd: 'rgba(71,82,100,0.30)' }
  if (score > -3)  return { c: '#ff6a6a',   bg: 'rgba(255,106,106,0.12)', bd: 'rgba(255,106,106,0.36)' }
  return { c: '#ff476f', bg: 'rgba(255,71,111,0.14)', bd: 'rgba(255,71,111,0.45)' }
}

export default function AIScoreBadge({ score, action, compact = false }) {
  if (score === null || score === undefined) return null
  const s = Number(score)
  if (Number.isNaN(s)) return null

  const g = grade(s)
  const signed = (s > 0 ? '+' : '') + s.toFixed(1)   // toFixed keeps the '-' for negatives

  return (
    <span
      title={action ? `AI ${action} · score ${signed}` : `AI score ${signed}`}
      style={{
        display: 'inline-flex', alignItems: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
        lineHeight: 1.25, letterSpacing: '0.02em',
        padding: '0 4px', borderRadius: 3,
        color: g.c, background: g.bg, border: `1px solid ${g.bd}`,
        flexShrink: 0, whiteSpace: 'nowrap',
      }}
    >
      {compact ? s.toFixed(1) : signed}
    </span>
  )
}
