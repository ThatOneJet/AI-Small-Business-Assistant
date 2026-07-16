import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import Overview     from './tabs/Overview'
import Labor        from './tabs/Labor'
import Sales        from './tabs/Sales'
import Expenses     from './tabs/Expenses'
import Inventory    from './tabs/Inventory'
import Reviews      from './tabs/Reviews'
import Accounts     from './tabs/Accounts'
import Finances     from './tabs/Finances'
import Settings     from './tabs/Settings'
import Admin        from './tabs/Admin'
import Assistant    from './tabs/Assistant'
import PricingModal from './PricingModal'
import AddWorkspaceModal from './AddWorkspaceModal'
import Tour, { TOUR_STEPS } from './tabs/Tour'
import { meetsRequired } from '../planGating'

// ── Icon helper ──────────────────────────────────────────────────────────────
const I = ({ d, children, size = 16, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    {[].concat(d || []).map((path, i) => <path key={i} d={path} />)}
    {children}
  </svg>
)

const IHome     = () => <I d={['M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z','M9 22V12h6v10']} />
const IUsers    = () => <I d={['M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2','M23 21v-2a4 4 0 00-3-3.87','M16 3.13a4 4 0 010 7.75']}><circle cx="9" cy="7" r="4" /></I>
const IDollar   = () => <I d={['M12 1v22','M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6']} />
const ICard     = () => <I d={[]}><rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /></I>
const ILink     = () => <I d={['M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71','M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71']} />
const IGear     = () => <I d={['M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z']}><circle cx="12" cy="12" r="3" /></I>
const IShield   = () => <I d={['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']} />
const ILogout   = () => <I d={['M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4','M16 17l5-5-5-5','M21 12H9']} />
const IPlan     = () => <I d={['M12 2L2 7l10 5 10-5-10-5z','M2 17l10 5 10-5','M2 12l10 5 10-5']} />
const ITrend    = () => <I d={['M23 6l-9.5 9.5-5-5L1 18','M17 6h6v6']} />
const ICal      = () => <I d={['M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z']} />
const IClock    = () => <I d={['M12 6v6l4 2']}><circle cx="12" cy="12" r="10" /></I>
const IAlert    = () => <I d={['M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z','M12 9v4M12 17h.01']} />
const IFlow     = () => <I d={['M18 20V10M12 20V4M6 20v-6']} />
const ICheck2   = () => <I d={['M9 11l3 3L22 4','M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11']} />
const IChevron  = ({ up, ...p }) => <I d={[up ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6']} size={13} {...p} />
const ISearch   = () => <I d={['M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0']} size={14} />
const IPanel    = () => <I d={['M3 3h18v18H3zM15 3v18']} size={14} />
const IMore     = () => <I d={['M12 5h.01M12 12h.01M12 19h.01']} size={14} />
const INotif    = () => <I d={['M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9','M13.73 21a2 2 0 01-3.46 0']} size={18} />
const IHelp     = () => <I d={['M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3','M12 17h.01']} size={18}><circle cx="12" cy="12" r="10" /></I>
const IPlus     = () => <I d={['M12 5v14M5 12h14']} size={16} />
const IRefresh  = ({ spin, ...p }) => <I d={['M23 4v6h-6','M1 20v-6h6','M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15']} size={13} style={spin ? { animation: 'spin 0.8s linear infinite' } : undefined} {...p} />
const IReceipt  = () => <I d={['M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z','M8 7h8M8 11h8M8 15h5']} />
const IBox      = () => <I d={['M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z','M3.27 6.96L12 12.01l8.73-5.05','M12 22.08V12']} />
const IStar     = () => <I d={['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z']} />

// ── Nav structure ────────────────────────────────────────────────────────────
// Flat navbar: the data categories (+ Labor) are primary; system items are secondary.
const NAV_PRIMARY = [
  { key: 'Dashboard', label: 'Dashboard', Icon: IHome },
  { key: 'Sales',     label: 'Sales',     Icon: IDollar },
  { key: 'Expenses',  label: 'Expenses',  Icon: IReceipt },
  { key: 'Inventory', label: 'Inventory', Icon: IBox },
  { key: 'Reviews',   label: 'Reviews',   Icon: IStar },
  { key: 'Labor',     label: 'Labor',     Icon: IUsers },
]
const NAV_SECONDARY = [
  { key: 'Assistant', label: 'AI',       Icon: IHelp },
  { key: 'Accounts',  label: 'Accounts', Icon: ILink },
  { key: 'Settings',  label: 'Settings', Icon: IGear },
]

const TAB_DESC = {
  'Dashboard': 'Business overview & key metrics',
  'Sales':     'Revenue, orders & product mix',
  'Expenses':  'Spend by category, vendors & monthly trend',
  'Inventory': 'Stock valuation, margins & low-stock alerts',
  'Reviews':   'Ratings, sentiment & product feedback',
  'Labor':     'Labor costs, hours & scheduling',
  'Accounts':  'Connected integrations & API credentials',
  'Settings':  'Preferences & configuration',
  'Admin':     'User management & system administration',
}

const PLAN_LABELS = { free: 'Free Plan', plus: 'Plus', pro: 'Pro', enterprise: 'Enterprise' }

const RANGE_OPTS = {
  'Sales':    [{v:'7',l:'7D'},{v:'30',l:'30D'},{v:'90',l:'90D'},{v:'365',l:'1Y'},{v:'0',l:'All'}],
  'Expenses': [{v:'30',l:'30D'},{v:'90',l:'90D'},{v:'365',l:'1Y'},{v:'0',l:'All'}],
  'Reviews':  [{v:'30',l:'30D'},{v:'90',l:'90D'},{v:'365',l:'1Y'},{v:'0',l:'All'}],
  'Labor':    [{v:'7',l:'7D'},{v:'30',l:'30D'},{v:'90',l:'90D'},{v:'365',l:'1Y'},{v:'ytd',l:'YTD'},{v:'history',l:'YoY'}],
}

const TAB_MAP = {
  'Dashboard': Overview,
  'Sales':     Sales,
  'Expenses':  Expenses,
  'Inventory': Inventory,
  'Reviews':   Reviews,
  'Labor':     Labor,
  'Finances':  Finances,
  'Accounts':  Accounts,
  'Settings':  Settings,
  'Admin':     Admin,
  'Assistant': Assistant,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoStr) {
  if (!isoStr) return null
  const diffMs = Date.now() - new Date(isoStr).getTime()
  const diffM  = Math.round(diffMs / 60000)
  if (diffM < 1)  return 'just now'
  if (diffM < 60) return `${diffM}m ago`
  const diffH = Math.round(diffMs / 3600000)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.round(diffMs / 86400000)
  if (diffD < 30) return `${diffD}d ago`
  return null
}

function shortTimeAgo(isoStr) {
  if (!isoStr) return null
  const ms = Date.now() - new Date(isoStr).getTime()
  const m  = Math.round(ms / 60000)
  if (m < 1)  return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(ms / 3600000)
  if (h < 24) return `${h}h`
  return `${Math.round(ms / 86400000)}d`
}

function syncColor(isoStr) {
  if (!isoStr) return 'var(--err)'
  const h = (Date.now() - new Date(isoStr).getTime()) / 3600000
  return h < 4 ? 'var(--ok)' : h < 24 ? 'var(--warn)' : 'var(--err)'
}

// ── Skeleton shimmer shown during tab transitions ────────────────────────────
function SkeletonPage() {
  return (
    <div className="skeleton-page">
      <div className="skeleton-cards">
        {[1, 2, 3, 4].map(i => <div key={i} className="skeleton-card shimmer" />)}
      </div>
      <div className="skeleton-chart shimmer" />
      <div className="skeleton-table">
        <div className="skeleton-header shimmer" />
        {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton-row shimmer" />)}
      </div>
    </div>
  )
}

// ── YouTube-style progress bar ───────────────────────────────────────────────
function NavProgress({ tick }) {
  return tick > 0 ? (
    <div key={tick} style={{
      position: 'fixed', top: 0, left: 0, right: 0, height: 3,
      zIndex: 99999,
      background: 'linear-gradient(90deg, var(--acc) 0%, var(--acc-hi) 70%, #ffb380 100%)',
      transformOrigin: 'left',
      animation: 'nav-progress 800ms ease-out forwards',
      pointerEvents: 'none',
    }} />
  ) : null
}

// ── Component ────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const nav = useNavigate()

  const [active,      setActive]      = useState('Dashboard')
  const [llmConnected, setLlmConnected] = useState(false)   // local-LLM (Ollama) reachable?
  const [acctOpen,    setAcctOpen]    = useState(false)
  const [menuPos,     setMenuPos]     = useState({})
  const [plansOpen,   setPlansOpen]   = useState(false)
  const [profilePic,  setProfilePic]  = useState(() => localStorage.getItem('profile_pic') || '')
  const [navTick2,    setNavTick2]    = useState(0)
  const [sideOpen,    setSideOpen]    = useState(true)
  const [navSearch,   setNavSearch]   = useState('')
  const [collapsed,   setCollapsed]   = useState({})
  const [lastSynced,  setLastSynced]  = useState({})
  const [navOpen,     setNavOpen]     = useState(false)   // sidebar hover state
  const [tabLoading,  setTabLoading]  = useState(false)
  const [syncing,     setSyncing]     = useState({})
  const [tabRange,    setTabRange]    = useState({ 'Sales': '0', 'Labor': '30', 'Expenses': '0', 'Reviews': '0' })
  const [workspaces,  setWorkspaces]  = useState([])
  const [addWsOpen,   setAddWsOpen]   = useState(false)
  const [tourOpen,    setTourOpen]    = useState(false)
  const [appSwOpen,   setAppSwOpen]   = useState(false)   // app-switcher popover

  const brandRef     = useRef(null)
  const acctRef      = useRef(null)
  const navHistory   = useRef(['Dashboard'])
  const navIdx       = useRef(0)
  const tabLoadTimer = useRef(null)
  const [navTick, setNavTick] = useState(0)

  const firstName = localStorage.getItem('first_name') || ''
  const lastName  = localStorage.getItem('last_name')  || ''
  const email     = localStorage.getItem('email')      || ''
  const fullName  = [firstName, lastName].filter(Boolean).join(' ') || email
  const [plan, setPlan] = useState(() => localStorage.getItem('plan') || 'free')
  const uid      = Number(localStorage.getItem('user_id'))
  const raw      = localStorage.getItem('is_admin')
  const isAdmin  = raw === '1' || raw === 'true'   // accept both formats
  const planLabel = PLAN_LABELS[plan] || 'Free Plan'
  const initials  = (firstName?.[0] || email?.[0] || '?').toUpperCase() +
                    (lastName?.[0] || '').toUpperCase()

  function handlePlanChange(newPlan) {
    localStorage.setItem('plan', newPlan)
    setPlan(newPlan)
  }

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-has-sidebar', 'true')
    return () => document.documentElement.removeAttribute('data-has-sidebar')
  }, [])

  // First-visit walkthrough (auto-start once; replayable from the "?" button).
  useEffect(() => {
    let done = false
    try { done = localStorage.getItem('summit_tour_done') === '1' } catch {}
    if (!done) { const t = setTimeout(() => setTourOpen(true), 900); return () => clearTimeout(t) }
  }, [])

  useEffect(() => {
    const handler = (e) => navigate(e.detail.tab)
    window.addEventListener('jetcore:navigate', handler)
    return () => window.removeEventListener('jetcore:navigate', handler)
  }, [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('jetcore:page-change', { detail: { tab: active } }))
  }, [active])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('jetcore:nav-state', {
      detail: {
        canGoBack:    navIdx.current > 0,
        canGoForward: navIdx.current < navHistory.current.length - 1,
      },
    }))
  }, [navTick])

  useEffect(() => {
    const back = () => goBack()
    const fwd  = () => goForward()
    window.addEventListener('jetcore:go-back',    back)
    window.addEventListener('jetcore:go-forward', fwd)
    return () => {
      window.removeEventListener('jetcore:go-back',    back)
      window.removeEventListener('jetcore:go-forward', fwd)
    }
  }, [])

  useEffect(() => {
    if (!acctOpen) return
    const handler = (e) => {
      if (acctRef.current && !acctRef.current.contains(e.target) &&
          !e.target.closest('.sb-acct-menu')) {
        setAcctOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [acctOpen])

  useEffect(() => {
    const handler = () => setProfilePic(localStorage.getItem('profile_pic') || '')
    window.addEventListener('jetcore:profile-updated', handler)
    return () => window.removeEventListener('jetcore:profile-updated', handler)
  }, [])

  // App-switcher popover: close on Esc / outside click
  useEffect(() => {
    if (!appSwOpen) return
    const onClick = (e) => {
      if (brandRef.current && !brandRef.current.contains(e.target) &&
          !e.target.closest('.app-switcher')) {
        setAppSwOpen(false)
      }
    }
    const onKey = (e) => { if (e.key === 'Escape') setAppSwOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [appSwOpen])

  useEffect(() => {
    if (!uid) return
    Promise.all([
      api.get(`/api/credentials/${uid}`).catch(() => ({ data: [] })),
      api.get(`/api/accounts/${uid}`).catch(() => ({ data: [] })),
    ]).then(([c, a]) => {
      const creds = c.data || []
      const accts = a.data || []
      setLastSynced({
        'Labor':           creds.find(cr => cr.service === 'homebase')?.last_synced || null,
        'Sales & Tenders': creds.find(cr => cr.service === 'oracle')?.last_synced   || null,
        'Finances':        accts.find(ac => ac.service === 'plaid')?.last_synced     || null,
      })
    })
  }, [uid, active])

  // Load the user's workspaces (locations / expense accounts) for the rail
  useEffect(() => {
    if (!uid) return
    api.get(`/api/workspaces/${uid}`)
      .then(r => setWorkspaces(r.data || []))
      .catch(() => setWorkspaces([]))
  }, [uid])

  const activeWs = useMemo(
    () => workspaces.find(w => w.is_active) || workspaces[0] || null,
    [workspaces]
  )

  const selectWorkspace = useCallback(async (wsId) => {
    if (!uid) return
    setWorkspaces(ws => ws.map(w => ({ ...w, is_active: w.id === wsId })))
    try {
      const r = await api.post(`/api/workspaces/${uid}/${wsId}/select`)
      const picked = r.data
      if (picked?.plan) {
        localStorage.setItem('plan', picked.plan)
        setPlan(picked.plan)
      }
      if (picked?.segment) localStorage.setItem('segment', picked.segment)
    } catch (_) {}
  }, [uid])

  const handleWsCreated = useCallback((ws) => {
    setWorkspaces(prev => [...prev.map(w => ({ ...w, is_active: false })), ws])
    if (ws.plan) { localStorage.setItem('plan', ws.plan); setPlan(ws.plan) }
    if (ws.segment) localStorage.setItem('segment', ws.segment)
    setAddWsOpen(false)
  }, [])

  // ── Nav logic ──────────────────────────────────────────────────────────────
  const logout = useCallback(() => { localStorage.clear(); nav('/login') }, [nav])

  const navigate = useCallback((tab, instant = false) => {
    if (navHistory.current[navIdx.current] === tab) return
    navHistory.current = navHistory.current.slice(0, navIdx.current + 1)
    navHistory.current.push(tab)
    navIdx.current = navHistory.current.length - 1
    setActive(tab)
    setNavTick(t => t + 1)
    setNavTick2(t => t + 1)
    // Trigger shimmer skeleton + progress bar — skipped for the guided tour
    // (instant) so it can move between pages without the 380ms load stall.
    clearTimeout(tabLoadTimer.current)
    if (instant) { setTabLoading(false); return }
    setTabLoading(true)
    tabLoadTimer.current = setTimeout(() => setTabLoading(false), 380)
  }, [])

  const goBack = useCallback(() => {
    if (navIdx.current > 0) {
      navIdx.current--
      setActive(navHistory.current[navIdx.current])
      setNavTick(t => t + 1)
      setNavTick2(t => t + 1)
      clearTimeout(tabLoadTimer.current)
      setTabLoading(true)
      tabLoadTimer.current = setTimeout(() => setTabLoading(false), 380)
    }
  }, [])

  const goForward = useCallback(() => {
    if (navIdx.current < navHistory.current.length - 1) {
      navIdx.current++
      setActive(navHistory.current[navIdx.current])
      setNavTick(t => t + 1)
      setNavTick2(t => t + 1)
      clearTimeout(tabLoadTimer.current)
      setTabLoading(true)
      tabLoadTimer.current = setTimeout(() => setTabLoading(false), 380)
    }
  }, [])

  const handleUpgrade = useCallback(() => setPlansOpen(true), [])

  const toggleAcct = useCallback(() => {
    if (!acctOpen && acctRef.current) {
      const r = acctRef.current.getBoundingClientRect()
      setMenuPos({ bottom: window.innerHeight - r.top + 8, left: r.left, minWidth: Math.max(r.width, 210) })
    }
    setAcctOpen(o => !o)
  }, [acctOpen])

  const toggleGroup = useCallback((label) => {
    setCollapsed(c => ({ ...c, [label]: !c[label] }))
  }, [])

  const handleIntgSync = useCallback(async (service) => {
    if (!uid) return
    setSyncing(s => ({ ...s, [service]: true }))
    try {
      await api.post(`/api/sync/${service}/${uid}`)
      const [c, a] = await Promise.all([
        api.get(`/api/credentials/${uid}`).catch(() => ({ data: [] })),
        api.get(`/api/accounts/${uid}`).catch(() => ({ data: [] })),
      ])
      const creds = c.data || []
      const accts = a.data || []
      setLastSynced({
        'Labor':           creds.find(cr => cr.service === 'homebase')?.last_synced || null,
        'Sales & Tenders': creds.find(cr => cr.service === 'oracle')?.last_synced   || null,
        'Finances':        accts.find(ac => ac.service === 'plaid')?.last_synced     || null,
      })
    } catch (_) {}
    setSyncing(s => ({ ...s, [service]: false }))
  }, [uid])

  // ── Derived ────────────────────────────────────────────────────────────────
  // Poll the local-LLM connection so the AI tab only appears when Ollama is reachable.
  useEffect(() => {
    let alive = true
    const check = () => api.get('/api/llm/status')
      .then(r => { if (alive) setLlmConnected(!!r.data.connected) })
      .catch(() => { if (alive) setLlmConnected(false) })
    check()
    const t = setInterval(check, 15000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  // Secondary nav items — Assistant only when the local LLM is connected; Admin for admins.
  const navSecondary = useMemo(() => {
    let items = NAV_SECONDARY.filter(it => it.key !== 'Assistant' || llmConnected)
    if (isAdmin) items = [...items, { key: 'Admin', label: 'Admin', Icon: IShield }]
    return items
  }, [isAdmin, llmConnected])

  const ActiveTab = TAB_MAP[active] || Overview

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell app-shell-nav">
      <NavProgress tick={navTick2} />

      {/* ── Rail ────────────────────────────────────────────────────────── */}
      <aside className="rail">
        {/* Static JetCore brand mark. App switching lives in the host shell's
            lightning dropdown now — the embedded app has no switcher of its own. */}
        <div
          className="rail-brand"
          title="JetCore Summit"
          style={{
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(135deg, #ff6161 0%, #ff3b3b 100%)',
            boxShadow: '0 0 16px rgba(255,59,59,.45)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <polygon points="13,3 7.5,13 12,13 10.5,21 17,10.5 12.5,10.5 14.5,3" />
          </svg>
        </div>

        {workspaces.length > 0 && <div className="rail-divider" />}

        {workspaces.map(ws => {
          const tile = (ws.name || '?').trim().slice(0, 2).toUpperCase()
          return (
            <button
              key={ws.id}
              className={`loc${ws.is_active ? ' active' : ''}`}
              title={`${ws.name} · ${ws.kind === 'expense_account' ? 'Expense account' : 'Location'} · ${PLAN_LABELS[ws.plan] || ws.plan}`}
              onClick={() => selectWorkspace(ws.id)}
            >
              {tile}
            </button>
          )
        })}

        <button
          className="loc-add"
          title="Add location or expense account"
          style={{ border: 'none' }}
          onClick={() => setAddWsOpen(true)}
        >
          <IPlus />
        </button>

        <div style={{ flex: 1 }} />

        <div className="rail-bottom">
          <button className="rail-icon-btn" title="Notifications"><INotif /></button>
          <button className="rail-icon-btn" title="Help"><IHelp /></button>
        </div>
      </aside>

      {/* ── Shell body: top navbar + main ───────────────────────────────── */}
      <div className="shell-body">
        <nav className="topbar">
          <div className="topbar-brand">
            <span className="loc-name">{activeWs?.name || 'JetCore'}</span>
          </div>
          <div className="topbar-items" data-tour="nav">
            {NAV_PRIMARY.map(item => (
              <button
                key={item.key}
                className={`topbar-item${active === item.key ? ' active' : ''}`}
                onClick={() => navigate(item.key)}
              >
                <item.Icon />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="topbar-right">
            {navSecondary.map(item => (
              <button
                key={item.key}
                className={`topbar-item sec${active === item.key ? ' active' : ''}`}
                onClick={() => navigate(item.key)}
                title={item.label}
              >
                <item.Icon />
                <span className="sec-lbl">{item.label}</span>
              </button>
            ))}
            <button className="topbar-item sec" onClick={() => setTourOpen(true)} title="Take a tour">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
            </button>
            <div ref={acctRef} className="topbar-acct" onClick={toggleAcct} title={fullName || email}>
              <div className="avatar">
                {profilePic
                  ? <img src={profilePic} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                  : initials}
                <span className="presence" />
              </div>
            </div>
          </div>
        </nav>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="main">
        <header className="ch-header">
          <div className="ch-title">
            <span className="name">{active}</span>
            {TAB_DESC[active] && <span className="desc">{TAB_DESC[active]}</span>}
          </div>
          {RANGE_OPTS[active] && (
            <div className="ch-range" style={{ margin: '0 auto 0 20px' }}>
              {RANGE_OPTS[active].map(o => (
                <button
                  key={o.v}
                  className={tabRange[active] === o.v ? 'on' : ''}
                  onClick={() => setTabRange(r => ({ ...r, [active]: o.v }))}
                >{o.l}</button>
              ))}
            </div>
          )}
        </header>

        <div className="ch-body" data-tour="tabbody">
          {tabLoading ? (
            <SkeletonPage />
          ) : (
            <div key={active} className="tab-enter">
              <ActiveTab uid={uid} plan={plan} onNavigate={navigate} onUpgrade={handleUpgrade}
                range={tabRange[active]} />
            </div>
          )}
        </div>
      </main>

      </div>

      {/* ── Account dropdown ────────────────────────────────────────────── */}
      {acctOpen && (
        <div className="sb-acct-menu" style={{ position: 'fixed', bottom: menuPos.bottom, left: menuPos.left, minWidth: menuPos.minWidth }}>
          <div className="sb-acct-menu-header">
            <div className="sb-acct-menu-uname">{fullName || email}</div>
          </div>
          <button className="sb-acct-menu-item sb-acct-menu-danger" onClick={logout}>
            <ILogout /> Log Out
          </button>
        </div>
      )}

      {/* ── Add workspace (location / expense account) modal ────────────── */}
      {addWsOpen && (
        <AddWorkspaceModal
          uid={uid}
          defaultSegment={localStorage.getItem('segment') || 'restaurant'}
          onClose={() => setAddWsOpen(false)}
          onCreated={handleWsCreated}
        />
      )}

      {tourOpen && (
        <Tour steps={TOUR_STEPS} active={active} onNavigate={navigate}
          onClose={() => setTourOpen(false)} />
      )}

    </div>
  )
}
