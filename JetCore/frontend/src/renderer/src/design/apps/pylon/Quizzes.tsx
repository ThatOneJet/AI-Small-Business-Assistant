/**
 * Pylon — Courses › Quizzes.
 *
 * List a course's quizzes, open one to read its description, and TAKE it:
 *   1. start an attempt  → POST /courses/:cid/quizzes/:qid/submissions
 *      (returns quiz_submissions[0] with id + validation_token)
 *   2. fetch questions   → GET /quiz_submissions/:sid/questions
 *   3. answer each question (the supported types render inputs; the rest go
 *      read-only with a clear note)
 *   4. complete          → POST /courses/:cid/quizzes/:qid/submissions/:sid/complete
 *      with validation_token + attempt + the urlencoded answers.
 *
 * This flow is intricate and Canvas's answer encoding varies by type, so where
 * a type isn't safely answerable we degrade gracefully rather than break, and
 * the completion still goes through with whatever could be encoded.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type JSX } from 'react'
import { Badge, Button, Card } from '../../ui'
import { AnimatedList, Reveal } from '../../motion'
import { Icon } from '../../icons'
import {
  call,
  dueMeta,
  fmtDate,
  form,
  get,
  paginate,
  type CanvasQuiz,
  type CanvasQuizQuestion,
  type CanvasQuizSubmission
} from './canvas'
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

export function QuizzesArea({ courseId, accent }: { courseId: number; accent: string }): JSX.Element {
  const [openId, setOpenId] = useState<number | null>(null)
  const { state, reload } = useAsync<CanvasQuiz[]>(
    () => paginate<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes?per_page=100`),
    courseId
  )

  if (openId !== null) {
    return <QuizDetail courseId={courseId} quizId={openId} accent={accent} onBack={() => setOpenId(null)} />
  }

  const quizzes = state.phase === 'ready' ? state.data : []
  const sorted = quizzes.slice().sort((a, b) => {
    const da = a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER
    const db = b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER
    return da - db
  })

  return (
    <div>
      <AreaHead title="Quizzes" sub="Quizzes and exams in this course — open one to read it or take it." />
      {state.phase === 'loading' && <RowSkeletons count={5} />}
      {state.phase === 'error' && <LoadError message={state.message} onRetry={reload} />}
      {state.phase === 'ready' &&
        (sorted.length === 0 ? (
          <EmptyCard icon="target" title="No quizzes" body="Canvas didn’t return any quizzes for this course." />
        ) : (
          <AnimatedList stagger={40} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorted.map((q) => {
              const due = dueMeta(q.due_at)
              return (
                <ListRow
                  key={q.id}
                  icon="target"
                  accent={accent}
                  iconColor="var(--accent-h)"
                  title={q.title}
                  onClick={() => setOpenId(q.id)}
                  meta={
                    <MetaLine>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Icon name="calendar" size={13} /> {fmtDate(q.due_at)}
                      </span>
                      {q.question_count !== undefined ? <span className="mono">{q.question_count} Q</span> : null}
                      {q.points_possible ? <span className="mono">{q.points_possible} pts</span> : null}
                      {q.due_at && due.tone !== 'neutral' ? <Badge tone={due.tone} size="sm">{due.label}</Badge> : null}
                    </MetaLine>
                  }
                  right={<Icon name="chevR" size={16} style={{ color: 'var(--text-3)' }} />}
                />
              )
            })}
          </AnimatedList>
        ))}
    </div>
  )
}

/* ── detail ──────────────────────────────────────────────────────────── */

