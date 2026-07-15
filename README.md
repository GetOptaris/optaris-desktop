<div align="center">

<img src="build/icon.svg" width="120" alt="Optaris" />

# Optaris

**A local LLM gateway, on your desktop.**

Point your OpenAI / Claude / Gemini clients at one local address, and Optaris routes each request to the best of your own upstream providers — cheapest first, always steering toward whatever has been fastest and most reliable lately.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

English · [简体中文](README.zh-CN.md)

</div>

---

## What is Optaris?

Optaris is a desktop app that runs a local LLM gateway. You register your upstream providers once, point your client's `base_url` at Optaris, and every request is routed, forwarded, and logged on your own machine.

Nothing leaves your computer except the upstream calls you configure, and your provider keys never leave the app.

## Features

- **Cost-aware smart routing.** For every request the gateway ranks your channels and picks one automatically — favoring the cheaper ones, while continuously steering traffic toward the upstreams that have performed best recently (success rate, first-token latency, output speed). A failing upstream is briefly benched and traffic fails over to the next best.
- **Drop-in for four API formats.** Speaks OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Gemini, so most clients work by changing only their base URL.
- **Request logs & capture.** Every request is summarized (outcome, latency, token usage), with optional full capture for inspection — auth headers redacted.

## Download & install

Grab the latest installer for your platform from the [Releases page](https://github.com/GetOptaris/optaris-desktop/releases).

### macOS

**Recommended — Homebrew Cask** (handles the quarantine flag automatically):

```bash
brew install --cask lmk123/tap/optaris
```

**Manual DMG install**

Optaris is **not yet notarized by Apple**, so downloaded builds are quarantined by Gatekeeper — this is a signing gap, not a broken download.

1. Pick the DMG for your Mac: `optaris-desktop-<version>-arm64.dmg` for Apple Silicon (M1/M2/M3…), `optaris-desktop-<version>-x64.dmg` for Intel.
2. Drag **Optaris** into your Applications folder.
3. On first launch macOS says _"Optaris is damaged and can't be opened."_ Clear the quarantine flag once, then open the app normally:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Optaris.app
   ```

### Windows

The build is unsigned, so SmartScreen may show _"Windows protected your PC."_ Click **More info → Run anyway**.

### Linux

- **AppImage** — `chmod +x Optaris-<version>.AppImage`, then run it. Self-updates.
- **.deb** — `sudo dpkg -i optaris_<version>_amd64.deb`. Updated manually.

## Build from source

Optaris needs **Node.js (LTS) + [pnpm](https://pnpm.io/)** and **Go 1.26+**, plus [optaris-core](https://github.com/GetOptaris/optaris-core) checked out next to this repo (the gateway builds against it):

```
your-workspace/
├── optaris-core/      # git clone https://github.com/GetOptaris/optaris-core
└── optaris-desktop/   # this repo
```

```bash
pnpm install    # install dependencies
pnpm dev        # build the gateway, then launch the app
```

To produce a distributable build, use `pnpm build:mac`, `pnpm build:win`, or `pnpm build:linux`.

## License

[AGPL-3.0](LICENSE) © 2026 GetOptaris
