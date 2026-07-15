/**
 * JetCore redesign — Pulse space (feeds & music · rose hue 350).
 *
 * A faithful port of the Claude Design handoff's renderPulse (JetCore.dc.html
 * lines 900–917): a two-column top — a NOW PLAYING player (art, track/artist,
 * progress, transport) on the left, a "Next up" calendar card + a "Notes" card
 * on the right — then a full-width "From your feeds" list below.
 *
 * HONESTY NOTE: there is NO live backend for music / feeds / calendar in this
 * app yet (no OAuth provider, no playback sync). So the design's fabricated
 * track/feed/event sample data is NOT reproduced, and we NEVER invent tracks or
 * posts. Instead each surface renders an honest CONNECT state, and the connect
 * buttons are genuinely FUNCTIONAL:
 *
 *   • clicking Connect persists the user's choice to the E2EE vault under
 *     'pulse.providers' (so the choice survives reloads) and flips that
 *     provider into a "Connecting… — full sync needs the provider integration
 *     (coming)" pending state, and
 *   • opens the provider's real sign-in page in the browser via window.open
 *     (YouTube Music → https://music.youtube.com, Spotify → https://open.spotify.com,
 *     Bluesky → https://bsky.app, etc).
 *
 * When a real provider backend lands, `live` providers report a `NowPlaying` /
 * `FeedItem[]` / `NextEvent`, and the SAME pending cards flip to live data with
 * no structural change (see the `*Provider` seams + ProviderState model below).
 *
 * The NOTES surface is fully working today — local, persisted to the vault under
 * 'pulse.notes'. Add / toggle-done / delete all save immediately.
 *
 * Renders ONLY the scrollable body; the shell renders the 60px chrome.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { Icon } from '../../icons'
import { tone, type Tone } from '../system'

/* ── provider catalogue ──────────────────────────────────────────────────────
 * The set of connectable sources, grouped by surface. Each has a stable id (the
 * vault key references these), a label, an icon, and the real sign-in URL we
 * open in the browser on Connect. When a backend lands it only needs to map
 * these ids to live data — nothing in the UI below changes.
 */
type ProviderSurface = 'music' | 'feed' | 'calendar'

interface ProviderDef {
  id: string
  surface: ProviderSurface
  label: string
  icon: string
  /** Real sign-in / connect page opened in the browser on Connect. */
  url: string
}

const PROVIDERS: ProviderDef[] = [
  { id: 'spotify', surface: 'music', label: 'Spotify', icon: 'music', url: 'https://open.spotify.com' },
  { id: 'youtube-music', surface: 'music', label: 'YouTube Music', icon: 'play', url: 'https://music.youtube.com' },
  { id: 'youtube', surface: 'music', label: 'YouTube', icon: 'play', url: 'https://www.youtube.com' },
  { id: 'bluesky', surface: 'feed', label: 'Bluesky', icon: 'at', url: 'https://bsky.app' },
  { id: 'rss', surface: 'feed', label: 'RSS', icon: 'rss', url: 'https://en.wikipedia.org/wiki/RSS' },
  { id: 'mastodon', surface: 'feed', label: 'Mastodon', icon: 'at', url: 'https://joinmastodon.org/servers' },
  { id: 'calendar', surface: 'calendar', label: 'your calendar', icon: 'calendar', url: 'https://calendar.google.com' }
]

const musicProviders = PROVIDERS.filter((p) => p.surface === 'music')
const feedProviders = PROVIDERS.filter((p) => p.surface === 'feed')
const calendarDef = PROVIDERS.find((p) => p.surface === 'calendar') as ProviderDef

function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/* ── provider connection state (REAL — persisted to the vault) ───────────────
 * A provider the user has connected goes 'pending' (intent recorded, OAuth not
 * wired) until a backend lands, at which point it becomes 'live'. We only ever
 * persist/read 'pending' today — 'live' is reserved for when the seam below
 * starts returning data — but the model is here so that flip is a one-liner.
 */
