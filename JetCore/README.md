# JetCore — design brief

**JetCore is one desktop platform that hosts a collection of focused apps — one account, one database, one design language.** Each app is a distinct product for a distinct person, but they must all look and feel like the same product.

> ## ⚠️ Read this first — design from a blank canvas
> **Do NOT reproduce, reference, or anchor on JetCore's current/existing UI in any way.** Assume there is no existing design. Reinvent **everything** from scratch: the navigation model, the layout, the visual language, the color system, the components, the motion. The goal is a **completely different, dramatically better** design than anything JetCore has today — not a refinement of it.
>
> This document deliberately describes **what the product does** and **how it should feel**, and deliberately does **not** prescribe a layout, a color palette, or a component style. Those are yours to invent. Optimize for the best possible **user experience and functionality**, not for matching anything that exists.

---

## Where to look in the code (important)

Study the **backend only** — to learn each app's real functionality, data model, fields, and actions. **Completely ignore the frontend / existing UI** (all of it). The backend tells you *what* to design for; the UI you design should owe nothing to the current one.

**✅ Read these (functionality & data):**
- `Operations/backend.py` — Summit's API: every route, metric, sync, and what each screen's data looks like.
- `Operations/models.py` — Summit's data model (users, locations, sales, labor, shifts, tenders, transactions, finances, integrations…).
- `Operations/integrations/` (`homebase.py`, `oracle.py`, `toast.py`) + `Operations/plaid_client.py` — what Summit ingests.
- `Decks/src/main/pylon.ts` — Pylon's Canvas logic: what's fetched (courses, grades, due dates) and the shape of the data.
- `Decks/src/main/devbay.ts` — DevBay's GitHub logic: repos, fields, the draft-release action.
- `Decks/src/main/vault.ts`, `Decks/src/main/opssync.ts`, `Decks/src/main/accounts.ts` — account model, encryption, cross-device sync, per-account data (context only).

**🚫 Ignore entirely (this is the UI to replace — do not look to it for design):**
- `Decks/src/renderer/**` — the entire current desktop UI (components, the `index.css` design system, layouts).
- `Operations/frontend/**` — Summit's current web UI.
- Any `.css`, any React/JSX components, any styling, anywhere.

In short: **mine the backend for *what the apps do*; invent the *how it looks* from scratch.**

---

## The feel we're going for

- **Modern.** Current, fresh, confident — the kind of UI that feels a generation ahead, not a dashboard template.
- **Rounded & soft.** Generous corner radii, soft edges, gentle surfaces. Nothing sharp or boxy.
- **Comfortable.** Roomy spacing, clear hierarchy, breathing room. Calm, never cramped or busy. The user should feel at ease.
- **Professional.** Polished and trustworthy — people run a business / their schoolwork / their projects on this. Refined, not toy-like.
- **Typography:** **Google Sans** (or a close modern humanist/geometric sans — e.g. Product Sans, Inter, Geist). Type should feel clean and contemporary.
- **Optimized to the maximum.** Surface the most important thing first, cut clicks and friction, use smart defaults, make the next action obvious. Every screen should make its data legible *at a glance* and let the user act fast.

You choose the color direction, light vs. dark (or both), the navigation pattern, and the overall composition. Pick whatever genuinely serves these apps best. Be ambitious.

---

## What JetCore is (the product)

Most people's important data is scattered and buried across tools that bury it. JetCore makes that data **legible at a glance** and lets you act on it — for whoever you are: a builder, a business owner, or a student. One account unlocks the whole platform; everything is **end-to-end encrypted**.

A person signs up once, tells JetCore what they're there for, and lands in a hub from which they move between apps. The whole collection should feel like **one cohesive product** — moving between apps should never feel like switching tools.

---

## The apps (what each must let people do)

These describe the **functionality and content** each app needs to present. Design the screens, navigation, and components however best serves them.

