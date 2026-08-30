# 主题跟随

App 有四台主题（pond / sand / stage / brutal；pond 的 id 在 v1.3.3（#91）前叫 lavender，老页面收不到认识的 id 时保持自身默认配色——恰与 pond 同款，视觉无差）。主题跟随让 monitor 页跟着 App 当前主题换色，而 performer 页保持工程自己的配色。

## 只在 monitor 页加载

```html
<script src="/__pnds/theme-follow.js"></script>
```

服务端只在 monitor 端口暴露这个端点——`/__pnds/` 是 App 契约命名空间，与 `/__pnds/health` 同辈；performer 页永远不加载它。

机制：App（≥ v1.2.3）把当前主题经跨域 postMessage 推给 monitor iframe：

```js
{ type: "pnds:theme", version: 1, theme: "<name>", palette: { … } }
```

App 在 iframe 加载、主题切换、窗口重新聚焦时都会重推——**最新值胜出，应用必须幂等**（同一份 palette 应用多少次都落在同一状态）。未知或畸形消息被静默忽略，页面绝不因它报错。协议规范（消息形状、送达语义、`?theme=` 首帧参数）见[运行契约 §11](../reference/runtime-contract.md)。

## 零配置路径：CSS 变量

什么都不配，脚本把 palette 逐项写进页面根元素的 CSS 变量。默认映射（palette 键 → 页面变量）：

| palette 键       | 页面变量        |
| ---------------- | --------------- |
| `bg`             | `--bg`          |
| `sidebar-bg`     | `--track`       |
| `card`           | `--card`        |
| `pill`           | `--accent-soft` |
| `text`           | `--text`        |
| `text-secondary` | `--muted`       |
| `accent`         | `--accent`      |
| `danger`         | `--danger`      |

页面样式全部写在这些变量上，主题一换整页跟着换。页面要自带一套默认变量值——消息到来之前（以及不接 App 独立打开时）页面得能看。

首帧：URL 带 `?theme=<name>` 时，脚本用内置的四份 palette 先画第一帧——App（≥ v1.3.0）加载与重载 monitor 时总是携带该参数，页面仍须容忍其缺席（独立预览、旧版 App）；App 消息到达后逐字覆盖。

## 进阶路径：PNDS_THEME_OPTIONS

在 script 标签**之前**设 `window.PNDS_THEME_OPTIONS`：

```js
window.PNDS_THEME_OPTIONS = {
  variables: { bg: "--surface" },      // 合并覆盖默认映射
  derive: (palette) => ({ … }),        // 从 palette 派生额外变量
  onTheme: (name, palette) => { … },   // 整体设计分叉（p5 等）
  applyVariables: false,               // 跳过 CSS 写入，只走 onTheme
};
```

- `variables`：改名或增删映射（合并进默认表）。
- `derive(palette)`：返回额外的 CSS 变量。现成一例是 `PNDS_THEME.statusVariables(palette)`——产出 `--green` / `--yellow` / `--gray`（palette 带 danger 时加 `--red`），浅色卡与深色卡各一套，都保证在自己主题的卡片上 ≥ 4.5:1 对比度。App 的 warning / danger 是「填充色 + 配套文字色」成对 token，页面直接拿来当**文字**色会对比度不足——状态文字用这套派生色。
- `onTheme(name, palette)`：整页设计分叉。p5 场景的典型用法——把 palette 存进画布状态，`draw` 里取用：

```js
window.PNDS_THEME_OPTIONS = {
  onTheme: (name, palette) => {
    myPalette = palette // draw() 里用 myPalette.accent、myPalette.text …
  },
}
```

- `applyVariables: false`：canvas 页不想要 CSS 变量写入，只走 `onTheme`。

也可以只用纯函数：`PNDS_THEME.variablesFromPalette(palette, options)`、`variablesFromMessage(data, options)`、`initialTheme(search)` 等，测试与自定义接线都可用。
