/**
 * Wire contract between the renderer control plane and the main process.
 *
 * These types are what crosses the IPC boundary (preload -> ipcRenderer.invoke).
 * They are intentionally distinct from the on-disk config types in
 * src/main/config.ts: the renderer NEVER receives an upstream api_key. Reads return
 * a DisplayConfig (key stripped, replaced by a has_api_key flag); writes send a
 * ConfigInput (api_key optional — omit/empty means "keep the stored key").
 *
 * Field names stay snake_case to match the on-disk config so the main process can
 * merge the two shapes field-for-field without a case-mapping layer.
 *
 * This module is type-only except for GATEWAY_IPC (channel-name constants shared by
 * preload and main); import the types with `import type` so nothing but those
 * constants ever reaches a runtime bundle.
 */

/** A channel as shown to the renderer: the plaintext key never crosses the boundary. */
export interface DisplayChannel {
  id: string
  name: string
  base_url: string
  /** True when a non-empty api_key is stored for this channel (the key itself is never sent). */
  has_api_key: boolean
  models: string[]
  price_weight?: number
  enabled: boolean
  created_at?: string
  updated_at?: string
}

export interface DisplayGroup {
  id: string
  name: string
  channel_ids: string[]
  created_at?: string
  updated_at?: string
}

export interface DisplaySettings {
  capture_enabled?: boolean
  capture_mode?: 'failed_only' | 'all'
  [key: string]: unknown
}

/** Sanitized config returned by getConfig — safe to hold in the renderer. */
export interface DisplayConfig {
  default_group_id?: string
  channels: DisplayChannel[]
  groups: DisplayGroup[]
  settings: DisplaySettings
}

/**
 * A channel the renderer sends back on save. api_key is optional by design:
 *   - omitted / empty string  -> keep the key already stored for this id
 *   - non-empty string        -> the user typed a new key; overwrite
 * New channels are created with a renderer-generated `ch_`-prefixed id, so a save may
 * create a channel and a group referencing it in a single call.
 */
export interface ChannelInput {
  id: string
  name: string
  base_url: string
  api_key?: string
  models: string[]
  price_weight?: number
  enabled: boolean
  created_at?: string
  updated_at?: string
}

export interface GroupInput {
  id: string
  name: string
  channel_ids: string[]
  created_at?: string
  updated_at?: string
}

/** The full config the renderer sends to updateConfig. */
export interface ConfigInput {
  default_group_id?: string
  channels: ChannelInput[]
  groups: GroupInput[]
  settings: DisplaySettings
}

/** Filters for querying the request-summary log. All optional; sensible defaults apply. */
export interface LogQuery {
  /** Max rows to return. Defaults to 100, capped at 1000. */
  limit?: number
  /** Keyset pagination: only rows with `at` strictly less than this (unix ms). Newest first. */
  before?: number
  /** Filter by outcome: success / failed / client_canceled / rejected. */
  outcome?: string
  group_id?: string
  channel_id?: string
  /** Case-sensitive substring match on model (SQL LIKE %model%). */
  model?: string
}

/**
 * One row of the gateway's `requests` summary table (see gateway/store.go). Usage
 * columns are NULL on any non-success outcome, so every nullable column is `| null`.
 */
export interface LogRow {
  req_id: string
  at: number
  group_id: string | null
  model: string | null
  stream: number | null
  channel_id: string | null
  channel_name: string | null
  outcome: string | null
  http_status: number | null
  fail_class: string | null
  first_token_ms: number | null
  input_tokens: number | null
  cache_read_tokens: number | null
  cache_write_5m_tokens: number | null
  cache_write_1h_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
}

/** The gateway control-plane surface exposed on `window.api.gateway`. */
export interface GatewayApi {
  /** Base URL clients point their base_url at (http://127.0.0.1:<port>). */
  getBaseUrl: () => Promise<string>
  /** Current config, with every api_key stripped (has_api_key flag instead). */
  getConfig: () => Promise<DisplayConfig>
  /** Persist config. Channels with an empty/omitted api_key keep their stored key. */
  updateConfig: (config: ConfigInput) => Promise<void>
  /** Query the request-summary log, newest first. */
  queryLogs: (params?: LogQuery) => Promise<LogRow[]>
}

/**
 * IPC channel names. Kept here so preload (the caller) and main (the handler) can
 * never drift out of sync. This is the only runtime export of this module.
 */
export const GATEWAY_IPC = {
  getBaseUrl: 'gateway:get-base-url',
  getConfig: 'gateway:get-config',
  updateConfig: 'gateway:update-config',
  queryLogs: 'gateway:query-logs'
} as const
