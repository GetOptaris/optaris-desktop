import type { Dict } from './en'

/** Simplified Chinese dictionary. Typed as `Dict` so it stays key-complete. */
const zh: Dict = {
  nav: {
    dashboard: '概览',
    channels: '渠道',
    groups: '分组',
    logs: '日志',
    settings: '设置'
  },
  common: {
    save: '保存',
    saving: '保存中…',
    reset: '重置',
    unsavedChanges: '有未保存的更改',
    loading: '加载中…',
    none: '无'
  },
  toast: {
    saveFailed: '保存失败',
    saveSuccess: '配置已保存',
    baseUrlCopied: '网关地址已复制',
    copyFailed: '复制失败'
  },
  dashboard: {
    subtitle: '本地网关概况与上手指引。',
    gatewayTitle: '网关',
    gatewayDescription: '把客户端的 base URL 指向此地址。',
    baseUrl: '网关地址',
    starting: '启动中…',
    apiKeyLabel: 'API Key',
    apiKeyNote:
      '本地网关不校验 API Key，但大多数客户端要求必填 —— 随便填一个值即可（例如 optaris）。',
    overviewTitle: '概览',
    channelsCount: '渠道',
    groupsCount: '分组',
    defaultGroup: '默认分组',
    quickStartTitle: '快速上手',
    quickStartDescription: '几步完成路由配置。',
    step1Title: '添加渠道',
    step1Desc: '登记一个上游供应商，填写 base URL、API Key 和模型。',
    step2Title: '创建分组',
    step2Desc: '把一个或多个渠道组成一个路由分组。',
    step3Title: '选择默认分组',
    step3Desc: '指定所有请求默认经过哪个分组。',
    step4Title: '指向客户端',
    step4Desc: '把客户端的 base URL 设为上方的网关地址。',
    goChannels: '前往渠道',
    goGroups: '前往分组',
    goSettings: '前往设置'
  },
  channels: {
    description: '网关可路由到的上游供应商。',
    add: '添加渠道',
    addFirst: '添加第一个渠道',
    empty: '还没有渠道。',
    unnamed: '(未命名渠道)',
    duplicate: '复制渠道',
    delete: '删除渠道',
    enabled: '启用',
    name: '名称',
    namePlaceholder: '例如 OpenAI',
    baseUrl: 'Base URL',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    apiKey: 'API Key',
    apiKeyStoredHint: '已保存密钥 {preview}，留空表示保持不变。',
    apiKeySavedPlaceholder: '已保存 — 留空保持不变',
    apiKeyEnterPlaceholder: '输入 API Key',
    models: '模型',
    priceWeight: '价格权重',
    priceWeightHint: '可选。数值越大，越少被优先选用。',
    priceWeightPlaceholder: '1',
    copySuffix: ' 副本'
  },
  models: {
    addPlaceholder: '添加模型…',
    emptyPlaceholder: '输入关键词搜索，例如 gpt-4o',
    remove: '移除 {model}',
    add: '添加 “{model}”'
  },
  groups: {
    description: '一组具名的渠道，请求可在其中路由。',
    add: '添加分组',
    addFirst: '添加第一个分组',
    empty: '还没有分组。',
    unnamed: '(未命名分组)',
    delete: '删除分组',
    name: '名称',
    namePlaceholder: '例如 default',
    channels: '渠道',
    noChannels: '还没有可添加的渠道 — 请先创建渠道。'
  },
  settings: {
    routingTitle: '路由',
    routingDescription: '所有请求默认经过的分组。',
    defaultGroup: '默认分组',
    defaultGroupPlaceholder: '选择一个分组',
    createGroupFirst: '先创建分组才能设为默认。',
    captureTitle: '请求抓取',
    captureDescription: '持久化原始请求/响应内容以供排查。',
    captureEnable: '启用抓取',
    captureEnableHint: '关闭时仅记录请求摘要。',
    captureMode: '抓取模式',
    captureModePlaceholder: '选择模式',
    captureFailedOnly: '仅失败',
    captureAll: '全部请求',
    appearanceTitle: '外观',
    appearanceDescription: '此应用的语言与配色主题。',
    language: '语言',
    languageSystem: '跟随系统',
    theme: '主题',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色'
  },
  logs: {
    outcomePlaceholder: '结果',
    allOutcomes: '全部结果',
    filterModel: '按模型过滤…',
    refresh: '刷新',
    row: '条',
    rows: '条',
    time: '时间',
    outcome: '结果',
    status: '状态',
    model: '模型',
    channel: '渠道',
    tokensIn: '输入',
    tokensOut: '输出',
    empty: '还没有请求记录。'
  }
}

export default zh
