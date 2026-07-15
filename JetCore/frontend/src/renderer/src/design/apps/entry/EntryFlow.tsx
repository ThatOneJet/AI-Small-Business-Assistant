/* ============================================================
   JetCore — Entry flow: Marketing + Pricing + Auth + Intent.
   Ported from design/jetcore/project/src/entry.jsx, wired to the
   REAL E2EE cloud account (window.decks.cloud / window.decks.vault)
   with the exact semantics of components/LoginShell.tsx:
     - signup may return `pending` (email confirmation) → friendly info,
       switch to sign-in;
     - the one-time `recoveryKey` (when present) MUST be shown before
       continuing — losing password + key = unrecoverable by design;
     - sign-in errors offer the recovery-key path;
     - `notConfigured` → cloud sync unavailable on this build.
   ============================================================ */
import {
  useEffect,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type JSX,
  type ReactNode
} from 'react'
import { Badge, Button, Field, IconButton, Input } from '../../ui'
import { AnimatedList, BlurText, Magnet, Reveal, SpotlightCard, Ticker } from '../../motion'
import { Icon } from '../../icons'
import { applyTheme, readTheme, type JCAppId } from '../../contract'

/* ---------------- the four-app family (mirrors the prototype's APPS) ---------------- */
interface AppDef {
  id: JCAppId
  name: string
  glyph: string
  who: string
  desc: string
}
const APPS: AppDef[] = [
  { id: 'hangar', name: 'Hangar', glyph: 'hangar', who: 'Everyone', desc: 'Everything at a glance.' },
  { id: 'devbay', name: 'DevBay', glyph: 'devbay', who: 'Developers', desc: 'Make scattered repos legible, ship in two steps.' },
  { id: 'summit', name: 'Summit', glyph: 'summit', who: 'Operators', desc: "Sales, labor, finances — what's trending wrong." },
  { id: 'pylon', name: 'Pylon', glyph: 'pylon', who: 'Students', desc: 'Grades decoded, due dates by urgency.' }
]

/* ---------------- brand mark (prototype shell.jsx CoreMark) ---------------- */
function CoreMark({ size = 26 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M12 2.5C14.4 5.8 14.4 9.5 12 12 9.6 9.5 9.6 5.8 12 2.5Z" />
        <path d="M12 21.5C9.6 18.2 9.6 14.5 12 12 14.4 14.5 14.4 18.2 12 21.5Z" />
        <path d="M2.5 12C5.8 9.6 9.5 9.6 12 12 9.5 14.4 5.8 14.4 2.5 12Z" />
        <path d="M21.5 12C18.2 14.4 14.5 14.4 12 12 14.5 9.6 18.2 9.6 21.5 12Z" />
      </g>
      <circle cx="12" cy="12" r="2.1" fill="currentColor" />
    </svg>
  )
}

function Logo({ size = 28, withText = true }: { size?: number; withText?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
      <div
        style={{
          width: size + 12,
          height: size + 12,
          borderRadius: 'var(--r-sm)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--accent-ink)',
          background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))',
          boxShadow: '0 6px 18px -8px var(--accent-glow)'
        }}
      >
        <CoreMark size={size} />
      </div>
      {withText && <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em' }}>JetCore</span>}
    </div>
  )
}

/* full-screen scroll wrapper for logged-out pages */
function FullScreen({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg)' }}>{children}</div>
}

/* ---------------- error / info notices (real auth feedback) ---------------- */
function Notice({ tone, children }: { tone: 'neg' | 'accent'; children: ReactNode }): JSX.Element {
  const neg = tone === 'neg'
  return (
    <div
      style={{
        padding: '11px 14px',
        borderRadius: 'var(--r-sm)',
        fontSize: 13.5,
        lineHeight: 1.45,
        background: neg ? 'color-mix(in oklch, var(--neg) 12%, transparent)' : 'var(--accent-soft)',
        border: `1px solid ${neg ? 'color-mix(in oklch, var(--neg) 28%, transparent)' : 'var(--accent-line)'}`,
        color: neg ? 'var(--neg)' : 'var(--accent-h)'
      }}
    >
      {children}
    </div>
  )
}

/* ============================================================
   Marketing — hero + apps + pricing + footer
   ============================================================ */
