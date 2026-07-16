import { useEffect, useRef, useState } from 'react'

/**
 * Supademo-style guided tour: dims the screen, spotlights one element at a time,
 * and shows a captioned tooltip with Back / Next / Skip. Steps can switch tabs
 * (via onNavigate) so the tour walks the whole app. Fully skippable (Skip / Esc).
 */
export default function Tour({ steps, active, onNavigate, onClose }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const tipRef = useRef(null)
  const step = steps[i]

  const finish = () => {
    try { localStorage.setItem('summit_tour_done', '1') } catch {}
    window.dispatchEvent(new CustomEvent('summit-scan', { detail: 'close' }))   // close scanner if the tour left it open
    onClose()
  }
  const next = () => (i < steps.length - 1 ? setI(i + 1) : finish())
  const back = () => i > 0 && setI(i - 1)

  // Navigate to the step's tab, then locate the target element (poll until it renders).
  useEffect(() => {
    if (!step) return
    const switching = step.tab && step.tab !== active
    if (switching) onNavigate(step.tab, true)   // instant — no 380ms skeleton stall
    let raf = 0, tries = 0, cancelled = false, timer = 0
    // Some steps drive the live UI (e.g. open the product scanner and switch its
    // tab) so the tour can point at things that only exist while it's open.
    const applyAction = () => {
      const a = step.action
      if (a === 'closeScan') window.dispatchEvent(new CustomEvent('summit-scan', { detail: 'close' }))
      else if (a === 'openScan') window.dispatchEvent(new CustomEvent('summit-scan', { detail: 'open' }))
      else if (a === 'enrollTab' || a === 'scanTab') {
        window.dispatchEvent(new CustomEvent('summit-scan', { detail: 'open' }))
        window.dispatchEvent(new CustomEvent('summit-scan-tab', { detail: a === 'enrollTab' ? 'enroll' : 'scan' }))
      }
    }
    // Poll for the target once per frame — spotlight snaps into place the instant
    // the element (and its layout) is ready, instead of waiting a fixed delay.
    const locate = () => {
      if (cancelled) return
      if (!step.selector) { setRect(null); return }
      const el = document.querySelector(step.selector)
      const r = el && el.getBoundingClientRect()
      if (r && r.width > 1 && r.height > 1) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' })  // instant — no scroll-event repaint storm
        raf = requestAnimationFrame(() => { if (!cancelled) setRect(el.getBoundingClientRect()) })
      } else if (tries++ < 60) {
        raf = requestAnimationFrame(locate)
      } else { setRect(null) }
    }
    // Let the (instant) navigation / scanner action commit first, then start polling.
    timer = setTimeout(() => { applyAction(); raf = requestAnimationFrame(locate) }, switching ? 60 : 0)
    return () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(timer) }
  }, [i]) // eslint-disable-line

  // Realign only on resize (rAF-throttled) — no per-scroll handler, which was the lag source. Esc/arrows navigate.
  useEffect(() => {
    let raf = 0
    const reposition = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { if (step?.selector) { const el = document.querySelector(step.selector); if (el) setRect(el.getBoundingClientRect()) } })
    }
    const onKey = e => { if (e.key === 'Escape') finish(); if (e.key === 'ArrowRight') next(); if (e.key === 'ArrowLeft') back() }
    window.addEventListener('resize', reposition)
    window.addEventListener('keydown', onKey)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', reposition); window.removeEventListener('keydown', onKey) }
  }, [i, step]) // eslint-disable-line

  if (!step) return null

  const pad = 6
  const place = step.placement || 'bottom'
  const W = 330
  const clampL = l => Math.max(12, Math.min(l, window.innerWidth - W - 12))
  const clampT = t => Math.max(12, Math.min(t, window.innerHeight - 180))

  // Tooltip position from the spotlight rect + placement.
  let tip = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }
  if (rect && place === 'bottom') tip = { left: clampL(rect.left), top: rect.bottom + pad + 10, transform: 'none' }
  else if (rect && place === 'top') tip = { left: clampL(rect.left), top: rect.top - pad - 10, transform: 'translateY(-100%)' }
  else if (rect && place === 'right') tip = { left: clampL(rect.right + pad + 12), top: clampT(rect.top), transform: 'none' }
  else if (rect && place === 'left') tip = { left: clampL(rect.left - pad - 12 - W), top: clampT(rect.top), transform: 'none' }
  else if (place === 'bottom-center') tip = { left: '50%', bottom: 34, top: 'auto', transform: 'translateX(-50%)' }

  const spot = rect
    ? { position: 'fixed', left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2,
        borderRadius: 12, boxShadow: '0 0 0 9999px rgba(6,9,15,0.72)', border: '2px solid var(--acc-hi,#ff6161)', pointerEvents: 'none',
        transition: 'left .2s ease, top .2s ease, width .2s ease, height .2s ease', willChange: 'left, top, width, height', zIndex: 100000 }
    : { position: 'fixed', inset: 0, background: 'rgba(6,9,15,0.72)', pointerEvents: 'none', zIndex: 100000 }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100000 }}>
      <div style={spot} />
      <div ref={tipRef} style={{
        position: 'fixed', width: W, zIndex: 100001, ...tip,
        background: 'var(--bg-card,#12161f)', color: 'var(--t-1,#e6ecf5)',
        border: '1px solid var(--acc-line,rgba(255,59,59,.3))', borderRadius: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,.55)', padding: '15px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
          <span style={{ color: 'var(--acc-hi,#ff6161)', display: 'inline-flex' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
          </span>
          <span style={{ fontWeight: 700, fontSize: 13.5 }}>{step.title}</span>
          <button onClick={finish} title="Skip tour" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 17, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--t-2,#c7d0dc)' }}>{step.body}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{i + 1} of {steps.length}</span>
          <button onClick={finish} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>Skip</button>
          {i > 0 && <button className="btn btn-sm" onClick={back}>Back</button>}
          <button className="btn btn-primary btn-sm" onClick={next}>{i === steps.length - 1 ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  )
}

// The walkthrough script — one step at a time, through every page & feature.
export const TOUR_STEPS = [
  { tab: 'Dashboard', selector: null, placement: 'center', title: 'Welcome to Summit',
    body: "Quick tour of your business command center — it takes about a minute. Use Next (or → key), and Skip anytime." },
  { tab: 'Dashboard', selector: '[data-tour="nav"]', placement: 'bottom', title: 'Navigate here',
    body: 'Move between your Dashboard, Sales, Expenses, Inventory, Reviews and Labor from this top bar.' },
  { tab: 'Dashboard', selector: '[data-tour="profile"]', placement: 'bottom', title: 'Business profile',
    body: 'Describe your business — industry, goals, margin/labor targets — so the AI tunes its advice to you.' },
  { tab: 'Dashboard', selector: '[data-tour="optimize"]', placement: 'bottom', title: 'AI Optimize',
    body: 'One click gives you prioritized, quantified recommendations across every section. Filter to any area for a deeper dive.' },
  { tab: 'Dashboard', selector: '[data-tour="chat"]', placement: 'top', title: 'Ask the AI',
    body: 'Chat with a local AI that answers any business question straight from your own numbers, then asks a follow-up to go deeper.' },
  { tab: 'Dashboard', selector: '[data-tour="cards"]', placement: 'top', title: 'Your data at a glance',
    body: 'A live card appears for each dataset you upload. Click any card to open its full view.' },
  { tab: 'Sales', selector: '[data-tour="tabbody"]', placement: 'bottom-center', title: 'Sales',
    body: 'Revenue, orders, average order value and your product-mix charts — all from your uploaded sales file.' },
  { tab: 'Expenses', selector: '[data-tour="tabbody"]', placement: 'bottom-center', title: 'Expenses',
    body: 'Total spend, a by-category chart, your top vendors, and the monthly trend line.' },
  { tab: 'Inventory', selector: '[data-tour="tabbody"]', placement: 'bottom-center', title: 'Inventory',
    body: 'Stock value at cost, per-SKU margins, and low-stock alerts so you never run out of a hero product.' },
  { tab: 'Inventory', selector: '[data-tour="scan"]', placement: 'bottom', action: 'closeScan', title: 'Count stock with your camera',
    body: "Summit can recognize your products by sight — no barcodes, no typing. Point a camera at an item and it counts it for you. Let's open the scanner and take a look." },
  { tab: 'Inventory', selector: '[data-tour="scan-stream"]', placement: 'right', action: 'openScan', title: 'A live view of your products',
    body: "This is a live feed from your webcam. Whatever you hold inside the red box is what Summit looks at — it ignores your hand and the background, so counts stay accurate." },
  { tab: 'Inventory', selector: '[data-tour="scan-enroll"]', placement: 'left', action: 'enrollTab', title: 'Add a product once',
    body: "To teach Summit a product, hold it up and capture a few photos from different angles, then Save. It only takes a few seconds, and you just do it once per item." },
  { tab: 'Inventory', selector: '[data-tour="scan-count"]', placement: 'left', action: 'scanTab', title: 'Then scan & count',
    body: "Press Start scanning and hold items up one at a time — Summit adds each to the tally on its own. Adjust with +/- if you need to, then Apply to update your inventory counts." },
  { tab: 'Reviews', selector: '[data-tour="tabbody"]', placement: 'bottom-center', title: 'Reviews',
    body: 'Average rating, the star-distribution chart, and your best- and worst-rated products.' },
  { tab: 'Labor', selector: '[data-tour="tabbody"]', placement: 'bottom-center', title: 'Labor',
    body: 'Hours, cost, overtime, and labor as a share of sales — with charts across your timesheet data.' },
  { tab: 'Dashboard', selector: null, placement: 'center', title: "You're all set",
    body: 'Import your files on each tab, then hit AI Optimize or Ask the AI. Replay this tour anytime from the “?” in the top bar.' },
]
