# App integration glue (Electron main process)

Each JetCore app's **backend now lives in its own top-level folder** (siblings of
`frontend/`): `Pylon/`, `DevBay/`, `Summit/`. This `frontend/src/main/apps/`
folder only holds the thin Electron-side glue that the app backends can't live
without (window/WebContentsView hosting).

```
JetCore/
  frontend/            the app: unified UI (renderer) + shell + Hangar
    src/main/
      apps/summit/     Summit glue: jetcore.ts spawns + embeds the Python backend,
                       opssync.ts = its cross-device sync
      vault.ts, supabase.ts, accounts.ts, …   (shared, imported as @main/*)
  Pylon/    pylon.ts            Canvas backend (imported by main as @pylon/pylon)
  DevBay/   devbay.ts           GitHub backend (@devbay/devbay)
            devbay-overlay.ts   the always-on-top quick overlay (@devbay/devbay-overlay)
  Summit/   backend.py, models.py, integrations/, plaid_client.py   (Python/Flask)
```

- **How the out-of-folder backends are wired:** `electron.vite.config.ts` (main)
  + `tsconfig.node.json` define aliases `@pylon` → `../Pylon`, `@devbay` →
  `../DevBay`, `@main` → `src/main`. The Pylon/DevBay modules import shared code as
  `@main/vault` / `@shared/ipc`; `index.ts` imports them as `@pylon/pylon` etc.
  electron-vite bundles them into the main process at build time.
- **Hangar has no backend** — it just reads the vault + reflects the other apps.
- **Summit** is the only truly separate process (Python); `apps/summit/` only
  launches + embeds it.