function QuizDetail({ courseId, quizId, accent, onBack }: { courseId: number; quizId: number; accent: string; onBack: () => void }): JSX.Element {
  void accent
  const { state, reload } = useAsync<CanvasQuiz>(
    () => get<CanvasQuiz>(`/api/v1/courses/${courseId}/quizzes/${quizId}`),
    `${courseId}:${quizId}`
  )
  const [taking, setTaking] = useState(false)

  if (state.phase === 'loading') {
    return (
      <div>
        <BackHeader onBack={onBack} backLabel="Quizzes" title="Loading quiz…" />
        <ReaderSkeleton />
      </div>
    )
  }
  if (state.phase === 'error') {
    return (
      <div>
        <BackHeader onBack={onBack} backLabel="Quizzes" title="Quiz" />
        <LoadError message={state.message} onRetry={reload} />
      </div>
    )
  }

  const q = state.data
  if (taking) {
    return <QuizRunner courseId={courseId} quiz={q} onExit={() => setTaking(false)} />
  }

  const due = dueMeta(q.due_at)
  const surveyish = q.quiz_type === 'survey' || q.quiz_type === 'graded_survey' || q.quiz_type === 'practice_quiz'
  const blocked = q.locked_for_user || q.has_access_code

  return (
    <div>
      <BackHeader
        onBack={onBack}
        backLabel="Quizzes"
        title={q.title}
        badge={q.quiz_type ? <StatusBadge tone="neutral">{prettyQuizType(q.quiz_type)}</StatusBadge> : undefined}
        sub={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="calendar" size={14} /> Due {fmtDate(q.due_at)}
            </span>
            {q.due_at && due.tone !== 'neutral' ? <Badge tone={due.tone} size="sm">{due.label}</Badge> : null}
            {q.question_count !== undefined ? <span className="mono">{q.question_count} questions</span> : null}
            {q.points_possible ? <span className="mono">{q.points_possible} pts</span> : null}
            {q.time_limit ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="clock" size={14} /> {q.time_limit} min</span> : null}
          </span>
        }
        action={
          q.html_url ? (
            <Button variant="surface" size="sm" icon="external" onClick={() => q.html_url && window.open(q.html_url, '_blank')}>
              Open in Canvas
            </Button>
          ) : undefined
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Reveal delay={60}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Icon name="info" size={17} style={{ color: 'var(--accent-h)' }} />
              <h3 style={{ fontSize: 15.5, fontWeight: 700 }}>About this quiz</h3>
            </div>
            <CanvasHtml html={q.description} />
          </Card>
        </Reveal>

        <Reveal delay={90}>
          {blocked ? (
            <Note icon="lock" tone="warn">
              {q.has_access_code
                ? 'This quiz needs an access code — take it in Canvas.'
                : 'This quiz is locked right now — Canvas isn’t accepting an attempt.'}
            </Note>
          ) : (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Ready when you are</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, maxWidth: 460, lineHeight: 1.5 }}>
                    Starting opens an attempt in Canvas. Pylon answers the common question types; anything it can’t,
                    it shows read-only so you can finish in Canvas.
                    {q.allowed_attempts !== undefined && q.allowed_attempts >= 0
                      ? ` ${q.allowed_attempts} attempt${q.allowed_attempts === 1 ? '' : 's'} allowed.`
                      : ' Unlimited attempts.'}
                  </div>
                </div>
                <Button variant="primary" icon="arrowR" onClick={() => setTaking(true)}>
                  {surveyish ? 'Take quiz' : 'Start attempt'}
                </Button>
              </div>
            </Card>
          )}
        </Reveal>
      </div>
    </div>
  )
}

function prettyQuizType(t: string): string {
  return (
    {
      practice_quiz: 'Practice',
      assignment: 'Graded quiz',
      graded_survey: 'Graded survey',
      survey: 'Survey'
    }[t] ?? t.replace(/_/g, ' ')
  )
}

/* ── the runner (start → answer → complete) ──────────────────────────── */

interface StartResult {
  quiz_submissions?: CanvasQuizSubmission[]
}
interface QuestionsResult {
  quiz_submission_questions?: CanvasQuizQuestion[]
}
interface CompleteResult {
  quiz_submissions?: CanvasQuizSubmission[]
}

/** A type we can render answer inputs for. */
const ANSWERABLE = new Set([
  'multiple_choice_question',
  'true_false_question',
  'short_answer_question',
  'essay_question',
  'text_only_question',
  'multiple_answers_question',
  'numerical_question',
  'calculated_question',
  'fill_in_multiple_blanks_question',
  'multiple_dropdowns_question',
  'matching_question'
])

