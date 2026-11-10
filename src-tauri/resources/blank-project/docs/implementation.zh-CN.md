# Blank {{templateVersion}} 实现说明

App 已完成工程初始化与第一个本地 Git 版本。实施当前用户直接指派的任务；
受托接手创作交接单时，按 AGENTS 入口处理整份当前任务。随工程变化维护本说明。

## 修改位置

| 文件                                              | 用途                                      |
| ------------------------------------------------- | ----------------------------------------- |
| `public/monitor.html`                             | 监视页面结构和脚本入口                    |
| `public/monitor-view.json`、`lib/monitor-view.js` | 低频视图声明、验证与惰性同步              |
| `public/monitor.js`                               | 乐谱绘制、监视交互和参数回调              |
| `public/performer.html`、`public/performer.js`    | 演奏者页面与交互                          |
| `public/style.css`                                | 初始共享样式；需要时再按页面拆分          |
| `pnds.preview.json`                               | 可调字面量的精确声明；初始为空            |
| `public/pnds-preview.mjs`                         | App 提供的本地预演协议适配器              |
| `server.js`                                       | HTTP 资源、health、脚本快照和运行生命周期 |
| `audio/controller.js`、`supercollider/`           | 音频与 OSC 实现；初始为静音占位           |

HTML、JavaScript 和 CSS 分别放在对应文件中，共享代码与素材按需添加。
server 提供 public 文件和本地 Socket.IO 客户端，使用正确 MIME 和 `Cache-Control: no-store`。
公共文件保存后刷新监视页面加载新版本；修改 Node server 或其导入的音频代码后需重启工程。
刷新和重启由创作者在 App 中主动执行。

默认生产依赖为 App 确切共享引用的 Express 5.3.0、Socket.IO 4.8.4 和 osc-min 2.1.2。
Express 承担角色路由；受限 public 文件解析保留 MIME、真实路径和缓存规则。server 读取注入的
绝对 Node 入口，音频控制器用 file URL 导入 osc-min 的 ESM 入口，按实际 DataView 的偏移与长度
发送 UDP。缺少资源或版本不符明确失败，不执行 npm，不回退 CDN 或下载。
两个页面从本地 `/socket.io/socket.io.js` 加载客户端，用 `io()` 连接各自同源地址。
server 为两个 HTTP 端口各建一个 Socket.IO 实例，通过 `realtime.get('performer')` 和
`realtime.get('monitor')` 访问。连接后收到 `pnds:connected`，含工程 ID 和服务端确定的角色。
在 server 的 connection 回调添加作品事件，页面使用已有 `socket` 收发消息；例如指挥消息
处理器可通过 `realtime.get('performer').emit(...)` 发给演奏者。
socket ID 只标识一次连接；默认 players 已接好无座位持久身份，不要重复采用。
初始没有作品消息或声音映射。

默认 Internal：音频控制器和预编译 SynthDef 向注入的私有 bus 输出静音；External 和 None
仍可选择。替换占位声音时一并维护控制器、SCD 源和编译产物这三个文件。

其他依赖按任务明确采用 App 固定共享包，再完成本地路由与导入接线。
App 内创作与演出保持离线，无需 npm 安装。脱离 App 开发可在本地安装 package.json
的确切依赖；Internal 仍需要 Host 提供音频环境。

README.md 使用创建时语言，只放创作者实际填写的简介；未填写时留空。需要时再添加语言变体。
App 在正式记录交接时创建 docs/creator-handoff.md，新建 Blank 没有待办。
README 面向演出观众，技术说明写在本页。.gitignore 同时供外部 Git 工具使用，
运行素材、SCD 源和已编译 SynthDef 仍纳入版本。

## 添加可调参数

监视页的预演基础接线已就绪，初始没有参数和控件。在工作模式中，助手完成以下三步，
再展示保存文件中的参数控件。以修改标题字号为例：

