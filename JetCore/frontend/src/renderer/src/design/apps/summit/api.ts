/**
 * Summit — typed REST layer over the `window.decks.summit.api` bridge.
 *
 * Every interface below mirrors the EXACT JSON a route handler in
 * Summit/backend.py returns. Paths use the literal `:uid` segment — the main
 * process substitutes the signed-in user's id before the request hits Flask.
 *
 * GET responses are memoised in a module-level cache so each tab loads lazily
 * once and stays warm across tab switches; a sync or a manual retry clears it
 * via `clearSummitCache()`. The Flask backend cold-starts on the first call
 * (up to ~20s) — callers surface that through their loading states.
 */
import type { SummitApiResult } from '@shared/ipc'

/* ── Response shapes (1:1 with backend.py) ─────────────────────────────── */

/** GET /api/profit/<uid>?days=N */
export interface ProfitDay {
  date: string
  revenue: number
  labor: number
  profit: number
  margin_pct: number | null
}
export interface ProfitResponse {
  daily: ProfitDay[]
  summary: {
    total_revenue: number
    total_labor: number
    total_profit: number
    avg_margin_pct: number | null
    labor_pct: number | null
  }
}

/** GET /api/sales/<uid>?days=N */
export interface SalesRow {
  date: string | null
  hour: number | null
  item: string | null
  quantity_sold: number
  revenue: number
  source: string | null
  check_number: string | null
}
export interface SalesResponse {
  sales: SalesRow[]
  /** order_count = distinct check numbers (orders) in the imported sales. */
  summary: { total_revenue: number; record_count: number; order_count: number }
}

/** GET /api/tenders/<uid>?days=N */
export interface TenderRow {
  date: string | null
  tender_type: string
  amount: number
  transaction_count: number
  revenue_center: string | null
}
export interface TendersResponse {
  tenders: TenderRow[]
  by_type: Record<string, { amount: number; count: number }>
  summary: { total_amount: number; total_transactions: number }
}

/** GET /api/labor/<uid>?days=N (or ?period=ytd) */
export interface ShiftRow {
  id: number
  employee_name: string | null
  role: string | null
  department: string | null
  shift_date: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  actual_start: string | null
  actual_end: string | null
  scheduled_hours: number
  actual_hours: number
  hourly_rate: number
  labor_cost: number
  is_overtime: boolean
}
export interface LaborComparison {
  cost_pct: number | null
  hours_pct: number | null
  ot_pct: number | null
  prev_cost: number
  prev_hours: number
  prev_ot: number
  label: string
}
export interface LaborResponse {
  shifts: ShiftRow[]
  summary: {
    total_scheduled_hours: number
    total_actual_hours: number
    total_labor_cost: number
    overtime_shifts: number
    shift_count: number
    comparison: LaborComparison
  }
  chart_data: { labels: string[]; cost: number[]; hours: number[]; ot: number[] }
}

/** GET /api/labor/<uid>/insights?days=N */
export interface DowStat {
  dow: string
  avg_labor_cost: number
  avg_hours: number
  avg_revenue: number
  labor_pct: number | null
  occurrences: number
}
export interface LaborInsight {
  dow: string
  type: 'overstaffed' | 'understaffed'
  message: string
  labor_pct: number
}
export interface InsightsResponse {
  by_dow: DowStat[]
  insights: LaborInsight[]
  avg_labor_pct: number | null
}

/** GET /api/finances/<uid>?days=N */
export interface LargeTransaction {
  date: string
  amount: number
  description: string
}
export interface ImportantCost {
  name: string
  total: number
  count: number
}
export interface FinancesResponse {
  total_balance: number
  deposits: number
  large_transactions: LargeTransaction[]
  daily_deposits: Record<string, number>
  daily_sales: Record<string, number>
  important_costs: ImportantCost[]
}

/** GET /api/transactions/<uid>?days=N */
export interface TxnRow {
  id: number
  date: string
  description: string | null
  merchant_name: string | null
  logo_url: string | null
  institution_id: string | null
  amount: number
  is_deposit: boolean
  is_important: boolean
}
export interface TxnChartPoint {
  date: string
  income: number
  expenses: number
  balance: number
}
export interface TransactionsResponse {
  transactions: TxnRow[]
  chart_data: TxnChartPoint[]
  current_balance: number
  totals: { income: number; expenses: number; net: number }
}

