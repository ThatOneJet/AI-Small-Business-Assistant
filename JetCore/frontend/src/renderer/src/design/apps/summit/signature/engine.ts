/**
 * Summit signature — the data engine behind the daily VERDICT, the weekly biggest
 * LEAK, and the hourly LABOR BOARD. Pure functions over the REAL Summit data
 * (getProfit · getSales · getLabor · getLaborInsights). No fabricated numbers:
 * every output is derived from the connected series, and callers show an honest
 * "connect a source" empty state when a needed series is missing.
 *
 * Everything here is framework-free so the home hero and the labor board share
 * one source of truth. Money/hours are kept as raw numbers; the UI rounds on
 * display (per the design rule — round all shown money/numbers).
 */
import type {
  ProfitDay,
  ProfitResponse,
  SalesResponse,
  LaborResponse,
  InsightsResponse,
  ShiftRow
} from '../api'

/* ── shared date helpers (parse-by-parts, no timezone drift) ───────────────── */

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** '2026-06-09[T…]' → JS weekday index (0=Sun) without timezone drift. */
export function dowIndex(date: string): number {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return new Date(date).getDay()
  // Construct at noon UTC to avoid any DST/offset edge flipping the day.
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
}
export function dowName(date: string): string {
  return DOW_SHORT[dowIndex(date)]
}

/* ── DAILY VERDICT ─────────────────────────────────────────────────────────── */

export interface VerdictReason {
  /** plain tag, e.g. "sales up 14%" */
  text: string
  tone: 'pos' | 'neg' | 'neutral'
  icon: string
}

export interface Verdict {
  /** the open day's date (last day in the series) */
  date: string
  /** today's profit (revenue − labor) for that day */
  profit: number
  revenue: number
  labor: number
  /** typical same-weekday profit (median of prior same-weekdays), null if none */
  typicalProfit: number | null
  /** how today compares to a typical same-weekday, in dollars (signed) */
  vsTypical: number | null
  /** plain-language read */
  headline: string
  verdict: 'good' | 'ok' | 'bad'
  reasons: VerdictReason[]
}

/** Median of a numeric list (used for "typical" so one freak day can't skew it). */
function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Average of prior same-weekday values for the given metric. */
function priorSameDow(daily: ProfitDay[], openIdx: number, pick: (d: ProfitDay) => number): number[] {
  const targetDow = dowIndex(daily[openIdx].date)
  const out: number[] = []
  for (let i = 0; i < openIdx; i++) {
    if (dowIndex(daily[i].date) === targetDow) out.push(pick(daily[i]))
  }
  return out
}

/**
 * Build the daily verdict from the profit series + sales/labor detail for the
 * open day. The "open day" is the most recent day in the profit series that has
 * activity (revenue or labor) — that's what the owner is judging.
 */
