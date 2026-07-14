import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_GROUP_ID } from '../../../shared/gateway'
import type {
  ChannelInput,
  ConfigInput,
  DisplayChannel,
  DisplayConfig,
  DisplayGroup,
  DisplaySettings
} from '../../../shared/gateway'

/**
 * Editable draft state for the gateway control plane.
 *
 * The renderer never receives a plaintext upstream key: reads carry a `has_api_key`
 * flag instead. So a channel draft pairs that server-side flag with a transient
 * `api_key_input` — the plaintext the user has typed *this session*. It starts empty
 * and is the ONLY place a key ever lives in the renderer; on save it is sent only when
 * non-empty (an empty input keeps the stored key, per the merge semantics in
 * src/main/config.ts).
 */
export interface ChannelDraft {
  id: string
  name: string
  base_url: string
  has_api_key: boolean
  /** Masked preview of the stored key (e.g. `sk-1234****cdef`); undefined for new channels. */
  api_key_preview?: string
  /** Plaintext key typed this session; '' means "leave the stored key untouched". */
  api_key_input: string
  models: string[]
  price_weight?: number
  enabled: boolean
  created_at?: string
  updated_at?: string
}

export interface GroupDraft {
  id: string
  name: string
  channel_ids: string[]
  created_at?: string
  updated_at?: string
}

export interface ConfigDraft {
  default_group_id: string
  /**
   * The client-facing gateway key, shown to the user in the dashboard. Display-only:
   * it is never part of buildInput, so a plain Save never touches it — only the
   * regenerate action changes it (via a dedicated IPC).
   */
  gateway_api_key: string
  channels: ChannelDraft[]
  groups: GroupDraft[]
  settings: DisplaySettings
}

function channelToDraft(c: DisplayChannel): ChannelDraft {
  return {
    id: c.id,
    name: c.name,
    base_url: c.base_url,
    has_api_key: c.has_api_key,
    api_key_preview: c.api_key_preview,
    api_key_input: '',
    models: c.models ?? [],
    price_weight: c.price_weight,
    enabled: c.enabled,
    created_at: c.created_at,
    updated_at: c.updated_at
  }
}

function groupToDraft(g: DisplayGroup): GroupDraft {
  return {
    id: g.id,
    name: g.name,
    channel_ids: g.channel_ids ?? [],
    created_at: g.created_at,
    updated_at: g.updated_at
  }
}

function toDraft(config: DisplayConfig): ConfigDraft {
  return {
    default_group_id: config.default_group_id ?? '',
    gateway_api_key: config.gateway_api_key ?? '',
    channels: config.channels.map(channelToDraft),
    groups: config.groups.map(groupToDraft),
    settings: { ...config.settings }
  }
}

/**
 * Serialize the draft back into the wire `ConfigInput`. The whole config is replaced
 * on the main side, so every field the user can edit is sent. A channel's `api_key` is
 * included ONLY when the user typed a non-empty value — otherwise it is omitted and the
 * main process keeps the key already stored for that id.
 */
function buildInput(draft: ConfigDraft): ConfigInput {
  const channels: ChannelInput[] = draft.channels.map((c) => {
    const input: ChannelInput = {
      id: c.id,
      name: c.name.trim(),
      base_url: c.base_url.trim(),
      models: c.models,
      price_weight: c.price_weight,
      enabled: c.enabled,
      created_at: c.created_at,
      updated_at: c.updated_at
    }
    // Only forward a key the user actually typed; anything else keeps the stored key.
    if (c.api_key_input.trim().length > 0) {
      input.api_key = c.api_key_input
    }
    return input
  })

  return {
    // The active group is never empty; fall back to the built-in group to match the main
    // process (mergeConfig) and the gateway.
    default_group_id: draft.default_group_id || DEFAULT_GROUP_ID,
    channels,
    // The built-in group is synthesized on read and stripped on write by the main process;
    // drop it here too so a save only ever carries user-created groups.
    groups: draft.groups
      .filter((g) => g.id !== DEFAULT_GROUP_ID)
      .map((g) => ({
        id: g.id,
        name: g.name.trim(),
        channel_ids: g.channel_ids,
        created_at: g.created_at,
        updated_at: g.updated_at
      })),
    settings: draft.settings
  }
}

function newId(prefix: 'ch' | 'grp'): string {
  return `${prefix}_${crypto.randomUUID()}`
}

export interface UseGatewayConfig {
  draft: ConfigDraft | null
  loading: boolean
  saving: boolean
  dirty: boolean
  error: string | null
  reload: () => Promise<void>
  /** Persist the draft. Resolves to null on success, or an error message on failure. */
  save: () => Promise<string | null>
  setDefaultGroupId: (id: string) => void
  /**
   * Reflect a freshly regenerated gateway key into the draft. Display-only: it does not
   * mark the draft dirty (the key is already persisted by the regenerate IPC) and skips a
   * full reload, so any unsaved Channels/Groups edits are preserved.
   */
  setGatewayApiKey: (key: string) => void
  updateSettings: (patch: Partial<DisplaySettings>) => void
  addChannel: () => string
  updateChannel: (id: string, patch: Partial<ChannelDraft>) => void
  /** Clone a channel (new id, no API key) right after the source. Returns the new id. */
  duplicateChannel: (id: string, nameSuffix?: string) => string
  removeChannel: (id: string) => void
  addGroup: () => string
  updateGroup: (id: string, patch: Partial<GroupDraft>) => void
  removeGroup: (id: string) => void
}

