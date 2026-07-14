import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_GROUP_ID } from '../shared/gateway'
import type { ConfigInput, DisplayConfig } from '../shared/gateway'

/**
 * Gateway config store (main-process side).
 *
 * The main process owns the config file; the gateway sidecar only reads it (path
 * passed via --config) and hot-reloads on change. These types are the on-disk wire
 * contract shared with the Go gateway, so their keys are snake_case to match its
 * json tags — do not rename them to camelCase without changing the Go side too.
 *
 * The upstream `api_key` is the plaintext credential. It lives only here and in the
 * gateway process; it is never sent to the renderer (phase 3 will strip it in the
 * IPC layer).
 */

export interface GatewayChannel {
  id: string
  name: string
  base_url: string
  api_key: string
  models: string[]
  price_weight?: number
  enabled: boolean
  created_at?: string
  updated_at?: string
}

export interface GatewayGroup {
  id: string
  name: string
  channel_ids: string[]
  created_at?: string
  updated_at?: string
}

/**
 * A partial settings object. Any field omitted here falls back to the gateway's
 * built-in defaults (settings.Default() on the Go side), so we only need to carry
 * the fields we actually want to override.
 */
export interface GatewaySettings {
  capture_enabled?: boolean
  capture_mode?: 'failed_only' | 'all'
  [key: string]: unknown
}

export interface GatewayConfig {
  /** Group every request routes to until per-request auth lands (phase 3). */
  default_group_id?: string
  /**
   * The single client-facing key inbound requests must present (the gateway rejects
   * mismatches with 401). Unlike a channel `api_key`, this is NOT an upstream secret:
   * it is the local gateway's own admission key and the user must be able to see and
   * copy it, so it is passed through to the renderer in full (see sanitizeConfig).
   */
  gateway_api_key?: string
  channels: GatewayChannel[]
  groups: GatewayGroup[]
  settings: GatewaySettings
}

/**
 * An empty but valid config: no channels/groups yet, all settings at defaults. The active
 * group defaults to the built-in "all channels" group (synthesized by the gateway and by
 * sanitizeConfig, never stored in `groups`), so a fresh install routes as soon as a channel
 * exists — the user never has to create a group first.
 */
const DEFAULT_CONFIG: GatewayConfig = {
  default_group_id: DEFAULT_GROUP_ID,
  gateway_api_key: '',
  channels: [],
  groups: [],
  settings: {}
}

/**
 * Generate a fresh client-facing gateway key. The `sk-optaris-` prefix keeps it
 * recognizable (and accepted by clients that validate an `sk-` shape); the 24 random
 * bytes give ~192 bits of entropy, base64url-encoded so it is copy/paste safe.
 */
export function generateGatewayApiKey(): string {
  return `sk-optaris-${randomBytes(24).toString('base64url')}`
}

/** Path of the config JSON the gateway reads (--config). */
export function getConfigPath(): string {
  return join(app.getPath('userData'), 'optaris-config.json')
}

/** Directory for the gateway event store (--data-dir): optaris.db + capture/. */
export function getDataDir(): string {
  return join(app.getPath('userData'), 'optaris-data')
}

/**
 * Atomically write the config to disk (temp file + rename) so the gateway's poller
 * never observes a half-written file. Owner-only perms — the file holds plaintext
 * upstream keys.
 */
export async function writeConfig(config: GatewayConfig): Promise<void> {
  const path = getConfigPath()
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, path)
}

/**
 * Ensure a config file exists, seeding an empty default if missing (first run). An
 * existing file is left untouched so user config is never clobbered. Returns its path.
 */
export async function ensureConfig(): Promise<string> {
  const path = getConfigPath()
  try {
    await access(path)
  } catch {
    // First run: seed with a freshly generated gateway key so the sidecar boots
    // already protected.
    await writeConfig({ ...DEFAULT_CONFIG, gateway_api_key: generateGatewayApiKey() })
  }
  return path
}

