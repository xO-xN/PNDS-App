# Monitor view synchronization / monitor 视图同步

Source release **0.2.0**, PNDS Host protocol **1**, Node **24**, Socket.IO **4.x**. The score server holds the author's declared low-frequency view keys for this session. Multiple monitor copies, late joiners and reconnects receive complete snapshots. Local hover state stays local by omission. This is view state, not score progress, audio state, dataset recovery or cross-show persistence.

源码版本 **0.2.0**，PNDS Host 协议 **1**，Node **24**，Socket.IO **4.x**。工程 server 在本次运行保存作者声明的低频视图键，多份 monitor、晚加入与重连取得完整快照。不声明的悬停等瞬态仍保留本地。模块不负责乐谱进度、音频状态、dataset 恢复或跨演出持久化。

## Files and dependencies / 文件与依赖

The maintenance checkout stores this source at `modules/monitor-state/`. The App adds the frozen release to a score project at **`modules/pnds-monitor-state/`**. Wiring examples below use that installed destination; if you copy manually to another directory, adjust imports and HTTP resource paths together.

维护仓库的目录是 `modules/monitor-state/`；App 把固定发布源码加入工程的 **`modules/pnds-monitor-state/`**。下文接线示例使用 App 的实际目标路径；手动采用其它目录时须同步修改导入与 HTTP 资源路径。


| File / 文件 | Purpose / 用途 |
| --- | --- |
| `monitor-state.js` | Server state, declared-key validation, snapshot/broadcast and cleanup / 服务端状态、键校验、快照/广播与清理 |
| `monitor-client.js` | UMD `PNDSMonitorState` browser connector / UMD 全局 `PNDSMonitorState` 页面连接器 |
| `package.json` | CommonJS scope, also within an ESM project / ESM 工程内的 CommonJS 范围 |
| `compatibility.json`, `README.md` | Same-release compatibility and wiring / 同版本兼容与接线资料 |

Use the project's `socket.io` 4.x server and its `/socket.io/socket.io.js` browser script. Node verification uses `socket.io-client` 4.x. Check existing dependencies before using **npm** to add any missing one. No dependency on players, theme-follow, locale-follow, a mixed `public/client.js` or a private checkout. The independent filenames/globals coexist with those modules; keep this directory and its `package.json` intact. ESM entry points can use `createRequire` or CJS interop.

使用工程已有 `socket.io` 4.x 与其浏览器脚本，Node 验证使用 `socket.io-client` 4.x；先核对依赖，需要时只用 **npm**。不依赖 players、主题/语言模块、混合 `public/client.js` 或维护者目录。文件名和全局名称独立，可以共同加入；保留完整目录与 `package.json`，ESM 入口可用 `createRequire` 或 CJS 互操作。

## Minimal wiring / 最小接线

Keep the project's existing manifest, HTTP/health, audio and lifecycle wiring. Publish the same event table to server and monitor pages. Choose a **dedicated namespace**, not the performer default namespace. A namespace is a broadcast boundary, not authentication: add the work's Socket.IO namespace middleware if the work needs access control.

保留已有 manifest、HTTP/health、音频与关停接线；服务端和 monitor 使用同一工程事件表。选择**专用 namespace**，不能挂到 performer 默认 namespace。namespace 决定广播范围，不等同鉴权；作品需要访问控制时由工程添加 Socket.IO namespace middleware。

```js
const events = {
  monitorSnapshot: "monitor:state:snapshot",
  monitorSet: "monitor:state:set",
  monitorState: "monitor:state",
  monitorError: "monitor:state:error", // optional sender-only rejection
};
const { attachMonitorState } = require("./modules/pnds-monitor-state/monitor-state");
const views = attachMonitorState(io.of("/monitor"), {
  events,
  defaults: { showQr: true, selection: null },
  validators: {
    showQr: (value) => typeof value === "boolean",
    selection: (value) => value === null || typeof value === "string",
  },
});
// In the existing project shutdown handler:
// views.close(); then close Socket.IO/HTTP and the work's resources.
```

