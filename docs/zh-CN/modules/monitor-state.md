# monitor 视图状态

## 默认接线

新建 Blank 已加入并接好 `modules/pnds-monitor-state/`。`public/monitor-view.json` 初始为空；声明实际字段后才启用专用连接，不产生待交接任务。通用模块接口见工程同目录 README。

## 共享状态

工程 server 单一持有低频视图选择，主 monitor、投影与其他副本从完整快照渲染；任一副本上报选择后，所有副本等待 server 广播，不先改本地状态。

## App 零改动的架构前提

monitor 副本直接连接工程 server，视图同步不经过 App。页面释放只关闭自己的视图连接。

## 三个事件

Blank 由 `lib/monitor-view.js` 接好以下事件；通用模块可接受工程事件表：

| 方向                | 事件            | 载荷             |
| ------------------- | --------------- | ---------------- |
| server → 新连接副本 | `view:snapshot` | 完整状态对象     |
| 副本 → server       | `view:set`      | `{ key, value }` |
| server → 全部副本   | `view:state`    | 完整状态对象     |

## server 侧：声明即同步

编辑 `public/monitor-view.json` 后重启工程，例如：

```json
{ "displayMode": { "default": "score", "values": ["score", "details"] } }
```

每项以 `default` 确定 JSON 类型，可用 `values`、`min`、`max` 限定范围。无效声明使启动失败，非法更新保持原状态。空声明不创建 `/monitor-view` namespace；有字段时只在 monitor 服务启用。状态只在本次运行内存中，重启恢复声明初值。

## 页面侧：等快照、上报 set

Blank 从 `/__pnds/monitor-view.json` 读取本次实际声明；空声明不增加 socket。使用已接好的接口：

```js
PNDSMonitorView.onViewState(state => {
  /* 按完整快照渲染；等待期间 state 为 null */
})
PNDSMonitorView.setViewState('displayMode', 'details')
```

`viewState` 和订阅快照为独立副本；等待快照时隐藏依赖该状态的 UI，控件调整只上报。快照更新后再渲染，错误通过 `error` 读取。

## 边界（何时不用它）

本通道只放低频视图选项，不放乐谱时间、声音、claim、高频演奏输入或 App 二维码／投影开演状态。投影可按[投影面](./projection-surface.md) 分支画面，并共享相同视图选择。作者已有源码与接线保留。
