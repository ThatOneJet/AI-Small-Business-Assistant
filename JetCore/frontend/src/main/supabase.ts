/**
 * Decks — Supabase client + auth (MAIN PROCESS ONLY).
 *
 * Supabase is BOTH the identity provider (email + password auth) AND the
 * ciphertext store (the `vault` table). It NEVER receives the master password
 * except as the auth login credential, and NEVER receives the derived key or any
 * plaintext user data. The client, tokens, and session live ONLY in main.
 *
 * - Uses the PUBLIC anon key from the repo-root .env (NEVER service_role).
 * - supabase-js in Node has no localStorage, so we provide a custom auth.storage
 *   adapter backed by the existing safeStorage-encrypted token file (tokens.ts),
 *   giving us persistSession across app restarts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import WebSocket from 'ws'
import { saveToken, getToken, removeToken } from './tokens'

/**
 * Read SUPABASE_URL / SUPABASE_ANON_KEY from the REPO ROOT .env. The Decks
 * project lives at <root>/Decks, so the .env is one directory up. We also probe
 * a couple of fallbacks (process.env, cwd) so dev + packaged builds both work.
 * Minimal hand parser — no dotenv dependency needed.
 */
function loadRootEnv(): { url: string; anonKey: string } {
  // Prefer real env vars if already present (e.g. CI / packaged launcher).
  let url = (process.env.SUPABASE_URL || '').trim()
  let anonKey = (process.env.SUPABASE_ANON_KEY || '').trim()
  if (url && anonKey) return { url, anonKey }

  // Candidate .env locations: packaged (bundled as an extraResource) first, then
  // dev (repo root one level up from Decks), then cwd fallbacks.
  const candidates = [
    join(process.resourcesPath || '', '.env'), // packaged: resources/.env (extraResource)
    join(app.getAppPath(), '..', '.env'), // dev: <root>/.env when app dir is <root>/Decks
    join(process.cwd(), '..', '.env'),
    join(process.cwd(), '.env')
  ]
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq < 0) continue
        const k = trimmed.slice(0, eq).trim()
        // Strip optional surrounding quotes from the value.
        const v = trimmed
          .slice(eq + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '')
        if (k === 'SUPABASE_URL' && !url) url = v
        else if (k === 'SUPABASE_ANON_KEY' && !anonKey) anonKey = v
      }
      if (url && anonKey) break
    } catch {
      /* try the next candidate */
    }
  }
  return { url, anonKey }
}

/**
 * supabase-js auth storage adapter backed by safeStorage (tokens.ts). The
 * session JSON (access/refresh tokens) is encrypted at rest by the OS keychain —
 * never written in plaintext, never exposed to the renderer.
 */
const SESSION_STORAGE_KEY = 'supabase:auth-session'
const authStorageAdapter = {
  getItem: (_key: string): string | null => getToken(SESSION_STORAGE_KEY),
  setItem: (_key: string, value: string): void => saveToken(SESSION_STORAGE_KEY, value),
  removeItem: (_key: string): void => removeToken(SESSION_STORAGE_KEY)
}

let client: SupabaseClient | null = null
let configured = false

/** True if .env provided both a URL and an anon key. */
export function isSupabaseConfigured(): boolean {
  getSupabase() // ensure init attempted
  return configured
}

/** Lazily create (once) and return the singleton Supabase client. */
export function getSupabase(): SupabaseClient {
  if (client) return client
  const { url, anonKey } = loadRootEnv()
  configured = Boolean(url && anonKey)
  if (!configured) {
    console.warn('[decks] Supabase not configured — SUPABASE_URL/ANON_KEY missing from .env')
  }
  // NOTE: anonKey is the PUBLIC publishable key. service_role is never used here.
  client = createClient(url || 'http://localhost', anonKey || 'anon', {
    auth: {
      // Persist + auto-refresh the session across restarts, via our encrypted
      // file adapter (no localStorage in Node).
      persistSession: true,
      autoRefreshToken: true,
      // We are not a browser; there is no URL fragment to parse on launch.
      detectSessionInUrl: false,
      storage: authStorageAdapter,
      storageKey: SESSION_STORAGE_KEY
    },
    // Electron's main process is Node 20 (no global WebSocket). supabase-js
    // ALWAYS constructs a realtime client at createClient time, which needs a
    // WebSocket ctor or it throws ("Node.js 20 detected without native WebSocket
    // support"). We don't use realtime — we just supply `ws` so init succeeds.
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket }
  })
  return client
}

/**
 * Supabase free-tier projects cold-start: the first request after idle can take
 * several seconds or transiently fail. Wrap a call with a short bounded retry so
 * a cold start is treated as "loading", not an error.
 */
export async function withColdStartRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 1500
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs))
    }
  }
  throw lastErr
}
