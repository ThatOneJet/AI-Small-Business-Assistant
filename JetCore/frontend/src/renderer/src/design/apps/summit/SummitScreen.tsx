/* ============================================================
   JetCore — Summit (operations) screen.

   A small header + an underline-active sub-nav (Overview · Sales &
   tenders · Labor · Finances · Accounts) and a period selector
   (7d / 30d / 90d / YTD) that drives the data tabs. Each tab is its
   own component and lazy-loads its data the first time it's opened;
   api.ts memoises GETs so switching back is instant.

   The backend spawn race was fixed in main, so first load is ~1s: we
   render the tab immediately and each tab shows a full-page skeleton
   that mirrors its real layout (YouTube-style) until its data lands.
   Mirrors the prototype (design/jetcore/project/src/summit.jsx +
   summit_b.jsx).
   ============================================================ */
import { useCallback, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { Segmented } from '../../ui'
import { Icon } from '../../icons'
import type { JCScreenProps } from '../../contract'
import { ytdDays } from './api'
import { Overview } from './Overview'
import { Sales } from './Sales'
import { Labor } from './Labor'
import { Finances } from './Finances'
import { Accounts } from './Accounts'
import { LaborBoard } from './signature/LaborBoard'
import type { SummitTab } from './shared'

const TABS: { id: SummitTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'sales', label: 'Sales & tenders', icon: 'receipt' },
  { id: 'labor', label: 'Labor', icon: 'people' },
  { id: 'finances', label: 'Finances', icon: 'wallet' },
  { id: 'accounts', label: 'Accounts', icon: 'link' }
]

type Period = '7d' | '30d' | '90d' | 'ytd'
const PERIOD_OPTS = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'ytd', label: 'YTD' }
]
function daysFor(p: Period): number {
  if (p === '7d') return 7
  if (p === '30d') return 30
  if (p === '90d') return 90
  return ytdDays()
}

export function SummitScreen(props: JCScreenProps): JSX.Element {
  void props // Summit navigates entirely through its own tabs.
  const [tab, setTab] = useState<SummitTab>('overview')
  const [period, setPeriod] = useState<Period>('30d')

  const goAccounts = useCallback(() => setTab('accounts'), [])
  const days = daysFor(period)
  const showPeriod = tab !== 'accounts'

  // Sliding active-underline: measure the active tab button and animate a single
  // shared accent bar to its position so it glides between sections rather than
  // snapping per-button.
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [ink, setInk] = useState<{ left: number; width: number }>({ left: 0, width: 0 })
  useLayoutEffect(() => {
    const measure = (): void => {
      const el = btnRefs.current[tab]
      if (el) setInk({ left: el.offsetLeft, width: el.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [tab])

  return (
    <div>
      {/* header + sub-nav (sticky; the shell provides the scroll container) */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 40px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            {TABS.map((t) => {
              const on = tab === t.id
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    btnRefs.current[t.id] = el
                  }}
                  className="tap"
                  onClick={() => setTab(t.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '16px 16px 14px',
                    fontSize: 14,
                    fontWeight: 600,
                    color: on ? 'var(--text)' : 'var(--text-3)',
                    transition: 'color .2s var(--ease)'
                  }}
                  onMouseEnter={(e) => {
                    if (!on) e.currentTarget.style.color = 'var(--text-2)'
                  }}
                  onMouseLeave={(e) => {
                    if (!on) e.currentTarget.style.color = 'var(--text-3)'
                  }}
                >
                  <Icon name={t.icon} size={16} style={{ color: on ? 'var(--accent-h)' : 'currentColor' }} />
                  {t.label}
                </button>
              )
            })}
            {/* single accent underline that glides to the active tab */}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                bottom: -1,
                left: ink.left,
                width: ink.width,
                height: 2,
                borderRadius: 99,
                background: 'var(--accent)',
                transition: 'left .32s var(--spring), width .32s var(--spring)',
                pointerEvents: 'none'
              }}
            />
          </div>
          {showPeriod && (
            <div style={{ paddingBottom: 11 }}>
              <Segmented options={PERIOD_OPTS} value={period} onChange={(v) => setPeriod(v as Period)} size="sm" />
            </div>
          )}
        </div>
      </div>

      {/* body — tabs render immediately; each shows its own full-page skeleton */}
      <div>
        {tab === 'overview' ? (
          <Overview days={days} onConnect={goAccounts} onTab={setTab} />
        ) : tab === 'sales' ? (
          <Sales days={days} onConnect={goAccounts} />
        ) : tab === 'labor' ? (
          <>
            <LaborBoard days={days} onConnect={goAccounts} />
            <Labor days={days} onConnect={goAccounts} />
          </>
        ) : tab === 'finances' ? (
          <Finances days={days} onConnect={goAccounts} />
        ) : (
          <Accounts />
        )}
      </div>
    </div>
  )
}
