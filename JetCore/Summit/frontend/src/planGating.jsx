// ── Plan limits ───────────────────────────────────────────────────────────────

// Per-segment plan limits — different features matter for each user type
const LIMITS = {
  restaurant: {
    free:       { days: 7,    bankConnections: 0,    oracle: false, ai: false, fullHistory: false, syncDays: 7,   fullSyncDays: 0,    budgets: false, savingsGoals: false },
    plus:       { days: 30,   bankConnections: 1,    oracle: true,  ai: false, fullHistory: false, syncDays: 30,  fullSyncDays: 180,  budgets: false, savingsGoals: false },
    pro:        { days: 365,  bankConnections: 3,    oracle: true,  ai: true,  fullHistory: false, syncDays: 90,  fullSyncDays: 365,  budgets: false, savingsGoals: false },
    max:        { days: null, bankConnections: 20,   oracle: true,  ai: true,  fullHistory: true,  syncDays: 90,  fullSyncDays: 1825, budgets: false, savingsGoals: false },
    enterprise: { days: null, bankConnections: null, oracle: true,  ai: true,  fullHistory: true,  syncDays: null,fullSyncDays: null,  budgets: false, savingsGoals: false },
  },
  individual: {
    free:       { days: 30,   bankConnections: 1,    oracle: false, ai: false, fullHistory: false, syncDays: 30,  fullSyncDays: 90,   budgets: false, savingsGoals: false },
    plus:       { days: 365,  bankConnections: 2,    oracle: false, ai: false, fullHistory: false, syncDays: 90,  fullSyncDays: 365,  budgets: true,  savingsGoals: false },
    pro:        { days: 730,  bankConnections: 5,    oracle: false, ai: true,  fullHistory: false, syncDays: 365, fullSyncDays: 730,  budgets: true,  savingsGoals: true  },
    max:        { days: null, bankConnections: null, oracle: false, ai: true,  fullHistory: true,  syncDays: null,fullSyncDays: null,  budgets: true,  savingsGoals: true  },
    enterprise: { days: null, bankConnections: null, oracle: false, ai: true,  fullHistory: true,  syncDays: null,fullSyncDays: null,  budgets: true,  savingsGoals: true  },
  },
  small_biz: {
    free:       { days: 30,   bankConnections: 1,    oracle: false, ai: false, fullHistory: false, syncDays: 30,  fullSyncDays: 90,   budgets: false, savingsGoals: false },
    plus:       { days: 365,  bankConnections: 3,    oracle: false, ai: false, fullHistory: false, syncDays: 90,  fullSyncDays: 365,  budgets: true,  savingsGoals: false },
    pro:        { days: null, bankConnections: 10,   oracle: true,  ai: true,  fullHistory: false, syncDays: 90,  fullSyncDays: 730,  budgets: true,  savingsGoals: false },
    max:        { days: null, bankConnections: null, oracle: true,  ai: true,  fullHistory: true,  syncDays: null,fullSyncDays: null,  budgets: true,  savingsGoals: true  },
    enterprise: { days: null, bankConnections: null, oracle: true,  ai: true,  fullHistory: true,  syncDays: null,fullSyncDays: null,  budgets: true,  savingsGoals: true  },
  },
}

// Legacy flat export (restaurant defaults) — keeps existing callers working
export const PLAN_LIMITS = LIMITS.restaurant

const PLAN_ORDER = ['free', 'plus', 'pro', 'max', 'enterprise']

export const PLAN_NAMES = { free: 'Free', plus: 'Plus', pro: 'Pro', max: 'Max', enterprise: 'Enterprise' }

export function planRank(plan) {
  return PLAN_ORDER.indexOf(plan || 'free')
}

// Plans removed — everything is always unlocked.
export function meetsRequired(currentPlan, requiredPlan) {
  return true
}

export function getLimits(plan, segment) {
  // Everything unlimited / enabled, regardless of plan or segment.
  return {
    days: null, bankConnections: null, oracle: true, ai: true, fullHistory: true,
    syncDays: null, fullSyncDays: null, budgets: true, savingsGoals: true,
  }
}

// ── PlanGate component ────────────────────────────────────────────────────────

export function PlanGate({ children }) {
  // Plans removed — never gate; always render the feature.
  return children ?? null
}
