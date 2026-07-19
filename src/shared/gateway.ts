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
  /**
   * Masked preview of the stored key (e.g. `sk-1234****cdef`) so the user can tell
   * *which* key is saved without the plaintext ever leaving the main process. Undefined
   * when no key is stored. Display-only: it is never part of ChannelInput and never
   * round-trips back on save.
   */
  api_key_preview?: string
  models: string[]
  price_weight?: number
  enabled: boolean
  created_at?: string
  updated_at?: string
}

/**
 * A group as shown to the renderer.
 *
 * When `id === DEFAULT_GROUP_ID` this is the synthesized built-in group: it is NOT
 * persisted to disk (the main process adds it in sanitizeConfig and strips it back out
 * in mergeConfig), its members always equal every channel, and it is read-only in the UI
 * (cannot be renamed, edited, or deleted). Its `name` is empty on the wire — the renderer
 * localizes it via `t('groups.defaultName')`.
 */
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
  /**
   * Timeout / duration knobs, passed through to the Go engine's settings.Settings. Each is
   * a Go duration string ("60s" / "4m" / "1m30s"); an omitted field falls back to the
   * engine default. Edited via the Advanced Options section of the settings panel.
   */
  t1_first_event_timeout?: string
  non_stream_timeout?: string
  t2_idle_timeout?: string
  t3_failover_timeout?: string
  max_stream_duration?: string
  cooldown?: string
  session_affinity_ttl?: string
  stats_window?: string
  [key: string]: unknown
}

/** Sanitized config returned by getConfig — safe to hold in the renderer. */
export interface DisplayConfig {
  default_group_id?: string
  /**
   * The client-facing gateway key, in full. Unlike a channel key (stripped to a
   * has_api_key flag), this one is meant to be shown and copied by the user — it is
   * the local gateway's admission credential, not an upstream secret.
   */
  gateway_api_key: string
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
  /** Filter by outcome: success / failed / client_canceled / rejected / interrupted, or the
   * sentinel `in_progress` for requests the gateway hasn't finalized yet (outcome IS NULL). */
  outcome?: string
  group_id?: string
  channel_id?: string
  /** Case-sensitive substring match on model (SQL LIKE %model%). */
  model?: string
}

/**
 * One row of the gateway's `requests` summary table (see gateway/store.go). A row is
 * written the moment a request is received and UPSERTed through its lifecycle, so it
 * can represent an in-flight request: while running, `outcome` is null and `phase`
 * tracks the current stage; once finished, `outcome` is set. Usage columns are null on
 * any non-success outcome, so every nullable column is `| null`.
 */
export interface LogRow {
  req_id: string
  at: number
  group_id: string | null
  model: string | null
  stream: number | null
  channel_id: string | null
  channel_name: string | null
  /** Final outcome: success / failed / client_canceled / rejected / interrupted. Null while the request is still in progress. */
  outcome: string | null
  http_status: number | null
  fail_class: string | null
  /** Current lifecycle stage: received / connecting / streaming / failover / done. Drives the live "in progress" indicator; null on rows written before this column existed. */
  phase: string | null
  first_token_ms: number | null
  input_tokens: number | null
  cache_read_tokens: number | null
  cache_write_5m_tokens: number | null
  cache_write_1h_tokens: number | null
  output_tokens: number | null
  reasoning_tokens: number | null
  /** Client identity classified from the User-Agent (claude_code / claude_desktop / codex); '' or null = unknown. */
  client_type: string | null
  /** Session identifier parsed from the request (header or body), null when the format has no session concept. */
  session_id: string | null
  /** Number of distinct upstream channels attempted (retries against the same channel are not counted). */
  upstreams_tried: number | null
}

/** Identifies one request when fetching its raw capture (see queryTrace). */
export interface TraceQuery {
  req_id: string
  /** The row's `at` (unix ms); used to locate the day-rolling capture file. */
  at: number
}

/**
 * One upstream attempt within a trace: the gateway→upstream request (B) and the
 * upstream→gateway response (C). Mirrors gateway/store.go's attemptRecord. Headers are
 * `name -> values` (Go's http.Header); auth material is already redacted. Bodies are
 * plaintext strings and may be truncated (see resp_body_truncated).
 */
export interface TraceAttempt {
  channel_id: string
  model: string
  upstream_url: string
  req_headers: Record<string, string[]> | null
  req_body: string
  /** Upstream HTTP status. `0` means no response yet — the request was sent and is awaiting the upstream (only possible on a `partial` TraceRecord's last attempt) or the connection failed. */
  resp_status: number
  resp_headers: Record<string, string[]> | null
  resp_body: string
  resp_body_truncated: boolean
  success: boolean
  failure_class: string
  passed_commit: boolean
}

