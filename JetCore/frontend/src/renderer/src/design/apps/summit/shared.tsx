/**
 * Summit — shared visual primitives used across the tab screens.
 *
 * Page geometry, the metric tile, chart legend, an encouraging empty state
 * (CTA jumps to the Accounts tab), and small load/error states. Pulled out of
 * the prototype (summit.jsx · MetricTile/Legend/Page) so every tab matches.
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Button, Card, Delta, Skeleton, EmptyState } from '../../ui'
import { CountUp, Reveal, REDUCED, SpotlightCard } from '../../motion'
import { Icon } from '../../icons'
import { Sparkline } from '../../charts'
import { merchantDomain, SummitError } from './api'

/** A Summit sub-tab id (kept here so tabs can request a jump). */
export type SummitTab = 'overview' | 'sales' | 'labor' | 'finances' | 'accounts'

/* Emerald-harmonised palette for series the backend doesn't colour itself. */
export const SERIES_COLORS = [
  'var(--accent)',
  'var(--accent-h)',
  'oklch(0.7 0.13 188)',
  'oklch(0.72 0.13 130)',
  'oklch(0.68 0.14 200)',
  'oklch(0.74 0.12 165)',
  'oklch(0.66 0.14 145)',
  'oklch(0.7 0.12 210)'
]

/* ── async data loader ─────────────────────────────────────────────────── */

export type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: T }

/**
 * Loads `fetcher()` whenever the dependency key changes (the period / days),
 * exposing {phase} + a `reload` that re-runs it. The fetcher itself is
 * memoised in api.ts, so re-mounting a tab is instant after the first load.
 */
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
        const message =
          e instanceof SummitError ? e.message : e instanceof Error ? e.message : 'Something went wrong'
        setState({ phase: 'error', message })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce])

  return { state, reload: () => setNonce((n) => n + 1) }
}

/**
 * Returns `true` only once `ready` is true AND at least `ms` have elapsed since
 * the component mounted. Lets a tab hold its skeleton for a deliberate minimum
 * beat — so even cache-fast data still plays the faint-loading → content reveal
 * (YouTube-style) rather than flashing in instantly. Reduced-motion users skip
 * the artificial delay entirely and see content the moment it's ready.
 */
export function useMinDelay(ready: boolean, ms = 500): boolean {
  const mountedAt = useRef<number>(Date.now())
  const [elapsed, setElapsed] = useState<boolean>(() => REDUCED || ms <= 0)

  useEffect(() => {
    if (elapsed) return
    const remaining = ms - (Date.now() - mountedAt.current)
    if (remaining <= 0) {
      setElapsed(true)
      return
    }
    const t = setTimeout(() => setElapsed(true), remaining)
    return () => clearTimeout(t)
  }, [elapsed, ms])

  return ready && elapsed
}

/** Shared page wrapper (prototype geometry: maxWidth 1180, 30/40 padding). */
export function Page({ children, max = 1180, style = {} }: { children: ReactNode; max?: number; style?: CSSProperties }): JSX.Element {
  return <div style={{ maxWidth: max, margin: '0 auto', padding: '30px 40px 64px', ...style }}>{children}</div>
}

/** Page heading + sub copy (prototype's h1 styling). */
export function PageHead({ title, sub, action }: { title: string; sub: string; action?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 22 }}>
      <Reveal>
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.025em' }}>{title}</h1>
        <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>{sub}</p>
      </Reveal>
      {action}
    </div>
  )
}

/* ── spreadsheet import (Sales & tenders) ───────────────────────────────────
   A self-contained importer for the "Sales & tenders" tab. One button opens a
   small menu (Sales / Tenders); picking either opens the OS file dialog, reads
   the bytes in the renderer, and ships them to the main process, which posts a
   multipart upload to Summit's auto-parsing endpoints (/api/upload/<kind>/<uid>).
   The backend maps spreadsheet headers to the right columns, so a raw POS export
   lands in the right place with no manual column-picking. On any failure it
   surfaces the backend's message inline rather than throwing. */
export type ImportKind = 'sales' | 'tenders'

