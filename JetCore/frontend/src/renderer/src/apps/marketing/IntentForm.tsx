/**
 * Signup "intent" step — shown once after account creation: "What are you planning
 * to use JetCore for?" The answers are stored (encrypted) in the vault under
 * `jetcore.intent` and used by Hangar to feature/guide the apps the user picked.
 */
import { useState, type JSX } from 'react'
import { useStore } from '../../store'
import type { AppId } from '../registry'

const CHOICES: { app: AppId; label: string; sub: string; Icon: JSX.Element }[] = [
  {
    app: 'devbay',
    label: 'Building or coding',
    sub: 'DevBay — projects + shipping',
    Icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 9-3 3 3 3" /><path d="m16 9 3 3-3 3" /><path d="m13 7-2 10" /></svg>
    )
  },
  {
    app: 'summit',
    label: 'Running a business',
    sub: 'Summit — operations + finances',
    Icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 18 5-9 4 5 3-4 6 8z" /></svg>
  },
  {
    app: 'pylon',
    label: 'School',
    sub: 'Pylon — grades + deadlines',
    Icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10 12 4 2 10l10 6 10-6Z" /><path d="M6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5" /></svg>
  }
]

export default function IntentForm(): JSX.Element {
  const hydrateAfterUnlock = useStore((s) => s.hydrateAfterUnlock)
  const setView = useStore((s) => s.setView)
  const [picked, setPicked] = useState<Set<AppId>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggle = (app: AppId): void =>
    setPicked((p) => {
      const n = new Set(p)
      n.has(app) ? n.delete(app) : n.add(app)
      return n
    })

  async function finish(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const apps = [...picked]
      await window.decks?.vault
        ?.set({ key: 'jetcore.intent', plaintext: JSON.stringify({ apps, at: new Date().toISOString() }) })
        .catch(() => {})
    } finally {
      // Always land in Hangar (the hub); it uses the saved intent to guide setup.
      const next = await hydrateAfterUnlock().catch(() => 'app' as const)
      setView(next)
    }
  }

  return (
    <div className="login-root">
      <div className="login-card" style={{ maxWidth: 460 }}>
        <div className="login-brand">
          <div className="login-brand-text">
            <h1>What brings you to JetCore?</h1>
            <p>Pick any that fit — we’ll set up your hub around them.</p>
          </div>
        </div>

        <div className="intent-grid">
          {CHOICES.map((c) => (
            <button
              key={c.app}
              type="button"
              className={'intent-opt' + (picked.has(c.app) ? ' on' : '')}
              onClick={() => toggle(c.app)}
            >
              <span className="intent-opt-mark">{c.Icon}</span>
              <span className="intent-opt-text">
                <span className="intent-opt-label">{c.label}</span>
                <span className="intent-opt-sub">{c.sub}</span>
              </span>
              <span className="intent-opt-check">
                {picked.has(c.app) && (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                )}
              </span>
            </button>
          ))}
        </div>

        <button type="button" className="login-submit" onClick={finish} disabled={busy}>
          {busy ? 'Setting up…' : picked.size ? 'Continue' : 'Skip for now'}
        </button>
      </div>
    </div>
  )
}
