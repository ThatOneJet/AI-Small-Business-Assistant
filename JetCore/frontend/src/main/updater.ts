/**
 * Auto-update wiring (electron-updater → GitHub releases).
 *
 * The release feed + installer live on the PRIVATE repo ThatOneJet/JetCore, so we
 * authenticate the updater with a read-only token (see update-token.ts). Flow:
 * on launch (packaged builds only) check the feed, download in the background,
 * and once ready prompt the user to restart-and-install (non-blocking — they can
 * keep working and it installs on next quit if they dismiss).
 *
 * No-ops gracefully when unpackaged (dev) or when no token is configured, so a
 * clean public checkout never tries (and fails) to hit a private feed.
 */
import { app, ipcMain, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import { IPC } from '@shared/ipc'
import type { UpdateStatusEvent } from '@shared/ipc'
import { UPDATE_TOKEN, UPDATE_OWNER, UPDATE_REPO } from './update-token'

const { autoUpdater } = electronUpdater

function token(): string {
  return (process.env.JETCORE_UPDATE_TOKEN || UPDATE_TOKEN || '').trim()
}

let started = false
/** The window the update UI lives in; events are pushed to its renderer. */
let uiWindow: BrowserWindow | null = null

/** Push an update-lifecycle event to the renderer's update popup. */
function emit(e: UpdateStatusEvent): void {
  const wc = uiWindow?.webContents
  if (wc && !wc.isDestroyed()) wc.send(IPC.UpdateStatus, e)
}

/** Renderer → main: install the downloaded update now. Registered once. */
ipcMain.on(IPC.UpdateRestart, () => {
  try {
    setImmediate(() => autoUpdater.quitAndInstall())
  } catch (err) {
    console.error('[updater] quitAndInstall failed:', err)
  }
})

/** Wire and kick off the update check. Safe to call once on app ready. */
export function initAutoUpdate(win: BrowserWindow | null): void {
  if (started) return
  started = true
  uiWindow = win

  // Only meaningful in a packaged build — dev has no installer to swap.
  if (!app.isPackaged) {
    console.log('[updater] skipped (not packaged)')
    return
  }
  if (!token()) {
    console.warn('[updater] no JETCORE_UPDATE_TOKEN baked in — auto-update disabled')
    return
  }

  // Private GitHub feed: provide owner/repo + token so the GitHubProvider can
  // authenticate both the metadata fetch and the asset download.
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: UPDATE_OWNER,
    repo: UPDATE_REPO,
    private: true,
    token: token()
  })

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err?.message || err)
    emit({ state: 'error', error: err?.message || String(err) })
  })
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info?.version)
    // The app is behind → tell the renderer to show the update popup. autoDownload
    // is on, so the download begins immediately and progress events follow.
    emit({ state: 'available', version: info?.version })
  })
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date')
    emit({ state: 'idle' })
  })
  autoUpdater.on('download-progress', (p) => {
    emit({ state: 'downloading', percent: Math.round(p?.percent ?? 0) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded:', info?.version)
    emit({ state: 'downloaded', version: info?.version })
  })

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] check failed:', err?.message || err)
  })
}
