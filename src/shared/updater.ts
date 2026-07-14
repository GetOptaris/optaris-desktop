/**
 * Wire contract for the app self-update feature (electron-updater).
 *
 * Modeled on shared/gateway.ts: this module is type-only except for UPDATER_IPC
 * (channel-name constants shared by preload and main so they can't drift).
 *
 * Unlike the gateway channels — which are all request/response (ipcRenderer.invoke
 * -> ipcMain.handle) — updating also needs main -> renderer *pushes* (the updater
 * emits events on its own timeline: a new version appears, download progresses,
 * the download finishes). Those are delivered with webContents.send and consumed
 * via the on* subscription methods on UpdaterApi, each returning an unsubscribe fn.
 *
 * macOS note: the app is currently unsigned, so electron-updater cannot download +
 * install an update on macOS (Squirrel.Mac rejects the unsigned bundle at the code
 * signature check). The main process detects this and, instead of downloading, opens
 * the GitHub release page. `UpdateAvailablePayload.mac` tells the renderer to render
 * the "go to download page" affordance rather than "download".
 */

/** Payload for the `updateAvailable` push: a newer version was found on the feed. */
export interface UpdateAvailablePayload {
  version: string
  /** True on macOS, where auto-download is unavailable (unsigned) — offer a manual link. */
  mac: boolean
}

/** Payload for the `downloadProgress` push while the update downloads (non-mac). */
export interface DownloadProgressPayload {
  /** 0–100. */
  percent: number
}

/** Payload for the `updateDownloaded` push: the update is staged and ready to install. */
export interface UpdateDownloadedPayload {
  version: string
}

/** Payload for the `error` push: a check/download failed (kept non-intrusive in the UI). */
export interface UpdaterErrorPayload {
  message: string
}

/** Result of confirmDownload: on macOS the request is redirected to the release page. */
export interface ConfirmDownloadResult {
  /** True when we opened the release page instead of downloading (macOS, unsigned). */
  redirected: boolean
}

/** The self-update surface exposed on `window.api.updater`. */
export interface UpdaterApi {
  /** The running app version (app.getVersion()). */
  getVersion: () => Promise<string>
  /** Trigger a manual update check. Results arrive via the on* push subscriptions. */
  checkForUpdates: () => Promise<void>
  /**
   * Confirm the user wants the available update. On Windows/Linux this starts the
   * download; on macOS it opens the release page instead (see module note).
   */
  confirmDownload: () => Promise<ConfirmDownloadResult>
  /** Quit and install a downloaded update (Windows/Linux only). */
  quitAndInstall: () => Promise<void>
  /** Open the GitHub releases page in the system browser. */
  openReleasePage: () => Promise<void>
  /** Subscribe to "a newer version is available". Returns an unsubscribe fn. */
  onUpdateAvailable: (cb: (payload: UpdateAvailablePayload) => void) => () => void
  /** Subscribe to "already up to date" (mainly to answer a manual check). */
  onUpdateNotAvailable: (cb: () => void) => () => void
  /** Subscribe to download progress (non-mac). Returns an unsubscribe fn. */
  onDownloadProgress: (cb: (payload: DownloadProgressPayload) => void) => () => void
  /** Subscribe to "update downloaded, ready to install". Returns an unsubscribe fn. */
  onUpdateDownloaded: (cb: (payload: UpdateDownloadedPayload) => void) => () => void
  /** Subscribe to updater errors. Returns an unsubscribe fn. */
  onError: (cb: (payload: UpdaterErrorPayload) => void) => () => void
}

/**
 * IPC channel names for the updater. Kept here so preload (caller/subscriber) and
 * main (handler/emitter) can never drift. The `invoke:*` group is renderer -> main
 * request/response; the `event:*` group is main -> renderer webContents.send pushes.
 * These are the only runtime exports of this module.
 */
export const UPDATER_IPC = {
  // renderer -> main (ipcRenderer.invoke / ipcMain.handle)
  getVersion: 'updater:get-version',
  check: 'updater:check',
  confirmDownload: 'updater:confirm-download',
  quitAndInstall: 'updater:quit-and-install',
  openReleasePage: 'updater:open-release-page',
  // main -> renderer (webContents.send / ipcRenderer.on)
  updateAvailable: 'updater:update-available',
  updateNotAvailable: 'updater:update-not-available',
  downloadProgress: 'updater:download-progress',
  updateDownloaded: 'updater:update-downloaded',
  error: 'updater:error'
} as const
