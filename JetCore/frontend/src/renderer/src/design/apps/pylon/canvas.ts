/**
 * Pylon — Canvas client helpers.
 *
 * A thin, TYPED layer over `window.decks.pylon.api` (the authenticated Canvas
 * proxy — the token stays in main). Everything the rest of Pylon reads from
 * Canvas flows through here so the `unknown` → typed cast happens exactly once,
 * and pagination + lightweight HTML sanitisation live in one place.
 */
import type { PylonApiPayload, PylonApiResult } from '@shared/ipc'

/* ── the proxy call ──────────────────────────────────────────────────── */

/** A typed error carrying the HTTP status, thrown on a non-ok Canvas reply. */
export class CanvasError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CanvasError'
    this.status = status
  }
}

/** Friendly message for a failed Canvas reply (Canvas often returns {errors}). */
function messageFor(res: PylonApiResult): string {
  if (res.error) return res.error
  const d = res.data as { errors?: unknown; message?: string } | undefined
  if (d && typeof d.message === 'string' && d.message) return d.message
  if (d && Array.isArray(d.errors) && d.errors.length > 0) {
    const first = d.errors[0] as { message?: string } | string
    if (typeof first === 'string') return first
    if (first?.message) return first.message
  }
  if (d && d.errors && typeof d.errors === 'object') {
    // Canvas urlencoded-write errors: { errors: { field: [{ message }] } }
    const groups = Object.values(d.errors as Record<string, unknown>)
    for (const g of groups) {
      if (Array.isArray(g) && g[0] && typeof g[0] === 'object') {
        const m = (g[0] as { message?: string }).message
        if (m) return m
      }
    }
  }
  return res.status === 401
    ? 'Canvas rejected the request (your token may have expired).'
    : res.status === 403
      ? 'Canvas refused this request (you may not have access).'
      : res.status === 404
        ? 'Canvas couldn’t find that.'
        : `Canvas returned an error (${res.status}).`
}

/** One raw Canvas call. Throws CanvasError on a non-ok reply. Returns the
 *  full result so callers that need `nextPath` (pagination) can read it. */
export async function call(payload: PylonApiPayload): Promise<PylonApiResult> {
  const res = await window.decks.pylon.api(payload)
  if (!res.ok) throw new CanvasError(messageFor(res), res.status)
  return res
}

/** A GET that returns its typed `data` (single object or one page of a list). */
export async function get<T>(path: string): Promise<T> {
  const res = await call({ path, method: 'GET' })
  return res.data as T
}

/**
 * GET every page of a paginated Canvas list endpoint, following `nextPath`
 * (the Link header surfaced by the proxy). Caps at `maxPages` so a runaway
 * paginator can't spin forever.
 */
export async function paginate<T>(path: string, maxPages = 25): Promise<T[]> {
  const out: T[] = []
  let next: string | undefined = path
  let pages = 0
  while (next && pages < maxPages) {
    const res: PylonApiResult = await call({ path: next, method: 'GET' })
    const chunk = res.data
    if (Array.isArray(chunk)) out.push(...(chunk as T[]))
    next = res.nextPath
    pages += 1
  }
  return out
}

/** A urlencoded write (Canvas submissions / quiz answers). Returns typed data. */
export async function form<T>(
  path: string,
  fields: Record<string, string>,
  method: 'POST' | 'PUT' = 'POST'
): Promise<T> {
  const res = await call({ path, method, form: fields })
  return res.data as T
}

/* ── HTML sanitisation (sanitizeHtml-lite) ───────────────────────────── */

/**
 * Normalise a Canvas-embedded media `src` to an https embed URL, mapping the
 * common video hosts (YouTube / Vimeo / generic players / Canvas Studio aka
 * instructuremedia) to their proper `/embed` form so the iframe actually
 * renders. Returns null when the URL is unsafe (javascript:/data:) or empty.
 */