/** A single question's answer: scalar (choice/text), array (select-all), or a
 *  map keyed by blank_id (fill-in-blanks / dropdowns) or answer_id (matching). */
type AnswerValue = string | string[] | Record<string, string>
type AnswerMap = Record<number, AnswerValue>

/** Strip tags so an option's label renders as plain text in a <select>. */
const plainText = (s: string | undefined): string => (s ?? '').replace(/<[^>]+>/g, '').trim()
/** True when the question has a non-empty answer. */
function isAnswered(a: AnswerValue | undefined): boolean {
  if (a === undefined) return false
  if (Array.isArray(a)) return a.length > 0
  if (typeof a === 'object') return Object.values(a).some((v) => v != null && String(v).trim() !== '')
  return a.trim() !== ''
}

/** Resolve a timed attempt's hard deadline (epoch ms), or null if untimed.
 *  Prefers Canvas's `end_at` on the started submission; otherwise computes it
 *  from `started_at + time_limit*60s`, finally `quiz.time_limit`. */
function deadlineFor(sub: CanvasQuizSubmission | null, quiz: CanvasQuiz): number | null {
  if (!sub) return null
  if (sub.end_at) {
    const t = Date.parse(sub.end_at)
    if (!Number.isNaN(t)) return t
  }
  const limitMin = sub.time_limit ?? quiz.time_limit ?? null
  if (limitMin && sub.started_at) {
    const started = Date.parse(sub.started_at)
    if (!Number.isNaN(started)) return started + limitMin * 60_000
  }
  return null
}

/** mm:ss for a non-negative seconds count (clamps at 0). */
function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/** Live countdown chip for a timed attempt — ticks every second off `deadline`,
 *  turns red + pulses under 2 minutes, and fires `onExpire` once at zero so the
 *  runner can auto-submit. Renders nothing for untimed quizzes. */
function QuizTimer({ deadline, onExpire }: { deadline: number | null; onExpire: () => void }): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  const fired = useRef(false)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    if (deadline === null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [deadline])

  useEffect(() => {
    if (deadline === null) return
    if (now >= deadline && !fired.current) {
      fired.current = true
      onExpireRef.current()
    }
  }, [now, deadline])

  if (deadline === null) return null
  const remainingSec = Math.max(0, (deadline - now) / 1000)
  const urgent = remainingSec <= 120
  const out = remainingSec <= 0
  const color = urgent || out ? 'var(--neg)' : 'var(--accent-h)'
  const bg = urgent || out ? 'color-mix(in oklch, var(--neg) 14%, transparent)' : 'var(--accent-soft)'
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 11px',
        borderRadius: 999,
        fontSize: 13.5,
        fontWeight: 700,
        color,
        background: bg,
        animation: urgent && !out ? 'jc-pulse 1s ease-in-out infinite' : undefined
      }}
      title={out ? 'Time is up — submitting your attempt.' : 'Time remaining on this attempt'}
    >
      <Icon name="clock" size={14} />
      {out ? 'Time up' : fmtClock(remainingSec)}
    </span>
  )
}

