/* ============================================================
   JetCore — Universal Shell (redesign)
   Spine rail + orbital Core launcher (⌘K) + topbar + popovers.
   Ported from the design handoff (shell.jsx + app.jsx chrome).
   ============================================================ */
import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Icon } from './icons'
import { IconButton, Avatar, Badge, Divider, cx } from './ui'
import { Overlay, REDUCED } from './motion'
import { APPS, APP_BY, type JCAppMeta } from './apps'
import type { JCAppId } from './contract'

/* ---- Brand core mark (animated glyph) ---- */
export function CoreMark({ size = 26, spinning }: { size?: number; spinning?: boolean }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: spinning ? 'jc-spin 14s linear infinite' : 'none' }}>
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M12 2.5C14.4 5.8 14.4 9.5 12 12 9.6 9.5 9.6 5.8 12 2.5Z" />
        <path d="M12 21.5C9.6 18.2 9.6 14.5 12 12 14.4 14.5 14.4 18.2 12 21.5Z" />
        <path d="M2.5 12C5.8 9.6 9.5 9.6 12 12 9.5 14.4 5.8 14.4 2.5 12Z" />
        <path d="M21.5 12C18.2 14.4 14.5 14.4 12 12 14.5 9.6 18.2 9.6 21.5 12Z" />
      </g>
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  )
}

/* ---- Popover: anchored panel with click-outside ---- */
export function Popover({
  open,
  onClose,
  anchor = 'right',
  children,
  width = 300,
  top = 52,
  bottom
}: {
  open: boolean
  onClose: () => void
  anchor?: 'right' | 'left' | 'center'
  children: ReactNode
  width?: number
  top?: number | string
  /** Anchor the panel by its bottom edge instead of its top (grows upward).
      Used by menus pinned near the bottom of the screen, e.g. the rail avatar. */
  bottom?: number | string
}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (open) requestAnimationFrame(() => setShow(true))
    else setShow(false)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  if (!open) return null
  const side: CSSProperties =
    anchor === 'right' ? { right: 0 } : anchor === 'left' ? { left: 0 } : { left: '50%', transform: 'translateX(-50%)' }
  const fromBottom = bottom !== undefined
  const vertical: CSSProperties = fromBottom ? { bottom } : { top }
  const hiddenY = fromBottom ? 8 : -8
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        ...vertical,
        ...side,
        width,
        zIndex: 80,
        background: 'var(--glass)',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--border-2)',
        borderRadius: 'var(--r-lg)',
        boxShadow: '0 24px 60px -20px hsl(var(--shadow-c)/.6)',
        padding: 8,
        opacity: show ? 1 : 0,
        transform: `${(side.transform as string) || ''} translateY(${show ? 0 : hiddenY}px) scale(${show ? 1 : 0.97})`,
        transformOrigin: fromBottom ? 'bottom' : 'top',
        transition: 'opacity .2s var(--ease), transform .3s var(--spring)'
      }}
    >
      {children}
    </div>
  )
}

