/**
 * Shared chrome for native JetCore app pages (Hangar / DevBay / Pylon).
 *
 * Gives every native app the identical "JetCore look" header (mark + name +
 * audience) and a scrolling body, so all apps feel like the same product. The
 * card/metric styling lives in index.css (.jc-* classes, ported from the
 * Operations/Summit design system, on the unified red accent).
 */
import type { JSX, ReactNode } from 'react'
import type { JetCoreApp } from './registry'

export function AppPage({
  app,
  nav,
  actions,
  children
}: {
  app: JetCoreApp
  /** The app's own categorized sidebar (AppNav) — column 2, Summit-style. */
  nav?: ReactNode
  actions?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <div className="jc-shell">
      {nav}
      <div className="jc-app">
        <header className="jc-page-head">
          <span className="jc-page-mark">
            <app.Icon size={20} />
          </span>
          <div className="jc-page-titles">
            <h1 className="jc-page-name">{app.name}</h1>
            <span className="jc-page-aud">{app.audience}</span>
          </div>
          {actions && <div className="jc-page-actions">{actions}</div>}
        </header>
        <div className="jc-page-body">{children}</div>
      </div>
    </div>
  )
}

/** A placeholder card used by the Wave-1 app stubs. */
export function StubCard({
  title,
  body,
  cta,
  delay = 0
}: {
  title: string
  body: string
  cta?: string
  delay?: number
}): JSX.Element {
  return (
    <div className="jc-card jc-rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="jc-card-title">{title}</div>
      <div className="jc-card-body">{body}</div>
      {cta && <button className="jc-btn" type="button" disabled>{cta}</button>}
    </div>
  )
}
