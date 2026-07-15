/**
 * Pylon — Grades: the what-if grade simulator + GPA calculator.
 *
 * The visual IS the tool. Pick a class and you see your real current grade, a
 * settable goal, and every upcoming graded item with its weight of the grade.
 * Drag (or type) an expected score on any item and the PROJECTED final grade
 * moves live — the big number at the top is the most important signal, always in
 * view. Below it, in plain language: what you need on the rest to hit the goal,
 * and which items can't move your letter (safe to skip).
 *
 * PowerSchool has no API, so manual items are entered by hand and factor into the
 * projection exactly like Canvas items. A GPA calculator across all classes lets
 * you pick your school's scale (weighted/unweighted · 4.0/5.0 · honors/AP per
 * class) so the number is actually right for YOUR school. Everything you set
 * persists to the encrypted vault.
 */
import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type JSX } from 'react'
import { Badge, Button, Card, Divider, EmptyState, Field, Input, ProgressRing, SectionTitle, Segmented } from '../../ui'
import { AnimatedList, CountUp, Reveal } from '../../motion'
import { Icon } from '../../icons'
import { gradeColor, letterFor, type CourseView } from './Dashboard'
import { paginate } from './canvas'
import { useAsync } from './shared'
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
} from './gradeMath'

/* ── tiny id (manual items) ──────────────────────────────────────────── */

const newId = (): string => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/* ── goal chips ──────────────────────────────────────────────────────── */

const GOAL_CHIPS: { label: string; value: number }[] = [
  { label: 'A', value: 93 },
  { label: 'A−', value: 90 },
  { label: 'B+', value: 87 },
  { label: 'B', value: 83 },
  { label: 'C', value: 73 }
]

/* ── screen ──────────────────────────────────────────────────────────── */

type Sub = 'whatif' | 'gpa'