/**
 * The full raw capture for a single request: the client→gateway request (A) plus one
 * TraceAttempt per upstream try. Mirrors gateway/store.go's captureRecord. Present either as
 * the finished archive (read from the JSONL capture files) or, while the request is still in
 * flight, as a live partial snapshot (read from the live_captures table — see queryTrace,
 * which returns null when neither exists).
 */
export interface TraceRecord {
  req_id: string
  at: number
  group_id: string
  model: string
  stream: boolean
  outcome: string
  http_status: number
  req_headers: Record<string, string[]> | null
  req_body: string
  attempts: TraceAttempt[]
  stripped_usage: boolean
  committed_then_failed: boolean
  /** True for a live in-flight snapshot (still updating; the last attempt may be awaiting its response), false for the finished archive. Absent on records written before this field existed. */
  partial?: boolean
}

/** The external client apps Optaris can auto-configure to point at the local gateway. */
export type ClientId = 'claude_code' | 'claude_desktop' | 'codex' | 'gemini_cli'

/**
 * One client's current wiring, as reported by listClients. Drives the dashboard's
 * "Connect your clients" card: `detected`/`connected` pick the status color and
 * `current_base_url` shows where the client points today.
 */
export interface ClientStatus {
  id: ClientId
  /** False when this OS can't be auto-configured for the client (e.g. Claude Desktop on Linux). */
  supported: boolean
  /** The client's config exists on disk (installed / previously configured). */
  detected: boolean
  /** The client's config already points at this gateway (base URL match). */
  connected: boolean
  /** The base URL the client currently points at, or null when unset/undetected. */
  current_base_url: string | null
  /** Config file paths this client would write (for display / debugging). */
  config_paths: string[]
  /** Optional hint shown in the UI (e.g. restart required / experimental). */
  note?: string
}

/** Result of applyClient: the files written and an optional human-readable message. */
export interface ApplyClientResult {
  ok: boolean
  written_paths: string[]
  message?: string
}

/**
 * Result of regenerateApiKey: the new key (for the dashboard to display) plus the ids of
 * the clients that were re-applied with it, and the ids that could not be. Regenerating
 * rotates the admission key, which would otherwise 401 every connected client until it's
 * manually re-applied; the main process re-writes the new key into each client that was
 * pointed here. `reapplied` are the ones that succeeded; `failed` are ones that were pointed
 * here but couldn't be re-written (so they still hold the stale key and need a manual
 * re-connect). The key is rotated regardless — a re-apply failure never undoes that.
 */
export interface RegenerateApiKeyResult {
  key: string
  reapplied: ClientId[]
  failed: ClientId[]
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
  /** Read one request's raw capture (client/upstream headers+bodies). While in flight, returns a live partial snapshot (`partial: true`); null when none was recorded. */
  queryTrace: (params: TraceQuery) => Promise<TraceRecord | null>
  /**
   * Replace the gateway's client-facing API key. Returns the new value plus the ids of the
   * clients that were re-applied with it and the ids that couldn't be (connected clients are
   * re-pointed automatically so they don't 401 on the rotated key; any that fail are reported
   * so the user can re-connect them manually).
   */
  regenerateApiKey: () => Promise<RegenerateApiKeyResult>
  /** List each auto-configurable client, its current base URL, and whether it points here. */
  listClients: () => Promise<ClientStatus[]>
  /** Point a client at this gateway by writing its config file(s). */
  applyClient: (id: ClientId) => Promise<ApplyClientResult>
}

/**
 * Id of the synthesized built-in "all channels" group. It is never persisted on disk:
 * the main process injects it into the read shape (sanitizeConfig) with members equal to
 * every channel, and strips it out of the write shape (mergeConfig) so it can never leak
 * back into the config file. The gateway sidecar synthesizes the same group at load time
 * under this exact id — keep it in sync with `builtinDefaultGroupID` in gateway/config.go.
 */
export const DEFAULT_GROUP_ID = 'grp_default'

/**
 * IPC channel names. Kept here so preload (the caller) and main (the handler) can
 * never drift out of sync. These are the only runtime exports of this module.
 */
export const GATEWAY_IPC = {
  getBaseUrl: 'gateway:get-base-url',
  getConfig: 'gateway:get-config',
  updateConfig: 'gateway:update-config',
  queryLogs: 'gateway:query-logs',
  queryTrace: 'gateway:query-trace',
  regenerateApiKey: 'gateway:regenerate-api-key',
  listClients: 'gateway:list-clients',
  applyClient: 'gateway:apply-client'
} as const