function normalizeEmbedSrc(raw: string): string | null {
  let src = raw.trim()
  if (!src) return null
  // never allow script/data URLs through as an embed source
  if (/^\s*(javascript|data|vbscript):/i.test(src)) return null
  // protocol-relative → https
  if (src.startsWith('//')) src = `https:${src}`
  // force http→https so embeds aren't blocked as mixed content
  if (src.startsWith('http://')) src = `https://${src.slice('http://'.length)}`

  // YouTube watch / share / shorts → privacy-friendly embed
  let m = src.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i)
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`

  // Vimeo → player embed
  m = src.match(/vimeo\.com\/(?:video\/)?(\d+)/i)
  if (m) return `https://player.vimeo.com/video/${m[1]}`

  // already an embeddable host (Vimeo player, Canvas Studio / instructuremedia,
  // generic *.players, Canvas LTI external_tools embeds) → pass through as https
  return src
}

/**
 * Strip the dangerous bits out of Canvas-authored HTML before it's dropped
 * into a `.canvas-html` container via dangerouslySetInnerHTML. This is the
 * user's OWN course content, so the goal is defence-in-depth (no <script>, no
 * inline event handlers, no javascript: URLs), not a hostile-input scrubber.
 *
 * We deliberately let media through: <iframe> (YouTube/Vimeo/Canvas Studio
 * video embeds), <video> and <audio>. Each iframe/video is wrapped in a
 * responsive 16:9 frame (.canvas-embed) and sandboxed; inline light/hardcoded
 * background+text colours that Canvas authors bake in are neutralised so the
 * content stays readable on the app's dark surface.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return ''
  let s = String(html)
  // remove script/style and the legacy plugin embed tags (object/embed) +
  // their contents — but iframe/video/audio are now allowed through below.
  s = s.replace(/<\s*(script|style|object|embed)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  s = s.replace(/<\s*(script|style|object|embed|link|meta)\b[^>]*>/gi, '')
  // strip inline event handlers (onclick=, onerror=, …)
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
  // drop any leftover srcdoc (would let an iframe carry its own markup/scripts)
  s = s.replace(/\ssrcdoc\s*=\s*"[^"]*"/gi, '')
  s = s.replace(/\ssrcdoc\s*=\s*'[^']*'/gi, '')
  // neutralise javascript: / data: (script) URLs in href/src
  s = s.replace(/(href|src)\s*=\s*"(\s*javascript:[^"]*)"/gi, '$1="#"')
  s = s.replace(/(href|src)\s*=\s*'(\s*javascript:[^']*)'/gi, "$1='#'")

  // ── media: normalise + sandbox iframes, wrap iframe/video in a 16:9 frame ─
  // Canvas emits paired <iframe …></iframe>; drop the (empty) close tags first
  // so our self-built <iframe></iframe> wrapper doesn't leave a stray </iframe>.
  s = s.replace(/<\/iframe\s*>/gi, '')
  s = s.replace(/<iframe\b([^>]*)>/gi, (_full, attrs: string) => {
    const srcM = attrs.match(/\ssrc\s*=\s*["']([^"']*)["']/i)
    const embed = srcM ? normalizeEmbedSrc(srcM[1]) : null
    if (!embed) return '' // no usable source → drop it (was a blank white box)
    const titleM = attrs.match(/\stitle\s*=\s*("[^"]*"|'[^']*')/i)
    const title = titleM ? ` title=${titleM[1]}` : ' title="Embedded media"'
    return (
      `<div class="canvas-embed"><iframe src="${embed}"${title}` +
      ' loading="lazy" referrerpolicy="strict-origin-when-cross-origin"' +
      ' sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"' +
      ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"' +
      ' allowfullscreen></iframe></div>'
    )
  })
  // <video> → wrap in the same responsive frame; keep controls, drop autoplay
  s = s.replace(/<video\b([^>]*)>/gi, (_full, attrs: string) => {
    let a = attrs.replace(/\sautoplay(\s*=\s*("[^"]*"|'[^']*'|\S+))?/gi, '')
    if (!/\scontrols\b/i.test(a)) a += ' controls'
    return `<div class="canvas-embed canvas-embed--video"><video${a} playsinline>`
  })
  s = s.replace(/<\/video\s*>/gi, '</video></div>')

  // ── dark-mode: neutralise inline light backgrounds + hardcoded text colours
  // that Canvas authors bake in (white callouts, black text) so content
  // inherits the app's --text on a transparent surface. Images/iframes/videos
  // keep their styles (we only touch text containers).
  s = neutraliseInlineColours(s)
  return s
}

/**
 * Remove the `background` / `background-color` / `color` declarations from
 * inline `style="…"` attributes on Canvas content so a hardcoded white box +
 * black text doesn't render as an unreadable blank slab on the dark surface.
 * We leave width/height/margin/etc. alone, and never touch media tags.
 */
