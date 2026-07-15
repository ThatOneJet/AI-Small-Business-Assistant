/**
 * JetCore redesign — shared system helpers (Wave 1 foundation).
 *
 * Ported VERBATIM from the Claude Design handoff (JetCore.dc.html):
 *   - tone(hue, c)  — design line 141–143 (per-domain OKLCH accent ramp)
 *   - DOMAINS       — design line 145–152 (the six worlds: name/sub/glyph/hue/c/kind)
 *
 * These are the building blocks every redesigned space + the Hangar Brief reuse,
 * so later waves import from here rather than re-deriving the palette.
 */

/** A per-domain OKLCH accent ramp (base/bright/deep + soft/line/wash washes). */
export interface Tone {
  base: string
  bright: string
  deep: string
  ink: string
  soft: string
  line: string
  wash: string
}

/** Derive a domain's accent ramp from an OKLCH hue + chroma (design 141–143). */
export function tone(hue: number, c = 0.15): Tone {
  return {
    base: `oklch(0.64 ${c} ${hue})`,
    bright: `oklch(0.72 ${c} ${hue})`,
    deep: `oklch(0.55 ${c} ${hue})`,
    ink: `oklch(0.99 0.02 ${hue})`,
    soft: `oklch(0.64 ${c} ${hue} / 0.13)`,
    line: `oklch(0.64 ${c} ${hue} / 0.34)`,
    wash: `oklch(0.64 ${c} ${hue} / 0.07)`
  }
}

/** Which worlds open as full "spaces" vs. tool doorways. */
export type DomainKind = 'space' | 'tool'

/** A JetCore world: its identity, glyph, and accent hue (design 145–152). */
export interface Domain {
  name: string
  sub: string
  glyph: string
  hue: number
  c: number
  kind: DomainKind
}

/** The id of one of the six worlds. */
export type DomainId = 'pylon' | 'devbay' | 'summit' | 'pulse' | 'borderless' | 'forge'

/** The six worlds (design 145–152). Glyphs map to JC_ICONS names. */
export const DOMAINS: Record<DomainId, Domain> = {
  pylon: { name: 'Pylon', sub: 'School', glyph: 'cap', hue: 250, c: 0.15, kind: 'space' },
  devbay: { name: 'DevBay', sub: 'Code', glyph: 'code', hue: 300, c: 0.16, kind: 'space' },
  summit: { name: 'Summit', sub: 'The shop', glyph: 'mountain', hue: 150, c: 0.13, kind: 'space' },
  pulse: { name: 'Pulse', sub: 'Feeds & music', glyph: 'spark', hue: 350, c: 0.16, kind: 'space' },
  borderless: { name: 'Borderless', sub: 'Your desk', glyph: 'grid', hue: 205, c: 0.13, kind: 'tool' },
  forge: { name: 'Forge', sub: 'Planning', glyph: 'branch', hue: 55, c: 0.14, kind: 'tool' }
}
