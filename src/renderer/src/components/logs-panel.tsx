import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
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
import { LogTraceDialog } from './log-trace-dialog'
import { DEFAULT_GROUP_ID } from '../../../shared/gateway'
import type { DisplayGroup, LogQuery, LogRow, TraceRecord } from '../../../shared/gateway'

const ALL = '__all__'
const OUTCOMES = ['success', 'failed', 'client_canceled', 'rejected'] as const

const QUERY_LIMIT = 200

export function LogsPanel(): React.JSX.Element {
  const t = useT()
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string>(ALL)
  const [model, setModel] = useState('')
  // Group id -> name, loaded once from config so the table/detail render a readable group name
  // instead of the raw grp_… id.
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  // Row whose trace is being viewed (drives the detail dialog), plus its loaded capture.
  const [selected, setSelected] = useState<LogRow | null>(null)
  const [trace, setTrace] = useState<TraceRecord | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  // Monotonic token for the in-flight trace fetch. Each open/close bumps it; a resolved
  // fetch only applies its result when its token is still current, so a slow query for a
  // previously clicked row can't overwrite the trace of the row now on screen.
  const traceToken = useRef(0)

  // Drives both the trigger label (Base UI's `items`) and the dropdown options, so a
  // closed Select shows the localized label instead of the raw value (see issue #4).
  const outcomeItems = useMemo<Record<string, React.ReactNode>>(
    () => ({
      [ALL]: t('logs.allOutcomes'),
      ...Object.fromEntries(OUTCOMES.map((o) => [o, outcomeLabel(t, o)]))
    }),
    [t]
  )

  // Resolve a group id to its display name; '—' when absent. The built-in group's wire name
  // is empty (localized here), and an unnamed user group has an empty name too — so fall back
  // on the raw id with `||` (not `??`) so an empty string never renders as a blank cell.
  const groupNameOf = useMemo(() => {
    const byId = new Map(groups.map((g) => [g.id, g.name]))
    return (id: string | null): string => {
      if (!id) return '—'
      if (id === DEFAULT_GROUP_ID) return t('groups.defaultName')
      return byId.get(id) || id
    }
  }, [groups, t])

  const runQuery = useCallback(async (filters: { outcome: string; model: string }) => {
    setLoading(true)
    setError(null)
    try {
      const query: LogQuery = { limit: QUERY_LIMIT }
      if (filters.outcome !== ALL) query.outcome = filters.outcome
      if (filters.model.trim()) query.model = filters.model.trim()
      setRows(await window.api.gateway.queryLogs(query))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Run the first query on mount (reads the gateway's log DB via IPC — an external
  // system), so the rule's synchronous-setState guard is a false positive here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runQuery({ outcome: ALL, model: '' })
  }, [runQuery])

  // Load group names once so group_id renders as a name (config is an external system).
  useEffect(() => {
    window.api.gateway
      .getConfig()
      .then((c) => setGroups(c.groups))
      .catch(() => setGroups([]))
  }, [])

  const refresh = (): void => void runQuery({ outcome, model })

  const onOutcomeChange = (value: string | null): void => {
    const next = value ?? ALL
    setOutcome(next)
    void runQuery({ outcome: next, model })
  }

  // Open the detail dialog for a row and fetch its raw capture (may resolve to null when
  // capture wasn't recorded — the dialog shows a hint in that case).
  const openTrace = (row: LogRow): void => {
    const token = ++traceToken.current
    setSelected(row)
    setTrace(null)
    setTraceLoading(true)
    window.api.gateway
      .queryTrace({ req_id: row.req_id, at: row.at })
      .then((r) => {
        if (token === traceToken.current) setTrace(r)
      })
      .catch(() => {
        if (token === traceToken.current) setTrace(null)
      })
      .finally(() => {
        if (token === traceToken.current) setTraceLoading(false)
      })
  }

  // Bump the token so a still-in-flight fetch for the closed row is ignored when it lands.
  const closeTrace = (): void => {
    traceToken.current++
    setSelected(null)
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/*
        Pinned filter bar. The shared content scroller (App.tsx) has p-6 padding, so the
        negative -mx-6/-mt-6 + matching px-6/pt-6 bleed the bar's background to the very
        top and full width; sticky top-0 then keeps it flush while rows scroll under it.
      */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 flex flex-wrap items-center gap-2 border-b bg-background px-6 pt-6 pb-3">
        <Select value={outcome} onValueChange={onOutcomeChange} items={outcomeItems}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder={t('logs.outcomePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(outcomeItems).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') refresh()
          }}
          placeholder={t('logs.filterModel')}
          className="w-56"
        />

        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCwIcon className={cn('size-4', loading && 'animate-spin')} />
          {t('logs.refresh')}
        </Button>

        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? t('logs.row') : t('logs.rows')}
        </span>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>{t('logs.time')}</TableHead>
              <TableHead>{t('logs.outcome')}</TableHead>
              <TableHead className="text-right">{t('logs.status')}</TableHead>
              <TableHead>{t('logs.model')}</TableHead>
              <TableHead>{t('logs.channel')}</TableHead>
              <TableHead>{t('logs.clientType')}</TableHead>
              <TableHead>{t('logs.group')}</TableHead>
              <TableHead>{t('logs.stream')}</TableHead>
              <TableHead>{t('logs.sessionId')}</TableHead>
              <TableHead className="text-right">{t('logs.upstreamsTried')}</TableHead>
              <TableHead className="text-right">{t('logs.tokensIn')}</TableHead>
              <TableHead className="text-right">{t('logs.cacheRead')}</TableHead>
              <TableHead className="text-right">{t('logs.cacheWrite5m')}</TableHead>
              <TableHead className="text-right">{t('logs.cacheWrite1h')}</TableHead>
              <TableHead className="text-right">{t('logs.tokensOut')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="h-24 text-center text-sm text-muted-foreground">
                  {loading ? t('common.loading') : t('logs.empty')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.req_id}
                  onClick={() => openTrace(r)}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {fmtTime(r.at)}
                  </TableCell>
                  <TableCell>
                    <Badge className={cn('font-normal', outcomeBadgeClass(r.outcome))}>
                      {outcomeLabel(t, r.outcome)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(r.http_status)}</TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs">
                    {r.model ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{r.channel_name ?? '—'}</TableCell>
                  <TableCell>{clientLabel(t, r.client_type)}</TableCell>
                  <TableCell className="max-w-32 truncate">{groupNameOf(r.group_id)}</TableCell>
                  <TableCell>{streamLabel(t, r.stream)}</TableCell>
                  <TableCell className="max-w-40 truncate font-mono text-xs">
                    {r.session_id ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(r.upstreams_tried)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(r.input_tokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(r.cache_read_tokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(r.cache_write_5m_tokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(r.cache_write_1h_tokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(r.output_tokens)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <LogTraceDialog
        row={selected}
        trace={trace}
        loading={traceLoading}
        groupNameOf={groupNameOf}
        onClose={closeTrace}
      />
    </div>
  )
}
