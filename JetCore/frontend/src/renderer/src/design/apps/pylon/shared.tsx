/**
 * Pylon — shared view primitives used across the Courses areas.
 *
 * The `.canvas-html` reader, a tiny async-loader hook (mirrors Summit's
 * useAsync but typed to CanvasError), back headers, status badges, list-row
 * skeletons and encouraging empty states — so Assignments / Quizzes /
 * Coursework / Announcements all feel like one calm, organised surface.
 */
import { useEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Badge, Button, Card, EmptyState, Skeleton, Spinner } from '../../ui'
import { Reveal } from '../../motion'
import { Icon } from '../../icons'
import { CanvasError, ensureCanvasHtmlStyles, sanitizeHtml } from './canvas'

/* ── async loader ────────────────────────────────────────────────────── */

export type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; status?: number }
  | { phase: 'ready'; data: T }

/** Run `fetcher()` whenever `key` changes; expose {state} + a `reload`. */
export function useAsync<T>(fetcher: () => Promise<T>, key: unknown): { state: Async<T>; reload: () => void } {
  const [state, setState] = useState<Async<T>>({ phase: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setState({ phase: 'loading' })
    fetcher()
      .then((data) => {
        if (alive) setState({ phase: 'ready', data })
      })
      .catch((e: unknown) => {
        if (!alive) return
        if (e instanceof CanvasError) setState({ phase: 'error', message: e.message, status: e.status })
        else setState({ phase: 'error', message: e instanceof Error ? e.message : 'Something went wrong' })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  return { state, reload: () => setNonce((n) => n + 1) }
}

/* ── the Canvas HTML reader ──────────────────────────────────────────── */

/** Render Canvas-authored HTML in a styled, readable container. The HTML is
 *  the user's own course content; we sanitise-lite (strip <script>/handlers)
 *  before handing it to dangerouslySetInnerHTML. */
export function CanvasHtml({ html, style }: { html: string | null | undefined; style?: CSSProperties }): JSX.Element {
  useEffect(() => {
    ensureCanvasHtmlStyles()
  }, [])
  const clean = sanitizeHtml(html)
  if (!clean.trim()) {
    return (
      <div style={{ fontSize: 13.5, color: 'var(--text-3)', fontStyle: 'italic', ...style }}>
        No content provided.
      </div>
    )
  }
  return <div className="canvas-html" style={style} dangerouslySetInnerHTML={{ __html: clean }} />
}

/* ── headers ─────────────────────────────────────────────────────────── */

/** A back-link header for detail views (← Assignments / Quizzes / …). */
export function BackHeader({
  onBack,
  backLabel,
  title,
  sub,
  badge,
  action
}: {
  onBack: () => void
  backLabel: string
  title: ReactNode
  sub?: ReactNode
  badge?: ReactNode
  action?: ReactNode
}): JSX.Element {
  return (
    <Reveal style={{ marginBottom: 20 }}>
      <button
        className="tap"
        onClick={onBack}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--text-3)', marginBottom: 14 }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-3)')}
      >
        <Icon name="chevL" size={15} /> {backLabel}
      </button>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.025em' }}>{title}</h1>
            {badge}
          </div>
          {sub && <div style={{ fontSize: 13.5, color: 'var(--text-3)', marginTop: 6 }}>{sub}</div>}
        </div>
        {action}
      </div>
    </Reveal>
  )
}

/** A simple section heading (title + sub) used at the top of each area. */
export function AreaHead({ title, sub, action }: { title: string; sub: string; action?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
      <Reveal>
        <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.025em' }}>{title}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 5 }}>{sub}</p>
      </Reveal>
      {action}
    </div>
  )
}

/* ── list states ─────────────────────────────────────────────────────── */

/** Stacked skeleton rows while a list loads. */
export function RowSkeletons({ count = 5 }: { count?: number }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 18px', borderRadius: 'var(--r-md)', background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <Skeleton w={38} h={38} r={10} />
          <div style={{ flex: 1 }}>
            <Skeleton w="45%" h={14} />
            <Skeleton w="28%" h={11} style={{ marginTop: 8 }} />
          </div>
          <Skeleton w={74} h={22} r={99} />
        </div>
      ))}
    </div>
  )
}

