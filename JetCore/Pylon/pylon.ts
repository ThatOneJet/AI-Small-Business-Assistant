/**
 * JetCore Pylon — Canvas integration (MAIN PROCESS ONLY).
 *
 * Students mint a personal access token in Canvas (Account → Settings → New
 * access token). We store {baseUrl, token} ENCRYPTED in the E2EE vault
 * (pylon.canvas) and do all Canvas API calls here in main — the token never
 * reaches the renderer. Pylon stores little: just the token + whatever the
 * dashboard needs is fetched live.
 */
import { vaultGet, vaultSet, isUnlocked } from '@main/vault'
import type {
  PylonStatusResult,
  PylonCourse,
  PylonAssignment,
  PylonData,
  PylonApiPayload,
  PylonApiResult
} from '@shared/ipc'

const VAULT_KEY = 'pylon.canvas'

interface CanvasCreds {
  baseUrl: string
  token: string
}

/** Normalize a Canvas host into an https origin (no trailing slash / path). */
function normalizeBase(raw: string): string {
  let s = (raw || '').trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try {
    return new URL(s).origin
  } catch {
    return ''
  }
}

async function readCreds(): Promise<CanvasCreds | null> {
  if (!isUnlocked()) return null
  try {
    const raw = await vaultGet(VAULT_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CanvasCreds
    return c.baseUrl && c.token ? c : null
  } catch {
    return null
  }
}

/** Canvas GET with auth + timeout, returning parsed JSON (throws on HTTP error). */
async function canvasGet(creds: CanvasCreds, path: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`${creds.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${creds.token}`, Accept: 'application/json' },
      signal: ctrl.signal
    })
    if (res.status === 401) throw new Error('Canvas rejected the token (401). Mint a new one.')
    if (!res.ok) throw new Error(`Canvas error ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/** Parse the `next` link from a Canvas `Link` header → just the path+query. */
function nextFromLink(link: string | null, base: string): string | undefined {
  if (!link) return undefined
  const m = link.split(',').find((p) => /rel="next"/.test(p))
  if (!m) return undefined
  const url = m.match(/<([^>]+)>/)?.[1]
  if (!url) return undefined
  try {
    const u = new URL(url)
    return url.startsWith(base) ? u.pathname + u.search : url
  } catch {
    return url
  }
}

/**
 * Generic authenticated Canvas proxy. Lets the Pylon renderer drive ANY Canvas
 * endpoint (assignments, quizzes, pages, modules, files, submissions) while the
 * token stays here in main. `path` MUST be a Canvas API path ("/api/v1/…"). Use
 * `form` for Canvas's urlencoded write bodies, `body` for JSON.
 */
export async function pylonApi(payload: PylonApiPayload): Promise<PylonApiResult> {
  const creds = await readCreds()
  if (!creds) return { ok: false, status: 0, error: 'Canvas is not connected.' }
  // Only allow Canvas API paths on the configured host (no SSRF to arbitrary URLs).
  if (!payload.path.startsWith('/api/')) return { ok: false, status: 0, error: 'Invalid Canvas path.' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${creds.token}`, Accept: 'application/json' }
    let bodyInit: string | undefined
    if (payload.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      bodyInit = new URLSearchParams(payload.form).toString()
    } else if (payload.body != null) {
      headers['Content-Type'] = 'application/json'
      bodyInit = JSON.stringify(payload.body)
    }
    const res = await fetch(`${creds.baseUrl}${payload.path}`, {
      method: payload.method ?? 'GET',
      headers,
      body: bodyInit,
      signal: ctrl.signal
    })
    const text = await res.text()
    let data: unknown
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      nextPath: nextFromLink(res.headers.get('link'), creds.baseUrl),
      error: res.ok ? undefined : `Canvas error ${res.status}`
    }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Canvas request failed.' }
  } finally {
    clearTimeout(t)
  }
}

