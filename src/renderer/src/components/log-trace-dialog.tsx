import { useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { JsonView } from '@/components/json-view'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import {
  clientLabel,
  fmtNum,
  fmtTime,
  outcomeBadgeClass,
  outcomeLabel,
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

/**
 * Pretty-print a JSON body; fall back to the raw string (e.g. an SSE stream, or a body
 * truncated to invalid JSON) when it isn't parseable. `isJson` drives the viewer's language.
 */
function formatBody(raw: string): { text: string; isJson: boolean } {
  const trimmed = raw.trim()
  if (!trimmed) return { text: '', isJson: false }
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true }
  } catch {
    return { text: raw, isJson: false }
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

/** A copy-to-clipboard button pinned to the top-right of a body block. */
function CopyButton({ text, t }: { text: string; t: TFunction }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const onCopy = async (): Promise<void> => {
    if (await copyText(text)) {
      setCopied(true)
      toast.success(t('toast.bodyCopied'))
      window.setTimeout(() => setCopied(false), 1500)
    } else {
      toast.error(t('toast.copyFailed'))
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onCopy}
      aria-label={t('logs.detail.copyBody')}
      className="absolute top-1.5 right-1.5 z-10 bg-background/70 text-muted-foreground backdrop-blur hover:text-foreground"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

function BodyBlock({ body, t }: { body: string; t: TFunction }): React.JSX.Element {
  const { text, isJson } = formatBody(body)
  if (!text) {
    return <p className="text-xs text-muted-foreground italic">{t('logs.detail.emptyBody')}</p>
  }
  return (
    <div className="relative overflow-hidden rounded-md border bg-muted/40">
      <CopyButton text={text} t={t} />
      <JsonView value={text} language={isJson ? 'json' : 'text'} />
    </div>
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
              <Meta label={t('logs.outcome')}>
                <Badge className={cn('font-normal', outcomeBadgeClass(row.outcome))}>
                  {outcomeLabel(t, row.outcome)}
                </Badge>
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
              <p className="text-sm font-medium">{t('logs.detail.noCaptureTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('logs.detail.noCaptureHint')}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