export function buildVerdict(
  profit: ProfitResponse,
  sales: SalesResponse,
  _labor: LaborResponse
): Verdict | null {
  const daily = profit.daily
  if (!daily.length) return null

  // last day with any activity
  let openIdx = -1
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].revenue > 0 || daily[i].labor > 0) {
      openIdx = i
      break
    }
  }
  if (openIdx < 0) return null

  const today = daily[openIdx]
  const typicalProfit = median(priorSameDow(daily, openIdx, (d) => d.profit))
  const typicalRev = median(priorSameDow(daily, openIdx, (d) => d.revenue))
  const typicalLabor = median(priorSameDow(daily, openIdx, (d) => d.labor))
  const vsTypical = typicalProfit === null ? null : today.profit - typicalProfit

  // verdict tier — primarily the sign of profit, nuanced by vs-typical
  let verdict: Verdict['verdict']
  let headline: string
  if (today.profit <= 0) {
    verdict = 'bad'
    headline = "You lost money today."
  } else if (vsTypical !== null && vsTypical < -0.1 * Math.abs(typicalProfit || 1)) {
    verdict = 'ok'
    headline = 'You made money — but below a typical ' + dowName(today.date) + '.'
  } else if (vsTypical !== null && vsTypical > 0.1 * Math.abs(typicalProfit || 1)) {
    verdict = 'good'
    headline = 'Strong day — ahead of a typical ' + dowName(today.date) + '.'
  } else {
    verdict = 'good'
    headline = 'You made money today.'
  }

  const reasons: VerdictReason[] = []

  // 1) sales vs typical same-weekday
  if (typicalRev !== null && typicalRev > 0) {
    const pct = ((today.revenue - typicalRev) / typicalRev) * 100
    if (Math.abs(pct) >= 5) {
      const dir = pct >= 0 ? 'up' : 'down'
      // attach the busiest hour as a plain reason when sales data has hours
      const peak = peakSalesHour(sales, today.date)
      const tail = peak ? ` — ${peak}` : ''
      reasons.push({
        text: `sales ${dir} ${Math.abs(Math.round(pct))}%${tail}`,
        tone: pct >= 0 ? 'pos' : 'neg',
        icon: pct >= 0 ? 'trend' : 'arrowDn'
      })
    }
  }

  // 2) labor lean / heavy vs typical
  if (typicalLabor !== null && typicalLabor > 0) {
    const pct = ((today.labor - typicalLabor) / typicalLabor) * 100
    if (Math.abs(pct) >= 8) {
      const lean = pct < 0
      reasons.push({
        text: lean ? `labor lean (${Math.abs(Math.round(pct))}% under)` : `labor heavy (${Math.round(pct)}% over)`,
        // leaner labor is good for profit; heavier is a drag
        tone: lean ? 'pos' : 'neg',
        icon: 'people'
      })
    }
  }

  // 3) labor % of revenue on the day (the operator's headline ratio)
  if (today.revenue > 0) {
    const laborPct = (today.labor / today.revenue) * 100
    if (laborPct > 0) {
      reasons.push({
        text: `labor ${Math.round(laborPct)}% of sales`,
        tone: laborPct > 32 ? 'neg' : laborPct < 24 ? 'pos' : 'neutral',
        icon: 'donut'
      })
    }
  }

  // 4) margin read when there's nothing else punchy to say
  if (reasons.length === 0 && today.margin_pct !== null) {
    reasons.push({
      text: `${Math.round(today.margin_pct)}% margin`,
      tone: today.margin_pct >= 0 ? 'pos' : 'neg',
      icon: 'donut'
    })
  }

  return {
    date: today.date,
    profit: today.profit,
    revenue: today.revenue,
    labor: today.labor,
    typicalProfit,
    vsTypical,
    headline,
    verdict,
    reasons
  }
}

/** Busiest sales hour on `date` as a plain phrase ("lunch rush", "dinner rush"…). */
function peakSalesHour(sales: SalesResponse, date: string): string | null {
  const byHour = new Map<number, number>()
  for (const r of sales.sales) {
    if (!r.date || r.date.slice(0, 10) !== date.slice(0, 10)) continue
    if (r.hour === null) continue
    byHour.set(r.hour, (byHour.get(r.hour) ?? 0) + r.revenue)
  }
  if (!byHour.size) return null
  let peak = -1
  let best = -1
  for (const [h, v] of byHour) {
    if (v > best) {
      best = v
      peak = h
    }
  }
  if (peak < 0) return null
  if (peak >= 11 && peak <= 14) return 'lunch rush'
  if (peak >= 17 && peak <= 21) return 'dinner rush'
  if (peak >= 6 && peak <= 10) return 'morning rush'
  return `peak at ${fmtHour(peak)}`
}

/* ── WEEKLY BIGGEST LEAK ───────────────────────────────────────────────────── */

export type LeakKind = 'labor' | 'overtime' | 'margin'

export interface Leak {
  kind: LeakKind
  /** short title, e.g. "Overstaffed Tuesday mornings" */
  title: string
  /** estimated weekly cost of the problem, in dollars */
  weeklyCost: number
  /** the why */
  reason: string
  /** the recommended fix */
  fix: string
  /** when true, the fix opens the labor board */
  opensLabor: boolean
}

/**
 * Re-evaluate the single biggest money leak this week from the data, with the
 * next-biggest queued behind it. Candidates are quantified in dollars/week so
 * they're directly comparable; the largest wins and can change as data shifts.
 *
 * Sources: labor insights (over/understaffed weekdays vs. the location's own
 * average labor %), overtime cost from the shift rows, and margin drag.
 */