interface Plan {
  name: string
  price: number
  tagline: string
  feats: string[]
  cta: string
  popular?: boolean
}
const PLANS: Plan[] = [
  { name: 'Free', price: 0, tagline: 'For getting started', feats: ['All four apps', '1 workspace', 'Live integrations', 'On-device encryption'], cta: 'Start free' },
  { name: 'Pro', price: 14, tagline: 'For people who run on it', feats: ['Everything in Free', 'Unlimited workspaces', 'Cross-device sync', 'AI recommendations', 'Priority sync'], cta: 'Go Pro', popular: true },
  { name: 'Max', price: 29, tagline: 'For multi-location operators', feats: ['Everything in Pro', 'Unlimited locations', 'Advanced analytics', 'Custom alert rules', 'Team handoff'], cta: 'Go Max' }
]

function Marketing({
  onSignIn,
  onSignUp,
  theme,
  setTheme
}: {
  onSignIn: () => void
  onSignUp: () => void
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
}): JSX.Element {
  return (
    <FullScreen>
      {/* nav */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backdropFilter: 'blur(16px)',
          background: 'color-mix(in oklch, var(--bg) 78%, transparent)',
          borderBottom: '1px solid var(--border)'
        }}
      >
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Logo />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <a href="#apps" style={{ padding: '9px 14px', fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>
              Apps
            </a>
            <a href="#pricing" style={{ padding: '9px 14px', fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>
              Pricing
            </a>
            <IconButton
              name={theme === 'dark' ? 'sun' : 'moon'}
              label="Theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            />
            <Button variant="ghost" size="sm" onClick={onSignIn}>
              Sign in
            </Button>
            <Button variant="primary" size="sm" iconRight="arrowR" onClick={onSignUp}>
              Get started
            </Button>
          </div>
        </div>
      </div>

      {/* hero */}
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: -160,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 900,
            height: 520,
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--accent-soft), transparent 68%)',
            opacity: 0.7,
            pointerEvents: 'none'
          }}
        />
        <div style={{ position: 'relative', maxWidth: 920, margin: '0 auto', padding: '84px 32px 60px', textAlign: 'center' }}>
          <Reveal>
            <Badge tone="accent" icon="shield" style={{ marginBottom: 22 }}>
              End-to-end encrypted · one account
            </Badge>
          </Reveal>
          <h1 style={{ fontSize: 60, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05, marginBottom: 22 }}>
            <BlurText text="Everything that matters," />
            <br />
            <Reveal
              delay={520}
              style={{
                display: 'inline-block',
                background: 'linear-gradient(100deg, var(--accent-h), var(--accent-d))',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent'
              }}
            >
              legible at a glance.
            </Reveal>
          </h1>
          <Reveal delay={760}>
            <p style={{ fontSize: 19, color: 'var(--text-2)', maxWidth: 600, margin: '0 auto 34px', lineHeight: 1.55 }}>
              One desktop platform, four focused apps.{' '}
              <Ticker
                words={['Your business', 'Your repos', 'Your coursework']}
                style={{ color: 'var(--text)', fontWeight: 600, textAlign: 'left' }}
              />{' '}
              — pulled out of the tools that bury it and put in front of you.
            </p>
          </Reveal>
          <Reveal delay={900}>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <Magnet strength={0.25}>
                <Button variant="primary" size="lg" iconRight="arrowR" onClick={onSignUp}>
                  Get started free
                </Button>
              </Magnet>
              <Button variant="surface" size="lg" icon="eye" onClick={onSignUp}>
                See it in action
              </Button>
            </div>
          </Reveal>
          <Reveal delay={1000}>
            <div style={{ marginTop: 18, fontSize: 13, color: 'var(--text-3)' }}>
              No credit card · works offline · your data stays on your device
            </div>
          </Reveal>
        </div>
      </div>

      {/* apps */}
      <div id="apps" style={{ maxWidth: 1180, margin: '0 auto', padding: '40px 32px 70px' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>Four apps. One family.</h2>
          <p style={{ fontSize: 16, color: 'var(--text-3)', marginTop: 10 }}>
            Each built for a different person. All speaking the same language.
          </p>
        </div>
        <AnimatedList stagger={90} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 18 }}>
          {APPS.map((a) => (
            <div key={a.id} data-app={a.id}>
              <SpotlightCard
                className="jc-card jc-card-hover"
                strength={0.13}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)',
                  padding: 28,
                  display: 'flex',
                  gap: 20,
                  alignItems: 'flex-start'
                }}
              >
                <div
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: 'var(--r-md)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--accent-ink)',
                    background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))',
                    boxShadow: '0 10px 26px -10px var(--accent-glow)',
                    flex: '0 0 auto'
                  }}
                >
                  <Icon name={a.glyph} size={28} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                    <h3 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em' }}>{a.name}</h3>
                    <Badge size="sm" tone="accent">
                      {a.who}
                    </Badge>
                  </div>
                  <p style={{ fontSize: 14.5, color: 'var(--text-3)', lineHeight: 1.5 }}>{a.desc}</p>
                </div>
              </SpotlightCard>
            </div>
          ))}
        </AnimatedList>
      </div>

      {/* pricing */}
      <div id="pricing" style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 32px' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em' }}>Simple pricing</h2>
            <p style={{ fontSize: 16, color: 'var(--text-3)', marginTop: 10 }}>Start free. Upgrade when a workspace needs more.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18, alignItems: 'stretch' }}>
            {PLANS.map((p, i) => (
              <Reveal key={p.name} delay={i * 90}>
                <div
                  style={{
                    position: 'relative',
                    height: '100%',
                    padding: 28,
                    borderRadius: 'var(--r-lg)',
                    background: 'var(--surface)',
                    border: `1px solid ${p.popular ? 'var(--accent-line)' : 'var(--border)'}`,
                    boxShadow: p.popular ? '0 20px 50px -24px var(--accent-glow)' : 'none',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                >
                  {p.popular && (
                    <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)' }}>
                      <Badge tone="accent" icon="bolt">
                        Most popular
                      </Badge>
                    </div>
                  )}
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2, marginBottom: 18 }}>{p.tagline}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginBottom: 22 }}>
                    <span className="mono" style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em' }}>
                      ${p.price}
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--text-3)' }}>/mo</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 11, flex: 1, marginBottom: 24 }}>
                    {p.feats.map((f) => (
                      <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--text-2)' }}>
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 99,
                            display: 'grid',
                            placeItems: 'center',
                            background: 'var(--accent-soft)',
                            color: 'var(--accent-h)',
                            flex: '0 0 auto'
                          }}
                        >
                          <Icon name="check" size={12} stroke={2.6} />
                        </span>
                        {f}
                      </div>
                    ))}
                  </div>
                  <Button variant={p.popular ? 'primary' : 'surface'} full onClick={onSignUp}>
                    {p.cta}
                  </Button>
                </div>
              </Reveal>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 22, fontSize: 13.5, color: 'var(--text-3)' }}>
            Running something bigger?{' '}
            <a onClick={onSignUp} style={{ color: 'var(--accent-h)', fontWeight: 600, cursor: 'pointer' }}>
              Talk to us about Enterprise →
            </a>
          </div>
        </div>
      </div>

      {/* footer */}
      <div
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          padding: '40px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16
        }}
      >
        <Logo size={22} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-3)' }}>
          <Icon name="shield" size={15} />
          Your tokens never leave your device, encrypted end-to-end.
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>© 2026 JetCore</div>
      </div>
    </FullScreen>
  )
}

