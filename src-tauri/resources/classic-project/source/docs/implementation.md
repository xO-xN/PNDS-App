# PNDS Template — 实现手册

本手册讲这个模板工程本身：示例作品的行为规格、目录职责、创作时改哪里。
从零到发布的工作流（建仓 → AI 迭代 → 试运行 → 打包发布）住 PNDS App 的[创作指南](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/template-guide.md)，App 内帮助中心同名可查。

平台契约（manifest / runtime / 打包 / OSC）与模块手册住 [PNDS App 仓库](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/reference/README.md)；装机机器上也可直接读本地语料 `/Applications/PNDS.app/Contents/Resources/help/zh-CN/`（与装机 App 版本严格一致，英文树换 `en`）。AI agent 的取读入口见根目录 [AGENTS.md](../AGENTS.md)。

## 快速开始

### 1. 安装依赖

PNDS App **不执行 npm install**。v0.7.0 的 schemaVersion 2 工程使用 App v1.6.2 固定共享库；脱离 App 开发时才安装本地精确版本依赖：

```sh
npm install
```

Node 运行库固定为 `express` 5.3.0、`socket.io` 4.8.4、`osc-min` 2.1.2、`qrcode` 1.5.4；浏览器视觉库为 p5 2.3.4。App 运行使用共享资源，standalone 使用相同精确 npm 依赖。

### 2. 运行

脱离 App 单独调试：

```sh
npm run dev:none    # 无音频模式（只测试页面与网络）
npm run dev         # Internal 模式（需本机 scsynth 在 57110 端口）
```

在 PNDS App 中运行：App 中点击 **Open**，选择本文件夹，音频模式选 **Internal Synth**。

### 3. 两个页面

| 页面 | 地址 | 用途 |
|---|---|---|
| Performer | `http://<Host-LAN-IP>:6868/`（App HTTPS 入口生效时为完整 `PNDS_PERFORMER_URL`） | 演奏者触摸界面（手机横屏） |
| Monitor | `http://<Host-LAN-IP>:6869/`（始终内部地址） | 监视端：客户端列表与声道分配 |

默认端口来自 `manifest.json` 的 `scoreServer.performerPort` / `monitorPort`——这是**唯一来源**。`public/shared.js` 和浏览器都会自动读取，不需要手动同步。端口惯例与选择建议见参考手册的 [manifest.md「端口」节](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/reference/manifest.md)。

## 作品规格（当前实现，随创作改写）

从模板创建时，此处描述的是模板示例；从「开始」新作品起（见 [start.md](start.md)），这里就是**本作品的规格文档**——行为改动时同步改写它，保持与代码一致。

