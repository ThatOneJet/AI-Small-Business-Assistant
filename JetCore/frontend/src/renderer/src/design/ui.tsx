/* JetCore base UI kit (ported from ui.jsx). */
import { useEffect, useRef, type CSSProperties, type ReactNode, type JSX } from 'react'
import { Icon } from './icons'
import { Reveal, SpotlightCard, REDUCED } from './motion'

export const cx = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ')

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  full,
  className = '',
  style = {},
  ...rest
}: {
  children?: ReactNode
  variant?: 'primary' | 'soft' | 'ghost' | 'surface' | 'outline' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  icon?: string
  iconRight?: string
  full?: boolean
  className?: string
  style?: CSSProperties
} & Record<string, unknown>): JSX.Element {
  const sizes = {
    sm: { padding: '8px 14px', fontSize: 13, gap: 7, radius: 'var(--r-sm)', ih: 16 },
    md: { padding: '11px 18px', fontSize: 14.5, gap: 8, radius: 'var(--r-md)', ih: 18 },
    lg: { padding: '15px 26px', fontSize: 16, gap: 10, radius: 'var(--r-md)', ih: 20 }
  }[size]
  const variants: Record<string, CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--accent-ink)', boxShadow: '0 6px 20px -8px var(--accent-glow)' },
    soft: { background: 'var(--accent-soft)', color: 'var(--accent-h)' },
    ghost: { background: 'transparent', color: 'var(--text-2)' },
    surface: { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' },
    outline: { background: 'transparent', color: 'var(--text)', border: '1px solid var(--border-2)' },
    danger: { background: 'color-mix(in oklch, var(--neg) 16%, transparent)', color: 'var(--neg)' }
  }
  return (
    <button
      className={cx('tap jc-btn', className)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: sizes.gap,
        padding: sizes.padding,
        fontSize: sizes.fontSize,
        fontWeight: 600,
        borderRadius: sizes.radius,
        width: full ? '100%' : undefined,
        letterSpacing: '-0.01em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...variants[variant],
        ...style
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={sizes.ih} />}
      {children}
      {iconRight && <Icon name={iconRight} size={sizes.ih} />}
    </button>
  )
}

export function IconButton({
  name,
  size = 18,
  label,
  active,
  className = '',
  style = {},
  ...rest
}: {
  name: string
  size?: number
  label?: string
  active?: boolean
  className?: string
  style?: CSSProperties
} & Record<string, unknown>): JSX.Element {
  return (
    <button
      aria-label={label}
      className={cx('tap jc-iconbtn', className)}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 38,
        height: 38,
        borderRadius: 'var(--r-sm)',
        color: active ? 'var(--accent-h)' : 'var(--text-2)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        ...style
      }}
      {...rest}
    >
      <Icon name={name} size={size} />
    </button>
  )
}

export function Card({
  children,
  pad = 24,
  hover,
  spotlight,
  className = '',
  style = {},
  ...rest
}: {
  children?: ReactNode
  pad?: number
  hover?: boolean
  spotlight?: boolean
  className?: string
  style?: CSSProperties
} & Record<string, unknown>): JSX.Element {
  const base: CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    padding: pad,
    boxShadow: '0 1px 2px hsl(var(--shadow-c) / .04), 0 8px 24px -16px hsl(var(--shadow-c) / .35)',
    ...style
  }
  if (spotlight)
    return (
      <SpotlightCard className={cx('jc-card', hover && 'jc-card-hover', className)} style={base} {...rest}>
        {children}
      </SpotlightCard>
    )
  return (
    <div className={cx('jc-card', hover && 'jc-card-hover', className)} style={base} {...rest}>
      {children}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral',
  icon,
  dot,
  size = 'md',
  style = {}
}: {
  children?: ReactNode
  tone?: 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'
  icon?: string
  dot?: boolean
  size?: 'sm' | 'md'
  style?: CSSProperties
}): JSX.Element {
  const tones: Record<string, CSSProperties> = {
    neutral: { background: 'var(--surface-2)', color: 'var(--text-2)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-h)' },
    pos: { background: 'color-mix(in oklch, var(--pos) 15%, transparent)', color: 'var(--pos)' },
    neg: { background: 'color-mix(in oklch, var(--neg) 15%, transparent)', color: 'var(--neg)' },
    warn: { background: 'color-mix(in oklch, var(--warn) 16%, transparent)', color: 'var(--warn)' }
  }
  const sz = size === 'sm' ? { fontSize: 11, padding: '3px 8px' } : { fontSize: 12.5, padding: '4px 10px' }
  return (
    <span
      className="mono"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 'var(--r-pill)', fontWeight: 600, letterSpacing: '0.01em', ...sz, ...tones[tone], ...style }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />}
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  )
}

export function Delta({
  value,
  suffix = '%',
  invert = false,
  size = 'md'
}: {
  value: number | null | undefined
  suffix?: string
  invert?: boolean
  size?: 'sm' | 'md'
}): JSX.Element {
  if (value === null || value === undefined)
    return (
      <span style={{ color: 'var(--text-3)', fontSize: 12.5 }} className="mono">
        —
      </span>
    )
  const up = value >= 0
  const good = invert ? !up : up
  const tone = good ? 'var(--pos)' : 'var(--neg)'
  const fs = size === 'sm' ? 11.5 : 12.5
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: tone, fontWeight: 600, fontSize: fs }}>
      <Icon name={up ? 'arrowUp' : 'arrowDn'} size={fs} stroke={2.4} />
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  )
}

