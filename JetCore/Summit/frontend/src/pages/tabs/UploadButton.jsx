import { useRef, useState } from 'react'

/**
 * Self-contained import control. POSTs a file to /api/upload/<type>/<uid> and,
 * when `hasData` is set, also offers a "Clear" action that DELETEs the uploaded
 * rows (/api/data/<type>/<uid>) so the file can be replaced. Calls onDone() after
 * either action so the host tab refetches. Backend auto-detects the header row
 * and maps columns, so odd POS / bank / payroll layouts still import.
 */
export default function UploadButton({ type, uid, label, onDone, hasData = false }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState(null)

  const authHeaders = () => {
    const token = localStorage.getItem('token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function handle(file) {
    if (!file) return
    setBusy(true); setMsg(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(`/api/upload/${type}/${uid}`, { method: 'POST', body: fd, headers: authHeaders() })
      let json
      try { json = await res.json() } catch { throw new Error(`Server error (${res.status})`) }
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      setMsg({ ok: true, text: `Imported ${json.inserted} row${json.inserted === 1 ? '' : 's'}${json.skipped ? ` · ${json.skipped} skipped` : ''}` })
      onDone?.()
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Upload failed' })
    } finally {
      setBusy(false)
    }
  }

  async function clearData() {
    if (!window.confirm(`Delete the uploaded ${label ? label.replace(/^Import\s+/i, '') : type} data? You can then import a replacement file.`)) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch(`/api/data/${type}/${uid}`, { method: 'DELETE', headers: authHeaders() })
      let json
      try { json = await res.json() } catch { throw new Error(`Server error (${res.status})`) }
      if (!res.ok) throw new Error(json.error || 'Delete failed')
      setMsg({ ok: true, text: `Deleted ${json.deleted} row${json.deleted === 1 ? '' : 's'} — import a replacement.` })
      onDone?.()
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Delete failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.xlsm,.csv,.tsv" style={{ display: 'none' }}
        onChange={e => { handle(e.target.files[0]); e.target.value = '' }} />
      <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}
        title="Upload a spreadsheet — the header row and columns are auto-detected"
        style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
        </svg>
        {busy ? 'Working…' : (hasData ? 'Replace file' : (label || 'Import spreadsheet'))}
      </button>
      {hasData && (
        <button className="btn btn-sm" onClick={clearData} disabled={busy}
          title="Delete the uploaded data for this section"
          style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--err, #e5534b)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>
          </svg>
          Delete
        </button>
      )}
      {msg && (
        <span style={{ fontSize: 12, color: msg.ok ? 'var(--ok, #3fb950)' : 'var(--err, #e5534b)' }}>
          {msg.text}
        </span>
      )}
    </div>
  )
}