- 演奏者界面：**手机横屏**触摸；竖屏时提示旋转。左半屏是 **FREQ 推子**（音高），右半屏是 **AMP 推子**（音量）。
- 推子值经 Socket.IO 发到 score server，由 server 转为 OSC 控制 SuperCollider。
- 每个加入的客户端获得一个 sine voice（一个 `template-sine` synth）。
- FREQ 推子映射频率在 `public/shared.js` 的 `freqRange` 定义（**单一事实来源**）：performer 页面用它显示 Hz，server 的 `audio/controller.js` 从同一对象读取并映射为 OSC 频率，改一处两边同步。
- FREQ 推子带**音高参考刻度**：范围内每个半音一小格（19 格），只标 3 个音名（中心音及其上下五度），这 3 格的刻度用**更亮的颜色**区分；范围两端不在音高上，不设刻度。刻度数据在 `public/shared.js` 的 `freqTicks`（单一事实来源）。
- **三档音区 switch**（居中，位于状态文字下方）：`1`（低音）/ `2`（中音）/ `3`（高音），切换左侧 FREQ 推子的频率区段。推子位置不变，Hz 映射随音区改变（server 按同一音区映射）。音区数据在 `public/shared.js` 的 `registers`（单一事实来源）：每区都是同样的 19 半音结构，中心音分别为 **E6 / A5 / D5**（相邻区中心相差 7 半音；整体比原 1000–3000 Hz 低一个五度），标注音名分别为 A-E-B / D-A-E / G-D-A——**每区的标注音 = 上一区整体下移一个五度**（中心音即上一区的下五度）。
- AMP 推子使用 **audio taper 曲线**（`value²`）：推子下半段控制更细腻。
- 推子值在 scsynth 端做 **平滑**（`Lag.kr`，amp 50ms / freq 100ms），推子移动是滑动的，不产生突变/zipper noise。
- **每个 voice 输出上限 -6 dB**（在 SynthDef 内 `amp * 0.5` 实现）。
- 客户端上限 = 输出声道数（manifest 默认 16；App 注入 `PNDS_AUDIO_OUTPUT_CHANNELS` 时以注入值为准）；满员时新客户端被拒绝。
- 默认声道：**奇数 id → 声道 1，偶数 id → 声道 2**（相对 `PNDS_AUDIO_OUTPUT_BUS`）。
- Monitor 端可把任意客户端的输出声道改为 1..N（N = server 实际解析的输出声道数，经 `__config.js` 注入浏览器，与 server 校验同源）；允许重叠。Monitor 页下方显示 **performer 页面的 QR 码与其可复制地址**（`GET /qr` 由 `lib/qr.js` 生成，地址文本来自同一解析结果——见上文「完整 performer URL」）。
- **Monitor 端可调演奏序号**（ID 下拉，与声道分配同款交互）：把设备移到空闲序号——分配、voice（带当前状态原位重建）与座位记录一并迁移，performer 页面经 `joined` 事件自动跟进新序号。目标序号被在线设备占用时不动；被陈旧座位记录占用时覆盖（操作员意图优先）。
- 客户端断开后，重连（同一浏览器，token 保存在 localStorage）会**恢复原 id 与最后推子状态**；恢复**一次到位**——voice 直接以持久化状态创建（单条 `/s_new` 携带正确的音量/频率/声道），不经过默认值中间态，锁屏重连不会在错误声道出声。
- **座位记录跨重启持久**：server 把每台设备的演奏序号与声道（`token → {id, out}`）写进工程根目录的 `.pnds-seats.json`，重新开启工程时同一台设备（同一浏览器）自动拿回原序号与原声道；推子状态（freq/amp）不跨重启，重启后归零。座位为其设备保留——新设备不会占用已记录的序号；陈旧记录（不会再来的手机）占满座位时，用 monitor 页右上角的 **重配 ID** 按钮清空全部记录（在线设备会被断开重连、按重连顺序拿新序号，声道回默认）。测试或 App 可用环境变量 `PNDS_SEATS_FILE` 把状态文件指到别处。
- Performer 状态行显示 **`ID: N CH: N`**：CH 来自 state 广播，monitor 端改道后实时更新。
- score server 的终端日志记录协议生命周期（join / disconnect / rejected）——现场排查"幽灵客户端"循环重连时看这里。

座位机制的完整故事（claim token、分配与恢复、协议消息）见模块手册的[乐手身份与座位](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/modules/players.md)。

## 完整 performer URL（可选，Host 选择的入口）

本模板的普通双推子作品默认使用 HTTP。`manifest.json` 的 `scoreServer.supportsPerformerUrl: true` 声明读取 Host 完整 performer URL 的能力；实际使用安全上下文 API 的新作品才按 [manifest.md](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/reference/manifest.md) 声明 `needsHttps: true`。App 选择 HTTPS 的完整条件与地址契约见 [runtime-contract.md §15](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/reference/runtime-contract.md)；生效时注入 `PNDS_PERFORMER_URL`（如 `https://show.example.org:8443/`）。连接层保持：

- **一个 URL 三处共用**：`lib/config.js` 的 `resolvePerformerUrl()` 是唯一解析点（提供 `PNDS_PERFORMER_URL` 时用它，否则回落 `http://<PNDS_HOST_IP>:<performerPort>/`，现行为不变）；QR 码（`GET /qr`）、monitor 页二维码下方可点选复制的地址、浏览器注入的 `__config.js` 都消费同一个值，不会漂移。
- **手机侧同源**：performer 页的脚本与 Socket.IO 全部走**当前 origin**（`location.origin`）——`public/client.js` 的 `connectPerformer` 接 `origin`（页面传 `location.origin`），`index.html` 的 socket.io `<script>` 同源加载。HTTP 模式下该 origin 就是 performer 端口，HTTPS 入口下就是入口 origin，页面代码零分支。
- **页面角色由服务端注入**：`__config.js` 的 `role` 字段（performer / monitor 由**哪个端口的服务**吐出配置决定），`index.html` 据此分支——不比较浏览器端口。入口的端口是网关的、与 manifest 端口无关，端口比较在入口之下不可靠。
- **monitor 保持内部连接**：monitor 页仍从 monitor 端口加载、跨端口连 performer 服务（`socketOrigin` + `connectMonitor`），不经外部入口，也不加载入口 origin 的资源。
- **claim token 按 origin 隔离**：localStorage 的 token 只在同一 origin 下可读——同一 HTTPS origin 的断线重连照常复用 token 恢复座位（工程零改动）；协议、域名或端口变化（含 HTTP → HTTPS 切换）后设备按新加入处理，不承诺跨 origin 迁移。
- **工程身份随入口发布**：`__config.js` 同时注入 `projectId`（manifest.id）与 `performerUrl`——入口的接入上下文由此绑定到当前工程，供 App 侧网关后续拒绝与当前工程不匹配的旧入口。

