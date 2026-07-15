/**
 * JetCore — DevBay Quick Panel.
 *
 * The summonable, always-on-top overlay rendered in its OWN transparent window
 * (separate from the main shell), so it must paint its own `.jc-root` wrapper and
 * set `data-theme` from localStorage at mount. Summon with the global hotkey →
 * focus the search box, type to filter repos, ↑/↓ to move, Enter/click to open a
 * repo in the browser, Escape to dismiss.
 *
 * Recreates the prototype's quick-panel look (glass card, CoreMark, ⌥Space hint,
 * staleness dots) on REAL data via window.decks.devbay.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { DevBayRepo } from '@shared/ipc'
import { Icon } from '../../icons'
import { CoreMark } from '../../shell'
import { REDUCED } from '../../motion'
import { readTheme } from '../../contract'

/* ── staleness dot (mirrors the prototype's quick-panel coding) ──────── */

const staleDays = (iso: string): number => Math.max(0, (Date.now() - new Date(iso).getTime()) / 86400000)
function staleColor(iso: string): string {
  const d = staleDays(iso)
  if (d < 7) return 'var(--pos)'
  if (d < 30) return 'var(--accent)'
  if (d < 90) return 'var(--warn)'
  return 'var(--neg)'
}

export function DevBayQuickPanel(): JSX.Element {
  const [repos, setRepos] = useState<DevBayRepo[]>([])
  const [connected, setConnected] = useState<boolean | null>(null)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  /* Own the document root: theme (from localStorage) + the violet app accent. */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', readTheme())
  }, [])

  const refresh = useCallback((): void => {
    void window.decks?.devbay
      ?.fetch()
      .then((d) => {
        setConnected(!!d?.connected)
        setRepos(d?.repos ?? [])
      })
      .catch(() => {
        setConnected(false)
        setRepos([])
      })
  }, [])

  useEffect(() => {
    const focus = (): void => {
      setQuery('')
      setSel(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    refresh()
    focus()
    const off = window.decks?.devbay?.onOverlayShown(() => {
      focus()
      refresh()
    })
    return () => off?.()
  }, [refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? repos.filter((r) => r.name.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q))
      : repos.slice()
    return list.slice(0, 6)
  }, [query, repos])

  const hide = useCallback((): void => window.decks?.devbay?.overlayHide(), [])

  const open = useCallback(
    (r: DevBayRepo | undefined): void => {
      if (!r) return
      window.open(r.url, '_blank')
      hide()
    },
    [hide]
  )

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      hide()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, Math.max(0, filtered.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(filtered[sel])
    }
  }

  return (
    <div
      className="jc-root"
      data-app="devbay"
      style={{ height: '100vh', display: 'grid', placeItems: 'center', padding: 14, background: 'transparent' }}
      onKeyDown={onKey}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide()
      }}
    >
      <div style={{ position: 'relative', width: 'min(420px, 100%)' }}>
        <div
          style={{
            position: 'absolute',
            inset: -28,
            background: 'radial-gradient(circle, var(--accent-soft), transparent 70%)',
            filter: 'blur(18px)',
            pointerEvents: 'none'
          }}
        />
        <div
          style={{
            position: 'relative',
            borderRadius: 'var(--r-lg)',
            background: 'var(--glass)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid var(--border-2)',
            boxShadow: '0 30px 70px -24px hsl(var(--shadow-c) / .7)',
            overflow: 'hidden',
            animation: REDUCED ? 'none' : 'jc-pop .35s var(--spring)'
          }}
        >
          {/* search header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '13px 16px',
              borderBottom: '1px solid var(--border)'
            }}
          >
            <span style={{ color: 'var(--accent-h)', display: 'grid', placeItems: 'center' }}>
              <CoreMark size={18} />
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSel(0)
              }}
              placeholder={connected === false ? 'Connect GitHub in DevBay first…' : 'Jump to a repo…'}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: 'var(--text)',
                fontSize: 13.5,
                fontWeight: 500,
                minWidth: 0
              }}
            />
            <kbd
              className="mono"
              style={{
                fontSize: 10.5,
                border: '1px solid var(--border-2)',
                borderRadius: 5,
                padding: '2px 6px',
                color: 'var(--text-3)'
              }}
            >
              esc
            </kbd>
          </div>

          {/* results */}
          <div style={{ padding: 8 }}>
            <div
              className="mono"
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--text-3)',
                padding: '8px 8px 6px'
              }}
            >
              {connected === false ? 'Not connected' : query.trim() ? 'Matches' : 'Recent repos'}
            </div>

            {filtered.length === 0 ? (
              <div style={{ padding: '14px 8px 16px', fontSize: 12.5, color: 'var(--text-3)' }}>
                {connected === false
                  ? 'Open DevBay and connect GitHub to summon repos here.'
                  : connected === null
                    ? 'Loading repos…'
                    : 'No repos match.'}
              </div>
            ) : (
              filtered.map((r, i) => {
                const on = i === sel
                return (
                  <button
                    key={r.fullName}
                    className="tap"
                    onMouseEnter={() => setSel(i)}
                    onClick={() => open(r)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '9px 8px',
                      borderRadius: 'var(--r-sm)',
                      textAlign: 'left',
                      background: on ? 'var(--accent-soft)' : 'transparent'
                    }}
                  >
                    <Icon
                      name={r.private ? 'lock' : 'repo'}
                      size={14}
                      style={{ color: on ? 'var(--accent-h)' : 'var(--text-3)', flex: '0 0 auto' }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: on ? 'var(--accent-h)' : 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                    >
                      {r.name}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--text-3)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        maxWidth: 130
                      }}
                    >
                      {r.fullName}
                    </span>
                    <span
                      style={{ width: 7, height: 7, borderRadius: 99, background: staleColor(r.pushedAt), flex: '0 0 auto' }}
                    />
                    {on && <Icon name="arrowR" size={13} style={{ color: 'var(--accent-h)', flex: '0 0 auto' }} />}
                  </button>
                )
              })
            )}
          </div>

          {/* footer hint */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '9px 16px',
              borderTop: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-3)'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <kbd className="mono" style={{ border: '1px solid var(--border-2)', borderRadius: 4, padding: '1px 5px' }}>
                ↑↓
              </kbd>
              navigate
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <kbd className="mono" style={{ border: '1px solid var(--border-2)', borderRadius: 4, padding: '1px 5px' }}>
                ⏎
              </kbd>
              open
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="github" size={13} />
              DevBay
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
