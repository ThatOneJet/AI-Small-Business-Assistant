/* ============================================================
   JetCore — Borderless (software KVM control surface).

   One keyboard & mouse drive every machine on the desk: the cursor crosses screen
   edges between separate computers as if they were one desktop, and keyboard +
   clipboard follow it. This screen is the CONTROL SURFACE — it describes the
   feature and hosts every setting. The capture/inject/transport itself lives in
   the companion "Borderless agent" (a Windows service); when it isn't installed
   the screen shows a setup banner but the layout + preferences are still editable
   and persist locally (jc.borderless), ready for the agent to pick up.

   The layout view reads THIS machine's REAL monitors from the OS (Electron's
   screen API — same source as Windows Display settings / Wallpaper Engine) and
   draws them to true position and proportion.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Badge, Button, Card, Divider, Field, Input, SectionTitle, Segmented, Toggle } from '../../ui'
import { AnimatedList, Reveal, SpotlightCard } from '../../motion'
import { Icon } from '../../icons'
import type { JCScreenProps } from '../../contract'
import type { DisplayInfo, BorderlessState, BorderlessCursorEvent } from '@shared/ipc'

/* ── persisted settings ──────────────────────────────────────────────── */

const SETTINGS_KEY = 'jc.borderless'

type Role = 'auto' | 'controller' | 'target'
type ClipScope = 'text' | 'images' | 'files'

interface BorderlessSettings {
  role: Role
  machineName: string
  secret: string
  wrapEdges: boolean
  parkCursor: boolean
  releaseModifiers: boolean
  followKeyboard: boolean
  clipboard: boolean
  clipScope: ClipScope
  tickHz: number
  runAsService: boolean
}

const DEFAULTS: BorderlessSettings = {
  role: 'auto',
  machineName: 'This PC',
  secret: '',
  wrapEdges: false,
  parkCursor: true,
  releaseModifiers: true,
  followKeyboard: true,
  clipboard: true,
  clipScope: 'text',
  tickHz: 360,
  runAsService: false
}

function loadSettings(): BorderlessSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<BorderlessSettings>) }
  } catch {
    /* ignore — fall back to defaults */
  }
  return DEFAULTS
}

/* ── layout: THIS machine's real monitors ────────────────────────────────
   The hard part of a KVM — how separate machines sit relative to each other —
   can't be sensed and is declared by the user. But each machine's OWN monitors
   ARE knowable: we read them straight from the OS and draw them to true position
   and proportion (resolution, arrangement, primary). Peer machines appear here
   too once the agent reports their topology. */

const resLabel = (d: DisplayInfo): string =>
  `${Math.round(d.width * d.scaleFactor)} × ${Math.round(d.height * d.scaleFactor)}`

