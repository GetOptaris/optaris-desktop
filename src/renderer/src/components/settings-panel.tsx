import { useTheme } from 'next-themes'
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
import { useLocale, useT } from '@/i18n'
import type { LangPreference } from '@/i18n'
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
  const t = useT()
  const captureEnabled = settings.capture_enabled === true
  const captureMode = settings.capture_mode ?? null

  return (
    <div className="flex flex-col gap-4">
      <AppearanceCard />

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.routingTitle')}</CardTitle>
          <CardDescription>{t('settings.routingDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1.5">
          <Label htmlFor="default-group">{t('settings.defaultGroup')}</Label>
          <Select
            value={defaultGroupId || NO_GROUP}
            onValueChange={(value) => onSetDefaultGroup(value && value !== NO_GROUP ? value : '')}
          >
            <SelectTrigger id="default-group" className="w-full sm:w-72">
              <SelectValue placeholder={t('settings.defaultGroupPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GROUP}>{t('common.none')}</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name || t('groups.unnamed')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('settings.createGroupFirst')}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.captureTitle')}</CardTitle>
          <CardDescription>{t('settings.captureDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center justify-between gap-4">
            <div className="grid gap-0.5">
              <Label htmlFor="capture-enabled">{t('settings.captureEnable')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.captureEnableHint')}</p>
            </div>
            <Switch
              id="capture-enabled"
              checked={captureEnabled}
              onCheckedChange={(checked) => onUpdateSettings({ capture_enabled: checked })}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="capture-mode">{t('settings.captureMode')}</Label>
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
                <SelectValue placeholder={t('settings.captureModePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="failed_only">{t('settings.captureFailedOnly')}</SelectItem>
                <SelectItem value="all">{t('settings.captureAll')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** Language + color theme, both persisted locally and defaulting to "follow system". */
function AppearanceCard(): React.JSX.Element {
  const t = useT()
  const { preference, setPreference } = useLocale()
  const { theme, setTheme } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearanceTitle')}</CardTitle>
        <CardDescription>{t('settings.appearanceDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="language">{t('settings.language')}</Label>
          <Select
            value={preference}
            onValueChange={(value) => setPreference((value ?? 'system') as LangPreference)}
          >
            <SelectTrigger id="language" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t('settings.languageSystem')}</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="theme">{t('settings.theme')}</Label>
          <Select value={theme ?? 'system'} onValueChange={(value) => setTheme(value ?? 'system')}>
            <SelectTrigger id="theme" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t('settings.themeSystem')}</SelectItem>
              <SelectItem value="light">{t('settings.themeLight')}</SelectItem>
              <SelectItem value="dark">{t('settings.themeDark')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
