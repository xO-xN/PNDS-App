# Multichannel Signal Generator — Handoff（开发交接笔记）

面向继续开发此工程的开发者与 AI 代理：记录结构约定、边界与已知决策。

## 分层约定

- `lib/` 是可复用核心，**不得包含作品特定逻辑**。改动它意味着所有继承该模板的工程都受影响。
- **例外（本工程）**：`lib/audio-engine.js` 承载本工程的作品语义（16 路 toneTest 的频率/增益规则、组与实例管理、启动序列）——它是纯逻辑模块（可单测，无 HTTP/socket 依赖），见决策记录。
- `server.js` 做编排（两个 HTTP server、路由、生命周期），并承载 API 校验（channel 1..16、value 0..1）——本工程没有独立的路由层，校验就在 server.js 的 handler 里。
- **本工程无 sockets**（无 Socket.IO）、**无 p5**、**无 performer UI**（performer 端口只有 `/__pnds/health` + 无 UI stub 页）；**仅 internal 音频模式**。
- 浏览器端只有一个单页 `public/index.html`（无独立 shared.js / performer.js / monitor.js / style.css）——页面与 server 之间没有共用模块。

## 端口约定

端口只在 `manifest.json` 定义（`scoreServer.performerPort` / `monitorPort`）。`server.js` 从 manifest 读取，可用 `PNDS_PERFORMER_PORT` / `PNDS_MONITOR_PORT` 覆盖（集成测试用随机端口就是靠它）。创作者改端口只需改 manifest.json。

## PNDS 契约要点（必须遵守）

- `scoreServer.entry` 指向 `server.js`，路径必须在工程根内；禁止绝对路径与 `../`。
- manifest 的 `audio` 块声明 `defaultMode: "internal"`、`supportedModes: ["internal"]`、`outputChannels: 16`、`scsynth`（sampleRate 48000 / blockSize 64 / audioBusChannels 128）与 `synthdefs`（编译产物路径，必须存在）。
- health ready 的前置条件：两个 HTTP server 都监听成功 **且** 音频引擎确认 16 个实例存在（运行契约 §8：所有 master/instance 确认后才 ready）。没有 scsynth 时 health 停在 starting/error，但 endpoint 照常响应。
- 退出时释放全部资源：`/g_freeAll` 组、OSC UDP socket、两个 HTTP server——见 `server.js` 的 `shutdown()`（SIGINT/SIGTERM，退出码 0）。
- 唯一生产依赖 `qrcode ^1.5.4`（仅 monitor `/qr` 使用）。spec §2 的 preflight 要求生产依赖已安装 → 发布包必须预装 node_modules（见决策记录）。

## 决策记录

- **2026-08-15 重命名同步（multichannel-tone-test → Multichannel Signal Generator）**：文件夹从 `multichannel-tone-test` / "Multichannel Tone Test" 重命名为 "Multichannel Signal Generator"，所有内部标识符同步（package.json name、manifest id/name、synthdef 产物与源文件名、server/页面字符串、测试断言），遵循 LND 命名约定（文件夹含空格 ↔ 中划线 id/repo：`Multichannel Signal Generator` ↔ `multichannel-signal-generator` / `Multichannel-Signal-Generator`）。PNDS-App 仓库中的旧 `examples/multichannel-tone-test` 路径已移除，工程成为独立 GitHub 仓库（同 LND）。
- **Monitor QR（仿 LND 模式）**：qrcode 依赖、`lib/qr.js`（node 原生 handler，无 Express）、`lib/network.js`（resolveHostLanIp、PNDS_HOST_IP）、monitor server 的 `/qr` 路由（performer 端口 404）、fader 页底部 QR 行、集成测试断言 PNG magic（`89 50 4E 47`）。这是第一个生产依赖，因此工程从此**携带 node_modules**（spec §2：App preflight 要求生产依赖已安装；发布包由 package.yml 预装；本地仓库仍以 .gitignore 排除 node_modules，首次使用 npm install），App requirements 文档中针对本示例的 "zero npm production deps" 措辞已删除。
- **2026-08-15 QR 指向 monitor 页 + 描述更新**：QR 目标从 performer 页（:6868，无 UI stub）改为 **monitor 页（:6869）**——现场人员扫码直接打开 16 路 fader 控制台，副标题同步为 "Scan to open the monitor page"；`package.json` / `manifest.json` 的 description 与 README/creator-guide 介绍更新为 **"16-ch sine wave test"**。
- **v1.2.0 计划（内置工具）**：用户计划在 PNDS App v1.2.0 中把 LND 与 MSG 变成 App 的内置工具；两者继续保持独立仓库，通过 package workflow 产出可运行 bundle；App 侧的 tools registry / 安装机制属于未来工作。

## 验证命令

```sh
npm run check   # node --check server.js lib/osc.js lib/audio-engine.js lib/qr.js lib/network.js
npm test        # node --test（unit / osc / integration，共 22 个）
```