/* ---- Spine rail (leftmost) ---- */
export function SpineRail({
  app,
  onApp,
  onCore,
  onSearch,
  onSettings,
  settingsActive,
  accountName,
  onAccount,
  accountOpen,
  apps = APPS,
  lockedApps = []
}: {
  app: JCAppId | ''
  onApp: (id: JCAppId) => void
  onCore: () => void
  onSearch: () => void
  onSettings: () => void
  settingsActive: boolean
  accountName: string
  onAccount: () => void
  accountOpen: boolean
  /** Apps to show on the rail. Defaults to all. */
  apps?: JCAppMeta[]
  /** Apps shown but gated (e.g. Summit for non-business accounts) — get a lock badge. */
  lockedApps?: JCAppId[]
}): JSX.Element {
  return (
    <div
      style={{
        width: 78,
        flex: '0 0 78px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '16px 0 14px',
        background: 'var(--panel)',
        position: 'relative',
        zIndex: 30
      }}
    >
      <button
        className="tap"
        onClick={onCore}
        aria-label="Open Core launcher (Ctrl+K)"
        style={{
          width: 48,
          height: 48,
          borderRadius: 'var(--r-md)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--accent-ink)',
          background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))',
          boxShadow: '0 8px 22px -8px var(--accent-glow)'
        }}
      >
        <CoreMark size={26} spinning />
      </button>
      <div style={{ width: 26, height: 1, background: 'var(--border-2)', margin: '16px 0 14px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {apps.map((a) => {
          const on = a.id === app
          return (
            <button
              key={a.id}
              className="tap"
              title={a.name}
              onClick={() => onApp(a.id)}
              aria-label={a.name}
              data-app={a.id}
              style={{
                position: 'relative',
                width: 52,
                minHeight: 52,
                borderRadius: 'var(--r-md)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: on ? 'var(--accent-ink)' : 'var(--text-2)',
                background: on ? 'var(--accent)' : 'transparent',
                boxShadow: on ? '0 6px 18px -8px var(--accent-glow)' : 'none',
                transition: 'all .25s var(--ease)'
              }}
              onMouseEnter={(e) => {
                if (!on) {
                  e.currentTarget.style.background = 'var(--surface-2)'
                  e.currentTarget.style.color = 'var(--text)'
                }
              }}
              onMouseLeave={(e) => {
                if (!on) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--text-2)'
                }
              }}
            >
              <Icon name={a.glyph} size={23} />
              {lockedApps.includes(a.id) && (
                <span
                  title="Business plan"
                  style={{
                    position: 'absolute',
                    top: 5,
                    right: 7,
                    width: 15,
                    height: 15,
                    borderRadius: '50%',
                    background: 'var(--surface-3)',
                    border: '1px solid var(--border)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-3)'
                  }}
                >
                  <Icon name="lock" size={9} />
                </span>
              )}
              {on && (
                <span
                  style={{
                    position: 'absolute',
                    left: -16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 4,
                    height: 22,
                    borderRadius: 99,
                    background: 'var(--accent)'
                  }}
                />
              )}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <IconButton name="search" label="Search (Ctrl+K)" onClick={onSearch} />
        <IconButton name="gear" label="Settings" active={settingsActive} onClick={onSettings} />
        <button
          className="tap"
          onClick={onAccount}
          aria-label="Account"
          style={{ marginTop: 4, borderRadius: 'var(--r-sm)', outline: accountOpen ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }}
        >
          <Avatar name={accountName} size={38} />
        </button>
      </div>
    </div>
  )
}

/* ---- Core Launcher: orbital app bloom + command search ---- */
export interface JCCommand {
  id: string
  label: string
  icon: string
  kind: string
  run: () => void
}

export function CoreLauncher({
  open,
  onClose,
  app,
  onApp,
  commands,
  apps = APPS,
  lockedApps = []
}: {
  open: boolean
  onClose: () => void
  app: JCAppId | ''
  onApp: (id: JCAppId) => void
  commands: JCCommand[]
  /** Apps to show in the launch grid. */
  apps?: JCAppMeta[]
  /** Gated apps (shown with a lock badge). */
  lockedApps?: JCAppId[]
}): JSX.Element {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setQ('')
      setTimeout(() => inputRef.current?.focus(), 120)
    }
  }, [open])

  const filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())) : []

  return (
    <Overlay open={open} onClose={onClose} align="center" panelStyle={{ width: 'min(680px, 92vw)' }}>
      <div
        style={{
          background: 'var(--glass)',
          backdropFilter: 'blur(26px)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-xl)',
          boxShadow: '0 40px 90px -30px hsl(var(--shadow-c)/.7)',
          overflow: 'hidden'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
          <Icon name="search" size={22} style={{ color: 'var(--text-3)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) {
                filtered[0].run()
                onClose()
              }
            }}
            placeholder="Search apps, jump to a section, run an action…"
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 18, fontWeight: 500 }}
          />
          <kbd style={{ fontSize: 11, color: 'var(--text-3)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '3px 7px' }} className="mono">
            ESC
          </kbd>
        </div>

        {!q ? (
          <div style={{ padding: '34px 24px 30px' }}>
            <div
              style={{
                textAlign: 'center',
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--text-3)',
                marginBottom: 22
              }}
            >
              Launch an app
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(apps.length, 4)}, 1fr)`, gap: 14 }}>
              {apps.map((a, i) => {
                const on = a.id === app
                return (
                  <button
                    key={a.id}
                    className="tap"
                    data-app={a.id}
                    onClick={() => {
                      onApp(a.id)
                      onClose()
                    }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 12,
                      position: 'relative',
                      padding: '22px 10px 18px',
                      borderRadius: 'var(--r-lg)',
                      border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`,
                      background: on ? 'var(--accent-soft)' : 'var(--surface)',
                      animation: REDUCED ? 'none' : `jc-bloom .6s var(--spring) both`,
                      animationDelay: `${i * 70 + 80}ms`
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent-line)'
                      e.currentTarget.style.transform = 'translateY(-4px)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = on ? 'var(--accent-line)' : 'var(--border)'
                      e.currentTarget.style.transform = 'translateY(0)'
                    }}
                  >
                    {lockedApps.includes(a.id) && (
                      <span
                        title="Business plan"
                        style={{
                          position: 'absolute',
                          top: 10,
                          right: 10,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 7px',
                          borderRadius: 'var(--r-pill)',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-3)',
                          fontSize: 10,
                          fontWeight: 700
                        }}
                      >
                        <Icon name="lock" size={10} />
                        Business
                      </span>
                    )}
                    <div
                      style={{
                        width: 54,
                        height: 54,
                        borderRadius: 'var(--r-md)',
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--accent-ink)',
                        background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))',
                        boxShadow: '0 8px 20px -8px var(--accent-glow)'
                      }}
                    >
                      <Icon name={a.glyph} size={26} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{a.name}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{a.who}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div style={{ padding: 8, maxHeight: 380, overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-3)', fontSize: 14 }}>No matches for “{q}”</div>
            )}
            {filtered.map((c, i) => (
              <button
                key={c.id}
                className="tap"
                onClick={() => {
                  c.run()
                  onClose()
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  width: '100%',
                  padding: '13px 16px',
                  borderRadius: 'var(--r-md)',
                  background: i === 0 ? 'var(--surface-2)' : 'transparent',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = i === 0 ? 'var(--surface-2)' : 'transparent')}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--r-sm)',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--accent-soft)',
                    color: 'var(--accent-h)'
                  }}
                >
                  <Icon name={c.icon} size={17} />
                </div>
                <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{c.label}</span>
                <Badge size="sm">{c.kind}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </Overlay>
  )
}

