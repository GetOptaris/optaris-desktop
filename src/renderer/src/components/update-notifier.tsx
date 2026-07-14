import { useEffect } from 'react'
import { toast } from 'sonner'
import { useT } from '@/i18n'

/** Reused toast id so successive download-progress events update one toast in place. */
const DOWNLOAD_TOAST_ID = 'updater-download'

/**
 * Headless component (renders nothing) that turns main-process updater pushes into
 * sonner toasts — the "notify on discovery" flow:
 *   available -> ask to download (macOS: link to the release page instead)
 *   progress  -> in-place "downloading… n%"
 *   downloaded-> "ready to install" with a restart action (Windows/Linux only)
 *
 * `update-not-available` is intentionally NOT surfaced here (it also fires on the
 * silent startup check and would nag); the Settings "check for updates" button owns
 * that feedback. Errors are logged, not toasted, so offline/dev checks stay quiet.
 */
export function UpdateNotifier(): null {
  const t = useT()

  useEffect(() => {
    const offAvailable = window.api.updater.onUpdateAvailable(({ version, mac }) => {
      toast(t('update.availableTitle', { version }), {
        description: mac ? t('update.availableMacDescription') : undefined,
        duration: Infinity,
        action: {
          label: mac ? t('update.goDownloadPage') : t('update.download'),
          onClick: () => void window.api.updater.confirmDownload()
        },
        cancel: { label: t('update.later'), onClick: () => {} }
      })
    })

    const offProgress = window.api.updater.onDownloadProgress(({ percent }) => {
      toast.loading(t('update.downloading', { percent: Math.round(percent) }), {
        id: DOWNLOAD_TOAST_ID,
        duration: Infinity
      })
    })

    const offDownloaded = window.api.updater.onUpdateDownloaded(({ version }) => {
      toast.dismiss(DOWNLOAD_TOAST_ID)
      toast.success(t('update.readyTitle'), {
        description: t('update.readyDescription', { version }),
        duration: Infinity,
        action: {
          label: t('update.restartNow'),
          onClick: () => void window.api.updater.quitAndInstall()
        },
        cancel: { label: t('update.later'), onClick: () => {} }
      })
    })

    const offError = window.api.updater.onError(({ message }) => {
      console.error('[updater]', message)
    })

    return () => {
      offAvailable()
      offProgress()
      offDownloaded()
      offError()
    }
  }, [t])

  return null
}
