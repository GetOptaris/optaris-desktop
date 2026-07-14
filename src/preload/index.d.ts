import type { ElectronAPI } from '@electron-toolkit/preload'
import type { GatewayApi } from '../shared/gateway'
import type { UpdaterApi } from '../shared/updater'

interface Api {
  gateway: GatewayApi
  updater: UpdaterApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
