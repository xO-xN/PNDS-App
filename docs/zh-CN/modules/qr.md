# QR 码

monitor 页上的二维码不是静态图片，而是工程服务器实时生成的端点。乐手用手机扫码直接落到 performer 页——不用手输局域网 URL。

## 端点：GET /qr（只在 monitor 端）

`lib/qr.js` 在 server.js 里只挂载在 monitor 端口上。编码内容是**同一个解析结果**——工程的完整 performer URL（二维码、复制地址与 `__config.js` 浏览器配置共用它，见 [runtime-contract.md](../reference/runtime-contract.md) §15）：

```js
const performerUrl = resolvePerformerUrl(
  process.env,
  hostLanIp,
  serverConfig.performerPort
)
monitorApp.get('/qr', qrHandler(performerUrl))
```

- **只在 monitor 端**。performer 端口没有 `/qr`——二维码是给「还没打开 performer 页的人」看的，只出现在 monitor 页上。
- 端点返回一张 PNG（`image/png`）。编码内容的解析优先级：入口生效时 App 注入的 `PNDS_PERFORMER_URL`（完整 URL，如 `https://show.example.org:8443/`）优先；未提供时回落 `http://<PNDS_HOST_IP>:<performerPort>/`。IP 由 `lib/network.js` 解析宿主机的局域网地址（可用环境变量 `PNDS_HOST_IP` 覆盖），端口来自 manifest.json。
- 生成参数取 `lib/qr.js` 的默认值：宽度 480 px、边距 1、纠错等级 M。想改尺寸或边距，在 server.js 挂载处传第二个参数：

```js
monitorApp.get('/qr', qrHandler(url, { width: 640, margin: 2 }))
```

## 页面嵌法

monitor 页用一个普通 `<img>` 标签引用端点，不需要任何 JS：

```html
<img src="/qr" alt="扫码打开乐手页" />
```

样式上建议给这张图固定显示尺寸并垫一层浅色底纸：App 的四台主题（lavender / sand / stage / brutal）下 monitor 页都可能被打开，深色主题直接压二维码会影响扫码。

## 创作者需要知道的事

- 编码内容别改。乐手扫码后的落地页就是 performer 页，这是整套「扫码入座」流程的入口（座位机制见[乐手身份与座位](./players.md)）。
- 码按当前解析的 performer URL 生成。演出机换了网络后重启工程即可，monitor 页刷新后拿到新码。
- 声明 `scoreServer.supportsPerformerUrl: true` 的工程，在 App 的本地可信 HTTPS 入口下扫码直达同源页面——页面脚本与 Socket.IO 都在该 origin 内，不需要工程处理证书（[runtime-contract.md](../reference/runtime-contract.md) §15）。未声明时行为与今天完全一致。
