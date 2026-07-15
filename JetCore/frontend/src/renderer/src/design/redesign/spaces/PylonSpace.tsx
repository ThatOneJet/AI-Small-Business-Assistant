/**
 * Pylon — the redesigned "Hangar" space (warm-editorial School world).
 *
 * Ported from the Claude Design handoff (JetCore.dc.html → renderPylon, lines
 * 344–589) and rewired to LIVE Canvas data. The shell (Hangar Chrome) renders
 * the back-to-Hangar chrome; this component renders ONLY the scrollable body:
 * a sticky pill nav (This week · Planner · Grades · Final calculator · per-course
 * pills) over a soft indigo wash, then the active view.
 *
 * Live data + math are REUSED from the existing Pylon app, not reinvented:
 *  - window.decks.pylon.fetch()      → the legible PylonData snapshot
 *  - apps/pylon/canvas.ts            → typed get/paginate/form over the proxy
 *  - apps/pylon/gradeMath.ts         → weighted-grade engine, GPA, manual items
 *
 * The big numerals (term average, course scores, points, GPA, "what you need")
 * tick up via CountUp; the term-average + per-course grades use Ring.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type JSX,
  type ReactNode
} from 'react'
import type { PylonData } from '@shared/ipc'
import { tone, type Tone } from '../system'
import { CountUp, Ring } from '../anim'
import { consumeJump } from '../Hangar'
import { Icon } from '../../icons'
import {
  assignmentIcon,
  CanvasError,
  fmtBytes,
  fmtDate,
  get,
  paginate,
  type CanvasAnnouncement,
  type CanvasAssignment,
  type CanvasFile,
  type CanvasModule,
  type CanvasModuleItem,
  type CanvasPage
} from '../../apps/pylon/canvas'
import { AssignmentDetail } from '../../apps/pylon/Assignments'
import { CanvasHtml } from '../../apps/pylon/shared'
import {
  allItems,
  buildModel,
  cannotChangeLetter,
  classGpaPoints,
  computeGpa,
  currentGrade,
  DEFAULT_GPA,
  loadGpa,
  loadManual,
  neededForGoal,
  projectGrade,
  round,
  saveGpa,
  saveManual,
  type CanvasAssignmentGroup,
  type ClassTier,
  type GpaSettings,
  type GradeItem,
  type ManualItem,
  type ManualStore
} from '../../apps/pylon/gradeMath'

/* ── the indigo accent (Pylon = OKLCH hue 250) ───────────────────────────── */

const T: Tone = tone(250, 0.15)

/* ── grade helpers (ported from design gradeTone + Dashboard letterFor) ──── */

/** Tone for a score 0–100 (design line 169): pos / indigo / warn / neg. */
function gradeTone(s: number | null): string {
  if (s === null) return 'var(--ink-3)'
  if (s >= 93) return 'var(--pos)'
  if (s >= 83) return T.bright
  if (s >= 73) return 'var(--warn)'
  return 'var(--neg)'
}

/** Letter for a percent (standard US scale, mirrors Dashboard.letterFor). */
function letterFor(s: number): string {
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
function courseCode(name: string): string {
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

/** The per-course palette, dealt out by position (warm OKLCH, near the design). */
const COURSE_COLORS = [
  'oklch(0.66 0.15 250)',
  'oklch(0.68 0.13 200)',
  'oklch(0.68 0.14 150)',
  'oklch(0.74 0.14 60)',
  'oklch(0.66 0.14 300)',
  'oklch(0.7 0.13 280)'
]

/* ── view-model shapes ───────────────────────────────────────────────────── */

interface Course {
  id: number
  code: string
  name: string
  score: number | null
  letter: string
  color: string
}

interface Upcoming {
  id: string
  title: string
  courseId: number
  course: string
  color: string
  /** Days until due (fractional, negative = past); null = no due date. */
  dueIn: number | null
  points: number | null
  /** 'quiz' uses the target glyph, else book (design distinction). */
  kind: 'quiz' | 'assignment'
}

/** Days until an ISO date (fractional). null = no/invalid date. */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (t - Date.now()) / 86400000
}

/** A course's per-course accent ramp (design cTone, line 426). */
interface CTone {
  base: string
  ink: string
  soft: string
  line: string
  wash: string
}
function cTone(color: string): CTone {
  return {
    base: color,
    ink: 'oklch(0.99 0.02 250)',
    soft: `color-mix(in oklch, ${color} 14%, transparent)`,
    line: `color-mix(in oklch, ${color} 32%, transparent)`,
    wash: `color-mix(in oklch, ${color} 7%, transparent)`
  }
}

/* ── nav model ───────────────────────────────────────────────────────────── */

type DashKind = 'week' | 'planner' | 'grades' | 'calc'
type CourseArea = 'overview' | 'assignments' | 'modules' | 'grades' | 'announcements' | 'files'
type Nav =
  | { kind: DashKind }
  | { kind: 'course'; courseId: number; area: CourseArea }

/* ── data hook (live PylonData → view model) ─────────────────────────────── */

interface Loaded {
  phase: 'loading' | 'ready' | 'error'
  data: PylonData | null
  message?: string
}

function usePylonData(): { state: Loaded; reload: () => void } {
  const [state, setState] = useState<Loaded>({ phase: 'loading', data: null })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    setState({ phase: 'loading', data: null })
    window.decks.pylon
      .fetch()
      .then((d) => {
        if (alive) setState({ phase: 'ready', data: d })
      })
      .catch((e: unknown) => {
        if (alive) setState({ phase: 'error', data: null, message: e instanceof Error ? e.message : 'Could not reach Canvas.' })
      })
    return () => {
      alive = false
    }
  }, [nonce])
  return { state, reload: () => setNonce((n) => n + 1) }
}

/** Derive the typed view model (courses + upcoming + term average) from the snapshot. */
function useViewModel(data: PylonData | null): { courses: Course[]; upcoming: Upcoming[]; termAvg: number | null } {
  return useMemo(() => {
    if (!data) return { courses: [], upcoming: [], termAvg: null }
    const courses: Course[] = data.courses.map((c, i) => ({
      id: c.id,
      code: courseCode(c.name),
      name: c.name,
      score: c.score,
      letter: c.grade ?? (c.score !== null ? letterFor(c.score) : '—'),
      color: COURSE_COLORS[i % COURSE_COLORS.length]
    }))
    const byName = new Map(courses.map((c) => [c.name, c]))
    const upcoming: Upcoming[] = data.upcoming.map((a) => {
      const c = byName.get(a.courseName)
      const isQuiz = /quiz|exam|test|midterm|final/i.test(a.title)
      return {
        id: a.id,
        title: a.title,
        courseId: c?.id ?? -1,
        course: a.courseName,
        color: c?.color ?? T.bright,
        dueIn: daysUntil(a.dueAt),
        points: a.points,
        kind: isQuiz ? 'quiz' : 'assignment'
      }
    })
    const graded = courses.filter((c): c is Course & { score: number } => c.score !== null)
    const termAvg = graded.length > 0 ? graded.reduce((s, c) => s + c.score, 0) / graded.length : null
    return { courses, upcoming, termAvg }
  }, [data])
}

/* ── small shared bits (ported from the design's helper methods) ─────────── */

function dueChip(dueIn: number | null): { text: string; tone: string; soft: string } {
  if (dueIn === null) return { text: 'No date', tone: 'var(--ink-3)', soft: 'var(--card-2)' }
  if (dueIn < 0) return { text: 'Past due', tone: 'var(--neg)', soft: 'color-mix(in oklch,var(--neg) 16%,transparent)' }
  if (dueIn < 1) return { text: `${Math.max(1, Math.round(dueIn * 24))}h left`, tone: 'var(--neg)', soft: 'color-mix(in oklch,var(--neg) 16%,transparent)' }
  if (dueIn <= 3) return { text: `${Math.round(dueIn)}d left`, tone: 'var(--warn)', soft: 'color-mix(in oklch,var(--warn) 16%,transparent)' }
  return { text: `${Math.round(dueIn)}d left`, tone: T.bright, soft: T.soft }
}

function Sec({ children }: { children: ReactNode }): JSX.Element {
  return <h3 className="disp" style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>{children}</h3>
}

function Card2({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div style={{ borderRadius: 16, background: 'var(--card)', border: '1px solid var(--line)', padding: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 13 }}>{title}</div>
      {children}
    </div>
  )
}

function TabPlain({ label, color }: { label: string; color: string }): JSX.Element {
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: `color-mix(in oklch, ${color} 14%, transparent)`, color, fontSize: 11, fontWeight: 700, letterSpacing: '.1em' }}>{label}</span>
  )
}

/** Loading/error/empty card body shared across course areas. */
function StateCard({ icon, title, body, action }: { icon: string; title: string; body: string; action?: ReactNode }): JSX.Element {
  return (
    <div style={{ borderRadius: 16, background: 'var(--card)', border: '1px solid var(--line)', padding: '40px 24px', textAlign: 'center' }}>
      <div style={{ width: 52, height: 52, margin: '0 auto 14px', borderRadius: 14, display: 'grid', placeItems: 'center', background: T.soft, color: T.bright }}>
        <Icon name={icon} size={24} />
      </div>
      <div className="disp" style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
      <p style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 7, maxWidth: 380, marginInline: 'auto', lineHeight: 1.55 }}>{body}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

function SkeletonRows({ count = 5 }: { count?: number }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel" style={{ height: 64, borderRadius: 14 }} />
      ))}
    </div>
  )
}

/** Run a Canvas fetch keyed by `key`; expose phase + reload (mirrors apps/pylon useAsync). */
type Async<X> = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; data: X }
function useCanvas<X>(fetcher: () => Promise<X>, key: unknown): { state: Async<X>; reload: () => void } {
  const [state, setState] = useState<Async<X>>({ phase: 'loading' })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    setState({ phase: 'loading' })
    fetcher()
      .then((data) => alive && setState({ phase: 'ready', data }))
      .catch((e: unknown) => alive && setState({ phase: 'error', message: e instanceof Error ? e.message : 'Canvas didn’t answer.' }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])
  return { state, reload: () => setNonce((n) => n + 1) }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  THE SPACE
 * ═════════════════════════════════════════════════════════════════════════ */

export function PylonSpace(): JSX.Element {
  const { state, reload } = usePylonData()
  const model = useViewModel(state.data)
  const [nav, setNav] = useState<Nav>({ kind: 'week' })
  // Land on the right view when the Hangar radar jumped here (one-shot vault hint).
  useEffect(() => {
    let alive = true
    void consumeJump('pylon').then((hint) => {
      if (!alive || !hint) return
      const valid: DashKind[] = ['week', 'planner', 'grades', 'calc']
      if ((valid as string[]).includes(hint)) setNav({ kind: hint as DashKind })
    })
    return () => {
      alive = false
    }
  }, [])

  // Space-level open assignment — reachable from EVERY entry point (this-week
  // timeline, planner, course assignments list, module items). When set, the
  // shared AssignmentDetail (read + submit + quiz runner) replaces the view.
  const [openAssign, setOpenAssign] = useState<{ courseId: number; assignmentId: number; siblings?: number[] } | null>(null)
  const openAssignment = useCallback((courseId: number, assignmentId: number, siblings?: number[]) => {
    if (courseId >= 0 && Number.isFinite(assignmentId)) setOpenAssign({ courseId, assignmentId, siblings })
  }, [])

  // Persisted grade-lab state (manual items + GPA scale), loaded once + shared.
  const [manual, setManual] = useState<ManualStore>({})
  const [gpa, setGpa] = useState<GpaSettings>(DEFAULT_GPA)
  const [vaultLoaded, setVaultLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    void Promise.all([loadManual(), loadGpa()]).then(([m, g]) => {
      if (!alive) return
      setManual(m)
      setGpa(g)
      setVaultLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [])
  const updateManual = useCallback((next: ManualStore) => {
    setManual(next)
    void saveManual(next)
  }, [])
  const updateGpa = useCallback((next: GpaSettings) => {
    setGpa(next)
    void saveGpa(next)
  }, [])

  /* loading / error / not-connected shells (the whole body) */
  if (state.phase === 'loading') {
    return (
      <Body>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '26px 26px 80px' }}>
          <div className="skel" style={{ height: 120, borderRadius: 20, marginBottom: 24 }} />
          <SkeletonRows count={5} />
        </div>
      </Body>
    )
  }

  const data = state.data
  if (state.phase === 'error' || !data) {
    return (
      <Body>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '60px 26px 80px' }}>
          <StateCard
            icon="alert"
            title="Couldn’t reach Canvas"
            body={state.message ?? 'Something went wrong fetching your courses. Give it another try.'}
            action={<PrimaryButton icon="refresh" label="Try again" onClick={reload} />}
          />
        </div>
      </Body>
    )
  }

  if (!data.connected) {
    return (
      <Body>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '60px 26px 80px' }}>
          <StateCard
            icon="cap"
            title="Connect Canvas"
            body="Pylon mirrors your real classes — grades, assignments, modules and the grade lab — straight from Canvas. Add your school’s Canvas token in Settings to light this up."
            action={<PrimaryButton icon="refresh" label="Check again" onClick={reload} />}
          />
        </div>
      </Body>
    )
  }

  const { courses, upcoming, termAvg } = model

  /* the sticky pill nav (design 346–353) */
  const sections: [DashKind, string, string][] = [
    ['week', 'This week', 'spark'],
    ['planner', 'Planner', 'calendar'],
    ['grades', 'Grades', 'donut'],
    ['calc', 'Final calculator', 'target']
  ]
  const navbar = (
    <div style={{ position: 'sticky', top: 0, zIndex: 4, background: 'color-mix(in oklch, var(--bg) 86%, transparent)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--line)' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '12px 26px', display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto' }}>
        {sections.map(([id, label, icon]) => (
          <Pill key={id} label={label} icon={icon} active={nav.kind === id} onClick={() => setNav({ kind: id })} />
        ))}
        <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px', flex: '0 0 auto' }} />
        {courses.map((c) => (
          <Pill key={c.id} label={c.code} dot={c.color} active={nav.kind === 'course' && nav.courseId === c.id} onClick={() => setNav({ kind: 'course', courseId: c.id, area: 'overview' })} />
        ))}
      </div>
    </div>
  )

  let view: ReactNode
  if (openAssign) {
    // The assignment reader takes over the body wherever you came from. Its own
    // back affordance (and a redundant pill below) returns you to the view.
    const sibs = openAssign.siblings ?? []
    const si = sibs.indexOf(openAssign.assignmentId)
    const go = (assignmentId: number): void => setOpenAssign({ courseId: openAssign.courseId, assignmentId, siblings: sibs })
    view = (
      <AssignmentDetail
        courseId={openAssign.courseId}
        assignmentId={openAssign.assignmentId}
        accent={T.base}
        onBack={() => setOpenAssign(null)}
        onSubmitted={reload}
        onPrev={si > 0 ? () => go(sibs[si - 1]) : undefined}
        onNext={si >= 0 && si < sibs.length - 1 ? () => go(sibs[si + 1]) : undefined}
        position={si >= 0 && sibs.length > 1 ? { index: si + 1, total: sibs.length } : undefined}
      />
    )
  } else if (nav.kind === 'course') {
    const cid = nav.courseId
    view = (
      <CourseWorld
        key={`${cid}:${nav.area}`}
        course={courses.find((c) => c.id === cid)}
        area={nav.area}
        onArea={(area) => setNav({ kind: 'course', courseId: cid, area })}
        onCalc={() => setNav({ kind: 'calc' })}
        onOpenAssign={openAssignment}
      />
    )
  } else if (nav.kind === 'planner') view = <PlannerView upcoming={upcoming} onOpenAssign={openAssignment} />
  else if (nav.kind === 'grades') view = <GradesView courses={courses} manual={manual} onManual={updateManual} gpa={gpa} onGpa={updateGpa} vaultLoaded={vaultLoaded} onCourse={(id) => setNav({ kind: 'course', courseId: id, area: 'grades' })} />
  else if (nav.kind === 'calc') view = <CalcView courses={courses} />
  else view = <WeekView courses={courses} upcoming={upcoming} termAvg={termAvg} host={data.name ?? 'Canvas'} onCourse={(id, area) => setNav({ kind: 'course', courseId: id, area })} onOpenAssign={openAssignment} />

  const navKey = openAssign ? `assign:${openAssign.courseId}:${openAssign.assignmentId}` : nav.kind === 'course' ? `course:${nav.courseId}` : nav.kind
  return (
    <Body>
      {navbar}
      <div key={navKey} className="rise" style={{ position: 'relative', maxWidth: 1040, margin: '0 auto', padding: '26px 26px 80px' }}>
        {view}
      </div>
    </Body>
  )
}

/* ── body wrapper (the soft indigo wash, design 362–363) ─────────────────── */

function Body({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 320, background: `linear-gradient(${T.wash}, transparent)`, pointerEvents: 'none' }} />
      {children}
    </div>
  )
}

