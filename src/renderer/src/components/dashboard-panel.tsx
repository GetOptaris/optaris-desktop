import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, RefreshCwIcon } from 'lucide-react'
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

      <GatewayCard t={t} apiKey={draft.gateway_api_key} />

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

/** Mask a key for at-rest display: a fixed run of bullets, revealing nothing. */
function maskKey(key: string): string {
  return key ? '•'.repeat(24) : ''
}

function GatewayCard({
  t,
  apiKey
}: {
  t: (key: string) => string
  apiKey: string
}): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState('')
  const [copied, setCopied] = useState(false)

  // The regenerate action writes the key directly (bypassing the shared draft/Save), so
  // we hold the new value locally rather than reloading — that keeps any unsaved edits on
  // the Channels/Groups tabs intact. `override` wins over the draft-provided prop once set.
  const [override, setOverride] = useState<string | null>(null)
  const key = override ?? apiKey

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
      const next = await window.api.gateway.regenerateApiKey()
      setOverride(next)
      setRevealed(true)
      toast.success(t('toast.apiKeyRegenerated'))
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
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('dashboard.apiKeyNote')}</p>

        <div className="mt-3">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
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
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={!key}
            >
              <RefreshCwIcon className="size-4" />
              {t('dashboard.apiKeyRegenerate')}
            </Button>
          )}
        </div>
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
