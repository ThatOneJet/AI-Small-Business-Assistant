/* First-run walkthrough — a 5-step overlay shown once after a new account's first
   sign-in, to orient them to the apps, the Core launcher, importing data, and
   personalization. The "seen" flag is per-account (keyed by email) so each login
   gets its own first run. */
import { useState, type JSX, type ReactNode } from 'react'
import { Overlay, Reveal } from './motion'
import { Button } from './ui'
import { Icon } from './icons'
import { APPS } from './apps'
import { CoreMark } from './shell'

const ONBOARD_PREFIX = 'jc.onboarded:'

export function hasOnboarded(email: string): boolean {
  if (!email) return true // no account → nothing to onboard
  try {
    return localStorage.getItem(ONBOARD_PREFIX + email.toLowerCase()) === '1'
  } catch {
    return false
  }
}

export function markOnboarded(email: string): void {
  if (!email) return
  try {
    localStorage.setItem(ONBOARD_PREFIX + email.toLowerCase(), '1')
  } catch {
    /* ignore — a missed flag just re-shows the tour, never blocks the app */
  }
}

interface Step {
  title: string
  body: ReactNode
  visual: ReactNode
}

/** The four apps in a row, each tinted with its own accent (via data-app). */
function AppsVisual(): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
      {APPS.map((a) => (
        <div key={a.id} data-app={a.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, width: 64 }}>
          <div
            style={{
              width: 50,
              height: 50,
              borderRadius: 'var(--r-md)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--accent-ink)',
              background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))',
              boxShadow: '0 8px 20px -8px var(--accent-glow)'
            }}
          >
            <Icon name={a.glyph} size={24} />
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700 }}>{a.name}</span>
        </div>
      ))}
    </div>
  )
}

function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd
      className="mono"
      style={{
        fontSize: 14,
        fontWeight: 700,
        border: '1px solid var(--border-2)',
        borderRadius: 'var(--r-sm)',
        padding: '8px 13px',
        background: 'var(--surface-2)',
        color: 'var(--text)'
      }}
    >
      {children}
    </kbd>
  )
}

function IconBubble({ name }: { name: string }): JSX.Element {
  return (
    <div style={{ width: 72, height: 72, borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
      <Icon name={name} size={34} />
    </div>
  )
}

export function Walkthrough({
  name,
  canSummit,
  onDone
}: {
  name: string
  canSummit: boolean
  onDone: () => void
}): JSX.Element {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
  const mod = isMac ? '⌘' : 'Ctrl'

  const steps: Step[] = [
    {
      title: `Welcome${name ? `, ${name}` : ''}`,
      body: 'JetCore brings your tools into one place — one account, one window. Here’s a 30-second tour.',
      visual: (
        <div style={{ color: 'var(--accent-h)' }}>
          <CoreMark size={64} spinning />
        </div>
      )
    },
    {
      title: 'Four apps, one login',
      body: 'Hangar is home. Summit runs your operations, DevBay your repos, Pylon your coursework — switch between them from the rail on the left.',
      visual: <AppsVisual />
    },
    {
      title: 'Jump anywhere',
      body: (
        <>
          Press <Kbd>{mod}</Kbd> <Kbd>K</Kbd> to open the Core launcher — switch apps, search, and run actions
          without leaving the keyboard.
        </>
      ),
      visual: (
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <Kbd>{mod}</Kbd>
          <span style={{ color: 'var(--text-3)', fontWeight: 700 }}>+</span>
          <Kbd>K</Kbd>
        </div>
      )
    },
    {
      title: 'Bring in your data',
      body: canSummit
        ? 'In Summit, connect your POS and scheduling — or import a CSV of sales/tenders — to see revenue, labor, and what’s trending wrong.'
        : 'Connect your accounts in each app to pull in your real data. Everything syncs securely to your JetCore account.',
      visual: <IconBubble name={canSummit ? 'summit' : 'link'} />
    },
    {
      title: 'Make it yours',
      body: 'Tune the theme, accent color, and roundness in Settings whenever you like. You’re all set — let’s go.',
      visual: <IconBubble name="sliders" />
    }
  ]

  const [i, setI] = useState(0)
  const step = steps[i]
  const last = i === steps.length - 1
  const next = (): void => (last ? onDone() : setI((n) => n + 1))

  return (
    <Overlay open onClose={onDone} align="center" panelStyle={{ width: 'min(540px, 92vw)' }}>
      <div
        style={{
          background: 'var(--glass)',
          backdropFilter: 'blur(26px)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-xl)',
          boxShadow: '0 40px 90px -30px hsl(var(--shadow-c)/.7)',
          overflow: 'hidden'
        }}
      >
        <div style={{ padding: '44px 32px 6px', display: 'grid', placeItems: 'center', minHeight: 132 }}>
          <Reveal key={`v${i}`}>{step.visual}</Reveal>
        </div>

        <div style={{ padding: '14px 38px 4px', textAlign: 'center' }}>
          <Reveal key={`t${i}`}>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 10 }}>{step.title}</h2>
            <p style={{ fontSize: 14.5, color: 'var(--text-3)', lineHeight: 1.6 }}>{step.body}</p>
          </Reveal>
        </div>

        {/* step dots (clickable) */}
        <div style={{ display: 'flex', gap: 7, justifyContent: 'center', padding: '22px 0 4px' }}>
          {steps.map((_, n) => (
            <button
              key={n}
              aria-label={`Step ${n + 1}`}
              onClick={() => setI(n)}
              style={{
                width: n === i ? 22 : 7,
                height: 7,
                borderRadius: 99,
                background: n === i ? 'var(--accent)' : 'var(--surface-3)',
                transition: 'all .3s var(--spring)'
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px 22px' }}>
          <Button variant="ghost" size="sm" onClick={onDone}>
            Skip
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            {i > 0 && (
              <Button variant="surface" size="sm" icon="chevL" onClick={() => setI((n) => n - 1)}>
                Back
              </Button>
            )}
            {last ? (
              <Button variant="primary" size="sm" icon="check" onClick={next}>
                Get started
              </Button>
            ) : (
              <Button variant="primary" size="sm" iconRight="arrowR" onClick={next}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}
