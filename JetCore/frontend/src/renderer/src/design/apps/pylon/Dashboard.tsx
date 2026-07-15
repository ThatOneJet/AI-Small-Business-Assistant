/**
 * Pylon — Dashboard (the original Standing / What's-due / Final-calculator).
 *
 * KEPT verbatim from the original PylonScreen, lifted into its own module so the
 * new sidebar shell can host it alongside the Courses areas. The data still
 * comes from the legible snapshot (window.decks.pylon.fetch → PylonData).
 */
import { useMemo, useState, type ChangeEvent, type JSX } from 'react'
import { Badge, Button, Card, Divider, EmptyState, ProgressRing, SectionTitle, Segmented } from '../../ui'
import { AnimatedList, CountUp, Reveal, SpotlightCard } from '../../motion'
import { Icon } from '../../icons'

/* ── helpers ─────────────────────────────────────────────────────────── */

export const gradeColor = (s: number | null): string =>
  s === null ? 'var(--text-3)' : s >= 93 ? 'var(--pos)' : s >= 83 ? 'var(--accent)' : s >= 73 ? 'var(--warn)' : 'var(--neg)'

export function letterFor(s: number): string {
  if (s >= 93) return 'A'
  if (s >= 90) return 'A-'
  if (s >= 87) return 'B+'
  if (s >= 83) return 'B'
  if (s >= 80) return 'B-'
  if (s >= 77) return 'C+'
  if (s >= 73) return 'C'
  if (s >= 70) return 'C-'
  if (s >= 67) return 'D+'
  if (s >= 63) return 'D'
  if (s >= 60) return 'D-'
  return 'F'
}

