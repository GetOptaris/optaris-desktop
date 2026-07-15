<div align="center">

<img src="build/icon.svg" width="120" alt="Optaris" />

# Optaris

**运行在桌面端的本地 LLM 网关。**

把你的 OpenAI / Claude / Gemini 客户端指向同一个本地地址，Optaris 就会把每个请求路由到你自己的上游供应商中最合适的那个——价格优先，并持续把流量导向近期表现最好的渠道。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

[English](README.md) · 简体中文

</div>

---

## Optaris 是什么？

Optaris 是一个桌面应用，内置一个本地 LLM 网关。你只需注册一次上游供应商，把客户端的 `base_url` 指向 Optaris，之后每个请求都会在你自己的机器上被路由、转发并记录。

除了你配置的上游调用之外，没有任何数据离开你的电脑，你的供应商密钥也永远不会离开应用。

## 功能特性

- **价格优先的智能路由。** 每个请求，网关都会给你的渠道打分并自动选择——优先选更便宜的，同时持续把流量导向近期表现最好的上游（成功率、首字延迟、输出速度）。出问题的上游会被临时冷却，流量自动切换到下一个最优渠道。
- **兼容四种 API 格式。** 支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 和 Gemini，大多数客户端只需改一下 base URL 即可使用。
- **请求日志与抓包。** 每个请求都会被汇总（结果、延迟、token 用量），并可选择完整抓包以供排查——鉴权头会被脱敏。

## 下载与安装

从 [Releases 页面](https://github.com/GetOptaris/optaris-desktop/releases)下载对应平台的安装包。

### macOS

**推荐方式 — Homebrew Cask**（自动处理 Gatekeeper 隔离，无需手动执行 `xattr`）：

```bash
brew install --cask lmk123/tap/optaris
```

**手动 DMG 安装**

Optaris **尚未通过 Apple 公证（notarization）**，因此下载的安装包会被 Gatekeeper 隔离——这是签名缺失，并非文件损坏。

1. 选择适合你 Mac 的 DMG：Apple 芯片（M1/M2/M3…）用 `optaris-desktop-<version>-arm64.dmg`，Intel 芯片用 `optaris-desktop-<version>-x64.dmg`。
2. 把 **Optaris** 拖入"应用程序"文件夹。
3. 首次打开时 macOS 会提示 _"Optaris 已损坏，无法打开"_。执行下面的命令清除一次隔离属性，之后就能正常双击打开：

   ```bash
   xattr -dr com.apple.quarantine /Applications/Optaris.app
   ```

### Windows

安装包未签名，SmartScreen 可能提示 _"Windows 已保护你的电脑"_。点击 **更多信息 → 仍要运行**。

### Linux

- **AppImage** — `chmod +x Optaris-<version>.AppImage` 后直接运行，可自动更新。
- **.deb** — `sudo dpkg -i optaris_<version>_amd64.deb`，需手动更新。

## 从源码构建

Optaris 需要 **Node.js（LTS）+ [pnpm](https://pnpm.io/)** 和 **Go 1.26+**，并把 [optaris-core](https://github.com/GetOptaris/optaris-core) clone 到本仓库的同级目录（网关会基于它构建）：

```
your-workspace/
├── optaris-core/      # git clone https://github.com/GetOptaris/optaris-core
└── optaris-desktop/   # 本仓库
```

```bash
pnpm install    # 安装依赖
pnpm dev        # 先编译网关，再启动应用
```

如需生成可分发的安装包，使用 `pnpm build:mac`、`pnpm build:win` 或 `pnpm build:linux`。

## 许可证

[AGPL-3.0](LICENSE) © 2026 GetOptaris
