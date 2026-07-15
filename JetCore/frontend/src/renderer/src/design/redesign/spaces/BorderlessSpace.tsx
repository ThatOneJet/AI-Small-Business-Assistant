/**
 * JetCore redesign — Borderless space (the software-KVM control surface).
 *
 * A ground-up re-present of the Claude Design handoff (JetCore.dc.html
 * renderBorderless, lines 848–877) in the warm-editorial "Hangar" language,
 * WIRED to the real Borderless daemon — no fake monitors, peers, or numbers.
 *
 * What's live (ported from design/apps/borderless/BorderlessScreen.tsx):
 *   - window.decks.displays()       → this machine's REAL monitors, drawn to true
 *                                     position + proportion on the desk-layout canvas.
 *   - window.decks.cursorPoint()    → live cursor poll (40ms) → the layout marker.
 *   - window.decks.borderless.state / onState  → discovery + pairing state stream.
 *   - window.decks.borderless.onCursor          → live edge-sensing readout.
 *   - window.decks.borderless.{start,stop}      → Enable / Disable.
 *   - window.decks.borderless.setConfig         → push machine name + secret live.
 *   - window.decks.borderless.{pair,unpair}     → per-peer pairing.
 *
 * The honest line: discovery, pairing & sensing run in-app, but actually moving
 * control to another machine (suppressing local input + injecting on the remote)
 * needs the native borderlessd agent. Name + secret persist locally (jc.borderless)
 * so they survive across launches and the agent can pick them up.
 *
 * Renders ONLY the scrollable body — the Hangar shell owns the 60px chrome.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { BorderlessCursorEvent, BorderlessState, DisplayInfo } from '@shared/ipc'
import { Icon } from '../../icons'
import { tone, DOMAINS } from '../system'

/* the Borderless world's accent (design 857: tone(205, 0.13)) */
const T = tone(DOMAINS.borderless.hue, DOMAINS.borderless.c)

/* ── persisted settings (shared key with the legacy screen) ──────────────── */

const SETTINGS_KEY = 'jc.borderless'

interface Persisted {
  machineName: string
  secret: string
}
const DEFAULTS: Persisted = { machineName: 'This PC', secret: '' }

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) }
  } catch {
    /* ignore — fall back to defaults */
  }
  return DEFAULTS
}
function savePersisted(patch: Partial<Persisted>): void {
  try {
    const cur = loadPersisted()
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...cur, ...patch }))
  } catch {
    /* ignore */
  }
}

/* memorable shared secret (ported from BorderlessScreen.randomSecret) */
function randomSecret(): string {
  const a = ['otter', 'marble', 'cobalt', 'ember', 'willow', 'quartz', 'cedar', 'maple']
  const b = ['river', 'fox', 'echo', 'drift', 'north', 'flint', 'haze', 'sol']
  return `${a[Math.floor(Math.random() * a.length)]}-${b[Math.floor(Math.random() * b.length)]}-${String(1000 + Math.floor(Math.random() * 9000))}`
}

/* a monitor's true pixel resolution from DIP bounds × scale */
const resLabel = (d: DisplayInfo): string =>
  `${Math.round(d.width * d.scaleFactor)}×${Math.round(d.height * d.scaleFactor)}`

/* ── desk-layout canvas — THIS machine's real monitors + the live cursor ───
   Ported from BorderlessScreen.LayoutCanvas, re-styled into the warm "disp"
   panel language. The fit-to-scale math (min/max bounds → uniform scale →
   centered offset) and the always-on cursor poll are unchanged — they read the
   real OS displays so the desk is drawn to true proportion. */

