import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  clientLabel,
  fmtNum,
  fmtTime,
  isInProgress,
  outcomeBadgeClass,
  outcomeLabel,
  phaseLabel,
  streamLabel
} from '@/lib/log-format'
import { useT } from '@/i18n'
import type { TFunction } from '@/i18n'
import type { LogRow, TraceAttempt, TraceRecord } from '../../../shared/gateway'

interface LogTraceDialogProps {
  /** The clicked row; non-null drives the dialog open. Its summary shows even before the trace loads. */
  row: LogRow | null
  /** Raw capture for `row`, or null when none was recorded (see queryTrace). */
  trace: TraceRecord | null
  loading: boolean
  /** Resolve a group id to its display name (shared with the log table). */
  groupNameOf: (id: string | null) => string
  onClose: () => void
}

/** Pretty-print a JSON body; fall back to the raw string (e.g. an SSE stream) when it isn't JSON. */
function prettyBody(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return raw
  }
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

function HeadersTable({
  headers
}: {
  headers: Record<string, string[]> | null
}): React.JSX.Element | null {
  const entries = headers ? Object.entries(headers) : []
  if (entries.length === 0) return null
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-xs">
        <tbody>
          {entries.map(([name, values]) => (
            <tr key={name} className="border-b last:border-b-0">
              <td className="w-1/3 border-r bg-muted/40 px-2 py-1 font-mono align-top break-all">
                {name}
              </td>
              <td className="px-2 py-1 font-mono break-all">{values.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BodyBlock({ body, t }: { body: string; t: TFunction }): React.JSX.Element {
  const text = prettyBody(body)
  if (!text) {
    return <p className="text-xs text-muted-foreground italic">{t('logs.detail.emptyBody')}</p>
  }
  return (
    <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-all">
      {text}
    </pre>
  )
}

/** One field of the top summary line. */
function Meta({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs break-all">{children}</dd>
    </div>
  )
}

function AttemptCard({
  attempt,
  index,
  t
}: {
  attempt: TraceAttempt
  index: number
  t: TFunction
}): React.JSX.Element {
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t('logs.detail.attempt', { n: index + 1 })}</span>
        {attempt.channel_id ? (
          <span className="font-mono text-xs text-muted-foreground">{attempt.channel_id}</span>
        ) : null}
        <Badge
          className={cn(
            'ml-auto font-normal',
            attempt.success ? outcomeBadgeClass('success') : outcomeBadgeClass('failed')
          )}
        >
          {attempt.success
            ? t('logs.outcomes.success')
            : attempt.failure_class || t('logs.outcomes.failed')}
        </Badge>
      </div>

      <Section title={t('logs.detail.upstreamRequest')}>
        {attempt.upstream_url ? (
          <p className="font-mono text-xs break-all">
            <span className="text-muted-foreground">{t('logs.detail.url')}: </span>
            {attempt.upstream_url}
          </p>
        ) : null}
        <HeadersTable headers={attempt.req_headers} />
        <BodyBlock body={attempt.req_body} t={t} />
      </Section>

      <Section
        title={`${t('logs.detail.upstreamResponse')} · ${t('logs.status')} ${attempt.resp_status || '—'}`}
      >
        <HeadersTable headers={attempt.resp_headers} />
        <BodyBlock body={attempt.resp_body} t={t} />
        {attempt.resp_body_truncated ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">{t('logs.detail.truncated')}</p>
        ) : null}
      </Section>
    </div>
  )
}

export function LogTraceDialog({
  row,
  trace,
  loading,
  groupNameOf,
  onClose
}: LogTraceDialogProps): React.JSX.Element {
  const t = useT()

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="grid shrink-0 gap-3 border-b px-6 py-4 pr-10">
          <DialogTitle>{t('logs.detail.title')}</DialogTitle>
          {row ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              <Meta label={t('logs.time')}>{fmtTime(row.at)}</Meta>
              <Meta label={isInProgress(row) ? t('logs.phase') : t('logs.outcome')}>
                {isInProgress(row) ? (
                  <Badge className={cn('font-normal', outcomeBadgeClass(null))}>
                    {phaseLabel(t, row.phase)}
                  </Badge>
                ) : (
                  <Badge className={cn('font-normal', outcomeBadgeClass(row.outcome))}>
                    {outcomeLabel(t, row.outcome)}
                  </Badge>
                )}
              </Meta>
              <Meta label={t('logs.status')}>{fmtNum(row.http_status)}</Meta>
              <Meta label={t('logs.channel')}>{row.channel_name || '—'}</Meta>
              <Meta label={t('logs.model')}>{row.model || '—'}</Meta>
              <Meta label={t('logs.clientType')}>{clientLabel(t, row.client_type)}</Meta>
              <Meta label={t('logs.group')}>{groupNameOf(row.group_id)}</Meta>
              <Meta label={t('logs.stream')}>{streamLabel(t, row.stream)}</Meta>
              <Meta label={t('logs.upstreamsTried')}>{fmtNum(row.upstreams_tried)}</Meta>
              <Meta label={t('logs.sessionId')}>{row.session_id || '—'}</Meta>
              <Meta label={t('logs.detail.reqId')}>{row.req_id}</Meta>
            </dl>
          ) : null}
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : trace ? (
            <>
              {trace.stripped_usage || trace.committed_then_failed ? (
                <div className="grid gap-1 text-xs text-muted-foreground">
                  {trace.committed_then_failed ? (
                    <p>{t('logs.detail.committedThenFailed')}</p>
                  ) : null}
                  {trace.stripped_usage ? <p>{t('logs.detail.strippedUsage')}</p> : null}
                </div>
              ) : null}

              <Section title={t('logs.detail.clientRequest')}>
                <HeadersTable headers={trace.req_headers} />
                <BodyBlock body={trace.req_body} t={t} />
                <p className="text-[11px] text-muted-foreground">
                  {t('logs.detail.headersRedacted')}
                </p>
              </Section>

              {trace.attempts.map((attempt, i) => (
                <AttemptCard key={i} attempt={attempt} index={i} t={t} />
              ))}
            </>
          ) : (
            <div className="grid gap-1 py-6 text-center">
              <p className="text-sm font-medium">
                {row && isInProgress(row)
                  ? t('logs.detail.inProgressTitle')
                  : t('logs.detail.noCaptureTitle')}
              </p>
              <p className="text-sm text-muted-foreground">
                {row && isInProgress(row)
                  ? t('logs.detail.inProgressHint')
                  : t('logs.detail.noCaptureHint')}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