export function Input({
  icon,
  prefix,
  className = '',
  style = {},
  ...rest
}: { icon?: string; prefix?: string; className?: string; style?: CSSProperties } & Record<string, unknown>): JSX.Element {
  return (
    <div
      className="jc-input"
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 14px', height: 44, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', transition: 'border-color .2s, box-shadow .2s', ...style }}
    >
      {icon && <Icon name={icon} size={17} style={{ color: 'var(--text-3)' }} />}
      {prefix && <span style={{ color: 'var(--text-3)', fontSize: 14.5 }}>{prefix}</span>}
      <input className={className} style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 14.5, fontWeight: 500, minWidth: 0 }} {...rest} />
    </div>
  )
}

export function Field({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'block' }}>
      {label && <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8 }}>{label}</div>}
      {children}
      {hint && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 7 }}>{hint}</div>}
    </label>
  )
}

export function Toggle({ checked, onChange, size = 1 }: { checked: boolean; onChange: (v: boolean) => void; size?: number }): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="tap"
      style={{ width: 46 * size, height: 27 * size, borderRadius: 99, padding: 3 * size, background: checked ? 'var(--accent)' : 'var(--surface-3)', transition: 'background .25s var(--ease)', display: 'flex', justifyContent: checked ? 'flex-end' : 'flex-start' }}
    >
      <span style={{ width: 21 * size, height: 21 * size, borderRadius: 99, background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,.3)', transition: 'all .3s var(--spring)' }} />
    </button>
  )
}

type SegOpt = string | { value: string; label: string }
export function Segmented({
  options,
  value,
  onChange,
  size = 'md',
  full
}: {
  options: SegOpt[]
  value: string
  onChange: (v: string) => void
  size?: 'sm' | 'md'
  full?: boolean
}): JSX.Element {
  const pad = size === 'sm' ? '6px 12px' : '9px 16px'
  const fs = size === 'sm' ? 13 : 14
  return (
    <div style={{ display: 'inline-flex', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: 4, gap: 3, border: '1px solid var(--border)', width: full ? '100%' : undefined }}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value
        const lbl = typeof o === 'string' ? o : o.label
        const on = v === value
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            className="tap"
            style={{ flex: full ? 1 : undefined, padding: pad, fontSize: fs, fontWeight: 600, borderRadius: 'calc(var(--r-md) - 5px)', color: on ? 'var(--accent-ink)' : 'var(--text-2)', background: on ? 'var(--accent)' : 'transparent', boxShadow: on ? '0 4px 12px -6px var(--accent-glow)' : 'none', transition: 'all .22s var(--ease)', whiteSpace: 'nowrap' }}
          >
            {lbl}
          </button>
        )
      })}
    </div>
  )
}

export function Avatar({ name = '', size = 38, src, accent }: { name?: string; size?: number; src?: string; accent?: string }): JSX.Element {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div style={{ width: size, height: size, borderRadius: 'var(--r-sm)', flex: '0 0 auto', display: 'grid', placeItems: 'center', overflow: 'hidden', background: accent || 'linear-gradient(135deg, var(--accent), var(--accent-d))', color: 'var(--accent-ink)', fontWeight: 700, fontSize: size * 0.36 }}>
      {src ? <img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </div>
  )
}

export function ProgressRing({
  value,
  size = 64,
  stroke = 6,
  color = 'var(--accent)',
  track = 'var(--surface-3)',
  children
}: {
  value: number
  size?: number
  stroke?: number
  color?: string
  track?: string
  children?: ReactNode
}): JSX.Element {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(1, value / 100)))
  const ref = useRef<SVGCircleElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || REDUCED) return
    el.animate([{ strokeDashoffset: c }, { strokeDashoffset: off }], { duration: 1100, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' })
  }, [value])
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle ref={ref} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  )
}

export function Divider({ v, style = {} }: { v?: boolean; style?: CSSProperties }): JSX.Element {
  return <div style={v ? { width: 1, alignSelf: 'stretch', background: 'var(--border)', ...style } : { height: 1, background: 'var(--border)', ...style }} />
}

export function SectionTitle({ icon, title, sub, action }: { icon?: string; title: ReactNode; sub?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        {icon && (
          <div style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
            <Icon name={icon} size={18} />
          </div>
        )}
        <div>
          <h3 style={{ fontSize: 16.5, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h3>
          {sub && <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ icon = 'spark', title, body, action }: { icon?: string; title: ReactNode; body?: ReactNode; action?: ReactNode }): JSX.Element {
  return (
    <Reveal style={{ textAlign: 'center', padding: '48px 32px', maxWidth: 380, margin: '0 auto' }}>
      <div style={{ width: 68, height: 68, margin: '0 auto 18px', borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
        <Icon name={icon} size={30} />
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 8 }}>{title}</h3>
      {body && <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: action ? 22 : 0 }}>{body}</p>}
      {action}
    </Reveal>
  )
}

export function Skeleton({ w = '100%', h = 16, r = 8, style = {} }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }): JSX.Element {
  return <div className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

export function Spinner({ size = 20, stroke = 2.4 }: { size?: number; stroke?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'jc-spin 0.8s linear infinite' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--border-2)" strokeWidth={stroke} />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="var(--accent)" strokeWidth={stroke} strokeLinecap="round" />
    </svg>
  )
}