function LayoutCanvas({ cursor }: { cursor: BorderlessCursorEvent | null }): JSX.Element {
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null)
  const [cursorPt, setCursorPt] = useState<{ x: number; y: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(880)
  const CH = 360

  const refresh = useCallback((): void => {
    void window.decks
      ?.displays?.()
      .then((d) => setDisplays(d))
      .catch(() => setDisplays([]))
  }, [])
  useEffect(() => refresh(), [refresh])

  // Always-on cursor poll so you can see your mouse on the layout even before
  // enabling Borderless — handy for placing a new device and for troubleshooting.
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      void window.decks
        ?.cursorPoint?.()
        .then((p) => {
          if (alive) setCursorPt(p)
        })
        .catch(() => {
          if (alive) setCursorPt(null)
        })
    }
    tick()
    const id = window.setInterval(tick, 40)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  // Measure the canvas so monitors fit to scale without distortion.
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

  const pad = 40
  const scale = box ? Math.min((cw - pad * 2) / box.w, (CH - pad * 2) / box.h) : 1
  const offX = box ? (cw - box.w * scale) / 2 : 0
  const offY = box ? (CH - box.h * scale) / 2 : 0
  const count = displays?.length ?? 0

  return (
    <Card pad={0}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
            <Icon name="core" size={17} />
          </div>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>This PC — desk layout</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {count ? `${count} monitor${count === 1 ? '' : 's'}, auto-detected from your OS` : 'Reading your monitors…'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="surface" size="sm" icon="target">Edge calibration</Button>
          <Button variant="surface" size="sm" icon="refresh" onClick={refresh}>Refresh</Button>
        </div>
      </div>

      <div
        ref={wrapRef}
        style={{
          position: 'relative',
          height: CH,
          overflow: 'hidden',
          background:
            'repeating-linear-gradient(0deg, transparent, transparent 23px, var(--border) 23px, var(--border) 24px), repeating-linear-gradient(90deg, transparent, transparent 23px, var(--border) 23px, var(--border) 24px)',
          backgroundColor: 'var(--bg)',
          borderBottomLeftRadius: 'var(--r-lg)',
          borderBottomRightRadius: 'var(--r-lg)'
        }}
      >
        {displays === null && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            Reading your displays…
          </div>
        )}
        {displays && displays.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 13 }}>
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
                  background: d.primary ? 'color-mix(in oklch, var(--accent) 16%, var(--surface))' : 'var(--surface-2)',
                  border: `2px solid ${d.primary ? 'var(--accent)' : 'var(--accent-line)'}`,
                  boxShadow: '0 12px 26px -16px hsl(var(--shadow-c) / .6)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: 6,
                  overflow: 'hidden'
                }}
              >
                <span style={{ position: 'absolute', top: 5, left: 8, fontSize: 11, fontWeight: 800, color: 'var(--accent-h)' }}>{i + 1}</span>
                <span className="mono" style={{ fontSize: Math.max(9, Math.min(13, w * 0.085)), fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {resLabel(d)}
                </span>
                {(d.primary || d.internal) && w > 80 && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                    {d.primary ? 'Primary' : ''}{d.primary && d.internal ? ' · ' : ''}{d.internal ? 'Built-in' : ''}
                  </span>
                )}
              </div>
            )
          })}

        {/* Live mouse pointer — shows where the cursor is right now, so you can
            see which screen it's on and watch it approach the hand-off edge. */}
        {box && cursorPt && (() => {
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
                <span
                  style={{
                    position: 'absolute',
                    left: -9,
                    top: -9,
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    opacity: 0.28,
                    filter: 'blur(1px)'
                  }}
                />
              )}
              <svg width="19" height="19" viewBox="0 0 16 16" style={{ position: 'relative', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.55))' }}>
                <path
                  d="M2 1 L2 14 L5.3 10.9 L7.6 15 L9.9 13.9 L7.6 9.9 L12 9.9 Z"
                  fill="var(--accent)"
                  stroke="#fff"
                  strokeWidth="0.9"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )
        })()}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-3)' }}>
        <Icon name={cursorPt ? 'target' : 'info'} size={14} />
        {cursorPt ? (
          <span className="mono">
            Mouse at {cursorPt.x}, {cursorPt.y}
            {cursor?.edge ? ` · at ${cursor.edge} edge` : ''}
            {cursor?.crossingTo ? ` · crossing →` : ''}
          </span>
        ) : (
          'Locating your cursor… if it never appears, your OS may be blocking cursor reads.'
        )}
      </div>
    </Card>
  )
}

/* ── a labelled settings row (toggle / control on the right) ──────────── */

function Row({ icon, title, sub, children }: { icon: string; title: string; sub: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 2px' }}>
      <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
        <Icon name={icon} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 1, lineHeight: 1.45 }}>{sub}</div>
      </div>
      <div style={{ flex: '0 0 auto' }}>{children}</div>
    </div>
  )
}

/* ── the screen ──────────────────────────────────────────────────────── */

