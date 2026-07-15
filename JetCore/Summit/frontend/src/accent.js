// ── Accent color theming ──────────────────────────────────────────────────────
// JetCore (Operations) accent picker. The chosen hex drives the --acc family of
// CSS variables on <html>, mirroring Decks' Appearance accent customizability.
// Unified JetCore trademark: RED across every app (forced — see getStoredAccent).

export const DEFAULT_ACCENT = '#ff3b3b'

// Swatch palette shown in Settings → Appearance.
export const ACCENT_OPTIONS = [
  { hex: '#ff3b3b', name: 'Red'    },   // default (unified JetCore accent)
  { hex: '#2f6bff', name: 'Blue'   },
  { hex: '#7c5cff', name: 'Violet' },
  { hex: '#13c8a6', name: 'Teal'   },
  { hex: '#ff476f', name: 'Rose'   },
  { hex: '#f5b342', name: 'Amber'  },
]

function hexToRgb(hex) {
  let h = (hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// Lighten toward white by `amt` (0..1) for the -hi highlight variant.
function lighten(hex, amt) {
  const { r, g, b } = hexToRgb(hex)
  const mix = (c) => Math.round(c + (255 - c) * amt)
  const to2 = (c) => mix(c).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

// Derive the full --acc family from a single hex and write it onto <html>.
export function applyAccent(hex) {
  const acc = hex || DEFAULT_ACCENT
  const { r, g, b } = hexToRgb(acc)
  const root = document.documentElement
  root.style.setProperty('--acc',      acc)
  root.style.setProperty('--acc-hi',   lighten(acc, 0.25))
  root.style.setProperty('--acc-glow', `rgba(${r}, ${g}, ${b}, 0.45)`)
  root.style.setProperty('--acc-soft', `rgba(${r}, ${g}, ${b}, 0.12)`)
  root.style.setProperty('--acc-line', `rgba(${r}, ${g}, ${b}, 0.30)`)
}

export function getStoredAccent() {
  // Unified red trademark: ignore any older stored accent and force red. (Restore
  // `localStorage.getItem('accent') || DEFAULT_ACCENT` to re-enable the picker.)
  return DEFAULT_ACCENT
}

export function setStoredAccent(hex) {
  localStorage.setItem('accent', hex)
  applyAccent(hex)
}
