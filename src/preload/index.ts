import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { GATEWAY_IPC } from '../shared/gateway'
import type { ClientId, ConfigInput, GatewayApi, LogQuery, TraceQuery } from '../shared/gateway'

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

const api = { gateway }

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
