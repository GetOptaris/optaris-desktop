import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { GATEWAY_IPC } from '../shared/gateway'
import type { ClientId, ConfigInput, GatewayApi, LogQuery, TraceQuery } from '../shared/gateway'
import { UPDATER_IPC } from '../shared/updater'
import type { UpdaterApi } from '../shared/updater'

// Custom APIs for renderer. The gateway namespace is a thin proxy: every call is an
// ipcRenderer.invoke to a main-process handler. The renderer never touches the config
// file, the sidecar, or the database directly — and never sees an upstream api_key.
const gateway: GatewayApi = {
  getBaseUrl: () => ipcRenderer.invoke(GATEWAY_IPC.getBaseUrl),
  getConfig: () => ipcRenderer.invoke(GATEWAY_IPC.getConfig),
  updateConfig: (config: ConfigInput) => ipcRenderer.invoke(GATEWAY_IPC.updateConfig, config),
  queryLogs: (params?: LogQuery) => ipcRenderer.invoke(GATEWAY_IPC.queryLogs, params),
  queryTrace: (params: TraceQuery) => ipcRenderer.invoke(GATEWAY_IPC.queryTrace, params),
  regenerateApiKey: () => ipcRenderer.invoke(GATEWAY_IPC.regenerateApiKey),
  listClients: () => ipcRenderer.invoke(GATEWAY_IPC.listClients),
  applyClient: (id: ClientId) => ipcRenderer.invoke(GATEWAY_IPC.applyClient, id)
}

// Subscribe to a main -> renderer push channel. Returns an unsubscribe fn so callers
// (React effects) can clean up. Context isolation forbids exposing ipcRenderer itself,
// so each subscription is a wrapped listener over a fixed channel.
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

// App self-update: invoke methods proxy to main; on* methods subscribe to pushes.
const updater: UpdaterApi = {
  getVersion: () => ipcRenderer.invoke(UPDATER_IPC.getVersion),
  checkForUpdates: () => ipcRenderer.invoke(UPDATER_IPC.check),
  confirmDownload: () => ipcRenderer.invoke(UPDATER_IPC.confirmDownload),
  quitAndInstall: () => ipcRenderer.invoke(UPDATER_IPC.quitAndInstall),
  openReleasePage: () => ipcRenderer.invoke(UPDATER_IPC.openReleasePage),
  onUpdateAvailable: (cb) => subscribe(UPDATER_IPC.updateAvailable, cb),
  onUpdateNotAvailable: (cb) => subscribe(UPDATER_IPC.updateNotAvailable, () => cb()),
  onDownloadProgress: (cb) => subscribe(UPDATER_IPC.downloadProgress, cb),
  onUpdateDownloaded: (cb) => subscribe(UPDATER_IPC.updateDownloaded, cb),
  onError: (cb) => subscribe(UPDATER_IPC.error, cb)
}

const api = { gateway, updater }

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
