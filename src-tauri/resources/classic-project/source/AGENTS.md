# AGENTS.md

PNDS Template：PNDS 数字乐谱工程模板。基于它创建的工程在 PNDS App（macOS 桌面 Host）内运行。本仓库 = 跨工程可复用骨架（`lib/`）+ 一份双推子示例作品（`audio/`、`public/`、`supercollider/`）；创作者替换示例层、保留骨架。

对话语言跟随创作者：本文与 docs/ 用中文撰写（单一维护，不翻译、不镜像），但与创作者交流、替创作者改写的文档内容，用创作者的语言。只有触发词的消息不判定语言（触发词双语并列）：按最近一条有实质内容的消息定语言；若还没有，用英语开场，创作者一回复即跟随。

## 两副面孔：骨架与示例

`lib/` 是跨工程骨架，随作品保留；`audio/`、`public/`、`supercollider/` 是模板自带的**示例作品层**，创作者的新作品会整体替换。因此本文与 docs/implementation.md 对示例行为的描述（作品规格、示例 OSC 协议、示例决策记录）都是**现状陈述，不是新作品的约束**——重写示例层时，连同其协议与决策记录一并换成新作品的。作品规格的落点是 docs/implementation.md：行为改动时同步改写它，别让它落后于代码。

## 开始一件新作品

规范开始语（**短语即语言**）：中文「开始新作品」、英文 "start a new piece"——说哪句，对话就用哪种语言。裸触发词（「开始 / 开始工作 / start / 新建作品」）同样有效，语言按「对话语言跟随创作者」判定。进入前先看工程身份（`manifest.json` 的 `id`）：

- 仍为 `pnds-template` → 崭新模板，按 [docs/start.md](docs/start.md) 执行初始化。
- 已是作品 id → **初始化只发生一次**：「开始」按普通对话处理，问创作者今天要做什么；改名 / 改简介随时单独改字段即可（start.md 第 0 步记了重跑的代价：version 归零、tokenKey 更换使设备失去座位、作品规格被占位覆盖）。

## 验证

每轮改动以这两条收尾，全绿才算完成：

```sh
npm run check   # 全部 JS 语法检查
npm test        # node --test 回归（协议 / 音频契约 / 座位 / 主题 / 语言 / 集成）
```

在 PNDS App 里的真机行为（加载、声音、扫码、关停）由用户验证——请用户操作并回报结果。

## 平台契约文档：按问题取读

平台契约与模块文档住 PNDS App 仓库，本仓库只持指针。**先本地、后远程**：

1. 本地（创作机必装 App，语料版本与装机 App 严格一致）：
   `/Applications/PNDS.app/Contents/Resources/help/zh-CN/<下表路径>`（英文树把 `zh-CN` 换成 `en`，两树同构）
2. 远程 fallback（未装 App 时）：
   `https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/<下表路径>`——main 可能领先装机版本，冲突时以本地语料为准。

| 触发场景 | 路径 |
| --- | --- |
| 改 `manifest.json`（字段规则 / 端口选择 / 路径安全） | `reference/manifest.md` |
| 环境变量 / health / 音频 bus / monitor 页要求 / 关停行为 | `reference/runtime-contract.md` |
| 工程目录结构与合规 | `reference/structure.md` |
| `.pnds` 打包 / 版本号 / 分发 | `reference/pnds-bundle.md` |
| OSC 协议与 target 注入 | `reference/osc.md` |
| SynthDef 编译契约 | `reference/supercollider.md` |
| 三种音频模式（internal / external / none） | `reference/audio-modes.md` |
| 组网演奏（本地网络 / 互联网） | `reference/network.md` |
| 手机 API / QR 协议 / 完整连接网址 | `reference/manifest.md` 的 `needsHttps`／`supportsPerformerUrl` + `reference/runtime-contract.md` §15；先检查实际 API，普通工程默认 HTTP |
| p5.js 页面创作 | `reference/p5js.md` |
| 模块用法（QR / 座位 / 主题跟随 / 语言跟随 / 音频作品层） | `modules/README.md` 起索引 |
| 从零到发布的工作流（建仓 / 迭代 / 试运行 / 打包） | `template-guide.md` |

模板自身的实现规格与「创作时改哪里」见 [docs/implementation.md](docs/implementation.md)。

## 创作交接

