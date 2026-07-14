import { homedir } from 'node:os'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { ensureGatewayApiKey } from './config'
import type { GatewayManager } from './gateway'
import type { ApplyClientResult, ClientId, ClientStatus } from '../shared/gateway'

/**
 * Auto-configure external client apps to point their base URL + API key at the local
 * gateway — the one-click alternative to the user hand-editing each client's config.
 *
 * This is the ONLY module that writes files outside Electron's userData: it reaches into
 * the user's home dir (`~/.claude`, `~/.codex`, `~/.gemini`, Claude Desktop's app-support
 * dirs). Every write is read-merge-write (existing unrelated keys are preserved) and
 * atomic (temp file + rename, owner-only perms), mirroring config.ts's writeConfig — the
 * files carry the gateway admission key, so they are treated as secrets.
 *
 * The exact per-client fields are dictated by the gateway's HTTP surface (gateway/main.go):
 * routes are mounted at the server root — `/v1/messages` (Claude), `/v1/responses` +
 * `/v1/chat/completions` (OpenAI), `/v1beta/models/...` (Gemini) — so OpenAI-style clients
 * (Codex) need a `/v1` base while Anthropic/Gemini clients point at the bare root. The
 * admission middleware accepts Bearer / x-api-key / x-goog-api-key / ?key=, covering all four.
 */

// ---------------------------------------------------------------------------
// Small filesystem helpers (lenient reads for detection, strict reads for writes).
// ---------------------------------------------------------------------------

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8')
  } catch {
    return null
  }
}

/** Atomic write (temp + rename), owner-only perms. Parent dirs are created as needed. */
async function writeFileAtomic(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 })
  await rename(tmp, path)
}

/** Coerce an unknown into a plain object (never an array), for safe nested merges. */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Lenient parse for detection: a missing or malformed file reads as an empty object. */
async function readJsonLenient(p: string): Promise<Record<string, unknown>> {
  const text = await readTextIfExists(p)
  if (!text || text.trim() === '') return {}
  try {
    return asRecord(JSON.parse(text))
  } catch {
    return {}
  }
}

/**
 * Strict parse for writes: a missing/empty file is fine (starts from {}), but an existing
 * file that isn't a JSON object throws rather than being clobbered — we never destroy a
 * config we can't safely merge into.
 */
async function readJsonStrict(p: string): Promise<Record<string, unknown>> {
  const text = await readTextIfExists(p)
  if (!text || text.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${p} is not valid JSON; refusing to overwrite it`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${p} is not a JSON object; refusing to overwrite it`)
  }
  return parsed as Record<string, unknown>
}

/** Upsert `KEY=VALUE` lines into a dotenv body, preserving existing unrelated lines/comments. */
function upsertDotenv(existing: string, updates: Record<string, string>): string {
  const remaining = new Map(Object.entries(updates))
  const lines = existing.split(/\r?\n/)
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  const out = lines.map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m && remaining.has(m[1])) {
      const key = m[1]
      const value = remaining.get(key) as string
      remaining.delete(key)
      return `${key}=${value}`
    }
    return line
  })
  for (const [key, value] of remaining) out.push(`${key}=${value}`)
  return out.join('\n') + '\n'
}

