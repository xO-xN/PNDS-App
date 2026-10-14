# Monitor locale following / monitor 语言跟随 — 0.2.0

Files: `locale-follow.js`, `package.json`, `compatibility.json`, this README. Browser DOM, no npm dependency; Host locale message protocol 1 (available since App 1.3.0). Delivery version describes source independently of App version. Copied source belongs to the project. / 必需文件如上；浏览器 DOM、无 npm 依赖，Host 语言协议 1（App 1.3.0 起）。模块源码版本与 App 版本分别记录，复制后归工程维护。

The App adds this module at `modules/pnds-locale-follow/`; wiring examples below use that installed path. The Template maintenance directory is `modules/locale-follow/`, so maintenance fixtures use that source path. / App 将本模块加入 `modules/pnds-locale-follow/`，以下接线示例使用加入后的路径；Template 维护目录为 `modules/locale-follow/`，维护 fixture 使用源码目录。

Serve and load this script only at the declared monitor entry. Performer text remains the piece's own. Theme-follow can be loaded alongside without shared files. / 仅在声明的 monitor 入口提供并加载，performer 文案由作品自行维护。可与主题模块同页加载，互不覆盖。

```js
monitorApp.get('/__pnds/locale-follow.js', (req, res) => {
  res.sendFile(path.join(projectRoot, 'modules/pnds-locale-follow/locale-follow.js'));
});
```

```html
<script>
window.PNDS_LOCALE_OPTIONS = {
  locales: ['en', 'zh-CN'], fallback: 'en',
  onLocale: (resolved, raw) => {
    window.LAST_LOCALE = resolved; // first frame may precede drawing init
    if (window.applyPieceLocale) window.applyPieceLocale(resolved);
  },
  // applyLang: false, // skip <html lang> writes when the piece handles it
};
</script>
<script src="/__pnds/locale-follow.js"></script>
```

The piece owns string tables and `applyPieceLocale`; replay `LAST_LOCALE` after initialization. No automatic translation is performed. With neither `?lang=` nor a message, existing language/text stay unchanged. Default supported codes are en/zh-CN and fallback en. / 作品自己维护字符串表与应用回调，初始化后回放暂存语言；不调用自动翻译。无首帧参数与消息时保留已有语言/文字；默认支持 en/zh-CN，回退 en。

Input: `{type:'pnds:locale', version:1, locale:'zh-CN'}`. First-frame `?lang=` is read before later Host messages. Valid language tags resolve exact case-insensitively, then by base language (`zh` → `zh-CN`), then fallback. Resolution always returns a supported code verbatim: unsupported or omitted fallback chooses the first supported code; an empty/invalid supported set restores the default set. Empty/malformed payloads and unknown protocol versions are ignored. `onLocale(resolved,raw)` receives the original input as its second argument only when the resolved language changes; duplicate or equivalent delivery has no repeated callback. / 首帧优先读取，后续消息覆盖；精确匹配忽略大小写，再按基础语言，最后回退。结果始终是支持列表原样代码：指定回退不受支持则用列表首项，无有效列表则恢复默认。空/畸形载荷和未知版本忽略；仅解析结果变化时回调一次，并传原始代码。

Browser script auto-attaches. `PNDS_LOCALE.dispose()` removes its message listener idempotently; reloading disposes the previous attachment. `PNDS_LOCALE.attach(window, options)` returns a disposer for managed pages (dispose the automatic attachment first). CommonJS exposes the same pure resolution helpers. Disposal retains current text and document language. / 浏览器自动接线；释放与重载均清理监听。手动接线返回释放函数，先释放自动实例；CommonJS 提供同样解析函数。释放保留当前文案与 document 语言。

`test/modules-display.test.js` uses these release files over real monitor HTTP routes and verifies first-frame delivery before drawing init, switching, duplicates, absent/malformed input, custom string-table fallback, coexistence and cleanup. VM evidence covers message/DOM behavior; real browser/WKWebView and projection acceptance are separate. / 同版本测试通过真实 monitor HTTP 验证初始化前首帧、切换、重复、缺省/畸形、自定字符串表回退、模块共存和清理。VM 证据仅覆盖消息与 DOM；真实浏览器/WKWebView 和投影另验。

Adding files is pending wiring and runtime validation. App never edits entries, installs dependencies/Skills or starts the piece; preserve custom code. / 文件加入仍待接线与验证；App 不改入口、不装依赖或 Skills、不启动作品，保留定制。

## Test resource location / 测试资料位置

Any `test/` or `fixtures/` paths above name maintenance evidence in the [PNDS Template repository](https://github.com/xO-xN/PNDS-Template), not files copied by the App. They are not runtime dependencies or required hidden sibling resources. Use the public wiring snippets to add checks in your own project; if the corresponding maintenance tests have not been distributed, report them unavailable instead of assuming a local checkout. / 上文 `test/` 和 `fixtures/` 路径指 PNDS Template 维护仓库中的验证资料，不是 App 复制的文件，也不是运行依赖或必需的隐藏兄弟资源。按公开接线示例为自己的工程补检查；对应维护测试尚未分发时如实记录不可用，不假定本机有该仓库。