基于本模板的新作品默认继承这层适配（`lib/` 骨架 + `public/` 的连接层都在模板内）；重写页面层时保持「同源连接 + 服务端角色注入 + 地址单源」三条。新增手机 API 或修改 QR／连接时，先按 AGENTS.md 的指针检查实际安全上下文需求，并把所用 API、声明值、Host 选择的网址和验证结果写入创作交接。

## 主题跟随（可选，App 集成）

PNDS App（≥ v1.2.3）会把当前主题（Lavender / Sand / Stage / Brutal）经跨域 `postMessage` 推给 monitor 页，工程**可选**消费；消息 best-effort、最新值覆盖、页面幂等应用。本模板的 monitor 页用 **p5 绘制（无 CSS 变量）**，示范**回调消费**路径：`public/index.html` 在 monitor 分支加载 `lib/theme-follow.js`（经 `GET /__pnds/theme-follow.js`）并设置 `window.PNDS_THEME_OPTIONS = { applyVariables: false, onTheme: ... }`，`public/monitor.js` 把 palette 映射成画布颜色，新调色板下一帧生效。DOM 页面（无 canvas）可零配置直接用默认的 CSS 变量路径。performer 分支不加载该模块、永远用工程自带配色（缺席 `?theme=` 初值时 monitor 亦用 `monitor.js` 里 `DEFAULT_THEME` 的深色）。

模块的消息协议、选项口子与映射细节见模块手册的[主题跟随](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/modules/theme-follow.md)。

## 语言跟随（可选，App 集成）

PNDS App（≥ v1.3.0）会把当前界面语言（`en` / `zh-CN`）经 `pnds:locale` v1 消息推给 monitor 页（与主题桥同一套机制：单向、尽力而为、最新值胜、幂等；不实现则完全不受影响）。本模板的 monitor 页：`public/index.html` 在 monitor 分支加载 `lib/locale-follow.js` 并设置 `window.PNDS_LOCALE_OPTIONS = { onLocale }`，`public/monitor.js` 的 `applyLocale()` 切换 `STRINGS` 字串表并重贴 DOM 控件标签，新语言下一帧生效。**无推送时的默认语言是 zh-CN**（不调用该能力时操作面文案与从前一致）；页面支持哪些语言由 `locales` 声明（默认 `['en', 'zh-CN']`）。performer 分支不加载该模块。

加语言：改 `public/monitor.js` 的 `STRINGS` 与初始化的 `S`，同步在 `public/index.html` 的 `PNDS_LOCALE_OPTIONS` 声明 `locales`。模块的解析语义（精确匹配 → 基础语言匹配 → fallback）与口子见模块手册的[语言跟随](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/modules/locale-follow.md)。

## monitor 视图状态同步（多副本一致）

同一个 monitor URL 会被加载成多个副本：App 主窗 iframe、App 投影窗口 iframe、⌘⇧R 重载后的新副本、浏览器标签页。视图调整（开关、调试选择）若放页面本地，每个副本各自从默认值起步——主窗里调好的内容，投影端要重新调一遍，重载即丢。本模板把 monitor 视图状态搬到**工程 server 单一持有**：`lib/monitor-state.js` 挂在 Socket.IO 的 `/monitor` namespace（`public/shared.js` 的 `monitorNamespace`），连接即推快照、任一副本 `set` 即向全部副本广播**完整状态**。页面（`public/client.js` 的 `connectMonitor` 传 `monitorNamespace` 后）从 `viewState` 渲染、调整走 `setViewState` 上报，**不改本地**；快照落地前视图相关 UI 保持隐藏（不闪默认值）。**App 侧零改动**——两副本本就各自直连工程 server，App 不在这条数据路径上（这也是模式不受 App 版本约束的原因）。