1. 在 `public/monitor.js` 中定义实际可变值并应用到画面，将 `previewParameters` 替换为实际回调：

   ```js
   let titleSize = 48 // px
   const renderTitleSize = () => {
     document.querySelector('h1').style.fontSize = `${titleSize}px`
   }
   renderTitleSize()
   const previewParameters = {
     titleSize: {
       kind: 'number',
       limits: { min: 12, max: 120, step: 1 },
       get: () => titleSize,
       set: value => {
         titleSize = value
         renderTitleSize()
       },
     },
   }
   ```

2. 在 `pnds.preview.json` 中登记相同 ID、类型、限制和精确的整行锚点，保留其他参数：

   ```json
   {
     "schemaVersion": 1,
     "parameters": [
       {
         "id": "titleSize",
         "path": "public/monitor.js",
         "prefix": "let titleSize = ",
         "suffix": " // px",
         "kind": "number",
         "limits": { "min": 12, "max": 120, "step": 1 },
         "preview": "live"
       }
     ]
   }
   ```

3. 保存，执行当前可用检查，并展示由原生绑定验证的保存参数。
   新保存的代码需要先刷新一次监视页；拖动控件临时预演，保存参数才持久化并计入任务撤回。
   结束预演恢复运行时基线，不恢复已经流逝的音乐时间。

保留监视页的脚本引用：server 为每次页面加载固定 `public/monitor.js` 的实际字节，
同时传递源码与参数声明摘要。再次保存后，旧页面仍对应自己加载的版本。
若参数移到额外文件，要一并扩展它们的实际加载快照和回调；事后计算磁盘摘要不能证明代码已加载。
回调须修改实际状态，暂停的乐谱需要时主动重绘；音频回调只使用工程已经启用的音频。

演出过程中仍可静态检查。运行时占用会阻止独立运行验证，保留当前工程运行。
画面与声音的实际效果另行验证；平台契约入口见 `AGENTS.md`。

## 确认后的浏览器入口

生成的 manifest 声明浏览器接入协议 1 及运行监听器交接。演奏端使用相对资源路径，Host
确认后提供 `./__pnds/context.js`。新增资源／Worker 请求使用
`PNDS_PARTICIPATION.resource(relative)`，Socket.IO 接收
`PNDS_PARTICIPATION.socketOptions` 的副本。长期池主／工程数据键使用
`PNDS_PARTICIPATION.storageKey(key)`，不用演出身份作为恢复键；该命名空间避免功能
串用，不构成 origin 级安全隔离。Blank 在身份接纳且浏览器 claim 保存成功后报告页面准备；作品需要更强的资源
准备条件时须自行核验。原工程地址继续支持没有 Host 确认的独立运行。

## 默认演奏者身份

`players/policy.js` 为 `modules/pnds-players/protocol.js` 提供无座位政策；
`public/performer.js` 已经从限定的 `/pnds-players.js` 路由接好通用客户端，
不需要再次采用 players。页面的 `PNDS_PLAYER` 提供 `identity.id`、
`sendControls`、`sendAction` 和 `onChange`；`server.js` 的 `onControl`、
`onAction`、`onRelease`、`snapshot` 是实际作品接线位置。政策在每次有效回调
前核对当前连接拥有者，扩展作品时保留这些门禁。monitor 只观察，不分配身份。

`.pnds-creation/players.json` 只持久保存随机 claim 与演奏者 UUID 的对应，
控制、触点、分谱选择及声音状态是独立的每场状态。损坏、异工程、符号链接、
不私密的登记或保存失败均明确报错，不伪报恢复成功。私有目录不进入 Git、
源码工具／摘要及默认演出包；完整复制含隐藏数据的文件夹会携带身份登记，
普通工程分发则从新登记开始。

浏览器 claim 沿已确认 Host／工程作用域恢复，不使用演出 ID。直接地址使用
manifest 工程 ID；原生测试窗口标签加入独立后缀，同一台 Mac 的窗口不会合并。
存储拒绝显示错误且不报告准备成功。新演出仍需明确进入；逻辑接管不转移
摄像头或麦克风所有权。实际设备和浏览器表现另行验证。

