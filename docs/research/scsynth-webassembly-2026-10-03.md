# scsynth WebAssembly 与 PNDS 浏览器出声评估

调查日期：2026-10-03。本文记录公开源码与静态资源核验；未运行浏览器音频实验，不构成架构决策。

## 结论

浏览器运行 SC 合成引擎可行。适合先给工程增加可选的浏览器音频后端；不能把现有原生进程直接换成 `.wasm`，就认为工程、音频设备与演出生命周期保持兼容。PNDS 的工程已使用预编译 SynthDef，浏览器演出不必同时加载 sclang。

## 链接网站实际部署了什么

[SYNCULTURE 原文](https://synculture.net/handbook/pulsar-synthesis/#web-implementation)明确说约 10 MB 包含 **language 和 synthesis server**。其[会话页](https://synculture.net/handbook/pulsar-synthesis/session/)加载 [sc-workspace.mjs](https://synculture.net/js/sc-workspace.mjs?v=31cf0179)，后者创建同源 `/handbook/runtime/` iframe；[sc-runtime.mjs](https://synculture.net/js/sc-runtime.mjs?v=2aec40fe)再加载 `ScLang` 与 `ScSynth` 两个 Emscripten 模块，连接 `lang.onOsc → synth.sendOsc` 和 `synth.onOscReply → lang.sendOsc`。解释器用 `bootInterpreter` / `runCode` 启动及执行 SC 代码。此处是客户端本地合成，不是远端音频流。

这套 API 与 [SuperCollider 上游 Wasm 实现](https://github.com/supercollider/supercollider/blob/develop/README_WASM.md)一致；本站没有公开所用 commit，不能确认构建对应哪个版本，也不能把它归因于 SuperSonic。站点 `scsynth.js` 的日志 API 与当前上游源码有差异，说明复现时必须固定源码与二进制版本。

2026-10-03 下载公开资源后以实际文件字节数核验：

| 资源                                                           |     字节数 | 用途                 |
| -------------------------------------------------------------- | ---------: | -------------------- |
| [scsynth.wasm](https://synculture.net/runtime/sc/scsynth.wasm) |  3,464,960 | 合成引擎             |
| [scsynth.js](https://synculture.net/runtime/sc/scsynth.js)     |    156,638 | 引擎 JS 包装         |
| [sclang.wasm](https://synculture.net/runtime/sc/sclang.wasm)   |  5,133,181 | SC 语言解释器        |
| [sclang.js](https://synculture.net/runtime/sc/sclang.js)       |    230,966 | 解释器 JS 包装       |
| [sclang.data](https://synculture.net/runtime/sc/sclang.data)   |  1,996,252 | 解释器预加载资源     |
| 合计                                                           | 10,981,997 | 10.98 MB / 10.47 MiB |

仅引擎与其 JS 为 3,621,598 字节，约 3.62 MB。上述是取得的资源大小，不是压缩后的网络流量或运行内存；不含作品音频素材、网页依赖或完整 PNDS Host。

本地 PNDS 随包资源以 `du -sh` 核验：单架构 scsynth 约 748–756 KiB、通用 UGen 插件约 5.1 MiB、通用 libsndfile 约 4.9 MiB，合计约 11 MiB；单架构 Node 约 115–118 MiB。原生依赖采用通用二进制，且此处为磁盘占用，不能与网页资源字节数作严格等价比较。Wasm 可能减少音频部分体积，但不会自动消除 Node，也不能据 10 MB 宣称大幅缩小整个 App。打包来源见 [fetch-scsynth.sh](../../scripts/fetch-scsynth.sh)。

## 已证实的能力与限制

| 项目           | 证据与影响                                                                                                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 音频线程       | 上游使用 AudioWorklet 音频驱动；本站获取 worklet 节点，接入 GainNode 与 AnalyserNode。主页面刷新或 iframe 销毁会影响音频生命周期。[上游说明](https://github.com/supercollider/supercollider/blob/develop/README_WASM.md)、[本站 runtime](https://synculture.net/js/sc-runtime.mjs?v=2aec40fe)                                                             |
| SynthDef / OSC | 本站代码明确桥接 `/d_recv`、`/s_new`、`/sync` 与回复；浏览器侧是二进制 OSC 的 JS 调用，不是原生 UDP socket。[本站 runtime](https://synculture.net/js/sc-runtime.mjs?v=2aec40fe)                                                                                                                                                                           |
| 内存 Buffer    | 本站分配波形、包络和参数 Buffer，滑动或绘图通过 `/b_setn` 更新。故“完全没有 Buffer 支持”不成立。[本站 runtime](https://synculture.net/js/sc-runtime.mjs?v=2aec40fe)                                                                                                                                                                                       |
| 文件 Buffer    | 上游 README 仍列文件缓冲加载未支持；本站包装存在 `makeDir`、`addFile`、`downloadFile` 虚拟文件系统助手，但这不足以证明 `/b_read`、libsndfile、录音等工作。需要单独验证。[上游限制](https://github.com/supercollider/supercollider/blob/develop/README_WASM.md)、[本站包装](https://synculture.net/runtime/sc/scsynth.js)                                  |
| UGen           | 上游将插件静态链接，Mouse/X11 UGen 未实现。现有 macOS 插件二进制不能直接放入 Wasm；第三方 UGen 需要单独编译适配与测试。[上游说明](https://github.com/supercollider/supercollider/blob/develop/README_WASM.md)                                                                                                                                             |
| 隔离与部署     | 本站 workspace 检查 `crossOriginIsolated`，资源响应确实带 `COOP: same-origin` 与 `COEP: require-corp`；上游要求 HTTPS 与 SharedArrayBuffer。外部 CDN、iframe 和 LAN 部署需要逐项适配。[本站 workspace](https://synculture.net/js/sc-workspace.mjs?v=31cf0179)、[上游部署要求](https://github.com/supercollider/supercollider/blob/develop/README_WASM.md) |
| 启动与手机     | 本站设解释器启动上限 150 秒，并为 iOS 在 runtime iframe 内增加一次点击来恢复 AudioContext。这是应对机制，不是所有手机性能或稳定性的证明。[本站 runtime](https://synculture.net/js/sc-runtime.mjs?v=2aec40fe)、[workspace](https://synculture.net/js/sc-workspace.mjs?v=31cf0179)                                                                          |
| 输出与采集     | 本站演示配置为零输入、两路输出；不能据此推断浏览器或引擎只能立体声，也不能推断已经验证专业多通道声卡、输入或低延迟。[本站 runtime](https://synculture.net/js/sc-runtime.mjs?v=2aec40fe)                                                                                                                                                                   |
| sclang 兼容    | 当前上游说明仍限制文件访问、超出 server 的 OSCFunc/OSCdef 和与 server 的时钟重同步；不能把任意现有 `.scd` / Quark 原样运行视为已验证。[上游限制](https://github.com/supercollider/supercollider/blob/develop/README_WASM.md)                                                                                                                              |
| 许可           | 当前上游 README 将 SC 核心标为 GPL-3.0、Wasm bindings 标为 AGPL-3.0；采用时需要明确实际固定版本及分发组合的许可。[上游许可说明](https://github.com/supercollider/supercollider/blob/develop/README_WASM.md)                                                                                                                                               |

## 对 PNDS 的具体含义

PNDS 当前以 Node 负责工程服务、原生 scsynth 负责音频；详见[运行契约](../zh-CN/reference/runtime-contract.md)。Wasm 只改变合成引擎位置，工程服务、加入机制与工程包分发仍需保留或另行设计。

两种浏览器出声目标需要分开：

- **Host 浏览器出声**：一个引擎统一合成并输出到 Host。它应由独立、持续的音频上下文管理，不能绑定到 monitor 页挂载、刷新或投影窗口。当前 Node / health / 音频 ready 启动握手也需调整：原生引擎先启动，工程完成音频初始化并报告 health，App 创建 master 后才进入 ready、挂载 monitor。如果让 monitor 承担引擎启动，会形成互相等待。[启动实现](../../src-tauri/src/project/session.rs)、[monitor 挂载](../../src/components/shell/AppShell.tsx)
- **每位 performer 浏览器出声**：每台设备拥有引擎、素材、音频许可与本地时钟；需要新的声音归属、音频 ready、重连及同步约定。它能减少音频流传输，但不能使不同设备自动实现采样级同步。

工程兼容验证应覆盖当前实际使用的 SynthDef / UGen、`/d_load` 到 `/d_recv` 的加载替换、Buffer 和素材、多通道与设备选择、限幅与静音、断线重连及后台运行。先以一个不依赖音频文件和第三方插件的工程，在 Mac Safari、目标 iPhone 与 Android 上测量启动耗时、持续 CPU、可用复音、延迟及掉音；通过后再决定扩展范围。

普通局域网 `http://<LAN-IP>` 不满足 AudioWorklet 所需的安全上下文，localhost 例外仅适用于访问设备自身；手机需要可信 HTTPS。[AudioWorklet 文档](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet)、[安全上下文规则](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts) 浏览器可以支持多通道，但须以实际 `AudioDestinationNode.maxChannelCount` 为准，不能直接承诺 PNDS 当前 1–64 路离散输出契约；设备选择的 `AudioContext.setSinkId` 也有兼容性与权限限制。[Web Audio 规范](https://www.w3.org/TR/webaudio/#AudioDestinationNode)、[输出设备 API](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId)

## 尚未验证

本站构建 commit 与 UGen 清单、Wasm 运行内存、准确浏览器版本矩阵、WKWebView 行为、文件音频读写、第三方插件、专业声卡路由，以及长时间现场演出稳定性。本调查仅确认公开源码结构和资源字节数，未实际触发音频。
