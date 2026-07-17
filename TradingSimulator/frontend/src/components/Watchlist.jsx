import { useState, useEffect } from 'react'
import api from '../api.js'
import SymbolSearch from './SymbolSearch.jsx'
import AIScoreBadge from './AIScoreBadge.jsx'

export default function Watchlist({ active, onSelect, socket, onWatchlistChange, portfolioId, onPrioritySymbol }) {
  const [items, setItems]       = useState([])
  const [aiMap, setAiMap]       = useState({})   // symbol -> { score, action, confidence }
  const [sortByAI, setSortByAI] = useState(false)
  const isReal = portfolioId === 0
  const pid    = portfolioId ?? 1

  function load(triggerPriority = false) {
    api.get(`/watchlist?portfolio_id=${pid}`).then(r => {
      setItems(r.data)
      if (onWatchlistChange) onWatchlistChange(r.data.map(it => it.symbol))
      if (triggerPriority && onPrioritySymbol) {
        const hit = r.data.find(it => it.priority)
        if (hit) onPrioritySymbol(hit.symbol)
      }
    }).catch(() => {})
  }

  // triggerPriority=true only on portfolio switch, not on periodic refresh
  useEffect(() => {
    load(true)
    const id = setInterval(() => load(false), 10000)
    return () => clearInterval(id)
  }, [pid])

  useEffect(() => {
    if (!socket) return
    const handler = ({ symbol, bid, ask }) => {
      const newPrice = (bid + ask) / 2
      setItems(prev => prev.map(it => {
        if (it.symbol !== symbol) return it
        const dir = it.price != null ? (newPrice > it.price ? 'up' : newPrice < it.price ? 'down' : null) : null
        return { ...it, price: newPrice, tickDir: dir }
      }))
      setTimeout(() => {
        setItems(prev => prev.map(it => it.symbol === symbol ? { ...it, tickDir: null } : it))
      }, 650)
    }
    socket.on('quote', handler)
    return () => socket.off('quote', handler)
  }, [socket])

  // Batch-fetch AI opinions for the visible symbols (refresh ~20s).
  // Endpoint may not exist yet -> .catch leaves badges hidden, never crashes.
  const symbolsKey = items.map(it => it.symbol).join(',')
  useEffect(() => {
    if (!symbolsKey) { setAiMap({}); return }
    let cancelled = false
    const fetchOpinions = () => {
      api.get('/ai/opinions', { params: { symbols: symbolsKey, portfolio_id: pid } })
        .then(r => { if (!cancelled) setAiMap(r.data || {}) })
        .catch(() => {})
    }
    fetchOpinions()
    const id = setInterval(fetchOpinions, 20000)
    return () => { cancelled = true; clearInterval(id) }
  }, [symbolsKey, pid])

  async function removeSymbol(sym, e) {
    e.stopPropagation()
    await api.post('/watchlist', { action: 'remove', symbol: sym, portfolio_id: pid })
    load(false)
  }

  async function togglePriority(sym, e) {
    e.stopPropagation()
    await api.post('/watchlist', { action: 'priority', symbol: sym, portfolio_id: pid })
    load(false)
  }

  // Optional "sort by AI" — only reorders when the toggle is on AND we have data (else untouched order).
  const hasAI = Object.keys(aiMap).length > 0
  const rows = (sortByAI && hasAI)
    ? [...items].sort((a, b) => (aiMap[b.symbol]?.score ?? -Infinity) - (aiMap[a.symbol]?.score ?? -Infinity))
    : items

  return (
    <div className="watchlist">
      <div className="wl-header" style={{ display: 'flex', alignItems: 'center' }}>
        <span>Watchlist</span>
        {isReal && (
          <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--ok)', fontFamily: 'var(--font-mono)', opacity: 0.8 }}>
            REAL
          </span>
        )}
        <button
          onClick={() => setSortByAI(v => !v)}
          title={sortByAI ? 'Sorting by AI score — click for default order' : 'Sort by AI score'}
          style={{
            marginLeft: 'auto', cursor: 'pointer', background: sortByAI ? 'var(--acc-soft)' : 'none',
            border: `1px solid ${sortByAI ? 'var(--acc-line)' : 'rgba(140,170,220,0.15)'}`,
            color: sortByAI ? 'var(--acc)' : 'var(--t-3)',
            borderRadius: 3, padding: '1px 5px', fontSize: 8.5, fontWeight: 600,
            fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'none',
          }}
        >
          AI ↓
        </button>
      </div>
      {!isReal && (
        <div className="wl-search">
          <SymbolSearch
            onSelect={async (asset) => {
              await api.post('/watchlist', { action: 'add', symbol: asset.symbol, portfolio_id: pid })
              load(false)
            }}
            placeholder="Add to watchlist…"
          />
        </div>
      )}
      <div className="wl-items">
        {rows.map(it => (
          <div
            key={it.symbol}
            className={`wl-item${it.symbol === active ? ' active' : ''}`}
            onClick={() => onSelect(it.symbol)}
          >
            {!isReal && (
              <button
                className={`wl-priority-btn${it.priority ? ' on' : ''}`}
                onClick={e => togglePriority(it.symbol, e)}
                title={it.priority ? 'Priority — click to remove' : 'Set as priority (auto-navigates on portfolio switch)'}
              >
                {it.priority ? '★' : '☆'}
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
              <span className="wl-sym" style={{ flex: '0 0 auto' }}>{it.symbol}</span>
              <AIScoreBadge score={aiMap[it.symbol]?.score} action={aiMap[it.symbol]?.action} />
            </div>
            <span className={`wl-price mono${it.change_pct >= 0 ? ' price-up' : ' price-down'}${it.tickDir ? ` tick-${it.tickDir}` : ''}`}>
              {it.price ? `$${Number(it.price).toFixed(2)}` : '—'}
            </span>
            {it.price && it.change_pct !== undefined && (
              <span className={`wl-chg ${it.change_pct >= 0 ? 'ok' : 'err'}`}>
                {it.change_pct >= 0 ? '+' : ''}{Number(it.change_pct).toFixed(2)}%
              </span>
            )}
            {!isReal && (
              <button className="wl-rm" onClick={e => removeSymbol(it.symbol, e)}>×</button>
            )}
          </div>
        ))}
        {isReal && items.length === 0 && (
          <div style={{ padding: '12px 14px', fontSize: 11, color: 'var(--t-3)' }}>
            No holdings found. Add real holdings in the Holdings tab.
          </div>
        )}
      </div>
    </div>
  )
}
