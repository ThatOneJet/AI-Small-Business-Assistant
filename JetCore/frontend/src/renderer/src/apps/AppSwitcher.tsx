/**
 * The lightning app-switcher (top-left of the titlebar) — present in every app.
 *
 * Shows the active app's mark + name; clicking opens a dropdown of all JetCore
 * apps, each with a short "who it's for" blurb so the user knows which is which.
 * Selecting one switches the shell's active app.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import PopIn from '../bits/PopIn'
import { useStore } from '../store'
import { JETCORE_APPS, getApp, type AppId } from './registry'

export default function AppSwitcher(): JSX.Element {
  const activeApp = useStore((s) => s.activeApp)
  const setActiveApp = useStore((s) => s.setActiveApp)
  const setSwitcherOpen = useStore((s) => s.setSwitcherOpen)
  const [open, setOpen] = useState(false)

  // Tell the shell when the dropdown is open so Summit's native view can step
  // aside (it paints above the DOM and would otherwise cover the menu).
  useEffect(() => {
    setSwitcherOpen(open)
  }, [open, setSwitcherOpen])
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const active = getApp(activeApp)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if ((t as HTMLElement).closest?.('.appsw-pop')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, y: r.bottom + 8 })
    setOpen((o) => !o)
  }

  const pick = (id: AppId): void => {
    setOpen(false)
    if (id !== activeApp) setActiveApp(id)
  }

  const popover = createPortal(
    open ? (
      <PopIn className="appsw-pop" style={{ left: pos.x, top: pos.y }} origin="top left">
        <div className="appsw-head">Switch app</div>
        {JETCORE_APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={'appsw-item' + (a.id === activeApp ? ' on' : '')}
            onClick={() => pick(a.id)}
          >
            <span className="appsw-item-mark">
              <a.Icon size={17} />
            </span>
            <span className="appsw-item-text">
              <span className="appsw-item-name">{a.short}</span>
              <span className="appsw-item-aud">{a.audience}</span>
            </span>
          </button>
        ))}
      </PopIn>
    ) : null,
    document.body
  )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={'appsw no-drag' + (open ? ' on' : '')}
        onClick={toggle}
        title={`${active.name} — switch app`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* The active app's mark — reflects which app you're in. */}
        <span className="appsw-bolt">
          <active.Icon size={16} />
        </span>
        <span className="appsw-name">{active.short}</span>
        <svg className="appsw-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {popover}
    </>
  )
}
