import { useState } from 'react'
import { toast } from 'sonner'
import { LayersIcon, ScrollTextIcon, ServerIcon, SettingsIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BaseUrlCard } from '@/components/base-url-card'
import { ChannelsPanel } from '@/components/channels-panel'
import { GroupsPanel } from '@/components/groups-panel'
import { SettingsPanel } from '@/components/settings-panel'
import { LogsPanel } from '@/components/logs-panel'
import { useGatewayConfig } from '@/hooks/useGatewayConfig'

type Tab = 'channels' | 'groups' | 'logs' | 'settings'

const NAV: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'channels', label: 'Channels', icon: ServerIcon },
  { id: 'groups', label: 'Groups', icon: LayersIcon },
  { id: 'logs', label: 'Logs', icon: ScrollTextIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('channels')
  const config = useGatewayConfig()
  const { draft } = config

  const isConfigTab = tab !== 'logs'
  const activeLabel = NAV.find((n) => n.id === tab)?.label ?? ''

  const onSave = async (): Promise<void> => {
    const error = await config.save()
    if (error) {
      toast.error('Save failed', { description: error })
    } else {
      toast.success('Configuration saved')
    }
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-14 items-center gap-2 px-4 text-sm font-semibold">
          <ServerIcon className="size-4" />
          Optaris Gateway
        </div>
        <nav className="flex flex-col gap-0.5 px-2 py-2">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = tab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="mt-auto p-3">
          <BaseUrlCard />
        </div>
      </aside>

      {/* Content */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <h1 className="text-base font-semibold">{activeLabel}</h1>
          {isConfigTab ? (
            <div className="flex items-center gap-3">
              {config.dirty ? (
                <span className="text-xs text-muted-foreground">Unsaved changes</span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void config.reload()}
                disabled={!config.dirty || config.saving || config.loading}
              >
                Reset
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={!config.dirty || config.saving || config.loading}
              >
                {config.saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          {isConfigTab && !draft ? (
            <p className="text-sm text-muted-foreground">
              {config.error ? config.error : 'Loading…'}
            </p>
          ) : null}

          {tab === 'channels' && draft ? (
            <ChannelsPanel
              channels={draft.channels}
              onAdd={config.addChannel}
              onUpdate={config.updateChannel}
              onRemove={config.removeChannel}
            />
          ) : null}

          {tab === 'groups' && draft ? (
            <GroupsPanel
              groups={draft.groups}
              channels={draft.channels}
              onAdd={config.addGroup}
              onUpdate={config.updateGroup}
              onRemove={config.removeGroup}
            />
          ) : null}

          {tab === 'settings' && draft ? (
            <SettingsPanel
              defaultGroupId={draft.default_group_id}
              groups={draft.groups}
              settings={draft.settings}
              onSetDefaultGroup={config.setDefaultGroupId}
              onUpdateSettings={config.updateSettings}
            />
          ) : null}

          {tab === 'logs' ? <LogsPanel /> : null}
        </div>
      </main>

      <Toaster position="bottom-right" richColors />
    </div>
  )
}

export default App
