import type { TFunction } from '@/i18n'

/** Tailwind classes for an outcome Badge, keyed by the request outcome. */
export function outcomeBadgeClass(outcome: string | null): string {
  switch (outcome) {
    case 'success':
      return 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
    case 'failed':
      return 'border-transparent bg-destructive/15 text-destructive'
    case 'rejected':
      return 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400'
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