/* ---- Account menu (rail avatar popover) ---- */
export function AccountMenu({
  open,
  onClose,
  name,
  email,
  onSettings,
  onSignOut
}: {
  open: boolean
  onClose: () => void
  name: string
  email: string
  onSettings: () => void
  onSignOut: () => void
}): JSX.Element {
  return (
    <Popover open={open} onClose={onClose} anchor="left" width={280} bottom={0}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 14px' }}>
        <Avatar name={name} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{email}</div>
        </div>
      </div>
      <div style={{ padding: '0 8px 8px' }}>
        <Badge tone="accent" icon="bolt">
          JetCore account
        </Badge>
      </div>
      <Divider style={{ margin: '4px 4px 8px' }} />
      {(
        [
          ['user', 'Profile & account'],
          ['gear', 'Settings'],
          ['shield', 'Security & vault']
        ] as [string, string][]
      ).map(([ic, lbl]) => (
        <button
          key={lbl}
          className="tap"
          onClick={() => {
            onSettings()
            onClose()
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            width: '100%',
            padding: '10px 12px',
            borderRadius: 'var(--r-sm)',
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--text-2)'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Icon name={ic} size={17} />
          {lbl}
        </button>
      ))}
      <Divider style={{ margin: '8px 4px' }} />
      <button
        className="tap"
        onClick={() => {
          onSignOut()
          onClose()
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          width: '100%',
          padding: '10px 12px',
          borderRadius: 'var(--r-sm)',
          fontSize: 13.5,
          fontWeight: 600,
          color: 'var(--neg)'
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in oklch,var(--neg) 12%,transparent)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <Icon name="logout" size={17} />
        Sign out
      </button>
    </Popover>
  )
}

/* ---- Topbar: app identity + search + window controls ---- */
export function Topbar({
  app,
  onSearch,
  right
}: {
  app: JCAppId
  onSearch: () => void
  right?: ReactNode
}): JSX.Element {
  const a = APP_BY[app]
  return (
    <div className={cx('drag')} style={{ background: 'var(--panel)', position: 'relative', zIndex: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px 0 22px', height: 44 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 'var(--r-sm)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--accent-ink)',
              background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))'
            }}
          >
            <Icon name={a.glyph} size={15} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>{a.name}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="tap no-drag"
          onClick={onSearch}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '6px 11px',
            borderRadius: 'var(--r-sm)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-3)',
            minWidth: 190
          }}
        >
          <Icon name="search" size={15} />
          <span style={{ fontSize: 13.5, flex: 1, textAlign: 'left' }}>Search & commands</span>
          <kbd style={{ fontSize: 11, border: '1px solid var(--border-2)', borderRadius: 6, padding: '2px 6px' }} className="mono">
            Ctrl K
          </kbd>
        </button>
        {right}
      </div>
    </div>
  )
}
