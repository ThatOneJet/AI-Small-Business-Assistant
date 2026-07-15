/**
 * Renders the active NATIVE JetCore app (Hangar / DevBay / Pylon) in the shell
 * content area. Summit is not here — it's the Operations WebContentsView overlay,
 * handled by the 'operations' view path. Lazy-friendly: only the active app's
 * component mounts.
 */
import type { JSX } from 'react'
import { useStore } from '../store'
import HangarApp from './hangar/HangarApp'
import DevBayApp from './devbay/DevBayApp'
import PylonApp from './pylon/PylonApp'

export default function NativeAppHost(): JSX.Element {
  const activeApp = useStore((s) => s.activeApp)
  switch (activeApp) {
    case 'devbay':
      return <DevBayApp />
    case 'pylon':
      return <PylonApp />
    case 'hangar':
    default:
      return <HangarApp />
  }
}
