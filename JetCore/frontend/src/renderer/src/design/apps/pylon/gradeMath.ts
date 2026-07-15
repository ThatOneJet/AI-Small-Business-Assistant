/**
 * Pylon — Grades simulator + GPA: the typed data + math layer.
 *
 * This is the brain behind the Grades tab. It owns:
 *  - the Canvas shapes the simulator reads (assignment groups + weights, the
 *    assignments inside them, and the student's own submission/score),
 *  - the weighted-grade math (current grade, live projection, "what do you need
 *    on the rest", "which items can't move your letter"),
 *  - the manual-item model (hand-entered PowerSchool grades) persisted to the
 *    vault, and
 *  - the GPA scale model (weighted/unweighted · 4.0/5.0 · per-class honors/AP)
 *    also persisted to the vault.
 *
 * All persistence flows through window.decks.vault (plaintext in, plaintext out —
 * encryption happens in main). Nothing here touches PowerSchool; manual items are
 * entered by hand only.
 */

/* ── vault keys ──────────────────────────────────────────────────────── */

/** Manual (hand-entered) graded items, keyed by course. */
export const VAULT_MANUAL = 'pylon.manual'
/** GPA scale settings + per-class honors/AP flags. */
export const VAULT_GPA = 'pylon.gpa'

/* ── Canvas shapes the simulator reads ───────────────────────────────── */

/** A student's submission as it rides along on an assignment (include[]=submission). */
export interface CanvasGroupSubmission {
  score?: number | null
  workflow_state?: string // 'graded' | 'submitted' | 'unsubmitted' | 'pending_review'
  excused?: boolean
  missing?: boolean
}

/** An assignment as returned inside an assignment group (include[]=assignments). */
export interface CanvasGroupAssignment {
  id: number
  name: string
  points_possible?: number | null
  due_at?: string | null
  omit_from_final_grade?: boolean
  submission?: CanvasGroupSubmission | null
}

/** A Canvas assignment group, with its weight and (optionally) its assignments. */
export interface CanvasAssignmentGroup {
  id: number
  name: string
  /** Percent of the final grade this group carries (only when weighting is on). */
  group_weight?: number | null
  position?: number
  assignments?: CanvasGroupAssignment[]
}

/* ── manual items (PowerSchool / by-hand) ────────────────────────────── */

/** A graded item the student typed in by hand (PowerSchool has no API). */
export interface ManualItem {
  id: string
  name: string
  /** Weight as a percent of the grade (0–100). Used like a group weight. */
  weight: number
  /** Score earned, as a percent (0–100). null = not yet graded (upcoming). */
  score: number | null
}

/** Manual items, keyed by Canvas course id (stringified). */
export type ManualStore = Record<string, ManualItem[]>

/* ── GPA model ───────────────────────────────────────────────────────── */

export type GpaScale = 'unweighted' | 'weighted'
/** The bump a 5.0-style weighted scale gives honors/AP classes. */
export type WeightedCap = '5.0' | '4.5'

export interface GpaSettings {
  scale: GpaScale
  /** For weighted scales: the top grade-point an AP/honors class can reach. */
  cap: WeightedCap
  /** Per-course tier, keyed by Canvas course id (stringified). */
  tiers: Record<string, ClassTier>
}

/** A class's rigor tier — drives the weighted bump. */
export type ClassTier = 'regular' | 'honors' | 'ap'

export const DEFAULT_GPA: GpaSettings = { scale: 'unweighted', cap: '5.0', tiers: {} }

/* ── vault persistence ───────────────────────────────────────────────── */

/** Read + parse a JSON blob from the vault, falling back to `fallback`. */
async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await window.decks.vault.get(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as unknown
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

/** Write a JSON blob to the vault (encrypted in main). */
async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await window.decks.vault.set({ key, plaintext: JSON.stringify(value) })
  } catch {
    /* a vault write failure shouldn't crash the view; state stays in memory */
  }
}

