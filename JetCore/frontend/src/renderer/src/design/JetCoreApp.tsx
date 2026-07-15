/* ============================================================
   JetCore — redesigned app root (Wave 1: briefing-first "Hangar").
   Boot gate (E2EE auth) → EntryFlow when signed out, else the new
   briefing-first shell: a 60px contextual chrome (NO rail/topbar)
   over the Hangar Brief or a space, plus the ⌘K palette + account
   menu. Auth/boot/vault/theme/update/walkthrough are PRESERVED.
   ============================================================ */
import { useCallback, useEffect, useState, type JSX } from 'react'
import './tokens.css'
import { applyTheme, readTheme } from './contract'
import { summitEntitled } from '@shared/types'
import { Chrome, HangarBrief, Palette, AccountMenu, SpaceStub, type SpaceId, type View } from './redesign/Hangar'
import { SummitSpace } from './redesign/spaces/SummitSpace'
import { PylonSpace } from './redesign/spaces/PylonSpace'
import { DevBaySpace } from './redesign/spaces/DevBaySpace'
import { ForgeSpace } from './redesign/spaces/ForgeSpace'
import { BorderlessSpace } from './redesign/spaces/BorderlessSpace'
import { PulseSpace } from './redesign/spaces/PulseSpace'
import { Spinner } from './ui'

/** Non-secret account profile used for app entitlements (from the token-safe bridge). */
type AcctProfile = { email?: string; firstName?: string; segment?: string; plan?: string; isAdmin?: boolean }
import { EntryFlow } from './apps/entry'
import { SettingsScreen } from './apps/settings'
import { Walkthrough, hasOnboarded, markOnboarded } from './Walkthrough'
import UpdateOverlay from '../components/UpdateOverlay'

/** Restore persisted accent vibrancy / roundness prefs (set in Settings). */
function applyLookPrefs(): void {
  try {
    const ac = localStorage.getItem('jc.ac')
    const rs = localStorage.getItem('jc.rs')
    if (ac) document.documentElement.style.setProperty('--ac', ac)
    if (rs) document.documentElement.style.setProperty('--rs', rs)
  } catch {
    /* ignore */
  }
}

