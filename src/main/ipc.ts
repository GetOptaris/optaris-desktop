import { ipcMain } from 'electron'
import { GATEWAY_IPC } from '../shared/gateway'
import type {
  ApplyClientResult,
  ClientId,
  ClientStatus,
  ConfigInput,
  DisplayConfig,
  LogQuery,
  LogRow,
  RegenerateApiKeyResult,
  TraceQuery,
  TraceRecord
} from '../shared/gateway'
import type { GatewayManager } from './gateway'
import {
  mergeConfig,
  readConfig,
  regenerateGatewayApiKey,
  sanitizeConfig,
  validateConfigInput,
  writeConfig
} from './config'
import { applyClient, listClients, reapplyConnectedClients } from './clients'
import { queryLogs } from './logs'
import { queryTrace } from './trace'

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

  // Read one request's raw capture (client/upstream headers+bodies) from the JSONL files.
  // Null when capture was not recorded for that request.
  ipcMain.handle(
    GATEWAY_IPC.queryTrace,
    (_event, params: TraceQuery): Promise<TraceRecord | null> => queryTrace(params)
  )

  // Regenerate the single client-facing gateway API key and return the new value so the
  // dashboard can show it. The sidecar hot-reloads it on its own via mtime polling. Rotating
  // the key would 401 every connected client, so we re-apply the new key into each client
  // still pointed here (report which succeeded/failed back for the toast). Re-apply runs after
  // the key is persisted, so applyClient's ensureGatewayApiKey reads the fresh value. The key
  // is rotated regardless: re-apply is best-effort, and its failure must not turn a successful
  // rotation into a reported failure (which would leave the UI showing the stale key).
  ipcMain.handle(GATEWAY_IPC.regenerateApiKey, async (): Promise<RegenerateApiKeyResult> => {
    const key = await regenerateGatewayApiKey()
    try {
      const { reapplied, failed } = await reapplyConnectedClients(gateway)
      return { key, reapplied, failed }
    } catch {
      // Couldn't even list the clients (e.g. gateway not ready). The key is already rotated;
      // report it as successful with nothing re-applied rather than as a failed regenerate.
      return { key, reapplied: [], failed: [] }
    }
  })

  // Report each auto-configurable client's current wiring (installed / base URL / connected)
  // for the dashboard's "Connect your clients" card.
  ipcMain.handle(GATEWAY_IPC.listClients, (): Promise<ClientStatus[]> => listClients(gateway))

  // Write the gateway address + admission key into one client's config file(s).
  ipcMain.handle(GATEWAY_IPC.applyClient, (_event, id: ClientId): Promise<ApplyClientResult> =>
    applyClient(gateway, id)
  )
}
