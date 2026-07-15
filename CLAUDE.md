# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Optaris is an Electron desktop app that runs a **local LLM gateway**. It spawns and supervises a small Go sidecar (`optaris-gateway`, built on the sibling `optaris-core` module) that listens on `127.0.0.1`, accepts requests in four inbound formats (OpenAI Chat, OpenAI Responses, Anthropic Messages, Gemini), and forwards them to user-configured upstream providers. The Electron app is only the **control plane** (config UI, logs); the **data plane** (actual LLM traffic) goes straight to the Go process and never touches Electron.

## Prerequisites & repo layout

The gateway's Go module resolves `optaris-core` **locally as a sibling directory** — it is unpublished, required at placeholder `v0.0.0`, so no proxy can fetch it:

```
your-workspace/
├── optaris-core/      # git clone; must exist for the gateway to build
└── optaris-desktop/   # this repo
```

`gateway/go.mod` has `replace github.com/getoptaris/optaris-core => ../../optaris-core` and `gateway/go.work` uses both modules. **Keep the replace directive** — `go.work` alone lets `go build`/`go vet` resolve the local module, but graph-computing commands (`go get` / `go mod tidy` / `go list -m all`) still try to fetch `v0.0.0` and fail without it. To add a Go dep: `go -C gateway get <mod>@latest`, then (only after a `.go` file imports it) `go -C gateway mod tidy`.

Requires Node LTS + pnpm, and **Go 1.26+**.

## Commands

```bash
pnpm install            # postinstall runs electron-builder install-app-deps
pnpm dev                # predev builds the gateway sidecar, then boots Electron (HMR)
pnpm build              # typecheck + electron-vite build (no packaging)

pnpm lint               # eslint (ui/ primitives are ignored — see below)
pnpm format             # prettier --write .
pnpm typecheck          # runs BOTH projects: typecheck:node + typecheck:web

pnpm build:gateway              # build sidecar for host platform into resources/bin/
pnpm build:mac  / :win / :linux # full packaged builds (electron-builder)
pnpm deploy:mac                 # local loop: build arm64 .app → install to /Applications → relaunch (unsigned)
pnpm gen:runtime-icon           # regen resources/icon.png from build/icon.svg (runtime icon only)
```

Icons are two separate artifacts: electron-builder rasterizes `build/icon.svg` at pack time (app/installer icons), while `resources/icon.png` is the runtime window icon — regenerate it with `pnpm gen:runtime-icon` after changing the SVG.

Go sidecar tests (run from the `gateway/` dir so `go.work` applies):

```bash
go -C gateway test ./...
go -C gateway test -run TestPresentedKey    # single test
```

There is **no JS/TS test runner** configured — verification for the TypeScript side is `pnpm typecheck && pnpm lint`. TypeScript is split into two tsconfig projects: `tsconfig.node.json` (main + preload + shared) and `tsconfig.web.json` (renderer + shared). `shared/` is compiled by both, so it must stay isomorphic (type-only except the `GATEWAY_IPC` and `UPDATER_IPC` channel constants).

## Architecture

### Three trust zones, one hard security boundary

```
renderer (React UI)  ──IPC──►  main (Electron)  ──spawn/--config/--data-dir──►  gateway (Go sidecar)
   window.api.gateway            src/main/*                                      gateway/*
```

- **`src/main`** — owns the plaintext config file, the sidecar process, and the SQLite/JSONL data dir. Sole authority over secrets.
- **`src/preload`** — a thin `contextBridge` proxy exposing `window.api.gateway`; every method is just `ipcRenderer.invoke`.
- **`src/renderer`** — React control-plane UI. Never reads the config file, spawns the sidecar, or touches the DB directly, and **never receives an upstream `api_key`**.
- **`src/shared`** — the IPC wire contracts (types + channel-name constants), shared by preload and main so they can't drift: `gateway.ts` (`GATEWAY_IPC`) and `updater.ts` (`UPDATER_IPC`).
- **`gateway`** — the Go sidecar (`main.go` HTTP/auth, `config.go` config load + hot-reload, `store.go` persistence, `models.go` the `/v1/models` list endpoint).

**The security invariant (touches config.ts, ipc.ts, shared/gateway.ts, useGatewayConfig.ts):** an upstream channel `api_key` lives only in the main process and the Go process. Reads return a `DisplayConfig` where each key is stripped to a `has_api_key` boolean + masked `api_key_preview`. Writes send a `ConfigInput` where `api_key` is optional: **empty/omitted means "keep the stored key"**, only a non-empty value overwrites (`mergeConfig`). The one exception is `gateway_api_key` — the gateway's _own_ client-facing admission key — which is passed to the renderer in full because the user must copy it into their clients. When adding a field that could carry a secret, note `sanitizeConfig` is a deliberate allow-list (explicit field copy, not omit-destructuring).

### Config: one document, two type shapes, snake_case throughout

The on-disk JSON is the wire contract between TypeScript main and Go. **Field names are snake_case on purpose** to match the Go `json` tags — the same document is parsed by `GatewayConfig` (src/main/config.ts) and `gatewayConfig` (gateway/config.go) field-for-field. Renaming to camelCase on one side silently breaks the other. There are three parallel type families you must keep in sync when adding a config field:

1. `src/main/config.ts` — `GatewayConfig` (on-disk, holds plaintext keys)
2. `src/shared/gateway.ts` — `DisplayConfig` (read shape, key stripped) + `ConfigInput` (write shape)
3. `gateway/config.go` — `gatewayConfig` / `wireChannel` / `wireGroup`

