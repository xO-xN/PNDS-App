# monitor 视图状态

同一个 monitor URL 会以多个副本活着：App 主窗 iframe、App 投影窗口 iframe、⌘⇧R 重载出的新副本、排练时打开的浏览器标签页。视图状态（视图开关、调试选择）放在页面本地时，每个副本各自从默认值起步——指挥在 App 端 monitor 里调好的内容，投影端要用鼠标重新调一遍；显式重载也会把调好的状态丢回默认。

monitor 视图状态把这份状态搬到**工程自己的 server** 单一持有：任何副本连接即收到当前快照，任一副本的变更即时广播给全部副本；页面从 server 状态渲染、用户调整改为上报。所有副本自然一致，重载不丢状态。

## App 零改动的架构前提

两个 monitor 副本（主窗与投影）本来就各自直连工程 server，App 不在这条数据路径上——这是模式成立的原因，也是它不受 App 版本约束的原因。任何工程的 monitor 调试状态想镜像到浏览器 / 投影副本，直接套用本模式，不需要 App 配合。

## 三个事件

协议只有三个事件，事件名在 `public/shared.js` 的 `events` 里（作品的线缆词汇表）：

| 方向                  | 事件                     | 载荷             | 语义                                                   |
| --------------------- | ------------------------ | ---------------- | ------------------------------------------------------ |
| server → 刚连接的副本 | `monitor:state:snapshot` | 完整状态对象     | 连接即推；重连也会再收到（错过的广播由下一次快照自愈） |
| 副本 → server         | `monitor:state:set`      | `{ key, value }` | 上报一次调整；未声明的 key 被忽略                      |
| server → 全部副本     | `monitor:state`          | 完整状态对象     | set 生效后的广播；最新值胜出、应用幂等                 |

广播永远是**完整状态**而非增量——副本不需要按序应用，漏一条广播也能在下一次快照收敛。

## server 侧：声明即同步

`lib/monitor-state.js` 是可复用骨架，`server.js` 一行接线：

```js
attachMonitorState(io.of(shared.monitorNamespace), {
  events: shared.events,
  defaults: shared.monitorViewState,
})
```

- **namespace 即广播范围**。视图状态住在 Socket.IO 的 `/monitor` namespace（`shared.monitorNamespace`），performer 页从不连接这个 namespace——广播范围是结构性的，不需要维护名单，演奏者页面零感知。
- **声明即 opt-in**。`shared.monitorViewState` 声明本作品要同步的键与默认值（模板示例只有 `showQr`）。只有声明的 key 会被存储与广播；页面想保留的纯本地状态（悬停高亮等瞬态 UI）不声明即可。
- **session 级生命周期**。状态只在内存：重启工程即回到 `monitorViewState` 的默认值——每场演出从干净状态开始，不继承上一场的调试残留。这是与座位 registry 的明确分工：座位跨重启落盘（`.pnds-seats.json`），视图状态不落盘。

## 页面侧：等快照、上报 set

`public/client.js` 的 `connectMonitor` 传 `monitorNamespace`（来自 `shared.js`）即启用视图通道——monitor 页在该 namespace 上多开一个 socket（同一 socket.io 连接复用），接口三件：

```js
const client = PNDSClient.connectMonitor({
  io,
  port: P.performerPort,
  events: P.events,
  hostname: location.hostname,
  monitorNamespace: P.monitorNamespace,
});

client.viewState; // null 直到第一份快照落地，之后是最新状态
client.onViewState((state) => {...}); // 快照与广播走同一条交付路径
client.setViewState("showQr", false); // 上报调整；本地不翻转
```

页面渲染遵守两条纪律，模板的 `public/monitor.js`（QR 显隐按钮）是现成示例：

- **等快照落地**：`viewState` 为 `null` 时不渲染任何视图相关 UI（隐藏而非先画默认值）——新副本首帧不会闪「先默认后纠正」的跳动。
- **调整只上报**：控件事件里调 `setViewState`，状态与 UI 都等广播回来再变——发送者副本与其它副本走同一条收敛路径。

## 边界（何时不用它）

- **低频视图状态专用**：开关、调试选择这类操作员调整。高频视觉流（canvas 指针轨迹等）不要走这条通道——真需要时由工程用同一 server 通道自行设计。
- **投影专属画面**（`?surface=venue` 那类参数化投影像素）是另一条路径：本模式服务「投影 = monitor 镜像」，与专属画面正交。
- 状态不跨工程共享、不跨演出持久化——session 级是特性不是缺陷。
