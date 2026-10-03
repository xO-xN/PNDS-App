# QR Code

The QR code on the monitor page is not a static image — it is an endpoint the score server renders on the fly. Performers scan it with a phone and land straight on the performer page; nobody types LAN URLs.

## The endpoint: GET /qr (monitor side only)

`lib/qr.js` is mounted in server.js on the monitor port only. What it encodes is **one shared resolution** — the Project's full performer URL, used by the QR code, the copied address and the `__config.js` browser config alike (see [runtime-contract.md](../reference/runtime-contract.md) §15):

```js
const performerUrl = resolvePerformerUrl(
  process.env,
  hostLanIp,
  serverConfig.performerPort
)
monitorApp.get('/qr', qrHandler(performerUrl))
```

- **Monitor side only.** The performer port has no `/qr` — the code is for people who have not opened the performer page yet, so it only ever appears on the monitor page.
- The endpoint returns a PNG (`image/png`). Resolution priority: while the entry is in effect, the App-injected `PNDS_PERFORMER_URL` (a full URL such as `https://show.example.org:8443/`) wins; when absent, the fallback is `http://<PNDS_HOST_IP>:<performerPort>/`. The IP is the host's LAN address resolved by `lib/network.js` (overridable with the `PNDS_HOST_IP` environment variable); the port comes from manifest.json.
- Rendering takes `lib/qr.js`'s defaults: width 480 px, margin 1, error-correction level M. To change the size or margin, pass a second argument at the server.js mount:

```js
monitorApp.get('/qr', qrHandler(url, { width: 640, margin: 2 }))
```

## Embedding it in a page

The monitor page references the endpoint with a plain `<img>` tag — no JavaScript needed:

```html
<img src="/qr" alt="Scan to open the performer page" />
```

Style-wise, give the image a fixed display size and pad it with light backing paper: the monitor page can be opened under any of the App's four themes (lavender / sand / stage / brutal), and a dark theme pressing straight against the code hurts scannability.

## What creators should know

- Do not change what the code encodes. A performer's scan lands on the performer page — that is the entry of the whole scan-to-join flow (the seat machinery is covered in [Player Identity and Seats](./players.md)).
- The code is generated from the currently resolved performer URL. After the performance machine changes networks, restart the Project — the monitor page picks up a fresh code on reload.
- Works declaring `scoreServer.supportsPerformerUrl: true` scan straight into a same-origin page under the App's local trusted HTTPS entry — page scripts and Socket.IO both live inside that origin, and the work never touches certificates (see [runtime-contract.md](../reference/runtime-contract.md) §15). Undeclared works behave exactly as today.