export const loadManual = (): Promise<ManualStore> => readJson<ManualStore>(VAULT_MANUAL, {})
export const saveManual = (store: ManualStore): Promise<void> => writeJson(VAULT_MANUAL, store)

export async function loadGpa(): Promise<GpaSettings> {
  const g = await readJson<Partial<GpaSettings>>(VAULT_GPA, DEFAULT_GPA)
  // Be tolerant of an older/partial blob — never crash on a stale shape.
  return {
    scale: g.scale === 'weighted' ? 'weighted' : 'unweighted',
    cap: g.cap === '4.5' ? '4.5' : '5.0',
    tiers: g.tiers && typeof g.tiers === 'object' ? g.tiers : {}
  }
}
export const saveGpa = (settings: GpaSettings): Promise<void> => writeJson(VAULT_GPA, settings)

/* ── rounding ────────────────────────────────────────────────────────── */

/** Round to `dp` decimals (default 1) — every displayed number runs through this. */
export const round = (n: number, dp = 1): number => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/* ── the weighted-grade model ────────────────────────────────────────── */

/** True if Canvas is actually weighting groups (any group carries a weight). */
export function groupsAreWeighted(groups: CanvasAssignmentGroup[]): boolean {
  return groups.some((g) => (g.group_weight ?? 0) > 0)
}

/** A single graded line in the simulator (Canvas assignment or manual item). */
export interface GradeItem {
  /** Stable id ("canvas:123" / "manual:abc") for React keys + override map. */
  key: string
  source: 'canvas' | 'manual'
  name: string
  groupName: string
  /** This item's share of the whole grade, as a percent (already normalised). */
  weightPct: number
  pointsPossible: number | null
  dueAt: string | null
  /** Real earned score as a percent (0–100), or null if ungraded/upcoming. */
  actualPct: number | null
  /** Whether Canvas excused / dropped it from the grade. */
  excluded: boolean
}

/** A group with its (normalised) weight and the items inside it. */
export interface GradeGroup {
  id: number
  name: string
  weightPct: number
  items: GradeItem[]
}

/** Earned percent for a Canvas submission against an assignment's points. */
function actualPctOf(a: CanvasGroupAssignment): number | null {
  const sub = a.submission
  if (!sub || sub.excused) return null
  if (sub.workflow_state !== 'graded') return null
  if (sub.score === null || sub.score === undefined) return null
  const pts = a.points_possible ?? 0
  if (pts <= 0) return null // 0-point / extra-credit-ish: leave out of the % math
  return (sub.score / pts) * 100
}

/**
 * Build the simulator's model from Canvas groups + the course's manual items.
 *
 * When Canvas is weighting groups we use those weights directly. When it isn't
 * (totals are simple points), we fall back to deriving each group's weight from
 * its share of total points possible — so the projection is still sane. Manual
 * items always carry the literal weight % the student typed.
 */
