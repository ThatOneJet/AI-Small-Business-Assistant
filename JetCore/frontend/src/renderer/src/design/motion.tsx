/* JetCore motion primitives (ReactBits-style) — interactions + open/close only,
   no animated backgrounds. Ported from motion.jsx. */
import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type JSX
} from 'react'

/** prefers-reduced-motion guard. */
export const REDUCED =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false

/** Force an animation to its end-state if the timeline stalls (offscreen, etc.). */
export function failsafe(anim: Animation | null | undefined, ms: number): void {
  if (!anim) return
  setTimeout(() => {
    try {
      if (anim.playState !== 'finished') anim.finish()
    } catch {
      /* ignore */
    }
  }, ms)
}

/** Reveal: fade + rise on mount, optional stagger delay. */
export function Reveal({
  children,
  delay = 0,
  y = 12,
  dur = 560,
  className = '',
  style = {},
  ...rest
}: {
  children: ReactNode
  delay?: number
  y?: number
  dur?: number
  className?: string
  style?: CSSProperties
} & Record<string, unknown>): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || REDUCED) return
    const a = el.animate(
      [{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: dur, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }
    )
    failsafe(a, delay + dur + 240)
  }, [])
  return (
    <div ref={ref} className={className} style={style} {...rest}>
      {children}
    </div>
  )
}

function Word({ children, delay }: { children: ReactNode; delay: number }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || REDUCED) return
    const a = el.animate(
      [
        { opacity: 0, filter: 'blur(8px)', transform: 'translateY(8px)' },
        { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' }
      ],
      { duration: 620, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }
    )
    failsafe(a, delay + 620 + 240)
  }, [])
  return (
    <span ref={ref} style={{ display: 'inline-block', willChange: 'filter,opacity,transform' }}>
      {children}
    </span>
  )
}

