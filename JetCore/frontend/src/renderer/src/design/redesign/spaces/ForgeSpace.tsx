/**
 * JetCore redesign — Forge space ("the Hangar's workbench").
 *
 * Design intent (JetCore.dc.html 878–899 renderForge + data 978–986): Forge is a
 * node-canvas planner — boxes carry a title/description and named inputs/outputs,
 * notes thread to the box they annotate, output→input connections wire a system
 * together, and the whole graph pans/zooms and saves to the vault.
 *
 * KEY DECISION — REUSE, don't rebuild. A fully-working React Flow Forge already
 * lives at design/apps/forge/ForgeScreen.tsx (add box w/ optional ports, inline
 * edit, per-port handles, note→box threads with marching-ants pick mode, pan/zoom,
 * debounced vault save to 'forge.graph'). This space simply PRESENTS it inside the
 * warm-editorial Hangar: a "disp" header with the amber Forge accent (hue 55) and a
 * one-line intro + live box-count stat, above the existing canvas which fills the
 * rest of the height. All of ForgeScreen's behaviour — and its vault persistence —
 * keeps working untouched; navigation is handled by the shell, so the screen's
 * {go, openSettings} props get no-op stubs.
 *
 * Layout note: React Flow needs a DEFINITE height to render. The root is a 100%-tall
 * flex column (fixed-height header + flex:1 canvas wrapper); the wrapper sets the
 * height:100% chain so <ForgeScreen/> (height:100% inside) measures correctly.
 */
import { useEffect, useState, type JSX } from 'react'
import { ForgeScreen } from '../../apps/forge/ForgeScreen'
import { Icon } from '../../icons'
import { tone, DOMAINS } from '../system'

const VAULT_KEY = 'forge.graph'

/** Live box count from the saved graph (honest stat — no fake data). */
function useBoxCount(): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const raw = await window.decks?.vault?.get(VAULT_KEY)
        if (!alive) return
        if (!raw) {
          setCount(0)
          return
        }
        const g = JSON.parse(raw) as { nodes?: Array<{ type?: string }> }
        const boxes = Array.isArray(g.nodes) ? g.nodes.filter((n) => n?.type === 'box').length : 0
        setCount(boxes)
      } catch {
        if (alive) setCount(0)
      }
    })()
    return () => {
      alive = false
    }
  }, [])
  return count
}

export function ForgeSpace(): JSX.Element {
  const d = DOMAINS.forge
  const t = tone(d.hue, d.c) // amber, hue 55
  const boxes = useBoxCount()

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* ── warm-editorial header ─────────────────────────────────────────── */}
      <header
        style={{
          flex: '0 0 auto',
          padding: '18px 26px 16px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
          borderBottom: '1px solid var(--line)',
          background: `linear-gradient(180deg, ${t.wash}, transparent)`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              display: 'grid',
              placeItems: 'center',
              color: t.ink,
              background: `linear-gradient(140deg,${t.bright},${t.deep})`,
              boxShadow: `0 12px 28px -14px ${t.line}`,
              flex: '0 0 auto'
            }}
          >
            <Icon name={d.glyph} size={24} stroke={2} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="disp" style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
              Forge
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.4, maxWidth: 540 }}>
              Plan any system on a canvas — boxes with named inputs &amp; outputs, notes threaded to what they annotate.
              It saves to your vault as you go.
            </p>
          </div>
        </div>

        {/* live box-count stat (honest: from the real saved graph) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <span
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 13px',
              borderRadius: 999,
              background: t.soft,
              color: t.bright,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.02em'
            }}
          >
            <Icon name={DOMAINS.forge.glyph} size={14} stroke={2} />
            {boxes == null ? '—' : `${boxes} ${boxes === 1 ? 'box' : 'boxes'}`}
          </span>
        </div>
      </header>

      {/* ── the existing React Flow canvas, given a definite height ────────── */}
      {/* data-app="forge" re-derives --accent to the amber Forge hue so the canvas
          edges/handles aren't the shell's red (data-app="hangar") accent. */}
      <div data-app="forge" style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* ForgeScreen renders a height:100% canvas; stub the shell-handled nav. */}
        <ForgeScreen go={() => {}} openSettings={() => {}} />
      </div>
    </div>
  )
}
