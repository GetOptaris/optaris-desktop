import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { copyText } from '@/lib/clipboard'

/**
 * Shows the gateway base URL clients should point their `base_url` at, with a copy
 * button. This is display-only: the renderer never talks to the data plane itself, it
 * just hands the URL to the user.
 */
export function BaseUrlCard(): React.JSX.Element {
  const [baseUrl, setBaseUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    window.api.gateway
      .getBaseUrl()
      .then((url) => {
        if (active) setBaseUrl(url)
      })
      .catch(() => {
        /* base URL is best-effort; leave it blank if the gateway isn't up yet */
      })
    return () => {
      active = false
    }
  }, [])

  const onCopy = async (): Promise<void> => {
    if (!baseUrl) return
    if (await copyText(baseUrl)) {
      setCopied(true)
      toast.success('Base URL copied')
      window.setTimeout(() => setCopied(false), 1500)
    } else {
      toast.error('Copy failed')
    }
  }

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-1 text-xs font-medium text-muted-foreground">Base URL</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
          {baseUrl || 'starting…'}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7 shrink-0"
          onClick={onCopy}
          disabled={!baseUrl}
          aria-label="Copy base URL"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}
