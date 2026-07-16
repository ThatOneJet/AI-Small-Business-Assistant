import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'

// Render inline **bold** within a line.
function inline(text, keyBase) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p)
      ? <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>
      : <span key={`${keyBase}-${i}`}>{p}</span>)
}

// Lightweight markdown → JSX for chat answers (headers, bullets, bold, follow-up).
function renderMarkdown(text) {
  const lines = String(text || '').split('\n')
  return lines.map((raw, i) => {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) return <div key={i} style={{ height: 6 }} />
    const h = line.match(/^#{1,6}\s+(.*)$/)
    if (h) return <div key={i} style={{ fontWeight: 700, marginTop: 6 }}>{inline(h[1], i)}</div>
    const b = line.match(/^\s*[-*•]\s+(.*)$/)
    if (b) return (
      <div key={i} style={{ display: 'flex', gap: 7, paddingLeft: 2 }}>
        <span style={{ color: 'var(--acc-hi,#ff6161)' }}>•</span>
        <span style={{ flex: 1 }}>{inline(b[1], i)}</span>
      </div>
    )
    const deeper = line.match(/^To go deeper:\s*(.*)$/i)
    if (deeper) return (
      <div key={i} style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--border)', fontStyle: 'italic', color: 'var(--acc-hi,#ff6161)' }}>
        {inline(line, i)}
      </div>
    )
    return <div key={i}>{inline(line, i)}</div>
  })
}

const SUGGESTIONS = [
  'How can I grow sales?',
  "Where's my money going?",
  'Which products should I reorder?',
  'Is my marketing spend too high?',
  'What should I focus on first?',
  'How are my margins?',
]

export default function AskAI({ uid }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([])   // {role:'you'|'ai', text}
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)   // topic the AI asked us to clarify
  const [llmOn, setLlmOn] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])
  useEffect(() => {
    api.get('/api/llm/status').then(r => setLlmOn(!!r.data.connected)).catch(() => setLlmOn(false))
  }, [])

  async function ask(text) {
    const question = (text ?? q).trim()
    if (!question || busy) return
    const history = msgs.slice(-6)   // recent turns for the LLM's context
    setMsgs(m => [...m, { role: 'you', text: question }])
    setQ(''); setBusy(true)
    try {
      const r = await api.post(`/api/ask/${uid}`, { question, pending, history }, { timeout: 120000 })
      setPending(r.data.pending || null)
      setMsgs(m => [...m, { role: 'ai', text: r.data.answer || 'No answer.' }])
    } catch {
      setMsgs(m => [...m, { role: 'ai', text: 'Sorry — I couldn’t reach the server.' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" data-tour="chat" style={{ padding: '14px 16px', marginBottom: 14 }}>
      <style>{`@keyframes aibounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}} .ai-dot{width:6px;height:6px;border-radius:50%;background:var(--acc-hi,#ff6161);display:inline-block;animation:aibounce 1.2s infinite ease-in-out}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--acc-hi, #ff6161)' }}>
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Ask the AI</span>
        <span title={llmOn ? 'Local LLM online — full reasoning' : 'Rule-based mode (LLM offline)'}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: llmOn ? 'var(--ok, #3fb950)' : 'var(--muted)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: llmOn ? 'var(--ok, #3fb950)' : 'var(--muted)' }} />
          {llmOn ? 'AI model online' : 'basic mode'}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Deeper dives on any topic, using your data</span>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(o => !o)}>
          {open ? 'Close' : 'Open chat'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
            {msgs.length === 0 && (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                Ask a question about your business — I answer from your own numbers. Try:
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {SUGGESTIONS.map(s => (
                    <button key={s} className="btn btn-sm" onClick={() => ask(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'you' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '85%', whiteSpace: m.role === 'you' ? 'pre-wrap' : 'normal', lineHeight: 1.6, fontSize: 12.5,
                  padding: '9px 12px', borderRadius: 12,
                  background: m.role === 'you' ? 'var(--acc-soft, rgba(255,59,59,.12))' : 'var(--hairline, rgba(140,170,220,.08))',
                  color: 'var(--text)',
                  borderTopRightRadius: m.role === 'you' ? 3 : 12,
                  borderTopLeftRadius: m.role === 'you' ? 12 : 3,
                }}>{m.role === 'ai' ? renderMarkdown(m.text) : m.text}</div>
              </div>
            ))}
            {busy && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '11px 14px', borderRadius: 12, background: 'var(--hairline, rgba(140,170,220,.08))', display: 'flex', gap: 5, alignItems: 'center' }}>
                  <span className="ai-dot" /><span className="ai-dot" style={{ animationDelay: '.16s' }} /><span className="ai-dot" style={{ animationDelay: '.32s' }} />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={e => { e.preventDefault(); ask() }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Ask about sales, expenses, inventory, pricing…"
              style={{ flex: 1, padding: '9px 12px', borderRadius: 8, fontSize: 13,
                       background: 'var(--bg-input, var(--bg-card))', color: 'var(--text)', border: '1px solid var(--border)' }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !q.trim()}>Send</button>
          </form>
        </div>
      )}
    </div>
  )
}