Mount the browser script on the **monitor HTTP app** and load it only on the monitor page. `scoreServerOrigin` is the real internal Socket.IO server origin; the monitor HTTP port may differ. Serve the Socket.IO client from that server or the project's local asset route. The example uses an existing Express `monitorApp`; `__dirname` is the score project root.

页面脚本只挂到 **monitor HTTP app**，只在 monitor 入口加载。`scoreServerOrigin` 是实际内部 Socket.IO server origin，可能与 monitor HTTP 端口不同；Socket.IO 客户端从该 server 或工程本地资源路由加载。示例使用工程已有 Express `monitorApp`，`__dirname` 为工程根目录。

```js
const path = require("node:path");
monitorApp.get("/monitor-state-client.js", (request, response) =>
  response.sendFile(path.join(__dirname, "modules/pnds-monitor-state/monitor-client.js")));
```

```html
<!-- Load the real score server's Socket.IO script before this module. -->
<script src="/monitor-state-client.js"></script>
<script>
  const view = PNDSMonitorState.connectMonitorState({
    io, origin: scoreServerOrigin, namespace: "/monitor", events,
  });
  const unsubscribe = view.onViewState((state) => {
    // null: wait for a fresh snapshot; hide view-dependent UI.
    // object: render this server snapshot. Do not merge local defaults.
  });
  // In UI handlers: view.setViewState("showQr", false);
  // Do not toggle local state first: render from the server broadcast.
  addEventListener("pagehide", () => { unsubscribe(); view.close(); });
</script>
```

If a monitor also observes performer state, separately call `PNDSPlayers.connectObserver`. Do not make it join as a performer. Neither module duplicates the other's browser file. The performer page never opens `/monitor`, so view broadcasts and snapshots do not reach it.

monitor 同时观察乐手时另调 `PNDSPlayers.connectObserver`，不要加入为 performer；两模块不会复制同一份浏览器文件。performer 页面不打开 `/monitor`，因此不接收视图快照或广播。

## Protocol, errors and lifecycle / 协议、错误与生命周期

`attachMonitorState(namespace,{events,defaults,validators?})` returns `snapshot()` (deep copy) and idempotent `close()`. `events.monitorSnapshot/monitorSet/monitorState` must be nonempty strings. `defaults` must be a JSON object and fixes the allowed keys at attachment time. Values accept finite JSON-compatible data; functions, undefined, cycles and non-JSON objects are invalid. Optional per-key validators receive `(value,currentSnapshot)` and must return true for accepted values. Add validators for types, ranges and allowed work choices; defaults alone do not impose a value type. Invalid defaults/events throw synchronously. Validator throws reject the update.

服务端接口返回深拷贝 `snapshot()` 与可重复 `close()`。三项必选事件名须为非空字符串；`defaults` 必须是 JSON 对象，接入时固定可同步键集合。值接受有限数值的 JSON 数据，不接受函数、undefined、循环或非 JSON 对象。可选逐键 validator 收 `(value,currentSnapshot)`，接受时返回 true；类型、范围和作者选项由 validator 明确约束，默认值本身不强制类型。配置无效同步抛错，validator 抛错则拒绝更新。

| Direction / 方向 | Event key / 事件键 | Payload / 载荷 | Result / 结果 |
| --- | --- | --- | --- |
| Server → new/reconnected monitor | `monitorSnapshot` | full declared state | render current values / 渲染当前值 |
| Monitor → server | `monitorSet` | `{key,value}` | validate and apply / 校验并应用 |
| Server → all namespace monitors | `monitorState` | full declared state | latest accepted adjustment / 最近接受的调整 |
| Server → sender only, optional | `monitorError` | `{reason}` | ignored update, state retained / 忽略更新并保留原状态 |

Unknown keys, malformed updates and rejected values leave state unchanged. If configured, the error event reports `Unknown view key`, `Invalid view update` or `Invalid view value`; otherwise invalid updates are silently ignored. Those technical reason strings may be mapped to the project's own UI language. `close()` removes connection/socket listeners and disconnects only this namespace; other modules continue. It does not persist state. Recreating the module or restarting the project begins with newly declared defaults. Await the work's own shutdown tasks and close the actual HTTP/Socket.IO servers separately.

