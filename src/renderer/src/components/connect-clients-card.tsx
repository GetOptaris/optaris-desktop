import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCwIcon, ServerIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import type { ClientId, ClientStatus } from '../../../shared/gateway'

/** Fixed display order, matching how the four clients are introduced to the user. */
const ORDER: ClientId[] = ['claude_code', 'claude_desktop', 'codex', 'gemini_cli']

/**
 * Dashboard card that shows, per client, the gateway address it currently points at and a
 * one-click "Connect" that writes the client's config (via window.api.gateway.applyClient).
 * Status is tri-state: muted when not installed / unsupported, amber when installed but not
 * yet pointed here, green once connected.
 */
export function ConnectClientsCard(): React.JSX.Element {
  const t = useT()
  const [statuses, setStatuses] = useState<ClientStatus[] | null>(null)
  const [applyingId, setApplyingId] = useState<ClientId | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true)
    try {
      const next = await window.api.gateway.listClients()
      setStatuses(next)
    } catch {
      /* best-effort; leave the previous list (or the loading state) in place */
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    window.api.gateway
      .listClients()
      .then((next) => {
        if (active) setStatuses(next)
      })
      .catch(() => {
        /* best-effort; the card just stays in its loading state if the gateway isn't up */
      })
    return () => {
      active = false
    }
  }, [])

  const onApply = useCallback(
    async (id: ClientId): Promise<void> => {
      const name = t(`connect.clients.${id}`)
      setApplyingId(id)
      try {
        const res = await window.api.gateway.applyClient(id)
        if (res.ok) {
          toast.success(t('connect.applied', { client: name }))
          await refresh()
        } else {
          toast.error(t('connect.applyFailed', { client: name }), { description: res.message })
        }
      } catch {
        toast.error(t('connect.applyFailed', { client: name }))
      } finally {
        setApplyingId(null)
      }
    },
    [t, refresh]
  )

  const byId = new Map((statuses ?? []).map((s) => [s.id, s]))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="grid gap-1.5">
            <CardTitle className="flex items-center gap-2">
              <ServerIcon className="size-4" />
              {t('connect.title')}
            </CardTitle>
            <CardDescription>{t('connect.description')}</CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={refreshing}
            aria-label={t('connect.refresh')}
            title={t('connect.refresh')}
          >
            <RefreshCwIcon className={cn('size-4', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {statuses === null ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : (
          ORDER.map((id) => {
            const status = byId.get(id)
            if (!status) return null
            return (
              <ClientRow
                key={id}
                t={t}
                status={status}
                applying={applyingId === id}
                onApply={() => onApply(id)}
              />
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

/** Resolve a client's tri-state tone + the secondary status line to render. */
function describe(
  t: ReturnType<typeof useT>,
  status: ClientStatus
): { tone: 'green' | 'amber' | 'muted'; line: string } {
  if (!status.supported) return { tone: 'muted', line: t('connect.unsupported') }
  if (status.connected)
    return { tone: 'green', line: status.current_base_url ?? t('connect.connected') }
  if (!status.detected) return { tone: 'muted', line: t('connect.notInstalled') }
  return { tone: 'amber', line: status.current_base_url ?? t('connect.notConnected') }
}

const DOT: Record<'green' | 'amber' | 'muted', string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  muted: 'bg-muted-foreground/40'
}

function ClientRow({
  t,
  status,
  applying,
  onApply
}: {
  t: ReturnType<typeof useT>
  status: ClientStatus
  applying: boolean
  onApply: () => void
}): React.JSX.Element {
  const { tone, line } = describe(t, status)
  const name = t(`connect.clients.${status.id}`)
  // A client can only be connected once it's both supported on this OS and detected on
  // disk — otherwise applying would silently create config dirs for an app that isn't
  // there. In those cases show a disabled button labelled with the reason.
  const unavailable = !status.supported ? 'unsupported' : !status.detected ? 'notInstalled' : null

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn('size-2 shrink-0 rounded-full', DOT[tone])} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            {name}
            {status.id === 'claude_desktop' ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                {t('connect.experimental')}
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">{line}</div>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant={unavailable ? 'outline' : status.connected ? 'outline' : 'default'}
        onClick={onApply}
        disabled={unavailable !== null || applying}
      >
        {applying ? (
          <RefreshCwIcon className="size-4 animate-spin" />
        ) : unavailable === 'notInstalled' ? (
          t('connect.notInstalled')
        ) : unavailable === 'unsupported' ? (
          t('connect.unsupported')
        ) : status.connected ? (
          t('connect.reapply')
        ) : (
          t('connect.apply')
        )}
      </Button>
    </div>
  )
}
