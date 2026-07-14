import { app, ipcMain, shell, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import { UPDATER_IPC } from '../shared/updater'
import type { ConfirmDownloadResult } from '../shared/updater'

/**
 * App self-update, built on electron-updater against the GitHub Releases feed
 * (provider derived from package.json "repository"; see electron-builder.yml).
 *
 * Interaction model is "notify on discovery": autoDownload is off, so a check only
 * surfaces `update-available`; the renderer asks the user, and only on confirmation
 * do we download (Windows/Linux) — then `update-downloaded` offers a restart.
 *
 * macOS is unsigned right now, so Squirrel.Mac would reject an auto-installed update
 * at the code-signature check. We never call downloadUpdate() on macOS; instead the
 * "available" notification links out to the release page for a manual download. The
 * feed read in checkForUpdates() does not verify signatures, so detection still works.
 */

const RELEASE_PAGE = 'https://github.com/GetOptaris/optaris-desktop/releases/latest'

// Delay the first automatic check so it doesn't compete with window/gateway startup.
const INITIAL_CHECK_DELAY_MS = 5000

let getWindow: () => BrowserWindow | null = () => null

function isMac(): boolean {
  return process.platform === 'darwin'
}

/** Push an event to the renderer, skipping when the window is gone/destroyed. */
function send(channel: string, payload?: unknown): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/** Run a check without leaking a rejected promise (dev/offline reject; `error` fires too). */
async function safeCheck(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    console.error('[updater] check failed:', err)
  }
}

/**
 * Confirm the user wants the available update. Windows/Linux start the download;
 * macOS opens the release page (auto-install is unavailable while unsigned).
 */
async function confirmDownload(): Promise<ConfirmDownloadResult> {
  if (isMac()) {
    await shell.openExternal(RELEASE_PAGE)
    return { redirected: true }
  }
  await autoUpdater.downloadUpdate()
  return { redirected: false }
}

/**
 * Wire the updater into the app. `getWindowRef` is a closure so we always resolve
 * the *current* window when pushing events (the reference can change across
 * activate/re-create on macOS).
 */
export function initUpdater(getWindowRef: () => BrowserWindow | null): void {
  getWindow = getWindowRef

  autoUpdater.autoDownload = false
  // We drive the restart ourselves from the "downloaded" prompt.
  autoUpdater.autoInstallOnAppQuit = false
  // In dev there is no packaged feed; read dev-app-update.yml so checks can be tried.
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log(`[updater] update available: ${info.version}`)
    send(UPDATER_IPC.updateAvailable, { version: info.version, mac: isMac() })
  })
  autoUpdater.on('update-not-available', () => {
    send(UPDATER_IPC.updateNotAvailable)
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    send(UPDATER_IPC.downloadProgress, { percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log(`[updater] update downloaded: ${info.version}`)
    send(UPDATER_IPC.updateDownloaded, { version: info.version })
  })
  autoUpdater.on('error', (err: Error) => {
    console.error('[updater] error:', err)
    send(UPDATER_IPC.error, { message: String(err?.message ?? err) })
  })

  setTimeout(() => void safeCheck(), INITIAL_CHECK_DELAY_MS)
}

/** Register the renderer -> main updater IPC handlers (mirrors registerGatewayIpc). */
export function registerUpdaterIpc(): void {
  ipcMain.handle(UPDATER_IPC.getVersion, (): string => app.getVersion())
  ipcMain.handle(UPDATER_IPC.check, (): Promise<void> => safeCheck())
  ipcMain.handle(UPDATER_IPC.confirmDownload, (): Promise<ConfirmDownloadResult> =>
    confirmDownload()
  )
  ipcMain.handle(UPDATER_IPC.quitAndInstall, (): void => {
    // Windows/Linux only — the renderer never surfaces "restart" on macOS.
    autoUpdater.quitAndInstall()
  })
  ipcMain.handle(UPDATER_IPC.openReleasePage, (): Promise<void> => shell.openExternal(RELEASE_PAGE))
}
