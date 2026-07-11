import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

/**
 * Supervises the optaris-gateway sidecar process.
 *
 * The gateway is a local Go binary that embeds the optaris-core routing engine.
 * This class spawns it, reads its stdout readiness handshake to learn the bound
 * port, forwards its stderr logs, and keeps it alive across crashes with a backoff
 * (plus a crash-loop guard). On app quit we kill it explicitly; the binary also
 * self-exits if this process disappears (parent-pid watchdog), so no zombies.
 */

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8788

// Restart backoff.
const BACKOFF_INITIAL_MS = 500
const BACKOFF_MAX_MS = 30_000
const BACKOFF_FACTOR = 2
// A run lasting at least this long is considered "stable" and resets the backoff.
const STABLE_UPTIME_MS = 10_000
// Crash-loop guard: this many consecutive sub-STABLE runs stops auto-restart.
const MAX_RAPID_FAILURES = 6

interface GatewayOptions {
  host?: string
  port?: number
}

interface StartOptions {
  /** Path of the config file the gateway loads and hot-reloads (--config). */
  configPath?: string
  /** Directory for the gateway event store (--data-dir): optaris.db + capture/. */
  dataDir?: string
}

interface ReadyMessage {
  event: 'ready'
  host: string
  port: number
  pid: number
}

export class GatewayManager {
  private readonly host: string
  private readonly requestedPort: number

  private child: ChildProcess | null = null
  private stopping = false
  private port: number | null = null
  private configPath: string | null = null
  private dataDir: string | null = null
  private startedAt = 0
  private backoffMs = BACKOFF_INITIAL_MS
  private rapidFailures = 0
  private restartTimer: NodeJS.Timeout | null = null

  /** Resolves with the bound port once the gateway first reports ready. */
  private readyResolvers: Array<(port: number) => void> = []
  private readyPromise: Promise<number>

  constructor(options: GatewayOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST
    this.requestedPort = options.port ?? DEFAULT_PORT
    this.readyPromise = new Promise<number>((resolve) => {
      this.readyResolvers.push(resolve)
    })
  }

  /** Resolve the sidecar binary path for dev vs packaged. */
  private resolveBinaryPath(): string {
    const binName = process.platform === 'win32' ? 'optaris-gateway.exe' : 'optaris-gateway'
    // In dev, app.getAppPath() is the project root (where package.json lives), so
    // the freshly-built binary sits at <root>/resources/bin. When packaged it is
    // shipped via electron-builder extraResources into <resources>/bin.
    const baseDir = is.dev ? join(app.getAppPath(), 'resources', 'bin') : join(process.resourcesPath, 'bin')
    return join(baseDir, binName)
  }

  /**
   * Start the gateway and return a promise that resolves with the bound port. The
   * config/data-dir paths are remembered so automatic restarts reuse them.
   */
  start(options: StartOptions = {}): Promise<number> {
    this.stopping = false
    if (options.configPath !== undefined) this.configPath = options.configPath
    if (options.dataDir !== undefined) this.dataDir = options.dataDir
    this.spawnChild()
    return this.readyPromise
  }

  private spawnChild(): void {
    const bin = this.resolveBinaryPath()
    const args = [
      '--host',
      this.host,
      '--port',
      String(this.requestedPort),
      '--parent-pid',
      String(process.pid)
    ]
    if (this.configPath) args.push('--config', this.configPath)
    if (this.dataDir) args.push('--data-dir', this.dataDir)

    console.log(`[gateway] spawning ${bin} ${args.join(' ')}`)
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    this.startedAt = Date.now()

    // stdout carries only the structured handshake line(s).
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => this.handleStdoutLine(line))
    }

    // stderr carries human-readable logs; forward them.
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr })
      rl.on('line', (line) => console.error(`[gateway] ${line}`))
    }

    child.on('error', (err) => {
      console.error(`[gateway] failed to spawn: ${err.message}`)
    })

    child.on('exit', (code, signal) => this.handleExit(code, signal))
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: Partial<ReadyMessage>
    try {
      msg = JSON.parse(trimmed)
    } catch {
      // Not a control line; ignore (stdout should only carry handshake JSON).
      console.error(`[gateway] (stdout) ${trimmed}`)
      return
    }
    if (msg.event === 'ready' && typeof msg.port === 'number') {
      this.port = msg.port
      // A successful ready means the previous restart (if any) worked.
      console.log(`[gateway] ready on ${msg.host ?? this.host}:${msg.port} (pid=${msg.pid})`)
      const resolvers = this.readyResolvers
      this.readyResolvers = []
      for (const resolve of resolvers) resolve(msg.port)
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const uptime = Date.now() - this.startedAt
    this.child = null
    this.port = null

    if (this.stopping) {
      console.log(`[gateway] stopped (code=${code} signal=${signal})`)
      return
    }

    console.error(`[gateway] exited unexpectedly (code=${code} signal=${signal}, uptime=${uptime}ms)`)

    // Crash-loop guard: only count runs that died quickly as rapid failures.
    if (uptime < STABLE_UPTIME_MS) {
      this.rapidFailures += 1
    } else {
      this.rapidFailures = 0
      this.backoffMs = BACKOFF_INITIAL_MS
    }

    if (this.rapidFailures >= MAX_RAPID_FAILURES) {
      console.error(
        `[gateway] giving up auto-restart after ${this.rapidFailures} rapid failures; ` +
          `check that port ${this.requestedPort} is free and the binary is valid`
      )
      return
    }

    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * BACKOFF_FACTOR, BACKOFF_MAX_MS)
    console.error(`[gateway] restarting in ${delay}ms`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.stopping) this.spawnChild()
    }, delay)
  }

  /** Stop the gateway and prevent further restarts. */
  stop(): void {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    if (!child) return

    child.kill('SIGTERM')
    // Backstop: force-kill if it does not exit promptly.
    setTimeout(() => {
      if (this.child === child && child.exitCode === null) {
        child.kill('SIGKILL')
      }
    }, 3000)
  }

  /** The bound port, or null if the gateway is not currently ready. */
  getPort(): number | null {
    return this.port
  }

  /** Resolves with the bound port once the gateway first reports ready. */
  whenReady(): Promise<number> {
    return this.readyPromise
  }

  /**
   * Resolve the base URL clients point their base_url at. Uses the live port when the
   * gateway is ready; otherwise waits for the first successful handshake. The port is
   * fixed across restarts, so a transient null during a restart still resolves to the
   * correct URL.
   */
  async resolveBaseUrl(): Promise<string> {
    const port = this.port ?? (await this.readyPromise)
    return `http://${this.host}:${port}`
  }
}
