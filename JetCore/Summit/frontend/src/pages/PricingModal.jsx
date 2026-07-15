import { useState } from 'react'
import { api } from '../api'

const TICK  = 'tick'
const CROSS = 'cross'

const PLANS_RESTAURANT = [
  {
    key: 'free', name: 'Free', price: '$0', period: '/mo',
    tagline: 'Get started — no credit card needed',
    features: [
      { label: 'Labor cost reports (7-day view)', type: TICK },
      { label: 'Sales & tender summaries', type: TICK },
      { label: 'Basic dashboard overview', type: TICK },
      { label: '7-day sync only · no full history', type: TICK },
      { label: 'Bank account connection', type: CROSS },
      { label: 'Oracle POS integration', type: CROSS },
      { label: 'Full history sync', type: CROSS },
      { label: 'AI-powered insights', type: CROSS },
    ],
    cta: 'Current Plan', highlight: false,
  },
  {
    key: 'plus', name: 'Plus', price: '$9.99', period: '/mo',
    tagline: 'Essential tools for small operators',
    badge: 'Best Value',
    features: [
      { label: '1 bank account connection', type: TICK },
      { label: 'Oracle POS integration', type: TICK },
      { label: '30-day data view & sync', type: TICK },
      { label: '6-month full history sync', type: TICK },
      { label: 'Sales & revenue analytics', type: TICK },
      { label: 'Revenue reconciliation', type: TICK },
      { label: 'Email support', type: TICK },
    ],
    cta: 'Upgrade to Plus', highlight: false,
  },
  {
    key: 'pro', name: 'Pro', price: '$19.99', period: '/mo',
    tagline: 'Advanced analytics for growing restaurants',
    badge: 'Most Popular',
    features: [
      { label: '3 bank account connections', type: TICK },
      { label: 'Everything in Plus', type: TICK },
      { label: '1-year data view · 90-day sync', type: TICK },
      { label: '1-year full history sync', type: TICK },
      { label: 'AI-powered cost insights', type: TICK },
      { label: 'Tip analysis & staffing insights', type: TICK },
      { label: 'Priority support', type: TICK },
    ],
    cta: 'Upgrade to Pro', highlight: true,
  },
  {
    key: 'max', name: 'Max', price: '$49.99', period: '/mo',
    tagline: 'Full power for serious operators',
    badge: 'Most Powerful',
    features: [
      { label: 'Up to 20 bank connections', type: TICK },
      { label: 'Everything in Pro', type: TICK },
      { label: 'Unlimited data view & history', type: TICK },
      { label: '5-year full history sync', type: TICK },
      { label: 'Year-over-year labor analysis', type: TICK },
      { label: 'AI forecasting & anomaly detection', type: TICK },
      { label: 'Scheduled email digest reports', type: TICK },
    ],
    cta: 'Upgrade to Max', highlight: false,
  },
  {
    key: 'enterprise', name: 'Enterprise', price: 'Custom', period: '',
    tagline: 'Tailored for multi-location operations',
    features: [
      { label: 'Unlimited bank connections', type: TICK },
      { label: 'Everything in Max', type: TICK },
      { label: 'Multi-location management', type: TICK },
      { label: 'Custom AI model fine-tuning', type: TICK },
      { label: 'Dedicated account manager', type: TICK },
      { label: 'SLA guarantees', type: TICK },
      { label: 'Custom integrations', type: TICK },
    ],
    cta: 'Contact Sales', highlight: false,
  },
]

const PLANS_INDIVIDUAL = [
  {
    key: 'free', name: 'Free', price: '$0', period: '/mo',
    tagline: 'Track your money with no strings attached',
    features: [
      { label: '1 bank account connection', type: TICK },
      { label: '30-day transaction history', type: TICK },
      { label: 'Spending breakdown by category', type: TICK },
      { label: 'Cash balance overview', type: TICK },
      { label: 'Budget tracking', type: CROSS },
      { label: 'Savings goals', type: CROSS },
      { label: 'AI spending insights', type: CROSS },
      { label: 'Full transaction history', type: CROSS },
    ],
    cta: 'Current Plan', highlight: false,
  },
  {
    key: 'plus', name: 'Plus', price: '$4.99', period: '/mo',
    tagline: 'Build better money habits',
    badge: 'Best Value',
    features: [
      { label: '2 bank account connections', type: TICK },
      { label: '1-year transaction history', type: TICK },
      { label: 'Budget categories & alerts', type: TICK },
      { label: 'Monthly spending reports', type: TICK },
      { label: 'Net worth snapshot', type: TICK },
      { label: 'Savings goals', type: CROSS },
      { label: 'AI spending insights', type: CROSS },
    ],
    cta: 'Upgrade to Plus', highlight: false,
  },
  {
    key: 'pro', name: 'Pro', price: '$9.99', period: '/mo',
    tagline: 'Full financial clarity at a glance',
    badge: 'Most Popular',
    features: [
      { label: '5 bank account connections', type: TICK },
      { label: '2-year transaction history', type: TICK },
      { label: 'Everything in Plus', type: TICK },
      { label: 'Savings goals & progress tracking', type: TICK },
      { label: 'AI spending insights & tips', type: TICK },
      { label: 'Large transaction alerts', type: TICK },
      { label: 'Priority support', type: TICK },
    ],
    cta: 'Upgrade to Pro', highlight: true,
  },
  {
    key: 'max', name: 'Max', price: '$19.99', period: '/mo',
    tagline: 'For the financially serious',
    badge: 'Most Powerful',
    features: [
      { label: 'Unlimited bank connections', type: TICK },
      { label: 'Full transaction history (all time)', type: TICK },
      { label: 'Everything in Pro', type: TICK },
      { label: 'AI cash flow forecasting', type: TICK },
      { label: 'Tax category tagging', type: TICK },
      { label: 'Custom budget rules', type: TICK },
      { label: 'Monthly digest email reports', type: TICK },
    ],
    cta: 'Upgrade to Max', highlight: false,
  },
  {
    key: 'enterprise', name: 'Family', price: 'Custom', period: '',
    tagline: 'Shared finances for households & families',
    features: [
      { label: 'Unlimited members & accounts', type: TICK },
      { label: 'Everything in Max', type: TICK },
      { label: 'Shared budgets & goals', type: TICK },
      { label: 'Per-member spending views', type: TICK },
      { label: 'Family net worth dashboard', type: TICK },
      { label: 'Dedicated support', type: TICK },
      { label: 'Custom reporting', type: TICK },
    ],
    cta: 'Contact Us', highlight: false,
  },
]