/* ============================================================
   Auth — sign in / sign up / recovery against window.decks.cloud
   ============================================================ */
type AuthMode = 'signup' | 'signin' | 'recover'

/** Outcome of a successful auth step, bubbled up to the flow machine. */
interface AuthOutcome {
  /** The one-time recovery key (must be shown before continuing), when present. */
  recoveryKey: string | null
  /** True when the account was created in this session (signup path → intent). */
  viaSignup: boolean
}

function AuthFlow({
  initialMode,
  onBack,
  onComplete
}: {
  initialMode: 'signup' | 'signin'
  onBack: () => void
  onComplete: (o: AuthOutcome) => void
}): JSX.Element {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Friendly info (e.g. "check your email") — neutral, not an error. */
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isSignup = mode === 'signup'
  const isRecover = mode === 'recover'

  function switchMode(next: AuthMode): void {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    setError(null)
    setInfo(null)

    if (isRecover) {
      if (!recoveryInput.trim()) {
        setError('Enter your recovery key.')
        return
      }
    } else {
      if (!email.trim() || !password) {
        setError('Email and password are required.')
        return
      }
      if (isSignup && password.length < 8) {
        setError('Use a password of at least 8 characters.')
        return
      }
    }

    setBusy(true)
    try {
      if (isRecover) {
        const result = await window.decks.cloud.recover({
          recoveryKey: recoveryInput.trim(),
          newPassword: password || undefined
        })
        if (result.ok && result.unlocked) onComplete({ recoveryKey: null, viaSignup: false })
        else setError(result.error ?? 'Could not unlock with that recovery key.')
        return
      }

      const result = isSignup
        ? await window.decks.cloud.signUp({ email: email.trim(), password })
        : await window.decks.cloud.signIn({ email: email.trim(), password })

      if (result.notConfigured) {
        setError('Cloud sync is not configured on this build.')
        return
      }
      // Email confirmation is ON: account made, but no session yet. Friendly
      // info (not an error) and switch to sign-in to use after confirming.
      if (result.pending) {
        setInfo(result.error ?? 'Check your email to confirm your account, then sign in.')
        setMode('signin')
        setPassword('')
        return
      }
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong. Please try again.')
        return
      }
      // The recovery key is returned ONCE when the keyring is first created —
      // at signup (confirmation off) OR at the first sign-in after confirming.
      // It must be shown before anything else happens.
      if (result.recoveryKey) {
        onComplete({ recoveryKey: result.recoveryKey, viaSignup: isSignup })
        return
      }
      if (result.unlocked) onComplete({ recoveryKey: null, viaSignup: isSignup })
      else setError(result.error ?? 'Signed in, but the vault could not be unlocked.')
    } catch {
      setError('Could not reach the cloud. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const heading = isSignup ? 'Create your account' : isRecover ? 'Recover your vault' : 'Welcome back'
  const sub = isSignup
    ? 'Free to start. No card required.'
    : isRecover
      ? 'Enter the one-time recovery key you saved at signup.'
      : 'Sign in to your JetCore account.'

  return (
    <FullScreen>
      <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {/* brand panel */}
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--panel)',
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '40px'
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -100,
              left: -80,
              width: 480,
              height: 480,
              borderRadius: '50%',
              background: 'radial-gradient(circle, var(--accent-soft), transparent 70%)',
              opacity: 0.8
            }}
          />
          <button
            className="tap"
            onClick={onBack}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-3)',
              fontSize: 14,
              fontWeight: 600,
              width: 'fit-content'
            }}
          >
            <Icon name="chevL" size={16} />
            Back
          </button>
          <div style={{ position: 'relative' }}>
            <Logo size={34} />
            <h2 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 28, lineHeight: 1.1 }}>
              One account.
              <br />
              The whole platform.
            </h2>
            <p style={{ fontSize: 16, color: 'var(--text-2)', marginTop: 14, maxWidth: 380, lineHeight: 1.55 }}>
              Sign in once and move between Hangar, DevBay, Summit, and Pylon — no switching tools.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
              {APPS.map((a) => (
                <div
                  key={a.id}
                  data-app={a.id}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 'var(--r-md)',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--accent-ink)',
                    background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))'
                  }}
                >
                  <Icon name={a.glyph} size={20} />
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: 'var(--text-3)' }}>
            <Icon name="lock" size={15} />
            Protected by on-device encryption
          </div>
        </div>

        {/* form */}
        <div style={{ display: 'grid', placeItems: 'center', padding: '40px' }}>
          <Reveal style={{ width: '100%', maxWidth: 380 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.025em' }}>{heading}</h1>
            <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 6, marginBottom: 26 }}>{sub}</p>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {!isRecover && (
                <Field label="Email">
                  <Input
                    icon="send"
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                  />
                </Field>
              )}
              {isRecover && (
                <Field label="Recovery key">
                  <Input
                    icon="shield"
                    placeholder="XXXXXXXX-XXXXXXXX-…"
                    type="text"
                    autoComplete="off"
                    value={recoveryInput}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setRecoveryInput(e.target.value)}
                  />
                </Field>
              )}
              <Field
                label={isRecover ? 'New password (optional)' : 'Password'}
                hint={isRecover ? 'Leave blank to keep your current password.' : undefined}
              >
                <Input
                  icon="lock"
                  placeholder="••••••••"
                  type="password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                />
              </Field>

              {error && <Notice tone="neg">{error}</Notice>}
              {info && !error && <Notice tone="accent">{info}</Notice>}
              {error && mode === 'signin' && (
                <button
                  type="button"
                  onClick={() => switchMode('recover')}
                  style={{ alignSelf: 'flex-start', fontSize: 13, fontWeight: 600, color: 'var(--accent-h)' }}
                >
                  Password not unlocking your vault? Use your recovery key →
                </button>
              )}

              <Button variant="primary" size="lg" full iconRight="arrowR" disabled={busy}>
                {busy ? 'Please wait…' : isSignup ? 'Create account' : isRecover ? 'Unlock' : 'Sign in'}
              </Button>
            </form>

            <div style={{ textAlign: 'center', marginTop: 22, fontSize: 14, color: 'var(--text-3)' }}>
              {isRecover ? (
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  style={{ color: 'var(--accent-h)', fontWeight: 700, whiteSpace: 'nowrap' }}
                >
                  Back to sign in
                </button>
              ) : (
                <>
                  {isSignup ? 'Already have an account? ' : 'New to JetCore? '}
                  <button
                    type="button"
                    onClick={() => switchMode(isSignup ? 'signin' : 'signup')}
                    style={{ color: 'var(--accent-h)', fontWeight: 700, whiteSpace: 'nowrap' }}
                  >
                    {isSignup ? 'Sign in' : 'Create one'}
                  </button>
                </>
              )}
            </div>
            {mode === 'signin' && (
              <div style={{ textAlign: 'center', marginTop: 10, fontSize: 13 }}>
                <button
                  type="button"
                  onClick={() => switchMode('recover')}
                  style={{ color: 'var(--text-3)', fontWeight: 600 }}
                >
                  Forgot password? Use your recovery key
                </button>
              </div>
            )}
          </Reveal>
        </div>
      </div>
    </FullScreen>
  )
}

