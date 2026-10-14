# Monitor theme following / monitor 主题跟随 — 0.2.0

Files: `theme-follow.js`, `package.json`, `compatibility.json`, this README. Browser DOM, no npm dependency; Host theme message protocol 1 (available since App 1.2.3). This source version is separate from the App version and becomes project-owned after copying. / 必需文件如上；浏览器 DOM、无 npm 依赖，Host 主题协议 1（App 1.2.3 起）。源码版本与 App 版本分开，复制后归工程维护。

The App adds this module at `modules/pnds-theme-follow/`; wiring examples below use that installed path. The Template maintenance directory is `modules/theme-follow/`, so maintenance fixtures use that source path. / App 将本模块加入 `modules/pnds-theme-follow/`，以下接线示例使用加入后的路径；Template 维护目录为 `modules/theme-follow/`，维护 fixture 使用源码目录。

Serve the script from the monitor server, and load it only in the declared monitor page. Keep performer colors and behavior in the piece. This module is independent of locale-follow and can be loaded beside it without replacing a file. / 仅由 monitor server 提供脚本，并仅在声明的 monitor 页面加载；performer 配色与行为由作品维护。主题与语言模块独立，可共用页面且无文件覆盖。

```js
monitorApp.get('/__pnds/theme-follow.js', (req, res) => {
  res.sendFile(path.join(projectRoot, 'modules/pnds-theme-follow/theme-follow.js'));
});
```

```html
<script>
window.PNDS_THEME_OPTIONS = {
  variables: { bg: '--surface', text: '--ink' },
  // derive: palette => ({ '--border': palette['text-secondary'] }),
  onTheme: (name, palette) => {
    window.LAST_THEME = { name, palette }; // early delivery before drawing init
    if (window.applyPieceTheme) window.applyPieceTheme(name, palette);
  },
  // applyVariables: false, // for canvas/custom drawing without CSS writes
};
</script>
<script src="/__pnds/theme-follow.js"></script>
```

After drawing initialization, replay `LAST_THEME` if present. Your default palette remains active when `?theme=` and Host messages are absent. Known first-frame names pond/sand/stage/brutal are included; lavender remains an alias for older Hosts. The Host's later palette is authoritative even for a future theme name. / 绘制初始化后回放暂存值。无 `?theme=` 和消息时保持作品默认；首帧支持 pond/sand/stage/brutal，lavender 兼容旧 Host。后续消息携带的 palette 优先，即使主题名尚未知。

Input: `{type:'pnds:theme', version:1, theme, palette}` via window messages. Nonempty palettes contain nonempty string values; malformed or unknown-version messages are ignored. Partial valid palettes update only present CSS keys. `variables` overrides the default mapping, `derive(palette)` supplies extra CSS variables, `onTheme(name,palette)` adapts custom drawing, and `applyVariables:false` disables DOM writes. Default mapping and built-in palettes are exposed through `PNDS_THEME`; no drawing style is required. Changed name/palette pairs invoke the callback once; duplicate delivery leaves the same DOM and drawing state. / 输入为上述消息；空、畸形 palette 和未知版本忽略。合法部分 palette 仅写存在的 CSS 键。映射、衍生变量、绘制回调与禁用 DOM 写入均可配置。变化时回调一次，重复投递保持状态，不固定作品视觉。

The browser auto-attaches on script load. `PNDS_THEME.dispose()` removes its listener and is safe to call repeatedly. Reloading the script disposes the previous listener. For explicitly managed pages, `PNDS_THEME.attach(window, options)` returns a disposer; dispose the auto attachment before attaching a custom one. Pure helpers are also available with CommonJS `require`. It does not restore previous CSS on disposal. / 浏览器加载即接线；`dispose()` 幂等移除监听，重载释放旧监听。手动 `attach` 返回释放函数，先释放自动实例；CommonJS 也提供纯函数。释放后保留最后一次 CSS。

Same-source tests in `test/modules-display.test.js` cover real monitor-only HTTP serving, first-frame callbacks before page initialization, CSS/custom drawing, switches, duplicate/malformed messages, missing input, legacy alias and release. VM page tests verify message/DOM behavior; real browser or WKWebView smoke and actual projection remain separate acceptance evidence. / 同版本测试覆盖真实 HTTP monitor-only 路由、初始化前首帧、CSS/绘制、切换、重复与畸形消息、缺省、旧别名和释放。VM 验证消息与 DOM；真实浏览器、WKWebView 和投影另行验收。

File addition leaves wiring and runtime verification pending. App does not modify entries, install npm/Skills or start the project; preserve custom implementations. / 文件加入仍待接线和验证，App 不改入口、不装依赖或 Skills、不启动工程，保留作品定制。

## Test resource location / 测试资料位置

Any `test/` or `fixtures/` paths above name maintenance evidence in the [PNDS Template repository](https://github.com/xO-xN/PNDS-Template), not files copied by the App. They are not runtime dependencies or required hidden sibling resources. Use the public wiring snippets to add checks in your own project; if the corresponding maintenance tests have not been distributed, report them unavailable instead of assuming a local checkout. / 上文 `test/` 和 `fixtures/` 路径指 PNDS Template 维护仓库中的验证资料，不是 App 复制的文件，也不是运行依赖或必需的隐藏兄弟资源。按公开接线示例为自己的工程补检查；对应维护测试尚未分发时如实记录不可用，不假定本机有该仓库。