Config lives under Electron's `userData`: `optaris-config.json` (owner-only `0600`, written atomically via temp-file+rename) and `optaris-data/` (`optaris.db` + `capture/`).

### Gateway supervision & hot-reload

`GatewayManager` (src/main/gateway.ts) spawns the binary with `--host/--port/--parent-pid/--config/--data-dir`, reads a single JSON **readiness handshake line on stdout** to learn the bound port (stderr carries logs), and restarts on crash with exponential backoff + a crash-loop guard. The port is fixed across restarts. The Go side self-exits if its parent PID changes (watchdog), so no zombies.

Config changes are **not signaled** — the main process just writes the file, and the Go sidecar picks it up via **mtime polling** (`configHolder.watch`, every 2s) and calls `eng.LoadConfig` + swaps an atomic pointer. This is why editing config in the UI hot-reloads without a restart, and why `regenerateApiKey` doesn't need to talk to the sidecar.

### Persistence & reading it back

The Go sidecar is the **sole writer** of `optaris.db` (opened WAL mode) and the day-rolling `capture/YYYY-MM-DD.jsonl` files. It uses the **pure-Go `modernc.org/sqlite`** driver so builds stay `CGO_ENABLED=0` (static, cross-compilable) — do not swap in a cgo SQLite. Events flow through a buffered channel drained by a single goroutine (drops-and-counts on overflow; requests are never blocked for logging).

The main process reads this data **read-only**: `logs.ts` uses `node:sqlite` (bundled with Electron's Node — no native module) to `SELECT` from the WAL DB concurrently; `trace.ts` scans the JSONL capture files by day since there's no index. When changing the `requests` table schema in `store.go`, update the `COLUMNS` list in `logs.ts` and the `LogRow` type in `shared/gateway.ts` to match.

### Client auto-config: the second place secrets touch disk

`src/main/clients.ts` one-click-configures external client apps (Claude Code `~/.claude`, Codex `~/.codex` via TOML, Gemini `~/.gemini`, Claude Desktop's app-support dir) to point their base URL + key at the local gateway. It is the **only module that writes outside Electron's `userData`**, reaching into the user's home dir — so it mirrors `config.ts`: every write is read-merge-write (unrelated keys preserved) + atomic (temp-file+rename, `0600`), because the files carry the gateway admission key and are treated as secrets. The per-client shape is dictated by the gateway's root-mounted routes — `/v1/messages` (Claude), `/v1/responses` + `/v1/chat/completions` (OpenAI/Codex, needs a `/v1` base), `/v1beta/models/…` (Gemini) — and the admission middleware accepts Bearer / `x-api-key` / `x-goog-api-key` / `?key=`.

### App self-update

`src/main/updater.ts` (+ the `src/shared/updater.ts` IPC contract and `update-notifier.tsx` in the renderer) wraps `electron-updater` against the GitHub Releases feed (provider derived from package.json `repository`). The model is **notify-on-discovery**: `autoDownload` is off, so a check only surfaces `update-available` and the renderer asks before downloading. **macOS is unsigned**, so we never call `downloadUpdate()` there (Squirrel.Mac would reject the signature) — the notification links out to the release page for a manual download; Windows/Linux download in-app.

### Releasing

Push a `v*` tag to trigger `.github/workflows/release.yml`: it creates one draft GitHub Release, then three OS jobs build and upload into it via the `build:mac:publish` / `build:win:publish` / `build:linux:publish` scripts (`electron-builder -p always`). **The tag must exactly match package.json `version`** (`v1.2.3` ↔ `1.2.3`) or CI fails before building. CI checks out `optaris-core` as a sibling automatically, satisfying the go.mod replace layout. Review the draft, then publish it manually.

When the draft is published, `.github/workflows/update-cask.yml` fires automatically: it reads each macOS DMG's sha256 digest from the GitHub API (no download), renders `build/homebrew/optaris.rb.tmpl`, and pushes the result to `lmk123/homebrew-tap` as `Casks/optaris.rb`. This requires a fine-grained PAT with `Contents: Read and write` on `lmk123/homebrew-tap` stored as the `HOMEBREW_TAP_TOKEN` repository secret in this repo.

## Renderer conventions

- **i18n:** UI strings live in `src/renderer/src/i18n/en.ts` **and** `zh.ts`, keyed by screen. Add every new string to **both** files (`zh.ts` is typed as `Dict = typeof en`, so a missing key is a type error) and read it via `const t = useT()` → `t('group.key')`. Language + theme are `localStorage` UI prefs (`optaris.locale`; theme via `next-themes`), **not** gateway config; both default to following the system.
- **Theme:** dark mode is real `next-themes` (`ThemeProvider` in `main.tsx`, `attribute="class"`). `src/renderer/src/components/ui/sonner.tsx` is the **official** shadcn component using `useTheme()` — do not reintroduce a hardcoded `theme="system"`.
- **shadcn/ui:** primitives under `src/renderer/src/components/ui/**` are CLI-managed and **excluded from eslint** (see `eslint.config.mjs`); don't hand-format them to project style. Aliases `@renderer` and `@` both map to `src/renderer/src`.
- **CSP is strict** (`script-src 'self'`): no inline scripts, no remote origins. `window.open` is routed to the system browser by the main process.
