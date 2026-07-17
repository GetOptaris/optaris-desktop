import type { TFunction } from '@/i18n'
import type { LogRow } from '../../../shared/gateway'

/** A row is in progress when the gateway hasn't finalized it yet (outcome NULL). */
export function isInProgress(row: LogRow): boolean {
  return row.outcome == null
}

/** Tailwind classes for an outcome Badge, keyed by the request outcome. */
export function outcomeBadgeClass(outcome: string | null): string {
  switch (outcome) {
    case 'success':
      return 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
    case 'failed':
      return 'border-transparent bg-destructive/15 text-destructive'
    case 'rejected':
      return 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400'
    case 'interrupted':
      return 'border-transparent bg-orange-500/15 text-orange-700 dark:text-orange-400'
    case null:
      // In progress: a calm, animated blue so a live request reads as "working", not done.
      return 'border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-400 animate-pulse'
    default:
      return 'border-transparent bg-muted text-muted-foreground'
  }
}

/** Localize a known outcome; fall back to the raw value for anything unmapped, and '—' for null. */
export function outcomeLabel(t: TFunction, outcome: string | null): string {
  if (!outcome) return '—'
  const key = `logs.outcomes.${outcome}`
  const label = t(key)
  return label === key ? outcome : label
}

/**
 * Localize a lifecycle stage (received / connecting / streaming / failover / done). Used as
 * the badge text for in-progress rows so the user sees which step a stuck request is on.
 * Falls back to the raw value, and a generic "in progress" label when phase is absent.
 */
export function phaseLabel(t: TFunction, phase: string | null): string {
  if (!phase) return t('logs.inProgress')
  const key = `logs.phases.${phase}`
  const label = t(key)
  return label === key ? phase : label
}

/** Format a unix-ms timestamp for display; '—' when not a finite number. */
export function fmtTime(at: number): string {
  if (!Number.isFinite(at)) return '—'
  return new Date(at).toLocaleString()
}

/** Render a nullable token count; '—' when null (usage is NULL on non-success rows). */
export function fmtNum(n: number | null): string {
  return typeof n === 'number' ? String(n) : '—'
}

/**
 * Localize a client type (claude_code / claude_desktop / codex / …); fall back to the raw value for
 * anything unmapped, and the "unknown" label for empty/null (no client rule matched the UA).
 */
export function clientLabel(t: TFunction, clientType: string | null): string {
  if (!clientType) return t('logs.clients.unknown')
  const key = `logs.clients.${clientType}`
  const label = t(key)
  return label === key ? clientType : label
}

/** Render the stream flag stored as 0/1/null in the summary DB: streaming / non-streaming / '—'. */
export function streamLabel(t: TFunction, stream: number | null): string {
  if (typeof stream !== 'number') return '—'
  return stream ? t('logs.streamYes') : t('logs.streamNo')
}

/**
 * Compact elapsed duration since a unix-ms start time, for in-progress rows ("how long
 * has this been stuck"). Coarse on purpose: seconds under a minute, then `1m20s`. Never
 * negative (clock skew clamps to 0s).
 */
export function fmtElapsed(fromMs: number, nowMs: number): string {
  const secs = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m${s}s`
}