## monitor 视图声明

monitor 视图同步已默认加入并接线。`public/monitor-view.json` 初始为 `{}`：
server 不创建 `/monitor-view`，页面也不连接额外 socket。仅声明作品实际需要的低频视图选项，例如：

```json
{
  "displayMode": { "default": "score", "values": ["score", "details"] },
  "detailLevel": { "default": 1, "min": 0, "max": 5 }
}
```

每个字段必须包含 `default`，并按该值的 JSON 类型校验。可选 `values` 限定合法选项，
数值的 `min`／`max` 限定范围。声明无效会使启动明确失败。修改声明后重启工程；保存不会
悄悄替换本次运行的 schema。`lib/monitor-view.js` 负责验证，只在有字段时接入
`modules/pnds-monitor-state/` 中的固定模块。monitor 的
`/__pnds/monitor-view.json` 返回本次运行实际采用的声明。

在 `public/monitor.js` 中通过 `window.PNDSMonitorView.onViewState(state =>
{ /* 按 state 渲染 */ })` 订阅。等待新快照时 state 为 null。
`PNDSMonitorView.setViewState('displayMode', 'details')` 只上报选择，画面必须等待
server 的完整快照，不先改本地状态。`viewState` 读取及各订阅者收到独立副本；`error`
提供更新被拒绝或配置加载失败的原因。晚加入、刷新与重连取得当前运行状态；停止重开恢复
声明初值。页面释放只关闭自己的视图 socket，普通 monitor 连接仍是观察者，不分配演奏身份。

此通道不放乐谱时间、高频演奏输入、声音、claim、App QR 显隐或投影开演状态。App QR
由 Host 管理。冻结通用模块 README 的历史 `showQr` 示例属于旧定制工程，不是本 Blank
的 App QR 或投影控件。本默认基础在资源目录中已存在，不要再次添加或生成待接线／交接任务；
作者修改后的源码仍由工程维护。

## 默认演奏输入

Blank 已把 `public/pnds-input.js` 接到获得接纳的 `PNDS_PLAYER` 和 `<main>`。
按作品修改这个输入区域及其反馈，不必再加 p5/ml5 或选装输入模块。鼠标始终是单点，
真实触屏可以提供多个独立触点。支持 PointerEvent 的页面只消费 pointer 一条路径，
App 鼠标测试和其合成／兼容 touch 不会重复进入业务；旧触摸页面读取 changedTouches，
保留普通鼠标单点并抑制触摸后的兼容鼠标事件。原生表单控件仍按自己的方式工作。

每个手势有独立、不透明的 ID，具有 start/move/end/cancel 语义；每次事件都从当前尺寸
计算相对 x/y、归一化 nx/ny 及 width/height，缩放、方向、全屏与 resize 不沿用旧几何。
每个演奏者最多 64 个并行触点是技术资源上限。失焦、页面隐藏、丢失捕获、断线及显式关闭
只清理自有手势；区域变为零尺寸时，终止事件仍能复用最后有效几何。旧终止不能清掉后继
手势。`PNDS_INPUT.close()` 只释放输入，不退出身份；释放页面时两者一起关闭，重连不补发
旧的持有输入。

`server.js` 在当前 claim 所有者校验之后调用
`performance.prepareInput(identity.id, payload)`，再调用 `performance/state.js` 的
`performance.applyEvent(identity.id, event)`。这是共同作品应用入口；扩展声音或画面时
同步维护实际状态和释放语义。接纳后的触点属于每次运行的真实状态，与持久身份、选谱、
记录时间和声道分别表达。`release(id)` 清理该来源；`snapshot()` 返回独立副本：
`{ performers: [{ id, contacts: [{ id, pointerType, x, y, width, height, nx, ny }] }] }`。
两个角色已有的 Socket.IO 连接在 `pnds:performance` 发布完整快照，初次连接也有快照；
monitor-view 只处理低频视图。作者明确接出反馈时，可在 monitor 用
`socket.on('pnds:performance', render)` 绘制已接纳触点。默认工程提供真实接线，不塞入
示例作品或音色预设。

