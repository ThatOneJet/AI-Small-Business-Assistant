/**
 * Pylon — Courses › Assignments.
 *
 * List every assignment in a course (status / due / type), open one to read the
 * coursework (description HTML), and submit it: a textarea for online_text_entry
 * and a URL field for online_url. Submission state + errors are surfaced from
 * the real Canvas reply.
 */
import { useCallback, useMemo, useState, type ChangeEvent, type JSX } from 'react'
import { Badge, Button, Card, Segmented } from '../../ui'
import { AnimatedList, Reveal } from '../../motion'
import { Icon } from '../../icons'
import {
  assignmentIcon,
  dueMeta,
  fmtDate,
  form,
  get,
  paginate,
  submissionStatus,
  type CanvasAssignment,
  type CanvasQuiz,
  type CanvasSubmissionResult
} from './canvas'
import { QuizRunner } from './Quizzes'
import {
  AreaHead,
  BackHeader,
  Busy,
  CanvasHtml,
  EmptyCard,
  ListRow,
  LoadError,
  MetaLine,
  Note,
  ReaderSkeleton,
  RowSkeletons,
  StatusBadge,
  useAction,
  useAsync
} from './shared'

/* ── list ────────────────────────────────────────────────────────────── */

type Filter = 'all' | 'todo' | 'submitted' | 'graded'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: 'To do' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'graded', label: 'Graded' }
]

function bucketOf(a: CanvasAssignment): Filter {
  const ws = a.submission?.workflow_state
  if (ws === 'graded') return 'graded'
  if (ws === 'submitted' || ws === 'pending_review') return 'submitted'
  return 'todo'
}

export function AssignmentsArea({
  courseId,
  accent,
  initialOpenId
}: {
  courseId: number
  accent: string
  initialOpenId?: number
}): JSX.Element {
  const [openId, setOpenId] = useState<number | null>(initialOpenId ?? null)

  const { state, reload } = useAsync<CanvasAssignment[]>(
    () =>
      paginate<CanvasAssignment>(
        `/api/v1/courses/${courseId}/assignments?per_page=100&include[]=submission&order_by=due_at`
      ),
    courseId
  )
  const [filter, setFilter] = useState<Filter>('all')

  const sorted = useMemo(() => {
    if (state.phase !== 'ready') return []
    return state.data.slice().sort((a, b) => {
      const da = a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER
      const db = b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER
      return da - db
    })
  }, [state])
  const filtered = useMemo(() => (filter === 'all' ? sorted : sorted.filter((a) => bucketOf(a) === filter)), [sorted, filter])

  if (openId !== null) {
    const idx = sorted.findIndex((a) => a.id === openId)
    const prevId = idx > 0 ? sorted[idx - 1].id : null
    const nextId = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].id : null
    return (
      <AssignmentDetail
        courseId={courseId}
        assignmentId={openId}
        accent={accent}
        onBack={() => setOpenId(null)}
        onSubmitted={reload}
        onPrev={prevId !== null ? () => setOpenId(prevId) : undefined}
        onNext={nextId !== null ? () => setOpenId(nextId) : undefined}
        position={idx >= 0 ? { index: idx + 1, total: sorted.length } : undefined}
      />
    )
  }

  return (
    <div>
      <AreaHead
        title="Assignments"
        sub="Every assignment in this course — status, due date, and what to turn in."
        action={
          state.phase === 'ready' ? <Segmented options={FILTERS} value={filter} onChange={(v) => setFilter(v as Filter)} size="sm" /> : undefined
        }
      />

      {state.phase === 'loading' && <RowSkeletons count={6} />}
      {state.phase === 'error' && <LoadError message={state.message} onRetry={reload} />}
      {state.phase === 'ready' &&
        (filtered.length === 0 ? (
          <EmptyCard
            icon="check"
            title={state.data.length === 0 ? 'No assignments' : 'Nothing here'}
            body={
              state.data.length === 0
                ? 'Canvas didn’t return any assignments for this course yet.'
                : 'No assignments match this filter — try another tab.'
            }
          />
        ) : (
          <AnimatedList stagger={40} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((a) => {
              const st = submissionStatus(a.submission, a.points_possible ?? null)
              const due = dueMeta(a.due_at)
              return (
                <ListRow
                  key={a.id}
                  icon={assignmentIcon(a)}
                  accent={accent}
                  iconColor="var(--accent-h)"
                  title={a.name}
                  onClick={() => setOpenId(a.id)}
                  meta={
                    <MetaLine>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="calendar" size={13} /> {fmtDate(a.due_at)}
                      </span>
                      {a.points_possible ? <span className="mono">{a.points_possible} pts</span> : null}
                      {a.due_at && due.tone !== 'neutral' ? <Badge tone={due.tone} size="sm">{due.label}</Badge> : null}
                    </MetaLine>
                  }
                  right={<><StatusBadge tone={st.tone}>{st.label}</StatusBadge><Icon name="chevR" size={16} style={{ color: 'var(--text-3)' }} /></>}
                />
              )
            })}
          </AnimatedList>
        ))}
    </div>
  )
}

