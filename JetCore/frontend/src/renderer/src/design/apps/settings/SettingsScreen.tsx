/* ============================================================
   JetCore — Settings (universal), ported from the Claude Design
   prototype (design/jetcore/project/src/settings.jsx) onto REAL
   account + preference plumbing:
     - Appearance leads (theme is the headline tweak), plus the
       prototype's look tweaks: accent vibrancy → '--ac' and
       roundness → '--rs', persisted to localStorage ('jc.ac' /
       'jc.rs') so JetCoreApp.applyLookPrefs() restores them on
       boot;
     - Account reads window.decks.cloud.status() (email, admin),
       Sign out calls props.signOut();
     - Security & vault note (E2EE, recovery key shown at signup);
     - About: app name + version line.
   The shell already renders the "Settings" title + Back button in
   the topbar and applies data-theme on <html> via props.setTheme,
   so this screen is the scrollable body only.
   ============================================================ */
import { useEffect, useState, type CSSProperties, type JSX, type ReactNode } from 'react'
import { Badge, Button, Card, Divider, Segmented, SectionTitle } from '../../ui'
import { Reveal } from '../../motion'
import { Icon } from '../../icons'
import type { JCSettingsProps } from '../../contract'

/* ---------------- look-preference scales (mirror the prototype's tweaks) ---------------- */

const AC_KEY = 'jc.ac'
const RS_KEY = 'jc.rs'

type Vibrancy = 'subtle' | 'balanced' | 'vivid'
type Roundness = 'sharp' | 'soft' | 'pill'

/** Accent chroma per vibrancy step → CSS '--ac'. Default token is 0.155 (balanced). */
const AC_VALUE: Record<Vibrancy, number> = { subtle: 0.11, balanced: 0.155, vivid: 0.205 }
/** Radius scale per roundness step → CSS '--rs'. Default token is 1 (soft).
 *  'sharp' = 0 (square corners); 'pill' = 2.4 (radius big enough that buttons/inputs
 *  read as pills). The old 0.5 / 1.5 were too subtle to look sharp or pill at all. */
const RS_VALUE: Record<Roundness, number> = { sharp: 0, soft: 1, pill: 2.4 }

/** Find the nearest enum step for a stored numeric value (falls back to the default). */
function nearest<K extends string>(table: Record<K, number>, raw: string | null, fallback: K): K {
  if (raw === null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  let best = fallback
  let bestGap = Infinity
  for (const key of Object.keys(table) as K[]) {
    const gap = Math.abs(table[key] - n)
    if (gap < bestGap) {
      bestGap = gap
      best = key
    }
  }
  return best
}

function readVibrancy(): Vibrancy {
  try {
    return nearest(AC_VALUE, localStorage.getItem(AC_KEY), 'balanced')
  } catch {
    return 'balanced'
  }
}

function readRoundness(): Roundness {
  try {
    return nearest(RS_VALUE, localStorage.getItem(RS_KEY), 'soft')
  } catch {
    return 'soft'
  }
}

function setVar(name: string, value: number, storageKey: string): void {
  const v = String(value)
  document.documentElement.style.setProperty(name, v)
  try {
    localStorage.setItem(storageKey, v)
  } catch {
    /* ignore — a look pref must never trap the user */
  }
}

/* ---------------- "you@example.com" → "Adityasrijeet" (matches Hangar's nameFromEmail) ---------------- */

function nameFromEmail(email: string): string {
  const raw = email.split('@')[0] ?? ''
  const seg = raw.split(/[._\-+]/)[0] ?? raw
  const letters = seg.replace(/\d+$/g, '')
  const base = letters || seg
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : email
}

/* ---------------- the prototype's SettingRow ---------------- */

function SettingRow({
  icon,
  title,
  sub,
  children,
  last
}: {
  icon?: string
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  last?: boolean
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 0',
        borderBottom: last ? 'none' : '1px solid var(--border)'
      }}
    >
      {icon && (
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 'var(--r-sm)',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--surface-2)',
            color: 'var(--text-2)',
            flex: '0 0 auto'
          }}
        >
          <Icon name={icon} size={18} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        {sub && <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 2 }}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

/* ---------------- signed-in account state ---------------- */

interface AccountState {
  loaded: boolean
  email: string | null
  isAdmin: boolean
  unlocked: boolean
}

const APP_VERSION = '1.4.0'

