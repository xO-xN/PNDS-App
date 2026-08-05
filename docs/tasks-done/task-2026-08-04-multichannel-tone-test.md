# Task 4: `examples/multichannel-tone-test` 16 路验证工程

目标 release：PNDS App `1.1.0`。

规范引用：

- `PNDS_SCORE_PROJECT_SPECIFICATION.md` 全文
- `PNDS_RUNTIME_CONTRACT.md` §3–§11
- `PNDS_APP_REQUIREMENTS.md` §11、§12

## 目标

提供一个普通、零 npm 生产依赖的 PNDS score project，用于现场检查 16 路 Internal 信号、设备能力降级和 BlackHole/DAW 路由。

## 依赖与边界

- 前置：Task 1–3。
- 路径固定为 `examples/multichannel-tone-test/`。
- 它是仓库示例，不安装到 App 数据目录，不创建“App 内置项目”基础设施。
- 不使用 Socket.IO、p5.js、前端框架或第三方生产依赖。
- 不自动发声、不自动轮播、不自动巡检。

## 工程契约

### Manifest

- `schemaVersion: 1`；
- 只需支持 Internal；
- `audio.outputChannels: 16`；
- 声明足够的 `audioBusChannels`（至少 32）；
- performerPort 与 monitorPort 使用不同的工程自有端口；
- 包含已编译 `.scsyndef` runtime artifact。

### Server

只使用 Node `24.18.1` 内置模块：

- `node:http` 提供 performer 和 monitor 两个 HTTP server；
- 使用最小、工程内实现的 OSC UDP encoder；
- 使用标准 `fetch` 或内置 API；
- 响应 SIGINT/SIGTERM，关闭 HTTP/UDP 并释放工程 synth/group；
- performer port 提供规范 health endpoint；
- monitor port 可选复用 health，但 App 不依赖它。

### Performer 页面

- `/` 只显示“该 utility 没有 performer UI”的简短说明；
- 不提供重复的演奏控制界面；
- 保留 performer server，因为 PNDS Runtime Contract 要求 App 从该端口轮询 health。

### Monitor 页面

- 16 个清楚编号的垂直推子，对应输出 1–16；
- 每路 sine 从 `110 Hz` 开始按半音递增；
- 默认全部 Mute；
- 每路范围为 `Mute / -60 dBFS .. -6 dBFS`；
- gain 变化约 20ms smoothing，避免 click；
- 页面响应 viewport resize；
- 不依赖 Tauri API，不弹浏览器提示框。

### Audio ownership

- 从 `PNDS_AUDIO_OUTPUT_BUS` 读取首个 private bus；
- 从 `PNDS_AUDIO_OUTPUT_CHANNELS` 验证当前 host 声明；
- 每个 tone 只写自己的 mono bus；
- 不直接写硬件 bus 0，不 downmix；
- 工程拥有并释放自己的 group 与 16 个 synth；
- App master stage 仍只负责 private bus 到硬件 bus 的桥接。

## 自动测试

至少覆盖：

- manifest 能通过 App parser/preflight 且不需要 `node_modules/`；
- performer/monitor 路由和 MIME type；
- performer health 的 ready/error payload；
- 16 路频率按半音递增；
- dB 到 gain、Mute 和 smoothing 参数；
- slider 输入边界与非法请求；
- OSC encoder 的已知字节 fixture；
- SIGTERM shutdown 不遗留 server/socket。

自动测试不得要求真实音频设备或自动发声。

## 手动验收

- 16ch → BlackHole 16ch，Ableton/DAW 可分别观察 16 路；
- 单独推起任一路，只对应一个目标通道；
- 16ch → 2ch 设备时工程仍 ready，UI 显示 `16ch → 2ch`，只有前两路可达硬件；
- 所有 slider 默认静音，打开工程不会突然发声；
- 浏览器 viewport resize 后布局正确且 server/socket 不重启或重连；全屏集成行为由 Task 5 验收；
- `npm run check:all` 通过。
