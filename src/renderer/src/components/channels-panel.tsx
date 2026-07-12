import { CopyIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ModelsInput } from '@/components/models-input'
import { useT, type TFunction } from '@/i18n'
import type { ChannelDraft } from '@/hooks/useGatewayConfig'

interface ChannelsPanelProps {
  channels: ChannelDraft[]
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<ChannelDraft>) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
}

export function ChannelsPanel({
  channels,
  onAdd,
  onUpdate,
  onDuplicate,
  onRemove
}: ChannelsPanelProps): React.JSX.Element {
  const t = useT()
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('channels.description')}</p>
        <Button type="button" size="sm" onClick={onAdd}>
          <PlusIcon className="size-4" />
          {t('channels.add')}
        </Button>
      </div>

      {channels.length === 0 ? (
        <EmptyState onAdd={onAdd} t={t} />
      ) : (
        channels.map((c) => (
          <ChannelCard
            key={c.id}
            channel={c}
            onUpdate={onUpdate}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
            t={t}
          />
        ))
      )}
    </div>
  )
}

function EmptyState({ onAdd, t }: { onAdd: () => void; t: TFunction }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <p className="text-sm text-muted-foreground">{t('channels.empty')}</p>
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <PlusIcon className="size-4" />
        {t('channels.addFirst')}
      </Button>
    </div>
  )
}

function ChannelCard({
  channel,
  onUpdate,
  onDuplicate,
  onRemove,
  t
}: {
  channel: ChannelDraft
  onUpdate: (id: string, patch: Partial<ChannelDraft>) => void
  onDuplicate: (id: string) => void
  onRemove: (id: string) => void
  t: TFunction
}): React.JSX.Element {
  const { id } = channel

  return (
    <Card id={`channel-${id}`}>
      <CardHeader>
        <CardTitle className="truncate">{channel.name || t('channels.unnamed')}</CardTitle>
        <CardAction className="flex items-center gap-3">
          <Label htmlFor={`${id}-enabled`} className="text-xs text-muted-foreground">
            {t('channels.enabled')}
          </Label>
          <Switch
            id={`${id}-enabled`}
            checked={channel.enabled}
            onCheckedChange={(checked) => onUpdate(id, { enabled: checked })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={() => onDuplicate(id)}
            aria-label={t('channels.duplicate')}
            title={t('channels.duplicate')}
          >
            <CopyIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(id)}
            aria-label={t('channels.delete')}
            title={t('channels.delete')}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('channels.name')} htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={channel.name}
              onChange={(e) => onUpdate(id, { name: e.target.value })}
              placeholder={t('channels.namePlaceholder')}
            />
          </Field>
          <Field label={t('channels.baseUrl')} htmlFor={`${id}-base-url`}>
            <Input
              id={`${id}-base-url`}
              value={channel.base_url}
              onChange={(e) => onUpdate(id, { base_url: e.target.value })}
              placeholder={t('channels.baseUrlPlaceholder')}
            />
          </Field>
        </div>

        <Field
          label={t('channels.apiKey')}
          htmlFor={`${id}-api-key`}
          hint={
            channel.has_api_key
              ? t('channels.apiKeyStoredHint', { preview: channel.api_key_preview ?? '' })
              : undefined
          }
        >
          <Input
            id={`${id}-api-key`}
            type="password"
            autoComplete="off"
            value={channel.api_key_input}
            onChange={(e) => onUpdate(id, { api_key_input: e.target.value })}
            placeholder={
              channel.has_api_key
                ? t('channels.apiKeySavedPlaceholder')
                : t('channels.apiKeyEnterPlaceholder')
            }
          />
        </Field>

        <Field label={t('channels.models')} htmlFor={`${id}-models`}>
          <ModelsInput
            id={`${id}-models`}
            value={channel.models}
            onChange={(models) => onUpdate(id, { models })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('channels.priceWeight')}
            htmlFor={`${id}-price-weight`}
            hint={t('channels.priceWeightHint')}
          >
            <Input
              id={`${id}-price-weight`}
              type="number"
              inputMode="decimal"
              step="0.1"
              value={channel.price_weight ?? ''}
              onChange={(e) => {
                const v = e.target.value
                onUpdate(id, { price_weight: v === '' ? undefined : Number(v) })
              }}
              placeholder={t('channels.priceWeightPlaceholder')}
            />
          </Field>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