/** GET /api/cashflow/<uid>?days=N */
export interface CashflowResponse {
  historical: { date: string; net: number }[]
  projection: { date: string; projected_balance: number }[]
  current_balance: number
  avg_daily_net: number
  avg_weekly_in: number
  avg_weekly_out: number
}

/** GET /api/credentials/<uid> */
export interface CredentialRow {
  id: number
  service: string
  config: Record<string, unknown>
  last_synced: string | null
  created_at: string
}

/** GET /api/accounts/<uid> (ConnectedAccount rows — incl. Plaid items) */
export interface ConnectedAccountRow {
  id: number
  service: string
  account_name: string | null
  institution_name: string | null
  external_id: string | null
  last_synced: string | null
  sync_frequency: string | null
  created_at: string
}

/** GET /api/recommendations/<uid> */
export interface RecommendationRow {
  id: number
  category: string | null
  title: string
  description: string | null
  monthly_savings: number
  implementation_difficulty: string | null
  ai_confidence: number | null
  is_implemented: boolean
  actual_savings: number | null
  created_at: string
}

/** GET /api/settings/<uid> */
export interface SettingsResponse {
  labor_threshold_pct: number
  alerts_enabled: boolean
}

/** GET /api/sync/progress/<service>/<uid> (and /api/sync/plaid/progress/<uid>) */
export interface SyncProgress {
  status: 'idle' | 'running' | 'done' | 'error'
  done?: number
  total?: number
  pct?: number
  eta_sec?: number | null
}

/** POST /api/sync/<service>/<uid> */
export interface SyncResultResponse {
  success?: boolean
  [key: string]: unknown
}

/* ── Transport + cache ──────────────────────────────────────────────────── */

export class SummitError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'SummitError'
    this.status = status
  }
}

async function call<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  let res: SummitApiResult
  try {
    res = await window.decks.summit.api({ path, method, body })
  } catch (e) {
    throw new SummitError(e instanceof Error ? e.message : 'Summit bridge unavailable', 0)
  }
  if (!res.ok) {
    let detail: string | undefined
    if (res.data && typeof res.data === 'object' && 'error' in (res.data as Record<string, unknown>)) {
      detail = String((res.data as Record<string, unknown>).error)
    }
    throw new SummitError(detail || res.error || `Request failed (${res.status || 'no response'})`, res.status)
  }
  return res.data as T
}

const cache = new Map<string, unknown>()

/** GET with memoisation (refresh=true re-fetches and updates the cache). */
async function apiGet<T>(path: string, refresh = false): Promise<T> {
  if (!refresh && cache.has(path)) return cache.get(path) as T
  const data = await call<T>(path)
  cache.set(path, data)
  return data
}

/** GET that never touches the cache (sync-progress polling). */
function apiGetFresh<T>(path: string): Promise<T> {
  return call<T>(path)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return call<T>(path, 'POST', body)
}

/** Drop memoised GETs (everything, or only paths under a prefix). */
export function clearSummitCache(prefix?: string): void {
  if (!prefix) {
    cache.clear()
    return
  }
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k)
}

/* ── Typed endpoint helpers ─────────────────────────────────────────────── */

export const getProfit = (days: number): Promise<ProfitResponse> => apiGet(`/api/profit/:uid?days=${days}`)
export const getSales = (days: number): Promise<SalesResponse> => apiGet(`/api/sales/:uid?days=${days}`)
export const getTenders = (days: number): Promise<TendersResponse> => apiGet(`/api/tenders/:uid?days=${days}`)
export const getLabor = (days: number): Promise<LaborResponse> => apiGet(`/api/labor/:uid?days=${days}`)
export const getLaborInsights = (days: number): Promise<InsightsResponse> =>
  apiGet(`/api/labor/:uid/insights?days=${days}`)
export const getFinances = (days: number, refresh = false): Promise<FinancesResponse> =>
  apiGet(`/api/finances/:uid?days=${days}`, refresh)
export const getTransactions = (days: number, refresh = false): Promise<TransactionsResponse> =>
  apiGet(`/api/transactions/:uid?days=${days}`, refresh)
