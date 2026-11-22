# 工程开放控制器映射目标

原生池主的 monitor 页与池客的 performer 页可通过 `window.PNDSControllerMapping` 开放自绘控件、连续参数及其他已有动作。池主和池客各自的映射保存于操作者的 Mac。已有的 HTML 按钮、复选框和范围输入可按标准网页事件参与映射。

## 注册目标

在工程页面当前文档中调用 `window.PNDSControllerMapping?.register(definition)`。可选访问让同一工程在普通浏览器中照常启动。当前接口的 `version` 为 1。

| 字段                            | 约定                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `id`                            | 同一工程页内稳定且唯一的非空字符串。保留 ID 可以在重开后恢复映射。                         |
| `name`                          | 显示在设置中的非空名称。                                                                   |
| `kind`                          | `'trigger'`、`'switch'` 或 `'continuous'`。                                                |
| `trigger()`                     | 触发目标调用的同步操作。                                                                   |
| `getValue()`、`setValue(value)` | 开关及连续目标的同步读写。开关使用布尔值，连续目标使用有限数值。读值应返回工程当前状态。   |
| `min`、`max`、`step`            | 连续目标的有限上下限与合法正步进。下限作为步进起点。省略步进或设为 `null` 时允许连续取值。 |
| `position()`                    | 可选。返回当前视口 CSS 像素坐标的 `{ x, y, width, height }`，隐藏时返回 `null`。           |

有区域的目标可在映射模式中点选。标签的布局使用 `position()` 持续提供的新坐标。工程可以把 Canvas 内的区域坐标换算为视口像素，也可以复用某个元素的 `getBoundingClientRect()`。点击落在可识别的标准 HTML 控件上时，优先选取该 HTML 控件。

所有已注册目标都可在「设置 → 演出 → MIDI／OSC 控制 → 工程开放的控件」选取。点「学习」会进入映射模式并等待硬件输入。映射可在同一设置页调整。Esc 或演出底栏按钮退出映射模式。

`register()` 返回清理函数。调用它可注销当前注册。以同一 ID 再次注册会替换该目标的回调和区域，旧清理函数仅对应它创建的注册。更改同一 ID 的 `kind` 时，旧映射显示待重新绑定。页面更换后由新页面重新注册自己的目标。

## 示例

```js
const mapping = window.PNDSControllerMapping
const removePulse = mapping?.register({
  id: 'pulse',
  name: '脉冲',
  kind: 'trigger',
  position: () => pulseRegion.getBoundingClientRect(),
  trigger: sendPulse,
})
const removeWetMix = mapping?.register({
  id: 'wet-mix',
  name: '混响量',
  kind: 'continuous',
  min: 0,
  max: 1,
  step: 0.01,
  getValue: () => state.wetMix,
  setValue: setWetMix,
})
```

让声明回调与点击、拖动共用同一个工程处理器。这样声音、同步和演奏记录沿用工程的现有规则。