type ConnStatus = 'pending' | 'live'

const PROVIDERS_KEY = 'pulse.providers'

/** id → connection status for every provider the user has chosen to connect. */
type ProviderState = Record<string, ConnStatus>

/* ── provider data seams (no live source yet) ────────────────────────────────
 * When a real player / feed / calendar provider is wired in, these read live
 * data for connected ('live') providers. Kept null for now so the UI tells the
 * honest truth rather than inventing tracks/feeds/events.
 */
type NowPlaying = { track: string; artist: string; progress: number; playing: boolean } | null
type FeedItem = { id: string; src: string; text: string; when: string; url?: string }
type NextEvent = { title: string; when: string; where: string } | null

const nowPlayingProvider: NowPlaying = null
const feedProvider: FeedItem[] | null = null
const calendarProvider: NextEvent = null

/** Open a provider's real sign-in page in the user's browser. */
function openProvider(def: ProviderDef): void {
  try {
    window.open(def.url, '_blank', 'noopener,noreferrer')
  } catch {
    /* popup blocked / unavailable → the persisted pending state still stands */
  }
}

/**
 * Load/save the user's connected providers as a JSON map in the E2EE vault under
 * PROVIDERS_KEY. `connect(id)` records the intent (→ 'pending'), persists it so
 * it survives reloads, and opens the provider's sign-in page in the browser.
 */
function useVaultProviders(): {
  state: ProviderState
  ready: boolean
  connect: (id: string) => void
  disconnect: (id: string) => void
  statusOf: (id: string) => ConnStatus | undefined
} {
  const [state, setState] = useState<ProviderState>({})
  const [ready, setReady] = useState(false)
  const hydrated = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const raw = await window.decks?.vault?.get(PROVIDERS_KEY)
        if (!alive) return
        if (raw) {
          const parsed = JSON.parse(raw) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const clean: ProviderState = {}
            for (const [id, status] of Object.entries(parsed as Record<string, unknown>)) {
              // Only keep ids we still know about, with a valid status.
              if (providerById(id) && (status === 'pending' || status === 'live')) {
                clean[id] = status
              }
            }
            setState(clean)
          }
        }
      } catch {
        /* corrupt blob or locked vault → start empty; never crash the space */
      } finally {
        if (alive) {
          hydrated.current = true
          setReady(true)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Persist on every change after hydration.
  useEffect(() => {
    if (!hydrated.current) return
    void window.decks?.vault?.set({ key: PROVIDERS_KEY, plaintext: JSON.stringify(state) }).catch(() => {
      /* vault unavailable → keep the choice in memory for this session */
    })
  }, [state])

  const connect = useCallback((id: string) => {
    const def = providerById(id)
    if (!def) return
    // Record intent first so the choice survives even if window.open throws.
    setState((prev) => (prev[id] ? prev : { ...prev, [id]: 'pending' }))
    openProvider(def)
  }, [])

  const disconnect = useCallback((id: string) => {
    setState((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const statusOf = useCallback((id: string): ConnStatus | undefined => state[id], [state])

  return { state, ready, connect, disconnect, statusOf }
}

/* ── notes (REAL — persisted to the vault) ───────────────────────────────── */

const NOTES_KEY = 'pulse.notes'

interface Note {
  id: string
  text: string
  done: boolean
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** Load/save the notes list as a JSON blob in the E2EE vault under NOTES_KEY. */
function useVaultNotes(): {
  notes: Note[]
  ready: boolean
  saved: boolean
  add: (text: string) => void
  toggle: (id: string) => void
  remove: (id: string) => void
} {
  const [notes, setNotes] = useState<Note[]>([])
  const [ready, setReady] = useState(false)
  const [saved, setSaved] = useState(false)
  // Skip persisting the initial hydrate; only writes after first mount persist.
  const hydrated = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const raw = await window.decks?.vault?.get(NOTES_KEY)
        if (!alive) return
        if (raw) {
          const parsed = JSON.parse(raw) as unknown
          if (Array.isArray(parsed)) {
            setNotes(
              parsed
                .filter((n): n is Note => !!n && typeof (n as Note).id === 'string' && typeof (n as Note).text === 'string')
                .map((n) => ({ id: n.id, text: n.text, done: !!n.done }))
            )
          }
        }
      } catch {
        /* corrupt blob or locked vault → start empty; never crash the space */
      } finally {
        if (alive) {
          hydrated.current = true
          setReady(true)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Persist on every change after hydration.
  useEffect(() => {
    if (!hydrated.current) return
    let alive = true
    void (async () => {
      try {
        await window.decks?.vault?.set({ key: NOTES_KEY, plaintext: JSON.stringify(notes) })
        if (!alive) return
        setSaved(true)
        window.setTimeout(() => {
          if (alive) setSaved(false)
        }, 1600)
      } catch {
        /* vault unavailable → keep notes in memory for this session */
      }
    })()
    return () => {
      alive = false
    }
  }, [notes])

  const add = useCallback((text: string) => {
    const t = text.trim()
    if (!t) return
    setNotes((prev) => [{ id: makeId(), text: t, done: false }, ...prev])
  }, [])
  const toggle = useCallback((id: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, done: !n.done } : n)))
  }, [])
  const remove = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }, [])

  return { notes, ready, saved, add, toggle, remove }
}

/* ── small primitives (design tabPlain / card2) ──────────────────────────── */

/** A flat, uppercased section pill (design's tabPlain). */
function TabPlain({ label, t, icon }: { label: string; t: Tone; icon?: string }): JSX.Element {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        color: t.bright,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '.12em'
      }}
    >
      {icon ? <Icon name={icon} size={13} stroke={2} /> : null}
      {label}
    </span>
  )
}

