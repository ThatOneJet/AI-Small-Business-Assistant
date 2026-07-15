/**
 * JetCore — Pylon (students). Canvas, decoded — now a full Canvas client.
 *
 * The original three views (Standing · What's due · Final calculator) are KEPT
 * as the Dashboard. Around them is a left in-app nav: a Dashboard section, a
 * course context switcher, and per-course areas (Assignments · Quizzes ·
 * Coursework · Announcements) — each backed by REAL Canvas calls through
 * window.decks.pylon.api (the token stays in main). Everything Canvas can do,
 * but organised and calm.
 */
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type JSX, type ReactNode } from 'react'
import type { PylonData, PylonStatusResult } from '@shared/ipc'
import { Button, Card, Field, IconButton, Input, Skeleton, Spinner } from '../../ui'
import { Reveal } from '../../motion'
import { Icon } from '../../icons'
import type { JCScreenProps } from '../../contract'
import {
  CalcView,
  COURSE_COLORS,
  courseCode,
  DueView,
  letterFor,
  StandingView,
  type AssignmentView,
  type CourseView
} from './Dashboard'
import { CourseScreen, type CourseArea } from './CourseScreen'
import { GradesScreen } from './Grades'

/* ── connect state ───────────────────────────────────────────────────── */

const CONNECT_STEPS: [string, string][] = [
  ['Open Canvas', 'Log into your school’s Canvas and head to Account → Settings.'],
  ['Mint a token', 'Scroll to Approved integrations and click “+ New access token”.'],
  ['Paste it here', 'Copy the token and drop it below with your school’s Canvas address.']
]

function ConnectCanvas({ onConnected }: { onConnected: () => void }): JSX.Element {
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return
    if (!baseUrl.trim()) {
      setError('Enter your Canvas URL (e.g. school.instructure.com).')
      return
    }
    if (!token.trim()) {
      setError('Paste your Canvas access token.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res: PylonStatusResult = await window.decks.pylon.connect({ baseUrl: baseUrl.trim(), token: token.trim() })
      if (res.connected) {
        onConnected()
        return
      }
      setError(res.error ?? 'Could not connect to Canvas.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to Canvas.')
    }
    setBusy(false)
  }, [busy, baseUrl, token, onConnected])

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '30px 40px 64px' }}>
      <Reveal style={{ textAlign: 'center', marginBottom: 26 }}>
        <div style={{ width: 68, height: 68, margin: '0 auto 18px', borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
          <Icon name="cap" size={32} />
        </div>
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.025em' }}>Connect your Canvas</h1>
        <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 7, lineHeight: 1.55, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto' }}>
          Canvas, decoded — your real grade in every class, what&rsquo;s due next, your coursework and quizzes, and a
          straight answer to &ldquo;what do I need on the final?&rdquo;
        </p>
      </Reveal>

      <Reveal delay={90}>
        <Card pad={26}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 22 }}>
            {CONNECT_STEPS.map(([title, body], i) => (
              <div key={title} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                <div className="mono" style={{ width: 26, height: 26, borderRadius: 99, flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)', fontSize: 12.5, fontWeight: 700 }}>
                  {i + 1}
                </div>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.5 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="Canvas URL" hint="Just the address you log in at — no token pages, no paths.">
              <Input
                icon="link"
                placeholder="school.instructure.com"
                value={baseUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
              />
            </Field>
            <Field label="Access token">
              <Input
                icon="lock"
                type="password"
                placeholder="1016~…"
                value={token}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setToken(e.target.value)}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                  if (e.key === 'Enter') void submit()
                }}
              />
            </Field>

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 14px', borderRadius: 'var(--r-sm)', background: 'color-mix(in oklch, var(--neg) 10%, transparent)', color: 'var(--neg)', fontSize: 13, fontWeight: 600 }}>
                <Icon name="alert" size={16} />
                <span style={{ flex: 1 }}>{error}</span>
              </div>
            )}

            <Button full size="lg" iconRight={busy ? undefined : 'arrowR'} onClick={() => void submit()} disabled={busy} style={busy ? { opacity: 0.75 } : undefined}>
              {busy ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
                  <Spinner size={17} /> Connecting…
                </span>
              ) : (
                'Connect Canvas'
              )}
            </Button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: 12, color: 'var(--text-3)' }}>
              <Icon name="shield" size={14} />
              Your token is encrypted on this device and only ever talks to Canvas.
            </div>
          </div>
        </Card>
      </Reveal>
    </div>
  )
}

/* ── loading + error states ──────────────────────────────────────────── */

function LoadingView(): JSX.Element {
  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '30px 40px 64px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22 }}>
        <div>
          <Skeleton w={250} h={27} />
          <Skeleton w={340} h={14} style={{ marginTop: 10 }} />
        </div>
        <Skeleton w={58} h={58} r={99} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} pad={22}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18 }}>
              <Skeleton w={62} h={62} r={99} />
              <div style={{ flex: 1 }}>
                <Skeleton w={80} h={11} />
                <Skeleton w="70%" h={16} style={{ marginTop: 8 }} />
                <Skeleton w={56} h={12} style={{ marginTop: 8 }} />
              </div>
            </div>
            <Skeleton h={10} r={99} />
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <Skeleton w={90} h={12} />
              <Skeleton w={90} h={12} />
              <Skeleton w={90} h={12} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