/** BlurText: word-by-word blur-in reveal. */
export function BlurText({
  text,
  delay = 0,
  stagger = 55,
  className = '',
  style = {}
}: {
  text: string
  delay?: number
  stagger?: number
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const words = String(text).split(' ')
  return (
    <span className={className} style={{ display: 'inline', ...style }}>
      {words.map((w, i) => (
        <Word key={i} delay={delay + i * stagger}>
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </Word>
      ))}
    </span>
  )
}

/** CountUp: animate a number into view. */
export function CountUp({
  value,
  dur = 1100,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
  style = {}
}: {
  value: number
  dur?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [disp, setDisp] = useState(REDUCED ? value : 0)
  const started = useRef(false)
  useEffect(() => {
    if (REDUCED) {
      setDisp(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const fs = setTimeout(() => setDisp(value), dur + 400)
    const from = started.current ? Number(ref.current?.dataset.v || 0) : 0
    started.current = true
    const tick = (now: number): void => {
      const p = Math.min((now - t0) / dur, 1)
      const e = 1 - Math.pow(1 - p, 3)
      const v = from + (value - from) * e
      if (ref.current) ref.current.dataset.v = String(v)
      setDisp(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(fs)
    }
  }, [value])
  const fmt = (n: number): string =>
    n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return (
    <span ref={ref} className={className} style={style}>
      {prefix}
      {fmt(disp)}
      {suffix}
    </span>
  )
}

/** AnimatedList: stagger children in on mount. */
export function AnimatedList({
  children,
  stagger = 60,
  baseDelay = 0,
  y = 14,
  className = '',
  style = {},
  fill = false
}: {
  children: ReactNode
  stagger?: number
  baseDelay?: number
  y?: number
  className?: string
  style?: CSSProperties
  /** Make each item fill its grid cell (height:100%) so cards in a row are equal
      height with footers aligned. Use on grid layouts of cards, not column lists. */
  fill?: boolean
}): JSX.Element {
  const arr = Children.toArray(children)
  return (
    <div className={className} style={style}>
      {arr.map((c, i) => (
        <Reveal
          key={(c as { key?: string }).key ?? i}
          delay={baseDelay + i * stagger}
          y={y}
          style={fill ? { height: '100%', display: 'flex', flexDirection: 'column' } : undefined}
        >
          {c}
        </Reveal>
      ))}
    </div>
  )
}

/** SpotlightCard: radial highlight follows the cursor. */
export function SpotlightCard({
  children,
  className = '',
  style = {},
  radius = 380,
  strength = 0.1,
  ...rest
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  radius?: number
  strength?: number
} & Record<string, unknown>): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = (e: React.MouseEvent): void => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
    el.style.setProperty('--sp', '1')
  }
  const onLeave = (): void => {
    const el = ref.current
    if (el) el.style.setProperty('--sp', '0')
  }
  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={'jc-spot ' + className}
      style={{ ['--spr' as string]: radius + 'px', ['--sps' as string]: strength, ...style } as CSSProperties}
      {...rest}
    >
      {children}
    </div>
  )
}

/** Magnet: element drifts toward the cursor when hovered. */
export function Magnet({
  children,
  strength = 0.32,
  radius = 90,
  className = '',
  style = {}
}: {
  children: ReactNode
  strength?: number
  radius?: number
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || REDUCED) return
    const onMove = (e: MouseEvent): void => {
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const dx = e.clientX - cx
      const dy = e.clientY - cy
      const dist = Math.hypot(dx, dy)
      if (dist < radius + Math.max(r.width, r.height) / 2) {
        el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`
      } else {
        el.style.transform = 'translate(0,0)'
      }
    }
    const onLeave = (): void => {
      el.style.transform = 'translate(0,0)'
    }
    window.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [])
  return (
    <div ref={ref} className={className} style={{ transition: 'transform .35s cubic-bezier(.16,1,.3,1)', ...style }}>
      {children}
    </div>
  )
}

/** ClickSpark: emit accent sparks at the click point. */
export function useClickSpark(): (e: { clientX: number; clientY: number }) => void {
  return useCallback((e: { clientX: number; clientY: number }) => {
    if (REDUCED) return
    const n = 8
    const host = document.body
    const cs = getComputedStyle(document.documentElement)
    const color = cs.getPropertyValue('--accent').trim() || '#7c8cf8'
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span')
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4
      const dist = 16 + Math.random() * 16
      s.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:5px;height:5px;border-radius:99px;background:${color};pointer-events:none;z-index:9999;will-change:transform,opacity;`
      host.appendChild(s)
      s.animate(
        [
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0)`,
            opacity: 0
          }
        ],
        { duration: 480 + Math.random() * 160, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }
      ).onfinish = () => s.remove()
    }
  }, [])
}

/** Modal / Sheet: open-close spring transitions. */
export function Overlay({
  open,
  onClose,
  children,
  align = 'center',
  className = '',
  panelStyle = {}
}: {
  open: boolean
  onClose?: () => void
  children: ReactNode
  align?: 'center' | 'top' | 'bottom'
  className?: string
  panelStyle?: CSSProperties
}): JSX.Element | null {
  const [mounted, setMounted] = useState(open)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setShow(true)))
      return
    }
    setShow(false)
    const t = setTimeout(() => setMounted(false), 320)
    return () => clearTimeout(t)
  }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!mounted) return null
  const alignMap: Record<string, string> = { center: 'center', top: 'flex-start', bottom: 'flex-end' }
  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: alignMap[align] || 'center',
        justifyContent: 'center',
        padding: align === 'center' ? '40px' : '0',
        background: `oklch(0.08 0.02 264 / ${show ? 0.52 : 0})`,
        backdropFilter: `blur(${show ? 7 : 0}px)`,
        transition: 'background .3s var(--ease), backdrop-filter .3s var(--ease)'
      }}
    >
      <div
        className={className}
        style={{
          opacity: show ? 1 : 0,
          transform: show
            ? 'translateY(0) scale(1)'
            : align === 'bottom'
              ? 'translateY(24px) scale(.98)'
              : 'translateY(10px) scale(.965)',
          transition: 'opacity .32s var(--ease-out), transform .42s var(--spring)',
          ...panelStyle
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Ticker: rotating word swap. */
export function Ticker({
  words,
  interval = 2200,
  className = '',
  style = {}
}: {
  words: string[]
  interval?: number
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % words.length), interval)
    return () => clearInterval(t)
  }, [])
  return (
    <span className={className} style={{ display: 'inline-grid', ...style }}>
      {words.map((w, idx) => (
        <span
          key={idx}
          style={{
            gridArea: '1/1',
            transition: 'opacity .5s var(--ease), transform .5s var(--ease-out)',
            opacity: idx === i ? 1 : 0,
            transform: idx === i ? 'translateY(0)' : 'translateY(8px)'
          }}
        >
          {w}
        </span>
      ))}
    </span>
  )
}
