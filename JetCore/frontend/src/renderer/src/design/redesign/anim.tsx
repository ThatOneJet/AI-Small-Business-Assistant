/**
 * Redesign motion helpers — the "alive but professional" bits.
 *  - CountUp: numbers tick up on a counter when a screen opens (used across the
 *    big numerals in Summit, Pylon, the Brief — the signature JetCore entrance).
 *  - Ring: an SVG progress/grade ring whose sweep animates in on mount.
 * Both respect prefers-reduced-motion.
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'

const REDUCED =
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const easeOut = (p: number): number => 1 - Math.pow(1 - p, 3)

/** Animate a number from 0 → `value` on mount (and on value change). */
export function CountUp({
  value,
  dur = 950,
  decimals = 0,
  prefix = '',
  suffix = '',
  format
}: {
  value: number
  dur?: number
  decimals?: number
  prefix?: string
  suffix?: string
  format?: (n: number) => string
}): JSX.Element {
  const [n, setN] = useState(REDUCED ? value : 0)
  useEffect(() => {
    if (REDUCED || !Number.isFinite(value)) {
      setN(value)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / dur)
      setN(value * easeOut(p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, dur])
  const shown = format ? format(n) : prefix + n.toFixed(decimals) + suffix
  return <>{shown}</>
}

/** A progress/grade ring with an animated sweep + optional center content. */
export function Ring({
  value,
  max = 100,
  size = 88,
  stroke = 9,
  color,
  track = 'var(--card-3)',
  children
}: {
  value: number
  max?: number
  size?: number
  stroke?: number
  color: string
  track?: string
  children?: ReactNode
}): JSX.Element {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const target = Math.max(0, Math.min(1, max === 0 ? 0 : value / max))
  const [p, setP] = useState(REDUCED ? target : 0)
  const raf = useRef(0)
  useEffect(() => {
    if (REDUCED) {
      setP(target)
      return
    }
    const start = performance.now()
    const dur = 950
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / dur)
      setP(target * easeOut(t))
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [target])
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
      <svg width={size} height={size} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - p)}
        />
      </svg>
      {children != null && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          {children}
        </div>
      )}
    </div>
  )
}