/* ============================================================
   One-time recovery-key reveal — shown ONCE, must be saved
   ============================================================ */
function RecoveryKeyStep({ recoveryKey, onContinue }: { recoveryKey: string; onContinue: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <FullScreen>
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '40px', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: -140,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 700,
            height: 420,
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--accent-soft), transparent 68%)',
            opacity: 0.6
          }}
        />
        <Reveal style={{ position: 'relative', width: '100%', maxWidth: 560 }}>
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 36,
              boxShadow: '0 20px 50px -24px var(--accent-glow)'
            }}
          >
            <Badge tone="accent" icon="shield" style={{ marginBottom: 18 }}>
              Shown only once
            </Badge>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 10 }}>Save your recovery key</h1>
            <p style={{ fontSize: 14.5, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 20 }}>
              Your account is end-to-end encrypted. If you forget BOTH your password and this recovery key, your data is
              permanently unrecoverable — by design, no one (not even us) can reset it. Store it offline somewhere safe.
            </p>
            <pre
              className="mono"
              style={{
                userSelect: 'all',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                margin: '0 0 18px',
                padding: '14px 16px',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)',
                border: '1px solid var(--accent-line)',
                fontSize: 13.5,
                lineHeight: 1.5
              }}
            >
              {recoveryKey}
            </pre>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button
                variant="surface"
                icon="copy"
                onClick={() => {
                  navigator.clipboard?.writeText(recoveryKey).catch(() => {})
                  setCopied(true)
                }}
              >
                {copied ? 'Copied ✓' : 'Copy key'}
              </Button>
              <Button variant="primary" iconRight="arrowR" style={{ flex: 1 }} onClick={onContinue}>
                I've saved it — continue
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </FullScreen>
  )
}

