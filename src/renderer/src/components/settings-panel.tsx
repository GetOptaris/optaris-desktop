import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { GroupDraft } from '@/hooks/useGatewayConfig'
import type { DisplaySettings } from '../../../shared/gateway'

/** Sentinel for the "no default group" option (Select values must be non-empty). */
const NO_GROUP = '__none__'

interface SettingsPanelProps {
  defaultGroupId: string
  groups: GroupDraft[]
  settings: DisplaySettings
  onSetDefaultGroup: (id: string) => void
  onUpdateSettings: (patch: Partial<DisplaySettings>) => void
}

export function SettingsPanel({
  defaultGroupId,
  groups,
  settings,
  onSetDefaultGroup,
  onUpdateSettings
}: SettingsPanelProps): React.JSX.Element {
  const captureEnabled = settings.capture_enabled === true
  const captureMode = settings.capture_mode ?? null

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Routing</CardTitle>
          <CardDescription>The group every request is routed through by default.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1.5">
          <Label htmlFor="default-group">Default group</Label>
          <Select
            value={defaultGroupId || NO_GROUP}
            onValueChange={(value) => onSetDefaultGroup(value && value !== NO_GROUP ? value : '')}
          >
            <SelectTrigger id="default-group" className="w-full sm:w-72">
              <SelectValue placeholder="Select a group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GROUP}>None</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name || '(unnamed group)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">Create a group to set a default.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Request capture</CardTitle>
          <CardDescription>Persist raw request/response payloads for inspection.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-0.5">
              <Label htmlFor="capture-enabled">Enable capture</Label>
              <p className="text-xs text-muted-foreground">
                When off, only request summaries are recorded.
              </p>
            </div>
            <Switch
              id="capture-enabled"
              checked={captureEnabled}
              onCheckedChange={(checked) => onUpdateSettings({ capture_enabled: checked })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="capture-mode">Capture mode</Label>
            <Select
              value={captureMode}
              onValueChange={(value) => {
                if (value === 'failed_only' || value === 'all') {
                  onUpdateSettings({ capture_mode: value })
                }
              }}
            >
              <SelectTrigger
                id="capture-mode"
                className="w-full sm:w-72"
                disabled={!captureEnabled}
              >
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="failed_only">Failed only</SelectItem>
                <SelectItem value="all">All requests</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
