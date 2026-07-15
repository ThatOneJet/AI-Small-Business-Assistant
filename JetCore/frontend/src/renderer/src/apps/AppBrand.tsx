/**
 * Static current-app brand for the topbar — the active app's icon + name (no
 * dropdown; app switching lives in the left rail now).
 */
import type { JSX } from 'react'
import { useStore } from '../store'
import { getApp } from './registry'

export default function AppBrand(): JSX.Element {
  const activeApp = useStore((s) => s.activeApp)
  const app = getApp(activeApp)
  return (
    <div className="appbrand no-drag" title={`${app.name} — ${app.audience}`}>
      <span className="appbrand-mark">
        <app.Icon size={16} />
      </span>
      <span className="appbrand-name">{app.short}</span>
    </div>
  )
}