- 状态**按键 opt-in**：`public/shared.js` 的 `monitorViewState` 声明本作品要同步的键与默认值（示例只有一个 `showQr`）；未声明的键 server 一律忽略，页面可保留纯本地状态（如悬停高亮）。
- 生命周期 **session 级**：内存持有、不落盘（与座位 registry 的磁盘持久化明确区分）——重启即回到默认，每场演出从干净状态开始。
- 广播范围**仅 monitor 侧客户端**：performer 页从不连 `/monitor` namespace，结构性零感知。
- 示例：monitor 页右上角「显示/隐藏二维码」按钮——投影副本不想给观众看二维码时，在主窗副本点一下即可，所有副本同步跟随。

协议细节（三事件、页面接线、自定义键）见模块手册的 [monitor 视图状态](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/modules/monitor-state.md)。

## 独立可交付技术模块（0.2.0）

`modules/` 是六项独立源码交付单元：`qr`、`players`、`theme-follow`、`locale-follow`、`monitor-state`、`hub`。每个目录含实际源码、CommonJS 范围的 `package.json`、双语 `README.md` 与 `compatibility.json`。模块版本、Host 协议、运行依赖和作品适配条件分别说明；App 版本不代替已加入源码版本。目录中的说明使用对应源码公开接口，复制后由作品维护，不会自动升级定制实现。

Template 原有 `lib/` 与示例接线保持现状；独立模块适合其他工程按需采用，其事件、身份、声音、画面与摘要策略由作品决定。两个客户端/monitor 状态条目可以共同加入；主题与语言条目独立加载。hub 使用既有 `PNDS_NODE_ID`、`PNDS_HUB_URL`、`PNDS_HUB_TOKEN`、`PNDS_HUB_ROOM`，继续遵守 Host 的 telematic 配置门；本地手机连接本现场 performer，远端节点数与乐手摘要条数分开。

接线先读各模块 README 与装机帮助 `help/zh-CN/modules/README.md`，缺装机资料时查 [App 模块索引](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/modules/README.md)；运行契约使用同版 `reference/runtime-contract.md`。App 的文件加入与来源记录仍是待接线交接，不等于依赖已安装、入口已引用或实际运行已验证，也不要求安装 Skills。

`fixtures/modules/` 和 `test/modules-*.test.js` 使用本次交付源码，通过真实 HTTP、Socket.IO、中央 hub 子进程、独立工程节点和本地客户端验证技术行为；fixture 不带入示例艺术规则。`npm run check` 同时检查这些模块和 fixture 的语法，`npm test` 运行原示例与模块回归。本次集成在实际 Template 目录通过 `npm run check` 与 `npm test`（153/153）。

2026-10-14 已在真实浏览器检查 `fixtures/modules/display-server.cjs`：首帧 Stage/en 的主题和语言回调各 1 次；重复消息保持各 1 次；切换到 Pond/zh-CN 后各 2 次；释放后再次切换没有改变已有显示。实际 QR 图片显示正常，performer 页面保持独立。另由 macOS Vision 独立解码 HTTP 返回的 PNG，核对完整 URL 的协议、端口、路径、查询与片段。这里分别记录浏览器与自动解码证据；真实 WKWebView、手机扫码、外部公网、声音与演出负载仍由作者验收。

## 目录结构