/* ── nav pill (design 346–347) ───────────────────────────────────────────── */

function Pill({ label, icon, dot, active, onClick }: { label: string; icon?: string; dot?: string; active: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      className="tap"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '8px 14px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: active ? T.ink : 'var(--ink-2)',
        background: active ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'var(--card)',
        border: active ? '1px solid transparent' : '1px solid var(--line)',
        boxShadow: active ? `0 8px 20px -10px ${T.line}` : 'none',
        flex: '0 0 auto'
      }}
    >
      {dot ? <span style={{ width: 8, height: 8, borderRadius: 99, background: active ? T.ink : dot }} /> : icon ? <Icon name={icon} size={15} /> : null}
      {label}
    </button>
  )
}

/** A filled accent button (course-coloured or indigo), used for CTAs. */
function PrimaryButton({ icon, label, color, onClick, full }: { icon?: string; label: string; color?: string; onClick: () => void; full?: boolean }): JSX.Element {
  const c = color ?? T.base
  return (
    <button
      className="tap"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: full ? '100%' : undefined,
        padding: '13px 18px',
        borderRadius: 13,
        background: `linear-gradient(140deg, ${c}, color-mix(in oklch,${c} 68%, black))`,
        color: 'oklch(0.99 0.02 250)',
        fontWeight: 700,
        fontSize: 14
      }}
    >
      {icon && <Icon name={icon} size={16} />}
      {label}
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  THIS WEEK → THE AUTO-PLANNER (hero feature)
 *
 *  On open this auto-pulls every course + assignment from live Canvas and
 *  GENERATES the student's week with zero setup. The student only REACTS:
 *  tick items done, drop a "busy day" constraint (the plan reflows), move an
 *  item to another day, re-balance, add manual items, or export an .ics.
 *
 *  ── THE SCHEDULING RULE (simple + explainable) ────────────────────────────
 *  1. Each item gets an IMPACT score = gradeRisk × urgency.
 *       gradeRisk = pointsShare(0–1, points × assignment-group weight when
 *                   Canvas exposes it, else raw points) × typeWeight
 *                   (exam 1.6, quiz/test 1.4, project/essay 1.25, lab 1.1, else 1).
 *       urgency   = 1 → 2 as the due date nears (1 a week out, 2 due today).
 *  2. SEED each item on its due DAY (clamped into Mon…Sun of this week; past or
 *     undated items land on "today").
 *  3. DETECT crunch: a day is overloaded when its total effort-minutes exceed a
 *     soft cap (CAP_MIN), or it holds an exam plus other work, or the student
 *     marked it busy (a constraint → cap 0).
 *  4. SPREAD: walking days latest→earliest, while a day is over its cap, pull
 *     its HIGHEST-impact, still-movable item one day EARLIER (never past today,
 *     never onto a busy day, never later than its own due day). Repeat until no
 *     day is a wall or nothing can move. This pulls big-grade-risk work toward
 *     earlier days so no single day is a wall, and each moved item records WHY.
 *  Manual student-typed items flow through the exact same pipeline.
 * ═════════════════════════════════════════════════════════════════════════ */

/* ── persistence shapes (vault key 'pylon.plan') ─────────────────────────── */

const VAULT_PLAN = 'pylon.plan'
/** Cross-app summary Hangar Radar reads. KEEP THIS SHAPE STABLE. */
const VAULT_SUMMARY_PYLON = 'jc.summary.pylon'

interface PlanConstraint {
  day: string // ISO date (yyyy-mm-dd) of the busy day
  note: string
}
interface ManualPlanItem {
  id: string // 'man:...'
  title: string
  label: string // course/label the student typed
  dueDay: string // ISO date (yyyy-mm-dd)
  effort: EffortKey
}
interface PlanState {
  done: string[]
  constraints: PlanConstraint[]
  moved: Record<string, string> // itemId → dayISO
  manual: ManualPlanItem[]
}
const EMPTY_PLAN: PlanState = { done: [], constraints: [], moved: {}, manual: [] }

async function loadPlan(): Promise<PlanState> {
  try {
    const raw = await window.decks.vault.get(VAULT_PLAN)
    if (!raw) return EMPTY_PLAN
    const p = JSON.parse(raw) as Partial<PlanState>
    return {
      done: Array.isArray(p.done) ? p.done.filter((x): x is string => typeof x === 'string') : [],
      constraints: Array.isArray(p.constraints) ? p.constraints.filter((c) => c && typeof c.day === 'string') : [],
      moved: p.moved && typeof p.moved === 'object' ? (p.moved as Record<string, string>) : {},
      manual: Array.isArray(p.manual) ? p.manual.filter((m) => m && typeof m.id === 'string') : []
    }
  } catch {
    return EMPTY_PLAN
  }
}
async function savePlan(p: PlanState): Promise<void> {
  try {
    await window.decks.vault.set({ key: VAULT_PLAN, plaintext: JSON.stringify(p) })
  } catch {
    /* a vault write failure shouldn't crash the planner; state stays in memory */
  }
}

/* ── effort estimates (type + points → a minutes bucket) ─────────────────── */

type EffortKey = 'quick' | 'short' | 'medium' | 'long'
const EFFORT: Record<EffortKey, { label: string; min: number }> = {
  quick: { label: 'Quick', min: 20 },
  short: { label: 'Short', min: 45 },
  medium: { label: 'Medium', min: 90 },
  long: { label: 'Long', min: 150 }
}
/** A light effort estimate from an item's type + points. */
function effortFor(cat: ACat, points: number | null): EffortKey {
  const p = points ?? 0
  if (cat === 'Exam' || cat === 'Project') return 'long'
  if (cat === 'Essay') return p >= 50 ? 'long' : 'medium'
  if (cat === 'Lab') return 'medium'
  if (cat === 'Quiz') return p >= 30 ? 'medium' : 'short'
  if (cat === 'Discussion') return 'quick'
  // Homework / Other: scale by points
  if (p >= 80) return 'long'
  if (p >= 40) return 'medium'
  if (p >= 12) return 'short'
  return 'quick'
}
/** A coarse category from a title (mirrors deriveCat, title-only). */
function catFromTitle(title: string, isQuiz: boolean): ACat {
  const n = title.toLowerCase()
  if (isQuiz || /\bquiz(zes)?\b/.test(n)) return 'Quiz'
  if (/\b(exam|midterm|final|test)\b/.test(n)) return 'Exam'
  if (/\blab\b/.test(n)) return 'Lab'
  if (/\b(problem set|pset|homework|hw)\b/.test(n)) return 'Homework'
  if (/\b(essay|paper|writing|draft)\b/.test(n)) return 'Essay'
  if (/\b(project|portfolio)\b/.test(n)) return 'Project'
  if (/\b(discussion|forum|post)\b/.test(n)) return 'Discussion'
  return 'Other'
}
const TYPE_WEIGHT: Record<ACat, number> = {
  Exam: 1.6,
  Quiz: 1.4,
  Project: 1.25,
  Essay: 1.25,
  Lab: 1.1,
  Homework: 1,
  Discussion: 0.85,
  Other: 1
}

/* ── the week's days (Mon…Sun of the current week) ───────────────────────── */

/** Local ISO date key (yyyy-mm-dd) for a Date — no timezone drift. */
function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface WeekDay {
  iso: string
  date: Date
  name: string
  short: string
  index: number // 0 = Mon … 6 = Sun (position in the rendered week)
}
/** Mon…Sun of the week containing `now` (Monday-start). */
function weekDays(now: Date): WeekDay[] {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dow = (base.getDay() + 6) % 7 // 0 = Mon
  const monday = new Date(base)
  monday.setDate(base.getDate() - dow)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return { iso: dayKey(d), date: d, name: DAY_NAMES[d.getDay()], short: DAY_SHORT[d.getDay()], index: i }
  })
}

/* ── the planner item + the scheduler ────────────────────────────────────── */

interface PlanItem {
  id: string // canvas assignment id (string) or 'man:...'
  source: 'canvas' | 'manual'
  courseId: number
  title: string
  course: string
  color: string
  cat: ACat
  isQuiz: boolean
  points: number | null
  dueIso: string | null // raw ISO datetime, when known
  dueDayKey: string // the day this item is DUE (clamped to the week)
  effort: EffortKey
  impact: number // grade-risk × urgency
  done: boolean
}
type ImpactBand = 'high' | 'med' | 'low'
function bandOf(impact: number): ImpactBand {
  if (impact >= 1.6) return 'high'
  if (impact >= 0.7) return 'med'
  return 'low'
}

interface PlannedItem extends PlanItem {
  dayIso: string // the day the scheduler PLACED it (may be earlier than due)
  why: string // one-line explanation of placement
}
interface PlanDay {
  day: WeekDay
  items: PlannedItem[]
  minutes: number
  busy: boolean
  busyNote: string | null
  wall: boolean // crunch detected before spreading
}
interface GeneratedPlan {
  days: PlanDay[]
  insight: string
  total: number // # of (not-done) items this week
  classes: number
  heavyDay: string | null
  status: 'ok' | 'busy' | 'crunch'
}

const CAP_MIN = 165 // soft daily effort cap (minutes) before a day is "a wall"

/** Clamp a date into [Mon, Sun] of the week; null/past → today (clamped). */
function clampDayKey(due: Date | null, week: WeekDay[], todayIso: string): string {
  if (!due) return todayIso
  const k = dayKey(due)
  const first = week[0].iso
  const last = week[6].iso
  if (k < first) return todayIso < first ? first : todayIso
  if (k > last) return last
  return k
}

/**
 * Generate the week's plan from raw items + the student's reactions. Pure.
 * `weightOf(courseId, assignmentId)` returns the assignment-group weight share
 * (0–1) when Canvas exposes weighting, else null (we fall back to raw points).
 */
function generatePlan(
  raw: PlanItem[],
  week: WeekDay[],
  plan: PlanState,
  now: Date
): GeneratedPlan {
  const todayIso = dayKey(now)
  const byIso = new Map(week.map((d) => [d.iso, d]))
  const busy = new Map(plan.constraints.map((c) => [c.day, c.note || 'Busy']))

  // seed each item on a start day: a manual move wins, else its due day.
  const seeded = raw.map((it) => {
    const moved = plan.moved[it.id]
    const start = moved && byIso.has(moved) ? moved : it.dueDayKey
    return { it, day: start }
  })

  // bucket by day, ordered Mon…Sun
  const dayItems = new Map<string, PlannedItem[]>()
  for (const d of week) dayItems.set(d.iso, [])
  for (const { it, day } of seeded) {
    const placed: PlannedItem = { ...it, dayIso: day, why: '' }
    ;(dayItems.get(day) ?? dayItems.get(todayIso) ?? []).push(placed)
  }

  const minutesOf = (items: PlannedItem[]): number =>
    items.reduce((s, p) => (p.done ? s : s + EFFORT[p.effort].min), 0)
  const hasExam = (items: PlannedItem[]): boolean => items.some((p) => !p.done && p.cat === 'Exam')
  const capFor = (iso: string): number => (busy.has(iso) ? 0 : CAP_MIN)
  const isWall = (iso: string, items: PlannedItem[]): boolean => {
    const m = minutesOf(items)
    if (busy.has(iso) && m > 0) return true
    if (m > capFor(iso)) return true
    if (hasExam(items) && items.filter((p) => !p.done).length > 2) return true
    return false
  }

  // record which days were walls BEFORE spreading (for "where you stand" copy)
  const wallBefore = new Set<string>()
  for (const d of week) if (isWall(d.iso, dayItems.get(d.iso) ?? [])) wallBefore.add(d.iso)

  // ── SPREAD: latest→earliest, pull highest-impact movable item one day back ─
  const idxOf = (iso: string): number => week.findIndex((d) => d.iso === iso)
  let guard = 0
  for (let di = week.length - 1; di >= 0; di--) {
    const iso = week[di].iso
    let safety = 0
    while (isWall(iso, dayItems.get(iso) ?? []) && safety++ < 30 && guard++ < 500) {
      const here = dayItems.get(iso) ?? []
      // earliest non-busy day we could pull work back to (>= today, < current).
      let target = -1
      for (let t = Math.max(0, idxOf(todayIso)); t < di; t++) {
        if (!busy.has(week[t].iso)) {
          target = t
          break
        }
      }
      if (target < 0) break // no earlier open day — this day can't be relieved
      // pull the highest-impact, not-done item one open day earlier.
      const pick = here.filter((p) => !p.done).sort((a, b) => b.impact - a.impact)[0]
      if (!pick) break
      const from = dayItems.get(iso)!
      from.splice(from.indexOf(pick), 1)
      pick.dayIso = week[target].iso
      pick.why = '__moved__'
      dayItems.get(week[target].iso)!.push(pick)
    }
  }

  // ── assemble + write each item's WHY ──────────────────────────────────────
  const days: PlanDay[] = week.map((d) => {
    const items = (dayItems.get(d.iso) ?? []).slice().sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      return b.impact - a.impact
    })
    const note = busy.get(d.iso) ?? null
    return {
      day: d,
      items,
      minutes: minutesOf(items),
      busy: busy.has(d.iso),
      busyNote: note,
      wall: wallBefore.has(d.iso)
    }
  })

  // the heaviest non-busy day (by effort minutes) for the insight
  const heaviest = days
    .filter((d) => !d.busy && d.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)[0]
  const heavyName = heaviest && wallBefore.has(heaviest.day.iso) ? heaviest.day.name : null

  for (const d of days) {
    const top = d.items.filter((p) => !p.done).sort((a, b) => b.impact - a.impact)[0]
    for (const p of d.items) {
      if (p.why === '__moved__') {
        const dueDay = byIso.get(p.dueDayKey)
        p.why = dueDay && dueDay.iso !== d.day.iso ? `Moved up so ${dueDay.name.slice(0, 3)} isn’t a wall` : 'Moved earlier to spread the load'
        continue
      }
      if (p.done) {
        p.why = 'Done'
        continue
      }
      if (p === top && bandOf(p.impact) === 'high') {
        const due = byIso.get(p.dueDayKey)
        p.why = `Biggest grade risk${due ? `, due ${due.short}` : ''}`
      } else if (p.effort === 'quick') {
        p.why = 'Quick win'
      } else if (p.cat === 'Exam') {
        p.why = 'Exam — study block'
      } else if (bandOf(p.impact) === 'high') {
        p.why = 'High impact — get ahead'
      } else {
        const due = byIso.get(p.dueDayKey)
        p.why = due && due.iso === d.day.iso ? 'Due today' : 'On track for its due day'
      }
    }
  }

  // ── the summary insight + status ──────────────────────────────────────────
  const live = raw.filter((it) => !it.done)
  const total = live.length
  const classes = new Set(live.map((it) => it.course)).size
  let status: 'ok' | 'busy' | 'crunch' = 'ok'
  if (wallBefore.size > 0 || live.some((it) => it.cat === 'Exam')) status = 'crunch'
  else if (total >= 6) status = 'busy'

  let insight: string
  if (total === 0) {
    insight = 'Nothing due this week — a clear runway ahead.'
  } else {
    const head = `${total} ${total === 1 ? 'thing' : 'things'} across ${classes} ${classes === 1 ? 'class' : 'classes'}`
    if (heavyName) insight = `${head} — spread so ${heavyName} isn’t a wall.`
    else if (status === 'crunch') insight = `${head} — sequenced so the high-stakes work comes first.`
    else if (status === 'busy') insight = `${head} — paced evenly across the week.`
    else insight = `${head} — a light week, handled.`
  }

  return { days, insight, total, classes, heavyDay: heavyName, status }
}