function neutraliseInlineColours(html: string): string {
  return html.replace(/<([a-z][\w-]*)\b([^>]*?)\sstyle\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>/gi, (full, tag: string, pre: string, _q: string, dq: string, sq: string, post: string) => {
    const lowerTag = tag.toLowerCase()
    // don't strip colour off media — let video/iframe/img keep their sizing
    if (lowerTag === 'iframe' || lowerTag === 'video' || lowerTag === 'audio' || lowerTag === 'img' || lowerTag === 'source') {
      return full
    }
    const decls = (dq ?? sq ?? '').split(';')
    const kept = decls
      .map((d) => d.trim())
      .filter((d) => d.length > 0)
      .filter((d) => {
        const prop = d.split(':')[0].trim().toLowerCase()
        return prop !== 'background' && prop !== 'background-color' && prop !== 'color'
      })
    const style = kept.join('; ')
    return style ? `<${tag}${pre} style="${style}"${post}>` : `<${tag}${pre}${post}>`
  })
}

/** True when sanitised HTML actually carries something to render — text, an
 *  image, or embedded media (video iframe / <video> / <audio>). */
export function hasHtml(html: string | null | undefined): boolean {
  const clean = sanitizeHtml(html)
  return clean.replace(/<[^>]*>/g, '').trim().length > 0 || /<(img|iframe|video|audio)\b/i.test(clean)
}

/* ── the .canvas-html reader stylesheet (injected once) ──────────────── */

const CANVAS_HTML_CSS = `
.canvas-html { color: var(--text-2); font-size: 14.5px; line-height: 1.7; word-break: break-word; }
.canvas-html > *:first-child { margin-top: 0 !important; }
.canvas-html > *:last-child { margin-bottom: 0 !important; }
.canvas-html h1, .canvas-html h2, .canvas-html h3, .canvas-html h4 { color: var(--text); font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; margin: 1.4em 0 0.5em; }
.canvas-html h1 { font-size: 1.5em; } .canvas-html h2 { font-size: 1.3em; } .canvas-html h3 { font-size: 1.12em; } .canvas-html h4 { font-size: 1em; }
.canvas-html p { margin: 0 0 0.9em; }
.canvas-html a { color: var(--accent-h); text-decoration: underline; text-underline-offset: 2px; }
.canvas-html ul, .canvas-html ol { margin: 0 0 1em; padding-left: 1.5em; }
.canvas-html li { margin: 0.25em 0; }
.canvas-html img { max-width: 100%; height: auto; border-radius: var(--r-sm); margin: 0.5em 0; }
.canvas-html pre { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-sm); padding: 14px; overflow-x: auto; font-family: var(--mono); font-size: 13px; line-height: 1.5; margin: 0 0 1em; }
.canvas-html code { background: var(--surface-2); border-radius: 5px; padding: 1px 5px; font-family: var(--mono); font-size: 0.9em; }
.canvas-html pre code { background: none; padding: 0; }
.canvas-html blockquote { margin: 0 0 1em; padding: 4px 0 4px 16px; border-left: 3px solid var(--accent-line); color: var(--text-3); }
.canvas-html table { border-collapse: collapse; width: 100%; margin: 0 0 1em; font-size: 13.5px; display: block; overflow-x: auto; background: transparent; }
.canvas-html th, .canvas-html td { border: 1px solid var(--border); padding: 8px 11px; text-align: left; color: var(--text-2); }
.canvas-html th { background: var(--surface-2); font-weight: 600; color: var(--text); }
.canvas-html hr { border: none; border-top: 1px solid var(--border); margin: 1.4em 0; }
.canvas-html strong, .canvas-html b { color: var(--text); font-weight: 700; }
/* ── embedded media (video iframes + <video>) — responsive 16:9 frame ── */
.canvas-html .canvas-embed { position: relative; width: 100%; aspect-ratio: 16 / 9; margin: 1em 0; border-radius: var(--r-md); overflow: hidden; border: 1px solid var(--line); background: #000; }
.canvas-html .canvas-embed iframe,
.canvas-html .canvas-embed video { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
.canvas-html .canvas-embed--video { background: #000; }
/* a bare iframe that escaped the wrapper still stays contained + readable */
.canvas-html > iframe, .canvas-html p > iframe { max-width: 100%; aspect-ratio: 16 / 9; width: 100%; height: auto; border: 1px solid var(--line); border-radius: var(--r-md); }
.canvas-html audio { width: 100%; margin: 0.75em 0; }
/* ── dark-mode safety net: drop authored light slabs that slip past the
   inline-style scrub (e.g. bg set via a class/attribute), keep content
   readable. Media (iframe/video/audio/img) and the embed frame are exempt. ── */
.canvas-html :is(td, th, table, blockquote, div, p, span, section, article, ul, ol, li)[style*="background"],
.canvas-html [bgcolor] { background: transparent !important; }
.canvas-html :is(td, th, table, blockquote, div, p, span, section, article, ul, ol, li)[style*="background"] { color: var(--text-2) !important; }
.canvas-html font[color] { color: inherit !important; }
.canvas-html .canvas-embed { background: #000 !important; }
`

