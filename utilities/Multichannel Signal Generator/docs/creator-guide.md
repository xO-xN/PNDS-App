# Multichannel Signal Generator — Creator Guide（创作者开始指南）

这是一个 **Internal 纯音频测试工具** 的 PNDS 工程：**16-ch sine wave test**（16 路独立单声道正弦测试音，`toneTest` SynthDef），每路只写自己的私有总线，用于检查 Internal 多声道路由。仅支持 `internal` 模式（`defaultMode: "internal"`、`supportedModes: ["internal"]`、`outputChannels: 16`）。

## 快速开始

### 1. 安装依赖

PNDS App **不执行 npm install**，所以发布包必须预装可用的 `node_modules/`（本地仓库仍以 `.gitignore` 排除 `node_modules/`，首次使用执行下面的命令；集成测试的 preflight 也要求 `qrcode` 已装在 `node_modules`）：

```sh
npm install
```

唯一的生产依赖是 `qrcode`（`^1.5.4`，只用于 monitor 的 `/qr` 端点）。

### 2. 运行

脱离 App 单独调试：

```sh
npm start    # 启动 performer/monitor 两个 HTTP server + 音频引擎
```

单独调试时需要一个在听的 scsynth 才能达到 `ready`（默认 OSC 目标 `127.0.0.1:57110`，可用 `PNDS_OSC_TARGET` 覆盖）；没有 scsynth 时两个 HTTP server 仍会起来，health 停在 starting/error。

在 PNDS App 中运行：App 中点击 **Open**，选择本文件夹。App 按 `manifest.json` 的 `audio` 块启动 scsynth（sampleRate 48000 / blockSize 64 / audioBusChannels 128）并加载 `synthdefs`，然后以 internal 模式启动 server。

### 3. 两个端口

| 端口 | 地址 | 用途 |
|---|---|---|
| Performer | `http://<Host-LAN-IP>:6868/` | 无 UI（"This utility has no performer UI…" stub 页），只服务 `/__pnds/health` |
| Monitor | `http://<Host-LAN-IP>:6869/` | 16 路测试音 fader 页 + JSON API + `/qr` |

默认端口来自 `manifest.json` 的 `scoreServer.performerPort` / `monitorPort`——这是**唯一来源**。

## 16 路测试音（tone / master API）

本工程的作品语义是**16 路独立测试音**，Monitor 页面即为控制台：

- **页面**（`public/index.html`，单页，DOM，无 p5）：标题 "Multichannel Signal Generator"，16 个开关按钮 + 主音量推子（默认 −6 dBFS），底部 QR 行（指向 monitor 页 :6869，副标题 "Scan to open the monitor page"）。所有音默认静音（Mute）。
- **开关**：点击按钮 → `POST /api/tone {channel, on}`；server 校验 `channel` 必须是 1..16 的整数，否则 400。
- **主音量**：拖动推子 → `POST /api/master {value 0..1}`；server 校验 `value` 必须是 0..1 的有限数，否则 400。映射到 −60..0 dBFS（0 = Mute，1 = 0 dBFS unity），默认 −6 dBFS；只推给已开启的音。
- **音频引擎**（`lib/audio-engine.js`，作品逻辑所在）：组 1000（App 保留范围之下），实例 1001..1016；第 i 路只写私有总线 `PNDS_AUDIO_OUTPUT_BUS + i`；频率 `440 Hz × 2^((n−1)/12)`（通道 1 = 440 Hz 音乐会 A，通道 13 = 880 Hz 高八度）；`gain` 经 `Lag.kr(gain, 0.02)` 平滑（~20 ms），无咔嗒声。
- **OSC**（`lib/osc.js`）：零依赖极简编码器，osc-min 兼容线上格式（4 字节对齐、数字一律按 float 编码，与 bundled scsynth 3.14.1 对齐），已知字节 fixtures 见 `test/osc.test.js`。
- **QR**：`/qr` 只挂在 monitor server，返回 monitor 页 `http://<LAN-IP>:6869/` 的 PNG（`lib/qr.js` + `lib/network.js`，`PNDS_HOST_IP` 可覆盖 LAN 地址）；performer 端口对 `/qr` 返回 404。
- **优雅关闭**：SIGINT/SIGTERM → 释放组（`/g_freeAll`）、关闭 UDP socket 与两个 HTTP server，退出码 0（集成测试断言端口释放）。
- **环境变量覆盖**：`PNDS_AUDIO_OUTPUT_BUS`（首个私有总线，默认 0）、`PNDS_AUDIO_OUTPUT_CHANNELS`（默认 16）、`PNDS_OSC_TARGET`（默认 127.0.0.1:57110）、`PNDS_PERFORMER_PORT` / `PNDS_MONITOR_PORT`（默认 manifest 端口）、`PNDS_HOST_IP`。

## 目录结构