export function SettingsScreen(props: JCSettingsProps): JSX.Element {
  const { theme, setTheme, signOut } = props

  const [vibrancy, setVibrancyState] = useState<Vibrancy>(readVibrancy)
  const [roundness, setRoundnessState] = useState<Roundness>(readRoundness)
  const [account, setAccount] = useState<AccountState>({ loaded: false, email: null, isAdmin: false, unlocked: false })
  const [signingOut, setSigningOut] = useState(false)

  /* signed-in account (email + admin + vault status) */
  useEffect(() => {
    let alive = true
    window.decks?.cloud
      .status()
      .then((st) => {
        if (alive)
          setAccount({ loaded: true, email: st.email ?? null, isAdmin: st.isAdmin ?? false, unlocked: st.unlocked })
      })
      .catch(() => {
        if (alive) setAccount({ loaded: true, email: null, isAdmin: false, unlocked: false })
      })
    return () => {
      alive = false
    }
  }, [])

  const onVibrancy = (next: Vibrancy): void => {
    setVibrancyState(next)
    setVar('--ac', AC_VALUE[next], AC_KEY)
  }
  const onRoundness = (next: Roundness): void => {
    setRoundnessState(next)
    setVar('--rs', RS_VALUE[next], RS_KEY)
  }

  const onSignOut = async (): Promise<void> => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
    } catch {
      // The shell owns navigation; if sign-out throws, re-enable the button so
      // the user can retry rather than being stuck on a dead control.
      setSigningOut(false)
    }
  }

  const displayName = account.email ? nameFromEmail(account.email) : 'Your account'

  const sectionGap: CSSProperties = { marginTop: 18 }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '34px 40px 60px' }}>
      <Reveal>
        <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-0.025em' }}>Settings</h1>
        <p style={{ fontSize: 14.5, color: 'var(--text-3)', marginTop: 5 }}>
          Preferences that apply across every JetCore app.
        </p>
      </Reveal>

      {/* Appearance — theme leads, then the prototype's look tweaks */}
      <Reveal delay={80}>
        <Card style={{ marginTop: 24 }}>
          <SectionTitle icon="sun" title="Appearance" sub="How JetCore looks on this device" />
          <SettingRow title="Theme" sub="Dark is recommended for long sessions">
            <Segmented
              size="sm"
              value={theme}
              onChange={(v) => setTheme(v === 'light' ? 'light' : 'dark')}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' }
              ]}
            />
          </SettingRow>
          <SettingRow title="Accent vibrancy" sub="How saturated each app's hue feels">
            <Segmented
              size="sm"
              value={vibrancy}
              onChange={(v) => onVibrancy(v as Vibrancy)}
              options={[
                { value: 'subtle', label: 'Subtle' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'vivid', label: 'Vivid' }
              ]}
            />
          </SettingRow>
          <SettingRow title="Roundness" sub="Corner radius across cards, buttons and inputs" last>
            <Segmented
              size="sm"
              value={roundness}
              onChange={(v) => onRoundness(v as Roundness)}
              options={[
                { value: 'sharp', label: 'Sharp' },
                { value: 'soft', label: 'Soft' },
                { value: 'pill', label: 'Pill' }
              ]}
            />
          </SettingRow>
        </Card>
      </Reveal>

      {/* Account */}
      <Reveal delay={140}>
        <Card style={sectionGap}>
          <SectionTitle icon="user" title="Account" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0 18px' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 'var(--r-sm)',
                flex: '0 0 auto',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--accent-ink)',
                background: 'linear-gradient(135deg, var(--accent), var(--accent-d))',
                fontWeight: 700,
                fontSize: 20
              }}
            >
              <Icon name="user" size={26} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{displayName}</span>
                {account.isAdmin && (
                  <Badge tone="accent" icon="bolt">
                    Admin
                  </Badge>
                )}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--text-3)',
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {account.loaded ? account.email ?? 'Not signed in' : 'Loading…'}
              </div>
            </div>
            <Badge tone={account.unlocked ? 'pos' : 'neutral'} dot>
              {account.unlocked ? 'Vault unlocked' : 'Vault locked'}
            </Badge>
          </div>
          <Divider />
          <SettingRow icon="logout" title="Sign out" sub="End your session on this device" last>
            <Button variant="danger" size="sm" icon="logout" onClick={() => void onSignOut()} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </SettingRow>
        </Card>
      </Reveal>

      {/* Security & vault */}
      <Reveal delay={200}>
        <Card style={sectionGap}>
          <SectionTitle icon="shield" title="Security & vault" />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 'var(--r-md)',
              background: 'color-mix(in oklch, var(--pos) 8%, transparent)',
              border: '1px solid color-mix(in oklch, var(--pos) 20%, transparent)',
              marginBottom: 14
            }}
          >
            <Icon name="lock" size={18} style={{ color: 'var(--pos)' }} />
            <div style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5 }}>
              <strong>End-to-end encrypted.</strong> All integration tokens are encrypted on this device and never leave
              it unencrypted — not even we can read them.
            </div>
            <Badge tone="pos" dot>
              E2EE
            </Badge>
          </div>
          <SettingRow icon="shield" title="Recovery key" sub="Shown once at signup — losing it (and your password) is unrecoverable by design" last>
            <Badge tone="neutral">Saved offline</Badge>
          </SettingRow>
        </Card>
      </Reveal>

      {/* About */}
      <Reveal delay={260}>
        <Card style={sectionGap}>
          <SectionTitle icon="core" title="About" />
          <SettingRow icon="core" title="JetCore" sub="One desktop platform, four focused apps" last>
            <Badge tone="neutral" icon="check">
              v{APP_VERSION}
            </Badge>
          </SettingRow>
        </Card>
      </Reveal>

      <div style={{ textAlign: 'center', marginTop: 26, fontSize: 12.5, color: 'var(--text-3)' }}>
        JetCore · v{APP_VERSION} · Press{' '}
        <kbd className="mono" style={{ border: '1px solid var(--border-2)', borderRadius: 5, padding: '1px 6px' }}>
          Ctrl K
        </kbd>{' '}
        anywhere to jump
      </div>
    </div>
  )
}
