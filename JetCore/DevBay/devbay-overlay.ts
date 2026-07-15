/**
 * DevBay Shift-style overlay — a transparent, always-on-top quick-actions window
 * summoned by a global hotkey (Ctrl/Cmd+Shift+Space), floating over whatever app
 * is focused (VS Code, browser, …). It is JetCore's OWN topmost window (you can't
 * safely draw inside another app's window). Quick repo jump + capture; the renderer
 * is the same bundle loaded with the `#devbay-overlay` hash.
 */
import { app, BrowserWindow, globalShortcut, screen, shell } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc'

const HOTKEY = 'CommandOrControl+Shift+Space'
let win: BrowserWindow | null = null

function ensure(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 600,
    height: 460,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Open repo links in the real browser, not inside the overlay.
  win.webContents.setWindowOpenHandler((d) => {
    shell.openExternal(d.url)
    return { action: 'deny' }
  })
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#devbay-overlay`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'devbay-overlay' })
  }
  // Dismiss when it loses focus (click away), like a spotlight panel.
  win.on('blur', () => win?.hide())
  return win
}

function centerOnCursor(w: BrowserWindow): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const b = w.getBounds()
  w.setBounds({
    x: Math.round(workArea.x + (workArea.width - b.width) / 2),
    y: Math.round(workArea.y + (workArea.height - b.height) / 2.4),
    width: b.width,
    height: b.height
  })
}

export function toggleDevBayOverlay(): void {
  const w = ensure()
  if (w.isVisible()) {
    w.hide()
    return
  }
  centerOnCursor(w)
  w.show()
  w.focus()
  w.webContents.send(IPC.DevBayOverlayShown)
}

export function hideDevBayOverlay(): void {
  if (win && !win.isDestroyed()) win.hide()
}

/** Register the global hotkey. Call once on app ready. */
export function registerDevBayOverlay(): void {
  try {
    globalShortcut.register(HOTKEY, toggleDevBayOverlay)
  } catch (err) {
    console.error('[devbay-overlay] hotkey register failed:', err)
  }
}

export function destroyDevBayOverlay(): void {
  try {
    globalShortcut.unregister(HOTKEY)
  } catch {
    /* ignore */
  }
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}
