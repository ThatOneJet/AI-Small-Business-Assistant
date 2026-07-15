/* Summit signature — the HOME hero: today's DAILY VERDICT (did I make money?)
   beside this week's BIGGEST LEAK (what to fix). Both compute from the real
   connected Summit data; the leak's fix opens the labor board. Inherits the
   JetCore design system exactly (Card, Badge, tokens, motion). */
import { useMemo, type JSX } from 'react'
import { Badge, Button, Card } from '../../../ui'
import { Reveal, AnimatedList } from '../../../motion'
import { Icon } from '../../../icons'
import { money } from '../../../charts'
import { fmtDay } from '../api'
import type { ProfitResponse, SalesResponse, LaborResponse, InsightsResponse } from '../api'
import { buildVerdict, buildLeaks, dowName, type Leak, type VerdictReason } from './engine'

const TONE_VAR: Record<VerdictReason['tone'], string> = {
  pos: 'var(--pos)',
  neg: 'var(--neg)',
  neutral: 'var(--text-2)'
}

/** A plain reason tag (the "why" behind the verdict). */
function ReasonTag({ r }: { r: VerdictReason }): JSX.Element {
  const c = TONE_VAR[r.tone]
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 11px',
        borderRadius: 'var(--r-pill)',
        fontSize: 12.5,
        fontWeight: 600,
        letterSpacing: '0.01em',
        color: c,
        background: `color-mix(in oklch, ${c} 12%, transparent)`
      }}
    >
      <Icon name={r.icon} size={13} />
      {r.text}
    </span>
  )
}

export function DailyHero({
  profit,
  sales,
  labor,
  insights,
  days,
  onOpenLabor
}: {
  profit: ProfitResponse
  sales: SalesResponse
  labor: LaborResponse
  insights: InsightsResponse
  days: number
  onOpenLabor: () => void
}): JSX.Element | null {
  const verdict = useMemo(() => buildVerdict(profit, sales, labor), [profit, sales, labor])
  const leaks = useMemo(() => buildLeaks(labor, insights, profit, days), [labor, insights, profit, days])

  if (!verdict) return null

  const v = verdict
  const accent =
    v.verdict === 'good' ? 'var(--pos)' : v.verdict === 'bad' ? 'var(--neg)' : 'var(--warn)'
  const made = v.profit >= 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 18 }}>
      {/* ── DAILY VERDICT ─────────────────────────────────────────────── */}
      <Reveal>
        <Card
          pad={0}
          style={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}
        >
          {/* tinted verdict header */}
          <div
            style={{
              padding: '20px 24px 18px',
              background: `color-mix(in oklch, ${accent} 9%, transparent)`,
              borderBottom: '1px solid var(--border)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                <Icon name="bolt" size={14} style={{ color: accent }} />
                Today · {fmtDay(v.date)}
              </span>
              <Badge tone={v.verdict === 'good' ? 'pos' : v.verdict === 'bad' ? 'neg' : 'warn'} dot>
                {v.verdict === 'good' ? 'Good day' : v.verdict === 'bad' ? 'Down day' : 'So-so'}
              </Badge>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', color: accent, lineHeight: 1 }}>
                {made ? '' : '−'}
                {money(Math.abs(Math.round(v.profit)))}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text-3)', fontWeight: 600 }}>
                {made ? 'profit' : 'loss'} today
              </span>
            </div>
            <p style={{ fontSize: 14.5, fontWeight: 650, color: 'var(--text)', marginTop: 10 }}>{v.headline}</p>
          </div>

          {/* body: vs-typical + reasons */}
          <div style={{ padding: '18px 24px 22px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
            {v.vsTypical !== null && v.typicalProfit !== null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--text-2)' }}>
                <Icon
                  name={v.vsTypical >= 0 ? 'arrowUp' : 'arrowDn'}
                  size={16}
                  style={{ color: v.vsTypical >= 0 ? 'var(--pos)' : 'var(--neg)' }}
                />
                <span>
                  <strong className="mono" style={{ color: v.vsTypical >= 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {v.vsTypical >= 0 ? '+' : '−'}
                    {money(Math.abs(Math.round(v.vsTypical)))}
                  </strong>{' '}
                  vs. a typical {dowName(v.date)} ({money(Math.round(v.typicalProfit))})
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                Not enough history yet to compare with a typical {dowName(v.date)}.
              </div>
            )}

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 9 }}>
                Why
              </div>
              {v.reasons.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-3)' }}>A quiet, steady day — nothing stands out.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {v.reasons.map((r, i) => (
                    <ReasonTag key={i} r={r} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      </Reveal>

      {/* ── WEEKLY BIGGEST LEAK ───────────────────────────────────────── */}
      <Reveal delay={90}>
        <LeakCard leaks={leaks} onOpenLabor={onOpenLabor} />
      </Reveal>
    </div>
  )
}

function LeakCard({ leaks, onOpenLabor }: { leaks: Leak[]; onOpenLabor: () => void }): JSX.Element {
  const top = leaks[0]
  const rest = leaks.slice(1, 4)

  return (
    <Card pad={0} style={{ overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 24px 0' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
          <Icon name="alert" size={14} style={{ color: 'var(--warn)' }} />
          This week's biggest leak
        </span>
      </div>

      {!top ? (
        <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, padding: 16, borderRadius: 'var(--r-md)', background: 'color-mix(in oklch, var(--pos) 10%, transparent)', color: 'var(--pos)' }}>
            <Icon name="check" size={18} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>No major leak this week.</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>Staffing and overtime are within healthy ranges.</div>
            </div>
          </div>
          <Button variant="soft" iconRight="arrowR" onClick={onOpenLabor} style={{ marginTop: 'auto' }}>
            Open the labor board
          </Button>
        </div>
      ) : (
        <div style={{ padding: '14px 24px 22px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          {/* headline leak — quantified in money/week */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--warn)', lineHeight: 1 }}>
                ~{money(Math.round(top.weeklyCost))}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--text-3)', fontWeight: 600 }}>/ week</span>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 8 }}>{top.title}</div>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55, marginTop: 6 }}>{top.reason}</p>
          </div>

          {/* the fix */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: 13, borderRadius: 'var(--r-md)', background: 'var(--accent-soft)' }}>
            <Icon name="spark" size={16} style={{ color: 'var(--accent-h)', marginTop: 1, flex: '0 0 auto' }} />
            <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, lineHeight: 1.5 }}>{top.fix}</div>
          </div>

          {top.opensLabor ? (
            <Button variant="primary" icon="people" iconRight="arrowR" onClick={onOpenLabor}>
              Fix in the labor board
            </Button>
          ) : null}

          {/* next-biggest leaks queued beneath */}
          {rest.length > 0 && (
            <div style={{ marginTop: 'auto' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
                Next up
              </div>
              <AnimatedList stagger={50} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {rest.map((l, i) => (
                  <div
                    key={i}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderRadius: 'var(--r-sm)', background: 'var(--surface-2)' }}
                  >
                    <span style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.title}</span>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-3)', flex: '0 0 auto' }}>~{money(Math.round(l.weeklyCost))}/wk</span>
                  </div>
                ))}
              </AnimatedList>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