/** Read one `KEY=VALUE` from a dotenv body (unquoted), or null if absent. */
function readDotenv(text: string, key: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (m && m[1] === key) {
      return m[2].trim().replace(/^["']|["']$/g, '') || null
    }
  }
  return null
}

/** Compare two base URLs ignoring a trailing slash. A null/empty `a` never matches. */
function sameBaseUrl(a: string | null | undefined, b: string): boolean {
  if (!a) return false
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
}

/**
 * Best-effort fetch of the gateway's active-group model ids from GET /v1/models (OpenAI list
 * shape). Returns [] on any error (gateway down, non-200, malformed body) so callers can treat
 * "no models" and "couldn't reach the gateway" the same way.
 */
async function fetchGatewayModels(baseUrl: string, key: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/v1/models`, { headers: { Authorization: `Bearer ${key}` } })
    if (!res.ok) return []
    const data = asRecord(await res.json()).data
    if (!Array.isArray(data)) return []
    return data
      .map((m) => asRecord(m).id)
      .filter((id): id is string => typeof id === 'string' && id !== '')
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Claude Desktop: the enterprise "inference gateway" profile (macOS/Windows only).
//
// Desktop exposes no plain base-URL setting, so — like cc-switch — we impersonate the
// enterprise inference-gateway profile: write a profile file into the Claude-3p config
// library, register it in _meta.json as the applied profile, and flip both config files
// to deploymentMode "3p". This is reverse-engineered and fragile (a Desktop update can
// break it); it is surfaced in the UI as experimental.
//
// The advertised model list is seeded from the gateway's own /v1/models (the active group's
// servable models) only when the profile has none yet — an existing list is preserved, so we
// touch just the gateway wiring on re-connect. Desktop can also refresh models from /v1/models
// itself via its "auto-read models" option.
// ---------------------------------------------------------------------------

const CD_PROFILE_ID = '6f707461-7269-4573-8000-000000000001'
const CD_PROFILE_NAME = 'Optaris'
const CD_CONFIG_FILE = 'claude_desktop_config.json'
const CD_LIBRARY_DIR = 'configLibrary'

interface ClaudeDesktopPaths {
  normalConfig: string
  threepConfig: string
  profile: string
  meta: string
}

function claudeDesktopPaths(): ClaudeDesktopPaths | null {
  const home = homedir()
  if (process.platform === 'darwin') {
    const appSupport = join(home, 'Library', 'Application Support')
    return buildClaudeDesktopPaths(join(appSupport, 'Claude'), join(appSupport, 'Claude-3p'))
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return buildClaudeDesktopPaths(join(localAppData, 'Claude'), join(localAppData, 'Claude-3p'))
  }
  return null
}

function buildClaudeDesktopPaths(normalDir: string, threepDir: string): ClaudeDesktopPaths {
  const library = join(threepDir, CD_LIBRARY_DIR)
  return {
    normalConfig: join(normalDir, CD_CONFIG_FILE),
    threepConfig: join(threepDir, CD_CONFIG_FILE),
    profile: join(library, `${CD_PROFILE_ID}.json`),
    meta: join(library, '_meta.json')
  }
}

async function applyClaudeDesktop(url: string, key: string): Promise<string[]> {
  const p = claudeDesktopPaths()
  if (!p) throw new Error('Claude Desktop auto-config is only supported on macOS and Windows')
  const written: string[] = []

  // Read-merge the profile: overwrite only the gateway wiring, preserving any other keys
  // (notably a user-set inferenceModels). Seed inferenceModels from the gateway's /v1/models
  // only when none is set yet.
  const profile = await readJsonStrict(p.profile)
  profile.coworkEgressAllowedHosts = ['*']
  profile.disableDeploymentModeChooser = true
  profile.inferenceGatewayApiKey = key
  profile.inferenceGatewayAuthScheme = 'bearer'
  profile.inferenceGatewayBaseUrl = url
  profile.inferenceProvider = 'gateway'
  const existingModels = profile.inferenceModels
  if (!Array.isArray(existingModels) || existingModels.length === 0) {
    const models = await fetchGatewayModels(url, key)
    if (models.length > 0) profile.inferenceModels = models
  }
  await writeFileAtomic(p.profile, JSON.stringify(profile, null, 2))
  written.push(p.profile)

  const meta = await readJsonStrict(p.meta)
  const existing = Array.isArray(meta.entries) ? (meta.entries as unknown[]) : []
  const entries = existing.filter((e) => asRecord(e).id !== CD_PROFILE_ID)
  entries.push({ id: CD_PROFILE_ID, name: CD_PROFILE_NAME })
  meta.entries = entries
  meta.appliedId = CD_PROFILE_ID
  await writeFileAtomic(p.meta, JSON.stringify(meta, null, 2))
  written.push(p.meta)

  for (const cfg of [p.normalConfig, p.threepConfig]) {
    const obj = await readJsonStrict(cfg)
    obj.deploymentMode = '3p'
    obj.disableDeploymentModeChooser = true
    await writeFileAtomic(cfg, JSON.stringify(obj, null, 2))
    written.push(cfg)
  }
  return written
}

async function claudeDesktopBaseUrl(): Promise<string | null> {
  const p = claudeDesktopPaths()
  if (!p) return null
  const profile = await readJsonLenient(p.profile)
  const url = profile.inferenceGatewayBaseUrl
  return typeof url === 'string' && url ? url : null
}

// ---------------------------------------------------------------------------
// Per-client specs.
// ---------------------------------------------------------------------------

const CODEX_PROVIDER_ID = 'optaris'

interface ClientSpec {
  id: ClientId
  supported: () => boolean
  configPaths: () => string[]
  detect: () => Promise<boolean>
  /** The base URL the client currently points at (raw value from its config), or null. */
  currentBaseUrl: () => Promise<string | null>
  /** The base URL this client should hold once pointed at the gateway (Codex needs `/v1`). */
  expectedBaseUrl: (gatewayUrl: string) => string
  /** Write the client's config file(s); returns the paths written. */
  apply: (gatewayUrl: string, key: string) => Promise<string[]>
}

const claudeCodeSettings = (): string => join(homedir(), '.claude', 'settings.json')
const codexConfig = (): string => join(homedir(), '.codex', 'config.toml')
const codexAuth = (): string => join(homedir(), '.codex', 'auth.json')
const geminiEnv = (): string => join(homedir(), '.gemini', '.env')
const geminiSettings = (): string => join(homedir(), '.gemini', 'settings.json')

const SPECS: ClientSpec[] = [
  {
    id: 'claude_code',
    supported: () => true,
    configPaths: () => [claudeCodeSettings()],
    detect: () => pathExists(join(homedir(), '.claude')),
    currentBaseUrl: async () => {
      const env = asRecord((await readJsonLenient(claudeCodeSettings())).env)
      const url = env.ANTHROPIC_BASE_URL
      return typeof url === 'string' && url ? url : null
    },
    expectedBaseUrl: (gatewayUrl) => gatewayUrl,
    apply: async (gatewayUrl, key) => {
      const path = claudeCodeSettings()
      const obj = await readJsonStrict(path)
      const env = asRecord(obj.env)
      env.ANTHROPIC_BASE_URL = gatewayUrl
      env.ANTHROPIC_AUTH_TOKEN = key
      obj.env = env
      await writeFileAtomic(path, JSON.stringify(obj, null, 2))
      return [path]
    }
  },
  {
    id: 'claude_desktop',
    supported: () => claudeDesktopPaths() !== null,
    configPaths: () => {
      const p = claudeDesktopPaths()
      return p ? [p.profile, p.meta, p.normalConfig, p.threepConfig] : []
    },
    detect: async () => {
      const p = claudeDesktopPaths()
      return p ? pathExists(dirname(p.normalConfig)) : false
    },
    currentBaseUrl: claudeDesktopBaseUrl,
    expectedBaseUrl: (gatewayUrl) => gatewayUrl,
    apply: applyClaudeDesktop
  },
  {
    id: 'codex',
    supported: () => true,
    configPaths: () => [codexConfig(), codexAuth()],
    detect: () => pathExists(join(homedir(), '.codex')),
    currentBaseUrl: async () => {
      const text = await readTextIfExists(codexConfig())
      if (!text) return null
      let root: Record<string, unknown>
      try {
        root = parseToml(text) as Record<string, unknown>
      } catch {
        return null
      }
      const activeId = typeof root.model_provider === 'string' ? root.model_provider : ''
      if (!activeId) return null
      const provider = asRecord(asRecord(root.model_providers)[activeId])
      const url = provider.base_url
      return typeof url === 'string' && url ? url : null
    },
    expectedBaseUrl: (gatewayUrl) => `${gatewayUrl}/v1`,
    apply: async (gatewayUrl, key) => {
      const configPath = codexConfig()
      const text = await readTextIfExists(configPath)
      let root: Record<string, unknown> = {}
      if (text && text.trim() !== '') {
        try {
          root = parseToml(text) as Record<string, unknown>
        } catch {
          throw new Error(`${configPath} is not valid TOML; refusing to overwrite it`)
        }
      }
      root.model_provider = CODEX_PROVIDER_ID
      const providers = asRecord(root.model_providers)
      providers[CODEX_PROVIDER_ID] = {
        name: 'Optaris',
        base_url: `${gatewayUrl}/v1`,
        wire_api: 'responses',
        requires_openai_auth: true
      }
      root.model_providers = providers
      await writeFileAtomic(configPath, stringifyToml(root as Parameters<typeof stringifyToml>[0]))

      const authPath = codexAuth()
      const auth = await readJsonStrict(authPath)
      auth.OPENAI_API_KEY = key
      await writeFileAtomic(authPath, JSON.stringify(auth, null, 2))
      return [configPath, authPath]
    }
  },
  {
    id: 'gemini_cli',
    supported: () => true,
    configPaths: () => [geminiEnv(), geminiSettings()],
    detect: () => pathExists(join(homedir(), '.gemini')),
    currentBaseUrl: async () => {
      const text = await readTextIfExists(geminiEnv())
      return text ? readDotenv(text, 'GOOGLE_GEMINI_BASE_URL') : null
    },
    expectedBaseUrl: (gatewayUrl) => gatewayUrl,
    apply: async (gatewayUrl, key) => {
      const envPath = geminiEnv()
      const merged = upsertDotenv(await readTextIfExists(envPath).then((t) => t ?? ''), {
        GOOGLE_GEMINI_BASE_URL: gatewayUrl,
        GEMINI_API_KEY: key
      })
      await writeFileAtomic(envPath, merged)

      const settingsPath = geminiSettings()
      const settings = await readJsonStrict(settingsPath)
      const security = asRecord(settings.security)
      const auth = asRecord(security.auth)
      auth.selectedType = 'gemini-api-key'
      security.auth = auth
      settings.security = security
      await writeFileAtomic(settingsPath, JSON.stringify(settings, null, 2))
      return [envPath, settingsPath]
    }
  }
]

// ---------------------------------------------------------------------------
// IPC-facing entry points.
// ---------------------------------------------------------------------------

/**
 * Report each client's current wiring for the dashboard's "Connect your clients" card:
 * whether it's installed, the base URL it points at today, and whether that is already
 * this gateway. The gateway URL is resolved once and reused across clients.
 */
export async function listClients(gateway: GatewayManager): Promise<ClientStatus[]> {
  const gatewayUrl = await gateway.resolveBaseUrl()
  return Promise.all(
    SPECS.map(async (spec) => {
      const supported = spec.supported()
      const detected = supported ? await spec.detect() : false
      const currentBaseUrl = detected ? await spec.currentBaseUrl() : null
      const connected = sameBaseUrl(currentBaseUrl, spec.expectedBaseUrl(gatewayUrl))
      return {
        id: spec.id,
        supported,
        detected,
        connected,
        current_base_url: currentBaseUrl,
        config_paths: spec.configPaths()
      }
    })
  )
}

/**
 * Point one client at this gateway by writing its config file(s). Resolves the gateway URL
 * and ensures a non-empty admission key exists (generating+persisting one if the gateway
 * was running open), then read-merge-writes. Returns an ok flag + written paths rather than
 * throwing, so the renderer can toast a message on failure.
 */
export async function applyClient(
  gateway: GatewayManager,
  id: ClientId
): Promise<ApplyClientResult> {
  const spec = SPECS.find((s) => s.id === id)
  if (!spec) return { ok: false, written_paths: [], message: `unknown client: ${id}` }
  if (!spec.supported()) {
    return { ok: false, written_paths: [], message: `${id} is not supported on this platform` }
  }
  try {
    const gatewayUrl = await gateway.resolveBaseUrl()
    const key = await ensureGatewayApiKey()
    const written = await spec.apply(gatewayUrl, key)
    return { ok: true, written_paths: written }
  } catch (err) {
    return {
      ok: false,
      written_paths: [],
      message: err instanceof Error ? err.message : String(err)
    }
  }
}