/** A reader skeleton (used while a page / assignment detail loads). */
export function ReaderSkeleton(): JSX.Element {
  return (
    <Card>
      <Skeleton w="55%" h={20} />
      <Skeleton w="100%" h={12} style={{ marginTop: 18 }} />
      <Skeleton w="92%" h={12} style={{ marginTop: 9 }} />
      <Skeleton w="96%" h={12} style={{ marginTop: 9 }} />
      <Skeleton w="70%" h={12} style={{ marginTop: 9 }} />
      <Skeleton w="100%" h={140} r={12} style={{ marginTop: 18 }} />
      <Skeleton w="88%" h={12} style={{ marginTop: 18 }} />
      <Skeleton w="94%" h={12} style={{ marginTop: 9 }} />
    </Card>
  )
}

/** Error card with retry — for a failed area/detail load. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <Card>
      <EmptyState
        icon="alert"
        title="Canvas didn’t answer"
        body={message}
        action={
          <Button variant="soft" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </Card>
  )
}

/** Encouraging empty state inside a card. */
export function EmptyCard({ icon, title, body }: { icon: string; title: string; body: string }): JSX.Element {
  return (
    <Card>
      <EmptyState icon={icon} title={title} body={body} />
    </Card>
  )
}

/* ── small inline pieces ─────────────────────────────────────────────── */

/** A meta chip line ("Due Mar 4 · 20 pts") under a row/title. */
export function MetaLine({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-3)' }}>
      {children}
    </div>
  )
}

/** A clickable list row (icon chip + title/meta + right slot). */
export function ListRow({
  icon,
  iconColor,
  accent,
  title,
  meta,
  right,
  onClick
}: {
  icon: string
  iconColor?: string
  accent?: string
  title: ReactNode
  meta?: ReactNode
  right?: ReactNode
  onClick?: () => void
}): JSX.Element {
  const interactive = !!onClick
  return (
    <div
      className={interactive ? 'jc-card-hover tap' : undefined}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '15px 18px',
        borderRadius: 'var(--r-md)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        cursor: interactive ? 'pointer' : 'default'
      }}
    >
      {accent && <div style={{ width: 4, height: 38, borderRadius: 99, background: accent, flex: '0 0 auto' }} />}
      <div
        style={{ width: 38, height: 38, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: iconColor ?? 'var(--text-2)', flex: '0 0 auto' }}
      >
        <Icon name={icon} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        {meta && <div style={{ marginTop: 4 }}>{meta}</div>}
      </div>
      {right && <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>{right}</div>}
    </div>
  )
}

/** An inline note (e.g. "this question type is read-only"). */
export function Note({ icon = 'info', tone = 'neutral', children }: { icon?: string; tone?: 'neutral' | 'warn' | 'pos' | 'neg'; children: ReactNode }): JSX.Element {
  const color =
    tone === 'warn' ? 'var(--warn)' : tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : 'var(--text-3)'
  const bg =
    tone === 'neutral'
      ? 'var(--surface-2)'
      : `color-mix(in oklch, ${color} 10%, transparent)`
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '11px 14px', borderRadius: 'var(--r-sm)', background: bg, color, fontSize: 13, fontWeight: 500, lineHeight: 1.5 }}>
      <Icon name={icon} size={16} style={{ flex: '0 0 auto', marginTop: 1 }} />
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  )
}

/** A small inline spinner + label (for buttons / busy rows). */
export function Busy({ label }: { label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}>
      <Spinner size={16} /> {label}
    </span>
  )
}

/** Re-export so areas don't all import Badge directly for status pills. */
export function StatusBadge({ tone, children, icon }: { tone: 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'; children: ReactNode; icon?: string }): JSX.Element {
  return (
    <Badge tone={tone} icon={icon} size="sm">
      {children}
    </Badge>
  )
}

/** Track a one-shot async action (submit/start/complete): {busy, error, run}. */
export function useAction(): {
  busy: boolean
  error: string | null
  setError: (e: string | null) => void
  run: (fn: () => Promise<void>) => Promise<void>
} {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      if (mounted.current) setError(e instanceof CanvasError ? e.message : e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return { busy, error, setError, run }
}
