import { app } from 'electron'
import { access, mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
