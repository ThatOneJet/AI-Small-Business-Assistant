import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'

// AI Assistant tab — talks to the local Ollama LLM through Summit's /api/llm/* routes.
// The tab is only shown when Ollama is connected (Dashboard gates it), but this component
// also re-checks status and degrades gracefully if the connection drops while open.
export default function Assistant({ uid }) {
  const [status, setStatus]     = useState(null)   // { connected, model, models }
  const [files, setFiles]       = useState([])
  const [question, setQuestion] = useState('')
  const [answer, setAnswer]     = useState('')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState('')
  const fileRef = useRef(null)

  const loadStatus = () =>
    api.get('/api/llm/status').then(r => setStatus(r.data)).catch(() => setStatus({ connected: false }))
  const loadFiles = () =>
    api.get(`/api/llm/files/${uid}`).then(r => setFiles(r.data.files || [])).catch(() => {})

  useEffect(() => { loadStatus(); loadFiles() }, [uid])

  async function onUpload(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setErr('')
    const fd = new FormData()
    fd.append('file', f)
    try {
      const r = await api.post(`/api/llm/files/${uid}`, fd)
      setFiles(r.data.files || [])
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Upload failed')
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onDelete(name) {
    setErr('')
    try {
      const r = await api.del(`/api/llm/files/${uid}/${encodeURIComponent(name)}`)
      setFiles(r.data.files || [])
    } catch {
      setErr('Delete failed')
    }
  }

  async function onAnalyze() {
    setBusy(true); setErr(''); setAnswer('')
    try {
      const r = await api.post(`/api/llm/analyze/${uid}`, { question })
      setAnswer(r.data.answer || '')
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Analysis failed')
    }
    setBusy(false)
  }

  // Safety net: if the connection drops while the tab is open.
  if (status && !status.connected) {
    return (
      <div style={S.offline}>
        The local AI (Ollama) isn’t connected right now. Start it and reopen this tab.
      </div>
    )
  }

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <div>
          <div style={S.title}>AI Assistant</div>
          <div style={S.sub}>Runs locally on your Jetson — your data never leaves the device.</div>
        </div>
        {status?.connected && <span style={S.badge}>● {status.model}</span>}
      </div>

      {/* Files the assistant reads (uploaded by you) */}
      <section style={S.card}>
        <div style={S.cardHead}>
          <h3 style={S.h3}>Your data files</h3>
          <label style={S.upload}>
            + Upload file
            <input ref={fileRef} type="file"
                   accept=".csv,.tsv,.txt,.json,.ndjson,.md,.xlsx,.xls,.xlsm,.parquet"
                   onChange={onUpload} style={{ display: 'none' }} />
          </label>
        </div>
        {files.length === 0 ? (
          <p style={S.muted}>No files yet — upload any data file (CSV, Excel, JSON, Parquet, TSV…);
            pandas auto-detects and categorizes the columns for the AI.</p>
        ) : (
          <ul style={S.list}>
            {files.map(f => (
              <li key={f.name} style={S.row}>
                <span>{f.name} <span style={S.muted}>· {(f.size / 1024).toFixed(1)} KB</span></span>
                <button style={S.del} onClick={() => onDelete(f.name)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Ask */}
      <section style={S.card}>
        <h3 style={S.h3}>Ask about your data</h3>
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="e.g. Which products are lowest on stock and what should I reorder?"
          style={S.textarea}
        />
        <button style={S.analyze} disabled={busy || files.length === 0} onClick={onAnalyze}>
          {busy ? 'Analyzing…' : 'Analyze with local AI'}
        </button>
        {files.length === 0 && <span style={S.hint}>Upload a file first.</span>}
      </section>

      {err && <div style={S.err}>{err}</div>}
      {answer && (
        <section style={S.card}>
          <h3 style={S.h3}>Analysis</h3>
          <pre style={S.answer}>{answer}</pre>
        </section>
      )}
    </div>
  )
}

const S = {
  wrap:     { maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 18 },
  head:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title:    { fontSize: 22, fontWeight: 700 },
  sub:      { opacity: 0.6, fontSize: 13, marginTop: 2 },
  badge:    { fontSize: 12, padding: '4px 10px', borderRadius: 999, background: 'rgba(60,200,120,0.15)', color: '#2ea86a' },
  card:     { background: 'rgba(127,127,127,0.06)', border: '1px solid rgba(127,127,127,0.15)', borderRadius: 16, padding: 18 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  h3:       { fontSize: 15, fontWeight: 600, margin: '0 0 10px' },
  upload:   { fontSize: 13, padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(127,127,127,0.25)', cursor: 'pointer' },
  list:     { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  row:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, padding: '8px 12px', borderRadius: 10, background: 'rgba(127,127,127,0.06)' },
  del:      { fontSize: 12, color: '#e0466f', background: 'none', border: 'none', cursor: 'pointer' },
  muted:    { opacity: 0.55, fontSize: 13 },
  textarea: { width: '100%', minHeight: 90, borderRadius: 12, border: '1px solid rgba(127,127,127,0.25)', padding: 12, fontSize: 14, resize: 'vertical', background: 'transparent', color: 'inherit' },
  analyze:  { marginTop: 10, padding: '10px 18px', borderRadius: 12, border: 'none', background: '#6b8afd', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  hint:     { marginLeft: 10, fontSize: 12, opacity: 0.6 },
  err:      { color: '#e0466f', fontSize: 14 },
  answer:   { whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, margin: 0 },
  offline:  { padding: 24, opacity: 0.7 },
}
