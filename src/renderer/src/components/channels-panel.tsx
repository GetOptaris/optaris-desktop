import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ModelsInput } from '@/components/models-input'
import type { ChannelDraft } from '@/hooks/useGatewayConfig'

interface ChannelsPanelProps {
  channels: ChannelDraft[]
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<ChannelDraft>) => void
  onRemove: (id: string) => void
}

export function ChannelsPanel({
  channels,
  onAdd,
  onUpdate,
  onRemove
}: ChannelsPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Upstream providers the gateway can route to.
        </p>
        <Button type="button" size="sm" onClick={onAdd}>
          <PlusIcon className="size-4" />
          Add channel
        </Button>
      </div>

      {channels.length === 0 ? (
        <EmptyState onAdd={onAdd} />
      ) : (
        channels.map((c) => (
          <ChannelCard key={c.id} channel={c} onUpdate={onUpdate} onRemove={onRemove} />
        ))
      )}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
      <p className="text-sm text-muted-foreground">No channels yet.</p>
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <PlusIcon className="size-4" />
        Add your first channel
      </Button>
    </div>
  )
}

function ChannelCard({
  channel,
  onUpdate,
  onRemove
}: {
  channel: ChannelDraft
  onUpdate: (id: string, patch: Partial<ChannelDraft>) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const { id } = channel

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{channel.name || '(unnamed channel)'}</CardTitle>
        <CardAction className="flex items-center gap-3">
          <Label htmlFor={`${id}-enabled`} className="text-xs text-muted-foreground">
            Enabled
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
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(id)}
            aria-label="Delete channel"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={`${id}-name`}>
            <Input
              id={`${id}-name`}
              value={channel.name}
              onChange={(e) => onUpdate(id, { name: e.target.value })}
              placeholder="e.g. OpenAI"
            />
          </Field>
          <Field label="Base URL" htmlFor={`${id}-base-url`}>
            <Input
              id={`${id}-base-url`}
              value={channel.base_url}
              onChange={(e) => onUpdate(id, { base_url: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </Field>
        </div>

        <Field
          label="API Key"
          htmlFor={`${id}-api-key`}
          hint={channel.has_api_key ? 'A key is stored. Leave blank to keep it.' : undefined}
        >
          <Input
            id={`${id}-api-key`}
            type="password"
            autoComplete="off"
            value={channel.api_key_input}
            onChange={(e) => onUpdate(id, { api_key_input: e.target.value })}
            placeholder={channel.has_api_key ? 'Saved — leave blank to keep' : 'Enter API key'}
          />
        </Field>

        <Field label="Models" htmlFor={`${id}-models`}>
          <ModelsInput
            id={`${id}-models`}
            value={channel.models}
            onChange={(models) => onUpdate(id, { models })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Price weight"
            htmlFor={`${id}-price-weight`}
            hint="Optional. Higher = preferred less."
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
              placeholder="1"
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