/* ============================================================
   Intent — "what will you use JetCore for?" (multi-select)
   ============================================================ */
type IntentApp = 'devbay' | 'summit' | 'pylon'

interface IntentOpt {
  id: IntentApp
  title: string
  sub: string
  apps: string
}
const INTENT_OPTS: IntentOpt[] = [
  { id: 'devbay', title: 'I build software', sub: 'Repos, releases, shipping', apps: 'DevBay' },
  { id: 'summit', title: 'I run a business', sub: 'Sales, labor, finances', apps: 'Summit' },
  { id: 'pylon', title: "I'm a student", sub: 'Grades, deadlines', apps: 'Pylon' }
]

function IntentFlow({ onDone }: { onDone: () => void }): JSX.Element {
  const [picked, setPicked] = useState<IntentApp[]>([])
  const [busy, setBusy] = useState(false)

  const toggle = (id: IntentApp): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  /** Persist the choice to the E2EE vault (auth + unlock already happened). */
  async function finish(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      if (picked.length) {
        await window.decks.vault.set({
          key: 'jetcore.intent',
          plaintext: JSON.stringify({ apps: picked, at: new Date().toISOString() })
        })
      }
    } catch {
      /* a prefs write must never trap the user at the door */
    }
    onDone()
  }

  return (
    <FullScreen>
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '40px', position: 'relative', overflow: 'hidden' }}>
        <div
          style={{
            position: 'absolute',
            top: -140,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 700,
            height: 420,
            borderRadius: '50%',
            background: 'radial-gradient(circle, var(--accent-soft), transparent 68%)',
            opacity: 0.6
          }}
        />
        <div style={{ position: 'relative', width: '100%', maxWidth: 620, textAlign: 'center' }}>
          <Reveal>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Logo size={30} withText={false} />
            </div>
          </Reveal>
          <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', margin: '22px 0 10px' }}>
            <BlurText text="What will you use JetCore for?" />
          </h1>
          <Reveal delay={500}>
            <p style={{ fontSize: 16, color: 'var(--text-2)', marginBottom: 34 }}>
              Pick what fits — we'll set up your Hangar around it. You can change this anytime.
            </p>
          </Reveal>
          <AnimatedList stagger={90} baseDelay={300} style={{ display: 'flex', flexDirection: 'column', gap: 13, marginBottom: 30 }}>
            {INTENT_OPTS.map((o) => {
              const on = picked.includes(o.id)
              return (
                <button
                  key={o.id}
                  data-app={o.id}
                  className="tap"
                  onClick={() => toggle(o.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '18px 20px',
                    borderRadius: 'var(--r-lg)',
                    textAlign: 'left',
                    width: '100%',
                    background: on ? 'var(--accent-soft)' : 'var(--surface)',
                    border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'all .2s var(--ease)'
                  }}
                >
                  <div
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 'var(--r-md)',
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--accent-ink)',
                      background: 'linear-gradient(140deg, var(--accent-h), var(--accent-d))',
                      flex: '0 0 auto'
                    }}
                  >
                    <Icon name={o.id} size={24} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16.5, fontWeight: 700 }}>{o.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>
                      {o.sub} · <span style={{ color: 'var(--accent-h)', fontWeight: 600 }}>{o.apps}</span>
                    </div>
                  </div>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 99,
                      display: 'grid',
                      placeItems: 'center',
                      border: `2px solid ${on ? 'var(--accent)' : 'var(--border-2)'}`,
                      background: on ? 'var(--accent)' : 'transparent',
                      color: 'var(--accent-ink)'
                    }}
                  >
                    {on && <Icon name="check" size={15} stroke={3} />}
                  </div>
                </button>
              )
            })}
          </AnimatedList>
          <Reveal delay={640}>
            <Button variant="primary" size="lg" iconRight="arrowR" onClick={finish} style={{ minWidth: 220 }} disabled={busy}>
              {busy ? 'Setting up…' : picked.length ? 'Enter JetCore' : 'Skip for now'}
            </Button>
          </Reveal>
        </div>
      </div>
    </FullScreen>
  )
}

