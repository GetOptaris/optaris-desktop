/**
 * A static, curated list of common model ids used to power keyword suggestions in the
 * models input. It is intentionally offline (no network / no upstream call) — the
 * trade-off is that it goes stale and needs occasional manual updates. Users can always
 * type a model id that isn't in this list; suggestions are a convenience, not a limit.
 */
export interface KnownModel {
  id: string
  provider: string
}

export const KNOWN_MODELS: KnownModel[] = [
  // OpenAI
  { id: 'gpt-4o', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', provider: 'OpenAI' },
  { id: 'gpt-4.1', provider: 'OpenAI' },
  { id: 'gpt-4.1-mini', provider: 'OpenAI' },
  { id: 'gpt-4.1-nano', provider: 'OpenAI' },
  { id: 'o3', provider: 'OpenAI' },
  { id: 'o3-mini', provider: 'OpenAI' },
  { id: 'o4-mini', provider: 'OpenAI' },
  { id: 'gpt-4-turbo', provider: 'OpenAI' },
  { id: 'gpt-3.5-turbo', provider: 'OpenAI' },
  { id: 'text-embedding-3-large', provider: 'OpenAI' },
  { id: 'text-embedding-3-small', provider: 'OpenAI' },

  // Anthropic
  { id: 'claude-opus-4-1', provider: 'Anthropic' },
  { id: 'claude-opus-4-0', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-5', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-0', provider: 'Anthropic' },
  { id: 'claude-3-7-sonnet-latest', provider: 'Anthropic' },
  { id: 'claude-3-5-sonnet-latest', provider: 'Anthropic' },
  { id: 'claude-3-5-haiku-latest', provider: 'Anthropic' },
  { id: 'claude-3-opus-latest', provider: 'Anthropic' },

  // Google Gemini
  { id: 'gemini-2.5-pro', provider: 'Google' },
  { id: 'gemini-2.5-flash', provider: 'Google' },
  { id: 'gemini-2.0-flash', provider: 'Google' },
  { id: 'gemini-2.0-flash-lite', provider: 'Google' },
  { id: 'gemini-1.5-pro', provider: 'Google' },
  { id: 'gemini-1.5-flash', provider: 'Google' },

  // DeepSeek
  { id: 'deepseek-chat', provider: 'DeepSeek' },
  { id: 'deepseek-reasoner', provider: 'DeepSeek' },

  // Alibaba Qwen
  { id: 'qwen-max', provider: 'Qwen' },
  { id: 'qwen-plus', provider: 'Qwen' },
  { id: 'qwen-turbo', provider: 'Qwen' },
  { id: 'qwen2.5-72b-instruct', provider: 'Qwen' },
  { id: 'qwen2.5-coder-32b-instruct', provider: 'Qwen' },

  // Moonshot / Kimi
  { id: 'moonshot-v1-8k', provider: 'Moonshot' },
  { id: 'moonshot-v1-32k', provider: 'Moonshot' },
  { id: 'moonshot-v1-128k', provider: 'Moonshot' },
  { id: 'kimi-k2-0711-preview', provider: 'Moonshot' },

  // Zhipu GLM
  { id: 'glm-4-plus', provider: 'Zhipu' },
  { id: 'glm-4-air', provider: 'Zhipu' },
  { id: 'glm-4-flash', provider: 'Zhipu' },

  // Mistral
  { id: 'mistral-large-latest', provider: 'Mistral' },
  { id: 'mistral-small-latest', provider: 'Mistral' },
  { id: 'open-mistral-nemo', provider: 'Mistral' },
  { id: 'codestral-latest', provider: 'Mistral' },

  // xAI
  { id: 'grok-4', provider: 'xAI' },
  { id: 'grok-3', provider: 'xAI' },
  { id: 'grok-3-mini', provider: 'xAI' },

  // Meta Llama (common OpenAI-compatible ids)
  { id: 'llama-3.3-70b-instruct', provider: 'Meta' },
  { id: 'llama-3.1-405b-instruct', provider: 'Meta' },
  { id: 'llama-3.1-8b-instruct', provider: 'Meta' }
]

/**
 * Case-insensitive substring match over model ids, excluding already-selected models.
 * Returns at most `limit` suggestions (default 8).
 */
export function searchModels(query: string, exclude: string[], limit = 8): KnownModel[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const taken = new Set(exclude)
  const out: KnownModel[] = []
  for (const m of KNOWN_MODELS) {
    if (taken.has(m.id)) continue
    if (m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)) {
      out.push(m)
      if (out.length >= limit) break
    }
  }
  return out
}