export const getCashflow = (days: number): Promise<CashflowResponse> => apiGet(`/api/cashflow/:uid?days=${days}`)
export const getCredentials = (): Promise<CredentialRow[]> => apiGet('/api/credentials/:uid')
export const getConnectedAccounts = (): Promise<ConnectedAccountRow[]> => apiGet('/api/accounts/:uid')
export const getRecommendations = (): Promise<RecommendationRow[]> => apiGet('/api/recommendations/:uid')
export const getSettings = (): Promise<SettingsResponse> => apiGet('/api/settings/:uid')
export const saveSettings = (patch: Partial<SettingsResponse>): Promise<SettingsResponse> =>
  apiPost('/api/settings/:uid', patch)

export type SyncService = 'homebase' | 'oracle' | 'plaid'

export const startSync = (service: SyncService, days: number): Promise<SyncResultResponse> =>
  apiPost(`/api/sync/${service}/:uid`, { days })

/** Plaid keeps its own progress route in backend.py; the generic one only
 *  tracks homebase/oracle (their keys are `<service>_<uid>`). */
export const getSyncProgress = (service: SyncService): Promise<SyncProgress> =>
  apiGetFresh(service === 'plaid' ? '/api/sync/plaid/progress/:uid' : `/api/sync/progress/${service}/:uid`)

export const setImportantByMerchant = (merchantName: string, isImportant: boolean): Promise<{ updated: number }> =>
  apiPost('/api/transactions/important-by-merchant', { merchant_name: merchantName, is_important: isImportant })

export const verifyCredential = (
  service: SyncService,
  config: Record<string, string>
): Promise<{ success?: boolean; error?: string; info?: string }> =>
  apiPost('/api/credentials/verify', { service, config })

/* ── Small shared formatters / derivations ──────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-06-09[T…]' → 'Jun 9' (parsed by parts — no timezone drift). */
export function fmtDay(date: string | null | undefined): string {
  if (!date) return '—'
  const parts = date.slice(0, 10).split('-')
  const m = Number(parts[1])
  const d = Number(parts[2])
  if (!m || !d) return date
  return `${MONTHS[m - 1]} ${d}`
}

/** Naive-UTC backend timestamps → '12m ago' style labels. */
export function timeAgo(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z')
  if (Number.isNaN(t)) return null
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

/** Days elapsed since Jan 1 (for the YTD range on endpoints that take ?days). */
export function ytdDays(): number {
  const now = new Date()
  const jan1 = new Date(now.getFullYear(), 0, 1)
  return Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / 86400000))
}

/** % change, null when there is no meaningful baseline. */
export function pctDelta(curr: number, prev: number): number | null {
  if (!prev) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

/** ISO date string n days ago (for lexicographic date comparisons). */
export function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
}

/** 'credit_card' → 'Credit card' */
export function humanizeTender(t: string): string {
  const s = t.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Unknown'
}

/* ── merchant → logo domain ─────────────────────────────────────────────────
   Plaid enriches some transactions with a `logo_url`, but many arrive without
   one — so the Finances feed used to show a flat letter tile for half the rows.
   We map the merchant string to a best-guess brand domain and let the UI resolve
   a crisp logo from it (Clearbit). A small alias table nails the common chains;
   everything else falls back to a heuristic guess. Wrong guesses just 404 at the
   logo CDN and degrade to a coloured monogram — a bad guess never shows a broken
   image, so this is safe to run on every row automatically. */
export interface MerchantDomain {
  domain: string
  /** true = matched the curated brand table (high confidence); false = heuristic. */
  known: boolean
}