export default function JetCoreApp(): JSX.Element {
  const [view, setView] = useState<'boot' | 'entry' | 'app'>('boot')
  const [theme, setThemeState] = useState<'dark' | 'light'>(readTheme())
  // ── Redesign nav: the briefing-first shell shows either the Hangar Brief or a
  //    single space; ⌘K opens the palette; the avatar opens the account menu. ──
  const [rview, setRview] = useState<View>('brief')
  const [rspace, setRspace] = useState<SpaceId | ''>('')
  const [palette, setPalette] = useState(false)
  const [account, setAccount] = useState(false)
  const [route, setRoute] = useState<null | 'settings'>(null)
  const [email, setEmail] = useState('')
  // Whether the E2EE vault is unlocked (drives the Brief's encryption footer).
  const [vaultUnlocked, setVaultUnlocked] = useState(false)
  // The signed-in JetCore account (plan/segment) — drives app entitlements
  // (Summit is a Small-business / Enterprise feature).
  const [acct, setAcct] = useState<AcctProfile | null>(null)
  // First-run walkthrough (5 steps), shown once per account.
  const [walkthrough, setWalkthrough] = useState(false)

  const setTheme = useCallback((t: 'dark' | 'light') => {
    setThemeState(t)
    applyTheme(t)
  }, [])

  // ── Boot: theme + look prefs + auth gate ──
  useEffect(() => {
    applyTheme(readTheme())
    applyLookPrefs()
    let alive = true
    void window.decks?.cloud
      ?.status()
      .then((s) => {
        if (!alive) return
        if (s?.unlocked) {
          setEmail(s.email ?? '')
          setVaultUnlocked(!!s.unlocked)
          setView('app')
          // Fetch the real Operations account (segment/plan/is_admin) in the
          // background via a token-safe bridge — this also warms the Summit backend.
          // Admins are entitled instantly via the email allowlist; business segments
          // unlock when this resolves.
          void window.decks?.summit
            ?.account()
            .then((res) => {
              if (alive && res?.ok && res.account) setAcct(res.account)
            })
            .catch(() => {})
        } else {
          setView('entry')
        }
      })
      .catch(() => {
        if (alive) setView('entry')
      })
    return () => {
      alive = false
    }
  }, [])

  // ── ⌘/Ctrl+K → toggle the palette; Esc → close palette/account ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette((o) => !o)
      }
      if (e.key === 'Escape') {
        setPalette(false)
        setAccount(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── First-run walkthrough: show once per account on first reach of the app ──
  useEffect(() => {
    if (view === 'app' && email && !hasOnboarded(email)) setWalkthrough(true)
  }, [view, email])

  // ── Redesign nav: enter a space / return to the Hangar Brief ──
  const enter = useCallback((s: SpaceId): void => {
    setRspace(s)
    setRview('space')
    setRoute(null)
    setPalette(false)
    setAccount(false)
  }, [])
  const home = useCallback((): void => {
    setRview('brief')
    setRspace('')
    setRoute(null)
    setPalette(false)
  }, [])
  const openSettings = useCallback(() => setRoute('settings'), [])

  const signOut = useCallback(async (): Promise<void> => {
    await window.decks?.cloud?.signOut().catch(() => {})
    setEmail('')
    setVaultUnlocked(false)
    setRoute(null)
    setRview('brief')
    setRspace('')
    setView('entry')
  }, [])

  const onAuthed = useCallback((): void => {
    void window.decks?.cloud?.status().then((s) => {
      setEmail(s?.email ?? '')
      setVaultUnlocked(!!s?.unlocked)
    })
    void window.decks?.summit
      ?.account()
      .then((res) => {
        if (res?.ok && res.account) setAcct(res.account)
      })
      .catch(() => {})
    setRview('brief')
    setRspace('')
    setView('app')
  }, [])

  const name = email ? email.split('@')[0].replace(/[._-]+/g, ' ') : 'You'
  // First name for the Brief greeting; "there" when we don't know it.
  const firstName = acct?.firstName?.trim() || (email ? email.split('@')[0].replace(/[._-]+/g, ' ').split(' ')[0] : '') || 'there'
  // Two-letter avatar initials from the display name.
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || 'JC'

  // Summit is a Small-business / Enterprise feature. The Brief surfaces its
  // dispatch only for entitled accounts (non-entitled accounts don't see shop
  // numbers or a Summit dispatch at all). Entitlement: the signed-in vault email
  // (always present) drives the admin allowlist; segment/plan come from the
  // Operations account when it's loaded.
  const canSummit = summitEntitled({
    email: email || acct?.email,
    segment: acct?.segment,
    plan: acct?.plan,
    isAdmin: acct?.isAdmin
  })
  // Window controls — the window is frameless; the chrome bar is the drag region.
  const winBtn = (label: string, onClick: () => void, path: string, danger?: boolean): JSX.Element => (
    <button
      className="tap no-drag"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? 'var(--neg)' : 'var(--card-2)'
        e.currentTarget.style.color = danger ? 'var(--bg)' : 'var(--ink)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--ink-3)'
      }}
      style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 8, color: 'var(--ink-3)' }}
    >
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
        <path d={path} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
  const winControls = (
    <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 4 }}>
      {winBtn('Minimize', () => window.decks?.window.minimize(), 'M5 12h14')}
      {winBtn('Maximize', () => window.decks?.window.maximize(), 'M6 6h12v12H6z')}
      {winBtn('Close', () => window.decks?.window.close(), 'M6 6l12 12M18 6L6 18', true)}
    </div>
  )

  if (view === 'boot') {
    return (
      <div className="jc-root jc-redesign" data-theme={theme} style={{ height: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <Spinner size={28} />
      </div>
    )
  }

  if (view === 'entry') {
    return (
      <div className="jc-root" data-app="hangar" style={{ height: '100vh', overflow: 'hidden' }}>
        <EntryFlow onDone={onAuthed} />
        <UpdateOverlay />
      </div>
    )
  }

  // Settings keeps the legacy surface (its own back chrome); it renders on the
  // cool token set, so we DON'T add jc-redesign here.
  if (route === 'settings') {
    return (
      <div className="jc-root" data-app="hangar" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', position: 'relative' }}>
        <div className="drag" style={{ background: 'var(--panel)', height: 44, display: 'flex', alignItems: 'center', padding: '0 10px 0 22px', gap: 11 }}>
          <button className="tap no-drag" onClick={() => setRoute(null)} aria-label="Back" style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 9, color: 'var(--text-2)' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>Settings</div>
          <div style={{ flex: 1 }} />
          {winControls}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
          <SettingsScreen theme={theme} setTheme={setTheme} signOut={signOut} back={() => setRoute(null)} />
        </div>
        <UpdateOverlay />
      </div>
    )
  }

  return (
    <div
      className="jc-root jc-redesign"
      data-theme={theme}
      data-space={rview === 'space' ? rspace : 'home'}
      style={{ height: '100vh', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--font)' }}
    >
      <Chrome
        view={rview}
        space={rspace}
        theme={theme}
        initials={initials}
        onHome={home}
        onPalette={() => {
          setPalette(true)
          setAccount(false)
        }}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onAccount={() => setAccount((o) => !o)}
        winControls={winControls}
      />

      <div key={rview + rspace} className="rise" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {rview === 'brief' ? (
          <HangarBrief firstName={firstName} vaultUnlocked={vaultUnlocked} canSummit={canSummit} onEnter={enter} />
        ) : rspace === 'pylon' ? (
          <PylonSpace />
        ) : rspace === 'devbay' ? (
          <DevBaySpace />
        ) : rspace === 'summit' ? (
          canSummit ? <SummitSpace /> : <SpaceStub space="summit" onEnter={enter} />
        ) : rspace === 'forge' ? (
          <ForgeSpace />
        ) : rspace === 'borderless' ? (
          <BorderlessSpace />
        ) : rspace === 'pulse' ? (
          <PulseSpace />
        ) : (
          <SpaceStub space={(rspace || 'pylon') as SpaceId} onEnter={enter} />
        )}
      </div>

      {palette && (
        <Palette
          theme={theme}
          onClose={() => setPalette(false)}
          onEnter={enter}
          onHome={home}
          onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        />
      )}
      {account && (
        <AccountMenu
          name={name}
          email={email}
          initials={initials}
          onClose={() => setAccount(false)}
          onSettings={openSettings}
          onSignOut={() => void signOut()}
        />
      )}

      {walkthrough && (
        <Walkthrough
          name={name}
          canSummit={canSummit}
          onDone={() => {
            markOnboarded(email)
            setWalkthrough(false)
          }}
        />
      )}
      <UpdateOverlay />
    </div>
  )
}