export function buildLeaks(
  labor: LaborResponse,
  insights: InsightsResponse,
  profit: ProfitResponse,
  days: number
): Leak[] {
  const leaks: Leak[] = []
  const weeks = Math.max(1, days / 7)

  // 1) Overstaffed weekdays — the labor $ spent above the location's own target
  //    labor% on days flagged 'overstaffed'. Quantified from the per-DOW stats.
  const avgPct = insights.avg_labor_pct ?? null
  for (const ins of insights.insights) {
    if (ins.type !== 'overstaffed') continue
    const stat = insights.by_dow.find((d) => d.dow === ins.dow)
    if (!stat || !avgPct || stat.avg_revenue <= 0) continue
    // excess labor $ per occurrence of this weekday = (its labor% − avg labor%) × revenue
    const excessPct = Math.max(0, ins.labor_pct - avgPct)
    const excessPerDay = (excessPct / 100) * stat.avg_revenue
    // weekly cost ≈ one occurrence of this weekday per week
    const weekly = excessPerDay
    if (weekly >= 25) {
      leaks.push({
        kind: 'labor',
        title: `Overstaffed ${ins.dow}s`,
        weeklyCost: weekly,
        reason: `${ins.dow} runs ${Math.round(ins.labor_pct)}% labor vs. your ${Math.round(avgPct)}% average — you're paying for hours the sales don't cover.`,
        fix: 'Open the labor board and move staff off the slow hours.',
        opensLabor: true
      })
    }
  }

  // 2) Overtime — OT premium (the half-time uplift) paid this period.
  const otShifts = labor.shifts.filter((s) => s.is_overtime)
  if (otShifts.length) {
    // premium ≈ 1/3 of an OT shift's cost is the "extra" half-rate vs straight time.
    const otPremium = otShifts.reduce((a, s) => a + s.labor_cost / 3, 0)
    const weekly = otPremium / weeks
    if (weekly >= 25) {
      leaks.push({
        kind: 'overtime',
        title: `Overtime premium`,
        weeklyCost: weekly,
        reason: `${otShifts.length} overtime shift${otShifts.length === 1 ? '' : 's'} this period — overtime pays time-and-a-half, so the last hours cost the most.`,
        fix: 'Open the labor board and spread hours so no one tips into overtime.',
        opensLabor: true
      })
    }
  }

  // 3) Margin drag — days where labor% blew past a healthy ceiling, costing profit.
  if (avgPct !== null && avgPct > 30) {
    const totalRev = profit.summary.total_revenue
    if (totalRev > 0) {
      // $ above a 30% labor target, normalised to a week.
      const over = ((avgPct - 30) / 100) * totalRev
      const weekly = over / weeks
      if (weekly >= 25) {
        leaks.push({
          kind: 'margin',
          title: `Labor above target`,
          weeklyCost: weekly,
          reason: `Labor is running ${Math.round(avgPct)}% of sales — above a healthy 30% ceiling for the period.`,
          fix: 'Trim hours on your slowest day-parts in the labor board.',
          opensLabor: true
        })
      }
    }
  }

  leaks.sort((a, b) => b.weeklyCost - a.weeklyCost)
  return leaks
}

/* ── LABOR BOARD model (sales-by-hour vs staff-scheduled) ──────────────────── */

export interface HourCell {
  hour: number
  /** sales revenue in this hour on the open day */
  sales: number
  /** number of staff scheduled covering this hour */
  staff: number
}

export interface BoardModel {
  /** the open day the board operates on */
  date: string
  /** contiguous operating hours (first staffed/sold hour → last) */
  hours: HourCell[]
  /** blended hourly labor rate (avg of that day's shift rates), for cost math */
  avgRate: number
  /** total sales that day */
  totalSales: number
}

/** 13 → "1p", 9 → "9a", 0 → "12a". Compact hour label. */
export function fmtHour(h: number): string {
  const hr = ((h + 11) % 12) + 1
  return `${hr}${h < 12 ? 'a' : 'p'}`
}

