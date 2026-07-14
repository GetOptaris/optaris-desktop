import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { copyText } from '@/lib/clipboard'
import { useT } from '@/i18n'
import { ConnectClientsCard } from '@/components/connect-clients-card'
import { DEFAULT_GROUP_ID } from '../../../shared/gateway'
import type { ConfigDraft } from '@/hooks/useGatewayConfig'

/** Tabs the quick-start steps can jump to (kept in sync with App's Tab union). */
export type NavigableTab = 'channels' | 'groups' | 'logs' | 'settings'

interface DashboardPanelProps {
  draft: ConfigDraft
  onNavigate: (tab: NavigableTab) => void
  /** Reflect a regenerated gateway key back into the shared draft (see useGatewayConfig). */
  onRegenerateApiKey: (key: string) => void
}

export function DashboardPanel({
  draft,
  onNavigate,
  onRegenerateApiKey
}: DashboardPanelProps): React.JSX.Element {
  const t = useT()
  const defaultGroup = draft.groups.find((g) => g.id === draft.default_group_id)
  // The built-in group carries an empty wire name; localize it. Count only user-created
  // groups so an install with just the built-in group reads "0", not "1".
  const activeGroupName =
    draft.default_group_id === DEFAULT_GROUP_ID
      ? t('groups.defaultName')
      : defaultGroup?.name || (draft.default_group_id ? draft.default_group_id : t('common.none'))
  const userGroupCount = draft.groups.filter((g) => g.id !== DEFAULT_GROUP_ID).length

  // Quick-start step 3 offers a shortcut down to the one-click connect section (a sibling
  // card in the same scroll container), so the user doesn't have to know to scroll for it.
  const connectRef = useRef<HTMLDivElement>(null)
  const scrollToConnect = (): void =>
    connectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="flex flex-col gap-4">
      <QuickStartCard t={t} onNavigate={onNavigate} onScrollToConnect={scrollToConnect} />

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.overviewTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Stat label={t('dashboard.channelsCount')} value={String(draft.channels.length)} />
          <Stat label={t('dashboard.groupsCount')} value={String(userGroupCount)} />
          <Stat label={t('dashboard.defaultGroup')} value={activeGroupName} />
        </CardContent>
      </Card>

      <div ref={connectRef}>
        <ConnectClientsCard />
      </div>

      <GatewayCard t={t} apiKey={draft.gateway_api_key} onRegenerate={onRegenerateApiKey} />
    </div>
  )
}

/** The collapsible quick-start guide. Collapse state persists in localStorage. */
const QUICK_START_STORAGE_KEY = 'optaris.dashboard.quickStartCollapsed'