### Hangar — the hub *(for everyone)*
The home base after login. A warm, at-a-glance **overview of all the user's apps** with live status, and a fast way to jump into any one. It should reflect what the user said they'd use JetCore for and gently guide first-time setup ("connect GitHub," "add your Canvas token," etc.). This is the front door — make it feel welcoming and give an immediate sense of "here's everything, here's what needs attention."

### DevBay — *for developers*
Connects **GitHub**. Needs to make a developer's scattered repositories **legible**: a portfolio view of every repo with language, stars, open issues, and **staleness** (time since last activity) — so you instantly see what's active, what's neglected, and what needs attention. Plus **shipping automation**: draft a release/tag in a couple of steps. Also a **summonable quick-action overlay** (global hotkey) that floats over other apps to jump to a repo / ship fast without leaving what you're doing. Users pick a current **repo** as context.

### Summit — *for business owners, freelancers, restaurants*
The operations dashboard. Pulls **sales, labor, supplies, utilities, and banking** data from tools like Homebase, Oracle POS, Square, and Plaid, and makes it legible with **rich charts, metric tiles, and tables** — and flags **what's trending wrong** (rising labor %, falling margin, large outflows, overtime). Areas it covers: an overview of profit/margin, sales & tender breakdowns, labor cost & scheduling, finances & cash flow & reconciliation, plus account/integration management. Users run **multiple locations / business accounts** and switch between them. *(The underlying data and charts already exist and must be preserved — this is about giving them a far better, modern home.)*

### Pylon — *for students*
Connects **Canvas**. Decodes what Canvas buries: current **grade and weighting per class**, and **what's due** sorted by urgency (a clear, calm "here's where you stand and what's next"). Should answer "how am I doing?" and "what do I do next?" instantly. Optional "what do I need on the final" style calculators. Users switch between **courses** as context.

---

## Cross-cutting product needs (design these into the system)

- **Moving between apps.** A person needs a fast, obvious way to switch between the four apps from anywhere — invent the pattern (rail, launcher, command bar, whatever's best). Each app should clearly own its identity while staying part of the family.
- **Per-app context switching.** Each app has a "current thing" the user switches among and can add to: **DevBay → repos, Summit → locations/accounts, Pylon → courses.** Design a clean way to switch and add these.
- **Per-app navigation.** Apps (except Hangar) have multiple areas/sections to move between. Design the in-app navigation.
- **Global search / command** — find anything and run actions quickly across the app.
- **Account presence** — the signed-in user, with a way to sign out.
- **Entry experience** — a marketing **homepage** for logged-out visitors, simple **pricing**, **sign in / sign up**, and a friendly **"what will you use JetCore for?"** step at signup that personalizes the hub.
- **States** — design empty states (not connected yet), loading, and error states; they should feel intentional and encouraging, not bare.
- **Motion** — purposeful, smooth micro-interactions and entrance animations that make the product feel alive and premium (never gratuitous, never looping behind content).

---

## What I want back

A **complete, original design system + layouts** for the JetCore collection:
- a fresh visual language (color system, type scale on Google Sans, spacing/radii, elevation, iconography) — modern, rounded, comfortable, professional;
- the **universal shell** every app shares (how you switch apps, the in-app nav + context switching, the top-level chrome, search);
- key **screens for each app** (Hangar overview, DevBay portfolio + ship flow + overlay, Summit dashboards + charts, Pylon grades + what's-due), plus the entry flow (homepage, pricing, sign up + intent);
- the reusable **components** (cards, metric tiles, charts, nav, context switcher, buttons, inputs, dropdowns, empty/loading/error states) and **motion** language.

Make it **bold and genuinely new**. The current product is the *functionality* baseline, not the design baseline — exceed it completely.

---

## Platform notes (constraints, not design direction)
- **Desktop app** (Electron) — generous screen real estate; also a small always-on-top overlay window for DevBay's quick panel.
- **One account / one database** (end-to-end encrypted). Each app reads/writes its own data; integration tokens stay encrypted on-device.
- **Real integrations only:** GitHub (DevBay), Canvas (Pylon), Homebase / Oracle / Square / Plaid (Summit).
