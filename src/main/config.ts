import { app } from 'electron'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
  channels: GatewayChannel[]
  groups: GatewayGroup[]
  settings: GatewaySettings
}

/** An empty but valid config: no channels/groups yet, all settings at defaults. */
const DEFAULT_CONFIG: GatewayConfig = {
  default_group_id: '',
  channels: [],
  groups: [],
  settings: {}
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
    await writeConfig(DEFAULT_CONFIG)
  }
  return path
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
    channels: Array.isArray(parsed.channels) ? parsed.channels : [],
    groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
  }
}

/**
 * Strip every plaintext api_key from a config, replacing it with a has_api_key flag —
 * the only shape allowed to reach the renderer. Fields are copied explicitly (an
 * allow-list) rather than by omit-destructuring so a future field can never leak a
 * secret by accident.
 */
export function sanitizeConfig(config: GatewayConfig): DisplayConfig {
  return {
    default_group_id: config.default_group_id,
    channels: config.channels.map((c) => ({
      id: c.id,
      name: c.name,
      base_url: c.base_url,
      has_api_key: typeof c.api_key === 'string' && c.api_key.length > 0,
      models: c.models,
      price_weight: c.price_weight,
      enabled: c.enabled,
      created_at: c.created_at,
      updated_at: c.updated_at
    })),
    groups: config.groups.map((g) => ({
      id: g.id,
      name: g.name,
      channel_ids: g.channel_ids,
      created_at: g.created_at,
      updated_at: g.updated_at
    })),
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
    if (!c.id || typeof c.id !== 'string') throw new Error('invalid config: every channel needs an id')
    if (channelIds.has(c.id)) throw new Error(`invalid config: duplicate channel id ${c.id}`)
    channelIds.add(c.id)
  }
  const groupIds = new Set<string>()
  for (const g of input.groups) {
    if (!g.id || typeof g.id !== 'string') throw new Error('invalid config: every group needs an id')
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
  const groups: GatewayGroup[] = input.groups.map((g) => ({
    id: g.id,
    name: g.name,
    channel_ids: g.channel_ids,
    created_at: g.created_at,
    updated_at: g.updated_at
  }))
  return {
    default_group_id: input.default_group_id ?? '',
    channels,
    groups,
    settings: input.settings ?? {}
  }
}