function LayoutCanvas({ cursor }: { cursor: BorderlessCursorEvent | null }): JSX.Element {
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null)
  const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(880)
  const CH = 320

  const refresh = useCallback((): void => {
    void window.decks
      ?.displays?.()
      .then((d) => setDisplays(d))
      .catch(() => setDisplays([]))
  }, [])
  useEffect(() => refresh(), [refresh])

  // Always-on cursor poll so the marker shows even before Borderless is enabled —
  // handy for placing a device and watching the cursor approach a hand-off edge.
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      void window.decks
        ?.cursorPoint?.()
        .then((p) => alive && setCursorPt(p))
        .catch(() => alive && setCursorPt(null))
    }
    tick()
    const id = window.setInterval(tick, 40)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  // Measure so monitors fit to scale without distortion.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setCw(el.clientWidth)
    const ro = new ResizeObserver(() => setCw(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const box = useMemo(() => {
    if (!displays || displays.length === 0) return null
    const minX = Math.min(...displays.map((d) => d.x))
    const minY = Math.min(...displays.map((d) => d.y))
    const maxX = Math.max(...displays.map((d) => d.x + d.width))
    const maxY = Math.max(...displays.map((d) => d.y + d.height))
    return { minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
  }, [displays])

  const pad = 38
  const scale = box ? Math.min((cw - pad * 2) / box.w, (CH - pad * 2) / box.h) : 1
  const offX = box ? (cw - box.w * scale) / 2 : 0
  const offY = box ? (CH - box.h * scale) / 2 : 0
  const count = displays?.length ?? 0

  return (
    <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', overflow: 'hidden' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '15px 18px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, display: 'grid', placeItems: 'center', background: T.soft, color: T.bright }}>
            <Icon name="grid" size={17} stroke={2} />
          </div>
          <div>
            <div className="disp" style={{ fontSize: 16, fontWeight: 700 }}>This PC — desk layout</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
              {count ? `${count} monitor${count === 1 ? '' : 's'}, auto-detected from your OS` : 'Reading your monitors…'}
            </div>
          </div>
        </div>
        <button
          className="tap"
          onClick={refresh}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 11, background: 'var(--card-2)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 600 }}
        >
          <Icon name="refresh" size={15} stroke={2} />
          Refresh
        </button>
      </div>

      {/* the canvas — graph-paper grid, monitors to scale, live cursor marker */}
      <div
        ref={wrapRef}
        style={{
          position: 'relative',
          height: CH,
          overflow: 'hidden',
          background: 'var(--bg)',
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0 23px, var(--line) 23px 24px), repeating-linear-gradient(90deg, transparent 0 23px, var(--line) 23px 24px)'
        }}
      >
        {displays === null && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            Reading your displays…
          </div>
        )}
        {displays && displays.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
            No displays reported by the OS.
          </div>
        )}

        {box &&
          displays &&
          displays.map((d, i) => {
            const left = offX + (d.x - box.minX) * scale
            const top = offY + (d.y - box.minY) * scale
            const w = d.width * scale
            const h = d.height * scale
            return (
              <div
                key={d.id}
                title={`${d.label || `Display ${i + 1}`} — ${resLabel(d)}${d.primary ? ' · primary' : ''}${d.internal ? ' · built-in' : ''}`}
                style={{
                  position: 'absolute',
                  left,
                  top,
                  width: w,
                  height: h,
                  borderRadius: 8,
                  background: d.primary ? `color-mix(in oklch, ${T.base} 18%, var(--card))` : 'var(--card-2)',
                  border: `2px solid ${d.primary ? T.base : T.line}`,
                  boxShadow: '0 12px 26px -16px oklch(0.1 0.02 60 / 0.6)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  padding: 6,
                  overflow: 'hidden'
                }}
              >
                <span className="mono" style={{ position: 'absolute', top: 5, left: 8, fontSize: 11, fontWeight: 800, color: T.bright }}>
                  {i + 1}
                </span>
                <span className="mono" style={{ fontSize: Math.max(9, Math.min(13, w * 0.085)), fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                  {resLabel(d)}
                </span>
                {(d.primary || d.internal) && w > 80 && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                    {d.primary ? 'Primary' : ''}
                    {d.primary && d.internal ? ' · ' : ''}
                    {d.internal ? 'Built-in' : ''}
                  </span>
                )}
              </div>
            )
          })}

        {/* live cursor — where the mouse is right now; pulses at a hand-off edge */}
        {box &&
          cursorPt &&
          (() => {
            const mx = Math.max(0, Math.min(cw, offX + (cursorPt.x - box.minX) * scale))
            const my = Math.max(0, Math.min(CH, offY + (cursorPt.y - box.minY) * scale))
            const atEdge = !!cursor?.edge
            return (
              <div
                style={{
                  position: 'absolute',
                  left: mx,
                  top: my,
                  transform: 'translate(-2px, -1px)',
                  pointerEvents: 'none',
                  zIndex: 6,
                  transition: 'left .04s linear, top .04s linear'
                }}
              >
                {atEdge && (
                  <span style={{ position: 'absolute', left: -9, top: -9, width: 26, height: 26, borderRadius: '50%', background: T.base, opacity: 0.3, filter: 'blur(1px)' }} />
                )}
                <svg width="19" height="19" viewBox="0 0 16 16" style={{ position: 'relative', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.55))' }}>
                  <path d="M2 1 L2 14 L5.3 10.9 L7.6 15 L9.9 13.9 L7.6 9.9 L12 9.9 Z" fill={T.base} stroke="#fff" strokeWidth="0.9" strokeLinejoin="round" />
                </svg>
              </div>
            )
          })()}
      </div>

      {/* footer readout — live cursor coords + edge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-3)' }}>
        <Icon name={cursorPt ? 'target' : 'info'} size={14} stroke={2} />
        {cursorPt ? (
          <span className="mono">
            Mouse at {cursorPt.x}, {cursorPt.y}
            {cursor?.edge ? ` · at ${cursor.edge} edge` : ''}
            {cursor?.crossingTo ? ' · crossing →' : ''}
          </span>
        ) : (
          'Locating your cursor… if it never appears, your OS may be blocking cursor reads.'
        )}
      </div>
    </div>
  )
}

/* ── a labelled toggle/status row (design toggleRow, line 853) ───────────── */

function Row({ icon, title, sub, children }: { icon: string; title: string; sub: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 0' }}>
      <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, display: 'grid', placeItems: 'center', background: T.soft, color: T.bright }}>
        <Icon name={icon} size={16} stroke={2} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1, lineHeight: 1.4 }}>{sub}</div>
      </div>
      <div style={{ flex: '0 0 auto' }}>{children}</div>
    </div>
  )
}

