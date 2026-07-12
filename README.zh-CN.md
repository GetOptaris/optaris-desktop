<div align="center">

# Optaris

**运行在桌面端的本地 LLM 网关。**

把你的 OpenAI / Claude / Gemini 客户端指向同一个本地地址，即可将它们的流量路由到你自己的
上游供应商——请求日志、抓包和配置界面，全部在本机运行。

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

[English](README.md) · 简体中文

</div>

---

## Optaris 是什么？

Optaris 是一个基于 [Electron](https://www.electronjs.org/) 的桌面应用，内置一个本地 LLM 网关。
网关本身是一个小巧的 Go sidecar（`optaris-gateway`，基于
[optaris-core](https://github.com/GetOptaris/optaris-core) 构建），由应用负责拉起和守护。
你在界面里配置好上游供应商，把客户端的 `base_url` 指向网关，之后每个请求都会在本地被路由、
转发并记录。

除了你配置的上游调用之外，没有任何数据离开你的机器——网关只监听 `127.0.0.1`，你的供应商密钥
也永远不会到达渲染进程。

## 功能特性

- **兼容四种入站格式。** 网关支持 OpenAI Chat Completions、OpenAI Responses、Anthropic
  Messages 和 Gemini，大多数现有客户端只需改一下 base URL 即可使用：

  | 格式             | Endpoint                          |
  | ---------------- | --------------------------------- |
  | OpenAI Chat      | `POST /v1/chat/completions`       |
  | OpenAI Responses | `POST /v1/responses`              |
  | Anthropic        | `POST /v1/messages`               |
  | Gemini           | `POST /v1beta/models/{model}:...` |

- **渠道与分组。** 把上游供应商注册为「渠道」（base URL、API key、模型、价格权重），再把它们
  组合成「分组」，并选择一个所有请求默认经过的分组。
- **本地准入密钥。** 网关会签发自己的 `sk-optaris-…` 密钥，客户端必须携带它（通过
  `Authorization: Bearer`、`x-api-key` 或 `x-goog-api-key`），否则请求会被拒绝——避免本机
  其它进程盲目调用你的网关。
- **请求日志与抓包。** 每个请求都会被汇总（结果、状态、延迟、token 用量），并可选择完整抓包
  （原始的请求/响应往返）以供排查——鉴权头会被脱敏。
- **配置热更新。** 界面里的改动会被 sidecar 热加载，无需重启。
- **国际化与暗色模式。** 支持 English / 简体中文，默认跟随系统语言与配色。

## 前置依赖

- **Node.js**（LTS 版）与 [pnpm](https://pnpm.io/)
- **Go 1.26+**——用于编译 `optaris-gateway` sidecar 二进制
- 把 **[optaris-core](https://github.com/GetOptaris/optaris-core)** 作为同级目录 clone 下来
  （网关的 Go module 会在本地解析它）：

  ```
  your-workspace/
  ├── optaris-core/      # git clone https://github.com/GetOptaris/optaris-core
  └── optaris-desktop/   # 本仓库
  ```

## 快速开始

```bash
# 安装 JS 依赖
pnpm install

# 以开发模式运行（会先编译网关 sidecar，再启动 Electron）
pnpm dev
```

`pnpm dev` 会自动先执行 `build:gateway`，确保刚编译好的 sidecar 在应用启动前就位。

## 构建

发布构建会先为目标平台编译网关，再用 [electron-builder](https://www.electron.build/) 打包：

```bash
pnpm build:mac      # macOS（arm64 + x64，分别为两个按架构区分的产物）
pnpm build:win      # Windows
pnpm build:linux    # Linux（AppImage、snap、deb）
```

在 macOS 上，你还可以用 `pnpm deploy:mac` 完成本地的「构建 → 安装到 /Applications → 重新启动」
循环（仅 arm64、未签名，仅供开发使用）。

## 数据存放位置

两者都位于 Electron 的按用户 `userData` 目录下：

- `optaris-config.json`——渠道、分组、设置以及网关密钥（以「仅所有者可读写」权限写入，其中保存了
  你的明文上游密钥）
- `optaris-data/`——事件存储：`optaris.db`（请求汇总）以及 `capture/`（开启抓包时的原始往返）

## 目录结构

| 路径              | 说明                                                       |
| ----------------- | ---------------------------------------------------------- |
| `src/main`        | Electron 主进程——拉起/守护网关，处理 IPC                    |
| `src/preload`     | 预加载桥接层，暴露 `window.api.gateway`                     |
| `src/renderer`    | React 控制面板 UI（仪表盘、渠道、分组、日志）               |
| `src/shared`      | 跨 IPC 边界共享的类型                                       |
| `gateway`         | Go 编写的 `optaris-gateway` sidecar                        |
| `scripts`         | 构建与部署脚本                                              |

## 许可证

[AGPL-3.0](LICENSE) © 2026 GetOptaris
