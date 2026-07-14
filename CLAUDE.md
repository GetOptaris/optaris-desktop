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
```

Go sidecar tests (run from the `gateway/` dir so `go.work` applies):

```bash
go -C gateway test ./...
go -C gateway test -run TestPresentedKey    # single test
```

There is **no JS/TS test runner** configured — verification for the TypeScript side is `pnpm typecheck && pnpm lint`. TypeScript is split into two tsconfig projects: `tsconfig.node.json` (main + preload + shared) and `tsconfig.web.json` (renderer + shared). `shared/` is compiled by both, so it must stay isomorphic (type-only except the `GATEWAY_IPC` constants).

## Architecture

### Three trust zones, one hard security boundary

```
renderer (React UI)  ──IPC──►  main (Electron)  ──spawn/--config/--data-dir──►  gateway (Go sidecar)
   window.api.gateway            src/main/*                                      gateway/*
```

- **`src/main`** — owns the plaintext config file, the sidecar process, and the SQLite/JSONL data dir. Sole authority over secrets.
- **`src/preload`** — a thin `contextBridge` proxy exposing `window.api.gateway`; every method is just `ipcRenderer.invoke`.
- **`src/renderer`** — React control-plane UI. Never reads the config file, spawns the sidecar, or touches the DB directly, and **never receives an upstream `api_key`**.
- **`src/shared`** — the IPC wire contract (types + `GATEWAY_IPC` channel-name constants), shared by preload and main so they can't drift.
- **`gateway`** — the Go sidecar (`main.go` HTTP/auth, `config.go` config load + hot-reload, `store.go` persistence).

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

## Renderer conventions

- **i18n:** UI strings live in `src/renderer/src/i18n/en.ts` **and** `zh.ts`, keyed by screen. Add every new string to **both** files (`zh.ts` is typed as `Dict = typeof en`, so a missing key is a type error) and read it via `const t = useT()` → `t('group.key')`. Language + theme are `localStorage` UI prefs (`optaris.locale`; theme via `next-themes`), **not** gateway config; both default to following the system.
- **Theme:** dark mode is real `next-themes` (`ThemeProvider` in `main.tsx`, `attribute="class"`). `src/renderer/src/components/ui/sonner.tsx` is the **official** shadcn component using `useTheme()` — do not reintroduce a hardcoded `theme="system"`.
- **shadcn/ui:** primitives under `src/renderer/src/components/ui/**` are CLI-managed and **excluded from eslint** (see `eslint.config.mjs`); don't hand-format them to project style. Aliases `@renderer` and `@` both map to `src/renderer/src`.
- **CSP is strict** (`script-src 'self'`): no inline scripts, no remote origins. `window.open` is routed to the system browser by the main process.
