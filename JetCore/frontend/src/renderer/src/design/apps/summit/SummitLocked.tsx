/* Summit · locked state — shown in place of the operations app for accounts that
   aren't entitled (Individual plan). Summit stays visible in the rail for everyone
   (discoverability); opening it lands here with an upgrade path. The upgrade is
   intentionally manual: there's no self-serve switch, so we ask them to email us
   and we set their account to Small Business / Enterprise. */
import type { JSX } from 'react'
import { Card, Button } from '../../ui'
import { Reveal } from '../../motion'
import { Icon } from '../../icons'
import { Page } from './shared'

/** Where upgrade requests go. */
export const SUPPORT_EMAIL = 'adityasrijeet12355@gmail.com'

export function SummitLocked(): JSX.Element {
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('JetCore Summit access')}&body=${encodeURIComponent(
    "Hi — I'd like to use Summit. Please upgrade my account to Small Business / Enterprise."
  )}`
  return (
    <Page>
      <Reveal>
        <div style={{ display: 'grid', placeItems: 'center', minHeight: '68vh' }}>
          <Card style={{ maxWidth: 540, width: '100%', textAlign: 'center', padding: '44px 38px' }}>
            <div
              style={{
                width: 66,
                height: 66,
                margin: '0 auto 22px',
                borderRadius: 'var(--r-lg)',
                display: 'grid',
                placeItems: 'center',
                background: 'var(--accent-soft)',
                color: 'var(--accent-h)'
              }}
            >
              <Icon name="lock" size={30} />
            </div>
            <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 12 }}>
              Summit is for businesses
            </h1>
            <p style={{ fontSize: 15, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 10 }}>
              Sales, labor, and finances — Summit is available to{' '}
              <strong style={{ color: 'var(--text-2)' }}>Small Business</strong> and{' '}
              <strong style={{ color: 'var(--text-2)' }}>Enterprise</strong> accounts. Yours is on the Individual
              plan.
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 28 }}>
              To get access — so we can tailor the sales &amp; tender CSV import to your POS exports — email us and
              we'll set you up.
            </p>
            <a href={mailto} style={{ textDecoration: 'none' }}>
              <Button variant="primary" icon="send" size="lg">
                Email us to upgrade
              </Button>
            </a>
            <div className="mono" style={{ marginTop: 14, fontSize: 13, color: 'var(--text-3)' }}>
              {SUPPORT_EMAIL}
            </div>
          </Card>
        </div>
      </Reveal>
    </Page>
  )
}