接续创作或领取 README 语言同步、手动待办、模块接线任务前，先读 [docs/creator-handoff.md](docs/creator-handoff.md)，再按上表读取涉及的平台契约。README 格式与语言回落见装机语料 `readme-guide.md`（本地／远程路径规则同上）。保留既有任务、未知内容和外部 agent 状态；完成任务时更新对应状态，记录实际改动、检查结果与尚待创作者真机验收的部分。

## 分层边界

- `lib/` 是跨工程可复用核心，作品特定逻辑放 `audio/` 或 `public/`——改 `lib/` 影响所有基于模板的工程。
- `server.js` 只做编排；Socket.IO 协议语义在 `lib/protocol.js`；作品音频语义（id → voice、声道分配、外部 OSC）在 `audio/controller.js`。
- `public/shared.js` 是浏览器与 server 的单一事实来源，保持 UMD 形态（浏览器挂 `window.PNDS`，Node 走 `module.exports`）。
- `lib/theme-follow.js`、`lib/locale-follow.js` 从 Multichannel Signal Generator **逐字节拷贝**（无分号 / 单引号的风格差异有意为之），更新走拷贝同步、不走重写。
- `supercollider/source/*.scd` 是唯一事实源，`.scsyndef` 是编译产物；改 `.scd` 后由用户在 App 的 Developer Tools 里重新编译。

## 骨架不变量（换作品也保留）

- scsynth：项目 group 固定 `GROUP_ID = 1000`；node ID 保留区纪律见 runtime-contract.md §7.4（本示例的 voice 分配是 `1000 + clientId`——新作品自定分配，避开保留区即可）。
- 座位记录落盘工程根 `.pnds-seats.json`（claim token → `{id, out}`），环境变量 `PNDS_SEATS_FILE` 可重定位；推子状态只在内存（扛锁屏重连，不扛重启）。这是 `lib/protocol.js` / `lib/seats-store.js` 的骨架行为，作品层换血也随骨架保留。
- monitor 视图状态由工程 server 单一持有：内存、session 级、不落盘（与座位 registry 的磁盘持久化明确区分）——`lib/monitor-state.js` 挂 `/monitor` namespace，连接推快照、set 广播；performer 页结构性零感知。模块手册见指针表 `modules/monitor-state.md`。
- 发布包由 `.github/workflows/package.yml` 按 ALLOWLIST 组装（docs / test / 源码不进演出包，`node_modules` 预装）。

## 示例层现状（新作品整体替换）

- 外部 OSC 协议 `/c<id>/amp` [float 0..1]、`/c<id>/freq` [Hz，范围见 `public/shared.js` 的 `registers`]、`/c<id>/out` [float 1..16]——**本示例 `audio/controller.js` 的作品协议，不是平台标准**。重写作品层时换成新作品自己的协议；UDP 传输直接复用 `lib/osc-transport.js`，平台侧的 OSC 契约（target 注入等）见指针表 `reference/osc.md`。

## 示例的决策记录

模板示例期的记录：新作品开始时按 docs/start.md 处理，作品分叉后改写被替换的部分、追加新决策。改对应区域前先读相关条目；模块内部机制见模块手册（上表 `modules/`）。

- **重连恢复是 born-restored**：持久化状态随 `ProjectAudio.addVoice(id, state)` 一次建声（internal 单条 `/s_new` 即携带正确的 amp/freq/out），只对接管型重连（旧 socket 的 disconnect 未及触发）走 `restoreVoice()` 原地重喂。`ProjectAudio` 按引擎接口约束（非 `instanceof`），`AudioEngine` 接受 `transportFactory` 注入——测试可注入替身（`test/audio.test.js` / `test/controller.test.js`）。
- **桥接模块先于页面脚本加载**：`?theme=` / `?lang=` 初值可能在 `monitor.js` 之前送达，index.html 的 onTheme / onLocale 钩子把送达 stash 到 `window.PNDS_LAST_THEME` / `PNDS_LAST_LOCALE`，monitor.js 启动时回放（有测试钉住）。
- **monitor.js 主题映射是原子应用**：bg 或 text 缺失则整体保留上一主题（绝不跨主题混键）；分隔线与控件边框取 text-secondary（浅色主题下画布没有阴影可依赖）；`draw()` 每帧读 THEME，新调色板下一帧生效。
- **原生 `<select>` 的 WKWebView 修复（v0.3.1）**：select 加 `appearance:none` + 自绘 caret，`color-scheme` 按 bg 亮度设到 documentElement——改 monitor 页控件样式时保持这三层，否则深色文字叠原生深色控件不可读。
- p5 是本模板的默认视觉方案，不是平台组件；换栈时 `public/` 整体替换。