const PLANS_SMALL_BIZ = [
  {
    key: 'free', name: 'Free', price: '$0', period: '/mo',
    tagline: 'Know where your cash stands today',
    features: [
      { label: '1 bank account connection', type: TICK },
      { label: '30-day cash flow view', type: TICK },
      { label: 'Basic expense categories', type: TICK },
      { label: 'Transaction history', type: TICK },
      { label: 'Budget tracking', type: CROSS },
      { label: 'Revenue reconciliation', type: CROSS },
      { label: 'AI cost insights', type: CROSS },
      { label: 'POS integration', type: CROSS },
    ],
    cta: 'Current Plan', highlight: false,
  },
  {
    key: 'plus', name: 'Plus', price: '$14.99', period: '/mo',
    tagline: 'Take control of business expenses',
    badge: 'Best Value',
    features: [
      { label: '3 bank account connections', type: TICK },
      { label: '1-year transaction history', type: TICK },
      { label: 'Expense categories & budgets', type: TICK },
      { label: 'Cash flow reports', type: TICK },
      { label: 'Monthly P&L summary', type: TICK },
      { label: 'POS integration', type: CROSS },
      { label: 'AI cost insights', type: CROSS },
    ],
    cta: 'Upgrade to Plus', highlight: false,
  },
  {
    key: 'pro', name: 'Pro', price: '$29.99', period: '/mo',
    tagline: 'Data-driven decisions for growing businesses',
    badge: 'Most Popular',
    features: [
      { label: '10 bank account connections', type: TICK },
      { label: 'Unlimited history view', type: TICK },
      { label: 'Everything in Plus', type: TICK },
      { label: 'POS / Oracle integration', type: TICK },
      { label: 'Revenue reconciliation', type: TICK },
      { label: 'AI cost & anomaly insights', type: TICK },
      { label: 'Priority support', type: TICK },
    ],
    cta: 'Upgrade to Pro', highlight: true,
  },
  {
    key: 'max', name: 'Max', price: '$59.99', period: '/mo',
    tagline: 'Everything you need to scale confidently',
    badge: 'Most Powerful',
    features: [
      { label: 'Unlimited bank connections', type: TICK },
      { label: 'Everything in Pro', type: TICK },
      { label: 'Full history sync (5 years)', type: TICK },
      { label: 'Labor cost tracking (Homebase)', type: TICK },
      { label: 'AI forecasting & predictions', type: TICK },
      { label: 'Savings goals', type: TICK },
      { label: 'Scheduled digest reports', type: TICK },
    ],
    cta: 'Upgrade to Max', highlight: false,
  },
  {
    key: 'enterprise', name: 'Enterprise', price: 'Custom', period: '',
    tagline: 'Multi-location & franchise management',
    features: [
      { label: 'Unlimited connections & locations', type: TICK },
      { label: 'Everything in Max', type: TICK },
      { label: 'Multi-location dashboard', type: TICK },
      { label: 'Custom integrations', type: TICK },
      { label: 'Dedicated account manager', type: TICK },
      { label: 'SLA guarantees', type: TICK },
      { label: 'Custom AI fine-tuning', type: TICK },
    ],
    cta: 'Contact Sales', highlight: false,
  },
]

export const PLANS_BY_SEGMENT = {
  restaurant: PLANS_RESTAURANT,
  individual: PLANS_INDIVIDUAL,
  small_biz:  PLANS_SMALL_BIZ,
}

const SEGMENT_LABELS = {
  restaurant: 'Restaurant',
  individual: 'Individual',
  small_biz:  'Small Business',
}