/* ── detail + submit ─────────────────────────────────────────────────── */

/** Resolve an assignment by id, tolerating calendar/planner "plannable" ids: a quiz's
 *  planner plannable_id is the QUIZ id, not its assignment id, so `/assignments/:id`
 *  404s when opened from the calendar. If that happens, look the id up as a quiz and
 *  fetch its backing assignment so the inline reader still opens. */
async function resolveAssignment(courseId: number, id: number): Promise<CanvasAssignment> {
  try {
    return await get<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments/${id}?include[]=submission`)
  } catch (err) {
    try {
      const quiz = await get<{ assignment_id?: number | null }>(`/api/v1/courses/${courseId}/quizzes/${id}`)
      if (quiz && quiz.assignment_id) {
        return await get<CanvasAssignment>(
          `/api/v1/courses/${courseId}/assignments/${quiz.assignment_id}?include[]=submission`
        )
      }
    } catch {
      /* not a quiz either — fall through to the original error */
    }
    throw err
  }
}

export function AssignmentDetail({
  courseId,
  assignmentId,
  accent,
  onBack,
  onSubmitted,
  onPrev,
  onNext,
  position
}: {
  courseId: number
  assignmentId: number
  accent: string
  onBack: () => void
  onSubmitted: () => void
  onPrev?: () => void
  onNext?: () => void
  position?: { index: number; total: number }
}): JSX.Element {
  void accent
  const { state, reload } = useAsync<CanvasAssignment>(
    () => resolveAssignment(courseId, assignmentId),
    `${courseId}:${assignmentId}`
  )

  return (
    <div>
      {state.phase === 'loading' && (
        <>
          <Reveal style={{ marginBottom: 20 }}>
            <button className="tap" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>
              <Icon name="chevL" size={15} /> Assignments
            </button>
          </Reveal>
          <ReaderSkeleton />
        </>
      )}
      {state.phase === 'error' && (
        <>
          <Reveal style={{ marginBottom: 20 }}>
            <button className="tap" onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-3)' }}>
              <Icon name="chevL" size={15} /> Assignments
            </button>
          </Reveal>
          {/(404|not.?found)/i.test(state.message) ? (
            <EmptyCard
              icon="info"
              title="Can't open this one here"
              body="This item couldn't load as an assignment — it may be a calendar event, a note, or an external item. Head back and open it from its course."
            />
          ) : (
            <LoadError message={state.message} onRetry={reload} />
          )}
        </>
      )}
      {state.phase === 'ready' && (
        <AssignmentBody
          courseId={courseId}
          a={state.data}
          onBack={onBack}
          onSubmitted={() => {
            reload()
            onSubmitted()
          }}
          onPrev={onPrev}
          onNext={onNext}
          position={position}
        />
      )}
    </div>
  )
}

function AssignmentBody({
  courseId,
  a,
  onBack,
  onSubmitted,
  onPrev,
  onNext,
  position
}: {
  courseId: number
  a: CanvasAssignment
  onBack: () => void
  onSubmitted: () => void
  onPrev?: () => void
  onNext?: () => void
  position?: { index: number; total: number }
}): JSX.Element {
  const st = submissionStatus(a.submission, a.points_possible ?? null)
  const due = dueMeta(a.due_at)
  const types = a.submission_types ?? []
  const canText = types.includes('online_text_entry')
  const canUrl = types.includes('online_url')
  const isQuiz = !!a.quiz_id || types.includes('online_quiz')
  const submittable = (canText || canUrl) && !a.locked_for_user

  // Quizzes are taken right here (no separate Quizzes section). Starting opens a
  // real attempt in Canvas and the runner takes over the view until you exit.
  const [takingQuiz, setTakingQuiz] = useState<CanvasQuiz | null>(null)
  if (takingQuiz) {
    return (
      <QuizRunner
        courseId={courseId}
        quiz={takingQuiz}
        onExit={() => {
          setTakingQuiz(null)
          onSubmitted()
        }}
      />
    )
  }

  return (
    <div>
      <BackHeader
        onBack={onBack}
        backLabel="Assignments"
        title={a.name}
        badge={<StatusBadge tone={st.tone}>{st.label}</StatusBadge>}
        sub={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="calendar" size={14} /> Due {fmtDate(a.due_at)}
            </span>
            {a.due_at && due.tone !== 'neutral' ? <Badge tone={due.tone} size="sm">{due.label}</Badge> : null}
            {a.points_possible ? <span className="mono">{a.points_possible} pts</span> : null}
            {types.length > 0 ? <span style={{ color: 'var(--text-3)' }}>{types.map(prettyType).join(' · ')}</span> : null}
          </span>
        }
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {position && position.total > 1 && (
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)', marginRight: 2 }}>
                {position.index} / {position.total}
              </span>
            )}
            <Button variant="surface" size="sm" icon="chevL" disabled={!onPrev} onClick={() => onPrev?.()} title="Previous assignment" />
            <Button variant="surface" size="sm" icon="chevR" disabled={!onNext} onClick={() => onNext?.()} title="Next assignment" />
            {a.html_url && (
              <Button variant="surface" size="sm" icon="external" onClick={() => a.html_url && window.open(a.html_url, '_blank')}>
                Open in Canvas
              </Button>
            )}
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: submittable ? '1fr' : '1fr', gap: 18 }}>
        <Reveal delay={60}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Icon name="book" size={17} style={{ color: 'var(--accent-h)' }} />
              <h3 style={{ fontSize: 15.5, fontWeight: 700 }}>The coursework</h3>
            </div>
            <CanvasHtml html={a.description} />
          </Card>
        </Reveal>

        {a.locked_for_user && (
          <Reveal delay={90}>
            <Note icon="lock" tone="warn">This assignment is locked right now — Canvas isn’t accepting a submission.</Note>
          </Reveal>
        )}

        {isQuiz && !a.locked_for_user && (
          <Reveal delay={90}>
            {a.quiz_id ? (
              <InlineQuizStart courseId={courseId} quizId={a.quiz_id} onStart={setTakingQuiz} />
            ) : (
              <Note icon="target">This is a quiz, but Canvas didn’t expose its quiz id — open it in Canvas to take it.</Note>
            )}
          </Reveal>
        )}

        {!a.locked_for_user && !isQuiz && submittable && (
          <Reveal delay={110}>
            <SubmitPanel courseId={courseId} assignment={a} canText={canText} canUrl={canUrl} onSubmitted={onSubmitted} />
          </Reveal>
        )}

        {!submittable && !isQuiz && !a.locked_for_user && (
          <Reveal delay={110}>
            <Note icon="info">
              {types.includes('online_upload')
                ? 'This assignment takes a file upload, which Pylon can’t do yet — submit it in Canvas.'
                : types.includes('on_paper')
                  ? 'This is an on-paper assignment — there’s nothing to submit online.'
                  : types.includes('none')
                    ? 'This assignment has no online submission.'
                    : 'Pylon can’t submit this assignment type yet — open it in Canvas to turn it in.'}
            </Note>
          </Reveal>
        )}
      </div>
    </div>
  )
}

function prettyType(t: string): string {
  return (
    {
      online_text_entry: 'Text entry',
      online_url: 'Website URL',
      online_upload: 'File upload',
      online_quiz: 'Quiz',
      media_recording: 'Media',
      on_paper: 'On paper',
      discussion_topic: 'Discussion',
      none: 'No submission',
      external_tool: 'External tool'
    }[t] ?? t.replace(/_/g, ' ')
  )
}

/* ── inline quiz starter (take a quiz from inside its assignment) ─────── */

function InlineQuizStart({
  courseId,
  quizId,
  onStart
}: {
  courseId: number
  quizId: number
  onStart: (q: CanvasQuiz) => void
}): JSX.Element {
  const { state } = useAsync<CanvasQuiz>(
    () => get<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes/${quizId}`),
    `${courseId}:quiz:${quizId}`
  )

  if (state.phase === 'loading')
    return (
      <Card>
        <div style={{ padding: 4, fontSize: 13.5, color: 'var(--text-3)' }}>Loading the quiz…</div>
      </Card>
    )
  if (state.phase === 'error') return <Note icon="alert" tone="neg">Couldn’t load this quiz: {state.message}</Note>

  const q = state.data
  const surveyish = q.quiz_type === 'survey' || q.quiz_type === 'graded_survey' || q.quiz_type === 'practice_quiz'
  if (q.locked_for_user || q.has_access_code)
    return (
      <Note icon="lock" tone="warn">
        {q.has_access_code
          ? 'This quiz needs an access code — take it in Canvas.'
          : 'This quiz is locked right now — Canvas isn’t accepting an attempt.'}
      </Note>
    )

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="target" size={17} style={{ color: 'var(--accent-h)' }} />
            <h3 style={{ fontSize: 15.5, fontWeight: 700 }}>Take this quiz</h3>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6, maxWidth: 470, lineHeight: 1.5 }}>
            Take it right here — starting opens a real attempt in Canvas. Pylon answers the common question types and
            submits your attempt; anything it can’t, it shows read-only.
            {q.allowed_attempts !== undefined && q.allowed_attempts >= 0
              ? ` ${q.allowed_attempts} attempt${q.allowed_attempts === 1 ? '' : 's'} allowed.`
              : ' Unlimited attempts.'}
            {q.question_count !== undefined ? ` · ${q.question_count} questions` : ''}
            {q.time_limit ? ` · ${q.time_limit} min` : ''}
          </div>
        </div>
        <Button variant="primary" icon="arrowR" onClick={() => onStart(q)}>
          {surveyish ? 'Take quiz' : 'Start attempt'}
        </Button>
      </div>
    </Card>
  )
}

