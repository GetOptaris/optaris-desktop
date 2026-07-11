import { PlusIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import type { ChannelDraft, GroupDraft } from '@/hooks/useGatewayConfig'

interface GroupsPanelProps {
  groups: GroupDraft[]
  channels: ChannelDraft[]
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<GroupDraft>) => void
  onRemove: (id: string) => void
}

export function GroupsPanel({
  groups,
  channels,
  onAdd,
  onUpdate,
  onRemove
}: GroupsPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Named sets of channels a request can be routed across.
        </p>
        <Button type="button" size="sm" onClick={onAdd}>
          <PlusIcon className="size-4" />
          Add group
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">No groups yet.</p>
          <Button type="button" variant="outline" size="sm" onClick={onAdd}>
            <PlusIcon className="size-4" />
            Add your first group
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
  onRemove
}: {
  group: GroupDraft
  channels: ChannelDraft[]
  onUpdate: (id: string, patch: Partial<GroupDraft>) => void
  onRemove: (id: string) => void
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
        <CardTitle className="truncate">{group.name || '(unnamed group)'}</CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(id)}
            aria-label="Delete group"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={group.name}
            onChange={(e) => onUpdate(id, { name: e.target.value })}
            placeholder="e.g. default"
          />
        </div>

        <div className="grid gap-2">
          <Label>Channels</Label>
          {channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No channels to add yet — create a channel first.
            </p>
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
                    <span className="truncate">{c.name || '(unnamed channel)'}</span>
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
