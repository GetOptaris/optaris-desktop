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
import { DEFAULT_GROUP_ID } from '../../../shared/gateway'
import type { ChannelDraft, GroupDraft } from '@/hooks/useGatewayConfig'

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

  // Display name for a group id: the built-in group is localized (its wire name is empty);
  // user groups use their own name, falling back to a placeholder when unnamed.
  const groupLabel = (g: GroupDraft): string =>
    g.id === DEFAULT_GROUP_ID ? t('groups.defaultName') : g.name || t('groups.unnamed')

  // value→label map drives both the trigger (Base UI's `items`) and the options,
  // keeping them from drifting — mirrors the capture-mode select in settings-panel. The
  // active group is never empty, so there is no "none" option: the built-in group is always
  // present as the default choice.
  const groupItems = useMemo<Record<string, React.ReactNode>>(
    () => Object.fromEntries(groups.map((g) => [g.id, groupLabel(g)])),
    // groupLabel closes over t; groups + t cover its inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            value={defaultGroupId || DEFAULT_GROUP_ID}
            onValueChange={(value) => onSetDefaultGroup(value ?? DEFAULT_GROUP_ID)}
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
        </CardContent>
      </Card>

      {groups.map((g) => (
        <GroupCard
          key={g.id}
          group={g}
          channels={channels}
          onUpdate={onUpdate}
          onRemove={onRemove}
          t={t}
        />
      ))}
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
  // The built-in "all channels" group is read-only: it can't be renamed or deleted, and its
  // membership always equals every channel (shown all-checked and disabled).
  const isBuiltin = id === DEFAULT_GROUP_ID

  const toggleChannel = (channelId: string, checked: boolean): void => {
    const next = checked
      ? [...group.channel_ids, channelId]
      : group.channel_ids.filter((cid) => cid !== channelId)
    onUpdate(id, { channel_ids: next })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">
          {isBuiltin ? t('groups.defaultName') : group.name || t('groups.unnamed')}
        </CardTitle>
        {isBuiltin ? null : (
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
        )}
      </CardHeader>

      <CardContent className="grid gap-4">
        {isBuiltin ? (
          <p className="text-sm text-muted-foreground">{t('groups.defaultDescription')}</p>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-name`}>{t('groups.name')}</Label>
            <Input
              id={`${id}-name`}
              value={group.name}
              onChange={(e) => onUpdate(id, { name: e.target.value })}
              placeholder={t('groups.namePlaceholder')}
            />
          </div>
        )}

        <div className="grid gap-2">
          <Label>{t('groups.channels')}</Label>
          {channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('groups.noChannels')}</p>
          ) : (
            <div className="grid gap-1 rounded-md border p-2 sm:grid-cols-2">
              {channels.map((c) => {
                const checkboxId = `${id}-ch-${c.id}`
                // The built-in group implicitly contains every channel; render all boxes
                // checked and disabled rather than reading its (synthesized) channel_ids.
                const checked = isBuiltin || group.channel_ids.includes(c.id)
                return (
                  <label
                    key={c.id}
                    htmlFor={checkboxId}
                    className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      disabled={isBuiltin}
                      onCheckedChange={(c2) => toggleChannel(c.id, c2 === true)}
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