export function buildModel(
  groups: CanvasAssignmentGroup[],
  manual: ManualItem[]
): { groups: GradeGroup[]; weighted: boolean; manualWeightPct: number } {
  const weighted = groupsAreWeighted(groups)
  const manualWeightPct = manual.reduce((s, m) => s + (m.weight || 0), 0)

  // Canvas-side weight per group (sums to ~100 across canvas groups).
  let canvasWeights: Map<number, number>
  if (weighted) {
    canvasWeights = new Map(groups.map((g) => [g.id, g.group_weight ?? 0]))
  } else {
    // points-based fallback: weight ∝ total points possible in the group
    const groupPoints = new Map<number, number>()
    let total = 0
    for (const g of groups) {
      const pts = (g.assignments ?? []).reduce((s, a) => s + (a.points_possible ?? 0), 0)
      groupPoints.set(g.id, pts)
      total += pts
    }
    canvasWeights = new Map(
      groups.map((g) => [g.id, total > 0 ? ((groupPoints.get(g.id) ?? 0) / total) * 100 : 0])
    )
  }

  // Manual items eat their declared share of 100; Canvas keeps the remainder.
  const canvasShare = Math.max(0, 100 - manualWeightPct)
  const canvasWeightTotal = Array.from(canvasWeights.values()).reduce((s, w) => s + w, 0)
  const scaleCanvas = canvasWeightTotal > 0 ? canvasShare / canvasWeightTotal : 0

  const gradeGroups: GradeGroup[] = groups
    .map((g) => {
      const groupWeight = (canvasWeights.get(g.id) ?? 0) * scaleCanvas
      const assignments = (g.assignments ?? []).filter((a) => !a.omit_from_final_grade)
      // Within a group, each assignment's share is ∝ its points possible.
      const groupPts = assignments.reduce((s, a) => s + (a.points_possible ?? 0), 0)
      const items: GradeItem[] = assignments.map((a) => {
        const share = groupPts > 0 ? (a.points_possible ?? 0) / groupPts : 0
        return {
          key: `canvas:${a.id}`,
          source: 'canvas' as const,
          name: a.name,
          groupName: g.name,
          weightPct: groupWeight * share,
          pointsPossible: a.points_possible ?? null,
          dueAt: a.due_at ?? null,
          actualPct: actualPctOf(a),
          excluded: a.submission?.excused === true
        }
      })
      return { id: g.id, name: g.name, weightPct: groupWeight, items }
    })
    .filter((g) => g.items.length > 0 || g.weightPct > 0)

  // Manual items live in one synthetic group so they render together.
  if (manual.length > 0) {
    gradeGroups.push({
      id: -1,
      name: 'Manual items',
      weightPct: manualWeightPct,
      items: manual.map((m) => ({
        key: `manual:${m.id}`,
        source: 'manual' as const,
        name: m.name,
        groupName: 'Manual items',
        weightPct: m.weight || 0,
        pointsPossible: null,
        dueAt: null,
        actualPct: m.score,
        excluded: false
      }))
    })
  }

  return { groups: gradeGroups, weighted, manualWeightPct }
}

/** Flatten a model to its graded lines. */
export function allItems(groups: GradeGroup[]): GradeItem[] {
  return groups.flatMap((g) => g.items)
}

/**
 * The grade you'd land at if every item scored `scoreOf(item)` (a percent), and
 * ungraded items (scoreOf → null) simply don't count yet. Returns null when no
 * weight is in play at all.
 *
 * Math: weighted average of item percents, each weighted by `weightPct`, over
 * only the items that currently have a score. This matches how Canvas computes
 * a current grade from graded work and how it'll land once the rest comes in.
 */
export function projectGrade(items: GradeItem[], scoreOf: (it: GradeItem) => number | null): number | null {
  let weightSum = 0
  let acc = 0
  for (const it of items) {
    if (it.excluded || it.weightPct <= 0) continue
    const s = scoreOf(it)
    if (s === null) continue
    weightSum += it.weightPct
    acc += (s / 100) * it.weightPct
  }
  if (weightSum <= 0) return null
  return (acc / weightSum) * 100
}

/** The current grade from real (graded) scores only — null if nothing's graded. */
export function currentGrade(items: GradeItem[]): number | null {
  return projectGrade(items, (it) => it.actualPct)
}

/**
 * Solve: given the locked-in graded work and the remaining (ungraded) weight,
 * what flat percent on ALL remaining items lands you exactly at `goal`?
 *
 * Returns:
 *  - needed: the flat % required on remaining work (may be <0 or >100),
 *  - secured: true if even a 0 on the rest still clears the goal,
 *  - reachable: true if a 100 on the rest can reach the goal,
 *  - remainingWeight: the share of the grade still up for grabs (percent).
 */
