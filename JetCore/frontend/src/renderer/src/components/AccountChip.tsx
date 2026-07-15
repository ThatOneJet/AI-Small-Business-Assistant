/**
 * AccountChip — the signed-in JetCore account in the dock footer.
 *
 * Shows a profile avatar (initial from the email — Supabase email accounts have
 * no uploaded picture, so we generate one) and, expanded, the account name +
 * email. Clicking opens a popover with the full account + a Sign out button that
 * calls the store's logout() (which signs out of Supabase + wipes the in-memory
 * vault key in main and returns to the login gate).
 *
 * The email is read from `window.decks.cloud.status()` — the renderer never sees
 * tokens or keys, only the account's display email.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PopIn from '../bits/PopIn'
import { useStore } from '../store'

/** Deterministic accent for the avatar, derived from the email. */
function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 70% 52%)`
}

export default function AccountChip({ rail }: { rail: boolean }): JSX.Element {
  const logout = useStore((s) => s.logout)
  const view = useStore((s) => s.view)
  const [email, setEmail] = useState('')
  const [admin, setAdmin] = useState(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLButtonElement>(null)

  // Pull the signed-in email from main (no tokens/keys cross this boundary).
  // Re-checked when we return to a signed-in surface (e.g. after sign-in).
  useEffect(() => {
    let alive = true
    void window.decks?.cloud
      ?.status()
      .then((s) => {
        if (!alive) return
        if (s?.email) setEmail(s.email)
        setAdmin(!!s?.isAdmin)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [view])

  // Close the popover on Escape / outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      if ((t as HTMLElement).closest?.('.acct-pop')) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initial = (email.trim()[0] || '?').toUpperCase()
  const name = email.includes('@') ? email.split('@')[0] : email || 'Account'
  const color = avatarColor(email || 'jetcore')

  const toggle = (): void => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ x: r.right + 10, y: r.bottom - 150 })
    setOpen((o) => !o)
  }

  const signOut = (): void => {
    setOpen(false)
    void logout()
  }

  const popover = createPortal(
    open ? (
      <PopIn className="acct-pop" style={{ left: pos.x, top: pos.y }} origin="bottom left">
        <div className="acct-pop-head">
          <span className="acct-avatar lg" style={{ background: color }}>
            {initial}
          </span>
          <span className="acct-pop-meta">
            <span className="acct-pop-name">
              {name}
              {admin && <span className="acct-admin-badge">Admin</span>}
            </span>
            <span className="acct-pop-email" title={email}>
              {email || 'Not signed in'}
            </span>
          </span>
        </div>
        <button className="acct-signout" type="button" onClick={signOut}>
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
          Sign out
        </button>
      </PopIn>
    ) : null,
    document.body
  )

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`acct-chip ${open ? 'on' : ''}`}
        onClick={toggle}
        title={email ? `${email} — account` : 'Account'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="acct-avatar" style={{ background: color }}>
          {initial}
        </span>
        {!rail && (
          <span className="acct-chip-meta">
            <span className="acct-chip-name">{name}</span>
            <span className="acct-chip-email">{email || 'Signed in'}</span>
          </span>
        )}
      </button>
      {popover}
    </>
  )
}