/**
 * Load, edit, and persist the gateway config through `window.api.gateway`. The draft is
 * the single source of truth for the Channels / Groups / Settings tabs; Save writes the
 * whole thing and then re-reads it so `has_api_key` and any server-side normalization
 * are reflected back (and transient key inputs are cleared).
 */
export function useGatewayConfig(): UseGatewayConfig {
  const [draft, setDraft] = useState<ConfigDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-read the config from the main process, driving the spinner and re-hydrating the
  // draft from the on-disk config (also used by the Reset button).
  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const config = await window.api.gateway.getConfig()
      setDraft(toDraft(config))
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Load the config from the main process once on mount. Reading initial state from an
  // external system (the gateway, over IPC) is the intended use of an effect; the
  // synchronous-setState guard is a false positive for this fetch-on-mount pattern.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  const save = useCallback(async (): Promise<string | null> => {
    if (!draft) return 'nothing to save'
    setSaving(true)
    setError(null)
    try {
      await window.api.gateway.updateConfig(buildInput(draft))
      const fresh = await window.api.gateway.getConfig()
      setDraft(toDraft(fresh))
      setDirty(false)
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      return message
    } finally {
      setSaving(false)
    }
  }, [draft])

  // Every mutator marks the draft dirty and edits it immutably.
  const edit = useCallback((fn: (d: ConfigDraft) => ConfigDraft) => {
    setDraft((prev) => (prev ? fn(prev) : prev))
    setDirty(true)
  }, [])

  // The active group is never empty; a blank id falls back to the built-in group.
  const setDefaultGroupId = useCallback(
    (id: string) => edit((d) => ({ ...d, default_group_id: id || DEFAULT_GROUP_ID })),
    [edit]
  )

  // Not routed through `edit`: the gateway key is persisted directly by the regenerate
  // IPC and is never part of buildInput, so it must not flip `dirty` or trigger a save.
  const setGatewayApiKey = useCallback((key: string) => {
    setDraft((prev) => (prev ? { ...prev, gateway_api_key: key } : prev))
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<DisplaySettings>) =>
      edit((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
    [edit]
  )

  const addChannel = useCallback((): string => {
    const id = newId('ch')
    edit((d) => ({
      ...d,
      channels: [
        ...d.channels,
        {
          id,
          name: '',
          base_url: '',
          has_api_key: false,
          api_key_input: '',
          models: [],
          enabled: true
        }
      ]
    }))
    return id
  }, [edit])

  const updateChannel = useCallback(
    (id: string, patch: Partial<ChannelDraft>) =>
      edit((d) => ({
        ...d,
        channels: d.channels.map((c) => (c.id === id ? { ...c, ...patch } : c))
      })),
    [edit]
  )

  // Clone a channel so a new one can be built from an existing config without retyping
  // models etc. The API key never reaches the renderer, so the copy starts key-less
  // (has_api_key: false) and must have its key re-entered before saving.
  const duplicateChannel = useCallback(
    (id: string, nameSuffix = ''): string => {
      const nid = newId('ch')
      edit((d) => {
        const idx = d.channels.findIndex((c) => c.id === id)
        if (idx === -1) return d
        const src = d.channels[idx]
        const copy: ChannelDraft = {
          id: nid,
          name: `${src.name}${nameSuffix}`,
          base_url: src.base_url,
          has_api_key: false,
          api_key_input: '',
          models: [...src.models],
          price_weight: src.price_weight,
          enabled: src.enabled
        }
        const channels = [...d.channels]
        channels.splice(idx + 1, 0, copy)
        return { ...d, channels }
      })
      return nid
    },
    [edit]
  )

  // Removing a channel also drops it from every group's channel_ids so no group is left
  // pointing at a dangling id.
  const removeChannel = useCallback(
    (id: string) =>
      edit((d) => ({
        ...d,
        channels: d.channels.filter((c) => c.id !== id),
        groups: d.groups.map((g) => ({
          ...g,
          channel_ids: g.channel_ids.filter((cid) => cid !== id)
        }))
      })),
    [edit]
  )

  const addGroup = useCallback((): string => {
    const id = newId('grp')
    edit((d) => ({
      ...d,
      groups: [...d.groups, { id, name: '', channel_ids: [] }]
    }))
    return id
  }, [edit])

  // The built-in group is read-only (members always equal every channel); ignore edits to
  // it. The UI disables its controls, but guarding here keeps the invariant even if called.
  const updateGroup = useCallback(
    (id: string, patch: Partial<GroupDraft>) => {
      if (id === DEFAULT_GROUP_ID) return
      edit((d) => ({
        ...d,
        groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g))
      }))
    },
    [edit]
  )

  // The built-in group cannot be removed. Removing a user group that was the active group
  // falls back to the built-in group (the active group is never empty).
  const removeGroup = useCallback(
    (id: string) => {
      if (id === DEFAULT_GROUP_ID) return
      edit((d) => ({
        ...d,
        groups: d.groups.filter((g) => g.id !== id),
        default_group_id: d.default_group_id === id ? DEFAULT_GROUP_ID : d.default_group_id
      }))
    },
    [edit]
  )

  return {
    draft,
    loading,
    saving,
    dirty,
    error,
    reload,
    save,
    setDefaultGroupId,
    setGatewayApiKey,
    updateSettings,
    addChannel,
    updateChannel,
    duplicateChannel,
    removeChannel,
    addGroup,
    updateGroup,
    removeGroup
  }
}
