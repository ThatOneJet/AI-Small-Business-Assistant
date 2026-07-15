/**
 * JetCore pricing — a single generic plan that unlocks the whole platform. Dollar
 * amounts live in editable config (PLAN) since there are no real customers yet;
 * the entitlement is "has a JetCore account" for now (one plan, everything on).
 */
import type { JSX } from 'react'
import { useStore } from '../../store'

/** Edit these freely — pricing isn't finalized. `price: null` shows "Free (beta)". */
const PLAN = {
  name: 'JetCore',
  price: null as number | null,
  cadence: '/mo',
  tagline: 'One account unlocks every app.',
  features: [
    'Hangar, DevBay, Summit & Pylon',
    'End-to-end encrypted cloud sync across devices',
    'Connect GitHub, Canvas, Homebase, Plaid & more',
    'Automatic updates'
  ]
}

export default function Pricing(): JSX.Element {
  const gotoLogin = useStore((s) => s.gotoLogin)
  const setView = useStore((s) => s.setView)

  return (
    <div className="mk">
      <section className="mk-hero">
        <button className="mk-link" type="button" onClick={() => setView('marketing')}>← Back</button>
        <h1 className="mk-title mk-rise" style={{ fontSize: '34px' }}>Simple pricing</h1>
        <p className="mk-sub mk-rise" style={{ animationDelay: '60ms' }}>
          One plan, the whole platform. No per-app upsells.
        </p>

        <div className="mk-plan mk-rise" style={{ animationDelay: '120ms' }}>
          <div className="mk-plan-name">{PLAN.name}</div>
          <div className="mk-plan-price">
            {PLAN.price == null ? 'Free' : `$${PLAN.price}`}
            <span className="mk-plan-cadence">{PLAN.price == null ? ' · beta' : PLAN.cadence}</span>
          </div>
          <div className="mk-plan-tag">{PLAN.tagline}</div>
          <ul className="mk-plan-feats">
            {PLAN.features.map((f) => (
              <li key={f}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                {f}
              </li>
            ))}
          </ul>
          <button className="mk-btn primary" type="button" onClick={() => gotoLogin('signup')} style={{ width: '100%' }}>
            Get started
          </button>
        </div>
      </section>
    </div>
  )
}