/** Read the persisted collapse state; anything but the literal 'true' means expanded. */
function readQuickStartCollapsed(): boolean {
  try {
    return localStorage.getItem(QUICK_START_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function QuickStartCard({
  t,
  onNavigate,
  onScrollToConnect
}: {
  t: (key: string) => string
  onNavigate: (tab: NavigableTab) => void
  onScrollToConnect: () => void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(readQuickStartCollapsed)

  const toggle = (): void => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(QUICK_START_STORAGE_KEY, String(next))
      } catch {
        /* persistence is best-effort */
      }
      return next
    })
  }

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={t('dashboard.quickStartToggle')}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <CardTitle>{t('dashboard.quickStartTitle')}</CardTitle>
          {collapsed ? (
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
        </button>
      </CardHeader>
      {collapsed ? null : (
        <CardContent className="grid gap-4">
          <Step
            n={1}
            title={t('dashboard.step1Title')}
            desc={t('dashboard.step1Desc')}
            action={{ label: t('dashboard.goChannels'), onClick: () => onNavigate('channels') }}
          />
          <Step
            n={2}
            title={t('dashboard.step2Title')}
            desc={t('dashboard.step2Desc')}
            action={{ label: t('dashboard.goConnect'), onClick: onScrollToConnect }}
          />
          <Step
            n={3}
            title={t('dashboard.step3Title')}
            desc={t('dashboard.step3Desc')}
            action={{ label: t('dashboard.goLogs'), onClick: () => onNavigate('logs') }}
          />
        </CardContent>
      )}
    </Card>
  )
}

/** Mask a key for at-rest display: a fixed run of bullets, revealing nothing. */
function maskKey(key: string): string {
  return key ? '•'.repeat(24) : ''
}

function GatewayCard({
  t,
  apiKey,
  onRegenerate: onRegenerateKey
}: {
  t: (key: string, vars?: Record<string, string | number>) => string
  apiKey: string
  onRegenerate: (key: string) => void
}): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState('')
  const [copied, setCopied] = useState(false)

  // The regenerate action persists the key directly (bypassing the shared draft/Save) and
  // reflects it back into the draft via onRegenerateKey rather than triggering a reload —
  // that keeps any unsaved edits on the Channels/Groups tabs intact. So `apiKey` (from the
  // draft) stays the single source of truth and survives this card unmounting on tab switch.
  const key = apiKey

  const [revealed, setRevealed] = useState(false)
  const [keyCopied, setKeyCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    let active = true
    window.api.gateway
      .getBaseUrl()
      .then((url) => {
        if (active) setBaseUrl(url)
      })
      .catch(() => {
        /* base URL is best-effort; leave it blank if the gateway isn't up yet */
      })
    return () => {
      active = false
    }
  }, [])

  const onCopy = async (): Promise<void> => {
    if (!baseUrl) return
    if (await copyText(baseUrl)) {
      setCopied(true)
      toast.success(t('toast.baseUrlCopied'))
      window.setTimeout(() => setCopied(false), 1500)
    } else {
      toast.error(t('toast.copyFailed'))
    }
  }

  const onCopyKey = async (): Promise<void> => {
    if (!key) return
    if (await copyText(key)) {
      setKeyCopied(true)
      toast.success(t('toast.apiKeyCopied'))
      window.setTimeout(() => setKeyCopied(false), 1500)
    } else {
      toast.error(t('toast.copyFailed'))
    }
  }

  const onRegenerate = async (): Promise<void> => {
    setRegenerating(true)
    try {
      const { key: next, reapplied, failed } = await window.api.gateway.regenerateApiKey()
      onRegenerateKey(next)
      setRevealed(true)
      if (failed.length > 0) {
        // Some connected clients still hold the stale key — name them so the user can
        // re-connect those by hand (the rest were re-applied automatically).
        const clients = failed.map((id) => t(`connect.clients.${id}`)).join(', ')
        toast.warning(t('toast.apiKeyRegeneratedPartial', { clients }))
      } else if (reapplied.length > 0) {
        toast.success(t('toast.apiKeyRegeneratedReapplied', { count: reapplied.length }))
      } else {
        toast.success(t('toast.apiKeyRegenerated'))
      }
    } catch {
      toast.error(t('toast.apiKeyRegenerateFailed'))
    } finally {
      setRegenerating(false)
      setConfirming(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.gatewayTitle')}</CardTitle>
        <CardDescription>{t('dashboard.gatewayDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-xs font-medium text-muted-foreground">{t('dashboard.baseUrl')}</div>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 rounded bg-muted px-3 py-2 font-mono text-sm break-all">
            {baseUrl || t('dashboard.starting')}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={onCopy}
            disabled={!baseUrl}
            aria-label={t('dashboard.baseUrl')}
          >
            {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          </Button>
        </div>

        <div className="mt-4 text-xs font-medium text-muted-foreground">
          {t('dashboard.apiKeyLabel')}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 rounded bg-muted px-3 py-2 font-mono text-sm break-all">
            {key ? (revealed ? key : maskKey(key)) : t('dashboard.starting')}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => setRevealed((v) => !v)}
            disabled={!key}
            aria-label={t(revealed ? 'dashboard.apiKeyHide' : 'dashboard.apiKeyReveal')}
          >
            {revealed ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={onCopyKey}
            disabled={!key}
            aria-label={t('dashboard.apiKeyLabel')}
          >
            {keyCopied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => setConfirming(true)}
            disabled={!key || regenerating}
            aria-label={t('dashboard.apiKeyRegenerate')}
          >
            <RefreshCwIcon className={cn('size-4', regenerating && 'animate-spin')} />
          </Button>
        </div>

        {confirming ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t('dashboard.apiKeyRegenerateConfirm')}
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              {t('dashboard.apiKeyRegenerate')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={regenerating}
            >
              {t('dashboard.apiKeyRegenerateCancel')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="grid gap-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Step({
  n,
  title,
  desc,
  action
}: {
  n: number
  title: string
  desc: string
  action?: { label: string; onClick: () => void }
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </div>
      <div className="grid flex-1 gap-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      {action ? (
        <Button type="button" variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
