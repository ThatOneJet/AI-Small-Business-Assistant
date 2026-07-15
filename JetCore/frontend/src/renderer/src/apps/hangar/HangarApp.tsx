/**
 * JetCore Hangar — the hub users land on after login. Shows each app as a launch
 * card (jump straight in), and uses the saved signup intent (jetcore.intent in the
 * vault) to feature the apps the user said they'd use + nudge first setup.
 *
 * Live per-app status summaries (real numbers from each app's vault namespace)
 * land as those apps come online in Wave 4; for now the cards focus on launching
 * + onboarding, which is Hangar's core job.
 */
import { useEffect, useState, type JSX } from 'react'
import { AppPage } from '../AppPage'
import { useStore } from '../../store'
import { JETCORE_APPS, getApp, type AppId } from '../registry'

const BLURB: Record<string, string> = {
  devbay: 'Make scattered repos legible and automate shipping.',
  summit: 'Sales, labor and cash — and what’s trending wrong.',
  pylon: 'Grades, weights and due dates Canvas buries, decoded.'
}
const SETUP: Partial<Record<AppId, string>> = {
  devbay: 'Connect GitHub to get started',
  summit: 'Connect your POS / Homebase',
  pylon: 'Add your Canvas token'
}

export default function HangarApp(): JSX.Element {
  const setActiveApp = useStore((s) => s.setActiveApp)
  const [intent, setIntent] = useState<Set<AppId>>(new Set())

  useEffect(() => {
    let alive = true
    void window.decks?.vault
      ?.get('jetcore.intent')
      .then((raw) => {
        if (!alive || !raw) return
        try {
          const apps = (JSON.parse(raw).apps ?? []) as AppId[]
          setIntent(new Set(apps))
        } catch {
          /* ignore */
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // The launchable apps (everything except Hangar itself), featured-first.
  const apps = JETCORE_APPS.filter((a) => a.id !== 'hangar').sort(
    (a, b) => Number(intent.has(b.id)) - Number(intent.has(a.id))
  )

  return (
    <AppPage app={getApp('hangar')}>
      <div className="jc-grid">
        {apps.map((a, i) => {
          const featured = intent.has(a.id)
          return (
            <button
              key={a.id}
              type="button"
              className={'jc-card jc-launch jc-rise' + (featured ? ' featured' : '')}
              style={{ animationDelay: `${40 + i * 60}ms` }}
              onClick={() => setActiveApp(a.id)}
            >
              <span className="jc-launch-head">
                <span className="jc-launch-mark"><a.Icon size={20} /></span>
                {featured && <span className="jc-launch-badge">For you</span>}
              </span>
              <span className="jc-card-title">{a.name}</span>
              <span className="jc-card-body">{BLURB[a.id]}</span>
              <span className="jc-launch-cta">{featured ? (SETUP[a.id] ?? 'Open') : 'Open'} →</span>
            </button>
          )
        })}
      </div>
      <p className="jc-note">
        Hangar is your hub — jump into any app above. Live status summaries appear here as each app is connected.
      </p>
    </AppPage>
  )
}
