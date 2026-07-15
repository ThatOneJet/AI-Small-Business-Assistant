/**
 * JetCore DevBay — GitHub integration (MAIN PROCESS ONLY).
 *
 * The user supplies a GitHub token (fine-grained or classic with repo scope),
 * stored ENCRYPTED in the vault (devbay.github). All GitHub API calls happen here
 * in main; the token never reaches the renderer. DevBay makes scattered repos
 * legible (portfolio + staleness) and automates the shipping ceremony (draft a
 * release/tag).
 */
import { vaultGet, vaultSet, isUnlocked } from '@main/vault'
import type {
  DevBayStatusResult,
  DevBayData,
  DevBayRepo,
  DevBayReleaseResult,
  DevBayApiPayload,
  DevBayApiResult
} from '@shared/ipc'

const VAULT_KEY = 'devbay.github'
const API = 'https://api.github.com'

interface GhCreds {
  token: string
  login?: string
}

async function readCreds(): Promise<GhCreds | null> {
  if (!isUnlocked()) return null
  try {
    const raw = await vaultGet(VAULT_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as GhCreds
    return c.token ? c : null
  } catch {
    return null
  }
}

async function gh(token: string, path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    return await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {})
      },
      signal: ctrl.signal
    })
  } finally {
    clearTimeout(t)
  }
}

/** Parse the GitHub `Link` header `next` rel → path+query only. */
function ghNext(link: string | null): string | undefined {
  if (!link) return undefined
  const m = link.split(',').find((p) => /rel="next"/.test(p))
  const url = m?.match(/<([^>]+)>/)?.[1]
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.pathname + u.search
  } catch {
    return undefined
  }
}

/**
 * Generic authenticated GitHub proxy. Lets the DevBay renderer browse repo
 * contents / read files / list commits — anything on api.github.com — while the
 * token stays in main. `path` must be a GitHub API path ("/repos/…", "/user…").
 * `raw: true` returns the file's raw text (for the code/markdown viewer).
 */
export async function devbayApi(payload: DevBayApiPayload): Promise<DevBayApiResult> {
  const creds = await readCreds()
  if (!creds) return { ok: false, status: 0, error: 'GitHub is not connected.' }
  if (!payload.path.startsWith('/')) return { ok: false, status: 0, error: 'Invalid GitHub path.' }
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.token}`,
      Accept: payload.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
    if (payload.body != null) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${API}${payload.path}`, {
      method: payload.method ?? 'GET',
      headers,
      body: payload.body != null ? JSON.stringify(payload.body) : undefined,
      signal: ctrl.signal
    })
    const text = await res.text()
    let data: unknown = text
    if (!payload.raw) {
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      nextPath: ghNext(res.headers.get('link')),
      error: res.ok ? undefined : `GitHub error ${res.status}`
    }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'GitHub request failed.' }
  } finally {
    clearTimeout(t)
  }
}

export async function devbayConnect(token: string): Promise<DevBayStatusResult> {
  if (!isUnlocked()) return { connected: false, error: 'Sign in first.' }
  if (!token.trim()) return { connected: false, error: 'Paste your GitHub token.' }
  try {
    const res = await gh(token.trim(), '/user')
    if (res.status === 401) return { connected: false, error: 'GitHub rejected the token (401).' }
    if (!res.ok) return { connected: false, error: `GitHub error ${res.status}` }
    const me = (await res.json()) as { login?: string }
    await vaultSet(VAULT_KEY, JSON.stringify({ token: token.trim(), login: me?.login }))
    return { connected: true, login: me?.login }
  } catch {
    return { connected: false, error: 'Could not reach GitHub.' }
  }
}

export async function devbayStatus(): Promise<DevBayStatusResult> {
  const c = await readCreds()
  return c ? { connected: true, login: c.login } : { connected: false }
}

export async function devbayDisconnect(): Promise<void> {
  if (!isUnlocked()) return
  try {
    await vaultSet(VAULT_KEY, JSON.stringify({ token: '' }))
  } catch {
    /* ignore */
  }
}

export async function devbayFetch(): Promise<DevBayData> {
  const creds = await readCreds()
  if (!creds) return { connected: false, login: undefined, repos: [] }
  try {
    const res = await gh(
      creds.token,
      '/user/repos?affiliation=owner,collaborator&sort=pushed&per_page=40'
    )
    if (!res.ok) return { connected: true, login: creds.login, repos: [], error: `GitHub error ${res.status}` }
    const raw = (await res.json()) as Array<{
      name: string
      full_name: string
      private: boolean
      html_url: string
      description: string | null
      language: string | null
      pushed_at: string
      stargazers_count: number
      open_issues_count: number
      default_branch: string
      fork: boolean
    }>
    const repos: DevBayRepo[] = (raw || []).map((r) => ({
      name: r.name,
      fullName: r.full_name,
      private: r.private,
      url: r.html_url,
      description: r.description,
      language: r.language,
      pushedAt: r.pushed_at,
      stars: r.stargazers_count,
      openIssues: r.open_issues_count,
      defaultBranch: r.default_branch,
      fork: r.fork
    }))
    return { connected: true, login: creds.login, repos }
  } catch {
    return { connected: true, login: creds.login, repos: [], error: 'Fetch failed.' }
  }
}

/** Draft a release (and its tag) on a repo — the shipping ceremony, automated. */
export async function devbayDraftRelease(
  fullName: string,
  tag: string,
  name: string,
  body: string
): Promise<DevBayReleaseResult> {
  const creds = await readCreds()
  if (!creds) return { ok: false, error: 'Not connected.' }
  if (!/^[^/]+\/[^/]+$/.test(fullName)) return { ok: false, error: 'Bad repo.' }
  if (!tag.trim()) return { ok: false, error: 'A tag is required.' }
  try {
    const res = await gh(creds.token, `/repos/${fullName}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag.trim(),
        name: name.trim() || tag.trim(),
        body: body || '',
        draft: true,
        generate_release_notes: !body
      })
    })
    if (res.status === 403) return { ok: false, error: 'Token lacks release/contents write permission.' }
    if (!res.ok) return { ok: false, error: `GitHub error ${res.status}` }
    const rel = (await res.json()) as { html_url?: string }
    return { ok: true, url: rel.html_url }
  } catch {
    return { ok: false, error: 'Could not create the release.' }
  }
}
