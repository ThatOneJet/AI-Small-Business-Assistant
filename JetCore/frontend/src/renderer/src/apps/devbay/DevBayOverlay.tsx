/**
 * DevBay overlay UI — rendered in the transparent always-on-top window (summoned
 * by Ctrl/Cmd+Shift+Space). A spotlight-style quick panel: type to filter repos,
 * Enter/click to jump to one in the browser. Escape (or click-away) dismisses.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { DevBayRepo } from '@shared/ipc'

export default function DevBayOverlay(): JSX.Element {
  const [repos, setRepos] = useState<DevBayRepo[]>([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [connected, setConnected] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = (): void => {
    void window.decks?.devbay?.fetch().then((d) => {
      setConnected(!!d?.connected)
      setRepos(d?.repos ?? [])
    })
  }

  useEffect(() => {
    refresh()
    const focus = (): void => {
      setQ('')
      setSel(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    focus()
    const off = window.decks?.devbay?.onOverlayShown(() => {
      focus()
      refresh()
    })
    return () => off?.()
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = s ? repos.filter((r) => r.fullName.toLowerCase().includes(s)) : repos
    return list.slice(0, 8)
  }, [q, repos])

  const hide = (): void => window.decks?.devbay?.overlayHide()
  const open = (r: DevBayRepo | undefined): void => {
    if (!r) return
    window.open(r.url, '_blank')
    hide()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') hide()
    else if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, filtered.length - 1))
    else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
    else if (e.key === 'Enter') open(filtered[sel])
  }

  return (
    <div className="dbo-root" onKeyDown={onKey}>
      <div className="dbo-card">
        <div className="dbo-head">
          <span className="dbo-bolt">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M13 2 4.5 13.2c-.4.5 0 1.3.7 1.3H11l-1 8 8.8-11.7c.4-.5 0-1.3-.7-1.3H12l1-7.5Z" /></svg>
          </span>
          <input
            ref={inputRef}
            className="dbo-input"
            placeholder={connected === false ? 'Connect GitHub in DevBay first…' : 'Jump to a repo…'}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
          />
          <span className="dbo-hint">esc</span>
        </div>
        <div className="dbo-list">
          {filtered.length === 0 && (
            <div className="dbo-empty">{connected === false ? 'No GitHub connection.' : 'No repos match.'}</div>
          )}
          {filtered.map((r, i) => (
            <button
              key={r.fullName}
              className={'dbo-item' + (i === sel ? ' on' : '')}
              onMouseEnter={() => setSel(i)}
              onClick={() => open(r)}
            >
              <span className="dbo-item-name">{r.name}</span>
              <span className="dbo-item-full">{r.fullName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