```
manifest.json             PNDS 工程契约（App 只认它和 server 入口）
server.js                 作品主 server：编排协议（通常不用改）
lib/                      可复用核心，任何 PNDS 工程通用（template 骨架，通常不用改）
  config.js               manifest / CLI / 端口 / 环境变量 / 完整 performer URL 解析
  network.js              LAN IPv4 枚举
  health.js               /__pnds/health
  osc-transport.js        UDP OSC 传输（osc-min + dgram）
  audio-engine.js         scsynth 会话生命周期（bus / group / synthdef 加载）
  players.js              客户端 id 分配与重连恢复（claim token；已记录座位优先、他人座位保留）
  seats-store.js          座位记录持久化（token → {id, out}，跨重启；`.pnds-seats.json`）
  protocol.js             Socket.IO 协议：join / claim / 重连恢复 / 控制转发（载荷不透明，字段语义在作品层）/ 座位记录 / 重配 / 广播
  monitor-state.js        monitor 视图状态单一事实源（/monitor namespace：连接推快照、set 广播；内存 session 级，见上文「monitor 视图状态同步」）
  lifecycle.js            优雅关闭
  theme-follow.js         主题跟随（App ≥ v1.2.3，可选）：消费 pnds:theme 消息（见上文「主题跟随」）
  locale-follow.js        语言跟随（App ≥ v1.3.0，可选）：消费 pnds:locale 消息（见上文「语言跟随」）
  qr.js                   performer 页面 QR 码（GET /qr）
audio/                    作品音频语义层：推子 → synth 参数的映射（创作时改这里）
  controller.js           每客户端一个 voice，声道分配，外部 OSC 协议
public/                   浏览器端（performer + monitor 双角色单页）
  index.html              双角色入口（按服务端注入的 role 加载不同脚本；socket.io：performer 同源 / monitor 跨端口）
  shared.js               浏览器与 server 共用的常量：事件名 / 频率范围 / 入口上下文（单一事实来源，见下文）
  client.js               浏览器端 score-server 客户端：performer 同源加入/重连恢复/去抖发送、monitor 内部连接与状态视图（页面只管绘制与输入；有 Node 测试）
  performer.js            演奏者横屏推子界面（p5）
  monitor.js              监视端：列表 + 声道分配 + 重配 ID 按钮
  style.css
  libraries/p5.min.js     p5 库（本地文件，演出离线可用）
supercollider/
  source/                 SynthDef 创作源码（.scd）——唯一事实源
    template-sine.scd     本模板的 sine voice 定义
  debug/                  External debug bridge（创作期工具）
  synthdefs/              已编译 .scsyndef（运行时 artifact，manifest 引用）
test/                     node --test 回归测试（AI 编程助手改工程后跑它验证，见 AGENTS.md）
docs/                     本手册
```

## 创作时改什么

| 想做什么 | 改哪里 |
|---|---|
| 换作品名 / 端口 / 声道数 | `manifest.json`（改端口只需改这里） |
| 改推子 → 声音的映射 | `audio/controller.js` |
| 加一个控制字段（如新推子） | `public/performer.js`（发送）+ `audio/controller.js`（在 `applyControls` 读取并钳位；协议层不透明转发，`lib/` 不用动） |
| 改声音本身（波形、效果） | `supercollider/source/template-sine.scd`，然后重新编译 |
| 改演奏者界面 | `public/performer.js`（p5） |
| 改监视端 | `public/monitor.js` |
| 改主题跟随 | `lib/theme-follow.js`（默认映射、onTheme / derive 口子、?theme= 初值） |
| 改界面语言 / 加语言 | `public/monitor.js` 的 `STRINGS`（加语言同步加 `locales`；locales / fallback 口子见 `lib/locale-follow.js`） |
| 调设备演奏序号 | monitor 页 ID 下拉（目标序号需空闲） |
| 清空设备座位记录（换手机阵容） | monitor 页 **重配 ID** 按钮，或删除 `.pnds-seats.json` 后重启 |
| 加 Socket.IO 事件 | `public/shared.js`（事件名）+ `lib/protocol.js`（处理——核心协议语义，一般不需要） |
| 加 / 改 monitor 视图状态键（多副本同步的开关、调试选择） | `public/shared.js` 的 `monitorViewState`（声明键与默认值）+ `public/monitor.js`（渲染与 setViewState 上报；机制见模块手册 [monitor 视图状态](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/modules/monitor-state.md)） |
| 改推子频率范围 / 音区 | `public/shared.js` 的 `registers`（每区 `freqRange` + `freqTicks`；页面显示、刻度与 server 发声自动同步，无需改 `audio/controller.js`） |
| 改客户端上限 | `manifest.json` 的 `audio.outputChannels`（id 上限 = 输出声道数） |

## 单一事实来源（Single Source of Truth）

`public/shared.js` 是浏览器页面与 Node server **共用同一份常量**的模块：

