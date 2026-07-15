/**
 * OperationsView — the geometry slot for the native JetCore Operations app.
 *
 * When the user switches to the "Operations" mode (dock app-switcher), App.tsx
 * renders this full-area below the titlebar. It:
 *   1. starts/reuses the JetCore backend via window.decks.operations.start(),
 *   2. on success, attaches + positions the native Operations WebContentsView
 *      over this slot — mirroring SplitView, a ResizeObserver measures this
 *      element's pixel rect and reports it via operations.show({ bounds }) on
 *      mount AND on every resize,
 *   3. on unmount, detaches the view via operations.hide().
 *
 * The native view paints ABOVE the DOM, so the container is intentionally just
 * an empty positioned slot — the loading / error chrome only shows until the
 * native view is attached (or when start() fails).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import FadeContent from '../bits/FadeContent'
import { useStore } from '../store'

type Phase = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string }

// Module-level: once the backend + webview have loaded this session, switching
// BACK to Summit shouldn't flash a loading screen — the webview stays alive in
// main (it's only detached/hidden). So later mounts skip straight to ready.
let everReady = false

export default function OperationsView(): JSX.Element {
  const slotRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<Phase>(everReady ? { kind: 'ready' } : { kind: 'loading' })
  // Only reveal the loading chrome if startup actually takes a beat — a pre-warmed
  // backend resolves in well under this, so Summit just pops in with no flash.
  const [showLoader, setShowLoader] = useState(false)
  useEffect(() => {
    if (everReady) return
    const t = setTimeout(() => setShowLoader(true), 300)
    return () => clearTimeout(t)
  }, [])
  // When the app-switcher dropdown opens, step the native Operations view aside
  // (it paints above the DOM and would otherwise cover the menu); restore on close.
  const switcherOpen = useStore((s) => s.switcherOpen)
  // Guards the resize→show calls so we never push bounds before start() resolves
  // (and so a late ResizeObserver tick after unmount can't re-attach the view).
  const readyRef = useRef(false)

  // Measure this slot's pixel rect and hand it to main so the native Operations
  // view overlays exactly here. Mirrors SplitView.measureAndReport.
  const measureAndReport = useCallback(() => {
    if (!readyRef.current) return
    const el = slotRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return
    window.decks?.operations?.show({
      bounds: {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height)
      }
    })
  }, [])

  // ── Start the backend on mount; attach + begin positioning on success. ──
  useEffect(() => {
    let cancelled = false
    // Already loaded earlier this session → reveal instantly (no loading flash);
    // the webview is still alive in main, just detached.
    if (everReady) {
      readyRef.current = true
      measureAndReport()
      requestAnimationFrame(measureAndReport)
    }
    ;(async () => {
      const r = await window.decks?.operations
        ?.start()
        .catch((e: unknown): { error: string } => ({
          error: e instanceof Error ? e.message : String(e)
        }))
      if (cancelled) return
      if (!r || r.error) {
        setPhase({
          kind: 'error',
          message: r?.error || 'The JetCore Operations backend is not available.'
        })
        return
      }
      everReady = true
      readyRef.current = true
      setPhase({ kind: 'ready' })
      // Position immediately (and again next frame once layout settles).
      measureAndReport()
      requestAnimationFrame(measureAndReport)
    })()
    return () => {
      cancelled = true
      readyRef.current = false
      window.decks?.operations?.hide()
    }
  }, [measureAndReport])

  // Re-measure on first paint and whenever the slot resizes (window resize,
  // dock collapse, etc.) — same pattern SplitView uses for deck panes.
  useLayoutEffect(() => {
    measureAndReport()
  }, [measureAndReport, phase.kind])

  // Hide the native view while the switcher dropdown is open; re-show on close.
  useEffect(() => {
    if (!readyRef.current) return
    if (switcherOpen) window.decks?.operations?.hide()
    else measureAndReport()
  }, [switcherOpen, measureAndReport])

  useEffect(() => {
    const el = slotRef.current
    if (!el) return
    const ro = new ResizeObserver(() => measureAndReport())
    ro.observe(el)
    const onWin = (): void => measureAndReport()
    window.addEventListener('resize', onWin)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWin)
    }
  }, [measureAndReport])

  return (
    <div className="ops-slot" ref={slotRef}>
      {phase.kind === 'loading' && showLoader && (
        <FadeContent className="ops-overlay" blur>
          <div className="ops-loader">
            <div className="ops-spark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width={28} height={28} fill="currentColor">
                <polygon points="13,3 7.5,13 12,13 10.5,21 17,10.5 12.5,10.5 14.5,3" />
              </svg>
            </div>
            <div className="ops-loader-txt">Starting JetCore Operations…</div>
            <div className="ops-spinner" aria-hidden="true" />
          </div>
        </FadeContent>
      )}

      {phase.kind === 'error' && (
        <FadeContent className="ops-overlay">
          <div className="ops-error-card">
            <div className="ops-error-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </div>
            <div className="ops-error-title">Couldn’t start Operations</div>
            <div className="ops-error-msg">{phase.message}</div>
            <div className="ops-error-hint">
              Make sure the JetCore backend is built and available, then switch
              back to Operations from the dock to retry.
            </div>
          </div>
        </FadeContent>
      )}
    </div>
  )
}
