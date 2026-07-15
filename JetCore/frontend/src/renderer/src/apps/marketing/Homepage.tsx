/**
 * JetCore marketing homepage — the first thing a logged-out visitor sees.
 * Describes JetCore + the four apps (who each is for) and routes to signup /
 * signin / pricing. Uses the unified red accent + the JetCore look.
 */
import type { JSX } from 'react'
import { useStore } from '../../store'
import { JETCORE_APPS } from '../registry'

const BLURB: Record<string, string> = {
  hangar: 'Your overview hub — every app at a glance, one place to jump in.',
  devbay: 'For developers. Make scattered repos legible and automate shipping.',
  summit: 'For business owners. Sales, labor and cash — and what’s trending wrong.',
  pylon: 'For students. Grades, weights and due dates Canvas buries, decoded.'
}

export default function Homepage(): JSX.Element {
  const gotoLogin = useStore((s) => s.gotoLogin)
  const setView = useStore((s) => s.setView)

  return (
    <div className="mk">
      <section className="mk-hero">
        <div className="mk-badge mk-rise">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M13 2 4.5 13.2c-.4.5 0 1.3.7 1.3H11l-1 8 8.8-11.7c.4-.5 0-1.3-.7-1.3H12l1-7.5Z" /></svg>
          One account. Every tool.
        </div>
        <h1 className="mk-title mk-rise" style={{ animationDelay: '60ms' }}>
          JetCore makes your <span className="mk-accent">scattered data</span> legible.
        </h1>
        <p className="mk-sub mk-rise" style={{ animationDelay: '120ms' }}>
          One dashboard for builders, business owners and students — your projects,
          operations and school, pulled together and end-to-end encrypted.
        </p>
        <div className="mk-cta mk-rise" style={{ animationDelay: '180ms' }}>
          <button className="mk-btn primary" type="button" onClick={() => gotoLogin('signup')}>
            Get started
          </button>
          <button className="mk-btn" type="button" onClick={() => gotoLogin('login')}>
            Sign in
          </button>
          <button className="mk-link" type="button" onClick={() => setView('pricing')}>
            See pricing →
          </button>
        </div>
      </section>

      <section className="mk-apps">
        {JETCORE_APPS.map((a, i) => (
          <div key={a.id} className="mk-app mk-rise" style={{ animationDelay: `${220 + i * 70}ms` }}>
            <span className="mk-app-mark"><a.Icon size={22} /></span>
            <div className="mk-app-name">{a.name}</div>
            <div className="mk-app-aud">{a.audience}</div>
            <p className="mk-app-blurb">{BLURB[a.id]}</p>
          </div>
        ))}
      </section>

      <footer className="mk-foot">
        <span>JetCore</span>
        <span>End-to-end encrypted · one account for everything</span>
      </footer>
    </div>
  )
}
