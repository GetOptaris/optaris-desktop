import { useMemo } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useT, type TFunction } from '@/i18n'
import type { ChannelDraft, GroupDraft } from '@/hooks/useGatewayConfig'

/** Sentinel for the "no active group" option (Select values must be non-empty). */
const NO_GROUP = '__none__'

interface GroupsPanelProps {
  groups: GroupDraft[]
  channels: ChannelDraft[]
  defaultGroupId: string
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<GroupDraft>) => void
  onRemove: (id: string) => void
  onSetDefaultGroup: (id: string) => void
}

export function GroupsPanel({
  groups,
  channels,
  defaultGroupId,
  onAdd,
  onUpdate,
  onRemove,
  onSetDefaultGroup
}: GroupsPanelProps): React.JSX.Element {
  const t = useT()

  // value→label map drives both the trigger (Base UI's `items`) and the options,
  // keeping them from drifting — mirrors the capture-mode select in settings-panel.
  const groupItems = useMemo<Record<string, React.ReactNode>>(
    () => ({
      [NO_GROUP]: t('common.none'),
      ...Object.fromEntries(groups.map((g) => [g.id, g.name || t('groups.unnamed')]))
    }),
    [groups, t]
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('groups.description')}</p>
        <Button type="button" size="sm" onClick={onAdd}>
          <PlusIcon className="size-4" />
          {t('groups.add')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('groups.activeTitle')}</CardTitle>
          <CardDescription>{t('groups.activeDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1.5">
          <Select
            value={defaultGroupId || NO_GROUP}
            onValueChange={(value) => onSetDefaultGroup(value && value !== NO_GROUP ? value : '')}
            items={groupItems}
          >
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue placeholder={t('groups.activePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(groupItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('groups.activeEmpty')}</p>
          ) : null}
        </CardContent>
      </Card>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">{t('groups.empty')}</p>
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <PlusIcon className="size-4" />
            {t('groups.addFirst')}
          </Button>
        </div>
      ) : (
        groups.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            channels={channels}
            onUpdate={onUpdate}
            onRemove={onRemove}
            t={t}
          />
        ))
      )}
    </div>
  )
}

function GroupCard({
  group,
  channels,
  onUpdate,
  onRemove,
  t
}: {
  group: GroupDraft
  channels: ChannelDraft[]
  onUpdate: (id: string, patch: Partial<GroupDraft>) => void
  onRemove: (id: string) => void
  t: TFunction
}): React.JSX.Element {
  const { id } = group

  const toggleChannel = (channelId: string, checked: boolean): void => {
    const next = checked
      ? [...group.channel_ids, channelId]
      : group.channel_ids.filter((cid) => cid !== channelId)
    onUpdate(id, { channel_ids: next })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{group.name || t('groups.unnamed')}</CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(id)}
            aria-label={t('groups.delete')}
            title={t('groups.delete')}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-name`}>{t('groups.name')}</Label>
          <Input
            id={`${id}-name`}
            value={group.name}
            onChange={(e) => onUpdate(id, { name: e.target.value })}
            placeholder={t('groups.namePlaceholder')}
          />
        </div>

        <div className="grid gap-2">
          <Label>{t('groups.channels')}</Label>
          {channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('groups.noChannels')}</p>
          ) : (
            <div className="grid gap-1 rounded-md border p-2 sm:grid-cols-2">
              {channels.map((c) => {
                const checkboxId = `${id}-ch-${c.id}`
                return (
                  <label
                    key={c.id}
                    htmlFor={checkboxId}
                    className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={group.channel_ids.includes(c.id)}
                      onCheckedChange={(checked) => toggleChannel(c.id, checked === true)}
                    />
                    <span className="truncate">{c.name || t('channels.unnamed')}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