const IMPORT_ACCEPT =
  '.xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function ImportButton({ onImported }: { onImported?: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ImportKind | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const kindRef = useRef<ImportKind>('sales')

  /* close the menu on an outside click */
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDoc)
    return () => window.removeEventListener('mousedown', onDoc)
  }, [open])

  /* auto-dismiss the result toast */
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const pick = (kind: ImportKind): void => {
    kindRef.current = kind
    setOpen(false)
    inputRef.current?.click()
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked after a fix
    if (!file) return
    const kind = kindRef.current
    setBusy(kind)
    setToast(null)
    try {
      const data = await file.arrayBuffer()
      const res = await window.decks.summit.upload({ kind, filename: file.name, data })
      if (res.ok) {
        const noun = kind === 'sales' ? 'Sales' : 'Tenders'
        const inserted = res.inserted ?? 0
        const skipped = res.skipped ? ` · ${res.skipped} skipped` : ''
        setToast({ ok: true, msg: `${noun}: imported ${inserted} row${inserted === 1 ? '' : 's'}${skipped}` })
        onImported?.()
      } else {
        setToast({ ok: false, msg: res.error || 'Import failed — check the file and try again.' })
      }
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : 'Import failed' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '0 0 auto' }}>
      <input ref={inputRef} type="file" accept={IMPORT_ACCEPT} onChange={onFile} style={{ display: 'none' }} />
      <Button variant="soft" icon={busy ? 'hourglass' : 'download'} onClick={() => setOpen((o) => !o)} disabled={busy !== null}>
        {busy ? 'Importing…' : 'Import'}
      </Button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 40,
            minWidth: 250,
            padding: 6,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            boxShadow: '0 16px 40px -12px rgba(0,0,0,0.45)'
          }}
        >
          <ImportItem icon="cash" title="Sales spreadsheet" sub="Items, quantities & revenue" onClick={() => pick('sales')} />
          <ImportItem icon="receipt" title="Tenders spreadsheet" sub="Payments by tender type" onClick={() => pick('tenders')} />
          <div style={{ padding: '8px 10px 4px', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
            .xlsx, .xls or .csv — columns are auto-detected and mapped for you. A new
            import replaces the last one you uploaded.
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 40,
            maxWidth: 300,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            padding: '11px 13px',
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.45,
            color: toast.ok ? 'var(--pos)' : 'var(--neg)',
            background: `color-mix(in oklch, ${toast.ok ? 'var(--pos)' : 'var(--neg)'} 12%, var(--surface))`,
            border: `1px solid color-mix(in oklch, ${toast.ok ? 'var(--pos)' : 'var(--neg)'} 35%, transparent)`,
            borderRadius: 'var(--r-md)'
          }}
        >
          <Icon name={toast.ok ? 'check' : 'alert'} size={15} style={{ flex: '0 0 auto', marginTop: 1 }} />
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  )
}

function ImportItem({ icon, title, sub, onClick }: { icon: string; title: string; sub: string; onClick: () => void }): JSX.Element {
  return (
    <button
      className="tap"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        width: '100%',
        padding: '10px',
        borderRadius: 'var(--r-sm)',
        textAlign: 'left'
      }}
    >
      <div style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
        <Icon name={icon} size={16} />
      </div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 650 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1 }}>{sub}</div>
      </div>
    </button>
  )
}

/* ── merchant logo (Finances feed) ──────────────────────────────────────────
   A self-healing avatar for a transaction. It walks an ordered list of logo
   sources — Plaid's enriched `logo_url` first, then a brand-domain guess via the
   Clearbit logo CDN — advancing to the next on any <img> load error, and finally
   falling back to a coloured monogram. Logos render `object-fit: contain` on a
   light chip so wide wordmarks fit instead of being cropped (the old `cover`
   cropped them). Because every source 404s cleanly to the next, a missing or
   wrong logo never leaves a broken image: the feed always shows *something*. */
function monogramHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