/* ============================================================
   EntryFlow — the state machine
   marketing (+pricing) → auth → [recovery key] → [intent] → onDone
   ============================================================ */
type Step = 'marketing' | 'auth' | 'key' | 'intent'

export function EntryFlow({ onDone }: { onDone: () => void }): JSX.Element {
  const [step, setStep] = useState<Step>('marketing')
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup')
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [theme, setThemeState] = useState<'dark' | 'light'>(readTheme())

  // Make sure data-theme is applied even when the entry flow is the first mount.
  useEffect(() => {
    applyTheme(readTheme())
  }, [])

  const setTheme = (t: 'dark' | 'light'): void => {
    applyTheme(t)
    setThemeState(t)
  }

  function handleAuthComplete(o: AuthOutcome): void {
    if (o.recoveryKey) {
      // The keyring was just created (signup, or first sign-in after email
      // confirmation) — the key MUST be saved before anything else.
      setRecoveryKey(o.recoveryKey)
      setStep('key')
      return
    }
    if (o.viaSignup) {
      setStep('intent')
      return
    }
    onDone()
  }

  if (step === 'auth') {
    return <AuthFlow initialMode={authMode} onBack={() => setStep('marketing')} onComplete={handleAuthComplete} />
  }
  if (step === 'key' && recoveryKey) {
    return <RecoveryKeyStep recoveryKey={recoveryKey} onContinue={() => setStep('intent')} />
  }
  if (step === 'intent') {
    return <IntentFlow onDone={onDone} />
  }
  return (
    <Marketing
      theme={theme}
      setTheme={setTheme}
      onSignIn={() => {
        setAuthMode('signin')
        setStep('auth')
      }}
      onSignUp={() => {
        setAuthMode('signup')
        setStep('auth')
      }}
    />
  )
}

/* keep CSSProperties referenced for explicit style typing in future tweaks */
export type { CSSProperties as JCEntryStyle }
