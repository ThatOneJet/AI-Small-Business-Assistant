import { useState, useEffect, useRef } from 'react'

const MAX_LINES = 20

function tradeColor(side) {
  return side === 'buy' ? 'var(--ok)' : 'var(--err)'
}
function activityColor(phase) {
  if (phase === 'enter') return 'var(--ok)'
  if (phase === 'exit')  return 'var(--err)'
  return 'var(--t-3)'
}

export default function AIActivityTicker({ socket, onSelectSymbol }) {
  const [lines, setLines] = useState([])
  const idRef = useRef(0)

  useEffect(() => {
    if (!socket) return

    const push = (line) => {
      idRef.current += 1
      const entry = { ...line, _id: idRef.current }
      setLines(prev => [entry, ...prev].slice(0, MAX_LINES))
    }

    const onActivity = (d) => {
      if (!d) return
      push({
        symbol: d.symbol,
        color: activityColor(d.phase),
        text: d.text || `${(d.phase || 'scan').toUpperCase()} ${d.symbol || ''}`.trim(),
      })
    }

    const onTrade = (d) => {
      if (!d) return
      const side  = String(d.side || '').toLowerCase()
      const price = d.price != null ? `$${Number(d.price).toFixed(2)}` : '—'
      const reason = d.reason ? ` — ${d.reason}` : ''
      push({
        symbol: d.symbol,
        color: tradeColor(side),
        text: `${side.toUpperCase()} ${d.shares ?? ''} ${d.symbol || ''} @ ${price}${reason}`,
      })
    }

    socket.on('ai_activity', onActivity)
    socket.on('ai_trade', onTrade)
    return () => {
      socket.off('ai_activity', onActivity)
      socket.off('ai_trade', onTrade)
    }
  }, [socket])

  const renderLine = (line, keyPrefix) => (
    <span
      key={`${keyPrefix}-${line._id}`}
      onClick={() => line.symbol && onSelectSymbol?.(line.symbol)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        marginRight: 24, flexShrink: 0,
        cursor: (line.symbol && onSelectSymbol) ? 'pointer' : 'default',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: line.color, boxShadow: `0 0 6px ${line.color}`,
      }} />
      <span style={{ color: line.color, fontSize: 11 }}>{line.text}</span>
      <span style={{ color: 'var(--hairline-3)', marginLeft: 4 }}>|</span>
    </span>
  )

  return (
    <div className="ticker-outer">
      <div className="ticker-live-badge" style={{ color: 'var(--cy)' }}>
        <span className="ticker-dot" style={{ background: 'var(--cy)' }} />
        AI
      </div>
      <div className="ticker-track">
        {lines.length === 0 ? (
          <span style={{
            paddingLeft: 12, fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--t-3)', whiteSpace: 'nowrap',
          }}>
            AI standing by — waiting for activity…
          </span>
        ) : (
          <div className="ticker-inner" style={{ animationDuration: '45s' }}>
            {lines.map(l => renderLine(l, 'a'))}
            {lines.map(l => renderLine(l, 'b'))}
          </div>
        )}
      </div>
    </div>
  )
}
