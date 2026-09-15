# 投影面

App 的投影窗口与主窗口加载的是同一个 monitor 地址的两个独立页面副本。v1.5.0 起，投影窗口加载 monitor 时地址上**总是**携带 `?surface=venue` 首帧参数——这是工程区分「指挥操作的主窗副本」与「面向观众的投影副本」的唯一渠道。投影面显示什么本来就是工程的主权：想让场地屏显示全体演奏者的谱面而不是指挥控制台，从这里分支。

协议规范（携带时机、快照语义、容忍规则）见[运行契约 §14](../reference/runtime-contract.md)——本篇讲工程侧怎么用。

## 未适配 = 镜像 monitor

不读该参数的工程不需要任何改动：契约本就要求忽略未知查询参数，投影窗口上的画面与主窗口完全一致，行为与该参数引入之前完全相同。`?surface=venue` 没有 postMessage 推送、没有专属脚本——它只是 URL 上的一个查询参数，读不读都是工程的自由。

## 分支示例

在 monitor 页入口（如 `public/monitor.js`）按参数分支。要点：**容忍缺席与未知取值**——「没有参数」与「不认识的取值」都按主窗副本处理，绝不为它报错：

```js
// 投影面分支（venue = 场地屏上的观众副本）
const surface = new URLSearchParams(location.search).get('surface')
const isVenue = surface === 'venue' // 未知取值 = 不分支 = 镜像主窗

if (isVenue) {
  renderVenueView() // 观众画面：全体座位谱、放大字号、隐藏控制台
} else {
  renderConductorView() // 指挥画面：控制台、二维码、座位管理
}
```

分支画面的注意事项：

- **参数在导航时快照**：会话中不因窗口状态变化重导航，`isVenue` 在一次加载内恒定；⌘⇧R 显式重载才重新冷拉取、重读 URL。
- **桥与缩放原样生效**：投影副本照样收到主题/语言推送（[§11](../reference/runtime-contract.md) 的 `?theme=`/`?lang=` 与 postMessage），⌘=/⌘-/⌘0 调的是投影窗口自己的缩放——venue 画面不需要任何特殊配合。
- **主窗副本永不带该参数**：不要用参数以外的信号（窗口大小、全屏态）猜测自己在哪个面——那类信号不可靠，参数才是契约。
