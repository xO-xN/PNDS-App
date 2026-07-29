# PNDS

## Platform for Networked Digital Score

PNDS 是一个面向网络化数字音乐演出的开放平台，用于创建、运行和组织多人参与的数字乐谱作品。

创作者可以将一份数字乐谱、一套声音引擎和一组网络交互规则组织成一个独立的演出工程；PNDS App 负责在演出现场把它变成一个可运行的本地多人数字音乐演奏系统。

PNDS 由三个部分组成。

### PNDS 数字乐谱工程

PNDS 工程（score project）是一个可以被 PNDS App 打开并运行的作品目录。

一个工程通常包含：

- 一个基于 Node.js 的数字乐谱服务器，提供演奏者页面与监视/指挥页面，并通过 Socket.IO 处理实时网络交互；
- 一个或多个已编译的 SuperCollider `.scsyndef` 声音定义文件；
- 一个 `manifest.json` 工程配置文件，声明服务器入口、页面端口、音频模式与声音资源。

工程自己决定乐谱视觉、演奏规则、交互方式与 OSC 参数；PNDS App 不规定这些内容。

### PNDS App

PNDS App 是一个 macOS 桌面应用，负责在演出现场运行 PNDS 工程：

- 打开本地 PNDS 工程并校验其运行资产；
- 启动工程的数字乐谱服务器，并部署到本地网络；
- 启动内置的 SuperCollider 声音服务器（`scsynth`），加载工程的 `.scsyndef`；
- 管理音频模式、音频输出设备与总输出音量；
- 显示工程自己的监视/指挥界面；
- 在工程之间切换，并在退出时清理所有子进程。

### PNDS AI Skills

PNDS AI Skills 是一组面向创作者的 AI 辅助工具，用于在 PNDS 框架下制作作品，包括数字乐谱界面与交互设计、SuperCollider 声音引擎设计，以及工程配置与文档的生成与维护。

## 第一版范围

当前开发中的第一版（V1）明确聚焦于：

- **macOS Apple Silicon** 桌面 Host；
- **同一局域网内**的演出：Host 电脑 + 手机/平板演奏者；
- 由用户主动选择并信任的**本地工程目录**；
- 立体声输出。

以下为**后续目标**，不属于 V1：

- 跨互联网、多地实时共奏；
- 多声道 / 环绕声输出；
- Intel Mac、Windows、Linux；
- 工程压缩包、在线工程库与工程下载。

## PNDS App 如何使用

### 1. 准备 PNDS 工程

准备一个完整、可离线运行的工程目录，例如：

```text
Inarticulate III/
├── manifest.json
├── server.js
├── node_modules/
├── public/
└── supercollider/
    └── synthdefs/
        └── inarticulate-iii.scsyndef
```

工程必须自带已安装好的 Node.js 生产依赖。PNDS App 在演出时不会执行安装步骤，也不依赖网络。

### 2. 连接本地网络演奏环境

将运行 PNDS App 的 Host 电脑接入本地网络，建议使用有线连接。演奏者设备（手机或平板）连接到同一网络。

### 3. 打开工程

在 PNDS App 中选择一个本地 PNDS 工程目录。

App 会：

- 读取并校验 `manifest.json`；
- 检查入口文件、依赖与声音资源；
- 让用户选择音频模式与输出设备；
- 启动内置声音服务器（Internal 模式）；
- 启动数字乐谱服务器；
- 等待工程报告运行就绪。

加载期间，App 显示 PNDS Logo 动画；就绪后动画淡出，工程的监视界面淡入。

### 4. 演奏者加入数字乐谱

演奏者通过手机或平板扫描监视界面上的二维码，或直接访问 Host 的局域网地址，进入演奏者页面。

演奏者的交互通过 Socket.IO 发送到数字乐谱服务器。

### 5. 数字乐谱控制声音引擎

数字乐谱服务器根据作品规则，将演奏者交互转换为 OSC 消息，控制声音引擎发声。

音频模式由用户在 App 中选择：

| 模式           | 说明                                               |
| -------------- | -------------------------------------------------- |
| Internal Synth | 使用 App 内置的 `scsynth` 与工程自带的 `.scsyndef` |
| External Synth | 将 OSC 发送到用户指定的外部合成器或设备            |
| None           | 不使用音频，仅运行乐谱与网络交互                   |

### 6. 监视端 / 指挥端

PNDS App 窗口显示的就是工程的监视/指挥界面。

正常演出状态下，窗口只显示该界面：没有标题栏，也没有额外的应用控件。将鼠标移到窗口左侧边缘时，PNDS 侧栏才会浮出，用于切换工程、更改音频模式、选择输出设备与调整总音量。

两类页面通过不同端口区分：

- 演奏者页面：工程 `manifest.json` 中的 `performerPort`，供手机/平板访问；
- 监视/指挥页面：`monitorPort`，供 PNDS App 显示。

它们的具体端口由工程声明；例如 `Inarticulate III` 使用 `6868` 与 `6869`。

## 开发

本仓库是 PNDS App 的实现（Tauri v2 + React + TypeScript）。

```bash
npm install        # 安装依赖
npm run tauri:dev  # 开发模式运行 App
npm run check:all  # 完整质量检查（typecheck / lint / ast-grep / prettier / clippy / tests）
```

开发规范与 agent 工作规则见 [`AGENTS.md`](AGENTS.md)；架构模式与详细开发文档见 [`docs/developer/`](docs/developer/README.md)。

## 相关文档

- [`docs/PNDS_APP_REQUIREMENTS.md`](docs/PNDS_APP_REQUIREMENTS.md)：PNDS App V1 的实现规范与工程运行契约。