/* ── the cross-app summary Hangar Radar reads (stable shape) ─────────────── */

interface PylonSummary {
  app: 'pylon'
  updatedAt: number
  headline: string
  nearest: { title: string; course: string; dueInHours: number; impact: ImpactBand } | null
  dueThisWeek: number
  heavyDay: string | null
  status: 'ok' | 'busy' | 'crunch'
}
async function writePylonSummary(s: PylonSummary): Promise<void> {
  try {
    await window.decks.vault.set({ key: VAULT_SUMMARY_PYLON, plaintext: JSON.stringify(s) })
  } catch {
    /* summary is best-effort; Hangar simply shows nothing if it's missing */
  }
}

/* ── fetch every course's assignment-group weights (for impact scoring) ───── */

/** Map of `${courseId}:${assignmentId}` → that item's share (0–1) of the grade. */
type WeightMap = Map<string, number>
function useWeights(courses: Course[]): { weights: WeightMap; loaded: boolean } {
  const ids = courses.map((c) => c.id).join(',')
  const [weights, setWeights] = useState<WeightMap>(new Map())
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    if (courses.length === 0) {
      setWeights(new Map())
      setLoaded(true)
      return
    }
    setLoaded(false)
    void Promise.all(
      courses.map((c) =>
        paginate<CanvasAssignmentGroup>(
          `/api/v1/courses/${c.id}/assignment_groups?per_page=100&include[]=assignments`
        )
          .then((groups) => ({ id: c.id, groups }))
          .catch(() => ({ id: c.id, groups: [] as CanvasAssignmentGroup[] }))
      )
    ).then((results) => {
      if (!alive) return
      const map: WeightMap = new Map()
      for (const { id, groups } of results) {
        const weighted = groups.some((g) => (g.group_weight ?? 0) > 0)
        const totalPts = groups.reduce(
          (s, g) => s + (g.assignments ?? []).reduce((t, a) => t + (a.points_possible ?? 0), 0),
          0
        )
        for (const g of groups) {
          const gp = (g.assignments ?? []).reduce((t, a) => t + (a.points_possible ?? 0), 0)
          for (const a of g.assignments ?? []) {
            const within = gp > 0 ? (a.points_possible ?? 0) / gp : 0
            const share = weighted
              ? (((g.group_weight ?? 0) / 100) * within)
              : totalPts > 0
                ? (a.points_possible ?? 0) / totalPts
                : 0
            map.set(`${id}:${a.id}`, share)
          }
        }
      }
      setWeights(map)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])
  return { weights, loaded }
}

/* ── build the raw PlanItem[] from live upcoming + manual items ───────────── */

function buildRawItems(
  upcoming: Upcoming[],
  manual: ManualPlanItem[],
  weights: WeightMap,
  week: WeekDay[],
  done: Set<string>,
  now: Date
): PlanItem[] {
  const todayIso = dayKey(now)
  const first = week[0].iso
  const last = week[6].iso
  const inWeek = (iso: string): boolean => iso >= first && iso <= last

  // the largest raw-points value, to normalise grade-risk into ~0–2 when we
  // have no Canvas weighting to lean on.
  const maxPts = Math.max(10, ...upcoming.map((u) => u.points ?? 0))

  const canvasItems: PlanItem[] = upcoming
    .filter((u) => {
      // only this week (by due date); undated items skip the day plan
      const due = u.dueIn !== null ? new Date(now.getTime() + u.dueIn * 86400000) : null
      const k = due ? dayKey(due) : null
      // include if due within the week window, OR past-but-not-done (carry-over)
      if (k && inWeek(k)) return true
      if (u.dueIn !== null && u.dueIn < 0 && u.dueIn > -7) return true // recently overdue
      return false
    })
    .map((u) => {
      const due = u.dueIn !== null ? new Date(now.getTime() + u.dueIn * 86400000) : null
      const cat = catFromTitle(u.title, u.kind === 'quiz')
      const share = weights.get(`${u.courseId}:${u.id}`)
      // grade risk: weighted share (×8 → ~0–1+ for a heavy item) or points-normalised
      const risk = share != null ? share * 8 : (u.points ?? 0) / maxPts
      const urgency = u.dueIn === null ? 1 : Math.max(1, Math.min(2, 2 - u.dueIn / 7))
      const impact = Math.max(0.05, risk * TYPE_WEIGHT[cat] * urgency)
      return {
        id: u.id,
        source: 'canvas' as const,
        courseId: u.courseId,
        title: u.title,
        course: u.course,
        color: u.color,
        cat,
        isQuiz: u.kind === 'quiz',
        points: u.points,
        dueIso: due ? due.toISOString() : null,
        dueDayKey: clampDayKey(due, week, todayIso),
        effort: effortFor(cat, u.points),
        impact,
        done: done.has(u.id)
      }
    })

  const manualItems: PlanItem[] = manual
    .filter((m) => inWeek(m.dueDay))
    .map((m) => {
      const due = new Date(`${m.dueDay}T17:00:00`)
      const cat = catFromTitle(m.title, false)
      const dueIn = (due.getTime() - now.getTime()) / 86400000
      const urgency = Math.max(1, Math.min(2, 2 - dueIn / 7))
      const impact = Math.max(0.05, 0.5 * TYPE_WEIGHT[cat] * urgency) // mid grade-risk
      return {
        id: m.id,
        source: 'manual' as const,
        courseId: -1,
        title: m.title,
        course: m.label || 'Personal',
        color: T.bright,
        cat,
        isQuiz: false,
        points: null,
        dueIso: due.toISOString(),
        dueDayKey: clampDayKey(due, week, todayIso),
        effort: m.effort,
        impact,
        done: done.has(m.id)
      }
    })

  return [...canvasItems, ...manualItems]
}

