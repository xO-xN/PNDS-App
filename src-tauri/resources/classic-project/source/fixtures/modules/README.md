# Release module integration fixtures / 发布模块集成 fixture

`test/modules-display.test.js` wires the actual modules in temporary Express monitor/performer servers. `hub-node.cjs` is a minimal separate score server using the exact public interface shown in `modules/hub/README.md`, with local join/control acknowledgements and a monitor-readable `/state` endpoint. The fixtures intentionally have no artistic score/sound policy. / 显示测试在临时真实 Express 服务接线；hub-node 是独立最小工程 server，接口与发布说明一致，并保留本地加入/控制回执与 monitor 状态。fixture 不定义艺术谱面/声音制度。

`hub/hub.cjs` is byte-for-byte central `pnds-hub/hub.js` v0.1.0 at revision `b5231386dc6259658098fefe5956e1f9d02378b1` (renamed extension only; SHA256 `2e1e3724e011b10888e3f687e486d1429cf25338db36af5030cb21ee6791bfec`); `hub/package.json` provides its version. It is test prior art, excluded from all module delivery folders, and must not be shipped as a replacement hub. / 中央 hub 源码逐字节复制，仅改扩展名；package 提供版本。仅供测试，不进入模块交付、不替换中央 hub。

Run `npm test`. Real browser/WKWebView, phone scan, public network and audio acceptance are separate from these Node/VM/HTTP tests. PNG target decoding uses macOS Vision through `test/fixtures/decode-qr.swift` on macOS. / 自动检查与真实浏览器/WKWebView、手机扫码、公网、声音验收分别记录；macOS 上额外用 Vision 独立解码 PNG 地址。

Browser smoke: run `node fixtures/modules/display-server.cjs`, open the printed monitor URL, confirm initial Stage/en, switch theme/language, repeat messages (callback counts unchanged), and dispose (future messages have no effect). Open the printed performer URL and request its `/__pnds/theme-follow.js` or `/__pnds/locale-follow.js` (404). QR targets the same performer URL. Shut down the fixture after inspection. / 浏览器冒烟使用上述命令和输出地址，验证首帧、切换、重复幂等、释放、performer 隔离及二维码地址。完成后关闭 fixture。
