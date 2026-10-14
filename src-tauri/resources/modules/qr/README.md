# QR joining / QR 加入 — 0.2.0

Files: `qr.js`, `package.json`, `compatibility.json`, this README. Runtime: Node 24, qrcode 1.5.x, Express 4.x or compatible response API. Host protocol: 1. The delivery version describes this source; it is independent of the App version. The copied source belongs to the project. / 必需文件如上；运行依赖 Node 24、qrcode 1.5.x 和兼容 Express 4.x 的响应接口。Host 协议 1；模块源码版本与 App 版本分别记录，加入后的源码归工程维护。

The App adds this module at `modules/pnds-qr/`; wiring examples below use that installed path. The Template maintenance directory is `modules/qr/`, so maintenance fixtures use that source path. / App 将本模块加入 `modules/pnds-qr/`，以下接线示例使用加入后的路径；Template 维护目录为 `modules/qr/`，维护 fixture 使用源码目录。

`qrHandler(url, options)` returns an HTTP route handler. `url` must be the complete HTTP(S) performer address already resolved by the project: prefer `PNDS_PERFORMER_URL` when injected, otherwise follow the existing `PNDS_HOST_IP` and manifest performer-port contract. The module encodes the exact string, retaining scheme, port, path, query and fragment; it never derives a URL from the monitor request. Credentials in a URL are rejected. / 工程先按既有契约解析地址：注入时优先 `PNDS_PERFORMER_URL`，否则用 `PNDS_HOST_IP` 和 manifest performer 端口。模块原样编码完整 HTTP(S) 地址，保留协议、端口、路径、查询和片段，不从 monitor 请求推断；带用户名或密码的地址会拒绝。

```js
const { qrHandler } = require('./modules/pnds-qr/qr');
// performerUrl is the SAME resolved value used by copied address and browser config.
monitorApp.get('/qr', qrHandler(performerUrl, {
  width: 480, margin: 1, errorCorrectionLevel: 'M', format: 'png',
}));
```

```html
<!-- Load on the monitor; layout, labels and visibility belong to the piece. -->
<img src="/qr" alt="Join the performance">
```

Options: integer `width` 1–4096 (default 480), integer `margin` 0–32 (default 1), `errorCorrectionLevel` L/M/Q/H (default M), `format` png/svg (default png). PNG and SVG return their image MIME types. Invalid options throw a `TypeError` during wiring. Missing, relative or invalid addresses return HTTP 400 JSON `{"error":"invalid-performer-url"}`; encoding failure returns HTTP 500 `{"error":"qr-generation-failed"}`. It logs no URL or encoder details. / 输出选项如上，返回对应 MIME。接线选项不合法时抛 `TypeError`；地址缺失、相对或非法返回 400；生成失败返回 500。错误响应为上述 JSON，不记录地址或编码器详情。

There is no connection, timer or persistence to release. The project owns route/server shutdown and can use normal image error handling to show generation failure. This does not add HTTPS, certificates or an admission policy. / 模块没有连接、计时器或持久状态；路由和 server 生命周期由工程负责，页面可用图片加载错误展示失败。模块不添加 HTTPS、证书或入场规则。

Check `test/modules-display.test.js` and the minimum wired project in that test: real HTTP output, independent macOS Vision decoding of a full URL, actual performer response, missing/invalid addresses and encoder failure. Vision decoding runs on macOS; other platforms retain HTTP/image checks. Automated decoding does not prove phone scanning. Open the performer address in a browser, then use a real phone on the intended network to scan the displayed image and check it opens the same piece. Browser/WKWebView and phone acceptance are recorded separately. / 同版本最小接线与自动验证见上述测试：真实 HTTP、macOS Vision 独立解码、performer 响应及错误；其他平台仅保留 HTTP/图片检查。另需浏览器打开地址，再由真实手机在演出网络扫码确认同一作品；这些证据分别记录。

Adding files is pending wiring and runtime validation. App never edits entries, installs dependencies or Skills, or starts the project. Preserve custom code; this is not an automatic upgrade. / 文件加入仍是待接线、待运行验证；App 不改入口、不装依赖或 Skills、不启动工程。保留定制源码，模块不是自动升级器。

## Test resource location / 测试资料位置

Any `test/` or `fixtures/` paths above name maintenance evidence in the [PNDS Template repository](https://github.com/xO-xN/PNDS-Template), not files copied by the App. They are not runtime dependencies or required hidden sibling resources. Use the public wiring snippets to add checks in your own project; if the corresponding maintenance tests have not been distributed, report them unavailable instead of assuming a local checkout. / 上文 `test/` 和 `fixtures/` 路径指 PNDS Template 维护仓库中的验证资料，不是 App 复制的文件，也不是运行依赖或必需的隐藏兄弟资源。按公开接线示例为自己的工程补检查；对应维护测试尚未分发时如实记录不可用，不假定本机有该仓库。
