import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { copyText } from '@/lib/clipboard'
import { useT } from '@/i18n'
import type { ConfigDraft } from '@/hooks/useGatewayConfig'

/** Tabs the quick-start steps can jump to (kept in sync with App's Tab union). */
export type NavigableTab = 'channels' | 'groups' | 'settings'

interface DashboardPanelProps {
  draft: ConfigDraft
  onNavigate: (tab: NavigableTab) => void
}

export function DashboardPanel({ draft, onNavigate }: DashboardPanelProps): React.JSX.Element {
  const t = useT()
  const defaultGroup = draft.groups.find((g) => g.id === draft.default_group_id)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>

      <GatewayCard t={t} />

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.overviewTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Stat label={t('dashboard.channelsCount')} value={String(draft.channels.length)} />
          <Stat label={t('dashboard.groupsCount')} value={String(draft.groups.length)} />
          <Stat
            label={t('dashboard.defaultGroup')}
            value={
              defaultGroup?.name ||
              (draft.default_group_id ? draft.default_group_id : t('common.none'))
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.quickStartTitle')}</CardTitle>
          <CardDescription>{t('dashboard.quickStartDescription')}</CardDescription>
        </CardHeader>
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
            action={{ label: t('dashboard.goGroups'), onClick: () => onNavigate('groups') }}
          />
          <Step
            n={3}
            title={t('dashboard.step3Title')}
            desc={t('dashboard.step3Desc')}
            action={{ label: t('dashboard.goSettings'), onClick: () => onNavigate('settings') }}
          />
          <Step n={4} title={t('dashboard.step4Title')} desc={t('dashboard.step4Desc')} />
        </CardContent>
      </Card>
    </div>
  )
}

function GatewayCard({ t }: { t: (key: string) => string }): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState('')
  const [copied, setCopied] = useState(false)

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
        <p className="mt-1.5 text-sm text-muted-foreground">{t('dashboard.apiKeyNote')}</p>
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