/** Pull a course-code-looking token ("CS 374") out of a Canvas course name. */
export function courseCode(name: string): string {
  const re = /([A-Za-z]{2,8})[ -]?(\d{2,4}[A-Za-z]?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(name)) !== null) {
    if (!/^(19|20)\d{2}$/.test(m[2])) return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`
  }
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
  return initials || 'COURSE'
}

/** The prototype's course palette, dealt out by position. */
export const COURSE_COLORS = [
  'oklch(0.68 0.15 232)',
  'oklch(0.7 0.14 210)',
  'oklch(0.69 0.14 250)',
  'oklch(0.72 0.13 190)',
  'oklch(0.66 0.14 270)',
  'oklch(0.7 0.13 270)'
]

export interface CourseView {
  id: number
  name: string
  code: string
  score: number | null
  letter: string
  color: string
}

export interface AssignmentView {
  id: string
  title: string
  courseName: string
  /** Owning course id, for "click → redirect to it" navigation. -1 if unknown. */
  courseId: number
  color: string
  /** Days until due (fractional, negative = past due); null = no due date. */
  dueIn: number | null
  /** Absolute due time (epoch ms) for the calendar; null = no due date. */
  dueAt: number | null
  points: number | null
  icon: string
}

type UrgencyGroup = 'Due today' | 'This week' | 'Later'
interface Urgency {
  group: UrgencyGroup
  tone: 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'
  label: string
}

function urgency(d: number | null): Urgency {
  if (d === null) return { group: 'Later', tone: 'neutral', label: 'No due date' }
  if (d < 0) return { group: 'Due today', tone: 'neg', label: 'Past due' }
  if (d < 1) return { group: 'Due today', tone: 'neg', label: `${Math.max(1, Math.round(d * 24))}h left` }
  if (d <= 3) return { group: 'This week', tone: 'warn', label: `${Math.max(1, Math.round(d))}d left` }
  return { group: 'Later', tone: 'accent', label: `${Math.round(d)}d left` }
}

/* ── Standing ────────────────────────────────────────────────────────── */

export function StandingView({
  courses,
  upcoming,
  onDue,
  onRetry,
  onOpenCourse
}: {
  courses: CourseView[]
  upcoming: AssignmentView[]
  onDue: () => void
  onRetry: () => void
  onOpenCourse: (id: number) => void
}): JSX.Element {
  const graded = courses.filter((c): c is CourseView & { score: number } => c.score !== null)
  const avg = graded.length > 0 ? graded.reduce((s, c) => s + c.score, 0) / graded.length : null
  const dueSoon = upcoming.filter((a) => a.dueIn !== null && a.dueIn <= 2)
  const next = dueSoon[0]
  const nextLabel = (d: number): string =>
    d < 0 ? 'past due' : d < 1 ? `due in ${Math.max(1, Math.round(d * 24))} hours` : `due in ${Math.round(d)} days`

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22, gap: 16, flexWrap: 'wrap' }}>
        <Reveal>
          <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.025em' }}>Where you stand</h1>
          <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>Canvas, decoded — your real grade in every class.</p>
        </Reveal>
        {avg !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Term average</div>
              <div className="mono" style={{ fontSize: 24, fontWeight: 800, color: gradeColor(avg) }}>
                <CountUp value={avg} decimals={1} suffix="%" />
              </div>
            </div>
            <ProgressRing value={avg} size={58} stroke={6} color={gradeColor(avg)}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{Math.round(avg)}</span>
            </ProgressRing>
          </div>
        )}
      </div>

      {next && next.dueIn !== null && (
        <Reveal delay={60}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 'var(--r-md)', background: 'color-mix(in oklch, var(--neg) 9%, transparent)', border: '1px solid color-mix(in oklch, var(--neg) 22%, transparent)', marginBottom: 22 }}>
            <Icon name="clock" size={20} style={{ color: 'var(--neg)' }} />
            <div style={{ flex: 1, fontSize: 13.5 }}>
              <strong>{next.title}</strong> is {nextLabel(next.dueIn)} — {next.courseName}.
            </div>
            <Button variant="soft" size="sm" iconRight="arrowR" onClick={onDue}>
              What&rsquo;s due
            </Button>
          </div>
        </Reveal>
      )}

      {courses.length === 0 ? (
        <EmptyState
          icon="cap"
          title="No active courses"
          body="Canvas didn’t return any active enrollments for this term. If that sounds wrong, give it another try."
          action={
            <Button icon="refresh" onClick={onRetry}>
              Refresh
            </Button>
          }
        />
      ) : (
        <AnimatedList stagger={80} baseDelay={100} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
          {courses.map((c) => {
            const mine = upcoming.filter((a) => a.courseName === c.name)
            const pts = mine.reduce((s, a) => s + (a.points ?? 0), 0)
            const soonest = mine.find((a) => a.dueIn !== null)
            const nextDue = soonest && soonest.dueIn !== null ? urgency(soonest.dueIn).label : '—'
            return (
              <SpotlightCard
                key={c.id}
                className="jc-card jc-card-hover tap"
                strength={0.1}
                onClick={() => onOpenCourse(c.id)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 22, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <ProgressRing value={c.score ?? 0} size={62} stroke={6} color={gradeColor(c.score)}>
                      <span className="mono" style={{ fontSize: 17, fontWeight: 800 }}>{c.letter}</span>
                    </ProgressRing>
                    <div>
                      <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--accent-h)' }}>{c.code}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', marginTop: 2 }}>{c.name}</div>
                      <div className="mono" style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 3 }}>
                        {c.score !== null ? `${c.score.toFixed(1)}%` : 'No grade posted'}
                      </div>
                    </div>
                  </div>
                  {mine.length > 0 && (
                    <Badge tone="neutral" size="sm">
                      {mine.length} due
                    </Badge>
                  )}
                </div>

                {/* standing bar (Canvas doesn't expose category weights) */}
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-3)', marginBottom: 9, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Standing</span>
                  <span>out of 100</span>
                </div>
                <div style={{ height: 10, borderRadius: 99, overflow: 'hidden', background: 'var(--surface-3)', marginBottom: 12 }}>
                  <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, c.score ?? 0))}%`, background: gradeColor(c.score), borderRadius: 99 }} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                  {[
                    { label: 'Upcoming', value: mine.length > 0 ? String(mine.length) : '—' },
                    { label: 'Points ahead', value: pts > 0 ? `${pts} pts` : '—' },
                    { label: 'Next due', value: nextDue }
                  ].map((s) => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: c.color }} />
                      <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{s.label}</span>
                      <span className="mono" style={{ color: 'var(--text-3)' }}>{s.value}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16, fontSize: 12.5, fontWeight: 600, color: 'var(--accent-h)' }}>
                  Open course <Icon name="arrowR" size={14} />
                </div>
              </SpotlightCard>
            )
          })}
        </AnimatedList>
      )}
    </>
  )
}