export function GradesScreen({ courses }: { courses: CourseView[] }): JSX.Element {
  const [sub, setSub] = useState<Sub>('whatif')

  // Shared persisted state (loaded once, passed to both sub-views).
  const [manual, setManual] = useState<ManualStore>({})
  const [gpa, setGpa] = useState<GpaSettings>(DEFAULT_GPA)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([loadManual(), loadGpa()]).then(([m, g]) => {
      if (!alive) return
      setManual(m)
      setGpa(g)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const updateManual = useCallback((next: ManualStore): void => {
    setManual(next)
    void saveManual(next)
  }, [])

  const updateGpa = useCallback((next: GpaSettings): void => {
    setGpa(next)
    void saveGpa(next)
  }, [])

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <Reveal>
          <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.025em' }}>Grade lab</h1>
          <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>
            Drag a score, watch your grade move — then see exactly what you need.
          </p>
        </Reveal>
        <Segmented
          options={[
            { value: 'whatif', label: 'What-if' },
            { value: 'gpa', label: 'GPA' }
          ]}
          value={sub}
          onChange={(v) => setSub(v as Sub)}
        />
      </div>

      {sub === 'whatif' ? (
        <WhatIf courses={courses} manual={manual} onManual={updateManual} loaded={loaded} />
      ) : (
        <GpaCalculator courses={courses} gpa={gpa} onGpa={updateGpa} loaded={loaded} />
      )}
    </>
  )
}

/* ── what-if engine ──────────────────────────────────────────────────── */

function WhatIf({
  courses,
  manual,
  onManual,
  loaded
}: {
  courses: CourseView[]
  manual: ManualStore
  onManual: (next: ManualStore) => void
  loaded: boolean
}): JSX.Element {
  const [cid, setCid] = useState<number | null>(courses.length > 0 ? courses[0].id : null)
  const course = courses.find((c) => c.id === cid) ?? courses[0] ?? null

  if (!course) {
    return (
      <EmptyState
        icon="cap"
        title="No courses to simulate"
        body="Once Canvas returns your active classes, the simulator can play out any grade scenario."
      />
    )
  }

  return (
    <>
      {/* class switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {courses.map((c) => {
          const on = course.id === c.id
          return (
            <button
              key={c.id}
              className="tap"
              onClick={() => setCid(c.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 'var(--r-pill)', fontSize: 13, fontWeight: 600, background: on ? 'var(--accent-soft)' : 'var(--surface-2)', color: on ? 'var(--accent-h)' : 'var(--text-2)', border: '1px solid var(--border)' }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 99, background: c.color }} />
              {c.code}
            </button>
          )
        })}
      </div>

      {/* remount per course so the engine reloads cleanly */}
      <CourseWhatIf
        key={course.id}
        course={course}
        manual={loaded ? manual[String(course.id)] ?? [] : []}
        onManual={(items) => onManual({ ...manual, [String(course.id)]: items })}
      />
    </>
  )
}

function CourseWhatIf({
  course,
  manual,
  onManual
}: {
  course: CourseView
  manual: ManualItem[]
  onManual: (items: ManualItem[]) => void
}): JSX.Element {
  // Canvas groups, with weights + assignments + the student's own submissions.
  const { state, reload } = useAsync<CanvasAssignmentGroup[]>(
    () =>
      paginate<CanvasAssignmentGroup>(
        `/api/v1/courses/${course.id}/assignment_groups?per_page=100&include[]=assignments&include[]=submission`
      ),
    course.id
  )

  // Expected-score overrides for upcoming items, keyed by item key. -1 sentinel
  // means "untouched" → use a sensible default (goal or current).
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [goal, setGoal] = useState(90)

  const groups = state.phase === 'ready' ? state.data : []
  const model = useMemo(() => buildModel(groups, manual), [groups, manual])
  const items = useMemo(() => allItems(model.groups), [model])

  const real = useMemo(() => currentGrade(items), [items])

  // Default expected score for an ungraded item: the current grade (a neutral
  // "if things keep going as they are"), else the goal.
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
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="skel" style={{ height: 120, borderRadius: 'var(--r-md)' }} />
          <div className="skel" style={{ height: 64, borderRadius: 'var(--r-md)' }} />
          <div className="skel" style={{ height: 64, borderRadius: 'var(--r-md)' }} />
        </div>
      </Card>
    )
  }
  if (state.phase === 'error') {
    return (
      <Card>
        <EmptyState
          icon="alert"
          title="Couldn’t load this class"
          body={state.message}
          action={<Button variant="soft" icon="refresh" onClick={reload}>Try again</Button>}
        />
      </Card>
    )
  }

  const projShown = projected ?? real
  const projColor = gradeColor(projShown)
  const delta = projected !== null && real !== null ? projected - real : null

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* live projection header — the most important signal, always on top */}
        <Reveal>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
              <ProgressRing value={projShown ?? 0} size={92} stroke={8} color={projColor}>
                <span className="mono" style={{ fontSize: 22, fontWeight: 800 }}>
                  {projShown !== null ? letterFor(projShown) : '—'}
                </span>
              </ProgressRing>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)', fontWeight: 600 }}>Projected grade</div>
                <div className="mono" style={{ fontSize: 42, fontWeight: 800, letterSpacing: '-0.03em', color: projColor, lineHeight: 1.05 }}>
                  {projShown !== null ? <CountUp value={projShown} decimals={1} suffix="%" /> : '—'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                    Now: <strong className="mono" style={{ color: 'var(--text-2)' }}>{real !== null ? `${round(real)}%` : '—'}</strong>
                  </span>
                  {delta !== null && Math.abs(delta) >= 0.05 && (
                    <Badge tone={delta >= 0 ? 'pos' : 'neg'} icon={delta >= 0 ? 'arrowUp' : 'arrowDn'} size="sm">
                      {delta >= 0 ? '+' : '−'}{round(Math.abs(delta))}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            {!model.weighted && groups.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 14, lineHeight: 1.5 }}>
                This class isn’t using category weights in Canvas — weights below are estimated from each item’s points.
              </div>
            )}
          </Card>
        </Reveal>

        {/* upcoming items — drag/type expected scores; grade moves live */}
        <Reveal delay={60}>
          <Card>
            <SectionTitle icon="sliders" title="Upcoming work" sub="Set an expected score on each — your projected grade updates as you go." />
            {upcoming.length === 0 ? (
              <EmptyState
                icon="check"
                title="Nothing left to grade"
                body="Every graded item in this class is already in. Your projected grade is locked to your real one — add a manual item to play out a what-if."
              />
            ) : (
              <AnimatedList stagger={40} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {upcoming.map((it) => (
                  <ItemSlider
                    key={it.key}
                    item={it}
                    value={scoreOf(it) ?? defaultExpected}
                    onChange={(v) => setOverrides((o) => ({ ...o, [it.key]: v }))}
                    cannotMove={cannotChangeLetter(items, it, scoreOf, letterFor)}
                  />
                ))}
              </AnimatedList>
            )}
          </Card>
        </Reveal>

        {/* manual (PowerSchool) items */}
        <Reveal delay={90}>
          <ManualItems items={manual} onChange={onManual} />
        </Reveal>
      </div>

      {/* right rail: the goal + the verdict */}
      <Reveal delay={120}>
        <Card>
          <SectionTitle icon="target" title="Your goal" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>Target grade</span>
            <span className="mono" style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-h)' }}>
              {goal}% · {letterFor(goal)}
            </span>
          </div>
          <input
            type="range"
            min={50}
            max={100}
            value={goal}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setGoal(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {GOAL_CHIPS.map((g) => (
              <button
                key={g.label}
                className="tap mono"
                onClick={() => setGoal(g.value)}
                style={{ padding: '5px 11px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600, background: goal === g.value ? 'var(--accent-soft)' : 'var(--surface-2)', color: goal === g.value ? 'var(--accent-h)' : 'var(--text-3)', border: '1px solid var(--border)' }}
              >
                {g.label}
              </button>
            ))}
          </div>

          <Divider style={{ margin: '18px 0' }} />

          <GoalVerdict goal={goal} solve={solve} upcoming={upcoming} />
        </Card>
      </Reveal>
    </div>
  )
}

/* ── one upcoming item: slider + number, with a "can't move" flag ─────── */

function ItemSlider({
  item,
  value,
  onChange,
  cannotMove
}: {
  item: GradeItem
  value: number
  onChange: (v: number) => void
  cannotMove: boolean
}): JSX.Element {
  const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)))
  return (
    <div style={{ padding: '14px 16px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 12, color: 'var(--text-3)', flexWrap: 'wrap' }}>
            <span className="mono">{round(item.weightPct)}% of grade</span>
            {item.pointsPossible ? <span className="mono">· {item.pointsPossible} pts</span> : null}
            {cannotMove && (
              <Badge tone="neutral" icon="check" size="sm">
                Can’t change your letter
              </Badge>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
          <input
            type="number"
            min={0}
            max={100}
            value={value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(clamp(Number(e.target.value)))}
            className="mono"
            style={{ width: 58, height: 34, padding: '0 8px', borderRadius: 'var(--r-sm)', background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, fontWeight: 700, textAlign: 'center', outline: 'none' }}
          />
          <span className="mono" style={{ fontSize: 13, color: 'var(--text-3)' }}>%</span>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: cannotMove ? 'var(--text-3)' : 'var(--accent)' }}
      />
    </div>
  )
}

/* ── the verdict: what you need / what's safe ─────────────────────────── */

function GoalVerdict({
  goal,
  solve,
  upcoming
}: {
  goal: number
  solve: ReturnType<typeof neededForGoal>
  upcoming: GradeItem[]
}): JSX.Element {
  if (!solve) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6 }}>
        No graded weight yet — once this class has graded work (or you add manual items), the goal math kicks in.
      </div>
    )
  }

  if (solve.remainingWeight <= 0) {
    return (
      <div style={{ textAlign: 'center' }}>
        <Badge tone={solve.secured ? 'pos' : 'neg'} icon={solve.secured ? 'check' : 'alert'}>
          {solve.secured ? `${letterFor(goal)} locked — nothing left to grade` : `Out of reach — no graded work remains`}
        </Badge>
      </div>
    )
  }

  const needed = solve.needed
  const tone = solve.secured ? 'pos' : !solve.reachable ? 'neg' : 'accent'
  const headline = solve.secured
    ? 'Already locked'
    : !solve.reachable
      ? 'Out of reach'
      : `${round(Math.max(0, needed))}%`

  // A single remaining item gets a sentence by name; many items get the average.
  const subject = upcoming.length === 1 ? `on ${upcoming[0].name}` : 'on average across the rest'

  return (
    <div>
      <div style={{ padding: 18, borderRadius: 'var(--r-md)', textAlign: 'center', background: tone === 'neg' ? 'color-mix(in oklch, var(--neg) 10%, transparent)' : tone === 'pos' ? 'color-mix(in oklch, var(--pos) 12%, transparent)' : 'var(--accent-soft)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 4 }}>To finish at {goal}% ({letterFor(goal)}), you need</div>
        <div className="mono" style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, color: tone === 'neg' ? 'var(--neg)' : tone === 'pos' ? 'var(--pos)' : 'var(--accent-h)' }}>
          {headline}
        </div>
        {!solve.secured && solve.reachable && (
          <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 8 }}>{subject}</div>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, marginTop: 14 }}>
        {solve.secured ? (
          <>You&rsquo;ve already locked <strong style={{ color: 'var(--text)' }}>{letterFor(goal)}</strong> — even a 0 on everything left keeps you there.</>
        ) : !solve.reachable ? (
          <>Even a perfect score on the remaining <strong style={{ color: 'var(--text)' }}>{round(solve.remainingWeight)}%</strong> falls short of {goal}%. Pick a lower goal to see what&rsquo;s in play.</>
        ) : (
          <>The remaining <strong style={{ color: 'var(--text)' }}>{round(solve.remainingWeight)}%</strong> of your grade is still up for grabs — that&rsquo;s your room to move.</>
        )}
      </div>
    </div>
  )
}