let cssInjected = false
/** Inject the `.canvas-html` reader stylesheet into <head> exactly once. */
export function ensureCanvasHtmlStyles(): void {
  if (cssInjected || typeof document === 'undefined') return
  cssInjected = true
  const el = document.createElement('style')
  el.setAttribute('data-pylon', 'canvas-html')
  el.textContent = CANVAS_HTML_CSS
  document.head.appendChild(el)
}

/* ── Canvas response shapes (only the fields Pylon reads) ─────────────── */

export interface CanvasSubmissionLite {
  id?: number
  workflow_state?: string // 'submitted' | 'graded' | 'unsubmitted' | 'pending_review'
  submitted_at?: string | null
  score?: number | null
  grade?: string | null
  late?: boolean
  missing?: boolean
  excused?: boolean
  attempt?: number | null
  body?: string | null
  url?: string | null
  preview_url?: string | null
}

export interface CanvasAssignment {
  id: number
  name: string
  description?: string | null
  due_at?: string | null
  points_possible?: number | null
  html_url?: string
  submission_types?: string[]
  has_submitted_submissions?: boolean
  locked_for_user?: boolean
  allowed_extensions?: string[]
  quiz_id?: number | null
  submission?: CanvasSubmissionLite | null
}

export interface CanvasSubmissionResult extends CanvasSubmissionLite {
  assignment_id?: number
}

export interface CanvasQuiz {
  id: number
  title: string
  description?: string | null
  quiz_type?: string // 'practice_quiz' | 'assignment' | 'graded_survey' | 'survey'
  due_at?: string | null
  points_possible?: number | null
  question_count?: number
  allowed_attempts?: number // -1 = unlimited
  time_limit?: number | null // minutes
  html_url?: string
  locked_for_user?: boolean
  has_access_code?: boolean
}

export interface CanvasQuizSubmission {
  id: number
  quiz_id: number
  attempt: number
  workflow_state?: string // 'untaken' | 'pending_review' | 'complete' | 'settings_only'
  validation_token?: string
  score?: number | null
  kept_score?: number | null
  started_at?: string | null
  finished_at?: string | null
  end_at?: string | null
  time_limit?: number | null
}

export interface CanvasQuizAnswer {
  id: number
  text?: string
  html?: string
  /** fill-in-multiple-blanks / multiple-dropdowns: which blank this option belongs to. */
  blank_id?: string
  /** matching: the correct right-side match id for this left item (we don't use it
   *  to answer, only the student's pick matters — but it's on the payload). */
  match_id?: number
}

/** matching_question right-side options the student chooses from. */
export interface CanvasQuizMatch {
  match_id: number
  text: string
}

export interface CanvasQuizQuestion {
  id: number
  quiz_id?: number
  position?: number
  question_name?: string
  question_type: string // multiple_choice_question | true_false_question | short_answer_question | essay_question | multiple_answers_question | fill_in_multiple_blanks_question | multiple_dropdowns_question | matching_question | numerical_question | calculated_question | …
  question_text?: string
  points_possible?: number
  answers?: CanvasQuizAnswer[]
  /** matching_question: the right-side options. */
  matches?: CanvasQuizMatch[]
}

