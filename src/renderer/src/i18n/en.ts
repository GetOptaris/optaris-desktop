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
    copyFailed: 'Copy failed',
    apiKeyCopied: 'API key copied',
    apiKeyRegenerated: 'New API key generated',
    apiKeyRegenerateFailed: 'Failed to generate a new API key'
  },
  dashboard: {
    gatewayTitle: 'Gateway',
    gatewayDescription: 'Point your client’s base URL at this address.',
    baseUrl: 'Base URL',
    starting: 'starting…',
    apiKeyLabel: 'API Key',
    apiKeyReveal: 'Reveal API key',
    apiKeyHide: 'Hide API key',
    apiKeyRegenerate: 'Regenerate',
    apiKeyRegenerateConfirm:
      'Regenerate the key? Existing clients will stop working until updated.',
    apiKeyRegenerateCancel: 'Cancel',
    overviewTitle: 'Overview',
    channelsCount: 'Channels',
    groupsCount: 'Groups',
    defaultGroup: 'Active group',
    quickStartTitle: 'Quick start',
    step1Title: 'Add a channel',
    step1Desc: 'Register an upstream provider with its base URL, API key and models.',
    step2Title: 'Create a group',
    step2Desc: 'Bundle one or more channels into a group, and pick one as the active group.',
    step3Title: 'Point your client',
    step3Desc: 'Set your client’s base URL to the gateway address above.',
    step4Title: 'View logs',
    step4Desc:
      'Inspect request records on the Logs page; enable request/response capture in Settings.',
    goChannels: 'Go to Channels',
    goGroups: 'Go to Groups',
    goLogs: 'Go to Logs'
  },
  connect: {
    title: 'Connect your clients',
    description: 'Point these apps at the local gateway in one click.',
    apply: 'Connect',
    reapply: 'Re-apply',
    connected: 'Connected',
    notConnected: 'Not connected',
    notInstalled: 'Not installed',
    currentAddress: 'Current address',
    unsupported: 'Not supported on this OS',
    restartHint: 'Restart the client to take effect.',
    experimental: 'Experimental',
    applied: '{client} connected — restart it to take effect',
    applyFailed: 'Failed to connect {client}',
    clients: {
      claude_code: 'Claude Code',
      claude_desktop: 'Claude Desktop',
      codex: 'Codex',
      gemini_cli: 'Gemini CLI'
    }
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
    activeTitle: 'Active group',
    activeDescription: 'Every request is routed to this group.',
    activePlaceholder: 'Select a group',
    activeEmpty: 'Create a group first to activate one.',
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
    clientType: 'Client',
    sessionId: 'Session',
    upstreamsTried: 'Upstreams',
    stream: 'Stream',
    group: 'Group',
    streamYes: 'Streaming',
    streamNo: 'Non-streaming',
    clients: {
      claude_code: 'Claude Code',
      claude_desktop: 'Claude Desktop',
      codex: 'Codex',
      unknown: 'Unknown'
    },
    tokensIn: 'In',
    cacheRead: 'Cache R',
    cacheWrite5m: 'Cache W 5m',
    cacheWrite1h: 'Cache W 1h',
    tokensOut: 'Out',
    empty: 'No requests recorded yet.',
    outcomes: {
      success: 'Success',
      failed: 'Failed',
      client_canceled: 'Client canceled',
      rejected: 'Rejected'
    },
    detail: {
      title: 'Request details',
      reqId: 'Request ID',
      close: 'Close',
      clientRequest: 'Client → Gateway',
      upstreamRequest: 'Gateway → Upstream',
      upstreamResponse: 'Upstream → Gateway',
      headers: 'Headers',
      body: 'Body',
      url: 'URL',
      attempt: 'Attempt {n}',
      emptyBody: '(empty)',
      truncated: 'Response body truncated to the capture size limit.',
      headersRedacted: 'Authorization / API-key headers are redacted.',
      strippedUsage: 'Usage stripped from the client-visible stream.',
      committedThenFailed: 'Committed to the client, then the upstream failed mid-stream.',
      noCaptureTitle: 'No capture recorded for this request.',
      noCaptureHint:
        'Enable “Request capture” in Settings and set the mode to “All requests” to record full round-trips.'
    }
  }
}

/** The dictionary shape; `zh.ts` is typed as `Dict` so it stays key-complete. */
export type Dict = typeof en

export default en