未知键、畸形更新、未通过 validator 的值均保持状态不变。配置错误事件时分别返回上述技术原因，未配置则静默忽略；工程可把原因映射到自己的界面语言。`close()` 卸载监听，只断此 namespace，其它模块继续；状态不落盘。重建模块或重启工程都从默认值开始；工程自己的异步关停及 HTTP/Socket.IO server 关闭仍须另行完成。

`connectMonitorState({io,origin,namespace,events,socketOptions?})` exposes `connected`, `viewState`, `error`, `onViewState(listener)`, `setViewState(key,value)`, `reconnect()` and `close()`. `viewState` starts null and becomes null again on disconnect. Access and subscriber deliveries return independent copies. `onViewState` immediately delivers current state and returns unsubscribe. `setViewState` returns false until connected and a snapshot has arrived, or after close; it returns true when a packet is emitted, not an acceptance acknowledgement. It never mutates local view state and never queues offline changes. The optional error is available through `error`, reset by the next send. Network loss reconnects automatically; a namespace's deliberate server disconnect needs explicit `reconnect()` if the channel is later reopened. `close()` removes all module-owned listeners, clears subscribers/state and disables sends/reconnects.

页面接口暴露连接、快照、错误、订阅、上报、重连与关闭。快照初始/断线后是 null；取值与订阅均为独立副本，订阅立即回放当前状态并返回取消函数。未连接、未取得快照、已关闭时上报返回 false；true 只表示已发包，不是接受确认。不本地抢先修改、不离线排队；可选错误经 `error` 获取，下次发送清除。网络故障自动重连，server 主动断开 namespace 后需在重新开放时明确 `reconnect()`。关闭清理监听/订阅/状态并禁用后续动作。

## Verification and handoff / 验证与交接

`test/modules-monitor-state.test.js` uses this release with real HTTP/Socket.IO server/client copies: defaults, broadcasts to both copies, late joining, reconnect snapshot healing, unknown/malformed/invalid values, independent value copies, cleanup/session reset, performer isolation, and combination with players where monitor observation allocates no performer identity. The original Template example remains covered by its existing tests.

真实 HTTP/Socket.IO 测试覆盖默认快照、多副本广播、晚加入、重连自愈、未知/畸形/非法值、独立副本、释放/生命周期重置、performer 隔离，以及与 players 共存且 monitor 不占身份；原有 Template 示例继续通过原回归。

Run `npm run check`, `npm test` and syntax-check these new files in a consuming project's check script. Confirm two actual monitor copies manually in the App/browser, including reload and projection; automated transport tests do not establish WKWebView, real phone/audio or show-load behavior. Record files added, wiring, automated checks and actual runtime evidence separately. The App does not automatically wire or upgrade these files, and Skills are optional.

执行 `npm run check`、`npm test` 并在工程检查中覆盖新文件。作者仍需在 App/浏览器打开两份真实 monitor 验证重载和投影；自动传输测试不冒充 WKWebView、真手机/声音或演出负载证据。交接分别记录文件、接线、自动检查与实际运行；App 不自动接线或升级，Skills 自愿使用。

## Test resource location / 测试资料位置

Any `test/` or `fixtures/` paths above name maintenance evidence in the [PNDS Template repository](https://github.com/xO-xN/PNDS-Template), not files copied by the App. They are not runtime dependencies or required hidden sibling resources. Use the public wiring snippets to add checks in your own project; if the corresponding maintenance tests have not been distributed, report them unavailable instead of assuming a local checkout. / 上文 `test/` 和 `fixtures/` 路径指 PNDS Template 维护仓库中的验证资料，不是 App 复制的文件，也不是运行依赖或必需的隐藏兄弟资源。按公开接线示例为自己的工程补检查；对应维护测试尚未分发时如实记录不可用，不假定本机有该仓库。