export interface CanvasModuleItem {
  id: number
  title: string
  type: string // 'Assignment' | 'Quiz' | 'Page' | 'File' | 'Discussion' | 'SubHeader' | 'ExternalUrl' | …
  html_url?: string
  url?: string // API url (e.g. page)
  external_url?: string
  content_id?: number
  page_url?: string
  indent?: number
  completion_requirement?: { type?: string; completed?: boolean } | null
}

export interface CanvasModule {
  id: number
  name: string
  position?: number
  state?: string // 'locked' | 'unlocked' | 'started' | 'completed'
  items_count?: number
  items?: CanvasModuleItem[]
}

export interface CanvasPageSummary {
  page_id?: number
  url: string // the page_url slug
  title: string
  updated_at?: string
  front_page?: boolean
  published?: boolean
}

export interface CanvasPage extends CanvasPageSummary {
  body?: string | null
}

export interface CanvasFile {
  id: number
  display_name: string
  filename?: string
  'content-type'?: string
  size?: number
  url: string
  updated_at?: string
  folder_id?: number
}

export interface CanvasAnnouncement {
  id: number
  title: string
  message?: string | null
  posted_at?: string | null
  author?: { display_name?: string } | null
  html_url?: string
}

/* ── small formatters shared across views ────────────────────────────── */

/** Days until an ISO due date (fractional, negative = past). null = no date. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (t - Date.now()) / 86400000
}

/** Human-friendly absolute date ("Mar 4, 11:59 PM"). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'No due date'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'No due date'
  return new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** Human-friendly file size. */
export function fmtBytes(n: number | undefined): string {
  if (!n || n <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export type DueTone = 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'
export interface DueMeta {
  tone: DueTone
  label: string
}

/** Urgency coloring for a due date (shared with the dashboard's grouping). */
export function dueMeta(iso: string | null | undefined): DueMeta {
  const d = daysUntil(iso)
  if (d === null) return { tone: 'neutral', label: 'No due date' }
  if (d < 0) return { tone: 'neg', label: 'Past due' }
  if (d < 1) return { tone: 'neg', label: `${Math.max(1, Math.round(d * 24))}h left` }
  if (d <= 3) return { tone: 'warn', label: `${Math.max(1, Math.round(d))}d left` }
  if (d <= 14) return { tone: 'accent', label: `${Math.round(d)}d left` }
  return { tone: 'neutral', label: fmtDate(iso) }
}

/** Map a Canvas submission to a status badge (tone + label + optional score). */
export interface SubmissionStatus {
  tone: DueTone
  label: string
}
export function submissionStatus(
  sub: CanvasSubmissionLite | null | undefined,
  points: number | null | undefined
): SubmissionStatus {
  if (!sub) return { tone: 'neutral', label: 'Not submitted' }
  if (sub.excused) return { tone: 'accent', label: 'Excused' }
  const ws = sub.workflow_state
  if (ws === 'graded' && sub.score !== null && sub.score !== undefined) {
    const out = points ? ` / ${points}` : ''
    return { tone: 'pos', label: `Graded · ${sub.score}${out}` }
  }
  if (ws === 'graded') return { tone: 'pos', label: 'Graded' }
  if (ws === 'pending_review' || ws === 'submitted') return { tone: 'accent', label: sub.late ? 'Submitted · late' : 'Submitted' }
  if (sub.missing) return { tone: 'neg', label: 'Missing' }
  return { tone: 'neutral', label: 'Not submitted' }
}

/** The icon that fits an assignment by its submission type / name. */
export function assignmentIcon(a: Pick<CanvasAssignment, 'submission_types' | 'name' | 'quiz_id'>): string {
  if (a.quiz_id || a.submission_types?.includes('online_quiz')) return 'target'
  if (/quiz|exam|test|midterm|final/i.test(a.name)) return 'target'
  if (a.submission_types?.includes('online_url')) return 'link'
  if (a.submission_types?.includes('online_upload')) return 'download'
  return 'book'
}
