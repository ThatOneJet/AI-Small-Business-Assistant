/* JetCore chart primitives — lightweight animated SVG (ported from charts.jsx). */
import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react'
import { REDUCED, failsafe } from './motion'

export function niceMax(v: number): number {
  if (v <= 0) return 10
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return step * pow
}
export const money = (n: number, d = 0): string =>
  '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
export const moneyK = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k'
  return '$' + Math.round(n)
}

export function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : ''
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[i + 1]
    const cx = (x0 + x1) / 2
    d += ` C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`
  }
  return d
}

/** Draw an SVG path on mount. */
function useDrawPath(ref: React.RefObject<SVGPathElement | null>, deps: unknown[], dur = 1100, delay = 0): void {
  useEffect(() => {
    const el = ref.current
    if (!el || REDUCED) return
    const len = el.getTotalLength()
    el.style.strokeDasharray = String(len)
    el.style.strokeDashoffset = String(len)
    const a = el.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
      duration: dur,
      delay,
      easing: 'cubic-bezier(.33,1,.68,1)',
      fill: 'forwards'
    })
    failsafe(a, delay + dur + 260)
  }, deps)
}

type Row = Record<string, number | string>
interface PadSpec {
  t: number
  r: number
  b: number
  l: number
}

/** AreaLine: smooth area + line with draw-in and a hover crosshair. */
export function AreaLine({
  data,
  height = 200,
  color = 'var(--accent)',
  valueKey = 'value',
  labelKey = 'label',
  format = moneyK,
  fill = true,
  grid = true,
  pad = { t: 16, r: 8, b: 24, l: 44 }
}: {
  data: Row[]
  height?: number
  color?: string
  valueKey?: string
  labelKey?: string
  format?: (n: number) => string
  fill?: boolean
  grid?: boolean
  pad?: PadSpec
}): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const pathRef = useRef<SVGPathElement>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const vals = data.map((d) => Number(d[valueKey]))
  const max = niceMax(Math.max(...vals, 1))
  const min = Math.min(0, ...vals)
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const X = (i: number): number => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw)
  const Y = (v: number): number => pad.t + ih - ((v - min) / (max - min || 1)) * ih
  const pts: [number, number][] = data.map((d, i) => [X(i), Y(Number(d[valueKey]))])
  const line = smooth(pts)
  const area = `${line} L ${X(data.length - 1)} ${pad.t + ih} L ${X(0)} ${pad.t + ih} Z`
  useDrawPath(pathRef, [w, data.length], 1200)
  const gid = useId().replace(/:/g, '')
  const ticks = [0, 0.5, 1].map((f) => min + (max - min) * f)
  return (
    <div ref={wrap} style={{ width: '100%', position: 'relative' }}>
      <svg
        width={w}
        height={height}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - r.left
          let idx = Math.round(((x - pad.l) / iw) * (data.length - 1))
          idx = Math.max(0, Math.min(data.length - 1, idx))
          setHover(idx)
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid &&
          ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
              <text x={pad.l - 10} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)" className="mono">
                {format(t)}
              </text>
            </g>
          ))}
        {fill && <path d={area} fill={`url(#${gid})`} />}
        <path ref={pathRef} d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {hover !== null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--accent-line)" strokeWidth="1.5" />
            <circle cx={X(hover)} cy={Y(Number(data[hover][valueKey]))} r="5" fill="var(--surface)" stroke={color} strokeWidth="2.5" />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div
          style={{
            position: 'absolute',
            top: 4,
            left: Math.min(Math.max(X(hover) - 60, 0), w - 130),
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--r-sm)',
            padding: '8px 12px',
            pointerEvents: 'none',
            boxShadow: '0 10px 24px -12px hsl(var(--shadow-c)/.5)',
            minWidth: 118
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{String(data[hover][labelKey])}</div>
          <div style={{ fontSize: 15, fontWeight: 700 }} className="mono">
            {format(Number(data[hover][valueKey]))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Bars: vertical bars, optional second series drawn as a line. */
export function Bars({
  data,
  height = 200,
  valueKey = 'value',
  labelKey = 'label',
  color = 'var(--accent)',
  lineKey,
  lineColor = 'var(--warn)',
  format = moneyK,
  lineFormat,
  pad = { t: 16, r: 8, b: 26, l: 44 },
  maxBars = 14
}: {
  data: Row[]
  height?: number
  valueKey?: string
  labelKey?: string
  color?: string
  lineKey?: string
  lineColor?: string
  format?: (n: number) => string
  lineFormat?: (n: number) => string | number
  pad?: PadSpec
  maxBars?: number
}): JSX.Element {
  const wrap = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const d2 = data.slice(-maxBars)
  const vals = d2.map((d) => Number(d[valueKey]))
  const max = niceMax(Math.max(...vals, 1))
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const bw = Math.min(38, (iw / d2.length) * 0.62)
  const X = (i: number): number => pad.l + (i + 0.5) * (iw / d2.length)
  const Y = (v: number): number => pad.t + ih - (v / max) * ih
  const lvals = lineKey ? d2.map((d) => Number(d[lineKey])) : []
  const lmax = lineKey ? niceMax(Math.max(...lvals, 1)) : 1
  const LY = (v: number): number => pad.t + ih - (v / lmax) * ih
  const ticks = [0, 0.5, 1].map((f) => max * f)
  return (
    <div ref={wrap} style={{ width: '100%', position: 'relative' }}>
      <svg width={w} height={height} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={Y(t)} y2={Y(t)} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
            <text x={pad.l - 10} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)" className="mono">
              {format(t)}
            </text>
          </g>
        ))}
        {d2.map((d, i) => {
          const on = hover === i
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={X(i) - bw / 2} y={pad.t} width={bw} height={ih} fill="transparent" />
              <rect
                x={X(i) - bw / 2}
                y={Y(Number(d[valueKey]))}
                width={bw}
                height={pad.t + ih - Y(Number(d[valueKey]))}
                rx={Math.min(7, bw / 2)}
                fill={color}
                opacity={on ? 1 : 0.82}
                style={{
                  transition: 'opacity .2s',
                  transformOrigin: `center ${pad.t + ih}px`,
                  animation: REDUCED ? 'none' : `jc-bargrow .6s var(--ease-out) ${i * 16}ms backwards`
                }}
              />
              {i % Math.ceil(d2.length / 8) === 0 && (
                <text x={X(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-3)" className="mono">
                  {String(d[labelKey])}
                </text>
              )}
            </g>
          )
        })}
        {lineKey && (
          <path
            d={smooth(d2.map((d, i) => [X(i), LY(Number(d[lineKey]))]))}
            fill="none"
            stroke={lineColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 2px 6px hsl(var(--shadow-c)/.3))' }}
          />
        )}
        {lineKey &&
          d2.map((d, i) => (
            <circle key={i} cx={X(i)} cy={LY(Number(d[lineKey]))} r={hover === i ? 4.5 : 3} fill="var(--surface)" stroke={lineColor} strokeWidth="2" />
          ))}
      </svg>
      {hover !== null && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: Math.min(Math.max(X(hover) - 60, 0), w - 130),
            background: 'var(--surface-2)',
            border: '1px solid var(--border-2)',
            borderRadius: 'var(--r-sm)',
            padding: '8px 12px',
            pointerEvents: 'none',
            boxShadow: '0 10px 24px -12px hsl(var(--shadow-c)/.5)',
            minWidth: 110
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 3 }}>{String(d2[hover][labelKey])}</div>
          <div style={{ fontSize: 14.5, fontWeight: 700 }} className="mono">
            {format(Number(d2[hover][valueKey]))}
          </div>
          {lineKey && (
            <div style={{ fontSize: 12, fontWeight: 600, color: lineColor, marginTop: 2 }} className="mono">
              {(lineFormat || ((v: number) => v))(Number(d2[hover][lineKey]))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export interface DonutDatum {
  label: string
  value: number
  color: string
  display?: string
}

/** Donut: segmented ring with a center label + interactive legend. */
export function Donut({
  data,
  size = 170,
  thickness = 22,
  gap = 3,
  centerLabel,
  centerValue
}: {
  data: DonutDatum[]
  size?: number
  thickness?: number
  gap?: number
  centerLabel?: ReactNode
  centerValue?: ReactNode
}): JSX.Element {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let acc = 0
  const [hover, setHover] = useState<number | null>(null)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {data.map((d, i) => {
            const frac = d.value / total
            const len = frac * c
            const seg = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={hover === i ? thickness + 4 : thickness}
                strokeDasharray={`${Math.max(len - gap, 0.001)} ${c}`}
                strokeDashoffset={-acc}
                strokeLinecap="round"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{ transition: 'stroke-width .2s', cursor: 'pointer', animation: REDUCED ? 'none' : `jc-dashin 1s var(--ease-out) ${i * 90}ms backwards` }}
              />
            )
            acc += len
            return seg
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em' }} className="mono">
              {hover !== null ? Math.round((data[hover].value / total) * 100) + '%' : centerValue}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1 }}>{hover !== null ? data[hover].label : centerLabel}</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1, minWidth: 120 }}>
        {data.map((d, i) => (
          <div
            key={i}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 9, opacity: hover === null || hover === i ? 1 : 0.45, transition: 'opacity .2s', cursor: 'default' }}
          >
            <span style={{ width: 11, height: 11, borderRadius: 4, background: d.color, flex: '0 0 auto' }} />
            <span style={{ fontSize: 13, color: 'var(--text-2)', flex: 1, fontWeight: 500 }}>{d.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700 }} className="mono">
              {d.display || Math.round((d.value / total) * 100) + '%'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Sparkline: tiny inline trend. */
export function Sparkline({
  data,
  width = 96,
  height = 30,
  color = 'var(--accent)',
  fill = true
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
  fill?: boolean
}): JSX.Element {
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const X = (i: number): number => (i / (data.length - 1)) * width
  const Y = (v: number): number => height - ((v - min) / (max - min || 1)) * (height - 4) - 2
  const pts: [number, number][] = data.map((v, i) => [X(i), Y(v)])
  const line = smooth(pts)
  const gid = useId().replace(/:/g, '')
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${line} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export interface HBarDatum {
  label: string
  value: number
  color?: string
  icon?: ReactNode
}

/** HBars: horizontal ranking bars. */
export function HBars({
  data,
  format = moneyK,
  color = 'var(--accent)',
  max: forcedMax
}: {
  data: HBarDatum[]
  format?: (n: number) => string
  color?: string
  max?: number
}): JSX.Element {
  const max = forcedMax || Math.max(...data.map((d) => d.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {data.map((d, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, color: 'var(--text-2)' }}>
              {d.icon}
              {d.label}
            </span>
            <span style={{ fontWeight: 700 }} className="mono">
              {format(d.value)}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${(d.value / max) * 100}%`,
                borderRadius: 99,
                background: d.color || color,
                animation: REDUCED ? 'none' : `jc-grow 0.9s var(--ease-out) ${i * 70}ms backwards`
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
