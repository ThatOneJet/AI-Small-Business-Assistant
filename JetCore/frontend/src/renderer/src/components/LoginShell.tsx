/**
 * Decks — cloud account login gate (Supabase + E2EE).
 *
 * A native React screen shown as a TOP-LEVEL gate before the Decks shell when no
 * cloud vault is unlocked. The shell's primary account is now SUPABASE:
 *  - Sign in / sign up authenticate to Supabase IN MAIN (window.decks.cloud.*).
 *  - The master password is sent to main, where it (1) authenticates to Supabase
 *    and (2) derives the local encryption key. The KEY and DEK never leave main;
 *    this screen only ever receives status (and, once on signup, a recovery key).
 *  - Signup surfaces the recovery key ONCE — the user must store it offline.
 *  - When a Supabase session is restored but the vault is LOCKED, the user
 *    re-enters their password here to unlock the DEK (it is never persisted).
 *
 * GREEN-accented by design (the `.login-*` block in index.css owns the styling).
 */
import { useState } from 'react'
import { useStore } from '../store'
import Logo from './Logo'

type Mode = 'login' | 'signup' | 'recover'

export default function LoginShell(): JSX.Element {
  const setView = useStore((s) => s.setView)
  const hydrateAfterUnlock = useStore((s) => s.hydrateAfterUnlock)

  const loginMode = useStore((s) => s.loginMode)
  const [mode, setMode] = useState<Mode>(loginMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [recoveryInput, setRecoveryInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Friendly info (e.g. "check your email") — shown neutral, not as an error. */
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The one-time recovery key to show after a successful signup.
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const isSignup = mode === 'signup'
  const isRecover = mode === 'recover'

  /**
   * Enter the shell once the vault is unlocked: hydrate THIS account's persisted
   * state (decks-state-<userId>.json — only now is getCloudAccount() set in main),
   * then switch to the restored surface. Hydration is what makes workspaces /
   * settings / web-deck logins isolated per JetCore account.
   */
  async function proceed(): Promise<void> {
    const next = await hydrateAfterUnlock().catch(() => 'home' as const)
    setView(next)
  }

  async function submit(e: React.FormEvent): Promise<void> {
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
        if (result.ok && result.unlocked) proceed()
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
      // info (not an error), and switch to the sign-in tab to use after confirming.
      if (result.pending) {
        setInfo(result.error ?? 'Check your email to confirm, then sign in.')
        setMode('login')
        setPassword('')
        return
      }
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong. Please try again.')
        return
      }
      // The recovery key is returned ONCE when the keyring is first created — at
      // signup (confirmation off) OR at the first sign-in after confirming. Show
      // it whenever it's present, regardless of which tab we're on.
      if (result.recoveryKey) {
        setRecoveryKey(result.recoveryKey)
        return
      }
      if (result.unlocked) proceed()
      else setError(result.error ?? 'Signed in, but the vault could not be unlocked.')
    } catch {
      setError('Could not reach the cloud. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // ── One-time recovery-key reveal (after signup) ──
  if (recoveryKey) {
    return (
      <div className="login-root">
        <div className="login-card">
          <div className="login-brand">
            <Logo size={40} tint="#ff3b3b" />
            <div className="login-brand-text">
              <h1>Save your recovery key</h1>
              <p>This is shown only once.</p>
            </div>
          </div>

          <p className="login-label" style={{ lineHeight: 1.5 }}>
            Store this offline somewhere safe. Your data is end-to-end encrypted:
            if you forget BOTH your password and this recovery key, your data is
            permanently unrecoverable — by design, no one (not even us) can reset it.
          </p>

          <pre
            style={{
              userSelect: 'all',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,59,59,0.4)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13
            }}
          >
            {recoveryKey}
          </pre>

          <button
            type="button"
            className="login-toggle"
            onClick={() => {
              navigator.clipboard?.writeText(recoveryKey).catch(() => {})
              setCopied(true)
            }}
          >
            {copied ? 'Copied ✓' : 'Copy recovery key'}
          </button>

          <button type="button" className="login-submit" onClick={() => setView('intent')}>
            I've saved it — continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="login-root">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <Logo size={40} tint="#ff3b3b" />
          <div className="login-brand-text">
            <h1>JetCore</h1>
            <p>
              {isSignup
                ? 'Create your encrypted account'
                : isRecover
                  ? 'Unlock with your recovery key'
                  : 'Sign in to your account'}
            </p>
          </div>
        </div>

        {!isRecover && (
          <label className="login-field">
            <span className="login-label">Email</span>
            <input
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}

        {isRecover && (
          <label className="login-field">
            <span className="login-label">Recovery key</span>
            <input
              type="text"
              autoComplete="off"
              placeholder="XXXXXXXX-XXXXXXXX-…"
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
            />
          </label>
        )}

        <label className="login-field">
          <span className="login-label">
            {isRecover ? 'New password (optional)' : 'Password'}
          </span>
          <input
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <div className="login-error">{error}</div>}
        {info && !error && <div className="login-info">{info}</div>}

        <button type="submit" className="login-submit" disabled={busy}>
          {busy
            ? 'Please wait…'
            : isSignup
              ? 'Create account'
              : isRecover
                ? 'Unlock'
                : 'Sign in'}
        </button>

        <button
          type="button"
          className="login-toggle"
          onClick={() => {
            setMode(isSignup ? 'login' : 'signup')
            setError(null)
            setInfo(null)
          }}
        >
          {isSignup ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>

        {!isSignup && (
          <button
            type="button"
            className="login-toggle"
            onClick={() => {
              setMode(isRecover ? 'login' : 'recover')
              setError(null)
              setInfo(null)
            }}
          >
            {isRecover ? 'Back to sign in' : 'Forgot password? Use your recovery key'}
          </button>
        )}
      </form>
    </div>
  )
}
