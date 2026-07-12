<div align="center">

# Optaris

**A local LLM gateway, on your desktop.**

Point your OpenAI / Claude / Gemini clients at one local address and route their
traffic across your own upstream providers — with request logs, capture, and a
config UI, all running on your machine.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

</div>

---

## What is Optaris?

Optaris is an [Electron](https://www.electronjs.org/) desktop app that runs a
local LLM gateway. The gateway is a small Go sidecar (`optaris-gateway`, built on
[optaris-core](https://github.com/GetOptaris/optaris-core)) that the app spawns
and supervises for you. You configure your upstream providers in the UI, point
your client's `base_url` at the gateway, and every request is routed, forwarded,
and logged locally.

Nothing leaves your machine except the upstream calls you configure — the gateway
binds to `127.0.0.1` only, and your provider keys never reach the renderer.

## Features

- **Drop-in for four inbound formats.** The gateway speaks OpenAI Chat
  Completions, OpenAI Responses, Anthropic Messages, and Gemini, so most existing
  clients work by only changing their base URL:

  | Format           | Endpoint                          |
  | ---------------- | --------------------------------- |
  | OpenAI Chat      | `POST /v1/chat/completions`       |
  | OpenAI Responses | `POST /v1/responses`              |
  | Anthropic        | `POST /v1/messages`               |
  | Gemini           | `POST /v1beta/models/{model}:...` |

- **Channels & groups.** Register upstream providers as *channels* (base URL, API
  key, models, price weight), bundle them into *groups*, and pick a default group
  every request routes through.
- **Local admission key.** The gateway issues its own `sk-optaris-…` key; clients
  must present it (via `Authorization: Bearer`, `x-api-key`, or `x-goog-api-key`).
  Requests without it are rejected, so other local processes can't use your
  gateway blindly.
- **Request logs & capture.** Every request is summarized (outcome, status,
  latency, token usage) and optionally captured in full (raw request/response
  round-trips) for inspection — with auth headers redacted.
- **Live config reload.** Edits made in the UI are hot-reloaded by the sidecar; no
  restart needed.
- **i18n & dark mode.** English / 简体中文, following your system language and
  color theme by default.

## Prerequisites

- **Node.js** (LTS) with [pnpm](https://pnpm.io/)
- **Go 1.26+** — needed to build the `optaris-gateway` sidecar binary
- **[optaris-core](https://github.com/GetOptaris/optaris-core)** checked out as a
  sibling directory (the gateway's Go module resolves it locally):

  ```
  your-workspace/
  ├── optaris-core/      # git clone https://github.com/GetOptaris/optaris-core
  └── optaris-desktop/   # this repo
  ```

## Getting started

```bash
# install JS dependencies
pnpm install

# run the app in development (builds the gateway sidecar first, then boots Electron)
pnpm dev
```

`pnpm dev` runs `build:gateway` automatically so the freshly built sidecar is in
place before the app starts.

## Building

Distributable builds compile the gateway for the target platform, then package
with [electron-builder](https://www.electron.build/):

```bash
pnpm build:mac      # macOS (arm64 + x64, as separate per-arch artifacts)
pnpm build:win      # Windows
pnpm build:linux    # Linux (AppImage, snap, deb)
```

On macOS you can also use `pnpm deploy:mac` for the local "build → install into
/Applications → relaunch" loop (arm64, unsigned — for development only).

## Where your data lives

Both files live under Electron's per-user `userData` directory:

- `optaris-config.json` — channels, groups, settings, and the gateway key
  (written with owner-only permissions; holds your plaintext upstream keys)
- `optaris-data/` — the event store: `optaris.db` (request summaries) plus
  `capture/` (raw round-trips, when capture is enabled)

## Project layout

| Path              | What it is                                                   |
| ----------------- | ------------------------------------------------------------ |
| `src/main`        | Electron main process — spawns/supervises the gateway, IPC   |
| `src/preload`     | Preload bridge exposing `window.api.gateway`                 |
| `src/renderer`    | React control-plane UI (dashboard, channels, groups, logs)   |
| `src/shared`      | Types shared across the IPC boundary                         |
| `gateway`         | The Go `optaris-gateway` sidecar                             |
| `scripts`         | Build & deploy helpers                                       |

## License

[AGPL-3.0](LICENSE) © 2026 GetOptaris
