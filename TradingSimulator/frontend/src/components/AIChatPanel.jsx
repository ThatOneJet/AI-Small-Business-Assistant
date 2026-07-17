import { useEffect, useRef, useState } from 'react'
import api from '../api.js'

// Chat with the trading AI about its OWN decisions. Grounded on the backend model's
// real read of the current symbol (POST /api/ai/chat), so answers cite actual scores.

const SUGGESTIONS = [
  'Why this call?',
  'What would make you buy?',
  'Biggest risks here?',
  'How confident are you, and why?',
]

export default function AIChatPanel({ symbol, portfolioId }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ]       = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function ask(text) {
    const question = (text ?? q).trim()
    if (!question || busy) return
    setMsgs(m => [...m, { role: 'you', text: question }])
    setQ(''); setBusy(true)
    try {
      const pid = portfolioId || localStorage.getItem('portfolioId') || 2
      const r = await api.post('/ai/chat', { question, symbol, portfolio_id: pid }, { timeout: 120000 })
      setMsgs(m => [...m, { role: 'ai', text: r.data?.answer || 'No answer.', llm: r.data?.llm_used }])
    } catch {
      setMsgs(m => [...m, { role: 'ai', text: 'Could not reach the AI right now.' }])
    } finally { setBusy(false) }
  }

  return (
    <div style={{
      marginTop: 12, border: '1px solid rgba(140,170,220,0.10)', borderRadius: 10,
      background: 'rgba(10,13,20,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 11px', borderBottom: '1px solid rgba(140,170,220,0.08)' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#b39dff', boxShadow: '0 0 7px #b39dff' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t-2)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Ask the AI
        </span>
        {symbol && <span style={{ fontSize: 9.5, color: 'var(--t-4)', fontFamily: 'var(--font-mono)' }}>about {symbol}</span>}
      </div>

      <div style={{ maxHeight: 260, overflowY: 'auto', padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msgs.length === 0 && (
          <div style={{ fontSize: 11.5, color: 'var(--t-4)', lineHeight: 1.6 }}>
            Ask why the AI made a call — it answers from its own live read of {symbol || 'the market'}.
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => ask(s)} style={{
                  padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                  fontSize: 10, color: 'var(--t-2)', background: 'rgba(140,170,220,0.06)',
                  border: '1px solid rgba(140,170,220,0.15)', fontFamily: 'var(--font-sans)',
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'you' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '88%', whiteSpace: 'pre-wrap', lineHeight: 1.55, fontSize: 12,
              padding: '7px 10px', borderRadius: 9,
              background: m.role === 'you' ? 'rgba(179,157,255,0.14)' : 'rgba(140,170,220,0.07)',
              color: m.role === 'you' ? 'var(--t-1)' : 'var(--t-2)',
              border: `1px solid ${m.role === 'you' ? 'rgba(179,157,255,0.25)' : 'rgba(140,170,220,0.10)'}`,
            }}>{m.text}</div>
          </div>
        ))}
        {busy && (
          <div style={{ fontSize: 11, color: 'var(--t-4)', fontFamily: 'var(--font-mono)' }}>thinking…</div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={e => { e.preventDefault(); ask() }}
        style={{ display: 'flex', gap: 6, padding: '8px 11px', borderTop: '1px solid rgba(140,170,220,0.08)' }}>
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder={`Ask about ${symbol || 'a decision'}…`}
          style={{
            flex: 1, padding: '7px 10px', borderRadius: 7, fontSize: 12, outline: 'none',
            background: 'rgba(10,13,20,0.8)', color: 'var(--t-1)', border: '1px solid rgba(140,170,220,0.15)',
          }} />
        <button type="submit" disabled={busy || !q.trim()} style={{
          padding: '7px 13px', borderRadius: 7, cursor: busy || !q.trim() ? 'default' : 'pointer',
          fontSize: 11, fontWeight: 700, border: 'none',
          background: busy || !q.trim() ? 'rgba(179,157,255,0.2)' : '#b39dff', color: '#0a0d14',
        }}>Send</button>
      </form>
    </div>
  )
}