/* ── manual items (PowerSchool, by hand) ──────────────────────────────── */

function ManualItems({ items, onChange }: { items: ManualItem[]; onChange: (items: ManualItem[]) => void }): JSX.Element {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  const [score, setScore] = useState('')

  const totalWeight = items.reduce((s, m) => s + (m.weight || 0), 0)

  const add = (): void => {
    const w = Number(weight)
    if (!name.trim() || !Number.isFinite(w) || w <= 0) return
    const s = score.trim() === '' ? null : Math.max(0, Math.min(100, Number(score)))
    const item: ManualItem = {
      id: newId(),
      name: name.trim(),
      weight: Math.max(0, Math.min(100, w)),
      score: s !== null && Number.isFinite(s) ? s : null
    }
    onChange([...items, item])
    setName('')
    setWeight('')
    setScore('')
  }

  const remove = (id: string): void => onChange(items.filter((m) => m.id !== id))

  return (
    <Card>
      <SectionTitle
        icon="plus"
        title="Manual items"
        sub="PowerSchool has no API — type those grades in here and they count exactly like Canvas items."
        action={items.length > 0 ? <Badge tone="neutral" size="sm">{round(totalWeight)}% weight</Badge> : undefined}
      />

      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {items.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>
                  {round(m.weight)}% of grade
                </div>
              </div>
              {m.score !== null ? (
                <span className="mono" style={{ fontSize: 14, fontWeight: 800, color: gradeColor(m.score) }}>{round(m.score)}%</span>
              ) : (
                <Badge tone="accent" size="sm">Upcoming</Badge>
              )}
              <button
                className="tap"
                onClick={() => remove(m.id)}
                aria-label={`Remove ${m.name}`}
                style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 'var(--r-sm)', color: 'var(--text-3)', background: 'transparent' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--neg)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px 96px auto', gap: 10, alignItems: 'end' }}>
        <Field label="Item name">
          <Input
            placeholder="e.g. Midterm exam"
            value={name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') add() }}
          />
        </Field>
        <Field label="Weight %">
          <Input
            type="number"
            placeholder="20"
            value={weight}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setWeight(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') add() }}
          />
        </Field>
        <Field label="Score %" hint="Blank = upcoming">
          <Input
            type="number"
            placeholder="—"
            value={score}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setScore(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') add() }}
          />
        </Field>
        <Button icon="plus" onClick={add} disabled={!name.trim() || !(Number(weight) > 0)} style={!name.trim() || !(Number(weight) > 0) ? { opacity: 0.6 } : undefined}>
          Add
        </Button>
      </div>
    </Card>
  )
}

/* ── GPA calculator ──────────────────────────────────────────────────── */

const TIER_LABEL: Record<ClassTier, string> = { regular: 'Regular', honors: 'Honors', ap: 'AP' }
const TIER_ORDER: ClassTier[] = ['regular', 'honors', 'ap']

function GpaCalculator({
  courses,
  gpa,
  onGpa,
  loaded
}: {
  courses: CourseView[]
  gpa: GpaSettings
  onGpa: (next: GpaSettings) => void
  loaded: boolean
}): JSX.Element {
  const graded = useMemo(() => courses.filter((c): c is CourseView & { score: number } => c.score !== null), [courses])
  const result = useMemo(() => computeGpa(graded, gpa), [graded, gpa])

  if (courses.length === 0) {
    return (
      <EmptyState
        icon="cap"
        title="No classes yet"
        body="Connect Canvas and your active classes will show up here, ready to total into a GPA on your school’s scale."
      />
    )
  }

  const setTier = (id: number, tier: ClassTier): void => {
    const tiers = { ...gpa.tiers, [String(id)]: tier }
    onGpa({ ...gpa, tiers })
  }

  const gpaMax = gpa.scale === 'unweighted' ? 4 : gpa.cap === '4.5' ? 4.5 : 5

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 18, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Reveal>
          <Card>
            <SectionTitle icon="sliders" title="Your scale" sub="Schools grade differently — pick yours so the number is actually right." />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>Weighting</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Weighted gives honors/AP classes a bump.</div>
                </div>
                <Segmented
                  options={[
                    { value: 'unweighted', label: 'Unweighted' },
                    { value: 'weighted', label: 'Weighted' }
                  ]}
                  value={gpa.scale}
                  onChange={(v) => onGpa({ ...gpa, scale: v as GpaSettings['scale'] })}
                  size="sm"
                />
              </div>

              {gpa.scale === 'weighted' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-2)' }}>AP/honors cap</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Top grade-point an AP class can reach.</div>
                  </div>
                  <Segmented
                    options={[
                      { value: '5.0', label: '5.0 scale' },
                      { value: '4.5', label: '4.5 scale' }
                    ]}
                    value={gpa.cap}
                    onChange={(v) => onGpa({ ...gpa, cap: v as GpaSettings['cap'] })}
                    size="sm"
                  />
                </div>
              )}
            </div>
          </Card>
        </Reveal>

        <Reveal delay={60}>
          <Card>
            <SectionTitle icon="cap" title="Your classes" sub="Mark each class’s rigor — it drives the weighted bump." />
            {graded.length === 0 ? (
              <EmptyState
                icon="donut"
                title="No grades posted yet"
                body="None of your classes has a current score from Canvas yet, so there’s nothing to total. Add manual items in What-if or check back once grades post."
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {graded.map((c) => {
                  const tier = gpa.tiers[String(c.id)] ?? 'regular'
                  const pts = classGpaPoints(c.score, tier, gpa)
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
                      <span style={{ width: 9, height: 9, borderRadius: 99, background: c.color, flex: '0 0 auto' }} />
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                        <div className="mono" style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                          {round(c.score)}% · {letterFor(c.score)}
                        </div>
                      </div>
                      <Segmented
                        options={TIER_ORDER.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
                        value={tier}
                        onChange={(v) => setTier(c.id, v as ClassTier)}
                        size="sm"
                      />
                      <span className="mono" style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-h)', width: 44, textAlign: 'right', flex: '0 0 auto' }}>
                        {pts.toFixed(1)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </Reveal>
      </div>

      {/* the GPA, live */}
      <Reveal delay={100}>
        <Card>
          <SectionTitle icon="donut" title="Your GPA" />
          <div style={{ textAlign: 'center', padding: '12px 0 6px' }}>
            <ProgressRing value={result.gpa !== null ? (result.gpa / gpaMax) * 100 : 0} size={120} stroke={9} color="var(--accent)">
              <span className="mono" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {result.gpa !== null ? (loaded ? <CountUp value={result.gpa} decimals={2} /> : result.gpa.toFixed(2)) : '—'}
              </span>
            </ProgressRing>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 14 }}>
              {gpa.scale === 'weighted' ? 'Weighted' : 'Unweighted'} · out of {gpaMax.toFixed(1)}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
              Across {result.counted} {result.counted === 1 ? 'class' : 'classes'}
            </div>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          <div style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6 }}>
            One class, one unit — each counts equally. Honors/AP only bump your GPA on the weighted scale. Your scale and class tags are saved on this device.
          </div>
        </Card>
      </Reveal>
    </div>
  )
}
