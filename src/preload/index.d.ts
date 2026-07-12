import type { ElectronAPI } from '@electron-toolkit/preload'
import type { GatewayApi } from '../shared/gateway'

interface Api {
  gateway: GatewayApi
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