function ErrorView({ message, onRetry, onDisconnect }: { message: string | null; onRetry: () => void; onDisconnect: () => void }): JSX.Element {
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '30px 40px 64px' }}>
      <Reveal style={{ textAlign: 'center', padding: '48px 32px', maxWidth: 420, margin: '0 auto' }}>
        <div style={{ width: 68, height: 68, margin: '0 auto 18px', borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'color-mix(in oklch, var(--neg) 14%, transparent)', color: 'var(--neg)' }}>
          <Icon name="alert" size={30} />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8 }}>Canvas didn’t answer</h3>
        <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 22 }}>
          {message ?? 'Something went wrong while talking to Canvas. It happens — try again in a moment.'}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Button icon="refresh" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="ghost" icon="logout" onClick={onDisconnect}>
            Disconnect
          </Button>
        </div>
      </Reveal>
    </div>
  )
}

/* ── left in-app nav ─────────────────────────────────────────────────── */

type Section = 'standing' | 'due' | 'grades' | 'calc'
type Nav =
  | { kind: 'dashboard'; section: Section }
  | { kind: 'course'; courseId: number; area: CourseArea; openAssignmentId?: number }

const DASH_ITEMS: { id: Section; label: string; icon: string }[] = [
  { id: 'standing', label: 'Standing', icon: 'donut' },
  { id: 'due', label: "What's due", icon: 'clock' },
  { id: 'grades', label: 'Grade lab', icon: 'sliders' },
  { id: 'calc', label: 'Final calculator', icon: 'target' }
]

function NavGroupLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', padding: '0 12px', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function NavItem({
  icon,
  label,
  sub,
  on,
  dot,
  onClick
}: {
  icon: string
  label: string
  sub?: string
  on: boolean
  dot?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className="tap"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '9px 12px',
        borderRadius: 'var(--r-sm)',
        fontSize: 13.5,
        fontWeight: 600,
        color: on ? 'var(--accent-h)' : 'var(--text-2)',
        background: on ? 'var(--accent-soft)' : 'transparent'
      }}
      onMouseEnter={(e) => {
        if (!on) e.currentTarget.style.background = 'var(--surface-2)'
      }}
      onMouseLeave={(e) => {
        if (!on) e.currentTarget.style.background = 'transparent'
      }}
    >
      {dot ? (
        <span style={{ width: 9, height: 9, borderRadius: 3, flex: '0 0 auto', background: dot }} />
      ) : (
        <Icon name={icon} size={16} style={{ flex: '0 0 auto', color: on ? 'var(--accent-h)' : 'var(--text-3)' }} />
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {sub && <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{sub}</span>}
    </button>
  )
}

