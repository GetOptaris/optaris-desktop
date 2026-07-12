import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getDataDir } from './config'
import type { LogQuery, LogRow } from '../shared/gateway'

/**
 * Read-only access to the gateway's request-summary database.
 *
 * The gateway (a separate process) is the sole writer of data-dir/optaris.db, which
 * it opens in WAL mode. WAL lets an independent reader — us — run SELECTs concurrently
 * without ever blocking that writer, so we open the file read-only per query and read
 * the latest committed rows. node:sqlite is bundled with Electron's Node, so this
 * needs no native module and no rebuild.
 */

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000

// Exactly the columns of gateway/store.go's `requests` table, in schema order.
const COLUMNS =
  'req_id, at, group_id, model, stream, channel_id, channel_name, outcome, http_status, ' +
  'fail_class, first_token_ms, input_tokens, cache_read_tokens, cache_write_5m_tokens, ' +
  'cache_write_1h_tokens, output_tokens, reasoning_tokens'

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_LIMIT
  return Math.min(Math.max(Math.floor(limit), 1), MAX_LIMIT)
}

/**
 * Query the summary log, newest first. Returns [] when the gateway has not written a
 * database yet (no requests have ever completed), so the control plane can render an
 * empty state instead of handling a "file not found" error.
 *
 * All filters are bound as parameters (never string-interpolated), so untrusted
 * renderer input cannot inject SQL.
 */
export function queryLogs(params: LogQuery = {}): LogRow[] {
  const dbPath = join(getDataDir(), 'optaris.db')
  if (!existsSync(dbPath)) return []

  const where: string[] = []
  const bind: Record<string, string | number> = {}
  if (typeof params.before === 'number') {
    where.push('at < :before')
    bind.before = params.before
  }
  if (params.outcome) {
    where.push('outcome = :outcome')
    bind.outcome = params.outcome
  }
  if (params.group_id) {
    where.push('group_id = :group_id')
    bind.group_id = params.group_id
  }
  if (params.channel_id) {
    where.push('channel_id = :channel_id')
    bind.channel_id = params.channel_id
  }
  if (params.model) {
    where.push('model LIKE :model')
    bind.model = `%${params.model}%`
  }
  bind.limit = clampLimit(params.limit)

  const sql =
    `SELECT ${COLUMNS} FROM requests` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY at DESC LIMIT :limit'

  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare(sql).all(bind) as unknown as LogRow[]
  } finally {
    db.close()
  }
}