export function BorderlessScreen(props: JCScreenProps): JSX.Element {
  void props
  const [s, setS] = useState<BorderlessSettings>(loadSettings)
  const update = useCallback(<K extends keyof BorderlessSettings>(key: K, value: BorderlessSettings[K]): void => {
    setS((prev) => {
      const next = { ...prev, [key]: value }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // Live engine state (discovery + pairing) and cursor-edge sensing, streamed
  // from the main process over IPC.
  const [bl, setBl] = useState<BorderlessState | null>(null)
  const [cursor, setCursor] = useState<BorderlessCursorEvent | null>(null)
  useEffect(() => {
    let alive = true
    void window.decks?.borderless?.state().then((st) => alive && setBl(st)).catch(() => {})
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
    void window.decks?.borderless?.start({ machineName: s.machineName || 'This PC', secret: s.secret }).then(setBl).catch(() => {})
  }, [s.machineName, s.secret])
  const disable = useCallback((): void => {
    void window.decks?.borderless?.stop().then(setBl).catch(() => {})
  }, [])
  /** Push name/secret to the engine as they change (so pairing uses them live). */
  const pushConfig = useCallback((patch: { machineName?: string; secret?: string }): void => {
    void window.decks?.borderless?.setConfig(patch).then(setBl).catch(() => {})
  }, [])
  const randomSecret = (): string =>
    ['otter', 'marble', 'cobalt', 'ember', 'willow', 'quartz', 'cedar', 'maple'][Math.floor(Math.random() * 8)] +
    '-' +
    ['river', 'fox', 'echo', 'drift', 'north', 'flint', 'haze', 'sol'][Math.floor(Math.random() * 8)] +
    '-' +
    String(1000 + Math.floor(Math.random() * 9000))

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 40px 64px' }}>
      {/* header */}
      <Reveal>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.025em' }}>Borderless</h1>
            <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>
              One keyboard and mouse for every computer on your desk.
            </p>
          </div>
          <Badge tone={running ? 'pos' : 'neutral'} icon={running ? 'check' : 'info'}>
            {running ? (pairedCount > 0 ? `${pairedCount} paired` : 'On · discovering') : 'Off'}
          </Badge>
        </div>
      </Reveal>

      {/* what it is */}
      <Reveal delay={60}>
        <SpotlightCard
          className="jc-card"
          strength={0.08}
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 24, marginBottom: 18 }}
        >
          <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.65, maxWidth: 760 }}>
            Borderless turns 2–4 Windows machines on the same network into one seamless desk. Push your cursor off
            the edge of one screen and it lands on the next machine — your <strong style={{ color: 'var(--text)' }}>keyboard,
            shortcuts, and clipboard follow it</strong>. No KVM switch, no second keyboard. Every keystroke is
            end-to-end encrypted, and the headline trick is setup: each machine auto-detects its own monitors to real
            physical proportions, so all you do is drag the machine-blocks into place once.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginTop: 20 }}>
            {[
              { icon: 'arrowR', title: 'Cross at the edges', body: 'The cursor moves between machines by hitting a shared screen edge you define.' },
              { icon: 'command', title: 'Input follows', body: 'Keyboard, modifiers, and shortcuts route to whichever machine the cursor is on.' },
              { icon: 'shield', title: 'Encrypted + paired', body: 'A shared secret pairs machines; nothing — keys or clipboard — ever crosses in plaintext.' }
            ].map((f) => (
              <div key={f.title} style={{ display: 'flex', gap: 11 }}>
                <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
                  <Icon name={f.icon} size={16} />
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{f.title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.5 }}>{f.body}</div>
                </div>
              </div>
            ))}
          </div>
        </SpotlightCard>
      </Reveal>

      {/* enable / status banner */}
      <Reveal delay={90}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 'var(--r-md)', background: running ? 'color-mix(in oklch, var(--pos) 9%, transparent)' : 'var(--accent-soft)', border: `1px solid ${running ? 'color-mix(in oklch, var(--pos) 28%, transparent)' : 'var(--accent-line)'}`, marginBottom: 18 }}>
          <Icon name={running ? 'check' : 'bolt'} size={20} style={{ color: running ? 'var(--pos)' : 'var(--accent-h)', flex: '0 0 auto' }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
            {running
              ? 'Borderless is on — discovering machines on your network and sensing cursor edges live.'
              : 'Borderless is off. Enable it to discover machines on your LAN, pair them with a shared secret, and sense cursor crossings.'}
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
              Discovery, pairing &amp; sensing run in-app. Actually moving control to another machine (suppressing local
              input + injecting on the remote) needs the native Borderless agent.
            </div>
          </div>
          {running ? (
            <Button variant="surface" size="sm" onClick={disable}>Disable</Button>
          ) : (
            <Button variant="primary" size="sm" icon="bolt" onClick={enable}>Enable Borderless</Button>
          )}
        </div>
      </Reveal>

      {/* live edge sensing */}
      <Reveal delay={105}>
        <Card style={{ marginBottom: 18 }}>
          <SectionTitle
            icon="target"
            title="Live edge sensing"
            sub={running ? 'Move your cursor to a screen edge — detection is real-time.' : 'Enable Borderless to start sensing.'}
          />
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {[
              { label: 'Cursor', value: cursor ? `${cursor.x}, ${cursor.y}` : '—', hot: false },
              { label: 'At edge', value: cursor?.edge ?? 'none', hot: !!cursor?.edge },
              {
                label: 'Crossing to',
                value: cursor?.crossingTo ? peers.find((p) => p.id === cursor.crossingTo)?.name ?? 'peer' : '—',
                hot: !!cursor?.crossingTo
              }
            ].map((stat) => (
              <div key={stat.label}>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</div>
                <div className="mono" style={{ fontSize: 19, fontWeight: 800, marginTop: 4, color: stat.hot ? 'var(--accent-h)' : 'var(--text)' }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </Card>
      </Reveal>

      {/* layout — this machine's real monitors */}
      <Reveal delay={120}>
        <div style={{ marginBottom: 18 }}>
          <LayoutCanvas cursor={cursor} />
        </div>
      </Reveal>

      {/* settings grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* this machine */}
        <Reveal delay={150}>
          <Card>
            <SectionTitle icon="core" title="This machine" sub="How this PC behaves on the desk" />
            <Field label="Machine name" hint="How this PC shows up to the others on the network.">
              <Input
                value={s.machineName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  update('machineName', e.target.value)
                  pushConfig({ machineName: e.target.value })
                }}
                placeholder="This PC"
              />
            </Field>
            <div style={{ marginTop: 14 }}>
              <Field label="Role" hint="Auto lets whichever machine you’re typing on take control.">
                <Segmented
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'controller', label: 'Controller' },
                    { value: 'target', label: 'Target' }
                  ]}
                  value={s.role}
                  onChange={(v) => update('role', v as Role)}
                  size="sm"
                  full
                />
              </Field>
            </div>
          </Card>
        </Reveal>

        {/* input & edges */}
        <Reveal delay={180}>
          <Card>
            <SectionTitle icon="command" title="Input & edges" sub="How the cursor and keys cross" />
            <Row icon="arrowR" title="Follow keyboard to cursor" sub="Type on whichever machine the cursor is on.">
              <Toggle checked={s.followKeyboard} onChange={(v) => update('followKeyboard', v)} />
            </Row>
            <Divider />
            <Row icon="refresh" title="Wrap around edges" sub="Crossing the far edge loops back to the first machine.">
              <Toggle checked={s.wrapEdges} onChange={(v) => update('wrapEdges', v)} />
            </Row>
            <Divider />
            <Row icon="target" title="Park cursor when remote" sub="Pin the local cursor while you drive another machine.">
              <Toggle checked={s.parkCursor} onChange={(v) => update('parkCursor', v)} />
            </Row>
            <Divider />
            <Row icon="bolt" title="Auto-release stuck modifiers" sub="Replay key-ups on every hand-off — no more stuck Shift.">
              <Toggle checked={s.releaseModifiers} onChange={(v) => update('releaseModifiers', v)} />
            </Row>
          </Card>
        </Reveal>

        {/* shared clipboard */}
        <Reveal delay={210}>
          <Card>
            <SectionTitle icon="copy" title="Shared clipboard" sub="Copy on one machine, paste on another" />
            <Row icon="copy" title="Sync clipboard" sub="Keep the clipboard shared across paired machines.">
              <Toggle checked={s.clipboard} onChange={(v) => update('clipboard', v)} />
            </Row>
            {s.clipboard && (
              <div style={{ marginTop: 12 }}>
                <Field label="What to sync" hint="Text is instant; images and files use the reliable channel.">
                  <Segmented
                    options={[
                      { value: 'text', label: 'Text' },
                      { value: 'images', label: '+ Images' },
                      { value: 'files', label: '+ Files' }
                    ]}
                    value={s.clipScope}
                    onChange={(v) => update('clipScope', v as ClipScope)}
                    size="sm"
                    full
                  />
                </Field>
              </div>
            )}
          </Card>
        </Reveal>

        {/* performance */}
        <Reveal delay={240}>
          <Card>
            <SectionTitle icon="spark" title="Performance" sub="Tuned for sub-5ms LAN hand-off" />
            <div style={{ padding: '4px 2px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>Mouse update rate</span>
                <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent-h)' }}>{s.tickHz} Hz</span>
              </div>
              <input
                type="range"
                min={120}
                max={500}
                step={20}
                value={s.tickHz}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update('tickHz', Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
              <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginTop: 5 }}>
                <span>120 Hz</span>
                <span>500 Hz</span>
              </div>
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <Row icon="bolt" title="Low-latency mode" sub="Nagle off (TCP_NODELAY) so tiny input packets aren’t buffered.">
              <Badge tone="pos" size="sm" icon="check">Always on</Badge>
            </Row>
          </Card>
        </Reveal>

        {/* security & service */}
        <Reveal delay={270}>
          <Card>
            <SectionTitle icon="shield" title="Security & service" sub="Pairing, encryption, system access" />
            <Row icon="lock" title="End-to-end encryption" sub="Every keystroke and clip is encrypted on the wire.">
              <Badge tone="pos" size="sm" icon="check">Always on</Badge>
            </Row>
            <Divider />
            <Row icon="gear" title="Run as Windows service" sub="System-level capture so UAC prompts & the lock screen work too.">
              <Toggle checked={s.runAsService} onChange={(v) => update('runAsService', v)} />
            </Row>
            {s.runAsService && (
              <div style={{ marginTop: 10, display: 'flex', gap: 9, padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'color-mix(in oklch, var(--warn) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--warn) 30%, transparent)' }}>
                <Icon name="alert" size={15} style={{ color: 'var(--warn)', flex: '0 0 auto', marginTop: 1 }} />
                <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
                  Running under LocalSystem is more powerful but a bigger attack surface — only enable it on machines you trust.
                </span>
              </div>
            )}
            <Divider style={{ margin: '12px 0' }} />
            <Field label="Pairing secret" hint="Both machines must share this EXACT secret to pair. Discovery on the LAN is automatic; the secret is what grants trust.">
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={s.secret}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    update('secret', e.target.value)
                    pushConfig({ secret: e.target.value })
                  }}
                  placeholder="set a shared secret…"
                  style={{ flex: 1 }}
                  className="mono"
                />
                <Button
                  variant="surface"
                  size="sm"
                  icon="refresh"
                  onClick={() => {
                    const v = randomSecret()
                    update('secret', v)
                    pushConfig({ secret: v })
                  }}
                >
                  Regenerate
                </Button>
              </div>
            </Field>
          </Card>
        </Reveal>

        {/* machines on network */}
        <Reveal delay={300}>
          <Card>
            <SectionTitle
              icon="grid"
              title="Machines on your network"
              sub="Discovered over the LAN — pair with the secret"
              action={<Button variant="ghost" size="sm" icon="refresh" onClick={() => void window.decks?.borderless?.state().then(setBl)}>Rescan</Button>}
            />
            {peers.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '14px 2px', lineHeight: 1.5 }}>
                {running ? 'Searching the network… open Borderless on another machine to see it here.' : 'Enable Borderless to discover machines on your network.'}
              </div>
            ) : (
              <AnimatedList stagger={40} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {peers.map((p) => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', opacity: p.online || p.paired ? 1 : 0.55 }}>
                    <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--surface-3)', color: p.paired ? 'var(--accent-h)' : 'var(--text-2)' }}>
                      <Icon name="core" size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 650 }}>{p.name}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.connState === 'error' ? p.error ?? 'Pairing failed' : p.host ? `${p.host}:${p.port}` : p.online ? 'online' : 'offline'}
                      </div>
                    </div>
                    {p.paired ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Badge tone="pos" size="sm" icon="check">Paired</Badge>
                        <Button variant="ghost" size="sm" onClick={() => void window.decks?.borderless?.unpair(p.id)}>Unpair</Button>
                      </div>
                    ) : p.connState === 'pairing' ? (
                      <Badge tone="accent" size="sm" icon="hourglass">Pairing…</Badge>
                    ) : p.connState === 'error' ? (
                      <Button variant="soft" size="sm" icon="refresh" disabled={!s.secret || !p.online} onClick={() => void window.decks?.borderless?.pair(p.id)}>Retry</Button>
                    ) : (
                      <Button variant="soft" size="sm" icon="link" disabled={!s.secret || !p.online} title={!s.secret ? 'Set a pairing secret first' : undefined} onClick={() => void window.decks?.borderless?.pair(p.id)}>
                        Pair
                      </Button>
                    )}
                  </div>
                ))}
              </AnimatedList>
            )}
          </Card>
        </Reveal>
      </div>

      {/* honest limitations */}
      <Reveal delay={330}>
        <div style={{ marginTop: 18, display: 'flex', gap: 11, padding: '14px 18px', borderRadius: 'var(--r-md)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Icon name="info" size={17} style={{ color: 'var(--text-3)', flex: '0 0 auto', marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.55 }}>
            <strong style={{ color: 'var(--text-2)' }}>Known limits (by design):</strong> Ctrl + Alt + Del / the secure
            attention sequence is reserved by Windows and can’t be forwarded. Some games that read raw input or use
            anti-cheat may ignore injected input. And because Borderless installs a global input hook, antivirus may
            prompt on first run — the binary is code-signed.
          </div>
        </div>
      </Reveal>
    </div>
  )
}