/* ── What's due ──────────────────────────────────────────────────────── */

const GROUP_ORDER: UrgencyGroup[] = ['Due today', 'This week', 'Later']
const GROUP_DOT: Record<UrgencyGroup, string> = {
  'Due today': 'var(--neg)',
  'This week': 'var(--warn)',
  Later: 'var(--accent)'
}

export function DueView({
  upcoming,
  onOpen
}: {
  upcoming: AssignmentView[]
  onOpen?: (courseId: number, assignmentId?: number) => void
}): JSX.Element {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const groups: Record<UrgencyGroup, AssignmentView[]> = { 'Due today': [], 'This week': [], Later: [] }
  for (const a of upcoming) groups[urgency(a.dueIn).group].push(a)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <Reveal>
          <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.025em' }}>What&rsquo;s due</h1>
          <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>
            {view === 'calendar'
              ? 'Your work by due date — click any assignment to jump to it.'
              : 'Everything ahead, sorted by urgency. Here’s what to do next.'}
          </p>
        </Reveal>
        <Segmented
          options={[
            { value: 'list', label: 'List' },
            { value: 'calendar', label: 'Calendar' }
          ]}
          value={view}
          onChange={(v) => setView(v as 'list' | 'calendar')}
          size="sm"
        />
      </div>

      {view === 'calendar' ? (
        <Reveal delay={40}>
          <div style={{ marginTop: 22 }}>
            <MonthCalendar upcoming={upcoming} onOpen={onOpen} />
          </div>
        </Reveal>
      ) : upcoming.length === 0 ? (
        <EmptyState
          icon="check"
          title="All clear"
          body="Nothing upcoming in your Canvas planner — enjoy the breathing room."
        />
      ) : (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 26 }}>
          {GROUP_ORDER.map((g) => {
            const items = groups[g]
            if (items.length === 0) return null
            return (
              <div key={g}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: GROUP_DOT[g] }} />
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>{g}</h3>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{items.length}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <AnimatedList stagger={60}>
                  {items.map((a) => {
                    const u = urgency(a.dueIn)
                    return (
                      <div
                        key={a.id}
                        className="jc-card-hover"
                        onClick={() => a.courseId >= 0 && onOpen?.(a.courseId, Number(a.id))}
                        style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', borderRadius: 'var(--r-md)', background: 'var(--surface)', border: '1px solid var(--border)', marginBottom: 10, cursor: a.courseId >= 0 ? 'pointer' : 'default' }}
                      >
                        <div style={{ width: 4, height: 40, borderRadius: 99, background: a.color, flex: '0 0 auto' }} />
                        <div style={{ width: 38, height: 38, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--text-2)', flex: '0 0 auto' }}>
                          <Icon name={a.icon} size={18} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 700 }}>{a.title}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, fontSize: 12.5, color: 'var(--text-3)' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 99, background: a.color }} />
                              {a.courseName}
                            </span>
                            {a.points !== null && <span className="mono">{a.points} pts</span>}
                          </div>
                        </div>
                        <Badge tone={u.tone} icon="clock">
                          {u.label}
                        </Badge>
                      </div>
                    )
                  })}
                </AnimatedList>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

/* ── month calendar (assignments placed by due date) ─────────────────── */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const firstOfMonth = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), 1)