通过实际编辑后的工程和可观察反馈验证。受控 DOM pointer／TouchEvent 只证明数据通路，
不代表手机多指硬件、原生体验或真实听音已经验收；这些结果单独记录。

## 默认演奏记录闭环

底栏“演奏记录”已经可以记录空白工程的已接纳触点、回放、叠加轮次和整轮重录，
不需要选装录制模块。`pnds.recording.json`、`performance/recording.js` 和
`recording/adapter.cjs` 是真实默认接线。App 拥有存储、轮次管理和共同时间驱动，
工程拥有实际状态与效果；既有定制适配不会被替换。

现场输入先核对当前连接拥有者和触点生命周期，再捕获事件并进入与回放相同的
`applyEvent`。回放不再次捕获。普通录制成功停止后保留现场持有输入；叠加会保留
真正未抬起的手指，在新轮次 0ms 捕获其开始状态。同一设备在不同轮次是独立记录源。
恢复初始触点时按 App 提供的回放演奏者成员过滤，重录或删除一轮不会复活旧触点。
默认基础没有艺术分谱、乐谱时间、音色或声部预设。

新增真实状态、画面、声音或动作时，在同一任务完成闭环。扩展 `snapshot()` 返回
实际作品状态，同时保留 `snapshotInput()` 为纯触点快照，供所有权清理使用。
可编辑 performance 对象可提供这些同步作品回调：

| 回调                                                  | 实际职责                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `restoreWork(state, members, context)`                | 按许可回放成员释放／恢复作品和选择；`context.liveIds` 与 `context.currentState` 标识保留的真实现场状态，随后持有输入仍经公共业务入口重建。                                           |
| `applyWork(event)`                                    | 实际应用输入／动作／指挥效果。`sourceId` 是现场或隔离回放源，`performerId` 是独立记录身份；现场 `atMs` 为 null，回放为记录相对时间。join／selection 只更新身份事实，不重复触发音乐。 |
| `releaseWork()`                                       | 幂等释放作品自有的全部效果与资源，包括部分恢复失败后的状态。                                                                                                                         |
| `advanceWork(elapsedMs)`                              | 实际推进有时间行为的作品，保留暂停／定位，区分乐谱位置与记录经过时间。只有确有进度行为时才添加。                                                                                     |
| `prepareAction(payload)`、`prepareConductor(payload)` | 验证并规范作品真实的离散演奏动作和共同指挥，无效返回 null。                                                                                                                          |
| `selectionFor(sourceId)`                              | 如实报告独立分谱选择，不从设备／测试窗口编号推测。                                                                                                                                   |

不完整作品回调会明确失败。回调保持同步；后来加入异步应用，需要另行解决所有权
与串行化。能力声明或空回调不证明任意新音乐都可回放；扩展后验证实际现场、回放、
叠加和整轮重录效果。monitor 的 `pnds:conduct` 有效处理器限制共同指挥，叠加中
已接纳演奏者仍可使用自己的动作。默认没有凭空生成指挥命令。

纯回放禁止新的页面触点，实际接纳仍由服务端把关。连接或身份丢失仍清理自有输入；
模式通知只改变 `PNDS_INPUT.setStartsAllowed(...)`，不能全局清掉后继手势。
回放恢复和真正释放时仅发送当时清除的现场演奏者／手势 ID；旧回放／结束通知即使在
新录制已接纳新手势后才到达，`PNDS_INPUT.cancel(ids)` 也只取消对应旧触点。模式事实变化时才
推送通知。应用失败即使先点击停止、尚未轮询，也只保留不完整恢复资料和原有完整
记录；清理失败只重试本操作拥有的释放，不重跑业务。普通成功停止录制不会启动或
重置作品。真实声音与触摸硬件仍需各自验收。
