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
  fmtElapsed,
  fmtNum,
  fmtTime,
  isInProgress,
  outcomeBadgeClass,
  outcomeLabel,
  phaseLabel,
  streamLabel
} from '@/lib/log-format'
import { useT } from '@/i18n'
import { LogTraceDialog } from './log-trace-dialog'
import { DEFAULT_GROUP_ID } from '../../../shared/gateway'
import type { DisplayGroup, LogQuery, LogRow, TraceRecord } from '../../../shared/gateway'

const ALL = '__all__'
// 'in_progress' is a synthetic filter (maps to outcome IS NULL in the main process);
// the rest are real stored outcomes. Order drives the dropdown.
const OUTCOMES = [
  'in_progress',
  'success',
  'failed',
  'client_canceled',
  'rejected',
  'interrupted'
] as const

const QUERY_LIMIT = 200

// While the panel is open, re-query on this cadence so in-flight requests appear and
// advance without a manual refresh (issue #22). Cheap: a read-only WAL SELECT.
const LIVE_REFRESH_MS = 1500

export function LogsPanel(): React.JSX.Element {
  const t = useT()
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Wall-clock used to render "how long has this in-flight request been running". Ticks
  // with the live-refresh interval so elapsed times advance without a per-second timer.
  const [now, setNow] = useState(() => Date.now())
  const [outcome, setOutcome] = useState<string>(ALL)
  const [model, setModel] = useState('')
  // Group id -> name, loaded once from config so the table/detail render a readable group name
  // instead of the raw grp_… id.
  const [groups, setGroups] = useState<DisplayGroup[]>([])
  // Row whose trace is being viewed (drives the detail dialog), plus its loaded capture.
  const [selected, setSelected] = useState<LogRow | null>(null)
  const [trace, setTrace] = useState<TraceRecord | null>(null)
  const [traceLoading, setTraceLoading] = useState(false)
  // Last-applied filters, so background polling reuses what the user actually applied
  // (the model box only applies on Enter/Refresh) instead of half-typed input.
  const appliedFilters = useRef<{ outcome: string; model: string }>({ outcome: ALL, model: '' })

  // Drives both the trigger label (Base UI's `items`) and the dropdown options, so a
  // closed Select shows the localized label instead of the raw value (see issue #4).
  const outcomeItems = useMemo<Record<string, React.ReactNode>>(
    () => ({
      [ALL]: t('logs.allOutcomes'),
      ...Object.fromEntries(
        OUTCOMES.map((o) => [o, o === 'in_progress' ? t('logs.inProgress') : outcomeLabel(t, o)])
      )
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

  const runQuery = useCallback(
    async (filters: { outcome: string; model: string }, opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false
      appliedFilters.current = filters
      if (!silent) {
        setLoading(true)
        setError(null)
      }
      try {
        const query: LogQuery = { limit: QUERY_LIMIT }
        if (filters.outcome !== ALL) query.outcome = filters.outcome
        if (filters.model.trim()) query.model = filters.model.trim()
        setRows(await window.api.gateway.queryLogs(query))
        if (silent) setError(null) // a good poll clears a stale transient error
      } catch (e) {
        // A failed background poll keeps the last good rows on screen instead of
        // flashing an error; only explicit (non-silent) queries surface failures.
        if (!silent) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!silent) setLoading(false)
      }
    },
    []
  )

  // Run the first query on mount (reads the gateway's log DB via IPC — an external
  // system), so the rule's synchronous-setState guard is a false positive here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runQuery({ outcome: ALL, model: '' })
  }, [runQuery])

  // Live refresh: while the panel is mounted, silently re-run the last-applied query on
  // an interval so in-flight requests appear and advance without a manual refresh. The
  // panel unmounts on tab switch (App.tsx), which clears the interval. Skips when the
  // window is hidden or a poll is still in flight.
  useEffect(() => {
    let inFlight = false
    const id = setInterval(() => {
      if (document.hidden) return
      setNow(Date.now()) // advance elapsed timers even if a poll is still running
      if (inFlight) return
      inFlight = true
      void runQuery(appliedFilters.current, { silent: true }).finally(() => {
        inFlight = false
      })
    }, LIVE_REFRESH_MS)
    return () => clearInterval(id)
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

  // Open the detail dialog for a row; the effect below fetches (and, while it's in progress,
  // keeps refreshing) its capture.
  const openTrace = (row: LogRow): void => {
    setSelected(row)
    setTrace(null)
    setTraceLoading(true)
  }

  const closeTrace = (): void => {
    setSelected(null)
  }

  // Freshest state of the open row: the background list poll keeps `rows` current, so look the
  // selected row up by id to reflect its latest phase/outcome (and to notice when it finishes).
  // Falls back to the originally-clicked row if it scrolled out of the current page.
  const liveRow = useMemo(
    () => (selected ? (rows.find((r) => r.req_id === selected.req_id) ?? selected) : null),
    [rows, selected]
  )
  const selectedInProgress = liveRow != null && isInProgress(liveRow)

  // Load the open row's trace, and while it's still in progress keep re-fetching so the
  // client/upstream payloads fill in as each step completes (the gateway serves a live partial
  // snapshot until then). A finished row's capture is immutable, so once it completes we do one
  // last fetch (which picks up the final archive) and stop polling.
  useEffect(() => {
    if (!selected) return
    let active = true
    const load = (): void => {
      window.api.gateway
        .queryTrace({ req_id: selected.req_id, at: selected.at })
        .then((r) => {
          if (active) setTrace(r)
        })
        .catch(() => {
          if (active) setTrace(null)
        })
        .finally(() => {
          if (active) setTraceLoading(false)
        })
    }
    load()
    if (!selectedInProgress) {
      return () => {
        active = false
      }
    }
    const id = setInterval(load, LIVE_REFRESH_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [selected, selectedInProgress])

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
                    {isInProgress(r) ? (
                      // Live row: the badge shows the current stage + how long it's been
                      // running, so a stuck request tells you which step it's stuck on.
                      <Badge className={cn('font-normal', outcomeBadgeClass(null))}>
                        {phaseLabel(t, r.phase)} · {fmtElapsed(r.at, now)}
                      </Badge>
                    ) : (
                      <Badge className={cn('font-normal', outcomeBadgeClass(r.outcome))}>
                        {outcomeLabel(t, r.outcome)}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(r.http_status)}</TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs">
                    {r.model ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-40 truncate">{r.channel_name || '—'}</TableCell>
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
        row={liveRow}
        trace={trace}
        loading={traceLoading}
        groupNameOf={groupNameOf}
        onClose={closeTrace}
      />
    </div>
  )
}
