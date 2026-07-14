import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import type { DisplaySettings } from '../../../shared/gateway'

interface SettingsPanelProps {
  settings: DisplaySettings
  onUpdateSettings: (patch: Partial<DisplaySettings>) => void
}

export function SettingsPanel({
  settings,
  onUpdateSettings
}: SettingsPanelProps): React.JSX.Element {
  const t = useT()
  const captureEnabled = settings.capture_enabled === true
  const captureMode = settings.capture_mode ?? null

  // value→label map drives both the trigger (Base UI's `items`) and the dropdown
  // options, keeping them from drifting. Without `items`, a closed Select renders
  // the raw value because its portalled items are unmounted (see issue #4).
  const captureItems = useMemo<Record<string, React.ReactNode>>(
    () => ({ failed_only: t('settings.captureFailedOnly'), all: t('settings.captureAll') }),
    [t]
  )

  return (
    <div className="flex flex-col gap-4">
      <AppearanceCard />

      <AboutCard />

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
              items={captureItems}
            >
              <SelectTrigger
                id="capture-mode"
                className="w-full sm:w-72"
                disabled={!captureEnabled}
              >
                <SelectValue placeholder={t('settings.captureModePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(captureItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
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

  // Language names stay in their native form; only "System" is translated.
  const languageItems = useMemo<Record<string, React.ReactNode>>(
    () => ({ system: t('settings.languageSystem'), zh: '中文', en: 'English' }),
    [t]
  )
  const themeItems = useMemo<Record<string, React.ReactNode>>(
    () => ({
      system: t('settings.themeSystem'),
      light: t('settings.themeLight'),
      dark: t('settings.themeDark')
    }),
    [t]
  )

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
            items={languageItems}
          >
            <SelectTrigger id="language" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(languageItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="theme">{t('settings.theme')}</Label>
          <Select
            value={theme ?? 'system'}
            onValueChange={(value) => setTheme(value ?? 'system')}
            items={themeItems}
          >
            <SelectTrigger id="theme" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(themeItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Version + manual update check. The available/downloaded/error toasts are owned by
 * UpdateNotifier (mounted app-wide); here we only end the "checking" state and, on a
 * manual check that finds nothing, show an inline "up to date" note (UpdateNotifier
 * deliberately stays silent on `update-not-available` so the startup check doesn't nag).
 */
function AboutCard(): React.JSX.Element {
  const t = useT()
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [upToDate, setUpToDate] = useState(false)

  useEffect(() => {
    void window.api.updater.getVersion().then(setVersion)
  }, [])

  // Any check outcome ends the spinner; a "not available" also drives the inline note.
  useEffect(() => {
    const offAvailable = window.api.updater.onUpdateAvailable(() => setChecking(false))
    const offNone = window.api.updater.onUpdateNotAvailable(() => {
      setChecking(false)
      setUpToDate(true)
    })
    const offError = window.api.updater.onError(() => setChecking(false))
    return () => {
      offAvailable()
      offNone()
      offError()
    }
  }, [])

  const onCheck = async (): Promise<void> => {
    setUpToDate(false)
    setChecking(true)
    await window.api.updater.checkForUpdates()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.aboutTitle')}</CardTitle>
        <CardDescription>{t('settings.aboutDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="grid gap-0.5">
          <span className="text-sm">
            {t('settings.version')} {version || '—'}
          </span>
          {upToDate ? (
            <p className="text-xs text-muted-foreground">{t('update.upToDate')}</p>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCheck} disabled={checking}>
          {checking ? t('update.checking') : t('update.checkForUpdates')}
        </Button>
      </CardContent>
    </Card>
  )
}
