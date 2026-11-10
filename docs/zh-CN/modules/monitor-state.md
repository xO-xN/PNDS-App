# monitor 视图状态

## v1.6.1 标准模块

新建 Blank 已默认加入并接线。本工程可编辑的 `public/monitor-view.json` 初始为空，声明实际视图字段后才启用专用连接；目录显示已包含，不产生待交接任务。既有手动采用或作者定制工程保留原源码与接线。

离线发布版 0.2.0 加入 `modules/pnds-monitor-state/`，带同版本源码、兼容声明与双语 README。标准版用独立的 `monitor-client.js` 和全局 `PNDSMonitorState.connectMonitorState`，不再复制混合 performer 客户端。工程在专用 monitor namespace 上接入 `attachMonitorState`，声明键、默认值、事件名和可选 validator；快照只活在本次 server 生命周期，未知/非法更新不改变状态。 完整输入/输出、接线和清理步骤以已加入目录的 README 为准；源码归工程维护，文件加入不代表接线或运行验收。

## Template 示例实现

同一个 monitor URL 会以多个副本活着：App 主窗 iframe、App 投影窗口 iframe、⌘⇧R 重载出的新副本、排练时打开的浏览器标签页。视图状态（视图开关、调试选择）放在页面本地时，每个副本各自从默认值起步——指挥在 App 端 monitor 里调好的内容，投影端要用鼠标重新调一遍；显式重载也会把调好的状态丢回默认。

monitor 视图状态把这份状态搬到**工程自己的 server** 单一持有：任何副本连接即收到当前快照，任一副本的变更即时广播给全部副本；页面从 server 状态渲染、用户调整改为上报。所有副本自然一致，重载不丢状态。

## App 零改动的架构前提

两个 monitor 副本（主窗与投影）本来就各自直连工程 server，App 不在这条数据路径上——这是模式成立的原因，也是它不受 App 版本约束的原因。任何工程的 monitor 调试状态想镜像到浏览器 / 投影副本，直接套用本模式，不需要 App 配合。

## 三个事件

新建 Blank 的事件表由 `lib/monitor-view.js` 与页面连接器接线。冻结通用模块接收事件表，因此既有工程保留自己的事件名。三个状态事件为：

| 方向                  | 事件            | 载荷             | 语义                                                   |
| --------------------- | --------------- | ---------------- | ------------------------------------------------------ |
| server → 刚连接的副本 | `view:snapshot` | 完整状态对象     | 连接即推；重连也会再收到（错过的广播由下一次快照自愈） |
| 副本 → server         | `view:set`      | `{ key, value }` | 上报一次调整；未声明的 key 被忽略                      |
| server → 全部副本     | `view:state`    | 完整状态对象     | set 生效后的广播；最新值胜出、应用幂等                 |

广播永远是**完整状态**而非增量——副本不需要按序应用，漏一条广播也能在下一次快照收敛。

## server 侧：声明即同步

新建 Blank 已包含冻结模块及 `lib/monitor-view.js` 接线。保存 `public/monitor-view.json`，再重启工程：

```json
{
  "displayMode": { "default": "score", "values": ["score", "details"] }
}
```

- **namespace 即广播范围**。新建 Blank 的视图状态住在 monitor server 的 `/monitor-view` Socket.IO namespace，performer 页从不连接这个 namespace——广播范围是结构性的，不需要维护名单，演奏者页面零感知。
- **声明即 opt-in**。`public/monitor-view.json` 声明本作品要同步的键与默认值（例如 `displayMode`）。只有声明的 key 会被存储与广播；页面想保留的纯本地状态（悬停高亮等瞬态 UI）不声明即可。
- **session 级生命周期**。状态只在内存：重启工程即回到 `public/monitor-view.json` 声明的默认值——每场演出从干净状态开始，不继承上一场的调试残留。它与持久演奏者身份分别表达：身份登记跨重启保留，视图状态不落盘。`default` 确定字段的 JSON 类型，可选 `values`、`min` 和 `max` 限定作品选项与数值范围；声明无效明确启动失败，更新被拒绝时保持原状态。

## 页面侧：等快照、上报 set

新建 Blank 的 `public/monitor.js` 从 `/__pnds/monitor-view.json` 读取本次运行的声明。空声明时 server 不建立 namespace，页面不增加 socket；有真实字段时使用已接线公共接口：

```js
const client = window.PNDSMonitorView
client.viewState // 完整 server 快照到来前为 null
client.onViewState(state => {
  /* 按完整快照渲染 */
})
client.setViewState('displayMode', 'details') // 只上报，不先改本地
```

页面渲染遵守两条纪律；在 `public/monitor.js` 接出实际视图选择控件时同时落实：

- **等快照落地**：`viewState` 为 `null` 时不渲染任何视图相关 UI（隐藏而非先画默认值）——新副本首帧不会闪「先默认后纠正」的跳动。
- **调整只上报**：控件事件里调 `setViewState`，状态与 UI 都等广播回来再变——发送者副本与其它副本走同一条收敛路径。

## 边界（何时不用它）

- **低频视图状态专用**：开关、调试选择这类操作员调整。高频视觉流（canvas 指针轨迹等）不要走这条通道——真需要时由工程用同一 server 通道自行设计。
- **投影专属画面**（`?surface=venue` 那类参数化投影像素）是另一条路径：本模式服务「投影 = monitor 镜像」，与专属画面正交。
- 状态不跨工程共享、不跨演出持久化——session 级是特性不是缺陷。

既有手动模块仍按随附 README 接线。新建 Blank 使用上面的声明与校验封装，不把历史 `showQr` 示例用于 App QR 或投影开演控件；App QR 由 Host 管理。快照读取与各订阅者收到独立副本，调用者不能篡改其他副本或 server 状态。页面释放只关闭自己的视图连接；乐谱时间、声音、claim 与高频演奏输入不进入此通道。