const MERCHANT_DOMAINS: Record<string, string> = {
  uber: 'uber.com',
  'uber eats': 'ubereats.com',
  ubereats: 'ubereats.com',
  lyft: 'lyft.com',
  doordash: 'doordash.com',
  grubhub: 'grubhub.com',
  instacart: 'instacart.com',
  'united airlines': 'united.com',
  united: 'united.com',
  delta: 'delta.com',
  'delta air lines': 'delta.com',
  'american airlines': 'aa.com',
  southwest: 'southwest.com',
  'jetblue': 'jetblue.com',
  mcdonalds: 'mcdonalds.com',
  "mcdonald's": 'mcdonalds.com',
  starbucks: 'starbucks.com',
  chipotle: 'chipotle.com',
  subway: 'subway.com',
  'burger king': 'bk.com',
  wendys: 'wendys.com',
  "wendy's": 'wendys.com',
  'taco bell': 'tacobell.com',
  'chick-fil-a': 'chick-fil-a.com',
  'chick fil a': 'chick-fil-a.com',
  dunkin: 'dunkindonuts.com',
  "dunkin'": 'dunkindonuts.com',
  "domino's": 'dominos.com',
  dominos: 'dominos.com',
  "panera": 'panerabread.com',
  amazon: 'amazon.com',
  'amazon prime': 'amazon.com',
  'amazon web services': 'aws.amazon.com',
  aws: 'aws.amazon.com',
  walmart: 'walmart.com',
  target: 'target.com',
  costco: 'costco.com',
  'sam\'s club': 'samsclub.com',
  'whole foods': 'wholefoodsmarket.com',
  kroger: 'kroger.com',
  safeway: 'safeway.com',
  'trader joe': 'traderjoes.com',
  "trader joe's": 'traderjoes.com',
  publix: 'publix.com',
  cvs: 'cvs.com',
  walgreens: 'walgreens.com',
  'home depot': 'homedepot.com',
  lowes: 'lowes.com',
  "lowe's": 'lowes.com',
  bestbuy: 'bestbuy.com',
  'best buy': 'bestbuy.com',
  fedex: 'fedex.com',
  ups: 'ups.com',
  usps: 'usps.com',
  netflix: 'netflix.com',
  spotify: 'spotify.com',
  hulu: 'hulu.com',
  disney: 'disneyplus.com',
  apple: 'apple.com',
  'apple store': 'apple.com',
  google: 'google.com',
  microsoft: 'microsoft.com',
  adobe: 'adobe.com',
  paypal: 'paypal.com',
  venmo: 'venmo.com',
  'cash app': 'cash.app',
  square: 'squareup.com',
  stripe: 'stripe.com',
  toast: 'toasttab.com',
  shell: 'shell.com',
  chevron: 'chevron.com',
  exxon: 'exxon.com',
  exxonmobil: 'exxon.com',
  bp: 'bp.com',
  comcast: 'xfinity.com',
  xfinity: 'xfinity.com',
  verizon: 'verizon.com',
  'at&t': 'att.com',
  att: 'att.com',
  'sysco': 'sysco.com',
  'us foods': 'usfoods.com',
  'restaurant depot': 'restaurantdepot.com'
}

const MERCHANT_NOISE = /\b(inc|llc|ltd|co|corp|company|the|payment|payments|pos|purchase|recurring|autopay|online|store|st|pmt|debit|credit|card|tst)\b/g

/** Best-guess a brand domain for a bank/POS merchant string. */
export function merchantDomain(raw: string | null | undefined): MerchantDomain {
  const name = (raw || '').toLowerCase().trim()
  if (!name) return { domain: '', known: false }
  if (MERCHANT_DOMAINS[name]) return { domain: MERCHANT_DOMAINS[name], known: true }

  // normalise: punctuation → spaces, drop legal/noise tokens and store numbers
  const cleaned = name
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(MERCHANT_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = cleaned.split(' ').filter(Boolean)
  if (!tokens.length) return { domain: '', known: false }

  const two = tokens.slice(0, 2).join(' ')
  if (MERCHANT_DOMAINS[two]) return { domain: MERCHANT_DOMAINS[two], known: true }
  if (MERCHANT_DOMAINS[tokens[0]]) return { domain: MERCHANT_DOMAINS[tokens[0]], known: true }

  // heuristic: first meaningful token → token.com (e.g. "United Airlines" → united.com)
  const base = tokens[0].length >= 3 ? tokens[0] : tokens.slice(0, 2).join('')
  if (!/^[a-z0-9]+$/.test(base)) return { domain: '', known: false }
  return { domain: `${base}.com`, known: false }
}

/* Mirrors backend.py's tip/exclusion logic (/api/tips, /api/finances). */
const TIP_KEYWORDS = ['tip', 'gratuity', 'service_charge', 'service charge', 'auto gratuity']
export function isTipTender(t: string | null | undefined): boolean {
  const s = (t || '').toLowerCase()
  return TIP_KEYWORDS.some((k) => s.includes(k))
}
export function isExcludedTender(t: string | null | undefined): boolean {
  const s = (t || '').toLowerCase()
  return s === 'comp' || s === 'void'
}