/** Verify a token and, on success, save the encrypted creds. */
export async function pylonConnect(baseUrlRaw: string, token: string): Promise<PylonStatusResult> {
  if (!isUnlocked()) return { connected: false, error: 'Sign in first.' }
  const baseUrl = normalizeBase(baseUrlRaw)
  if (!baseUrl) return { connected: false, error: 'Enter your Canvas URL (e.g. school.instructure.com).' }
  if (!token.trim()) return { connected: false, error: 'Paste your Canvas access token.' }
  const creds: CanvasCreds = { baseUrl, token: token.trim() }
  try {
    const me = (await canvasGet(creds, '/api/v1/users/self')) as { name?: string }
    await vaultSet(VAULT_KEY, JSON.stringify(creds))
    return { connected: true, baseUrl, name: me?.name }
  } catch (err) {
    return { connected: false, error: err instanceof Error ? err.message : 'Could not reach Canvas.' }
  }
}

export async function pylonStatus(): Promise<PylonStatusResult> {
  const c = await readCreds()
  return c ? { connected: true, baseUrl: c.baseUrl } : { connected: false }
}

export async function pylonDisconnect(): Promise<void> {
  if (!isUnlocked()) return
  try {
    await vaultSet(VAULT_KEY, JSON.stringify({ baseUrl: '', token: '' }))
  } catch {
    /* ignore */
  }
}

/** Pull a legible snapshot: active courses + current grades + upcoming work. */
export async function pylonFetch(): Promise<PylonData> {
  const creds = await readCreds()
  if (!creds) return { connected: false, courses: [], upcoming: [] }
  try {
    // Active courses with current scores.
    const rawCourses = (await canvasGet(
      creds,
      '/api/v1/courses?enrollment_state=active&include[]=total_scores&per_page=60'
    )) as Array<{
      id: number
      name?: string
      enrollments?: Array<{ computed_current_score?: number | null; computed_current_grade?: string | null; type?: string }>
    }>
    const courses: PylonCourse[] = (rawCourses || [])
      .filter((c) => c && c.id && c.name)
      .map((c) => {
        const en = (c.enrollments || []).find((e) => e.type === 'student') || c.enrollments?.[0]
        return {
          id: c.id,
          name: c.name as string,
          score: en?.computed_current_score ?? null,
          grade: en?.computed_current_grade ?? null
        }
      })
    const courseName = new Map(courses.map((c) => [c.id, c.name]))

    // Upcoming work via the planner (one call instead of per-course).
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    let upcoming: PylonAssignment[] = []
    try {
      const items = (await canvasGet(
        creds,
        `/api/v1/planner/items?start_date=${encodeURIComponent(start.toISOString())}&per_page=50`
      )) as Array<{
        plannable_id?: number
        course_id?: number
        plannable_type?: string
        plannable_date?: string
        submissions?: { submitted?: boolean } | boolean
        plannable?: { title?: string; due_at?: string; points_possible?: number | null }
      }>
      upcoming = (items || [])
        .filter((it) => it.plannable_type === 'assignment' || it.plannable_type === 'quiz')
        .map((it) => ({
          id: String(it.plannable_id ?? Math.random()),
          title: it.plannable?.title ?? 'Untitled',
          courseName: (it.course_id && courseName.get(it.course_id)) || 'Canvas',
          dueAt: it.plannable?.due_at ?? it.plannable_date ?? null,
          points: it.plannable?.points_possible ?? null,
          submitted: typeof it.submissions === 'object' ? !!it.submissions?.submitted : !!it.submissions
        }))
        .filter((a) => !a.submitted)
        .sort((a, b) => (a.dueAt || '9').localeCompare(b.dueAt || '9'))
        .slice(0, 25)
    } catch {
      /* planner may be unavailable on some Canvas configs — courses still show */
    }

    return { connected: true, courses, upcoming }
  } catch (err) {
    return { connected: true, courses: [], upcoming: [], error: err instanceof Error ? err.message : 'Fetch failed.' }
  }
}