function Sidebar({
  courses,
  nav,
  host,
  busy,
  onNav,
  onRefresh,
  onDisconnect
}: {
  courses: CourseView[]
  nav: Nav
  host: string | null
  busy: boolean
  onNav: (n: Nav) => void
  onRefresh: () => void
  onDisconnect: () => void
}): JSX.Element {
  return (
    <aside
      style={{
        width: 256,
        flex: '0 0 auto',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        maxHeight: '100vh',
        overflowY: 'auto',
        borderRight: '1px solid var(--border)',
        padding: '24px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 22
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
        <div style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
          <Icon name="pylon" size={19} />
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em' }}>Pylon</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Canvas, decoded</div>
        </div>
      </div>

      <div>
        <NavGroupLabel>Dashboard</NavGroupLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {DASH_ITEMS.map((d) => (
            <NavItem
              key={d.id}
              icon={d.icon}
              label={d.label}
              on={nav.kind === 'dashboard' && nav.section === d.id}
              onClick={() => onNav({ kind: 'dashboard', section: d.id })}
            />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <NavGroupLabel>Courses</NavGroupLabel>
        {courses.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', padding: '0 12px', lineHeight: 1.5 }}>No active courses.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {courses.map((c) => (
              <NavItem
                key={c.id}
                icon="cap"
                label={c.name}
                sub={c.score !== null ? `${Math.round(c.score)}` : undefined}
                dot={c.color}
                on={nav.kind === 'course' && nav.courseId === c.id}
                onClick={() => onNav({ kind: 'course', courseId: c.id, area: 'assignments' })}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {host && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--pos)', flex: '0 0 auto' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{host}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, padding: '0 4px' }}>
          <IconButton name="refresh" label="Refresh" onClick={onRefresh} active={busy} />
          <Button variant="ghost" size="sm" icon="logout" onClick={onDisconnect} style={{ flex: 1, justifyContent: 'flex-start' }}>
            Disconnect
          </Button>
        </div>
      </div>
    </aside>
  )
}

/* ── screen ──────────────────────────────────────────────────────────── */

type Phase = 'loading' | 'connect' | 'ready' | 'error'

export function PylonScreen(props: JCScreenProps): JSX.Element {
  void props // go/openSettings are unused — Pylon navigates via its own nav.
  const [nav, setNav] = useState<Nav>({ kind: 'dashboard', section: 'standing' })
  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState<PylonStatusResult | null>(null)
  const [data, setData] = useState<PylonData | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (soft = false): Promise<void> => {
    if (soft) setRefreshing(true)
    else setPhase('loading')
    setFetchError(null)
    try {
      const st = await window.decks.pylon.status()
      setStatus(st)
      if (!st.connected) {
        setPhase('connect')
        setRefreshing(false)
        return
      }
      const d = await window.decks.pylon.fetch()
      if (!d.connected) {
        setPhase('connect')
        setRefreshing(false)
        return
      }
      if (d.error && d.courses.length === 0) {
        setFetchError(d.error)
        setPhase('error')
        setRefreshing(false)
        return
      }
      setData(d)
      setPhase('ready')
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Could not reach Canvas.')
      setPhase('error')
    }
    setRefreshing(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const disconnect = useCallback(async (): Promise<void> => {
    try {
      await window.decks.pylon.disconnect()
    } catch {
      /* ignore */
    }
    setData(null)
    setStatus(null)
    setNav({ kind: 'dashboard', section: 'standing' })
    setPhase('connect')
  }, [])

  const courses: CourseView[] = useMemo(
    () =>
      (data?.courses ?? []).map((c, i) => ({
        id: c.id,
        name: c.name,
        code: courseCode(c.name),
        score: c.score,
        letter: c.grade ?? (c.score !== null ? letterFor(c.score) : '—'),
        color: COURSE_COLORS[i % COURSE_COLORS.length]
      })),
    [data]
  )

  const upcoming: AssignmentView[] = useMemo(() => {
    const colorByName = new Map(courses.map((c) => [c.name, c.color] as const))
    const idByName = new Map(courses.map((c) => [c.name, c.id] as const))
    return (data?.upcoming ?? [])
      .filter((a) => !a.submitted)
      .map((a) => {
        const t = a.dueAt !== null ? Date.parse(a.dueAt) : NaN
        return {
          id: a.id,
          title: a.title,
          courseName: a.courseName,
          courseId: idByName.get(a.courseName) ?? -1,
          color: colorByName.get(a.courseName) ?? 'var(--accent)',
          dueIn: Number.isNaN(t) ? null : (t - Date.now()) / 86400000,
          dueAt: Number.isNaN(t) ? null : t,
          points: a.points,
          icon: /quiz|exam|test|midterm|final/i.test(a.title) ? 'target' : 'book'
        }
      })
      .sort((a, b) => (a.dueIn ?? Number.MAX_SAFE_INTEGER) - (b.dueIn ?? Number.MAX_SAFE_INTEGER))
  }, [data, courses])

  if (phase === 'loading') return <LoadingView />
  if (phase === 'connect') return <ConnectCanvas onConnected={() => void load()} />
  if (phase === 'error') return <ErrorView message={fetchError} onRetry={() => void load()} onDisconnect={() => void disconnect()} />

  const host = status?.baseUrl ? status.baseUrl.replace(/^https?:\/\//, '') : null
  const activeCourse = nav.kind === 'course' ? courses.find((c) => c.id === nav.courseId) ?? null : null

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: '100%' }}>
      <Sidebar
        courses={courses}
        nav={nav}
        host={host}
        busy={refreshing}
        onNav={setNav}
        onRefresh={() => void load(true)}
        onDisconnect={() => void disconnect()}
      />

      <main style={{ flex: 1, minWidth: 0 }}>
        <div style={{ maxWidth: nav.kind === 'dashboard' && (nav.section === 'standing' || nav.section === 'grades') ? 1100 : 980, margin: '0 auto', padding: '30px 36px 64px' }}>
          {nav.kind === 'dashboard' && nav.section === 'standing' && (
            <StandingView
              courses={courses}
              upcoming={upcoming}
              onDue={() => setNav({ kind: 'dashboard', section: 'due' })}
              onRetry={() => void load(true)}
              onOpenCourse={(id) => setNav({ kind: 'course', courseId: id, area: 'assignments' })}
            />
          )}
          {nav.kind === 'dashboard' && nav.section === 'due' && (
            <DueView upcoming={upcoming} onOpen={(id, aid) => setNav({ kind: 'course', courseId: id, area: 'assignments', openAssignmentId: aid })} />
          )}
          {nav.kind === 'dashboard' && nav.section === 'grades' && <GradesScreen courses={courses} />}
          {nav.kind === 'dashboard' && nav.section === 'calc' && <CalcView courses={courses} />}

          {nav.kind === 'course' &&
            (activeCourse ? (
              <CourseScreen
                course={activeCourse}
                area={nav.area}
                openAssignmentId={nav.openAssignmentId}
                onArea={(area) => setNav({ kind: 'course', courseId: nav.courseId, area })}
              />
            ) : (
              <ErrorView
                message="That course is no longer available."
                onRetry={() => setNav({ kind: 'dashboard', section: 'standing' })}
                onDisconnect={() => void disconnect()}
              />
            ))}
        </div>
      </main>
    </div>
  )
}
