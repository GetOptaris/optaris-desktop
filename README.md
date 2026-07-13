<div align="center">

<img src="build/icon.svg" width="120" alt="Optaris" />

# Optaris

**A local LLM gateway, on your desktop.**

Point your OpenAI / Claude / Gemini clients at one local address, and Optaris
routes each request to the best of your own upstream providers — cheapest first,
always steering toward whatever has been fastest and most reliable lately.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

</div>

---

## What is Optaris?

Optaris is a desktop app that runs a local LLM gateway. You register your upstream
providers once, point your client's `base_url` at Optaris, and every request is
routed, forwarded, and logged on your own machine.

Nothing leaves your computer except the upstream calls you configure, and your
provider keys never leave the app.

## Features

- **Cost-aware smart routing.** For every request the gateway ranks your channels
  and picks one automatically — favoring the cheaper ones, while continuously
  steering traffic toward the upstreams that have performed best recently (success
  rate, first-token latency, output speed). A failing upstream is briefly benched
  and traffic fails over to the next best.
- **Drop-in for four API formats.** Speaks OpenAI Chat Completions, OpenAI
  Responses, Anthropic Messages, and Gemini, so most clients work by changing only
  their base URL.
- **Channels & groups.** Register providers as *channels*, bundle them into
  *groups*, and pick the default group every request routes through.
- **Local admission key.** Optaris issues its own `sk-optaris-…` key that clients
  must present, so no other process on your machine can use the gateway blindly.
- **Request logs & capture.** Every request is summarized (outcome, latency, token
  usage), with optional full capture for inspection — auth headers redacted.
- **Live config.** Changes you make in the UI take effect immediately, no restart.
- **Bilingual & dark mode.** English / 简体中文, following your system by default.

## Getting started

Optaris needs **Node.js (LTS) + [pnpm](https://pnpm.io/)** and **Go 1.26+**, plus
[optaris-core](https://github.com/GetOptaris/optaris-core) checked out next to this
repo (the gateway builds against it):

```
your-workspace/
├── optaris-core/      # git clone https://github.com/GetOptaris/optaris-core
└── optaris-desktop/   # this repo
```

```bash
pnpm install    # install dependencies
pnpm dev        # build the gateway, then launch the app
```

To produce a distributable build, use `pnpm build:mac`, `pnpm build:win`, or
`pnpm build:linux`.

## License

[AGPL-3.0](LICENSE) © 2026 GetOptaris