/* ── submit panel ────────────────────────────────────────────────────── */

function SubmitPanel({
  courseId,
  assignment,
  canText,
  canUrl,
  onSubmitted
}: {
  courseId: number
  assignment: CanvasAssignment
  canText: boolean
  canUrl: boolean
  onSubmitted: () => void
}): JSX.Element {
  const [mode, setMode] = useState<'text' | 'url'>(canText ? 'text' : 'url')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [done, setDone] = useState<CanvasSubmissionResult | null>(null)
  const { busy, error, setError, run } = useAction()

  const submit = useCallback((): void => {
    void run(async () => {
      if (mode === 'text') {
        if (!text.trim()) {
          setError('Write something before submitting.')
          return
        }
      } else if (!url.trim()) {
        setError('Enter a URL to submit.')
        return
      } else if (!/^https?:\/\//i.test(url.trim())) {
        setError('Enter a full URL (starting with http:// or https://).')
        return
      }
      const fields: Record<string, string> =
        mode === 'text'
          ? { 'submission[submission_type]': 'online_text_entry', 'submission[body]': textToHtml(text) }
          : { 'submission[submission_type]': 'online_url', 'submission[url]': url.trim() }
      const res = await form<CanvasSubmissionResult>(
        `/api/v1/courses/${courseId}/assignments/${assignment.id}/submissions`,
        fields
      )
      setDone(res)
      onSubmitted()
    })
  }, [mode, text, url, courseId, assignment.id, run, setError, onSubmitted])

  if (done) {
    const st = submissionStatus(done, assignment.points_possible ?? null)
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '10px 8px' }}>
          <div style={{ width: 60, height: 60, margin: '0 auto 14px', borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'color-mix(in oklch, var(--pos) 16%, transparent)', color: 'var(--pos)', animation: 'jc-pop .5s var(--spring)' }}>
            <Icon name="check" size={28} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>Submitted to Canvas</h3>
          <p style={{ fontSize: 13.5, color: 'var(--text-3)', maxWidth: 360, margin: '0 auto 16px', lineHeight: 1.55 }}>
            Your {mode === 'text' ? 'text entry' : 'URL'} is in. Canvas recorded it as{' '}
            <strong style={{ color: 'var(--text-2)' }}>{done.workflow_state ?? 'submitted'}</strong>
            {done.attempt ? ` (attempt ${done.attempt})` : ''}.
          </p>
          <div style={{ display: 'inline-flex', gap: 10 }}>
            <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => { setDone(null); setText(''); setUrl('') }}>
              Submit again
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="send" size={17} style={{ color: 'var(--accent-h)' }} />
          <h3 style={{ fontSize: 15.5, fontWeight: 700 }}>Turn it in</h3>
        </div>
        {canText && canUrl && (
          <Segmented
            options={[{ value: 'text', label: 'Text entry' }, { value: 'url', label: 'Website URL' }]}
            value={mode}
            onChange={(v) => setMode(v as 'text' | 'url')}
            size="sm"
          />
        )}
      </div>

      {mode === 'text' ? (
        <textarea
          value={text}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
          placeholder="Write your response… (line breaks become paragraphs)"
          style={{ width: '100%', minHeight: 200, padding: 14, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, lineHeight: 1.65, resize: 'vertical', outline: 'none', fontFamily: 'var(--font)' }}
        />
      ) : (
        <input
          value={url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          placeholder="https://…"
          style={{ width: '100%', height: 46, padding: '0 14px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14.5, outline: 'none', fontFamily: 'var(--font)' }}
        />
      )}

      {error && (
        <div style={{ marginTop: 12 }}>
          <Note icon="alert" tone="neg">{error}</Note>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {mode === 'text' ? 'Submitted as online text to Canvas.' : 'Canvas records the link as your submission.'}
        </span>
        <Button variant="primary" icon={busy ? undefined : 'send'} onClick={submit} disabled={busy} style={busy ? { opacity: 0.75 } : undefined}>
          {busy ? <Busy label="Submitting…" /> : 'Submit to Canvas'}
        </Button>
      </div>
    </Card>
  )
}

/** Turn a plain-text textarea into simple paragraph HTML for online_text_entry. */
function textToHtml(text: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
}