/* a small "Always on" / status badge */
function StatusPill({ icon, label, color, bg }: { icon: string; label: string; color: string; bg: string }): JSX.Element {
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999, color, background: bg }}>
      <Icon name={icon} size={13} stroke={2} />
      {label}
    </span>
  )
}

/* ── the space ───────────────────────────────────────────────────────────── */

export function BorderlessSpace(): JSX.Element {
  const [machineName, setMachineName] = useState(() => loadPersisted().machineName)
  const [secret, setSecret] = useState(() => loadPersisted().secret)

  // Live engine state (discovery + pairing) and cursor-edge sensing, streamed
  // from the main process over IPC.
  const [bl, setBl] = useState<BorderlessState | null>(null)
  const [cursor, setCursor] = useState<BorderlessCursorEvent | null>(null)
  useEffect(() => {
    let alive = true
    void window.decks?.borderless
      ?.state()
      .then((st) => alive && setBl(st))
      .catch(() => {})
    const offState = window.decks?.borderless?.onState((st) => setBl(st))
    const offCursor = window.decks?.borderless?.onCursor((e) => setCursor(e))
    return () => {
      alive = false
      offState?.()
      offCursor?.()
    }
  }, [])

  const running = bl?.running ?? false
  const peers = bl?.peers ?? []
  const pairedCount = peers.filter((p) => p.paired).length

  const enable = useCallback((): void => {
    void window.decks?.borderless
      ?.start({ machineName: machineName || 'This PC', secret })
      .then(setBl)
      .catch(() => {})
  }, [machineName, secret])
  const disable = useCallback((): void => {
    void window.decks?.borderless?.stop().then(setBl).catch(() => {})
  }, [])
  /** Push name/secret to the engine live so pairing uses them immediately. */
  const pushConfig = useCallback((patch: { machineName?: string; secret?: string }): void => {
    void window.decks?.borderless?.setConfig(patch).then(setBl).catch(() => {})
  }, [])

  const onName = (v: string): void => {
    setMachineName(v)
    savePersisted({ machineName: v })
    pushConfig({ machineName: v })
  }
  const onSecret = (v: string): void => {
    setSecret(v)
    savePersisted({ secret: v })
    pushConfig({ secret: v })
  }
  const regenerate = (): void => onSecret(randomSecret())

  /* live edge-sensing readout (design "edge sensing" stats) */
  const sensing: { label: string; value: string; hot: boolean }[] = [
    { label: 'Cursor', value: cursor ? `${cursor.x}, ${cursor.y}` : '—', hot: false },
    { label: 'At edge', value: cursor?.edge ?? 'none', hot: !!cursor?.edge },
    {
      label: 'Crossing to',
      value: cursor?.crossingTo ? peers.find((p) => p.id === cursor.crossingTo)?.name ?? 'peer' : '—',
      hot: !!cursor?.crossingTo
    }
  ]

  const inputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    background: 'var(--card-2)',
    border: '1px solid var(--line)',
    borderRadius: 11,
    padding: '10px 13px',
    color: 'var(--ink)',
    fontSize: 13.5,
    outline: 'none'
  }

  return (
    <div className="rise" style={{ position: 'relative', maxWidth: 1000, margin: '0 auto', padding: '24px 26px 80px' }}>
      {/* warm header wash */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 300, background: `linear-gradient(${T.wash}, transparent)`, pointerEvents: 'none' }} />

      <div style={{ position: 'relative' }}>
        {/* header + status chip */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
          <div>
            <h1 className="disp" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em' }}>
              Borderless
            </h1>
            <p style={{ fontSize: 14.5, color: 'var(--ink-2)', marginTop: 6 }}>One keyboard and mouse for every computer on your desk.</p>
          </div>
          <span
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              borderRadius: 999,
              background: running ? 'color-mix(in oklch, var(--pos) 14%, transparent)' : 'var(--card-2)',
              color: running ? 'var(--pos)' : 'var(--ink-3)'
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 99, background: running ? 'var(--pos)' : 'var(--ink-3)' }} />
            {running ? (pairedCount > 0 ? `${pairedCount} paired · on` : 'On · discovering') : 'Off'}
          </span>
        </div>

        {/* what it is — pitch panel with the three pillars (design 868–870) */}
        <div style={{ borderRadius: 18, background: `linear-gradient(135deg, ${T.wash}, var(--card))`, border: `1px solid ${T.line}`, padding: 22, marginBottom: 16 }}>
          <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: 720 }}>
            Push your cursor off the edge of one screen and it lands on the next machine —{' '}
            <b style={{ color: 'var(--ink)' }}>keyboard, shortcuts, and clipboard follow it.</b> No KVM switch, no second keyboard. Every keystroke
            end-to-end encrypted.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 18 }}>
            {[
              ['arrowR', 'Cross at the edges', 'Cursor moves between machines at a shared screen edge.'],
              ['command', 'Input follows', 'Keyboard + shortcuts route to whichever machine the cursor is on.'],
              ['shield', 'Encrypted + paired', 'A shared secret pairs machines; nothing crosses in plaintext.']
            ].map(([ic, ti, bo]) => (
              <div key={ti} style={{ display: 'flex', gap: 11 }}>
                <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, display: 'grid', placeItems: 'center', background: T.soft, color: T.bright }}>
                  <Icon name={ic} size={16} stroke={2} />
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{ti}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.5 }}>{bo}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* enable / status banner — honest about the native agent */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '14px 18px',
            borderRadius: 14,
            background: running ? 'color-mix(in oklch, var(--pos) 9%, transparent)' : T.soft,
            border: `1px solid ${running ? 'color-mix(in oklch, var(--pos) 28%, transparent)' : T.line}`,
            marginBottom: 16
          }}
        >
          <Icon name={running ? 'check' : 'bolt'} size={20} stroke={2} style={{ color: running ? 'var(--pos)' : T.bright, flex: '0 0 auto' }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>
            {running
              ? 'Borderless is on — discovering machines on your network and sensing cursor edges live.'
              : 'Borderless is off. Enable it to discover machines on your LAN, pair them with a shared secret, and sense cursor crossings.'}
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>
              Discovery, pairing &amp; sensing run in-app. Actually moving control to another machine (suppressing local input + injecting on the remote)
              needs the native Borderless agent.
            </div>
          </div>
          {running ? (
            <button
              className="tap"
              onClick={disable}
              style={{ flex: '0 0 auto', padding: '9px 16px', borderRadius: 12, background: 'var(--card-2)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 13, fontWeight: 700 }}
            >
              Disable
            </button>
          ) : (
            <button
              className="tap"
              onClick={enable}
              style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 17px', borderRadius: 12, background: `linear-gradient(140deg, ${T.bright}, ${T.deep})`, color: T.ink, fontSize: 13.5, fontWeight: 700, boxShadow: `0 10px 26px -10px ${T.line}` }}
            >
              <Icon name="bolt" size={16} stroke={2} />
              Enable Borderless
            </button>
          )}
        </div>

        {/* live edge sensing readout */}
        <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
            <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, display: 'grid', placeItems: 'center', background: T.soft, color: T.bright }}>
              <Icon name="target" size={17} stroke={2} />
            </div>
            <div>
              <div className="disp" style={{ fontSize: 16, fontWeight: 700 }}>Live edge sensing</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
                {running ? 'Move your cursor to a screen edge — detection is real-time.' : 'Enable Borderless to start sensing.'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            {sensing.map((stat) => (
              <div key={stat.label}>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</div>
                <div className="mono disp" style={{ fontSize: 19, fontWeight: 800, marginTop: 4, color: stat.hot ? T.bright : 'var(--ink)' }}>
                  {stat.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* the desk-layout canvas — real monitors + live cursor */}
        <div style={{ marginBottom: 16 }}>
          <LayoutCanvas cursor={cursor} />
        </div>

        {/* two-up: this machine (name + secret) | machines on the network */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* this machine */}
          <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 20 }}>
            <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>This machine</div>

            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 650, color: 'var(--ink-2)', marginBottom: 6 }}>Machine name</label>
            <input value={machineName} onChange={(e) => onName(e.target.value)} placeholder="This PC" style={inputStyle} />
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.4 }}>How this PC shows up to the others on the network.</div>

            <div style={{ height: 1, background: 'var(--line)', margin: '16px 0' }} />

            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 650, color: 'var(--ink-2)', marginBottom: 6 }}>Pairing secret</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={secret} onChange={(e) => onSecret(e.target.value)} placeholder="set a shared secret…" className="mono" style={inputStyle} />
              <button
                className="tap"
                onClick={regenerate}
                title="Regenerate"
                style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 13px', borderRadius: 11, background: 'var(--card-2)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 600 }}
              >
                <Icon name="refresh" size={15} stroke={2} />
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 5, lineHeight: 1.4 }}>
              Both machines must share this EXACT secret to pair. Discovery on the LAN is automatic; the secret grants trust.
            </div>

            <div style={{ height: 1, background: 'var(--line)', margin: '16px 0' }} />

            <Row icon="lock" title="End-to-end encryption" sub="Every keystroke and clip is encrypted on the wire.">
              <StatusPill icon="check" label="Always on" color="var(--pos)" bg="color-mix(in oklch, var(--pos) 14%, transparent)" />
            </Row>
          </div>

          {/* machines on your network — live peers, pair / unpair */}
          <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
              <div className="disp" style={{ fontSize: 16, fontWeight: 700 }}>Machines on your network</div>
              <button
                className="tap"
                onClick={() => void window.decks?.borderless?.state().then(setBl).catch(() => {})}
                title="Rescan"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, background: 'var(--card-2)', border: '1px solid var(--line)', color: 'var(--ink-3)', fontSize: 12, fontWeight: 600 }}
              >
                <Icon name="refresh" size={14} stroke={2} />
                Rescan
              </button>
            </div>

            {peers.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 2px', lineHeight: 1.5 }}>
                {running
                  ? 'Searching the network… open Borderless on another machine to see it here.'
                  : 'Enable Borderless to discover machines on your network.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {peers.map((p) => (
                  <div
                    key={p.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 13, background: 'var(--card-2)', opacity: p.online || p.paired ? 1 : 0.55 }}
                  >
                    <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--card-3)', color: p.paired ? T.bright : 'var(--ink-2)' }}>
                      <Icon name="core" size={16} stroke={2} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 650 }}>{p.name}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.connState === 'error' ? p.error ?? 'Pairing failed' : p.host ? `${p.host}:${p.port}` : p.online ? 'online' : 'offline'}
                      </div>
                    </div>
                    {p.paired ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
                        <StatusPill icon="check" label="Paired" color="var(--pos)" bg="color-mix(in oklch, var(--pos) 15%, transparent)" />
                        <button
                          className="tap"
                          onClick={() => void window.decks?.borderless?.unpair(p.id).catch(() => {})}
                          style={{ padding: '6px 11px', borderRadius: 10, background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-3)', fontSize: 12, fontWeight: 600 }}
                        >
                          Unpair
                        </button>
                      </div>
                    ) : p.connState === 'pairing' ? (
                      <StatusPill icon="hourglass" label="Pairing…" color={T.bright} bg={T.soft} />
                    ) : (
                      <button
                        className="tap"
                        disabled={!secret || !p.online}
                        title={!secret ? 'Set a pairing secret first' : undefined}
                        onClick={() => void window.decks?.borderless?.pair(p.id).catch(() => {})}
                        style={{
                          flex: '0 0 auto',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 13px',
                          borderRadius: 10,
                          background: !secret || !p.online ? 'var(--card-3)' : T.soft,
                          color: !secret || !p.online ? 'var(--ink-3)' : T.bright,
                          border: 'none',
                          fontSize: 12.5,
                          fontWeight: 700,
                          cursor: !secret || !p.online ? 'not-allowed' : 'pointer'
                        }}
                      >
                        <Icon name={p.connState === 'error' ? 'refresh' : 'link'} size={14} stroke={2} />
                        {p.connState === 'error' ? 'Retry' : 'Pair'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* honest limitations (design known-limits banner) */}
        <div style={{ marginTop: 16, display: 'flex', gap: 11, padding: '14px 18px', borderRadius: 14, background: 'var(--card)', border: '1px solid var(--line)' }}>
          <Icon name="info" size={17} stroke={2} style={{ color: 'var(--ink-3)', flex: '0 0 auto', marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            <b style={{ color: 'var(--ink-2)' }}>Known limits (by design):</b> Ctrl + Alt + Del / the secure attention sequence is reserved by Windows and
            can&rsquo;t be forwarded. Some games that read raw input or use anti-cheat may ignore injected input. And because Borderless installs a
            global input hook, antivirus may prompt on first run — the binary is code-signed.
          </div>
        </div>
      </div>
    </div>
  )
}
