import { useEffect, useMemo, useRef, useState } from 'react'
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

/** Inline feedback for a *manual* check: nothing shown, "up to date", "check failed", or "unsupported". */
type CheckNote = 'none' | 'upToDate' | 'error' | 'unsupported'

/**
 * Version + manual update check. The available/downloaded toasts are owned by
 * UpdateNotifier (mounted app-wide); here we end the "checking" state and, for a check
 * the user started from this button, show an inline result: "up to date" when nothing
 * is available or "check failed" on error. Both UpdateNotifier and this card stay
 * silent on the automatic startup check — the manual flag below gates the inline note,
 * so the background `update-not-available` / `error` never surfaces "up to date" or an
 * error the user didn't ask for.
 */
function AboutCard(): React.JSX.Element {
  const t = useT()
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState<CheckNote>('none')
  // True only while a check the user started from this button is in flight. A ref (not
  // state) so the push handlers below read the current value without re-subscribing.
  const manualCheck = useRef(false)

  useEffect(() => {
    void window.api.updater.getVersion().then(setVersion)
  }, [])

  // Any check outcome ends the spinner. The inline note is driven only for a manual
  // check (the startup check must not nag): "available" clears the note (the toast
  // takes over), "not available" -> up to date, "error" -> failed.
  useEffect(() => {
    const finishManual = (result: CheckNote): void => {
      if (!manualCheck.current) return
      manualCheck.current = false
      setChecking(false)
      setNote(result)
    }
    const offAvailable = window.api.updater.onUpdateAvailable(() => finishManual('none'))
    const offNone = window.api.updater.onUpdateNotAvailable(() => finishManual('upToDate'))
    const offUnsupported = window.api.updater.onUnsupported(() => finishManual('unsupported'))
    const offError = window.api.updater.onError(() => finishManual('error'))
    return () => {
      offAvailable()
      offNone()
      offUnsupported()
      offError()
    }
  }, [])

  const onCheck = async (): Promise<void> => {
    manualCheck.current = true
    setNote('none')
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
          {note === 'upToDate' ? (
            <p className="text-xs text-muted-foreground">{t('update.upToDate')}</p>
          ) : note === 'unsupported' ? (
            <p className="text-xs text-muted-foreground">{t('update.unsupported')}</p>
          ) : note === 'error' ? (
            <p className="text-xs text-destructive">{t('update.error')}</p>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onCheck} disabled={checking}>
          {checking ? t('update.checking') : t('update.checkForUpdates')}
        </Button>
      </CardContent>
    </Card>
  )
}