export function MerchantLogo({ name, logoUrl, size = 38 }: { name: string; logoUrl?: string | null; size?: number }): JSX.Element {
  const candidates = useMemo(() => {
    const list: string[] = []
    if (logoUrl && /^https:\/\//i.test(logoUrl)) list.push(logoUrl)
    const { domain, known } = merchantDomain(name)
    if (domain) {
      list.push(`https://logo.clearbit.com/${domain}?size=256`)
      // For curated brands, add a favicon backstop that resolves for real domains;
      // for heuristic guesses we stop at Clearbit so a wrong guess shows a monogram
      // rather than some unrelated site's favicon.
      if (known) list.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`)
    }
    return [...new Set(list)]
  }, [logoUrl, name])

  const key = candidates.join('|')
  const [idx, setIdx] = useState(0)
  useEffect(() => setIdx(0), [key]) // restart the walk when the merchant changes

  const src = idx < candidates.length ? candidates[idx] : null
  const letter = (name.trim().charAt(0) || '?').toUpperCase()

  if (!src) {
    const hue = monogramHue(name)
    return (
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          flex: '0 0 auto',
          borderRadius: 'var(--r-sm)',
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          fontWeight: 700,
          fontSize: Math.round(size * 0.4),
          color: '#fff',
          background: `linear-gradient(135deg, oklch(0.64 0.13 ${hue}), oklch(0.52 0.15 ${hue}))`
        }}
      >
        {letter}
      </div>
    )
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: 'var(--r-sm)',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        background: '#fff',
        border: '1px solid var(--border)'
      }}
    >
      <img
        key={src}
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setIdx((i) => i + 1)}
        style={{ width: '100%', height: '100%', objectFit: 'contain', padding: Math.round(size * 0.15) }}
      />
    </div>
  )
}

/** Chart legend swatch + label. */
export function Legend({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
      {label}
    </span>
  )
}

/** KPI tile — icon chip, label, delta, animated value, optional sub + sparkline. */
export function MetricTile({
  icon,
  label,
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
  delta,
  deltaInvert,
  spark,
  sparkColor = 'var(--accent)',
  sub,
  big
}: {
  icon: string
  label: string
  value: number
  prefix?: string
  suffix?: string
  decimals?: number
  delta?: number | null
  deltaInvert?: boolean
  spark?: number[]
  sparkColor?: string
  sub?: ReactNode
  big?: boolean
}): JSX.Element {
  return (
    <SpotlightCard
      className="jc-card jc-card-hover"
      strength={0.1}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 20 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
            <Icon name={icon} size={16} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>{label}</span>
        </div>
        {delta !== undefined && <Delta value={delta} invert={deltaInvert} size="sm" />}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div style={{ fontSize: big ? 30 : 25, fontWeight: 800, letterSpacing: '-0.02em' }} className="mono">
            <CountUp value={value} prefix={prefix} suffix={suffix} decimals={decimals} />
          </div>
          {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>}
        </div>
        {spark && spark.length > 1 && <Sparkline data={spark} width={90} height={36} color={sparkColor} />}
      </div>
    </SpotlightCard>
  )
}

/* ── full-page skeleton scaffolds ──────────────────────────────────────────
   These mirror each tab's *real* layout (KPI row · chart block · table/list)
   so when data arrives it pops into the same spot with no layout shift — the
   YouTube approach. Shapes are generously rounded (var(--r-md/lg)). The faint
   left→right shimmer comes from `.skel` (Skeleton). */

/** Section-card header skeleton (icon chip + title/sub) used by the scaffolds. */
function CardHeadSkeleton({ wide = false }: { wide?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
      <Skeleton w={34} h={34} r={10} />
      <div>
        <Skeleton w={wide ? 170 : 120} h={15} />
        <Skeleton w={wide ? 130 : 90} h={12} style={{ marginTop: 6 }} />
      </div>
    </div>
  )
}

/** A row of KPI-tile placeholders that matches the real grid (`count` columns). */
export function TileRowSkeleton({ count = 4 }: { count?: number }): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} pad={20}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Skeleton w={32} h={32} r={10} />
              <Skeleton w={84} h={13} />
            </div>
            <Skeleton w={44} h={18} r={99} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <Skeleton w={120} h={28} />
              <Skeleton w={92} h={12} style={{ marginTop: 10 }} />
            </div>
            <Skeleton w={90} h={36} r={8} />
          </div>
        </Card>
      ))}
    </div>
  )
}

/**
 * One chart card placeholder: header + a big rounded plot area. `flush` skips
 * its own <Card> so it can be dropped into a custom grid cell. `height` matches
 * the real chart height so there's no jump on reveal.
 */
export function ChartCardSkeleton({ height = 250, wide = false }: { height?: number; wide?: boolean }): JSX.Element {
  return (
    <Card>
      <CardHeadSkeleton wide={wide} />
      <Skeleton w="100%" h={height} r={14} />
    </Card>
  )
}

/** A donut-card placeholder (centred ring) — Sales' "by tender / by centre". */
export function DonutCardSkeleton({ size = 200 }: { size?: number }): JSX.Element {
  return (
    <Card>
      <CardHeadSkeleton />
      <div style={{ display: 'grid', placeItems: 'center', padding: '14px 0' }}>
        <Skeleton w={size} h={size} r={999} />
      </div>
    </Card>
  )
}

/** A list-card placeholder: header + `rows` line items (avatar/label/value). */
export function ListSkeleton({ rows = 5, title = false }: { rows?: number; title?: boolean }): JSX.Element {
  return (
    <Card>
      {title && <CardHeadSkeleton />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Skeleton w={36} h={36} r={10} />
            <div style={{ flex: 1 }}>
              <Skeleton w={`${55 + ((i * 13) % 30)}%`} h={13} />
              <Skeleton w={64} h={11} style={{ marginTop: 6 }} />
            </div>
            <Skeleton w={68} h={15} />
          </div>
        ))}
      </div>
    </Card>
  )
}

/** A table-card placeholder: header + header-row + `rows` striped lines. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }): JSX.Element {
  return (
    <Card>
      <CardHeadSkeleton wide />
      <div style={{ display: 'flex', gap: 16, padding: '6px 0 12px' }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} w={i === 0 ? '34%' : `${Math.round(66 / (cols - 1))}%`} h={11} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '13px 0', borderTop: '1px solid var(--border)' }}>
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} w={c === 0 ? '34%' : `${Math.round(66 / (cols - 1))}%`} h={14} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Page-head placeholder (title + sub) matching <PageHead> geometry. */
function PageHeadSkeleton(): JSX.Element {
  return (
    <div style={{ marginBottom: 22 }}>
      <Skeleton w={180} h={27} r={8} />
      <Skeleton w={300} h={14} style={{ marginTop: 8 }} />
    </div>
  )
}

/** Overview scaffold: head · 4 KPIs · (chart | side) · (card | card). */
export function OverviewSkeleton(): JSX.Element {
  return (
    <Page>
      <PageHeadSkeleton />
      <div style={{ marginBottom: 18 }}>
        <TileRowSkeleton count={4} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, alignItems: 'start' }}>
        <ChartCardSkeleton height={250} wide />
        <ListSkeleton rows={3} title />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <DonutCardSkeleton />
        <ChartCardSkeleton height={180} />
      </div>
    </Page>
  )
}

/** Sales scaffold: head · 3 KPIs · (donut | donut) · menu table. */
export function SalesSkeleton(): JSX.Element {
  return (
    <Page>
      <PageHeadSkeleton />
      <div style={{ margin: '22px 0 18px' }}>
        <TileRowSkeleton count={3} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <DonutCardSkeleton />
        <DonutCardSkeleton />
      </div>
      <div style={{ marginTop: 18 }}>
        <TableSkeleton rows={6} cols={4} />
      </div>
    </Page>
  )
}

/** Labor scaffold: head · 4 KPIs · (chart | day-of-week list) · shifts table. */
export function LaborSkeleton(): JSX.Element {
  return (
    <Page>
      <PageHeadSkeleton />
      <div style={{ marginBottom: 18 }}>
        <TileRowSkeleton count={4} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, alignItems: 'start' }}>
        <ChartCardSkeleton height={250} wide />
        <Card>
          <CardHeadSkeleton />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <Skeleton w={36} h={12} />
                  <Skeleton w={40} h={12} />
                </div>
                <Skeleton w="100%" h={8} r={99} />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div style={{ marginTop: 18 }}>
        <TableSkeleton rows={6} cols={6} />
      </div>
    </Page>
  )
}

/** Finances scaffold: head · 3 KPIs · area chart · (card | list) · feed. */
export function FinancesSkeleton(): JSX.Element {
  return (
    <Page>
      <PageHeadSkeleton />
      <div style={{ margin: '22px 0 18px' }}>
        <TileRowSkeleton count={3} />
      </div>
      <ChartCardSkeleton height={230} wide />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 18 }}>
        <ListSkeleton rows={4} title />
        <ListSkeleton rows={4} title />
      </div>
      <div style={{ marginTop: 18 }}>
        <ListSkeleton rows={6} title />
      </div>
    </Page>
  )
}

/** Error card with a retry button (used when an endpoint fails). */
export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <Card>
      <EmptyState
        icon="alert"
        title="Couldn’t load this"
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

/** Encouraging empty state — CTA jumps to the Accounts tab to connect a source. */
export function ConnectEmpty({
  icon = 'link',
  title,
  body,
  onConnect
}: {
  icon?: string
  title: string
  body: string
  onConnect: () => void
}): JSX.Element {
  return (
    <Card>
      <EmptyState
        icon={icon}
        title={title}
        body={body}
        action={
          <Button variant="primary" iconRight="arrowR" onClick={onConnect}>
            Connect a source
          </Button>
        }
      />
    </Card>
  )
}
