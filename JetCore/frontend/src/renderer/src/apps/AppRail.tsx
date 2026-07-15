/**
 * The JetCore app rail (leftmost, always visible) — the app SWITCHER. Discord-style
 * icon tiles for the four apps; click to switch. App switching lives here now (the
 * topbar shows a static current-app brand, no dropdown). Each app's own categorized
 * nav (with its context dropdown) is the SECOND column (AppNav / Summit's webview).
 */
import type { JSX } from 'react'
import { useStore } from '../store'
import AccountChip from '../components/AccountChip'
import { JETCORE_APPS } from './registry'

export default function AppRail(): JSX.Element {
  const activeApp = useStore((s) => s.activeApp)
  const setActiveApp = useStore((s) => s.setActiveApp)

  return (
    <aside className="dock rail apprail">
      <div className="apprail-apps">
        {JETCORE_APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={'apprail-tile' + (activeApp === a.id ? ' on' : '')}
            onClick={() => setActiveApp(a.id)}
            title={`${a.name} — ${a.audience}`}
            aria-label={a.name}
          >
            <a.Icon size={20} />
          </button>
        ))}
      </div>
      <div className="dock-foot">
        <AccountChip rail />
      </div>
    </aside>
  )
}
