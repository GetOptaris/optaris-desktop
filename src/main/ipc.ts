import { ipcMain } from 'electron'
import { GATEWAY_IPC } from '../shared/gateway'
import type { ConfigInput, DisplayConfig, LogQuery, LogRow } from '../shared/gateway'
import type { GatewayManager } from './gateway'
import { mergeConfig, readConfig, sanitizeConfig, validateConfigInput, writeConfig } from './config'
import { queryLogs } from './logs'

/**
 * Wire the gateway control-plane IPC channels.
 *
 * The renderer reaches the gateway and its config ONLY through these handlers: the
 * main process is the sole owner of the plaintext config file and of the sidecar's
 * port. Everything returned to the renderer is sanitized — an upstream api_key never
 * crosses this boundary. The data plane does not go through Electron at all; the
 * renderer only ever needs the base URL to hand to a client.
 */
export function registerGatewayIpc(gateway: GatewayManager): void {
  // Base URL clients point their base_url at. Data-plane traffic goes straight here.
  ipcMain.handle(GATEWAY_IPC.getBaseUrl, (): Promise<string> => gateway.resolveBaseUrl())

  // Current config with every api_key stripped (has_api_key flag instead).
  ipcMain.handle(GATEWAY_IPC.getConfig, async (): Promise<DisplayConfig> => {
    return sanitizeConfig(await readConfig())
  })

  // Persist config. Keys are merged (an empty/omitted api_key keeps the stored key);
  // the gateway hot-reloads the file on its own via mtime polling, so we do not signal
  // it here. The input comes from the renderer, so it is validated and rebuilt
  // field-by-field before it is written.
  ipcMain.handle(GATEWAY_IPC.updateConfig, async (_event, input: ConfigInput): Promise<void> => {
    validateConfigInput(input)
    const current = await readConfig()
    await writeConfig(mergeConfig(current, input))
  })

  // Query the request-summary log (read-only SQLite; newest first).
  ipcMain.handle(GATEWAY_IPC.queryLogs, (_event, params: LogQuery = {}): LogRow[] => {
    return queryLogs(params)
  })
}