/** Parse "HH:MM[:SS]" or an ISO time into an hour float (8.5 = 8:30). null if unknown. */
function parseHour(t: string | null): number | null {
  if (!t) return null
  // try ISO datetime first
  const isoT = t.includes('T') ? t.split('T')[1] : t
  const m = isoT.match(/(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (Number.isNaN(h)) return null
  return h + (Number.isNaN(min) ? 0 : min / 60)
}

/**
 * Build the labor-board model for the open day from REAL sales-by-hour rows and
 * REAL scheduled shifts. Returns null when neither sales-hours nor schedule data
 * exists for any day (caller shows a connect empty state).
 *
 * The "open day" = the most recent date that has either an hourly sales row or a
 * scheduled shift, so the board reflects the day the owner is actually running.
 */
export function buildBoard(sales: SalesResponse, labor: LaborResponse): BoardModel | null {
  // candidate dates from both sources
  const dates = new Set<string>()
  for (const r of sales.sales) if (r.date && r.hour !== null) dates.add(r.date.slice(0, 10))
  for (const s of labor.shifts) if (s.shift_date && parseHour(s.scheduled_start) !== null) dates.add(s.shift_date.slice(0, 10))
  if (!dates.size) return null
  const date = [...dates].sort().reverse()[0]

  // sales by hour for the day
  const salesByHour = new Map<number, number>()
  for (const r of sales.sales) {
    if (!r.date || r.date.slice(0, 10) !== date) continue
    if (r.hour === null) continue
    salesByHour.set(r.hour, (salesByHour.get(r.hour) ?? 0) + r.revenue)
  }

  // staff scheduled per hour from shift start/end; blended rate from same shifts
  const staffByHour = new Map<number, number>()
  const dayShifts = labor.shifts.filter((s) => s.shift_date && s.shift_date.slice(0, 10) === date)
  let rateSum = 0
  let rateN = 0
  for (const s of dayShifts) {
    const start = parseHour(s.scheduled_start)
    const end = parseHour(s.scheduled_end)
    if (s.hourly_rate > 0) {
      rateSum += s.hourly_rate
      rateN++
    }
    if (start === null) continue
    const e = end === null ? start + 1 : end <= start ? end + 24 : end
    for (let h = Math.floor(start); h < Math.ceil(e); h++) {
      const hh = h % 24
      staffByHour.set(hh, (staffByHour.get(hh) ?? 0) + 1)
    }
  }

  const present = [...new Set([...salesByHour.keys(), ...staffByHour.keys()])].sort((a, b) => a - b)
  if (!present.length) return null
  const lo = present[0]
  const hi = present[present.length - 1]
  const hours: HourCell[] = []
  for (let h = lo; h <= hi; h++) {
    hours.push({ hour: h, sales: Math.round(salesByHour.get(h) ?? 0), staff: staffByHour.get(h) ?? 0 })
  }

  const avgRate = rateN ? rateSum / rateN : medianRate(labor.shifts)
  const totalSales = hours.reduce((a, c) => a + c.sales, 0)
  return { date, hours, avgRate: Math.round(avgRate * 100) / 100, totalSales }
}

function medianRate(shifts: ShiftRow[]): number {
  const rates = shifts.map((s) => s.hourly_rate).filter((r) => r > 0)
  const m = median(rates)
  return m ?? 0
}

/* ── board flags + live cost/coverage math ─────────────────────────────────── */

export type HourFlag = 'wasted' | 'lost' | 'ok'

/**
 * Flag each hour: WASTED labor (staff high, sales low) or LOST sales (sales high,
 * staff low). Thresholds are relative to the day's own sales-per-staff norm, so a
 * quiet café and a busy bar are judged on their own scale.
 */
export function flagHours(hours: HourCell[]): HourFlag[] {
  const open = hours.filter((h) => h.staff > 0 || h.sales > 0)
  const totalSales = open.reduce((a, h) => a + h.sales, 0)
  const totalStaff = open.reduce((a, h) => a + h.staff, 0)
  // sales each staff member should roughly pull in an hour to "earn their keep"
  const norm = totalStaff > 0 ? totalSales / totalStaff : 0
  return hours.map((h) => {
    if (norm <= 0) return 'ok'
    const expected = h.staff * norm
    if (h.staff >= 1 && h.sales < expected * 0.5 && h.staff > 1) return 'wasted'
    if (h.sales > expected * 1.6 && h.staff >= 1) return 'lost'
    // an hour with real sales but zero staff is a clear lost-sales flag
    if (h.staff === 0 && h.sales > norm * 0.5) return 'lost'
    return 'ok'
  })
}

export interface Coverage {
  staffHours: number
  laborCost: number
  /** count of hours flagged wasted / lost after the current arrangement */
  wasted: number
  lost: number
  totalSales: number
}

/** Live coverage + cost for an arrangement of hours (recomputed on every drag). */
export function computeCoverage(hours: HourCell[], avgRate: number): Coverage {
  const staffHours = hours.reduce((a, h) => a + h.staff, 0)
  const flags = flagHours(hours)
  return {
    staffHours,
    laborCost: Math.round(staffHours * avgRate),
    wasted: flags.filter((f) => f === 'wasted').length,
    lost: flags.filter((f) => f === 'lost').length,
    totalSales: hours.reduce((a, h) => a + h.sales, 0)
  }
}