/** A titled soft card (design's card2). */
function Card2({ title, children }: { title: string; children: JSX.Element }): JSX.Element {
  return (
    <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 18 }}>
      <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

/** A functional "connect this provider" CTA chip. Clicking records the choice
 *  to the vault and opens the provider's sign-in page. While pending it shows a
 *  spinner-less "Connecting…" affordance with a tap-to-dismiss. */
function ConnectChip({
  def,
  status,
  onConnect,
  onDisconnect,
  t
}: {
  def: ProviderDef
  status: ConnStatus | undefined
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
  t: Tone
}): JSX.Element {
  const pending = status === 'pending'
  const live = status === 'live'

  if (pending || live) {
    return (
      <button
        className="tap"
        type="button"
        onClick={() => onDisconnect(def.id)}
        title={live ? `Disconnect ${def.label}` : `${def.label} — connecting; tap to undo`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '9px 15px',
          borderRadius: 12,
          background: t.soft,
          border: `1px solid ${t.line}`,
          color: t.bright,
          fontWeight: 700,
          fontSize: 13.5,
          whiteSpace: 'nowrap',
          cursor: 'pointer'
        }}
      >
        <Icon name={live ? 'check' : def.icon} size={15} stroke={2} />
        {live ? `${def.label} connected` : `Connecting ${def.label}…`}
      </button>
    )
  }

  return (
    <button
      className="tap"
      type="button"
      onClick={() => onConnect(def.id)}
      title={`Connect ${def.label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '9px 15px',
        borderRadius: 12,
        border: 'none',
        background: `linear-gradient(140deg,${t.bright},${t.deep})`,
        color: t.ink,
        fontWeight: 700,
        fontSize: 13.5,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        boxShadow: `0 10px 24px -12px ${t.line}`
      }}
    >
      <Icon name={def.icon} size={15} stroke={2} />
      {`Connect ${def.label}`}
    </button>
  )
}

/* ── space head (design spaceHead) ───────────────────────────────────────── */

function SpaceHead({ title, sub }: { title: string; sub: string }): JSX.Element {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 className="disp" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.04 }}>{title}</h1>
      <p style={{ fontSize: 15.5, color: 'var(--ink-2)', marginTop: 9, maxWidth: 620, lineHeight: 1.45 }}>{sub}</p>
    </div>
  )
}

/* ── now-playing card ────────────────────────────────────────────────────── */

function NowPlayingCard({
  t,
  statusOf,
  connect,
  disconnect
}: {
  t: Tone
  statusOf: (id: string) => ConnStatus | undefined
  connect: (id: string) => void
  disconnect: (id: string) => void
}): JSX.Element {
  const np = nowPlayingProvider
  // The first music provider the user has put into a pending/live state (if any).
  const connecting = musicProviders.find((p) => statusOf(p.id))

  return (
    <div style={{ borderRadius: 20, background: `linear-gradient(140deg, ${t.wash}, var(--card))`, border: `1px solid ${t.line}`, padding: 22 }}>
      <TabPlain label="NOW PLAYING · MUSIC" t={t} icon="music" />

      {np ? (
        <>
          <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'center' }}>
            <div style={{ width: 84, height: 84, borderRadius: 14, background: `linear-gradient(140deg,${t.bright},${t.deep})`, color: t.ink, display: 'grid', placeItems: 'center', flex: '0 0 auto' }}>
              <Icon name="music" size={36} stroke={2} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="disp" style={{ fontSize: 20, fontWeight: 700 }}>{np.track}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 2 }}>{np.artist}</div>
            </div>
          </div>
          <div style={{ height: 5, borderRadius: 99, background: 'var(--card-3)', margin: '20px 0 8px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: np.progress * 100 + '%', background: t.bright, borderRadius: 99 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 12, color: 'var(--ink-2)' }}>
            <Icon name="chevL" size={22} stroke={2} />
            <span style={{ width: 46, height: 46, borderRadius: 99, display: 'grid', placeItems: 'center', background: t.bright, color: t.ink }}>
              <Icon name={np.playing ? 'pause' : 'play'} size={20} fill="currentColor" />
            </span>
            <Icon name="chevR" size={22} stroke={2} />
          </div>
        </>
      ) : (
        /* HONEST connect state — no fabricated track */
        <div style={{ display: 'flex', gap: 16, marginTop: 16, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 14,
              border: `1.5px dashed ${t.line}`,
              color: t.bright,
              display: 'grid',
              placeItems: 'center',
              flex: '0 0 auto',
              background: t.wash
            }}
          >
            <Icon name="music" size={34} stroke={2} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            {connecting ? (
              <>
                <div className="disp" style={{ fontSize: 19, fontWeight: 700 }}>Connecting {connecting.label}…</div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45, maxWidth: 260 }}>
                  We opened {connecting.label} in your browser to sign in. Full playback sync needs the provider integration (coming).
                </div>
              </>
            ) : (
              <>
                <div className="disp" style={{ fontSize: 19, fontWeight: 700 }}>Nothing playing</div>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45, maxWidth: 260 }}>
                  Connect Spotify, YouTube Music or YouTube to see what’s playing and control it from here.
                </div>
              </>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 13 }}>
              {musicProviders.map((p) => (
                <ConnectChip key={p.id} def={p} status={statusOf(p.id)} onConnect={connect} onDisconnect={disconnect} t={t} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── next-up (calendar) card ─────────────────────────────────────────────── */

function NextUpCard({
  t,
  statusOf,
  connect,
  disconnect
}: {
  t: Tone
  statusOf: (id: string) => ConnStatus | undefined
  connect: (id: string) => void
  disconnect: (id: string) => void
}): JSX.Element {
  const ev = calendarProvider
  const status = statusOf(calendarDef.id)
  const pending = status === 'pending'

  return (
    <Card2 title="Next up">
      {ev ? (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{ev.title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>{ev.when + ' · ' + ev.where}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: t.soft, color: t.bright, flex: '0 0 auto' }}>
            <Icon name="calendar" size={18} stroke={2} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            {pending ? (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>Connecting your calendar…</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>Sync needs the provider integration (coming)</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>Connect your calendar</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>Your next event will show here</div>
              </>
            )}
          </div>
          <button
            className="tap"
            type="button"
            onClick={() => (pending ? disconnect(calendarDef.id) : connect(calendarDef.id))}
            title={pending ? 'Connecting — tap to undo' : 'Connect your calendar'}
            style={{
              flex: '0 0 auto',
              display: 'grid',
              placeItems: 'center',
              width: 32,
              height: 32,
              borderRadius: 9,
              border: pending ? `1px solid ${t.line}` : 'none',
              background: pending ? t.soft : `linear-gradient(140deg,${t.bright},${t.deep})`,
              color: pending ? t.bright : t.ink,
              cursor: 'pointer'
            }}
          >
            <Icon name={pending ? 'close' : 'plus'} size={16} stroke={2} />
          </button>
        </div>
      )}
    </Card2>
  )
}

/* ── notes card (REAL · vault-persisted) ─────────────────────────────────── */

function NotesCard({ t }: { t: Tone }): JSX.Element {
  const { notes, ready, saved, add, toggle, remove } = useVaultNotes()
  const [draft, setDraft] = useState('')

  const submit = (): void => {
    add(draft)
    setDraft('')
  }

  return (
    <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Notes</div>
        {saved ? (
          <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: t.bright }}>
            <Icon name="check" size={13} stroke={2} />
            Saved
          </span>
        ) : null}
      </div>

      {/* add */}
      <div style={{ display: 'flex', gap: 8, marginBottom: notes.length ? 12 : 0 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Jot a quick note…"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'var(--card-2)',
            border: '1px solid var(--line)',
            borderRadius: 11,
            padding: '9px 12px',
            color: 'var(--ink)',
            fontSize: 13.5,
            outline: 'none'
          }}
        />
        <button
          className="tap"
          onClick={submit}
          disabled={!draft.trim()}
          title="Add note"
          style={{
            width: 38,
            height: 38,
            flex: '0 0 auto',
            borderRadius: 11,
            display: 'grid',
            placeItems: 'center',
            background: draft.trim() ? `linear-gradient(140deg,${t.bright},${t.deep})` : 'var(--card-2)',
            color: draft.trim() ? t.ink : 'var(--ink-3)',
            border: '1px solid var(--line)',
            cursor: draft.trim() ? 'pointer' : 'default'
          }}
        >
          <Icon name="plus" size={18} stroke={2} />
        </button>
      </div>

      {/* list */}
      {ready && notes.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--ink-3)' }}>
          <Icon name="note" size={14} stroke={2} />
          No notes yet — they save to your encrypted vault.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {notes.map((n) => (
            <div
              key={n.id}
              className="tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                padding: '7px 9px',
                borderRadius: 10,
                background: 'var(--card-2)'
              }}
            >
              <button
                onClick={() => toggle(n.id)}
                title={n.done ? 'Mark as not done' : 'Mark as done'}
                style={{
                  width: 18,
                  height: 18,
                  flex: '0 0 auto',
                  borderRadius: 6,
                  display: 'grid',
                  placeItems: 'center',
                  border: `1.5px solid ${n.done ? t.bright : 'var(--line-2)'}`,
                  background: n.done ? t.bright : 'transparent',
                  color: t.ink,
                  cursor: 'pointer'
                }}
              >
                {n.done ? <Icon name="check" size={12} stroke={2.5} /> : null}
              </button>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  color: n.done ? 'var(--ink-3)' : 'var(--ink-2)',
                  textDecoration: n.done ? 'line-through' : 'none',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {n.text}
              </span>
              <button
                onClick={() => remove(n.id)}
                title="Delete note"
                style={{ flex: '0 0 auto', display: 'grid', placeItems: 'center', color: 'var(--ink-3)', cursor: 'pointer', padding: 2 }}
              >
                <Icon name="close" size={15} stroke={2} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── feeds list (honest connect state) ───────────────────────────────────── */

function feedIcon(src: string): string {
  if (src.startsWith('RSS')) return 'rss'
  return 'at'
}

function FeedsSection({
  t,
  statusOf,
  connect,
  disconnect
}: {
  t: Tone
  statusOf: (id: string) => ConnStatus | undefined
  connect: (id: string) => void
  disconnect: (id: string) => void
}): JSX.Element {
  const feeds = feedProvider
  const connecting = feedProviders.filter((p) => statusOf(p.id))

  return (
    <>
      <div className="disp" style={{ fontSize: 16, fontWeight: 700, margin: '26px 0 14px' }}>From your feeds</div>

      {feeds && feeds.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {feeds.map((fd) => (
            <a
              key={fd.id}
              href={fd.url}
              target="_blank"
              rel="noreferrer"
              className="lift"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 13,
                padding: '14px 16px',
                borderRadius: 14,
                background: 'var(--card)',
                border: '1px solid var(--line)',
                textDecoration: 'none',
                color: 'inherit'
              }}
            >
              <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: t.soft, color: t.bright, flex: '0 0 auto' }}>
                <Icon name={feedIcon(fd.src)} size={17} stroke={2} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{fd.text}</div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 1 }}>{fd.src + ' · ' + fd.when}</div>
              </div>
              <span style={{ color: 'var(--ink-3)' }}>
                <Icon name="external" size={16} stroke={2} />
              </span>
            </a>
          ))}
        </div>
      ) : (
        /* HONEST connect state — no fabricated posts */
        <div
          style={{
            borderRadius: 16,
            border: `1.5px dashed ${t.line}`,
            background: t.wash,
            padding: '24px 22px',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', gap: 9, flex: '0 0 auto' }}>
            {feedProviders.map((p) => (
              <span key={p.id} style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: t.soft, color: t.bright }}>
                <Icon name={p.icon} size={18} stroke={2} />
              </span>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Connect a feed</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.45 }}>
              {connecting.length > 0
                ? `Connecting ${connecting.map((p) => p.label).join(', ')}… — pulling posts needs the provider integration (coming).`
                : 'Link Bluesky, an RSS source, or Mastodon and your latest posts will gather here.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', flex: '0 0 auto' }}>
            {feedProviders.map((p) => (
              <ConnectChip key={p.id} def={p} status={statusOf(p.id)} onConnect={connect} onDisconnect={disconnect} t={t} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/* ── the space ───────────────────────────────────────────────────────────── */

export function PulseSpace(): JSX.Element {
  const t = tone(350, 0.16) // Pulse = rose hue 350 (design line 902)
  const bt = tone(205, 0.13) // Borderless-blue accent for the calendar card (design line 902)

  const { statusOf, connect, disconnect } = useVaultProviders()

  const wrap: CSSProperties = { maxWidth: 920, margin: '0 auto', padding: '14px 26px 80px' }

  return (
    <div style={wrap}>
      <SpaceHead title="Pulse" sub="Your feeds, music, notes and calendar — the quiet companions, in one calm place." />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* left — now playing */}
        <NowPlayingCard t={t} statusOf={statusOf} connect={connect} disconnect={disconnect} />

        {/* right — next up + notes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <NextUpCard t={bt} statusOf={statusOf} connect={connect} disconnect={disconnect} />
          <NotesCard t={t} />
        </div>
      </div>

      <FeedsSection t={t} statusOf={statusOf} connect={connect} disconnect={disconnect} />
    </div>
  )
}