```
manifest.json             PNDS 工程契约（App 只认它和 server 入口；audio 仅声明 internal）
server.js                 作品主 server：performer/monitor 两个 HTTP server + 路由与 API 校验 + 生命周期
lib/                      可复用核心，任何 PNDS 工程通用（template 骨架）
  network.js              LAN IPv4 枚举（resolveHostLanIp，PNDS_HOST_IP）
  qr.js                   monitor 页面 QR 码（node 原生 handler，无 Express）
  osc.js                  极简 OSC 编码器 + UDP 客户端（零依赖，osc-min 兼容线上格式）
  audio-engine.js         16 路 toneTest 实例（组 1000 / 实例 1001..1016）——作品语义所在
public/                   浏览器端
  index.html              16 路测试音 monitor 页（单页，DOM + 内联样式，无 p5）
test/                     node --test 回归测试（unit / osc / integration）
supercollider/
  synthdefs/              编译产物 .scsyndef + 构建源码（toneTest）
docs/                     本指南与交接文档
```

## 创作时改什么

| 想做什么 | 改哪里 |
|---|---|
| 换作品名 / 端口 / 输出通道数 | `manifest.json`（改端口只需改这里） |
| 改 monitor 页面（16 个开关、主推子、QR 行） | `public/index.html`（单页，DOM + 内联样式） |
| 改频率 / 增益映射 / 主音量默认 / 实例数 | `lib/audio-engine.js`（toneFrequency / faderValueToGain / DEFAULT_MASTER_GAIN / TONE_COUNT） |
| 改 API 校验（channel 1..16、value 0..1） | `server.js`（handleToneRequest / handleMasterRequest） |
| 改 OSC 编码 / 参数类型 | `lib/osc.js` |
| 改音色（波形 / 平滑时间） | `supercollider/synthdefs/source/*.scd`，重新编译出 `.scsyndef` |

## 单一事实来源（Single Source of Truth）

- **端口与音频声明**的唯一来源是 `manifest.json`（App 工程契约）：performerPort / monitorPort、defaultMode、supportedModes、outputChannels、scsynth 参数、synthdefs。`server.js` 从它读取（可用环境变量覆盖），创作者只需改 manifest.json。
- **tone 规则**（频率阶梯、增益映射、Mute/主音量）的权威在 `lib/audio-engine.js`；monitor 页面为了显示在本地复算同样的公式（`toneFrequency`、`valueToDb`），两者必须保持一致——`test/unit.test.js` 锚定服务端一侧。
- 本工程**没有**浏览器/服务端共用模块（不同于 LND 的 `shared.js`）：浏览器只做显示与 POST，规则与校验全部在服务端（`server.js` 校验边界、`lib/audio-engine.js` 实现规则）。

## 音频

本工程**仅 internal 模式**：`audio.defaultMode: "internal"`、`supportedModes: ["internal"]`、`outputChannels: 16`；App 以 sampleRate 48000 / blockSize 64 / audioBusChannels 128 启动 scsynth，并加载 `supercollider/synthdefs/multichannel-signal-generator.scsyndef`（`toneTest`）。

- 16 个实例只写自己的私有总线（`PNDS_AUDIO_OUTPUT_BUS + i`），绝不写硬件总线 0、绝不下混；App master stage 只负责把私有总线桥接到硬件。
- 所有音默认静音（Mute）；主音量默认 −6 dBFS；`Lag.kr(gain, 0.02)` 平滑 ~20 ms。
- 启动序列：`/d_load` → `/done` → `/sync` → `/synced` → `/g_new(1000)` → 16× `/s_new` → `/sync` → `/synced`；ready 要求全部实例确认（运行契约 §8）。

## 健康检查

两个端口都提供：

```sh
curl http://127.0.0.1:6868/__pnds/health
```

PNDS App 以 JSON 中 `status === "ready"` 为显示条件。ready 的前置条件：performer/monitor 两个 HTTP server 都监听成功 **且** 音频引擎确认 16 个实例存在。payload 含 `projectId`、`audioMode`（"internal"）、`audio.status` / `audio.target`、`scoreServer` 端口。

## test/ 文件夹

`test/` 是给 AI 编程助手用的回归测试（`npm test`，node --test，共 22 个）。创作者不需要手动运行，也不需要理解它们。当你通过 AI 修改工程时，AI 会用它来验证改动没有破坏已有功能：unit（频率数学、增益映射、tone/master 规则，假 OSC client）、osc（与 osc-min 逐字节对照的已知 fixtures）、integration（假 scsynth UDP harness → server 达到 ready；manifest 契约含 synthdef 产物存在；preflight 要求 qrcode 依赖已装在 node_modules；health payload；performer stub + monitor 页；`/qr` 返回 image/png 含 PNG magic 且 performer 端口 404；tone/master API 校验；SIGTERM 干净退出 0 且端口释放）。

## 发布

带生产依赖的发布包由 `.github/workflows/package.yml` 构建（ALLOWLIST 裁剪；`node_modules` 预装；`supercollider/` 显式纳入——`.scsyndef` 是运行时依赖）。详见 `docs/handoff.md`。