- 它用 UMD 包装：浏览器里挂到 `window.PNDS`（页面脚本里 `const P = window.PNDS` 取别名），Node 里走 `module.exports`（server 端 `require`）。
- **Socket.IO 事件名**（`events`）、**频率范围**（`freqRange`）、**客户端上限**（`maxClients`）、**localStorage token 键名**（`tokenKey`）都在这里定义。
- **端口**的单一来源是 `manifest.json`（App 工程契约）。`shared.js` 在 Node 端自动从 manifest 读取，浏览器端由 server 动态注入——创作者只需改 manifest.json。
- 修改频率范围只需改 `registers`（每区 `freqRange.min / max`）一处：performer 页面的 Hz 显示与 server 端 `audio/controller.js` 的 `mapFreq()`（从 shared 读取）自动同步。线性映射辅助（`freqFromValue` / `freqFraction`）与推子刻度（每区的 `freqTicks`）也在 shared.js 中定义；`freqRange` / `freqTicks` 是默认音区（3）的别名。
- 基于模板创建新作品时，建议修改 `tokenKey` 为与作品 id 一致的名称（如 `”my-work-token”`），避免不同工程共用同一个 localStorage 键。

## 声音：编辑与编译 SynthDef

`.scd` 是创作期源码与唯一事实源，`.scsyndef` 是运行时 artifact。改完 `.scd` 后必须重新编译，否则 App 加载的是旧声音：

- 在 PNDS App 中打开本工程，`Settings → Developer Tools → Compile SynthDef`（使用本机安装的 SuperCollider）；
- 或在本机自行运行 sclang。

编译契约见参考手册的 [supercollider.md](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/reference/supercollider.md)；本模板的实例：**SynthDef 符号名 = 产物文件名 = manifest 引用**（`template-sine`；带连字符的名字在 .scd 中须写作 `'template-sine'` 引号符号形式），产物写入 `supercollider/synthdefs/template-sine.scsyndef`，App 会在编译后逐个校验 manifest 引用的产物。

## 音频模式

| 模式 | 说明 |
|---|---|
| `internal` | App 托管 scsynth，加载编译好的 `.scsyndef`（演出模式） |
| `external` | 向自定义 OSC target 发送作品协议（`/c<id>/amp`、`/c<id>/freq`、`/c<id>/out`） |
| `none` | 不建立音频输出（只测试页面与网络） |

三种模式的语义见参考手册的 [audio-modes.md](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/reference/audio-modes.md)。External 模式调试：在 SuperCollider IDE 中先运行 `supercollider/source/template-sine.scd`，再运行 `supercollider/debug/template-debug.scd`，然后：

```sh
node server.js --audio-mode external --osc-target 127.0.0.1:57120
```

## 健康检查

两个端口都提供：

```sh
curl http://127.0.0.1:6868/__pnds/health
```

PNDS App 以 JSON 中 `status === "ready"` 为显示条件；health 的完整契约见参考手册的 [runtime-contract.md](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/reference/runtime-contract.md)。

## 发布

带生产依赖的发布包由 `.github/workflows/package.yml` 构建（ALLOWLIST 裁剪，`node_modules` 预装，docs / test / 源码不进演出包）。完整的发布流程与发布前检查清单见 PNDS App 的[创作指南第 4 节](https://github.com/xO-xN/PNDS-App/blob/main/docs/zh-CN/template-guide.md)。

## v0.7.0 固定共享库接线（#198）

manifest 的 sharedLibraries 是运行条件。Host 注入 PNDS_SHARED_LIBRARIES 的确切版本入口；本工程只 require Node 类入口，osc-min 经异步 import，浏览器库通过工程自己的 /__pnds/shared/ 同源路径提供。Host 环境存在时缺项、版本错误或文件缺失会明确失败，绝不使用本地旧版回退。无 Host 环境的 standalone 调试使用 npm 精确依赖。模型、示例源码、音乐协议、SynthDef 仍属于工程。

p5 2 的指针输入保持两根推子各自抓取触点 id 的生命周期；鼠标仍可调试。Express 5 监听错误不打印成功。OSC DataView 按 byteOffset/byteLength 转成 UDP 字节，保持原协议。页面、音频、原生 App 与安装往返仍须真机验收。

验证记录（2026-10-14）：npm run check 与 npm test 全绿（161 tests）。Chromium 149.0.7827.102 在断公网条件下实际绘制 p5 像素、将两触点独立推子控制传到 Socket.IO monitor 状态，并刷新恢复身份；共享临时工程不带 node_modules。受控 UDP 验证 osc-min 2 DataView 精确字节与 /synced 回复。真实手机、音频设备、原生 App、可信 HTTPS 与打包安装仍待创作者验收。
