import { createReadStream, existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { getDataDir } from './config'
import type { TraceQuery, TraceRecord } from '../shared/gateway'

/**
 * Read-only access to the gateway's raw request captures.
 *
 * A finished request's capture is one JSON object the gateway appended to
 * data-dir/capture/YYYY-MM-DD.jsonl (day-rolling, only when capture is enabled — see
 * gateway/store.go writeCapture). There is no index, so we locate the day file from the
 * row's timestamp and scan it line-by-line for the matching req_id, stopping at the first
 * hit.
 *
 * A request that is **still in flight** has no JSONL line yet; instead the gateway keeps a
 * live, partial snapshot in the `live_captures` table (data-dir/optaris.db), refreshed as the
 * request progresses and deleted once it completes. We read that first — it's a cheap
 * primary-key lookup, so polling an in-progress request never scans the capture files.
 *
 * Returns null when neither exists (capture was off for that request, failed_only mode
 * skipped a clean success, or the file has rolled off).
 */

/** Format a Date as local `YYYY-MM-DD`, matching the gateway's at.Format("2006-01-02"). */
function dayString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Capture files to scan, in priority order: the row's own day first, then ±1 day to
 * absorb any midnight/timezone skew between the gateway's write time and this read.
 */
function candidateDays(at: number): string[] {
  const dayMs = 86_400_000
  const seen = new Set<string>()
  return [at, at - dayMs, at + dayMs]
    .map((ms) => dayString(new Date(ms)))
    .filter((day) => (seen.has(day) ? false : (seen.add(day), true)))
}

/** Scan one JSONL file for the line whose req_id matches, parsing only candidate lines. */
async function findInFile(path: string, reqId: string): Promise<TraceRecord | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(path, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    let found: TraceRecord | null = null

    rl.on('line', (line) => {
      if (found || !line.includes(reqId)) return // cheap pre-filter before the JSON.parse
      try {
        const rec = JSON.parse(line) as TraceRecord
        if (rec.req_id === reqId) {
          found = rec
          rl.close()
          stream.destroy()
        }
      } catch {
        /* skip a malformed line */
      }
    })
    rl.on('close', () => resolve(found))
    stream.on('error', () => resolve(found))
  })
}

/**
 * Read the in-flight partial capture for a request from the live_captures table, or null
 * when the request isn't currently running (already completed / never captured). Read-only,
 * and resilient to a not-yet-created DB or table.
 */
function queryLiveTrace(reqId: string): TraceRecord | null {
  const dbPath = join(getDataDir(), 'optaris.db')
  if (!existsSync(dbPath)) return null
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
    const row = db.prepare('SELECT data FROM live_captures WHERE req_id = ?').get(reqId) as
      { data: string } | undefined
    if (!row) return null
    return JSON.parse(row.data) as TraceRecord
  } catch {
    return null // DB locked, table absent on an older gateway, or malformed data → treat as "no live capture"
  } finally {
    db?.close()
  }
}

/**
 * Read the raw capture for a single request. Returns the live partial snapshot while the
 * request is in flight (partial: true), the finished archive once it completes, or null when
 * no capture exists for it (capture disabled, failed_only mode skipped a clean success, or
 * the file has rolled off).
 */
export async function queryTrace(params: TraceQuery): Promise<TraceRecord | null> {
  const reqId = params?.req_id
  const at = params?.at
  if (!reqId || typeof at !== 'number' || !Number.isFinite(at)) return null

  // In-flight → live_captures (cheap PK lookup); finished → the JSONL archive. Live first so
  // polling an in-progress request never scans the (potentially large) capture files.
  const live = queryLiveTrace(reqId)
  if (live) return live

  const dir = join(getDataDir(), 'capture')
  for (const day of candidateDays(at)) {
    const path = join(dir, `${day}.jsonl`)
    if (!existsSync(path)) continue
    const rec = await findInFile(path, reqId)
    if (rec) return rec
  }
  return null
}