function MonthCalendar({
  upcoming,
  onOpen
}: {
  upcoming: AssignmentView[]
  onOpen?: (courseId: number, assignmentId?: number) => void
}): JSX.Element {
  const [month, setMonth] = useState<Date>(() => firstOfMonth(new Date()))
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  /* bucket assignments by their local due day */
  const byDay = useMemo(() => {
    const m = new Map<string, AssignmentView[]>()
    for (const a of upcoming) {
      if (a.dueAt === null) continue
      const k = dayKey(new Date(a.dueAt))
      const arr = m.get(k)
      if (arr) arr.push(a)
      else m.set(k, [a])
    }
    return m
  }, [upcoming])

  const firstDow = month.getDay() // month is the 1st; 0 = Sunday
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const rows = Math.ceil((firstDow + daysInMonth) / 7)
  const gridStart = new Date(month)
  gridStart.setDate(1 - firstDow)
  const cells: Date[] = []
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    cells.push(d)
  }

  const monthLabel = month.toLocaleString('default', { month: 'long', year: 'numeric' })
  const shift = (n: number): void => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>{monthLabel}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="surface" size="sm" icon="chevL" onClick={() => shift(-1)} aria-label="Previous month" />
          <Button variant="surface" size="sm" onClick={() => setMonth(firstOfMonth(new Date()))}>
            Today
          </Button>
          <Button variant="surface" size="sm" icon="chevR" onClick={() => shift(1)} aria-label="Next month" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 8 }}>
        {WEEKDAYS.map((w) => (
          <div key={w} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month.getMonth()
          const isToday = d.getTime() === today.getTime()
          const items = byDay.get(dayKey(d)) ?? []
          return (
            <div
              key={i}
              style={{
                minHeight: 104,
                borderRadius: 'var(--r-md)',
                border: `1px solid ${isToday ? 'var(--accent-line)' : 'var(--border)'}`,
                background: inMonth ? 'var(--surface)' : 'transparent',
                opacity: inMonth ? 1 : 0.45,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                overflow: 'hidden'
              }}
            >
              <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--accent-h)' : 'var(--text-3)', textAlign: 'right' }}>
                {d.getDate()}
              </div>
              {items.slice(0, 3).map((a) => {
                const past = a.dueIn !== null && a.dueIn < 0
                return (
                  <button
                    key={a.id}
                    className="tap"
                    onClick={() => a.courseId >= 0 && onOpen?.(a.courseId, Number(a.id))}
                    title={`${a.title} — ${a.courseName}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      width: '100%',
                      textAlign: 'left',
                      padding: '3px 7px',
                      borderRadius: 'var(--r-xs)',
                      background: 'var(--surface-2)',
                      borderLeft: `3px solid ${a.color}`,
                      fontSize: 11,
                      fontWeight: 600,
                      color: past ? 'var(--text-3)' : 'var(--text-2)',
                      cursor: a.courseId >= 0 ? 'pointer' : 'default'
                    }}
                  >
                    <Icon name={a.icon} size={11} style={{ flex: '0 0 auto', color: 'var(--text-3)' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                  </button>
                )
              })}
              {items.length > 3 && (
                <div style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 600, paddingLeft: 2 }}>+{items.length - 3} more</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Final calculator ────────────────────────────────────────────────── */

const TARGET_CHIPS: { label: string; value: number }[] = [
  { label: 'A', value: 93 },
  { label: 'A−', value: 90 },
  { label: 'B+', value: 87 },
  { label: 'B', value: 83 },
  { label: 'C+', value: 77 },
  { label: 'C', value: 73 }
]

export function CalcView({ courses }: { courses: CourseView[] }): JSX.Element {
  const graded = useMemo(() => courses.filter((c): c is CourseView & { score: number } => c.score !== null), [courses])
  const [cid, setCid] = useState<number | null>(graded.length > 0 ? graded[0].id : null)
  const [finalWeight, setFinalWeight] = useState(20)
  const [target, setTarget] = useState(90)

  const course = graded.find((c) => c.id === cid) ?? graded[0]

  if (!course) {
    return (
      <>
        <Reveal>
          <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.025em' }}>Final calculator</h1>
          <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>&ldquo;What do I need on the final?&rdquo; — answered.</p>
        </Reveal>
        <EmptyState
          icon="target"
          title="No graded courses yet"
          body="Once Canvas posts a current score in a class, the calculator can work out what you need on the final."
        />
      </>
    )
  }

  const score = course.score
  const w = finalWeight / 100
  const guaranteed = score * (1 - w) // final = 0
  const maxPossible = guaranteed + finalWeight // final = 100
  const neededRaw = (target - guaranteed) / w
  const secured = neededRaw <= 0
  const reachable = neededRaw <= 100
  const neededShown = Math.min(100, Math.max(0, neededRaw))

  return (
    <>
      <Reveal>
        <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.025em' }}>Final calculator</h1>
        <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>&ldquo;What do I need on the final?&rdquo; — answered.</p>
      </Reveal>

      <div style={{ display: 'flex', gap: 8, margin: '22px 0', flexWrap: 'wrap' }}>
        {graded.map((c) => (
          <button
            key={c.id}
            className="tap"
            onClick={() => setCid(c.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 'var(--r-pill)', fontSize: 13, fontWeight: 600, background: course.id === c.id ? 'var(--accent-soft)' : 'var(--surface-2)', color: course.id === c.id ? 'var(--accent-h)' : 'var(--text-2)', border: '1px solid var(--border)' }}
          >
            <span style={{ width: 9, height: 9, borderRadius: 99, background: c.color }} />
            {c.code}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 18, alignItems: 'start' }}>
        <Reveal delay={100}>
          <Card>
            <SectionTitle icon="target" title={course.name} sub={`Assuming the final is worth ${finalWeight}% of your grade`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>Final exam weight</span>
                  <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-h)' }}>{finalWeight}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={finalWeight}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFinalWeight(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
                <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginTop: 5 }}>
                  <span>min 5%</span>
                  <span>max 100%</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 7, lineHeight: 1.5 }}>
                  Canvas doesn&rsquo;t share category weights — set what your syllabus says the final counts for.
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>Target final grade</span>
                  <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: 'var(--accent-h)' }}>{target}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={target}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTarget(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
                <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginTop: 5 }}>
                  <span>min 50%</span>
                  <span>max 100%</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                  {TARGET_CHIPS.map((t) => (
                    <button
                      key={t.label}
                      className="tap mono"
                      onClick={() => setTarget(t.value)}
                      style={{ padding: '5px 11px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600, background: target === t.value ? 'var(--accent-soft)' : 'var(--surface-2)', color: target === t.value ? 'var(--accent-h)' : 'var(--text-3)', border: '1px solid var(--border)' }}
                    >
                      {t.label} · {t.value}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ padding: 22, borderRadius: 'var(--r-md)', background: reachable ? 'var(--accent-soft)' : 'color-mix(in oklch, var(--neg) 10%, transparent)', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 6 }}>To finish with {target}%, you need</div>
                <div className="mono" style={{ fontSize: 46, fontWeight: 800, letterSpacing: '-0.03em', color: reachable ? 'var(--accent-h)' : 'var(--neg)', lineHeight: 1 }}>
                  <CountUp value={neededShown} decimals={1} suffix="%" />
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>on the final exam</div>
                <div style={{ marginTop: 14 }}>
                  {secured ? (
                    <Badge tone="pos" icon="check">Locked in — even a 0% final leaves you at {guaranteed.toFixed(1)}%</Badge>
                  ) : reachable ? (
                    <Badge tone="pos" icon="spark">Very doable — you&rsquo;ve got this</Badge>
                  ) : (
                    <Badge tone="neg" icon="alert">Not reachable — a perfect final tops out at {maxPossible.toFixed(1)}%</Badge>
                  )}
                </div>
              </div>

              <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, padding: '0 4px' }}>
                Your current <strong style={{ color: 'var(--text)' }}>{score.toFixed(1)}%</strong> carries the{' '}
                <strong style={{ color: 'var(--text)' }}>{100 - finalWeight}%</strong> of the grade that isn&rsquo;t the final. The exam decides the remaining{' '}
                <strong style={{ color: 'var(--text)' }}>{finalWeight}%</strong>.
              </div>
            </div>
          </Card>
        </Reveal>

        <Reveal delay={160}>
          <Card>
            <SectionTitle icon="donut" title="The breakdown" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12.5 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--text-2)' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: course.color }} />
                    Everything so far
                  </span>
                  <span className="mono" style={{ color: 'var(--text-3)' }}>{100 - finalWeight}% · {score.toFixed(1)}/100</span>
                </div>
                <div style={{ height: 7, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, score))}%`, background: course.color, borderRadius: 99 }} />
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12.5 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--text-2)' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: course.color, opacity: 0.4 }} />
                    Final exam
                  </span>
                  <span className="mono" style={{ color: 'var(--text-3)' }}>{finalWeight}% · pending</span>
                </div>
                <div style={{ height: 7, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '100%', background: course.color, opacity: 0.4, borderRadius: 99 }} />
                </div>
              </div>
            </div>
            <Divider style={{ margin: '16px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Locked-in minimum</span>
              <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: gradeColor(guaranteed) }}>{guaranteed.toFixed(1)}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Best possible</span>
              <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: gradeColor(maxPossible) }}>{maxPossible.toFixed(1)}%</span>
            </div>
          </Card>
        </Reveal>
      </div>
    </>
  )
}
