/* JetCore icon set — rounded line icons on a 24px grid (ported from icons.jsx). */
import type { CSSProperties, JSX } from 'react'

export const JC_ICONS: Record<string, string> = {
  core: 'M12 3.2c2 2.6 2 6.2 0 8.8M12 3.2c-2 2.6-2 6.2 0 8.8M12 12c2.6 2 6.2 2 8.8 0M12 12c-2.6 2-6.2 2-8.8 0M12 12c2 2.6 2 6.2 0 8.8M12 12c-2 2.6-2 6.2 0 8.8M12 12c2.6-2 6.2-2 8.8 0M12 12c-2.6-2-6.2-2-8.8 0',
  hangar: 'M3 21V10.5L12 4l9 6.5V21M3 21h18M8 21v-6a4 4 0 0 1 8 0v6',
  devbay: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12',
  summit: 'M3 19h18M5 19l4.5-9 3.5 5 2.5-4.5L20 19',
  pylon: 'M12 3L3 8l9 5 9-5-9-5zM5.5 11v4.2c0 .9 2.9 2.8 6.5 2.8s6.5-1.9 6.5-2.8V11M20 9v5',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 6.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6L9 17l-5-5',
  chevR: 'M9 6l6 6-6 6',
  chevD: 'M6 9l6 6 6-6',
  chevL: 'M15 6l-6 6 6 6',
  arrowR: 'M5 12h14M13 6l6 6-6 6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowDn: 'M12 5v14M6 13l6 6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  bolt: 'M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z',
  star: 'M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17.8 6.7 19.6l1.1-6L3.4 9.4l6-.8L12 3z',
  flag: 'M5 21V4M5 4c3-2 7 2 10 0v9c-3 2-7-2-10 0',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 8a4 4 0 0 0 4 4 4 4 0 0 0-4 4 4 4 0 0 0-4-4 4 4 0 0 0 4-4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  calendar: 'M3 9h18M7 3v3M17 3v3M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  trend: 'M3 17l6-6 4 4 8-8M21 7v5M21 7h-5',
  wallet: 'M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a3 3 0 0 1-3-3zM17 13h.01',
  chart: 'M3 3v18h18M8 15v3M13 11v7M18 7v11',
  donut: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  people: 'M16 21a5 5 0 0 0-10 0M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 21a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  repo: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM15 6a9 9 0 0 1-9 9',
  tag: 'M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  ship: 'M2 20a6 6 0 0 0 6-3 6 6 0 0 0 12 0 6 6 0 0 0 2 .9M4 18l-1-6h18l-1 6M12 3v9M8 6h8',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 0 4 5.5v14z',
  cap: 'M22 10L12 5 2 10l10 5 10-5zM6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-4M12 8h.01',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  layers: 'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5L22 3z',
  refresh: 'M21 2v6h-6M3 22v-6h6M3.5 9a9 9 0 0 1 14.8-3.4L21 8M21 15a9 9 0 0 1-14.8 3.4L3 16',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  lock: 'M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  github: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.2-1.5 6.2-6.7A5.2 5.2 0 0 0 19 4.8 4.9 4.9 0 0 0 18.9 1S17.7.6 15 2.5a13 13 0 0 0-7 0C5.3.6 4.1 1 4.1 1A4.9 4.9 0 0 0 4 4.8a5.2 5.2 0 0 0-1.4 3.7c0 5.2 3.2 6.4 6.2 6.7a3.4 3.4 0 0 0-.9 2.5V22',
  fire: 'M12 22a7 7 0 0 0 7-7c0-3-2-5-3-7-1 2-2 2.5-3 2.5C11 8 11 4 12 2 8 4 5 8 5 13a7 7 0 0 0 7 9z',
  pin: 'M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11zM12 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  hash: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  cash: 'M3 6h18v12H3zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 9v.01M18 15v.01',
  card: 'M3 7h18a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM2 11h20',
  receipt: 'M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2-2-1.5zM9 7h6M9 11h6',
  hourglass: 'M6 2h12M6 22h12M6 2c0 5 6 5 6 10M18 2c0 5-6 5-6 10M6 22c0-5 6-5 6-10M18 22c0-5-6-5-6-10',

  /* ── Redesign ("Hangar") glyphs — exact paths from the Claude Design handoff
       (JetCore.dc.html ICONS, lines 69–129). Joined into a single `d`. ── */
  home: 'M3 10.5 12 4l9 6.5 M5 10v9h14v-9 M9 19v-5h6v5',
  code: 'm8 9-3 3 3 3 m16 9 3 3-3 3 m13 7-2 10',
  mountain: 'm3 18 5-9 4 5 3-4 6 8z',
  music: 'M9 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M9 12V3l10-1v9 M19 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  play: 'M6 4l14 8-14 8Z',
  pause: 'M7 5h3v14H7z M14 5h3v14h-3z',
  rss: 'M5 18a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z M4 11a9 9 0 0 1 9 9 M4 4a16 16 0 0 1 16 16',
  at: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  note: 'M4 4h12l4 4v12H4z M14 4v4h4'
}

/**
 * The spinning 4-petal JetCore core glyph (design 135–139). Used as the Hangar
 * wordmark mark. `spin` animates it via the redesign `jcr-spin` keyframe.
 */
export function coreGlyph({
  size = 22,
  spin = false,
  style = {}
}: {
  size?: number
  spin?: boolean
  style?: CSSProperties
} = {}): JSX.Element {
  const petals = [
    'M12 2.5C14.4 5.8 14.4 9.5 12 12 9.6 9.5 9.6 5.8 12 2.5Z',
    'M12 21.5C9.6 18.2 9.6 14.5 12 12 14.4 14.5 14.4 18.2 12 21.5Z',
    'M2.5 12C5.8 9.6 9.5 9.6 12 12 9.5 14.4 5.8 14.4 2.5 12Z',
    'M21.5 12C18.2 14.4 14.5 14.4 12 12 14.5 9.6 18.2 9.6 21.5 12Z'
  ]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', animation: spin ? 'jcr-spin 18s linear infinite' : 'none', ...style }}
    >
      <g stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
        {petals.map((d, i) => (
          <path key={i} d={d} />
        ))}
        <circle cx={12} cy={12} r={2.1} fill="currentColor" />
      </g>
    </svg>
  )
}

export function Icon({
  name,
  size = 20,
  stroke = 1.9,
  fill = 'none',
  className = '',
  style = {}
}: {
  name: string
  size?: number
  stroke?: number
  fill?: string
  className?: string
  style?: CSSProperties
}): JSX.Element {
  const d = JC_ICONS[name] || JC_ICONS.info
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} className={className} style={{ flex: '0 0 auto', ...style }} aria-hidden="true">
      <path d={d} stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