function FeatureIcon({ type }) {
  if (type === 'cross') return (
    <svg viewBox="0 0 16 16" fill="none" className="plan-feature-icon plan-feature-icon-cross">
      <circle cx="8" cy="8" r="7.5" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth=".8" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
  return (
    <svg viewBox="0 0 16 16" fill="none" className="plan-feature-icon">
      <circle cx="8" cy="8" r="7.5" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth=".8" />
      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <line x1="3" y1="3" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="15" y1="3" x2="3" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

const PLAN_LABEL = { free: 'Free', plus: 'Plus', pro: 'Pro', max: 'Max', enterprise: 'Enterprise' }

export default function PricingModal({ currentPlan = 'free', segment = 'restaurant', onClose, isAdmin = false, uid, onPlanChange }) {
  const plan  = currentPlan || 'free'
  const plans = PLANS_BY_SEGMENT[segment] || PLANS_BY_SEGMENT.restaurant
  const [switching, setSwitching] = useState(null)
  const [switchErr, setSwitchErr] = useState('')

  async function adminSwitch(planKey) {
    if (!isAdmin || planKey === plan) return
    setSwitching(planKey)
    setSwitchErr('')
    try {
      const r = await api.post('/api/admin/set-plan', { requester_id: uid, user_id: uid, plan: planKey })
      if (r.data.plan) {
        onPlanChange?.(r.data.plan)
        localStorage.setItem('plan', r.data.plan)
      } else {
        setSwitchErr(r.data.error || 'Switch failed')
      }
    } catch (ex) {
      setSwitchErr(ex.response?.data?.error || ex.message || 'Switch failed')
    }
    setSwitching(null)
  }

  function handleCta(p) {
    if (p.key === 'enterprise' || p.cta === 'Contact Us' || p.cta === 'Contact Sales') {
      window.location.href = 'mailto:support@jetcore.app?subject=Plan%20Inquiry'
    }
  }

  return (
    <div className="pricing-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pricing-modal">
        <button className="pricing-close" onClick={onClose} title="Close"><CloseIcon /></button>

        <div className="pricing-header">
          <h2>Choose your plan</h2>
          <p>
            Showing plans for <strong style={{ color: 'var(--accent)' }}>{SEGMENT_LABELS[segment] || 'Restaurant'}</strong>
            {' · '}Upgrade or downgrade anytime. No lock-in.
          </p>
        </div>

        <div className="pricing-grid">
          {plans.map(p => {
            const isCurrent = p.key === plan
            return (
              <div
                key={p.key}
                className={`plan-card${p.highlight ? ' plan-highlighted' : ''}${isCurrent ? ' plan-current' : ''}`}
              >
                {p.badge && !isCurrent && <div className="plan-badge">{p.badge}</div>}
                {isCurrent && <div className="plan-current-badge">{p.badge ? `${p.badge} · Your Plan` : 'Your Plan'}</div>}

                <div className="plan-name">{p.name}</div>

                <div className="plan-price">
                  <span className="plan-price-amount">{p.price}</span>
                  {p.period && <span className="plan-price-period">{p.period}</span>}
                </div>

                <div className="plan-tagline">{p.tagline}</div>

                <hr className="plan-divider" />

                <ul className="plan-features">
                  {p.features.map((f, i) => (
                    <li key={i} className={`plan-feature${f.type === 'cross' ? ' plan-feature-missing' : ''}`}>
                      <FeatureIcon type={f.type} />
                      <span>{f.label}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <button className="plan-cta plan-cta-current" disabled>Current Plan</button>
                ) : (p.cta === 'Contact Sales' || p.cta === 'Contact Us') ? (
                  <button className="plan-cta plan-cta-secondary" onClick={() => handleCta(p)}>{p.cta}</button>
                ) : (
                  <button className="plan-cta plan-cta-primary" onClick={() => handleCta(p)}>{p.cta}</button>
                )}

                {isAdmin && !isCurrent && (
                  <button
                    onClick={() => adminSwitch(p.key)}
                    disabled={switching === p.key}
                    style={{
                      marginTop: 8, width: '100%', padding: '6px',
                      background: 'transparent',
                      border: '1px dashed rgba(255,106,26,.4)',
                      borderRadius: 7, cursor: 'pointer',
                      fontSize: 11, fontWeight: 600,
                      color: 'rgba(255,106,26,.8)',
                      transition: 'border-color .2s, color .2s',
                    }}
                    title="Admin only — switches your account to this plan for testing"
                  >
                    {switching === p.key ? 'Switching…' : '⚡ Test as this plan'}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {isAdmin && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', marginTop: 12 }}>
            ⚡ Admin mode — use "Test as this plan" to simulate user experience per plan
          </p>
        )}
        {switchErr && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--red)', marginTop: 4 }}>
            {switchErr}
          </p>
        )}
        <p className="pricing-note">
          {`You're on the ${PLAN_LABEL[plan] || 'Free'} plan.`}
          {plan === 'free' && ' Upgrade to unlock the full platform.'}
        </p>
      </div>
    </div>
  )
}
