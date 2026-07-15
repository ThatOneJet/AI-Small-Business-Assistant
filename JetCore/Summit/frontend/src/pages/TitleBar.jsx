import { useState, useEffect } from 'react'

function BackIcon()    { return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M8.5 2L3.5 6.5l5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function ForwardIcon() { return <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M4.5 2l5 4.5-5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> }
function MinimizeIcon(){ return <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4.5" width="10" height="1" fill="currentColor" /></svg> }
function MaximizeIcon(){ return <svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" /></svg> }
function RestoreIcon() { return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="3" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" /><polyline points="3,3 3,0 10,0 10,7 7,7" stroke="currentColor" strokeWidth="1" fill="none" /></svg> }
function CloseIcon()   { return <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg> }

const win = {
  minimize: () => { if (window.electronAPI) window.electronAPI.minimize(); else window.pywebview?.api?.minimize_window() },
  maximize: () => { if (window.electronAPI) window.electronAPI.maximize(); else window.pywebview?.api?.maximize_window() },
  restore:  () => { if (window.electronAPI) window.electronAPI.restore();  else window.pywebview?.api?.restore_window() },
  close:    () => { if (window.electronAPI) window.electronAPI.close();    else window.pywebview?.api?.close_window() },
  move:     (x, y) => { if (window.electronAPI) window.electronAPI.move(x, y); else window.pywebview?.api?.move_window(x, y) },
}

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const [navState,  setNavState]  = useState({ canGoBack: false, canGoForward: false })
  const [activeTab, setActiveTab] = useState('Dashboard')
  const [utcTime,   setUtcTime]   = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      const h  = String(now.getHours()).padStart(2, '0')
      const m  = String(now.getMinutes()).padStart(2, '0')
      const s  = String(now.getSeconds()).padStart(2, '0')
      const tz = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop()
      setUtcTime(`${h}:${m}:${s} ${tz}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onNav  = (e) => setNavState(e.detail)
    const onPage = (e) => setActiveTab(e.detail.tab)
    window.addEventListener('jetcore:nav-state',   onNav)
    window.addEventListener('jetcore:page-change', onPage)
    return () => {
      window.removeEventListener('jetcore:nav-state',   onNav)
      window.removeEventListener('jetcore:page-change', onPage)
    }
  }, [])

  useEffect(() => {
    window.electronAPI?.onMaximize?.((v) => setMaximized(v))
  }, [])

  function startDrag(e) {
    if (e.target.closest('.tb-controls') || e.target.closest('.tb-nav') || e.target.closest('.tb-cluster')) return
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.screenX, startY = e.screenY
    const originX = window.screenX, originY = window.screenY
    const onMove = (ev) => win.move(originX + ev.screenX - startX, originY + ev.screenY - startY)
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function toggleMaximize() {
    maximized ? win.restore() : win.maximize()
    if (!window.electronAPI) setMaximized(m => !m)
  }

  return (
    <div className="titlebar" onMouseDown={startDrag} onDoubleClick={toggleMaximize}>
      <span className="tb-dot" />
      <span className="tb-wordmark">JETCORE</span>
      <span className="tb-sep">/</span>
      <span className="tb-pagename">{activeTab}</span>

      <div className="tb-nav">
        <button
          className="tb-nav-btn"
          disabled={!navState.canGoBack}
          onClick={() => window.dispatchEvent(new CustomEvent('jetcore:go-back'))}
          title="Go Back"
        ><BackIcon /></button>
        <button
          className="tb-nav-btn"
          disabled={!navState.canGoForward}
          onClick={() => window.dispatchEvent(new CustomEvent('jetcore:go-forward'))}
          title="Go Forward"
        ><ForwardIcon /></button>
      </div>

      <div className="tb-spacer" />

      <div className="tb-cluster">
        <span className="tb-cluster-item">
          <span className="lbl">UPTIME</span>
          <span className="val" style={{ color: 'var(--ok)' }}>99.98%</span>
        </span>
        <span className="tb-cluster-item">
          <span className="lbl">LAT</span>
          <span className="val">14ms</span>
        </span>
        <span className="tb-cluster-item">
          <span className="tb-dot" style={{ background: 'var(--ok)', boxShadow: '0 0 6px var(--ok)' }} />
          <span className="lbl">LIVE</span>
        </span>
        <span className="tb-cluster-item">
          <span className="val">{utcTime}</span>
        </span>
      </div>

      <div className="tb-controls">
        <button className="tb-btn" onClick={() => win.minimize()} title="Minimize"><MinimizeIcon /></button>
        <button className="tb-btn" onClick={toggleMaximize} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="tb-btn tb-close" onClick={() => win.close()} title="Close"><CloseIcon /></button>
      </div>
    </div>
  )
}
