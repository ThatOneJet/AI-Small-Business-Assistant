/* Global `Window` augmentation for the renderer AND the preload.
 *
 * This lives in `src/shared/` — included by BOTH tsconfig.node.json (preload, which
 * does `window.decks = api`) and tsconfig.web.json (renderer, which reads it) — and,
 * crucially, it is NOT an emit target. The old home, `src/preload/index.d.ts`, shared
 * its path with the declaration `tsc --build` emits for `index.ts`, so a stray
 * composite build would clobber the hand-written types down to `export {}` and break
 * every `window.decks` reference. A `.d.ts` with no sibling `.ts` can't be clobbered. */
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { DecksApi } from './ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    decks: DecksApi
  }
}

export {}
