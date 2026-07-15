/**
 * UpdateOverlay — the in-app auto-update popup.
 *
 * Main pushes update-lifecycle events (update:status); when the app is behind we
 * show a centered, modal popup that the update is happening, with a custom
 * progress bar while it downloads and a "Restart & update" button once it's ready.
 *
 * DEV preview: with no real update to trigger in dev, press Ctrl+Shift+U to run a
 * simulated available → downloading → downloaded sequence.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { UpdateStatusEvent } from '@shared/ipc'

type State = UpdateStatusEvent['state']

export default function UpdateOverlay(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatusEvent>({ state: 'idle' })

  // Subscribe to the real updater lifecycle from main.
  useEffect(() => {
    const off = window.decks?.update?.onStatus((e) => setStatus(e))
    return () => off?.()
  }, [])

  // DEV-only: preview the popup without shipping a new release.
  useEffect(() => {
    const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
    if (!isDev) return
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'u')) return
      e.preventDefault()
      setStatus({ state: 'available', version: '1.0.99' })
      let pct = 0
      const id = setInterval(() => {
        pct += 7
        if (pct >= 100) {
          clearInterval(id)
          setStatus({ state: 'downloaded', version: '1.0.99' })
        } else {
          setStatus({ state: 'downloading', version: '1.0.99', percent: pct })
        }
      }, 180)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { state, version, percent, error } = status
  // Only surface the popup once there's actually something to show.
  const visible: State[] = ['available', 'downloading', 'downloaded', 'error']
  if (!visible.includes(state)) return null

  const downloaded = state === 'downloaded'
  const errored = state === 'error'
  // available → indeterminate (download just started); downloading → real percent.
  const pct = downloaded ? 100 : Math.max(0, Math.min(100, percent ?? 0))

  const title = errored
    ? 'Update failed'
    : downloaded
      ? 'Update ready'
      : 'Updating JetCore'
  const sub = errored
    ? error || 'Could not download the update. It will retry next launch.'
    : downloaded
      ? `Version ${version ?? ''} is ready. Restart to finish.`
      : `A new version${version ? ` (${version})` : ''} is available and downloading…`

  return createPortal(
    <div className="upd-backdrop">
      <div className="upd-card" role="dialog" aria-modal="true" aria-label="Application update">
        <div className="upd-logo">
          {/* The JetCore mark — same blue square as the dock brand. */}
          <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--accent, #2f6bff)" />
            <path d="M8 7h8M12 7v8m0 0l-3-3m3 3l3-3" stroke="#fff" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <div className="upd-title">{title}</div>
        <div className="upd-sub">{sub}</div>

        {!errored && (
          <div className="upd-bar">
            <div
              className={'upd-bar-fill' + (downloaded ? ' done' : '') + (state === 'available' ? ' indet' : '')}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {!errored && !downloaded && (
          <div className="upd-pct">{state === 'available' ? 'Starting…' : `${pct}%`}</div>
        )}

        {downloaded && (
          <button className="upd-btn" type="button" onClick={() => window.decks?.update?.restart()}>
            Restart &amp; update
          </button>
        )}
        {errored && (
          <button className="upd-btn ghost" type="button" onClick={() => setStatus({ state: 'idle' })}>
            Dismiss
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