export interface GoalSolve {
  needed: number
  secured: boolean
  reachable: boolean
  remainingWeight: number
}
export function neededForGoal(items: GradeItem[], goal: number): GoalSolve | null {
  let lockedWeight = 0
  let lockedAcc = 0
  let remainingWeight = 0
  for (const it of items) {
    if (it.excluded || it.weightPct <= 0) continue
    if (it.actualPct !== null) {
      lockedWeight += it.weightPct
      lockedAcc += (it.actualPct / 100) * it.weightPct
    } else {
      remainingWeight += it.weightPct
    }
  }
  const totalWeight = lockedWeight + remainingWeight
  if (totalWeight <= 0) return null
  if (remainingWeight <= 0) {
    // nothing left to change — needed is moot; secured iff we already hit it
    const final = (lockedAcc / totalWeight) * 100
    return { needed: 0, secured: final >= goal, reachable: final >= goal, remainingWeight: 0 }
  }
  // goal = (lockedAcc + (needed/100)*remainingWeight) / totalWeight * 100
  const needed = ((goal / 100) * totalWeight - lockedAcc) / remainingWeight * 100
  const securedFinal = (lockedAcc / totalWeight) * 100 // remaining all 0
  const maxFinal = ((lockedAcc + remainingWeight) / totalWeight) * 100 // remaining all 100
  return {
    needed,
    secured: securedFinal >= goal,
    reachable: maxFinal >= goal,
    remainingWeight
  }
}

/**
 * For one remaining item: can any score on it (0…100) change the projected
 * LETTER grade, holding all other expected scores fixed? If not, it's safe to
 * deprioritise. `letterAt` maps a percent to its letter.
 */
export function cannotChangeLetter(
  items: GradeItem[],
  target: GradeItem,
  scoreOf: (it: GradeItem) => number | null,
  letterAt: (pct: number) => string
): boolean {
  if (target.excluded || target.weightPct <= 0) return true
  const atZero = projectGrade(items, (it) => (it.key === target.key ? 0 : scoreOf(it)))
  const atFull = projectGrade(items, (it) => (it.key === target.key ? 100 : scoreOf(it)))
  if (atZero === null || atFull === null) return true
  return letterAt(atZero) === letterAt(atFull)
}

/* ── GPA math ────────────────────────────────────────────────────────── */

/** Unweighted 4.0 grade points for a percent (standard US scale). */
export function gradePoints4(pct: number): number {
  if (pct >= 93) return 4.0
  if (pct >= 90) return 3.7
  if (pct >= 87) return 3.3
  if (pct >= 83) return 3.0
  if (pct >= 80) return 2.7
  if (pct >= 77) return 2.3
  if (pct >= 73) return 2.0
  if (pct >= 70) return 1.7
  if (pct >= 67) return 1.3
  if (pct >= 63) return 1.0
  if (pct >= 60) return 0.7
  return 0.0
}

/**
 * GPA grade points for one class under the chosen scale.
 *  - unweighted: the plain 4.0 points.
 *  - weighted: AP gets a full bump to the cap (5.0 or 4.5), honors gets half
 *    that bump — both only when the base points are passing (>0).
 */
export function classGpaPoints(pct: number, tier: ClassTier, settings: GpaSettings): number {
  const base = gradePoints4(pct)
  if (settings.scale === 'unweighted' || tier === 'regular' || base <= 0) return base
  const fullBump = settings.cap === '4.5' ? 0.5 : 1.0
  const bump = tier === 'ap' ? fullBump : fullBump / 2
  return base + bump
}

export interface GpaResult {
  gpa: number | null
  /** Classes that counted (had a score). */
  counted: number
}

/** Compute GPA across classes (each weighted equally — one class, one unit). */
export function computeGpa(
  classes: Array<{ id: number; score: number | null }>,
  settings: GpaSettings
): GpaResult {
  let sum = 0
  let n = 0
  for (const c of classes) {
    if (c.score === null) continue
    const tier = settings.tiers[String(c.id)] ?? 'regular'
    sum += classGpaPoints(c.score, tier, settings)
    n += 1
  }
  return { gpa: n > 0 ? sum / n : null, counted: n }
}
