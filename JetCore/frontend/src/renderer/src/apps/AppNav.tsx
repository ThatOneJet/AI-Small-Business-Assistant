/**
 * Per-app categorized sidebar (column 2), Summit-style. Top is a CONTEXT dropdown
 * (where "Aditya Holding LLC" sits in Summit) to switch/add the app's context —
 * locations/accounts (Summit), repos (DevBay), Canvas courses (Pylon). Below are
 * categorized nav sections. Reused by every native app.
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import PopIn from '../bits/PopIn'

export interface NavItem {
  id: string
  label: string
  icon?: ReactNode
  badge?: string
}
export interface NavSection {
  label: string
  items: NavItem[]
}
export interface NavContext {
  /** Current context label shown at the top (e.g. the repo / course / location). */
  current: string
  /** Selectable contexts. */
  items: { id: string; label: string }[]
  onPick?: (id: string) => void
  /** "Add a repo" / "Add a course" / "Add location" action. */
  addLabel?: string
  onAdd?: () => void
}

export default function AppNav({
  context,
  sections,
  active,
  onSelect
}: {
  context?: NavContext
  sections: NavSection[]
  active: string
  onSelect: (id: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const btnRef = useRef<HTMLButtonElement>(null)

  const toggleSection = (label: string): void =>
    setCollapsed((c) => {
      const n = new Set(c)
      n.has(label) ? n.delete(label) : n.add(label)
      return n
    })

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if ((t as HTMLElement).closest?.('.appnav-pop')) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const toggle = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, y: r.bottom + 6 })
    setOpen((o) => !o)
  }

  return (
    <nav className="appnav">
      {context && (
        <>
          <button ref={btnRef} className={'appnav-ctx' + (open ? ' on' : '')} onClick={toggle} type="button">
            <span className="appnav-ctx-label">{context.current}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {open &&
            createPortal(
              <PopIn className="appnav-pop" style={{ left: pos.x, top: pos.y }} origin="top left">
                {context.items.length > 0 && <div className="appnav-pop-label">Switch</div>}
                {context.items.map((it) => (
                  <button
                    key={it.id}
                    className={'appnav-pop-item' + (it.label === context.current ? ' on' : '')}
                    onClick={() => {
                      setOpen(false)
                      context.onPick?.(it.id)
                    }}
                    type="button"
                  >
                    {it.label}
                  </button>
                ))}
                {context.addLabel && (
                  <button
                    className="appnav-pop-add"
                    onClick={() => {
                      setOpen(false)
                      context.onAdd?.()
                    }}
                    type="button"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                    {context.addLabel}
                  </button>
                )}
              </PopIn>,
              document.body
            )}
        </>
      )}

      <div className="appnav-scroll">
        {sections.map((sec) => {
          const isCollapsed = collapsed.has(sec.label)
          return (
            <div className={'appnav-sec' + (isCollapsed ? ' collapsed' : '')} key={sec.label}>
              <button className="appnav-sec-label" type="button" onClick={() => toggleSection(sec.label)}>
                <span>{sec.label}</span>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {!isCollapsed &&
                sec.items.map((it) => (
                  <button
                    key={it.id}
                    className={'appnav-item' + (active === it.id ? ' on' : '')}
                    onClick={() => onSelect(it.id)}
                    type="button"
                  >
                    {it.icon && <span className="appnav-item-ico">{it.icon}</span>}
                    <span className="appnav-item-label">{it.label}</span>
                    {it.badge && <span className="appnav-item-badge">{it.badge}</span>}
                  </button>
                ))}
            </div>
          )
        })}
      </div>
    </nav>
  )
}