export function QuizRunner({ courseId, quiz, onExit }: { courseId: number; quiz: CanvasQuiz; onExit: () => void }): JSX.Element {
  const [sub, setSub] = useState<CanvasQuizSubmission | null>(null)
  const [questions, setQuestions] = useState<CanvasQuizQuestion[] | null>(null)
  const [answers, setAnswers] = useState<AnswerMap>({})
  const [result, setResult] = useState<CanvasQuizSubmission | null>(null)
  const start = useAction()
  const finish = useAction()

  /* step 1 + 2: start the attempt, then load its questions. */
  const begin = useCallback((): void => {
    void start.run(async () => {
      const res = await form<StartResult>(`/api/v1/courses/${courseId}/quizzes/${quiz.id}/submissions`, {})
      const qs = res.quiz_submissions?.[0]
      if (!qs) throw new Error('Canvas didn’t return a quiz attempt.')
      setSub(qs)
      // questions endpoint wants the submission id + validation token
      const qres = await call({
        path: `/api/v1/quiz_submissions/${qs.id}/questions`,
        method: 'GET'
      })
      const qd = qres.data as QuestionsResult
      const list = qd.quiz_submission_questions ?? []
      setQuestions(list.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0)))
    })
  }, [courseId, quiz.id, start])

  const setAnswer = (qid: number, value: AnswerValue): void => setAnswers((m) => ({ ...m, [qid]: value }))

  /* step 4: complete the attempt with the encoded answers. */
  const complete = useCallback((): void => {
    if (!sub) return
    void finish.run(async () => {
      const fields: Record<string, string> = {
        validation_token: sub.validation_token ?? '',
        attempt: String(sub.attempt ?? 1)
      }
      for (const q of questions ?? []) {
        const a = answers[q.id]
        encodeAnswer(fields, q, a)
      }
      const res = await form<CompleteResult>(
        `/api/v1/courses/${courseId}/quizzes/${quiz.id}/submissions/${sub.id}/complete`,
        fields
      )
      setResult(res.quiz_submissions?.[0] ?? sub)
    })
  }, [sub, questions, answers, courseId, quiz.id, finish])

  /* the hard deadline for a timed attempt (from Canvas's end_at, or computed). */
  const deadline = deadlineFor(sub, quiz)

  /* when the clock hits zero, force-complete the attempt with whatever's filled
   *  in so the student doesn't lose it. Guarded so it never double-fires or runs
   *  after a manual submit. Routed through a ref to keep the timer callback stable. */
  const completeRef = useRef(complete)
  completeRef.current = complete
  const autoSubmit = useCallback((): void => {
    if (finish.busy || result) return
    completeRef.current()
  }, [finish.busy, result])

  /* completed → show the score (if Canvas returned one). */
  if (result) {
    const scored = result.score ?? result.kept_score
    const pending = result.workflow_state === 'pending_review'
    return (
      <div>
        <BackHeader onBack={onExit} backLabel="Quiz" title={quiz.title} />
        <Reveal>
          <Card>
            <div style={{ textAlign: 'center', padding: '14px 8px' }}>
              <div style={{ width: 64, height: 64, margin: '0 auto 16px', borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'color-mix(in oklch, var(--pos) 16%, transparent)', color: 'var(--pos)', animation: 'jc-pop .5s var(--spring)' }}>
                <Icon name="check" size={30} />
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 8 }}>Quiz submitted</h3>
              {pending ? (
                <p style={{ fontSize: 14, color: 'var(--text-3)', maxWidth: 380, margin: '0 auto 4px', lineHeight: 1.55 }}>
                  Your attempt is in. It needs manual grading (essay/short answer), so no score yet.
                </p>
              ) : scored !== null && scored !== undefined ? (
                <>
                  <div className="mono" style={{ fontSize: 44, fontWeight: 800, color: 'var(--accent-h)', lineHeight: 1, margin: '6px 0' }}>
                    {scored}
                    {quiz.points_possible ? <span style={{ fontSize: 22, color: 'var(--text-3)' }}> / {quiz.points_possible}</span> : null}
                  </div>
                  <p style={{ fontSize: 13.5, color: 'var(--text-3)' }}>Recorded by Canvas.</p>
                </>
              ) : (
                <p style={{ fontSize: 14, color: 'var(--text-3)', maxWidth: 380, margin: '0 auto', lineHeight: 1.55 }}>
                  Your attempt was submitted. Canvas didn’t return a score in this reply — check the quiz in Canvas.
                </p>
              )}
              <div style={{ marginTop: 18, display: 'inline-flex', gap: 10 }}>
                {quiz.html_url && (
                  <Button variant="surface" size="sm" icon="external" onClick={() => quiz.html_url && window.open(quiz.html_url, '_blank')}>
                    View in Canvas
                  </Button>
                )}
                <Button variant="ghost" size="sm" icon="chevL" onClick={onExit}>
                  Back to quiz
                </Button>
              </div>
            </div>
          </Card>
        </Reveal>
      </div>
    )
  }

  /* not started yet, or starting. */
  if (!sub || !questions) {
    return (
      <div>
        <BackHeader onBack={onExit} backLabel="Quiz" title={quiz.title} />
        <Card>
          <div style={{ textAlign: 'center', padding: '20px 8px' }}>
            {start.busy ? (
              <>
                <div style={{ display: 'inline-flex', marginBottom: 14 }}>
                  <Icon name="hourglass" size={30} style={{ color: 'var(--accent-h)' }} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Opening your attempt…</div>
                <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>Canvas is starting the quiz and loading questions.</div>
              </>
            ) : (
              <>
                <div style={{ width: 60, height: 60, margin: '0 auto 14px', borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
                  <Icon name="target" size={28} />
                </div>
                <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Start this attempt</h3>
                <p style={{ fontSize: 13.5, color: 'var(--text-3)', maxWidth: 380, margin: '0 auto 18px', lineHeight: 1.55 }}>
                  This opens a real attempt in Canvas. Once questions load, answer what you can and submit.
                </p>
                <Button variant="primary" icon="arrowR" onClick={begin}>Begin</Button>
              </>
            )}
            {start.error && (
              <div style={{ maxWidth: 460, margin: '16px auto 0' }}>
                <Note icon="alert" tone="neg">{start.error}</Note>
              </div>
            )}
          </div>
        </Card>
      </div>
    )
  }

  /* answering. */
  const supportedCount = questions.filter((q) => ANSWERABLE.has(q.question_type) && q.question_type !== 'text_only_question').length
  const answeredCount = questions.filter((q) => isAnswered(answers[q.id])).length

  return (
    <div>
      <BackHeader
        onBack={onExit}
        backLabel="Quiz"
        title={quiz.title}
        badge={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge tone="accent">Attempt {sub.attempt}</StatusBadge>
            <QuizTimer deadline={deadline} onExpire={autoSubmit} />
          </span>
        }
        sub={`${answeredCount} of ${supportedCount} answerable question${supportedCount === 1 ? '' : 's'} answered`}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {questions.map((q, i) => (
          <Reveal key={q.id} delay={Math.min(i, 8) * 40}>
            <QuestionCard index={i + 1} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
          </Reveal>
        ))}

        {finish.error && <Note icon="alert" tone="neg">{finish.error}</Note>}

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 420, lineHeight: 1.5 }}>
              Submitting completes the attempt in Canvas — you can’t change answers after. Unanswered or read-only
              questions are simply left blank.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="ghost" onClick={onExit} disabled={finish.busy}>
                Cancel
              </Button>
              <Button variant="primary" icon={finish.busy ? undefined : 'check'} onClick={complete} disabled={finish.busy} style={finish.busy ? { opacity: 0.75 } : undefined}>
                {finish.busy ? <Busy label="Submitting…" /> : 'Submit quiz'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ── a single question ───────────────────────────────────────────────── */

const selectStyle: CSSProperties = {
  width: '100%',
  maxWidth: 420,
  height: 42,
  padding: '0 12px',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 14,
  outline: 'none',
  fontFamily: 'var(--font)',
  cursor: 'pointer'
}

function QuestionCard({
  index,
  q,
  value,
  onChange
}: {
  index: number
  q: CanvasQuizQuestion
  value: AnswerValue | undefined
  onChange: (v: AnswerValue) => void
}): JSX.Element {
  const answers = q.answers ?? []
  const type = q.question_type
  /** Current value as a {blank_id|answer_id → value} map (for blanks/dropdowns/matching). */
  const asRecord = (): Record<string, string> => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})

  const renderInputs = (): JSX.Element => {
    if (type === 'text_only_question') {
      return <div style={{ fontSize: 12.5, color: 'var(--text-3)', fontStyle: 'italic' }}>(No answer required.)</div>
    }
    if (type === 'multiple_choice_question' || type === 'true_false_question') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {answers.map((ans) => {
            const on = value === String(ans.id)
            return (
              <Choice key={ans.id} on={on} onClick={() => onChange(String(ans.id))} type="radio">
                <CanvasHtml html={ans.html || ans.text} style={{ fontSize: 13.5 }} />
              </Choice>
            )
          })}
        </div>
      )
    }
    if (type === 'multiple_answers_question') {
      const sel = Array.isArray(value) ? value : []
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {answers.map((ans) => {
            const id = String(ans.id)
            const on = sel.includes(id)
            return (
              <Choice
                key={ans.id}
                on={on}
                type="check"
                onClick={() => onChange(on ? sel.filter((x) => x !== id) : [...sel, id])}
              >
                <CanvasHtml html={ans.html || ans.text} style={{ fontSize: 13.5 }} />
              </Choice>
            )
          })}
        </div>
      )
    }
    if (type === 'short_answer_question' || type === 'numerical_question' || type === 'calculated_question') {
      const numeric = type !== 'short_answer_question'
      return (
        <input
          value={typeof value === 'string' ? value : ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          inputMode={numeric ? 'decimal' : 'text'}
          placeholder={numeric ? 'Your number…' : 'Your answer…'}
          style={{ width: '100%', maxWidth: 420, height: 44, padding: '0 14px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14.5, outline: 'none', fontFamily: 'var(--font)' }}
        />
      )
    }
    // fill-in-multiple-blanks: one text input per distinct blank
    if (type === 'fill_in_multiple_blanks_question') {
      const blanks = [...new Set(answers.map((a) => a.blank_id).filter(Boolean) as string[])]
      const cur = asRecord()
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {blanks.map((bid) => (
            <label key={bid} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>{bid}</span>
              <input
                value={cur[bid] ?? ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...cur, [bid]: e.target.value })}
                placeholder="Your answer…"
                style={{ width: '100%', maxWidth: 420, height: 42, padding: '0 14px', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, outline: 'none', fontFamily: 'var(--font)' }}
              />
            </label>
          ))}
        </div>
      )
    }
    // multiple dropdowns: one <select> per blank, options scoped to that blank
    if (type === 'multiple_dropdowns_question') {
      const blanks = [...new Set(answers.map((a) => a.blank_id).filter(Boolean) as string[])]
      const cur = asRecord()
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {blanks.map((bid) => (
            <label key={bid} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>{bid}</span>
              <select
                value={cur[bid] ?? ''}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ ...cur, [bid]: e.target.value })}
                style={selectStyle}
              >
                <option value="">Choose…</option>
                {answers
                  .filter((a) => a.blank_id === bid)
                  .map((o) => (
                    <option key={o.id} value={String(o.id)}>{plainText(o.text || o.html)}</option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )
    }
    // matching: a dropdown of the right-side options for each left item
    if (type === 'matching_question') {
      const matches = q.matches ?? []
      const cur = asRecord()
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {answers.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <CanvasHtml html={a.html || a.text} style={{ fontSize: 13.5 }} />
              </div>
              <Icon name="arrowR" size={14} style={{ color: 'var(--text-3)', flex: '0 0 auto' }} />
              <select
                value={cur[String(a.id)] ?? ''}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange({ ...cur, [String(a.id)]: e.target.value })}
                style={{ ...selectStyle, maxWidth: 280 }}
              >
                <option value="">Match…</option>
                {matches.map((m) => (
                  <option key={m.match_id} value={String(m.match_id)}>{plainText(m.text)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )
    }
    if (type === 'essay_question') {
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          placeholder="Write your response…"
          style={{ width: '100%', minHeight: 150, padding: 14, borderRadius: 'var(--r-md)', background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 14, lineHeight: 1.6, resize: 'vertical', outline: 'none', fontFamily: 'var(--font)' }}
        />
      )
    }
    // file-upload: Pylon can't attach a file through the quiz API — be honest and
    // tell the student to do this one in Canvas. The rest of the quiz still submits.
    if (type === 'file_upload_question') {
      return (
        <Note icon="external" tone="warn">
          This question needs a file upload, which Pylon can’t do here — open the quiz in Canvas to attach your
          file. Submitting from Pylon will leave this one blank, but your other answers go through.
        </Note>
      )
    }
    // unsupported type — degrade gracefully (read-only + note)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {answers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: 0.7 }}>
            {answers.map((ans) => (
              <div key={ans.id} style={{ padding: '9px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <CanvasHtml html={ans.html || ans.text} style={{ fontSize: 13 }} />
              </div>
            ))}
          </div>
        )}
        <Note icon="info" tone="warn">
          Pylon can’t answer “{prettyQType(type)}” questions yet — finish this one in Canvas. It’ll be left blank on submit.
        </Note>
      </div>
    )
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <div className="mono" style={{ width: 28, height: 28, flex: '0 0 auto', borderRadius: 99, display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)', fontSize: 12.5, fontWeight: 700 }}>
          {index}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <StatusBadge tone="neutral">{prettyQType(type)}</StatusBadge>
            {q.points_possible !== undefined ? <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{q.points_possible} pts</span> : null}
          </div>
          <CanvasHtml html={q.question_text} style={{ marginBottom: 14 }} />
          {renderInputs()}
        </div>
      </div>
    </Card>
  )
}

function Choice({ on, type, onClick, children }: { on: boolean; type: 'radio' | 'check'; onClick: () => void; children: JSX.Element }): JSX.Element {
  return (
    <button
      className="tap"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 11,
        textAlign: 'left',
        padding: '11px 14px',
        borderRadius: 'var(--r-md)',
        background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
        border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`,
        width: '100%'
      }}
    >
      <span
        style={{
          width: 19,
          height: 19,
          flex: '0 0 auto',
          marginTop: 1,
          borderRadius: type === 'radio' ? 99 : 6,
          border: `2px solid ${on ? 'var(--accent)' : 'var(--border-2)'}`,
          background: on ? 'var(--accent)' : 'transparent',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--accent-ink)'
        }}
      >
        {on && <Icon name="check" size={12} stroke={3} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </button>
  )
}

function prettyQType(t: string): string {
  return (
    {
      multiple_choice_question: 'Multiple choice',
      true_false_question: 'True / false',
      short_answer_question: 'Short answer',
      essay_question: 'Essay',
      multiple_answers_question: 'Select all',
      numerical_question: 'Numerical',
      fill_in_multiple_blanks_question: 'Fill in the blanks',
      matching_question: 'Matching',
      multiple_dropdowns_question: 'Dropdowns',
      file_upload_question: 'File upload',
      text_only_question: 'Text'
    }[t] ?? t.replace(/_question$/, '').replace(/_/g, ' ')
  )
}

/**
 * Encode one answer into Canvas's urlencoded `complete` body. Canvas accepts
 * `quiz_questions[][id]` + `quiz_questions[][answer]` repeated; for the single
 * call we use indexed keys. Multiple-answers send an array of answer ids; short
 * answer/essay send text; choice/true-false send the chosen answer id.
 */
function encodeAnswer(fields: Record<string, string>, q: CanvasQuizQuestion, a: AnswerValue | undefined): void {
  if (a === undefined) return
  const id = q.id
  const idx = Object.keys(fields).filter((k) => k.startsWith('quiz_questions[') && k.endsWith('[id]')).length
  const base = `quiz_questions[${idx}]`
  // select-all → repeated answer ids
  if (Array.isArray(a)) {
    if (a.length === 0) return
    fields[`${base}[id]`] = String(id)
    a.forEach((v, j) => {
      fields[`${base}[answer][${j}]`] = v
    })
    return
  }
  // fill-in-blanks / dropdowns / matching → answer keyed by blank_id or answer_id
  if (typeof a === 'object') {
    const entries = Object.entries(a).filter(([, v]) => v != null && String(v).trim() !== '')
    if (entries.length === 0) return
    fields[`${base}[id]`] = String(id)
    for (const [k, v] of entries) fields[`${base}[answer][${k}]`] = String(v)
    return
  }
  // scalar (choice / true-false / short answer / essay / numerical)
  const text = a.trim()
  if (!text) return
  fields[`${base}[id]`] = String(id)
  fields[`${base}[answer]`] = text
}
