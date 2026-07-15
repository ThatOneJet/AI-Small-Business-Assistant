/* JetCore app registry (redesign) — identity for the apps on the rail. */
import type { JCAppId } from './contract'

export interface JCAppMeta {
  id: JCAppId
  name: string
  glyph: string
  tagline: string
  who: string
  desc: string
}

export const APPS: JCAppMeta[] = [
  { id: 'hangar', name: 'Hangar', glyph: 'hangar', tagline: 'Your home base', who: 'Everyone', desc: 'Everything at a glance.' },
  { id: 'summit', name: 'Summit', glyph: 'summit', tagline: 'Run the numbers', who: 'Operators', desc: "Sales, labor, finances — what's trending wrong." },
  { id: 'pylon', name: 'Pylon', glyph: 'pylon', tagline: 'Know where you stand', who: 'Students', desc: 'Grades decoded, due dates by urgency.' },
  { id: 'borderless', name: 'Borderless', glyph: 'grid', tagline: 'One desk, one keyboard', who: 'Multi-PC setups', desc: 'Drive every machine on your desk with a single keyboard & mouse.' },
  { id: 'forge', name: 'Forge', glyph: 'branch', tagline: 'Plan any system', who: 'Builders & planners', desc: 'A canvas to map any system — boxes, connections, and notes.' },
  { id: 'devbay', name: 'DevBay', glyph: 'devbay', tagline: 'Ship with confidence', who: 'Developers', desc: 'Make scattered repos legible, ship in two steps.' }
]

export const APP_BY: Record<JCAppId, JCAppMeta> = Object.fromEntries(APPS.map((a) => [a.id, a])) as Record<
  JCAppId,
  JCAppMeta
>
