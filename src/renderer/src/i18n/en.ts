/**
 * English dictionary. This is the source-of-truth shape: `zh.ts` is typed as
 * `typeof en`, so every key here must have a Chinese counterpart (and vice versa).
 * Keys are grouped by screen; look them up with the dot-path `t('nav.channels')`.
 */
const en = {
  nav: {
    dashboard: 'Dashboard',
    channels: 'Channels',
    groups: 'Groups',
    logs: 'Logs',
    settings: 'Settings'
  },
  common: {
    save: 'Save',
    saving: 'Saving…',
    reset: 'Reset',
    unsavedChanges: 'Unsaved changes',
    loading: 'Loading…',
    none: 'None'
  },
  toast: {
    saveFailed: 'Save failed',
    saveSuccess: 'Configuration saved',
    baseUrlCopied: 'Base URL copied',
    copyFailed: 'Copy failed'
  },
  dashboard: {
    subtitle: 'Overview of your local gateway and how to get started.',
    gatewayTitle: 'Gateway',
    gatewayDescription: 'Point your client’s base URL at this address.',
    baseUrl: 'Base URL',
    starting: 'starting…',
    apiKeyLabel: 'API Key',
    apiKeyNote:
      'This local gateway doesn’t verify an API key, but most clients require one — just enter any value (e.g. optaris).',
    overviewTitle: 'Overview',
    channelsCount: 'Channels',
    groupsCount: 'Groups',
    defaultGroup: 'Default group',
    quickStartTitle: 'Quick start',
    quickStartDescription: 'Set up routing in a few steps.',
    step1Title: 'Add a channel',
    step1Desc: 'Register an upstream provider with its base URL, API key and models.',
    step2Title: 'Create a group',
    step2Desc: 'Bundle one or more channels into a routing group.',
    step3Title: 'Pick a default group',
    step3Desc: 'Choose which group every request routes through by default.',
    step4Title: 'Point your client',
    step4Desc: 'Set your client’s base URL to the gateway address above.',
    goChannels: 'Go to Channels',
    goGroups: 'Go to Groups',
    goSettings: 'Go to Settings'
  },
  channels: {
    description: 'Upstream providers the gateway can route to.',
    add: 'Add channel',
    addFirst: 'Add your first channel',
    empty: 'No channels yet.',
    unnamed: '(unnamed channel)',
    duplicate: 'Duplicate channel',
    delete: 'Delete channel',
    enabled: 'Enabled',
    name: 'Name',
    namePlaceholder: 'e.g. OpenAI',
    baseUrl: 'Base URL',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    apiKey: 'API Key',
    apiKeyStoredHint: 'Stored key {preview}. Leave blank to keep it.',
    apiKeySavedPlaceholder: 'Saved — leave blank to keep',
    apiKeyEnterPlaceholder: 'Enter API key',
    models: 'Models',
    priceWeight: 'Price weight',
    priceWeightHint: 'Optional. Higher = preferred less.',
    priceWeightPlaceholder: '1',
    copySuffix: ' copy'
  },
  models: {
    addPlaceholder: 'Add model…',
    emptyPlaceholder: 'Type to search, e.g. gpt-4o',
    remove: 'Remove {model}',
    add: 'Add “{model}”'
  },
  groups: {
    description: 'Named sets of channels a request can be routed across.',
    add: 'Add group',
    addFirst: 'Add your first group',
    empty: 'No groups yet.',
    unnamed: '(unnamed group)',
    delete: 'Delete group',
    name: 'Name',
    namePlaceholder: 'e.g. default',
    channels: 'Channels',
    noChannels: 'No channels to add yet — create a channel first.'
  },
  settings: {
    routingTitle: 'Routing',
    routingDescription: 'The group every request is routed through by default.',
    defaultGroup: 'Default group',
    defaultGroupPlaceholder: 'Select a group',
    createGroupFirst: 'Create a group to set a default.',
    captureTitle: 'Request capture',
    captureDescription: 'Persist raw request/response payloads for inspection.',
    captureEnable: 'Enable capture',
    captureEnableHint: 'When off, only request summaries are recorded.',
    captureMode: 'Capture mode',
    captureModePlaceholder: 'Select mode',
    captureFailedOnly: 'Failed only',
    captureAll: 'All requests',
    appearanceTitle: 'Appearance',
    appearanceDescription: 'Language and color theme for this app.',
    language: 'Language',
    languageSystem: 'System',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark'
  },
  logs: {
    outcomePlaceholder: 'Outcome',
    allOutcomes: 'All outcomes',
    filterModel: 'Filter by model…',
    refresh: 'Refresh',
    row: 'row',
    rows: 'rows',
    time: 'Time',
    outcome: 'Outcome',
    status: 'Status',
    model: 'Model',
    channel: 'Channel',
    tokensIn: 'In',
    tokensOut: 'Out',
    empty: 'No requests recorded yet.'
  }
}

/** The dictionary shape; `zh.ts` is typed as `Dict` so it stays key-complete. */
export type Dict = typeof en

export default en