/* ── build a downloadable .ics of the planned blocks ─────────────────────── */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
/** A floating-time ICS stamp (yyyymmddThhmmss) for a local Date. */
function icsStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}
function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}
/** Build an .ics where each planned block is an event on its placed day. */
function buildIcs(days: PlanDay[]): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JetCore//Pylon Auto-Planner//EN', 'CALSCALE:GREGORIAN']
  const stampNow = icsStamp(new Date())
  for (const d of days) {
    let cursor = new Date(d.day.date)
    cursor.setHours(16, 0, 0, 0) // study blocks start 4pm
    for (const p of d.items) {
      if (p.done) continue
      const start = new Date(cursor)
      const end = new Date(start.getTime() + EFFORT[p.effort].min * 60000)
      lines.push(
        'BEGIN:VEVENT',
        `UID:${p.id}-${d.day.iso}@jetcore.pylon`,
        `DTSTAMP:${stampNow}`,
        `DTSTART:${icsStamp(start)}`,
        `DTEND:${icsStamp(end)}`,
        `SUMMARY:${icsEscape(`${p.title} (${p.course})`)}`,
        `DESCRIPTION:${icsEscape(`${EFFORT[p.effort].label} · ${p.why}`)}`,
        'END:VEVENT'
      )
      cursor = new Date(end.getTime() + 15 * 60000) // 15-min gap
    }
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
function downloadIcs(text: string): void {
  try {
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pylon-week.ics'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } catch {
    /* download blocked — nothing we can do, fail quietly */
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  THE AUTO-PLANNER VIEW ("This week" landing)
 * ═════════════════════════════════════════════════════════════════════════ */

function WeekView({
  courses,
  upcoming,
  termAvg,
  host,
  onCourse,
  onOpenAssign
}: {
  courses: Course[]
  upcoming: Upcoming[]
  termAvg: number | null
  host: string
  onCourse: (id: number, area: CourseArea) => void
  onOpenAssign: (courseId: number, assignmentId: number, siblings?: number[]) => void
}): JSX.Element {
  const now = useMemo(() => new Date(), [])
  const week = useMemo(() => weekDays(now), [now])
  const todayIso = dayKey(now)
  const { weights, loaded: weightsLoaded } = useWeights(courses)

  // persisted reactions (vault key 'pylon.plan')
  const [plan, setPlan] = useState<PlanState>(EMPTY_PLAN)
  const [planLoaded, setPlanLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    void loadPlan().then((p) => {
      if (alive) {
        setPlan(p)
        setPlanLoaded(true)
      }
    })
    return () => {
      alive = false
    }
  }, [])
  const update = useCallback((next: PlanState) => {
    setPlan(next)
    void savePlan(next)
  }, [])

  // raw items → generated plan (auto-reflows whenever Canvas data, weights, or
  // the student's reactions change — recomputed on each render of fresh data).
  const done = useMemo(() => new Set(plan.done), [plan.done])
  const raw = useMemo(
    () => buildRawItems(upcoming, plan.manual, weights, week, done, now),
    [upcoming, plan.manual, weights, week, done, now]
  )
  const generated = useMemo(() => generatePlan(raw, week, plan, now), [raw, week, plan, now])

  // write the cross-app summary Hangar reads, whenever the plan settles.
  useEffect(() => {
    if (!planLoaded) return
    const live = raw.filter((it) => !it.done)
    const nearest = live
      .filter((it) => it.dueIso)
      .sort((a, b) => Date.parse(a.dueIso!) - Date.parse(b.dueIso!))[0]
    const summary: PylonSummary = {
      app: 'pylon',
      updatedAt: Date.now(),
      headline:
        generated.total === 0
          ? 'Nothing due this week'
          : `${generated.status === 'crunch' ? 'Heavy' : generated.status === 'busy' ? 'Busy' : 'Light'} week — ${generated.total} ${generated.total === 1 ? 'item' : 'items'}`,
      nearest: nearest
        ? {
            title: nearest.title,
            course: nearest.course,
            dueInHours: Math.max(0, Math.round((Date.parse(nearest.dueIso!) - Date.now()) / 3600000)),
            impact: bandOf(nearest.impact)
          }
        : null,
      dueThisWeek: generated.total,
      heavyDay: generated.heavyDay,
      status: generated.status
    }
    void writePylonSummary(summary)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated, planLoaded])

  /* ── react actions ──────────────────────────────────────────────────────── */
  const toggleDone = (id: string): void =>
    update({ ...plan, done: done.has(id) ? plan.done.filter((x) => x !== id) : [...plan.done, id] })
  const moveItem = (id: string, dayIso: string): void =>
    update({ ...plan, moved: { ...plan.moved, [id]: dayIso } })
  const setBusy = (dayIso: string, note: string): void => {
    const without = plan.constraints.filter((c) => c.day !== dayIso)
    update({ ...plan, constraints: note ? [...without, { day: dayIso, note }] : without })
  }
  const clearBusy = (dayIso: string): void =>
    update({ ...plan, constraints: plan.constraints.filter((c) => c.day !== dayIso) })
  const regenerate = (): void => update({ ...plan, moved: {} }) // drop manual moves, re-balance fresh
  const addManual = (m: ManualPlanItem): void => update({ ...plan, manual: [...plan.manual, m] })
  const removeManual = (id: string): void =>
    update({
      ...plan,
      manual: plan.manual.filter((m) => m.id !== id),
      done: plan.done.filter((x) => x !== id),
      moved: Object.fromEntries(Object.entries(plan.moved).filter(([k]) => k !== id))
    })

  const avgTone = gradeTone(termAvg)
  const liveDays = generated.days.filter((d) => d.items.length > 0)
  const empty = generated.total === 0 && plan.manual.length === 0

  // UI-only: which day's "I'm busy" / "add item" editor is open
  const [busyEditor, setBusyEditor] = useState<string | null>(null)
  const [moveEditor, setMoveEditor] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{host}</span>
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, color: T.bright, background: T.soft, letterSpacing: '.04em' }}>AUTO-PLANNED</span>
          </div>
          <h1 className="disp" style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>This week</h1>
          <p style={{ fontSize: 15.5, color: 'var(--ink-2)', marginTop: 6, maxWidth: 520 }}>
            Your week, planned from live Canvas. You just react.
          </p>
        </div>
        {termAvg !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: '0 0 auto' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Term average</div>
              <div className="mono disp" style={{ fontSize: 26, fontWeight: 700, color: avgTone }}>
                <CountUp value={termAvg} decimals={1} suffix="%" />
              </div>
            </div>
            <Ring value={termAvg} size={66} stroke={7} color={avgTone}>
              <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{Math.round(termAvg)}</span>
            </Ring>
          </div>
        )}
      </div>

      {empty ? (
        <StateCard
          icon="check"
          title="Nothing due this week"
          body="Canvas shows a clear week ahead — no readings, problem sets or quizzes due. Add your own item below if you’ve got work that isn’t in Canvas."
          action={<PrimaryButton icon="plus" label="Add an item" onClick={() => setAddOpen(true)} />}
        />
      ) : (
        <>
          {/* summary insight + the toolbar of react actions */}
          <div style={{ borderRadius: 18, background: `linear-gradient(135deg, ${T.wash}, var(--card))`, border: `1px solid ${T.line}`, padding: '16px 18px', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: T.soft, color: T.bright, flex: '0 0 auto' }}>
                <Icon name={generated.status === 'crunch' ? 'bolt' : generated.status === 'busy' ? 'spark' : 'sun'} size={19} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="disp" style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.4 }}>{generated.insight}</div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>
                  {weightsLoaded ? 'Weighted by grade impact + due date' : 'Ranking by points + due date…'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <ActionChip icon="refresh" label="Re-balance" onClick={regenerate} />
              <ActionChip icon="plus" label="Add item" onClick={() => setAddOpen((v) => !v)} active={addOpen} />
              <ActionChip icon="calendar" label="Add to calendar" onClick={() => downloadIcs(buildIcs(generated.days))} />
            </div>
            {addOpen && (
              <AddItemForm
                week={week}
                defaultDay={todayIso}
                onAdd={(m) => {
                  addManual(m)
                  setAddOpen(false)
                }}
                onCancel={() => setAddOpen(false)}
              />
            )}
          </div>

          {/* the week, grouped BY DAY */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {liveDays.map((d) => (
              <DayCard
                key={d.day.iso}
                d={d}
                isToday={d.day.iso === todayIso}
                week={week}
                onOpenAssign={onOpenAssign}
                onToggleDone={toggleDone}
                onMove={moveItem}
                onRemoveManual={removeManual}
                onSetBusy={setBusy}
                onClearBusy={clearBusy}
                busyEditor={busyEditor}
                setBusyEditor={setBusyEditor}
                moveEditor={moveEditor}
                setMoveEditor={setMoveEditor}
              />
            ))}
            {/* busy days with no work still show, so you can clear the constraint */}
            {generated.days
              .filter((d) => d.items.length === 0 && d.busy)
              .map((d) => (
                <DayCard
                  key={d.day.iso}
                  d={d}
                  isToday={d.day.iso === todayIso}
                  week={week}
                  onOpenAssign={onOpenAssign}
                  onToggleDone={toggleDone}
                  onMove={moveItem}
                  onRemoveManual={removeManual}
                  onSetBusy={setBusy}
                  onClearBusy={clearBusy}
                  busyEditor={busyEditor}
                  setBusyEditor={setBusyEditor}
                  moveEditor={moveEditor}
                  setMoveEditor={setMoveEditor}
                />
              ))}
          </div>
        </>
      )}

      {/* where you stand — course lanes */}
      <div style={{ marginTop: 30 }}>
        <h2 className="disp" style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Where you stand</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {courses.map((c) => (
            <CourseLane key={c.id} c={c} onClick={() => onCourse(c.id, 'grades')} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── a small toolbar action chip ─────────────────────────────────────────── */

function ActionChip({ icon, label, onClick, active }: { icon: string; label: string; onClick: () => void; active?: boolean }): JSX.Element {
  return (
    <button
      className="tap"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '8px 13px',
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        color: active ? T.ink : 'var(--ink-2)',
        background: active ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'var(--card)',
        border: active ? '1px solid transparent' : '1px solid var(--line)'
      }}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  )
}

/* ── one day in the plan (the by-day grouping) ───────────────────────────── */

function DayCard({
  d,
  isToday,
  week,
  onOpenAssign,
  onToggleDone,
  onMove,
  onRemoveManual,
  onSetBusy,
  onClearBusy,
  busyEditor,
  setBusyEditor,
  moveEditor,
  setMoveEditor
}: {
  d: PlanDay
  isToday: boolean
  week: WeekDay[]
  onOpenAssign: (courseId: number, assignmentId: number, siblings?: number[]) => void
  onToggleDone: (id: string) => void
  onMove: (id: string, dayIso: string) => void
  onRemoveManual: (id: string) => void
  onSetBusy: (dayIso: string, note: string) => void
  onClearBusy: (dayIso: string) => void
  busyEditor: string | null
  setBusyEditor: (iso: string | null) => void
  moveEditor: string | null
  setMoveEditor: (id: string | null) => void
}): JSX.Element {
  const liveCount = d.items.filter((p) => !p.done).length
  const hrs = d.minutes >= 60 ? `${Math.round((d.minutes / 60) * 10) / 10}h` : `${d.minutes}m`
  const wall = d.wall && !d.busy
  return (
    <div style={{ borderRadius: 18, background: 'var(--card)', border: `1px solid ${d.busy ? 'color-mix(in oklch,var(--neg) 26%,var(--line))' : wall ? 'color-mix(in oklch,var(--warn) 30%,var(--line))' : 'var(--line)'}`, overflow: 'hidden' }}>
      {/* day header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 16px', background: 'var(--card-2)', borderBottom: d.items.length > 0 ? '1px solid var(--line)' : 'none' }}>
        <div style={{ flex: '0 0 auto', textAlign: 'center', minWidth: 40 }}>
          <div className="disp" style={{ fontSize: 16, fontWeight: 800, color: isToday ? T.bright : 'var(--ink)' }}>{d.day.short}</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{d.day.date.getMonth() + 1}/{d.day.date.getDate()}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="disp" style={{ fontSize: 14.5, fontWeight: 700 }}>{isToday ? 'Today' : d.day.name}</span>
            {d.busy ? (
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, color: 'var(--neg)', background: 'color-mix(in oklch,var(--neg) 14%,transparent)' }}>Busy · {d.busyNote}</span>
            ) : wall ? (
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, color: 'var(--warn)', background: 'color-mix(in oklch,var(--warn) 14%,transparent)' }}>Heavy day</span>
            ) : null}
          </div>
          {d.items.length > 0 && (
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
              {liveCount > 0 ? `${liveCount} ${liveCount === 1 ? 'item' : 'items'} · ~${hrs}` : 'All done'}
            </div>
          )}
        </div>
        {d.busy ? (
          <button className="tap" onClick={() => onClearBusy(d.day.iso)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', background: 'var(--card)', border: '1px solid var(--line)', flex: '0 0 auto' }}>
            <Icon name="close" size={13} /> Free up
          </button>
        ) : (
          <button className="tap" onClick={() => setBusyEditor(busyEditor === d.day.iso ? null : d.day.iso)} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', background: 'var(--card)', border: '1px solid var(--line)', flex: '0 0 auto' }}>
            <Icon name="flag" size={13} /> I’m busy
          </button>
        )}
      </div>

      {busyEditor === d.day.iso && !d.busy && (
        <BusyEditor
          onSet={(note) => {
            onSetBusy(d.day.iso, note)
            setBusyEditor(null)
          }}
          onCancel={() => setBusyEditor(null)}
        />
      )}

      {/* items */}
      {d.items.map((p) => (
        <PlanRow
          key={p.id}
          p={p}
          week={week}
          dayIso={d.day.iso}
          onOpen={() => (p.source === 'canvas' ? onOpenAssign(p.courseId, Number(p.id)) : undefined)}
          onToggleDone={() => onToggleDone(p.id)}
          onMove={(iso) => {
            onMove(p.id, iso)
            setMoveEditor(null)
          }}
          onRemoveManual={() => onRemoveManual(p.id)}
          moveOpen={moveEditor === p.id}
          setMoveOpen={(open) => setMoveEditor(open ? p.id : null)}
        />
      ))}
    </div>
  )
}

/* ── a single planned item row ───────────────────────────────────────────── */

const IMPACT_LABEL: Record<ImpactBand, { text: string; color: string }> = {
  high: { text: 'High impact', color: 'var(--neg)' },
  med: { text: 'Med impact', color: 'var(--warn)' },
  low: { text: 'Low impact', color: 'var(--ink-3)' }
}

function PlanRow({
  p,
  week,
  dayIso,
  onOpen,
  onToggleDone,
  onMove,
  onRemoveManual,
  moveOpen,
  setMoveOpen
}: {
  p: PlannedItem
  week: WeekDay[]
  dayIso: string
  onOpen: () => void
  onToggleDone: () => void
  onMove: (iso: string) => void
  onRemoveManual: () => void
  moveOpen: boolean
  setMoveOpen: (open: boolean) => void
}): JSX.Element {
  const band = bandOf(p.impact)
  const il = IMPACT_LABEL[band]
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', opacity: p.done ? 0.55 : 1 }}>
        {/* done checkbox */}
        <button
          className="tap"
          onClick={onToggleDone}
          aria-label={p.done ? 'Mark not done' : 'Mark done'}
          style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', flex: '0 0 auto', border: p.done ? '1px solid transparent' : '1.5px solid var(--line)', background: p.done ? 'var(--pos)' : 'transparent', color: p.done ? 'oklch(0.99 0.02 150)' : 'transparent' }}
        >
          <Icon name="check" size={14} />
        </button>

        {/* tap the title to open the assignment (Canvas items) */}
        <button
          className="tap"
          onClick={onOpen}
          disabled={p.source !== 'canvas'}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', cursor: p.source === 'canvas' ? 'pointer' : 'default' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--card-2)', color: 'var(--ink-2)', flex: '0 0 auto' }}>
              <Icon name={p.isQuiz || p.cat === 'Exam' ? 'target' : p.cat === 'Discussion' ? 'people' : 'book'} size={15} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, textDecoration: p.done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: p.color }} />
                  {p.course}
                </span>
                <span className="mono">{EFFORT[p.effort].label} · {EFFORT[p.effort].min}m</span>
              </div>
            </div>
          </div>
        </button>

        {/* the WHY + impact band */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: '0 0 auto', maxWidth: 170 }}>
          {!p.done && (
            <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: il.color, background: `color-mix(in oklch, ${il.color} 14%, transparent)` }}>{il.text}</span>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'right', lineHeight: 1.35 }}>{p.why}</span>
        </div>

        {/* move + remove controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
          <button className="tap" onClick={() => setMoveOpen(!moveOpen)} aria-label="Move to another day" style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', background: moveOpen ? 'var(--card-2)' : 'transparent' }}>
            <Icon name="calendar" size={15} />
          </button>
          {p.source === 'manual' && (
            <button className="tap" onClick={onRemoveManual} aria-label="Remove item" style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', color: 'var(--ink-3)', background: 'transparent' }}>
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      </div>

      {/* move-to-day picker */}
      {moveOpen && (
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 14px 56px', flexWrap: 'wrap' }}>
          {week.map((wd) => {
            const on = wd.iso === dayIso
            return (
              <button
                key={wd.iso}
                className="tap mono"
                onClick={() => onMove(wd.iso)}
                style={{ padding: '5px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: on ? T.ink : 'var(--ink-2)', background: on ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'var(--card-2)', border: '1px solid var(--line)' }}
              >
                {wd.short}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── the "I'm busy" constraint editor ────────────────────────────────────── */

function BusyEditor({ onSet, onCancel }: { onSet: (note: string) => void; onCancel: () => void }): JSX.Element {
  const [note, setNote] = useState('')
  const inputStyle: CSSProperties = { flex: 1, minWidth: 160, height: 36, padding: '0 11px', borderRadius: 9, background: 'var(--card-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13, outline: 'none' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', background: 'color-mix(in oklch,var(--neg) 6%,transparent)', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
      <input
        autoFocus
        value={note}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSet(note.trim() || 'Busy')
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="What’s up? (e.g. Work shift, Practice)"
        style={inputStyle}
      />
      <button className="tap" onClick={() => onSet(note.trim() || 'Busy')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 9, background: `linear-gradient(140deg,${T.bright},${T.deep})`, color: T.ink, fontWeight: 700, fontSize: 12.5 }}>
        Block this day
      </button>
      <button className="tap" onClick={onCancel} style={{ height: 36, padding: '0 12px', borderRadius: 9, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontWeight: 600, fontSize: 12.5 }}>
        Cancel
      </button>
    </div>
  )
}

/* ── add a manual (non-Canvas) item ──────────────────────────────────────── */

const planNewId = (): string => `man:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function AddItemForm({ week, defaultDay, onAdd, onCancel }: { week: WeekDay[]; defaultDay: string; onAdd: (m: ManualPlanItem) => void; onCancel: () => void }): JSX.Element {
  const [title, setTitle] = useState('')
  const [label, setLabel] = useState('')
  const [dueDay, setDueDay] = useState(defaultDay)
  const [effort, setEffort] = useState<EffortKey>('short')
  const inputStyle: CSSProperties = { width: '100%', height: 38, padding: '0 11px', borderRadius: 9, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13.5, outline: 'none' }
  const labelStyle: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', display: 'block', marginBottom: 5 }
  const canAdd = !!title.trim()
  const add = (): void => {
    if (!canAdd) return
    onAdd({ id: planNewId(), title: title.trim(), label: label.trim(), dueDay, effort })
  }
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 12, lineHeight: 1.5 }}>
        Got work that isn’t in Canvas? Add it — it’s planned and sequenced exactly like everything else.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 10, marginBottom: 10 }}>
        <label style={{ display: 'block' }}>
          <span style={labelStyle}>What is it?</span>
          <input autoFocus value={title} onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} placeholder="e.g. Read chapter 4" style={inputStyle} />
        </label>
        <label style={{ display: 'block' }}>
          <span style={labelStyle}>Class / label</span>
          <input value={label} onChange={(e: ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} placeholder="e.g. Bio" style={inputStyle} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <span style={labelStyle}>Due day</span>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {week.map((wd) => {
              const on = wd.iso === dueDay
              return (
                <button key={wd.iso} className="tap mono" onClick={() => setDueDay(wd.iso)} style={{ padding: '7px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: on ? T.ink : 'var(--ink-2)', background: on ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'var(--card)', border: '1px solid var(--line)' }}>{wd.short}</button>
              )
            })}
          </div>
        </div>
        <div>
          <span style={labelStyle}>Effort</span>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {(Object.keys(EFFORT) as EffortKey[]).map((k) => {
              const on = k === effort
              return (
                <button key={k} className="tap" onClick={() => setEffort(k)} style={{ padding: '7px 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: on ? T.ink : 'var(--ink-2)', background: on ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'var(--card)', border: '1px solid var(--line)' }}>{EFFORT[k].label}</button>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <button className="tap" onClick={onCancel} style={{ height: 38, padding: '0 14px', borderRadius: 9, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontWeight: 600, fontSize: 13 }}>Cancel</button>
          <button className="tap" onClick={add} disabled={!canAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 16px', borderRadius: 9, background: canAdd ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'var(--card-3)', color: canAdd ? T.ink : 'var(--ink-3)', fontWeight: 700, fontSize: 13, opacity: canAdd ? 1 : 0.7 }}>
            <Icon name="plus" size={15} /> Add to plan
          </button>
        </div>
      </div>
    </div>
  )
}

/** A single course lane row (design courseLane, 368–379). */
function CourseLane({ c, onClick }: { c: Course; onClick: () => void }): JSX.Element {
  const pct = c.score ?? 0
  return (
    <button className="lift" onClick={onClick} style={{ display: 'block', textAlign: 'left', width: '100%', position: 'relative', overflow: 'hidden', borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: '16px 18px 16px 20px' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: c.color }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: c.color }}>{c.code}</span>
            <span className="disp" style={{ fontSize: 17, fontWeight: 700 }}>{c.name}</span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: 'var(--card-3)', overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: c.color, borderRadius: 99 }} />
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
          <div className="mono disp" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: gradeTone(c.score), lineHeight: 1 }}>{c.letter}</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 3 }}>{c.score !== null ? `${c.score.toFixed(1)}%` : 'No grade'}</div>
        </div>
        <span style={{ color: 'var(--ink-3)' }}><Icon name="chevR" size={20} /></span>
      </div>
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  PLANNER (design pylonPlanner, 573–587)
 * ═════════════════════════════════════════════════════════════════════════ */

function PlannerView({ upcoming, onOpenAssign }: { upcoming: Upcoming[]; onOpenAssign: (courseId: number, assignmentId: number, siblings?: number[]) => void }): JSX.Element {
  const sorted = upcoming.slice().sort((a, b) => (a.dueIn ?? Infinity) - (b.dueIn ?? Infinity))
  const groups: [string, Upcoming[]][] = [
    ['Due today', sorted.filter((a) => a.dueIn !== null && a.dueIn < 1)],
    ['This week', sorted.filter((a) => a.dueIn !== null && a.dueIn >= 1 && a.dueIn <= 7)],
    ['Later', sorted.filter((a) => a.dueIn === null || a.dueIn > 7)]
  ]
  const gc: Record<string, string> = { 'Due today': 'var(--neg)', 'This week': 'var(--warn)', Later: T.bright }

  return (
    <div>
      <h1 className="disp" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>Planner</h1>
      <p style={{ fontSize: 15, color: 'var(--ink-2)', marginBottom: 24, maxWidth: 460 }}>Everything ahead across your classes, sorted by urgency.</p>
      {upcoming.length === 0 ? (
        <StateCard icon="check" title="Nothing upcoming" body="Canvas didn’t return anything on your planner — a clear runway ahead." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {groups.map(([label, items]) =>
            items.length === 0 ? null : (
              <div key={label}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 99, background: gc[label] }} />
                  <h3 className="disp" style={{ fontSize: 15, fontWeight: 700 }}>{label}</h3>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{items.length}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {items.map((a) => {
                    const ch = dueChip(a.dueIn)
                    return (
                      <button key={a.id} className="lift" onClick={() => onOpenAssign(a.courseId, Number(a.id))} style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: '14px 16px', borderRadius: 14, background: 'var(--card)', border: '1px solid var(--line)', cursor: a.courseId >= 0 ? 'pointer' : 'default' }}>
                        <span style={{ width: 4, height: 38, borderRadius: 99, background: a.color, flex: '0 0 auto' }} />
                        <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--card-2)', color: 'var(--ink-2)', flex: '0 0 auto' }}>
                          <Icon name={a.kind === 'quiz' ? 'target' : 'book'} size={17} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700 }}>{a.title}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>{a.course}{a.points !== null ? ` · ${a.points} pts` : ''}</div>
                        </div>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 999, color: ch.tone, background: ch.soft }}>{ch.text}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  GRADES — the grade lab (design pylonGrades 536–547 + live what-if engine)
 * ═════════════════════════════════════════════════════════════════════════ */

type GradesTab = 'whatif' | 'gpa'

function GradesView({
  courses,
  manual,
  onManual,
  gpa,
  onGpa,
  vaultLoaded,
  onCourse
}: {
  courses: Course[]
  manual: ManualStore
  onManual: (next: ManualStore) => void
  gpa: GpaSettings
  onGpa: (next: GpaSettings) => void
  vaultLoaded: boolean
  onCourse: (id: number) => void
}): JSX.Element {
  const [tab, setTab] = useState<GradesTab>('whatif')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h1 className="disp" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>Where you stand</h1>
          <p style={{ fontSize: 15, color: 'var(--ink-2)', maxWidth: 460 }}>Drag a score, watch your grade move — then see exactly what you need.</p>
        </div>
        <SegToggle
          options={[{ value: 'whatif', label: 'What-if' }, { value: 'gpa', label: 'GPA' }]}
          value={tab}
          onChange={(v) => setTab(v as GradesTab)}
        />
      </div>

      {/* the at-a-glance grade cards (design 541–546) */}
      {courses.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 26 }}>
          {courses.map((c) => (
            <button key={c.id} className="lift" onClick={() => onCourse(c.id)} style={{ textAlign: 'left', borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Ring value={c.score ?? 0} size={58} stroke={6} color={c.color}>
                  <span className="mono disp" style={{ fontSize: 15, fontWeight: 700, color: gradeTone(c.score) }}>{c.letter}</span>
                </Ring>
                <div>
                  <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: c.color }}>{c.code}</div>
                  <div className="disp" style={{ fontSize: 16, fontWeight: 700, marginTop: 1 }}>{c.name}</div>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{c.score !== null ? `${c.score.toFixed(1)}%` : 'No grade posted'}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === 'whatif' ? (
        <WhatIf courses={courses} manual={manual} onManual={onManual} vaultLoaded={vaultLoaded} />
      ) : (
        <GpaCalculator courses={courses} gpa={gpa} onGpa={onGpa} vaultLoaded={vaultLoaded} />
      )}
    </div>
  )
}

/* ── what-if engine (reuses gradeMath verbatim) ──────────────────────────── */

const GOAL_CHIPS: { label: string; value: number }[] = [
  { label: 'A', value: 93 },
  { label: 'A−', value: 90 },
  { label: 'B+', value: 87 },
  { label: 'B', value: 83 },
  { label: 'C', value: 73 }
]

function WhatIf({ courses, manual, onManual, vaultLoaded }: { courses: Course[]; manual: ManualStore; onManual: (next: ManualStore) => void; vaultLoaded: boolean }): JSX.Element {
  const [cid, setCid] = useState<number | null>(courses.length > 0 ? courses[0].id : null)
  const course = courses.find((c) => c.id === cid) ?? courses[0] ?? null

  if (!course) {
    return <StateCard icon="cap" title="No courses to simulate" body="Once Canvas returns your active classes, the simulator can play out any grade scenario." />
  }

  return (
    <div>
      <ClassSwitcher courses={courses} activeId={course.id} onPick={setCid} />
      <CourseWhatIf
        key={course.id}
        course={course}
        manual={vaultLoaded ? manual[String(course.id)] ?? [] : []}
        onManual={(items) => onManual({ ...manual, [String(course.id)]: items })}
      />
    </div>
  )
}

function CourseWhatIf({ course, manual, onManual }: { course: Course; manual: ManualItem[]; onManual: (items: ManualItem[]) => void }): JSX.Element {
  // Live: Canvas assignment groups w/ weights + assignments + submissions.
  const { state, reload } = useCanvas<CanvasAssignmentGroup[]>(
    () => paginate<CanvasAssignmentGroup>(`/api/v1/courses/${course.id}/assignment_groups?per_page=100&include[]=assignments&include[]=submission`),
    course.id
  )
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [goal, setGoal] = useState(90)

  const groups = state.phase === 'ready' ? state.data : []
  const model = useMemo(() => buildModel(groups, manual), [groups, manual])
  const items = useMemo(() => allItems(model.groups), [model])
  const real = useMemo(() => currentGrade(items), [items])
  const defaultExpected = real !== null ? Math.round(real) : goal
  const scoreOf = useCallback(
    (it: GradeItem): number | null => {
      if (it.actualPct !== null) return it.actualPct
      const o = overrides[it.key]
      return o === undefined ? defaultExpected : o
    },
    [overrides, defaultExpected]
  )
  const projected = useMemo(() => projectGrade(items, scoreOf), [items, scoreOf])
  const solve = useMemo(() => neededForGoal(items, goal), [items, goal])
  const upcoming = useMemo(() => items.filter((it) => it.actualPct === null && !it.excluded && it.weightPct > 0), [items])

  if (state.phase === 'loading') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="skel" style={{ height: 120, borderRadius: 16 }} />
        <div className="skel" style={{ height: 64, borderRadius: 16 }} />
        <div className="skel" style={{ height: 64, borderRadius: 16 }} />
      </div>
    )
  }
  if (state.phase === 'error') {
    return <StateCard icon="alert" title="Couldn’t load this class" body={state.message} action={<PrimaryButton icon="refresh" label="Try again" color={course.color} onClick={reload} />} />
  }

  const projShown = projected ?? real
  const projColor = gradeTone(projShown)
  const delta = projected !== null && real !== null ? projected - real : null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* live projection header — the always-on big number */}
        <div style={{ borderRadius: 18, background: `linear-gradient(135deg, ${cTone(course.color).wash}, var(--card))`, border: `1px solid ${cTone(course.color).line}`, padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
            <Ring value={projShown ?? 0} size={92} stroke={8} color={projColor}>
              <span className="mono disp" style={{ fontSize: 22, fontWeight: 700 }}>{projShown !== null ? letterFor(projShown) : '—'}</span>
            </Ring>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', fontWeight: 600 }}>Projected grade</div>
              <div className="mono disp" style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-0.03em', color: projColor, lineHeight: 1.05 }}>
                {projShown !== null ? <CountUp value={projShown} decimals={1} suffix="%" /> : '—'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                  Now: <strong className="mono" style={{ color: 'var(--ink-2)' }}>{real !== null ? `${round(real)}%` : '—'}</strong>
                </span>
                {delta !== null && Math.abs(delta) >= 0.05 && (
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: delta >= 0 ? 'var(--pos)' : 'var(--neg)', background: `color-mix(in oklch, ${delta >= 0 ? 'var(--pos)' : 'var(--neg)'} 14%, transparent)` }}>
                    {delta >= 0 ? '+' : '−'}{round(Math.abs(delta))}
                  </span>
                )}
              </div>
            </div>
          </div>
          {!model.weighted && groups.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 14, lineHeight: 1.5 }}>
              This class isn’t using category weights in Canvas — weights below are estimated from each item’s points.
            </div>
          )}
        </div>

        {/* upcoming work — drag/type expected scores; grade moves live */}
        <Card2 title="Upcoming work">
          {upcoming.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>
              Every graded item in this class is already in. Add a manual item below to play out a what-if.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {upcoming.map((it) => (
                <ItemSlider
                  key={it.key}
                  item={it}
                  value={scoreOf(it) ?? defaultExpected}
                  accent={course.color}
                  onChange={(v) => setOverrides((o) => ({ ...o, [it.key]: v }))}
                  cannotMove={cannotChangeLetter(items, it, scoreOf, letterFor)}
                />
              ))}
            </div>
          )}
        </Card2>

        {/* manual (PowerSchool) items */}
        <ManualItemsCard items={manual} onChange={onManual} accent={course.color} />
      </div>

      {/* right rail: goal + verdict */}
      <Card2 title="Your goal">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>Target grade</span>
          <span className="mono" style={{ fontSize: 20, fontWeight: 800, color: course.color }}>{goal}% · {letterFor(goal)}</span>
        </div>
        <input type="range" min={50} max={100} value={goal} onChange={(e: ChangeEvent<HTMLInputElement>) => setGoal(Number(e.target.value))} style={{ width: '100%', accentColor: course.color }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {GOAL_CHIPS.map((g) => (
            <button key={g.label} className="tap mono" onClick={() => setGoal(g.value)} style={{ padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: goal === g.value ? cTone(course.color).soft : 'var(--card-2)', color: goal === g.value ? course.color : 'var(--ink-3)', border: '1px solid var(--line)' }}>{g.label}</button>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--line)', margin: '18px 0' }} />
        <GoalVerdict goal={goal} solve={solve} upcoming={upcoming} accent={course.color} />
      </Card2>
    </div>
  )
}

function ItemSlider({ item, value, accent, onChange, cannotMove }: { item: GradeItem; value: number; accent: string; onChange: (v: number) => void; cannotMove: boolean }): JSX.Element {
  const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)))
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--card-2)', border: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 12, color: 'var(--ink-3)', flexWrap: 'wrap' }}>
            <span className="mono">{round(item.weightPct)}% of grade</span>
            {item.pointsPossible ? <span className="mono">· {item.pointsPossible} pts</span> : null}
            {cannotMove && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                <Icon name="check" size={12} /> Can’t change your letter
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
          <input type="number" min={0} max={100} value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(clamp(Number(e.target.value)))} className="mono" style={{ width: 58, height: 34, padding: '0 8px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, textAlign: 'center', outline: 'none' }} />
          <span className="mono" style={{ fontSize: 13, color: 'var(--ink-3)' }}>%</span>
        </div>
      </div>
      <input type="range" min={0} max={100} value={value} onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: cannotMove ? 'var(--ink-3)' : accent }} />
    </div>
  )
}

function GoalVerdict({ goal, solve, upcoming, accent }: { goal: number; solve: ReturnType<typeof neededForGoal>; upcoming: GradeItem[]; accent: string }): JSX.Element {
  if (!solve) {
    return <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>No graded weight yet — once this class has graded work (or you add manual items), the goal math kicks in.</div>
  }
  if (solve.remainingWeight <= 0) {
    return (
      <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 700, color: solve.secured ? 'var(--pos)' : 'var(--neg)' }}>
        {solve.secured ? `${letterFor(goal)} locked — nothing left to grade` : 'Out of reach — no graded work remains'}
      </div>
    )
  }
  const needed = solve.needed
  const tone = solve.secured ? 'pos' : !solve.reachable ? 'neg' : 'accent'
  const color = tone === 'neg' ? 'var(--neg)' : tone === 'pos' ? 'var(--pos)' : accent
  const bg = tone === 'neg' ? 'color-mix(in oklch, var(--neg) 10%, transparent)' : tone === 'pos' ? 'color-mix(in oklch, var(--pos) 12%, transparent)' : cTone(accent).soft
  const headline = solve.secured ? 'Already locked' : !solve.reachable ? 'Out of reach' : `${round(Math.max(0, needed))}%`
  const subject = upcoming.length === 1 ? `on ${upcoming[0].name}` : 'on average across the rest'
  return (
    <div>
      <div style={{ padding: 18, borderRadius: 12, textAlign: 'center', background: bg }}>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 4 }}>To finish at {goal}% ({letterFor(goal)}), you need</div>
        <div className="mono disp" style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, color }}>
          {solve.secured || !solve.reachable ? headline : <CountUp value={Math.max(0, needed)} decimals={1} suffix="%" />}
        </div>
        {!solve.secured && solve.reachable && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>{subject}</div>}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6, marginTop: 14 }}>
        {solve.secured ? (
          <>You&rsquo;ve already locked <strong style={{ color: 'var(--ink)' }}>{letterFor(goal)}</strong> — even a 0 on everything left keeps you there.</>
        ) : !solve.reachable ? (
          <>Even a perfect score on the remaining <strong style={{ color: 'var(--ink)' }}>{round(solve.remainingWeight)}%</strong> falls short of {goal}%. Pick a lower goal.</>
        ) : (
          <>The remaining <strong style={{ color: 'var(--ink)' }}>{round(solve.remainingWeight)}%</strong> of your grade is still up for grabs — that&rsquo;s your room to move.</>
        )}
      </div>
    </div>
  )
}

const newId = (): string => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

function ManualItemsCard({ items, onChange, accent }: { items: ManualItem[]; onChange: (items: ManualItem[]) => void; accent: string }): JSX.Element {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const [score, setScore] = useState('')
  const totalWeight = items.reduce((s, m) => s + (m.weight || 0), 0)

  const add = (): void => {
    const w = Number(weight)
    if (!name.trim() || !Number.isFinite(w) || w <= 0) return
    const s = score.trim() === '' ? null : Math.max(0, Math.min(100, Number(score)))
    onChange([...items, { id: newId(), name: name.trim(), weight: Math.max(0, Math.min(100, w)), score: s !== null && Number.isFinite(s) ? s : null }])
    setName('')
    setWeight('')
    setScore('')
  }
  const remove = (id: string): void => onChange(items.filter((m) => m.id !== id))
  const inputStyle: CSSProperties = { width: '100%', height: 38, padding: '0 10px', borderRadius: 9, background: 'var(--card-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13.5, outline: 'none' }
  const canAdd = !!name.trim() && Number(weight) > 0

  return (
    <Card2 title={`Manual items${items.length > 0 ? ` · ${round(totalWeight)}% weight` : ''}`}>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: -4, marginBottom: 14, lineHeight: 1.5 }}>
        PowerSchool has no API — type those grades in here and they count exactly like Canvas items.
      </p>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {items.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 11, background: 'var(--card-2)', border: '1px solid var(--line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{round(m.weight)}% of grade</div>
              </div>
              {m.score !== null ? (
                <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: gradeTone(m.score) }}>{round(m.score)}%</span>
              ) : (
                <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: accent, background: cTone(accent).soft }}>Upcoming</span>
              )}
              <button className="tap" onClick={() => remove(m.id)} aria-label={`Remove ${m.name}`} style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 8, color: 'var(--ink-3)', background: 'transparent' }}>
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 86px 86px auto', gap: 10, alignItems: 'end' }}>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', display: 'block', marginBottom: 5 }}>Item name</span>
          <input placeholder="e.g. Midterm exam" value={name} onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} style={inputStyle} />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', display: 'block', marginBottom: 5 }}>Weight %</span>
          <input type="number" placeholder="20" value={weight} onChange={(e: ChangeEvent<HTMLInputElement>) => setWeight(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} className="mono" style={inputStyle} />
        </label>
        <label style={{ display: 'block' }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-3)', display: 'block', marginBottom: 5 }}>Score %</span>
          <input type="number" placeholder="—" value={score} onChange={(e: ChangeEvent<HTMLInputElement>) => setScore(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} className="mono" style={inputStyle} />
        </label>
        <button className="tap" onClick={add} disabled={!canAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 38, padding: '0 14px', borderRadius: 9, background: canAdd ? `linear-gradient(140deg, ${accent}, color-mix(in oklch,${accent} 68%, black))` : 'var(--card-3)', color: canAdd ? 'oklch(0.99 0.02 250)' : 'var(--ink-3)', fontWeight: 700, fontSize: 13, opacity: canAdd ? 1 : 0.7 }}>
          <Icon name="plus" size={15} /> Add
        </button>
      </div>
    </Card2>
  )
}

/* ── GPA calculator (reuses gradeMath GPA model) ─────────────────────────── */

const TIER_LABEL: Record<ClassTier, string> = { regular: 'Regular', honors: 'Honors', ap: 'AP' }
const TIER_ORDER: ClassTier[] = ['regular', 'honors', 'ap']

function GpaCalculator({ courses, gpa, onGpa, vaultLoaded }: { courses: Course[]; gpa: GpaSettings; onGpa: (next: GpaSettings) => void; vaultLoaded: boolean }): JSX.Element {
  const graded = useMemo(() => courses.filter((c): c is Course & { score: number } => c.score !== null), [courses])
  const result = useMemo(() => computeGpa(graded, gpa), [graded, gpa])

  if (courses.length === 0) {
    return <StateCard icon="cap" title="No classes yet" body="Connect Canvas and your active classes will total into a GPA on your school’s scale." />
  }

  const setTier = (id: number, tier: ClassTier): void => onGpa({ ...gpa, tiers: { ...gpa.tiers, [String(id)]: tier } })
  const gpaMax = gpa.scale === 'unweighted' ? 4 : gpa.cap === '4.5' ? 4.5 : 5

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Card2 title="Your scale">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>Weighting</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Weighted gives honors/AP classes a bump.</div>
              </div>
              <SegToggle options={[{ value: 'unweighted', label: 'Unweighted' }, { value: 'weighted', label: 'Weighted' }]} value={gpa.scale} onChange={(v) => onGpa({ ...gpa, scale: v as GpaSettings['scale'] })} />
            </div>
            {gpa.scale === 'weighted' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>AP/honors cap</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Top grade-point an AP class can reach.</div>
                </div>
                <SegToggle options={[{ value: '5.0', label: '5.0' }, { value: '4.5', label: '4.5' }]} value={gpa.cap} onChange={(v) => onGpa({ ...gpa, cap: v as GpaSettings['cap'] })} />
              </div>
            )}
          </div>
        </Card2>

        <Card2 title="Your classes">
          {graded.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>None of your classes has a current score from Canvas yet, so there’s nothing to total. Add manual items in What-if or check back once grades post.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {graded.map((c) => {
                const tier = gpa.tiers[String(c.id)] ?? 'regular'
                const pts = classGpaPoints(c.score, tier, gpa)
                return (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderRadius: 11, background: 'var(--card-2)', border: '1px solid var(--line)', flexWrap: 'wrap' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: c.color, flex: '0 0 auto' }} />
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                      <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{round(c.score)}% · {letterFor(c.score)}</div>
                    </div>
                    <SegToggle options={TIER_ORDER.map((t) => ({ value: t, label: TIER_LABEL[t] }))} value={tier} onChange={(v) => setTier(c.id, v as ClassTier)} />
                    <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: T.bright, width: 44, textAlign: 'right', flex: '0 0 auto' }}>{pts.toFixed(1)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </Card2>
      </div>

      <Card2 title="Your GPA">
        <div style={{ textAlign: 'center', padding: '12px 0 6px' }}>
          <Ring value={result.gpa !== null ? (result.gpa / gpaMax) * 100 : 0} size={120} stroke={9} color={T.base}>
            <span className="mono disp" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>
              {result.gpa !== null ? vaultLoaded ? <CountUp value={result.gpa} decimals={2} /> : result.gpa.toFixed(2) : '—'}
            </span>
          </Ring>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 14 }}>{gpa.scale === 'weighted' ? 'Weighted' : 'Unweighted'} · out of {gpaMax.toFixed(1)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>Across {result.counted} {result.counted === 1 ? 'class' : 'classes'}</div>
        </div>
        <div style={{ borderTop: '1px solid var(--line)', margin: '16px 0' }} />
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6 }}>One class, one unit — each counts equally. Honors/AP only bump on the weighted scale. Your scale and class tags are saved on this device.</div>
      </Card2>
    </div>
  )
}

/* ── a small segmented control (warm-token, replaces ui.Segmented) ───────── */

function SegToggle<X extends string>({ options, value, onChange }: { options: { value: X; label: string }[]; value: X; onChange: (v: X) => void }): JSX.Element {
  return (
    <div style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'var(--card-2)', border: '1px solid var(--line)', gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} className="tap" onClick={() => onChange(o.value)} style={{ padding: '6px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', color: on ? T.ink : 'var(--ink-2)', background: on ? `linear-gradient(140deg,${T.bright},${T.deep})` : 'transparent' }}>{o.label}</button>
        )
      })}
    </div>
  )
}

function ClassSwitcher({ courses, activeId, onPick }: { courses: Course[]; activeId: number; onPick: (id: number) => void }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
      {courses.map((c) => {
        const on = c.id === activeId
        return (
          <button key={c.id} className="tap" onClick={() => onPick(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: on ? cTone(c.color).soft : 'var(--card)', color: on ? c.color : 'var(--ink-2)', border: '1px solid var(--line)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 99, background: c.color }} />
            {c.code}
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  FINAL CALCULATOR (design pylonCalc 548–572 + Dashboard CalcView math)
 * ═════════════════════════════════════════════════════════════════════════ */

const FINAL_TARGET_CHIPS: { label: string; value: number }[] = [
  { label: 'A', value: 93 },
  { label: 'A−', value: 90 },
  { label: 'B+', value: 87 },
  { label: 'B', value: 83 },
  { label: 'C', value: 73 }
]

function CalcView({ courses }: { courses: Course[] }): JSX.Element {
  const graded = useMemo(() => courses.filter((c): c is Course & { score: number } => c.score !== null), [courses])
  const [cid, setCid] = useState<number | null>(graded.length > 0 ? graded[0].id : null)
  const [finalWeight, setFinalWeight] = useState(20)
  const [target, setTarget] = useState(90)
  const course = graded.find((c) => c.id === cid) ?? graded[0]

  if (!course) {
    return (
      <div>
        <h1 className="disp" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>Final calculator</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-2)', marginBottom: 22, maxWidth: 460 }}>&ldquo;What do I need on the final?&rdquo; — answered, per class.</p>
        <StateCard icon="target" title="No graded courses yet" body="Once Canvas posts a current score in a class, the calculator can work out what you need on the final." />
      </div>
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
  const verdictColor = secured ? 'var(--pos)' : reachable ? course.color : 'var(--neg)'

  return (
    <div>
      <h1 className="disp" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 6 }}>Final calculator</h1>
      <p style={{ fontSize: 15, color: 'var(--ink-2)', marginBottom: 22, maxWidth: 460 }}>&ldquo;What do I need on the final?&rdquo; — answered, per class.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
        {graded.map((c) => {
          const on = course.id === c.id
          return (
            <button key={c.id} className="tap" onClick={() => setCid(c.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: on ? cTone(c.color).soft : 'var(--card)', color: on ? c.color : 'var(--ink-2)', border: '1px solid var(--line)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 99, background: c.color }} />
              {c.code}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18, alignItems: 'start' }}>
        <div style={{ borderRadius: 18, background: 'var(--card)', border: '1px solid var(--line)', padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{course.name}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 20 }}>Assuming the final is worth {finalWeight}% of your grade</div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>Final exam weight</span>
            <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: course.color }}>{finalWeight}%</span>
          </div>
          <input type="range" min={5} max={100} value={finalWeight} onChange={(e: ChangeEvent<HTMLInputElement>) => setFinalWeight(Number(e.target.value))} style={{ width: '100%', accentColor: course.color }} />
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 7, lineHeight: 1.5 }}>Canvas doesn’t share category weights — set what your syllabus says the final counts for.</div>

          <div style={{ display: 'flex', justifyContent: 'space-between', margin: '20px 0 10px' }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>Target final grade</span>
            <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: course.color }}>{target}%</span>
          </div>
          <input type="range" min={50} max={100} value={target} onChange={(e: ChangeEvent<HTMLInputElement>) => setTarget(Number(e.target.value))} style={{ width: '100%', accentColor: course.color }} />
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {FINAL_TARGET_CHIPS.map((t) => (
              <button key={t.label} className="tap mono" onClick={() => setTarget(t.value)} style={{ padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: target === t.value ? cTone(course.color).soft : 'var(--card-2)', color: target === t.value ? course.color : 'var(--ink-3)', border: '1px solid var(--line)' }}>{t.label} · {t.value}</button>
            ))}
          </div>

          <div style={{ marginTop: 24, padding: 24, borderRadius: 14, textAlign: 'center', background: reachable ? cTone(course.color).soft : 'color-mix(in oklch,var(--neg) 12%,transparent)' }}>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 8 }}>To finish with {target}%, you need</div>
            <div className="mono disp" style={{ fontSize: 50, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, color: reachable ? course.color : 'var(--neg)' }}>
              <CountUp value={neededShown} decimals={1} suffix="%" />
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8 }}>on the final exam</div>
            <div style={{ marginTop: 14, fontSize: 12.5, fontWeight: 700, color: verdictColor }}>
              {secured ? `✓ Locked in — even a 0% final leaves you at ${guaranteed.toFixed(1)}%` : reachable ? 'Very doable — you’ve got this' : `Out of reach — a perfect final tops out at ${maxPossible.toFixed(1)}%`}
            </div>
          </div>
        </div>

        <Card2 title="The breakdown">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FinalBar label="Everything so far" weight={100 - finalWeight} value={score} color={course.color} />
            <FinalBar label="Final exam" weight={finalWeight} value={null} color={course.color} />
          </div>
          <div style={{ borderTop: '1px solid var(--line)', margin: '16px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Locked-in minimum</span>
            <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: gradeTone(guaranteed) }}>{guaranteed.toFixed(1)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>Best possible</span>
            <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: gradeTone(maxPossible) }}>{maxPossible.toFixed(1)}%</span>
          </div>
        </Card2>
      </div>
    </div>
  )
}

function FinalBar({ label, weight, value, color }: { label: string; weight: number; value: number | null; color: string }): JSX.Element {
  const pending = value === null
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12.5 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--ink-2)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: color, opacity: pending ? 0.4 : 1 }} />
          {label}
        </span>
        <span className="mono" style={{ color: 'var(--ink-3)' }}>{round(weight)}% · {pending ? 'pending' : `${value.toFixed(1)}/100`}</span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: 'var(--card-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pending ? 100 : Math.max(0, Math.min(100, value))}%`, background: color, opacity: pending ? 0.4 : 1, borderRadius: 99 }} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  COURSE WORLD (design pylonCourse 432–456 + per-area renderers)
 * ═════════════════════════════════════════════════════════════════════════ */

const AREA_TABS: [CourseArea, string, string][] = [
  ['overview', 'Overview', 'home'],
  ['assignments', 'Assignments', 'book'],
  ['modules', 'Modules', 'layers'],
  ['grades', 'Grades', 'donut'],
  ['announcements', 'Announcements', 'bell'],
  ['files', 'Files', 'folder']
]

function CourseWorld({ course, area, onArea, onCalc, onOpenAssign }: { course: Course | undefined; area: CourseArea; onArea: (a: CourseArea) => void; onCalc: () => void; onOpenAssign: (courseId: number, assignmentId: number, siblings?: number[]) => void }): JSX.Element {
  if (!course) return <StateCard icon="alert" title="Course not found" body="This course is no longer in your active list." />
  const t = cTone(course.color)

  const header = (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: `linear-gradient(125deg, ${t.soft}, var(--card))`, border: `1px solid ${t.line}`, padding: '24px 26px', marginBottom: 18 }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: 240, height: 240, borderRadius: '50%', transform: 'translate(35%,-45%)', background: `radial-gradient(circle, ${t.soft}, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <Ring value={course.score ?? 0} size={78} stroke={8} color={course.color}>
          <div style={{ textAlign: 'center', lineHeight: 1 }}>
            <div className="mono disp" style={{ fontSize: 22, fontWeight: 700, color: gradeTone(course.score) }}>{course.letter}</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{course.score !== null ? `${course.score.toFixed(1)}%` : '—'}</div>
          </div>
        </Ring>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: course.color, letterSpacing: '.03em' }}>{course.code}</div>
          <h1 className="disp" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 2 }}>{course.name}</h1>
        </div>
      </div>
    </div>
  )

  const tabs = (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
      {AREA_TABS.map(([id, label, icon]) => {
        const on = area === id
        return (
          <button key={id} className="tap" onClick={() => onArea(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 14px', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', color: on ? 'var(--ink)' : 'var(--ink-3)', borderBottom: on ? '2px solid var(--ink)' : '2px solid transparent', marginBottom: -1, flex: '0 0 auto' }}>
            <Icon name={icon} size={15} /> {label}
          </button>
        )
      })}
    </div>
  )

  let body: ReactNode
  if (area === 'assignments') body = <CourseAssignments course={course} onOpenAssign={onOpenAssign} />
  else if (area === 'modules') body = <CourseModules course={course} onOpenAssign={onOpenAssign} />
  else if (area === 'grades') body = <CourseGrades course={course} onCalc={onCalc} />
  else if (area === 'announcements') body = <CourseAnnouncements course={course} />
  else if (area === 'files') body = <CourseFiles course={course} />
  else body = <CourseOverview course={course} onArea={onArea} onOpenAssign={onOpenAssign} />

  return (
    <div>
      {header}
      {tabs}
      <div key={area} className="rise" style={{ marginTop: 22 }}>{body}</div>
    </div>
  )
}

/* ── course › overview (design courseOverview 458–472) ───────────────────── */

function CourseOverview({ course, onOpenAssign }: { course: Course; onArea: (a: CourseArea) => void; onOpenAssign: (courseId: number, assignmentId: number, siblings?: number[]) => void }): JSX.Element {
  const t = cTone(course.color)
  const { state } = useCanvas<CanvasAssignment[]>(
    () => paginate<CanvasAssignment>(`/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission&order_by=due_at`),
    course.id
  )
  const ann = useCanvas<CanvasAnnouncement[]>(
    () => paginate<CanvasAnnouncement>(`/api/v1/announcements?context_codes[]=course_${course.id}&per_page=5`),
    course.id
  )

  const assignments = state.phase === 'ready' ? state.data : []
  const next = assignments
    .filter((a) => a.submission?.workflow_state !== 'graded' && a.submission?.workflow_state !== 'submitted')
    .sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity))[0]
  const graded = assignments.filter((a) => a.submission?.workflow_state === 'graded' && a.submission.score != null).slice(0, 3)
  const latestAnn = ann.state.phase === 'ready' ? ann.state.data.slice().sort((a, b) => (b.posted_at ? Date.parse(b.posted_at) : 0) - (a.posted_at ? Date.parse(a.posted_at) : 0))[0] : undefined

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {state.phase === 'loading' && <div className="skel" style={{ height: 110, borderRadius: 18 }} />}
        {next && (
          <button className="lift" onClick={() => onOpenAssign(course.id, next.id)} style={{ display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer', borderRadius: 18, background: `linear-gradient(120deg, ${t.wash}, var(--card))`, border: `1px solid ${t.line}`, padding: 20 }}>
            <TabPlain label="NEXT UP" color={course.color} />
            <div className="disp" style={{ fontSize: 20, fontWeight: 700, marginTop: 12 }}>{next.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, fontSize: 13, color: 'var(--ink-2)' }}>
              <span className="mono" style={{ color: course.color, fontWeight: 700 }}>{fmtDate(next.due_at)}</span>
              {next.points_possible ? <span className="mono">{next.points_possible} pts</span> : null}
            </div>
          </button>
        )}

        <div>
          <Sec>Recently graded</Sec>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.phase === 'loading' ? (
              <SkeletonRows count={3} />
            ) : graded.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 16px', borderRadius: 13, background: 'var(--card)', border: '1px solid var(--line)' }}>Nothing graded yet.</div>
            ) : (
              graded.map((g) => {
                const pts = g.points_possible ?? 0
                const sc = g.submission?.score ?? 0
                return (
                  <button key={g.id} className="lift" onClick={() => onOpenAssign(course.id, g.id)} style={{ display: 'flex', alignItems: 'center', gap: 13, width: '100%', textAlign: 'left', padding: '13px 15px', borderRadius: 13, background: 'var(--card)', border: '1px solid var(--line)' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'var(--card-2)', color: 'var(--ink-2)', flex: '0 0 auto' }}>
                      <Icon name={assignmentIcon(g)} size={16} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                    </div>
                    <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: gradeTone(pts > 0 ? (sc / pts) * 100 : null) }}>{sc}/{pts}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card2 title="Latest announcement">
          {ann.state.phase === 'loading' ? (
            <div className="skel" style={{ height: 60, borderRadius: 10 }} />
          ) : latestAnn ? (
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{latestAnn.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', margin: '3px 0 8px' }}>{latestAnn.author?.display_name ?? 'Instructor'} · {fmtDate(latestAnn.posted_at)}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{stripHtml(latestAnn.message).slice(0, 180)}{stripHtml(latestAnn.message).length > 180 ? '…' : ''}</div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Nothing new.</div>
          )}
        </Card2>
        <Card2 title="Your standing">
          {state.phase === 'loading' ? (
            <div className="skel" style={{ height: 96, borderRadius: 10 }} />
          ) : (
            (() => {
              const gradedAll = assignments.filter((a) => a.submission?.workflow_state === 'graded' && a.submission.score != null)
              const earned = gradedAll.reduce((n, a) => n + (a.submission?.score ?? 0), 0)
              const poss = gradedAll.reduce((n, a) => n + (a.points_possible ?? 0), 0)
              const pct = course.score ?? (poss > 0 ? (earned / poss) * 100 : null)
              const todoN = assignments.filter((a) => statusOf(a) === 'todo').length
              const missN = assignments.filter((a) => statusOf(a) === 'missing').length
              const rows: [string, string, number, string][] = [
                ['check', 'var(--pos)', gradedAll.length, 'Graded'],
                ['clock', 'var(--ink-2)', todoN, 'To do'],
                ['alert', missN > 0 ? 'var(--neg)' : 'var(--ink-3)', missN, 'Missing']
              ]
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <Ring value={pct ?? 0} size={64} stroke={7} color={gradeTone(pct)}>
                      <div className="mono disp" style={{ fontSize: 15, fontWeight: 800 }}>{pct != null ? <CountUp value={Math.round(pct)} suffix="%" /> : '—'}</div>
                    </Ring>
                    <div>
                      <div className="disp" style={{ fontSize: 19, fontWeight: 800 }}>{course.letter || '—'}</div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{Math.round(earned)}/{Math.round(poss)} pts</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                    {rows.map(([icon, color, n, label]) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                        <span style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', background: 'var(--card-2)', color, flex: '0 0 auto' }}>
                          <Icon name={icon} size={14} />
                        </span>
                        <span className="mono" style={{ fontWeight: 700, minWidth: 20 }}>{n}</span>
                        <span style={{ color: 'var(--ink-3)' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()
          )}
        </Card2>
      </div>
    </div>
  )
}

/** Quick text-only strip of HTML, for announcement previews. */
function stripHtml(html: string | null | undefined): string {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

/* ── course › assignments (design courseAssignments 473–486) ─────────────── */

/* ── assignment classification (type + status) ──────────────────────────── */

type ACat = 'Exam' | 'Quiz' | 'Homework' | 'Lab' | 'Essay' | 'Project' | 'Discussion' | 'Other'
function deriveCat(a: CanvasAssignment): ACat {
  const n = a.name.toLowerCase()
  const types = a.submission_types ?? []
  if (types.includes('online_quiz') || /\bquiz(zes)?\b/.test(n)) return 'Quiz'
  if (/\b(exam|midterm|final|test)\b/.test(n)) return 'Exam'
  if (/\blab\b/.test(n)) return 'Lab'
  if (/\b(problem set|pset|homework|hw|assignment)\b/.test(n)) return 'Homework'
  if (/\b(essay|paper|writing|draft)\b/.test(n)) return 'Essay'
  if (/\b(project|portfolio)\b/.test(n)) return 'Project'
  if (types.includes('discussion_topic') || /\b(discussion|forum|post)\b/.test(n)) return 'Discussion'
  return 'Other'
}

type AStatus = 'graded' | 'missing' | 'todo'
function statusOf(a: CanvasAssignment): AStatus {
  const ws = a.submission?.workflow_state
  if (ws === 'graded') return 'graded'
  const submitted = ws === 'submitted' || ws === 'pending_review'
  const past = a.due_at ? Date.parse(a.due_at) < Date.now() : false
  if ((a.submission as { missing?: boolean } | undefined)?.missing || (past && !submitted)) return 'missing'
  return 'todo'
}

function dueTag(due: string | null | undefined): { label: string; soon: boolean } | null {
  if (!due) return null
  const d = (Date.parse(due) - Date.now()) / 86400000
  if (d < 0) return { label: 'overdue', soon: true }
  if (d < 1) return { label: `${Math.max(1, Math.round(d * 24))}h`, soon: true }
  if (d <= 3) return { label: `${Math.round(d)}d`, soon: true }
  return { label: `${Math.round(d)}d`, soon: false }
}

function CourseAssignments({ course, onOpenAssign }: { course: Course; onOpenAssign: (courseId: number, assignmentId: number, siblings?: number[]) => void }): JSX.Element {
  const { state, reload } = useCanvas<CanvasAssignment[]>(
    () => paginate<CanvasAssignment>(`/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission&order_by=due_at`),
    course.id
  )
  const t = tone(250, 0.15)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'todo' | 'missing' | 'graded'>('all')
  const [groupBy, setGroupBy] = useState<'type' | 'due'>('due')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const all = useMemo(
    () =>
      state.phase === 'ready'
        ? state.data.slice().sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity))
        : [],
    [state]
  )
  // Canvas order (assignment position) drives inline prev/next navigation.
  const pos = (a: CanvasAssignment): number => (a as { position?: number }).position ?? 1e9
  const order = useMemo(() => all.slice().sort((a, b) => pos(a) - pos(b)).map((a) => a.id), [all])
  const counts = useMemo(() => {
    const c = { all: all.length, todo: 0, missing: 0, graded: 0 }
    for (const a of all) {
      const s = statusOf(a)
      if (s === 'graded') c.graded++
      else if (s === 'missing') c.missing++
      else c.todo++
    }
    return c
  }, [all])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((a) => {
      if (filter !== 'all' && statusOf(a) !== filter) return false
      if (q && !(a.name.toLowerCase().includes(q) || deriveCat(a).toLowerCase().includes(q))) return false
      return true
    })
  }, [all, filter, query])

  // group → ordered sections of { key, label, items }
  const sections = useMemo(() => {
    if (groupBy === 'type') {
      const order: ACat[] = ['Exam', 'Quiz', 'Homework', 'Lab', 'Essay', 'Project', 'Discussion', 'Other']
      const by = new Map<ACat, CanvasAssignment[]>()
      for (const a of visible) {
        const k = deriveCat(a)
        const arr = by.get(k) ?? []
        arr.push(a)
        by.set(k, arr)
      }
      return order.filter((k) => by.has(k)).map((k) => ({ key: k, label: k, items: by.get(k)! }))
    }
    const buckets: { key: string; label: string; items: CanvasAssignment[] }[] = [
      { key: 'missing', label: 'Missing & overdue', items: [] },
      { key: 'soon', label: 'Due in 48 hours', items: [] },
      { key: 'week', label: 'This week', items: [] },
      { key: 'two', label: 'Next two weeks', items: [] },
      { key: 'later', label: 'Later', items: [] },
      { key: 'nodue', label: 'No due date', items: [] },
      { key: 'graded', label: 'Graded', items: [] }
    ]
    const bi = (k: string): number => buckets.findIndex((b) => b.key === k)
    for (const a of visible) {
      const s = statusOf(a)
      if (s === 'graded') {
        buckets[bi('graded')].items.push(a)
        continue
      }
      if (s === 'missing') {
        buckets[bi('missing')].items.push(a)
        continue
      }
      if (!a.due_at) {
        buckets[bi('nodue')].items.push(a)
        continue
      }
      const d = (Date.parse(a.due_at) - Date.now()) / 86400000
      if (d < 2) buckets[bi('soon')].items.push(a)
      else if (d <= 7) buckets[bi('week')].items.push(a)
      else if (d <= 14) buckets[bi('two')].items.push(a)
      else buckets[bi('later')].items.push(a)
    }
    return buckets.filter((b) => b.items.length > 0)
  }, [visible, groupBy])

  if (state.phase === 'loading') return <SkeletonRows count={6} />
  if (state.phase === 'error') return <StateCard icon="alert" title="Canvas didn’t answer" body={state.message} action={<PrimaryButton icon="refresh" label="Try again" color={course.color} onClick={reload} />} />
  if (all.length === 0) return <StateCard icon="check" title="No assignments" body="Canvas didn’t return any assignments for this course yet." />

  const chips: { id: typeof filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: counts.all },
    { id: 'todo', label: 'To do', n: counts.todo },
    { id: 'missing', label: 'Missing', n: counts.missing },
    { id: 'graded', label: 'Graded', n: counts.graded }
  ]

  const Row = (a: CanvasAssignment): JSX.Element => {
    const s = statusOf(a)
    const pts = a.points_possible ?? 0
    const sc = a.submission?.score
    const dc = dueTag(a.due_at)
    return (
      <button
        key={a.id}
        className="tap jc-arow"
        onClick={() => onOpenAssign(course.id, a.id, order)}
        style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left', padding: '9px 13px', background: 'transparent', borderBottom: '1px solid var(--line)' }}
      >
        {s === 'graded' ? (
          <span style={{ width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'color-mix(in oklch,var(--pos) 20%,transparent)', color: 'var(--pos)', flex: '0 0 auto' }}>
            <Icon name="check" size={13} />
          </span>
        ) : s === 'missing' ? (
          <span style={{ width: 9, height: 9, borderRadius: 99, background: 'var(--neg)', flex: '0 0 auto', margin: '0 6px' }} />
        ) : (
          <span style={{ color: 'var(--ink-3)', flex: '0 0 auto', display: 'grid', placeItems: 'center', width: 21 }}>
            <Icon name={assignmentIcon(a)} size={15} />
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', flex: '0 0 auto', display: 'none' }} className="jc-arow-cat">{deriveCat(a)}</span>
        {a.points_possible ? <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', flex: '0 0 auto' }}>{a.points_possible}p</span> : null}
        {s === 'graded' && sc != null ? (
          <span className="mono" style={{ fontSize: 13.5, fontWeight: 700, color: gradeTone(pts > 0 ? (sc / pts) * 100 : null), flex: '0 0 auto', minWidth: 52, textAlign: 'right' }}>{sc}/{pts}</span>
        ) : s === 'missing' ? (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: 'var(--neg)', background: 'color-mix(in oklch,var(--neg) 15%,transparent)', flex: '0 0 auto' }}>Missing</span>
        ) : dc ? (
          <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, flex: '0 0 auto', color: dc.soon ? 'var(--warn)' : t.bright, background: dc.soon ? 'color-mix(in oklch,var(--warn) 14%,transparent)' : t.soft }}>{dc.label}</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--ink-3)', flex: '0 0 auto' }}>—</span>
        )}
      </button>
    )
  }

  return (
    <div>
      {/* search + group toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200, display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', borderRadius: 12, background: 'var(--card)', border: '1px solid var(--line)' }}>
          <Icon name="search" size={15} stroke={2} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search assignments by name or type…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--ink)', fontSize: 13.5 }}
          />
          {query && (
            <button className="tap" onClick={() => setQuery('')} style={{ color: 'var(--ink-3)', display: 'grid', placeItems: 'center' }}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div style={{ display: 'inline-flex', borderRadius: 999, background: 'var(--card)', border: '1px solid var(--line)', padding: 3 }}>
          {(['due', 'type'] as const).map((g) => (
            <button
              key={g}
              className="tap"
              onClick={() => setGroupBy(g)}
              style={{ padding: '6px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, color: groupBy === g ? t.ink : 'var(--ink-2)', background: groupBy === g ? `linear-gradient(140deg,${t.bright},${t.deep})` : 'transparent' }}
            >
              By {g === 'due' ? 'due' : 'type'}
            </button>
          ))}
        </div>
      </div>

      {/* filter chips with live counts */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {chips.map((c) => {
          const on = filter === c.id
          return (
            <button
              key={c.id}
              className="tap"
              onClick={() => setFilter(c.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, color: on ? t.ink : 'var(--ink-2)', background: on ? `linear-gradient(140deg,${t.bright},${t.deep})` : 'var(--card)', border: on ? '1px solid transparent' : '1px solid var(--line)' }}
            >
              {c.label}
              <span className="mono" style={{ fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: on ? 'rgba(255,255,255,.22)' : 'var(--card-2)', color: on ? t.ink : c.id === 'missing' && c.n > 0 ? 'var(--neg)' : 'var(--ink-3)' }}>{c.n}</span>
            </button>
          )
        })}
      </div>

      {/* collapsible sections of compact rows */}
      {visible.length === 0 ? (
        <StateCard icon="search" title="Nothing matches" body="No assignments match your search and filter — try clearing them." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sections.map((sec) => {
            const isCollapsed = collapsed.has(sec.key)
            const totalPts = sec.items.reduce((n, a) => n + (a.points_possible ?? 0), 0)
            return (
              <div key={sec.key} style={{ borderRadius: 16, background: 'var(--card)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                <button
                  className="tap"
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev)
                      if (next.has(sec.key)) next.delete(sec.key)
                      else next.add(sec.key)
                      return next
                    })
                  }
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '12px 14px', background: 'var(--card-2)' }}
                >
                  <span style={{ color: 'var(--ink-3)', transition: 'transform .2s var(--ease)', transform: isCollapsed ? 'rotate(-90deg)' : 'none', display: 'grid', placeItems: 'center' }}>
                    <Icon name="chevD" size={16} />
                  </span>
                  <span className="disp" style={{ fontSize: 14, fontWeight: 700 }}>{sec.label}</span>
                  <span className="mono" style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: 'var(--card-3)', color: 'var(--ink-3)' }}>{sec.items.length}</span>
                  <div style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{totalPts} pts</span>
                </button>
                {!isCollapsed && <div>{sec.items.map(Row)}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── course › modules (design courseModules 487–496) ─────────────────────── */

function moduleItemIcon(t: string): string {
  return ({ Assignment: 'book', Quiz: 'target', Page: 'layers', File: 'download', Discussion: 'people', ExternalUrl: 'external', ExternalTool: 'external', SubHeader: 'hash' } as Record<string, string>)[t] ?? 'info'
}

/** The slug Canvas wants for GET /pages/:url — module Page items carry it as
 *  `page_url`; some also expose it as the tail of `html_url` (…/pages/:slug). */
function pageSlugFor(item: CanvasModuleItem): string | null {
  if (item.page_url) return item.page_url
  const m = (item.html_url ?? '').match(/\/pages\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function CourseModules({ course, onOpenAssign }: { course: Course; onOpenAssign: (courseId: number, assignmentId: number, siblings?: number[]) => void }): JSX.Element {
  const { state, reload } = useCanvas<CanvasModule[]>(
    () => paginate<CanvasModule>(`/api/v1/courses/${course.id}/modules?include[]=items&per_page=100`),
    course.id
  )
  // An open wiki Page renders inline (over the module tree) via the Canvas HTML
  // reader; { slug, title } are captured from the clicked item.
  const [openPage, setOpenPage] = useState<{ slug: string; title: string } | null>(null)

  if (openPage) {
    return <PageView course={course} slug={openPage.slug} title={openPage.title} onBack={() => setOpenPage(null)} />
  }
  if (state.phase === 'loading') return <SkeletonRows count={5} />
  if (state.phase === 'error') return <StateCard icon="alert" title="Canvas didn’t answer" body={state.message} action={<PrimaryButton icon="refresh" label="Try again" color={course.color} onClick={reload} />} />
  const mods = state.data.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  if (mods.length === 0) return <StateCard icon="layers" title="No modules" body="This course isn’t organised into modules, or Canvas didn’t return any." />

  // Assignment + Quiz items open the in-app reader via content_id; Page items
  // open the inline page viewer below; File items open/download via their url;
  // everything else (ExternalUrl/ExternalTool/…) opens in Canvas.
  const isAssignmentItem = (item: CanvasModuleItem): boolean =>
    (item.type === 'Assignment' || item.type === 'Quiz') && Number.isFinite(item.content_id)
  const isPageItem = (item: CanvasModuleItem): boolean => item.type === 'Page' && pageSlugFor(item) !== null
  const isClickable = (item: CanvasModuleItem): boolean =>
    isAssignmentItem(item) || isPageItem(item) || !!(item.url || item.html_url || item.external_url)
  const open = (item: CanvasModuleItem): void => {
    if (isAssignmentItem(item) && item.content_id !== undefined) {
      onOpenAssign(course.id, item.content_id)
      return
    }
    if (item.type === 'Page') {
      const slug = pageSlugFor(item)
      if (slug) {
        setOpenPage({ slug, title: item.title })
        return
      }
    }
    // Files (and anything else): hand the URL to the OS / Canvas.
    const url = item.html_url || item.external_url || item.url
    if (url) window.open(url, '_blank')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {mods.map((m, mi) => (
        <div key={m.id} style={{ borderRadius: 16, background: 'var(--card)', border: '1px solid var(--line)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <span className="mono" style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', background: cTone(course.color).soft, color: course.color, flex: '0 0 auto', fontSize: 12, fontWeight: 700 }}>{mi + 1}</span>
            <div className="disp" style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
          </div>
          {(m.items ?? []).map((it, ii) => {
            if (it.type === 'SubHeader') {
              return <div key={it.id} style={{ padding: '12px 16px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', borderTop: ii ? '1px solid var(--line)' : 'none' }}>{it.title}</div>
            }
            const done = it.completion_requirement?.completed === true
            const clickable = isClickable(it)
            return (
              <button key={it.id} className={clickable ? 'tap' : undefined} onClick={clickable ? () => open(it) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '11px 16px', borderTop: ii ? '1px solid var(--line)' : 'none', cursor: clickable ? 'pointer' : 'default' }}>
                {done ? (
                  <span style={{ width: 22, height: 22, borderRadius: 99, display: 'grid', placeItems: 'center', background: 'color-mix(in oklch,var(--pos) 20%,transparent)', color: 'var(--pos)', flex: '0 0 auto' }}><Icon name="check" size={13} /></span>
                ) : (
                  <span style={{ width: 22, height: 22, borderRadius: 99, border: '2px solid var(--line-2)', flex: '0 0 auto' }} />
                )}
                <span style={{ color: 'var(--ink-3)', flex: '0 0 auto' }}><Icon name={moduleItemIcon(it.type)} size={16} /></span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: done ? 500 : 600, color: done ? 'var(--ink-2)' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</span>
                {clickable && <span style={{ color: 'var(--ink-3)' }}><Icon name="chevR" size={16} /></span>}
              </button>
            )
          })}
          {(m.items ?? []).length === 0 && <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>No items in this module.</div>}
        </div>
      ))}
    </div>
  )
}

/** A wiki Page rendered inline (matches Coursework's PageReader endpoint +
 *  states): GET /courses/:id/pages/:slug → render `body` via CanvasHtml. Pages
 *  that 403/404 (tab hidden / unpublished) degrade to a friendly card rather
 *  than throwing. The status is preserved by reading CanvasError off the throw. */
function PageView({ course, slug, title, onBack }: { course: Course; slug: string; title: string; onBack: () => void }): JSX.Element {
  const t = cTone(course.color)
  const { state, reload } = useCanvas<{ page: CanvasPage | null; blockedStatus: number | null }>(
    async () => {
      try {
        const page = await get<CanvasPage>(`/api/v1/courses/${course.id}/pages/${encodeURIComponent(slug)}`)
        return { page, blockedStatus: null }
      } catch (e) {
        // 403 (restricted) / 404 (unpublished or missing) → friendly card, not a crash.
        if (e instanceof CanvasError && (e.status === 403 || e.status === 404)) {
          return { page: null, blockedStatus: e.status }
        }
        throw e
      }
    },
    `${course.id}:${slug}`
  )

  const back = (
    <button className="tap" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--ink-3)', marginBottom: 14 }}>
      <Icon name="chevL" size={15} /> Modules
    </button>
  )

  if (state.phase === 'loading') {
    return (
      <div>
        {back}
        <SkeletonRows count={4} />
      </div>
    )
  }
  if (state.phase === 'error') {
    return (
      <div>
        {back}
        <StateCard icon="alert" title="Canvas didn’t answer" body={state.message} action={<PrimaryButton icon="refresh" label="Try again" color={course.color} onClick={reload} />} />
      </div>
    )
  }
  if (state.data.blockedStatus !== null || !state.data.page) {
    return (
      <div>
        {back}
        <StateCard
          icon="lock"
          title="Page not available"
          body="This page isn’t published, or your instructor restricted it — so it can’t be shown here. Try opening the course in Canvas."
        />
      </div>
    )
  }

  const page = state.data.page
  return (
    <div>
      {back}
      <div style={{ borderRadius: 16, background: `linear-gradient(135deg, ${t.wash}, var(--card))`, border: `1px solid ${t.line}`, padding: '18px 20px', marginBottom: 14 }}>
        <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, color: course.color, marginBottom: 4 }}>PAGE</div>
        <div className="disp" style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>{page.title || title}</div>
        {page.updated_at && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>Updated {fmtDate(page.updated_at)}</div>}
      </div>
      <div style={{ borderRadius: 16, background: 'var(--card)', border: '1px solid var(--line)', padding: 20 }}>
        <CanvasHtml html={page.body} />
      </div>
    </div>
  )
}

/* ── course › grades (design courseGrades 497–505) ───────────────────────── */

function CourseGrades({ course, onCalc }: { course: Course; onCalc: () => void }): JSX.Element {
  const t = cTone(course.color)
  const { state, reload } = useCanvas<CanvasAssignmentGroup[]>(
    () => paginate<CanvasAssignmentGroup>(`/api/v1/courses/${course.id}/assignment_groups?per_page=100&include[]=assignments&include[]=submission`),
    course.id
  )

  const groups = state.phase === 'ready' ? state.data : []
  const model = useMemo(() => buildModel(groups, []), [groups])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 18, alignItems: 'start' }}>
      <Card2 title="Category breakdown">
        {state.phase === 'loading' ? (
          <SkeletonRows count={4} />
        ) : state.phase === 'error' ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{state.message} <button className="tap" onClick={reload} style={{ color: course.color, fontWeight: 700 }}>Retry</button></div>
        ) : model.groups.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.6 }}>Canvas didn’t return weighted categories for this class.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {model.groups.map((g) => {
              const gScore = currentGrade(g.items)
              const pending = gScore === null
              return (
                <div key={g.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12.5 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 600, color: 'var(--ink-2)' }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: course.color, opacity: pending ? 0.35 : 1 }} />
                      {g.name}
                    </span>
                    <span className="mono" style={{ color: 'var(--ink-3)' }}>{round(g.weightPct)}% · {pending ? 'pending' : `${round(gScore)}/100`}</span>
                  </div>
                  <div style={{ height: 9, borderRadius: 99, background: 'var(--card-3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pending ? 100 : Math.max(0, Math.min(100, gScore))}%`, background: course.color, opacity: pending ? 0.3 : 1, borderRadius: 99 }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ borderRadius: 16, background: `linear-gradient(135deg, ${t.wash}, var(--card))`, border: `1px solid ${t.line}`, padding: 20, textAlign: 'center' }}>
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <Ring value={course.score ?? 0} size={90} stroke={9} color={course.color}>
              <div style={{ textAlign: 'center' }}>
                <div className="mono disp" style={{ fontSize: 24, fontWeight: 700, color: gradeTone(course.score) }}>{course.letter}</div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{course.score !== null ? `${course.score.toFixed(1)}%` : '—'}</div>
              </div>
            </Ring>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', marginTop: 12, lineHeight: 1.5 }}>Your current standing, computed live from Canvas weights.</div>
        </div>
        <PrimaryButton icon="target" label="Open final calculator" color={course.color} full onClick={onCalc} />
      </div>
    </div>
  )
}

/* ── course › announcements (design courseAnnounce 506–511) ──────────────── */

function CourseAnnouncements({ course }: { course: Course }): JSX.Element {
  const t = cTone(course.color)
  const { state, reload } = useCanvas<CanvasAnnouncement[]>(
    () => paginate<CanvasAnnouncement>(`/api/v1/announcements?context_codes[]=course_${course.id}&per_page=20`),
    course.id
  )
  if (state.phase === 'loading') return <SkeletonRows count={4} />
  if (state.phase === 'error') return <StateCard icon="alert" title="Canvas didn’t answer" body={state.message} action={<PrimaryButton icon="refresh" label="Try again" color={course.color} onClick={reload} />} />
  const list = state.data.slice().sort((a, b) => (b.posted_at ? Date.parse(b.posted_at) : 0) - (a.posted_at ? Date.parse(a.posted_at) : 0))
  if (list.length === 0) return <StateCard icon="bell" title="No announcements" body="Nothing has been posted to this course yet — a quiet, calm inbox." />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {list.map((x) => (
        <div key={x.id} style={{ borderRadius: 16, background: 'var(--card)', border: '1px solid var(--line)', padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: t.soft, color: course.color, flex: '0 0 auto' }}><Icon name="bell" size={16} /></span>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 700 }}>{x.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{x.author?.display_name ?? 'Instructor'} · {fmtDate(x.posted_at)}</div>
            </div>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{stripHtml(x.message)}</div>
          {x.html_url && (
            <button className="tap" onClick={() => x.html_url && window.open(x.html_url, '_blank')} style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: course.color }}>
              Open in Canvas <Icon name="external" size={13} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/* ── course › files (design courseFiles 512–517) ─────────────────────────── */

function CourseFiles({ course }: { course: Course }): JSX.Element {
  const t = cTone(course.color)
  const { state, reload } = useCanvas<CanvasFile[]>(
    () => paginate<CanvasFile>(`/api/v1/courses/${course.id}/files?per_page=100&sort=name`),
    course.id
  )
  if (state.phase === 'loading') return <SkeletonRows count={6} />
  if (state.phase === 'error') return <StateCard icon="lock" title="Files aren’t available" body="This course doesn’t expose its Files tab to you (or Canvas restricted it)." action={<PrimaryButton icon="refresh" label="Try again" color={course.color} onClick={reload} />} />
  if (state.data.length === 0) return <StateCard icon="folder" title="No files" body="This course doesn’t expose any files to you, or Canvas didn’t return them." />

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}>
      {state.data.map((f) => (
        <button key={f.id} className="lift" onClick={() => window.open(f.url, '_blank')} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '13px 15px', borderRadius: 13, background: 'var(--card)', border: '1px solid var(--line)' }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, display: 'grid', placeItems: 'center', background: t.soft, color: course.color, flex: '0 0 auto' }}><Icon name="note" size={17} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.display_name || f.filename || 'File'}</div>
            <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtBytes(f.size)}</div>
          </div>
          <span style={{ color: 'var(--ink-3)' }}><Icon name="external" size={16} /></span>
        </button>
      ))}
    </div>
  )
}
