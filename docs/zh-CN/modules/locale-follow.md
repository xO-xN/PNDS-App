# 语言跟随

App 界面语言切换时，monitor 页跟着换成对应语言；performer 页保持工程自己的语言。

## 只在 monitor 页加载

```html
<script src="/__pnds/locale-follow.js"></script>
```

与[主题跟随](./theme-follow.md)同构：服务端只在 monitor 端口暴露 `/__pnds/locale-follow.js`，performer 页永不加载。

机制：App（≥ v1.3.0）把解析后的界面语言经 postMessage 推给 monitor iframe：

```js
{ type: "pnds:locale", version: 1, locale: "<code>" }
```

code 是**解析后**的语言标签（今天是 `en` 与 `zh-CN`）。投递尽力而为、最新值胜出、应用必须幂等；未知或畸形消息静默忽略；不监听的页面行为完全不变。协议规范见[运行契约 §11](../reference/runtime-contract.md)。

## 零配置路径：<html lang>

什么都不配，脚本把解析后的 code 写进 `<html lang>`——屏幕阅读器发音、字体回退、断字规则都认它。页面其余部分不动。

## locale 解析规则

`PNDS_LOCALE.resolveLocale(code, options)` 三步：

1. **精确匹配**（大小写不敏感，`zh-cn` 与 `zh-CN` 视为同一标签）；
2. **基语言匹配**：`zh` → `zh-CN`；
3. **fallback**（默认 `en`）。

返回的永远是页面自己 `locales` 列表里的**原样一项**——字符串表查找不会 miss。输入为空或缺省时返回 null（视为「没有投递」，页面保持自己的默认语言）。

## 进阶路径：页面字符串表

页面有自己的文案时，在 script 标签**之前**设 `window.PNDS_LOCALE_OPTIONS`：

```js
const STRINGS = {
  en: { title: 'Now playing', hint: 'Slide to play' },
  'zh-CN': { title: '正在演出', hint: '推动推杆演奏' },
}

window.PNDS_LOCALE_OPTIONS = {
  locales: ['en', 'zh-CN'], // 页面能渲染的 code
  fallback: 'en', // 都不匹配时
  onLocale: (resolved, raw) => renderTexts(STRINGS[resolved]),
  applyLang: false, // 可选：跳过 <html lang> 写入
}
```

`onLocale(resolved, raw)` 的第二参是原始投递值（调试日志里区分 `zh` 与 `zh-CN` 这类输入时有用）。首帧可用 URL 参数 `?lang=<code>`——App（≥ v1.3.0）加载与重载 monitor 时总是携带该参数，页面仍须容忍其缺席（独立预览、旧版 App）。