/**
 * Guarantee the config carries a gateway API key, generating and persisting one if it
 * is missing. This is the upgrade path for installs whose config predates the key (a
 * fresh install already gets one from ensureConfig). Returns the effective key.
 *
 * Called at startup before the sidecar spawns. Safe from the readConfig→ensureConfig
 * recursion: neither ensureConfig nor this function calls back into readConfig's
 * caller — ensureConfig only seeds a missing file.
 */
export async function ensureGatewayApiKey(): Promise<string> {
  const config = await readConfig()
  if (config.gateway_api_key && config.gateway_api_key.length > 0) {
    return config.gateway_api_key
  }
  const key = generateGatewayApiKey()
  await writeConfig({ ...config, gateway_api_key: key })
  return key
}

/**
 * Replace the gateway API key with a freshly generated one and persist it. Backs the
 * dashboard's "regenerate" button. The sidecar hot-reloads the new key via its mtime
 * poller. Returns the new key. Existing clients must be updated to the new key.
 */
export async function regenerateGatewayApiKey(): Promise<string> {
  const current = await readConfig()
  const key = generateGatewayApiKey()
  await writeConfig({ ...current, gateway_api_key: key })
  return key
}

/** Ensure the gateway data directory exists. Returns its path. */
export async function ensureDataDir(): Promise<string> {
  const dir = getDataDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

/**
 * Read and parse the on-disk config (seeding an empty default first if absent). This
 * is the main-process view: it still carries the plaintext api_key of every channel,
 * so its result must be sanitized (sanitizeConfig) before it can go to the renderer.
 * Missing/malformed collection fields are backfilled so a hand-edited file can't crash
 * a caller.
 */
export async function readConfig(): Promise<GatewayConfig> {
  const path = await ensureConfig()
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<GatewayConfig>
  return {
    default_group_id: parsed.default_group_id ?? '',
    gateway_api_key: typeof parsed.gateway_api_key === 'string' ? parsed.gateway_api_key : '',
    channels: Array.isArray(parsed.channels) ? parsed.channels : [],
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
  }
}

/**
 * Mask a plaintext key down to a recognizable preview — first 4 + `****` + last 4, e.g.
 * `sk-1234****cdef`. Keys short enough that revealing both ends would expose (almost) the
 * whole secret are masked more aggressively: only the first two chars are shown. Returns
 * '' for an empty key. This preview is the *only* derivative of the key allowed to reach
 * the renderer.
 */
export function maskApiKey(key: string): string {
  if (typeof key !== 'string' || key.length === 0) return ''
  if (key.length <= 8) {
    const head = key.slice(0, 2)
    return head + '*'.repeat(Math.max(2, key.length - head.length))
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

/**
 * Strip every plaintext api_key from a config, replacing it with a has_api_key flag and a
 * masked api_key_preview — the only shape allowed to reach the renderer. Fields are copied
 * explicitly (an allow-list) rather than by omit-destructuring so a future field can never
 * leak a secret by accident.
 */
export function sanitizeConfig(config: GatewayConfig): DisplayConfig {
  return {
    default_group_id: config.default_group_id,
    // Passed through in full (unlike channel keys): the gateway key is the local
    // admission credential the user must see and copy into their clients, not an
    // upstream secret. See GatewayConfig.gateway_api_key.
    gateway_api_key: config.gateway_api_key ?? '',
    channels: config.channels.map((c) => ({
      id: c.id,
      name: c.name,
      base_url: c.base_url,
      has_api_key: typeof c.api_key === 'string' && c.api_key.length > 0,
      api_key_preview: typeof c.api_key === 'string' ? maskApiKey(c.api_key) : '',
      models: c.models,
      price_weight: c.price_weight,
      enabled: c.enabled,
      created_at: c.created_at,
      updated_at: c.updated_at
    })),
    // The built-in "all channels" group is synthesized here (never read from disk) so the
    // renderer's group list, active-group picker, and log group→name map all see it. Its
    // members are computed live from the current channels, matching the gateway's own
    // synthesis in gateway/config.go. name is left empty — the renderer localizes it. Any
    // stored group colliding with the built-in id is dropped so it can't appear twice.
    groups: [
      {
        id: DEFAULT_GROUP_ID,
        name: '',
        channel_ids: config.channels.map((c) => c.id)
      },
      ...config.groups
        .filter((g) => g.id !== DEFAULT_GROUP_ID)
        .map((g) => ({
          id: g.id,
          name: g.name,
          channel_ids: g.channel_ids,
          created_at: g.created_at,
          updated_at: g.updated_at
        }))
    ],
    settings: { ...config.settings }
  }
}

/**
 * Reject a renderer-supplied config before it is merged/written. Ids are generated by
 * the renderer (ch_/grp_ prefixed), so every channel and group must carry a non-empty,
 * unique id — a missing or duplicate id would silently collide in the key-merge map.
 */
export function validateConfigInput(input: ConfigInput): void {
  if (!input || typeof input !== 'object') {
    throw new Error('invalid config: expected an object')
  }
  if (!Array.isArray(input.channels) || !Array.isArray(input.groups)) {
    throw new Error('invalid config: channels and groups must be arrays')
  }
  const channelIds = new Set<string>()
  for (const c of input.channels) {
    if (!c.id || typeof c.id !== 'string')
      throw new Error('invalid config: every channel needs an id')
    if (channelIds.has(c.id)) throw new Error(`invalid config: duplicate channel id ${c.id}`)
    channelIds.add(c.id)
  }
  const groupIds = new Set<string>()
  for (const g of input.groups) {
    // The built-in group is synthesized into the read shape and stripped from the write
    // shape (mergeConfig); the renderer may echo it back, so skip it here rather than
    // rejecting an otherwise-valid save.
    if (g.id === DEFAULT_GROUP_ID) continue
    if (!g.id || typeof g.id !== 'string')
      throw new Error('invalid config: every group needs an id')
    if (groupIds.has(g.id)) throw new Error(`invalid config: duplicate group id ${g.id}`)
    groupIds.add(g.id)
  }
}

/**
 * Merge a renderer-supplied config onto the current on-disk one, rebuilding it
 * field-by-field (so unknown/extra fields from the renderer are dropped).
 *
 * Key semantics: the renderer never holds an api_key, so on save each channel's key is
 * "keep by default" — an empty or omitted api_key reuses the key already stored for
 * that channel id; only a non-empty api_key (the user actually typed one) overwrites.
 * A brand-new channel with no key stored simply gets an empty key.
 */
export function mergeConfig(current: GatewayConfig, input: ConfigInput): GatewayConfig {
  const storedById = new Map(current.channels.map((c) => [c.id, c]))
  const channels: GatewayChannel[] = input.channels.map((c) => {
    const provided = typeof c.api_key === 'string' ? c.api_key : ''
    const api_key = provided.length > 0 ? provided : (storedById.get(c.id)?.api_key ?? '')
    return {
      id: c.id,
      name: c.name,
      base_url: c.base_url,
      api_key,
      models: c.models,
      price_weight: c.price_weight,
      enabled: c.enabled,
      created_at: c.created_at,
      updated_at: c.updated_at
    }
  })
  // Strip the built-in group before persisting: it is synthesized on read (sanitizeConfig)
  // and by the gateway at load time, so writing it back would leave a stale, self-duplicating
  // copy on disk. Only user-created groups are stored.
  const groups: GatewayGroup[] = input.groups
    .filter((g) => g.id !== DEFAULT_GROUP_ID)
    .map((g) => ({
      id: g.id,
      name: g.name,
      channel_ids: g.channel_ids,
      created_at: g.created_at,
      updated_at: g.updated_at
    }))
  return {
    // The active group is never empty: an omitted/blank value falls back to the built-in
    // group, matching resolveDefaultGroup in gateway/config.go so disk and gateway agree.
    default_group_id: input.default_group_id || DEFAULT_GROUP_ID,
    // The renderer never sends the gateway key back, so always keep the stored one.
    // It is changed only through regenerateGatewayApiKey, never a plain config save.
    gateway_api_key: current.gateway_api_key ?? '',
    channels,
    groups,
    settings: input.settings ?? {}
  }
}
