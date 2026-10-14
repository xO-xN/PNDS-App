# Client connection and identity / 客户端连接与身份

Source release **0.2.0**, PNDS Host protocol **1**, Node **24**, Socket.IO **4.x**. This is project-owned source after copying; App updates never replace the project's copy. Adding files is separate from wiring and actual verification. No Skill is required to run it.

源码版本 **0.2.0**，PNDS Host 协议 **1**，Node **24**，Socket.IO **4.x**。复制后源码由工程维护，App 更新不会替换工程内的副本。文件加入、完成接线、实际验证是三个独立事实；运行无需安装 Skill。

## Files and dependencies / 文件与依赖

The maintenance checkout stores this source at `modules/players/`. The App adds the frozen release to a score project at **`modules/pnds-players/`**. Wiring examples below use that installed destination; if you copy manually to another directory, adjust imports and HTTP resource paths together.

维护仓库的目录是 `modules/players/`；App 把固定发布源码加入工程的 **`modules/pnds-players/`**。下文接线示例使用 App 的实际目标路径；手动采用其它目录时须同步修改导入与 HTTP 资源路径。


| File / 文件 | Purpose / 用途 |
| --- | --- |
| `protocol.js` | Server admission, control/action forwarding, observer snapshots and cleanup / 服务端加入、控制与动作转发、观察快照和清理 |
| `client.js` | UMD `PNDSPlayers`, performer and observer browser connections / UMD 全局 `PNDSPlayers`，乐手与观察者连接 |
| `players.js` | **Optional** Template exclusive numeric-seat registry / **可选** Template 独占数值座位登记 |
| `seats-store.js` | **Optional** Template disk `{id,out}` records / **可选** Template 磁盘 `{id,out}` 记录 |
| `package.json` | CommonJS scope, including inside an ESM project / 在 ESM 工程内仍声明 CommonJS 范围 |
| `compatibility.json`, `README.md` | Same-release compatibility and wiring / 同版本兼容与接线资料 |

The project needs `socket.io` 4.x on the server. Serve the browser client from that server's `/socket.io/socket.io.js`; Node test clients use `socket.io-client` 4.x. Check the existing dependency declarations before installing with **npm**. No global module, private sibling checkout or shared browser file is needed. Keep this directory intact, including `package.json`; ESM code imports it through `createRequire` or normal CJS interop.

工程服务端需要 `socket.io` 4.x，浏览器使用该服务端提供的 `/socket.io/socket.io.js`；Node 测试客户端使用 `socket.io-client` 4.x。先核对工程现有依赖，需安装时只用 **npm**。不依赖全局模块、维护者的兄弟目录或混合浏览器文件。保留完整目录及 `package.json`；ESM 入口可用 `createRequire` 或标准 CJS 互操作导入。

## Identity boundaries / 身份边界

- `socketId` identifies one temporary connection. A reconnect changes it. / `socketId` 是临时连接身份，重连会改变。
- `token` is the work-issued persistent claim. The browser stores it under the caller's `tokenKey`. localStorage is origin-scoped: changing scheme, host or port creates a different storage scope; this module does not migrate tokens. / `token` 是作品签发的持久认领，页面按 `tokenKey` 保存。localStorage 按 origin 隔离；协议、主机或端口变化后不自动迁移。
- `identity` is the work's JSON-compatible result: string, number, object, array or `null`. It can be shared by multiple clients. It need not represent a seat, output channel, role or voice. / `identity` 是工程自己的 JSON 数据，可为字符串、数值、对象、数组或 `null`，可多人共用，不要求对应座位、输出、角色或 voice。
- The work policy owns claim validation, capacity, takeover authorization, disk records, control restoration and sound/output mapping. When ownership is exclusive, policy callbacks must check that the current socket still owns the claim before applying controls or releasing sound. A previous socket's late disconnect must not release its successor. / 认领校验、容量、接管授权、落盘、控制恢复与声音映射都由工程政策负责。独占政策要在回调中检查当前 socket 是否仍拥有认领，旧连接的延迟断开不能释放接管后的声音。

The generic module holds only live socket assignments. It never writes a claim or control file and never creates a voice. The optional seat helpers preserve Template's seat policy for works that explicitly choose it. `maxClients` is a policy choice; it is not automatically tied to audio channels. `SeatsStore` only accepts `{id,out}` with positive integers and reserves stored seats; it is unsuitable for arbitrary/shared identities.

通用模块只持有在线 socket 的分配，不写认领或控制文件，不创建 voice。只有明确选择 Template 座位制度的工程才用可选 helper。`maxClients` 由作品决定，不自动绑定音频通道。`SeatsStore` 只存正整数 `{id,out}` 并保留座位，不适用于任意或共享身份。

## Minimal wiring / 最小接线

Keep the existing score server's manifest, HTTP/health, audio and shutdown wiring. Define this event table in the project and deliver the **same values** to its pages; these names are examples, not Host-reserved events.

保留工程入口已有 manifest、HTTP/health、音频和关停接线。工程自己维护下列事件表，并把**相同值**送给页面。这里的事件名是示例，不是 Host 保留协议。

```js
const events = {
  join: "work:join", joined: "work:joined", rejected: "work:rejected",
  control: "work:control", action: "work:action", state: "work:state",
};
```

After creating the project's real Socket.IO `io`, attach the module. This adapter deliberately uses a shared label, no seats or voices; replace its policy with the author's decisions. Its claim and controls survive reconnects in this run, but reset on server restart.

创建工程真实 Socket.IO `io` 后接入。以下适配器演示共享标签、没有座位或声音，应按作者决定替换。认领与控制只在本次 server 内存中活过重连，工程重启后归零。

```js
const crypto = require("node:crypto");
const { attachPlayers } = require("./modules/pnds-players/protocol");
const claims = new Map();
const live = new Map();
const players = attachPlayers(io, {
  events,
  policy: {
    join({ socketId, token }) {
      const recovered = claims.has(token);
      const claim = recovered ? token : crypto.randomUUID();
      if (!recovered) claims.set(claim, { controls: null });
      live.set(socketId, claim);
      return { token: claim, identity: "ensemble", recovered,
        restore: claims.get(claim).controls };
    },
    control({ token }, payload) {
      // Validate fields and apply the work's mapping here.
      claims.get(token).controls = payload;
    },
    action(context, payload) {
      // Validate and execute every discrete action here, even repeats.
    },
    release({ socketId }) { live.delete(socketId); },
    snapshot() { return { performers: live.size }; },
  },
  onError(error) { console.error("[work players]", error); },
});
```

Expose only `client.js` as a browser resource, for example with the project's Express app:

只把 `client.js` 暴露为页面资源，例如在工程的 Express app 上接线：

```js
const path = require("node:path");
app.get("/players-client.js", (request, response) =>
  response.sendFile(path.join(__dirname, "modules/pnds-players/client.js")));
```

Load Socket.IO and the module before page code. The performer must use the origin that served its page (the App HTTPS entry when active), rather than reconstructing a LAN URL from manifest ports. Put the event table above into the page as `events`.

先加载 Socket.IO 和模块，再启动页面代码。performer 使用页面实际 origin（有 App HTTPS 入口时就是该入口），不能从 manifest 端口重建 LAN 地址。把前述工程事件表作为 `events` 提供给页面。

```html
<script src="/socket.io/socket.io.js"></script>
<script src="/players-client.js"></script>
<script>
  const player = PNDSPlayers.connectPlayer({
    io, origin: location.origin, events,
    tokenKey: "my-work-claim", storage: localStorage,
    // Optional: continuousFilter: { threshold: 0.002 },
  });
  const unsubscribe = player.onChange((state) => {
    // Render connected/joined/identity/rejectedReason/recovered/restore/error.
  });
  // In the work's input handlers:
  // player.sendControls({ level: 0.5 });
  // player.sendAction({ strike: true });
  addEventListener("pagehide", () => { unsubscribe(); player.close(); });
</script>
```

A monitor observation socket is separate from performer admission. Give it the actual internal score-server origin (monitor and performer ports may differ), serve the Socket.IO browser script from that server if needed, and never call `connectPlayer` for this role:

monitor 的观察连接与乐手加入分开。使用实际内部 score-server origin（monitor 与 performer 端口可能不同），需要时从该 server 加载 Socket.IO 脚本；观察角色不要调用 `connectPlayer`：

```js
const observer = PNDSPlayers.connectObserver({ io, origin: scoreServerOrigin, events });
const unsubscribe = observer.onState((snapshot) => { /* render the work snapshot */ });
// pagehide: unsubscribe(); observer.close();
```

Await `players.close()` during project shutdown before closing Socket.IO/HTTP and the work's audio resources. It removes its handlers, waits for pending policy work, releases accepted claims and disconnects only this namespace. It does not stop another namespace such as monitor-state. Client `close()` removes handlers/subscribers, closes its socket and prevents future sends/reconnects.

关停时先 `await players.close()`，再关闭 Socket.IO/HTTP 与作品音频资源。模块卸载监听、等待已进入政策的异步工作、释放已接受认领，并只断开本 namespace，不关另一个 monitor-state namespace。页面 `close()` 清理监听、订阅与 socket，后续发送和重连返回失败。

## Public interface / 公开接口

`attachPlayers(namespace, options)` accepts a Socket.IO Server or Namespace and returns `{broadcast(), close(): Promise}`. `broadcast()` publishes `policy.snapshot()` through `events.state`; snapshots are synchronous JSON-compatible work data, and initial observers also receive one. `events.join/joined/rejected` are required; `control/action/state` are optional. The policy requires `join(context)` and `release(context)`; `control(context,payload)` and `action(context,payload)` may be async. Each socket's policy calls run in order. `join` receives `{socketId,token,payload}` and returns `{token,identity,recovered?,restore?}` or `{status:"rejected",reason}`. `release/control/action` receive the assignment plus the actual `socketId`. Duplicate join on an admitted socket returns the existing confirmation. Admission failure emits `Join failed` and calls `onError`; control/release errors call `onError`. A rejected connection stays connected until the page closes or explicitly reconnects.

`attachPlayers(namespace, options)` 接受 Socket.IO Server 或 Namespace，返回 `{broadcast(), close(): Promise}`。`broadcast()` 经 `events.state` 发布同步的 `policy.snapshot()` JSON 快照，刚连接的观察者也会收到。必须声明 `join/joined/rejected`，`control/action/state` 可选。政策必须有 `join(context)` 和 `release(context)`，`control(context,payload)`、`action(context,payload)` 可异步，每个 socket 按收到的顺序执行。加入输入 `{socketId,token,payload}`，输出接受对象或拒绝对象；其它回调收到分配与真实 `socketId`。重复加入只重发已有确认。加入异常给页面 `Join failed` 并调用 `onError`；控制/释放异常调用 `onError`。拒绝后仍保持连接，页面可关闭或明确重连。

Wire adapters are optional: server `readToken(payload)`, `makeJoined(assignment)`, `makeRejected(reason)`; performer `makeJoin(token)`, `readJoined(payload)`, `readRejected(payload)`. Defaults use `{token}`, `{token,identity,recovered,restore}` and `{reason}`. Work control/action and observer snapshot payloads pass through unchanged, so validation belongs in the policy.

线缆形状可适配：服务端 `readToken`、`makeJoined`、`makeRejected`，页面 `makeJoin`、`readJoined`、`readRejected`。默认载荷分别是 `{token}`、`{token,identity,recovered,restore}`、`{reason}`。控制、动作和观察快照原样通过，政策须负责字段校验。

`connectPlayer` exposes `connected`, `joined`, `identity`, `rejectedReason`, `recovered`, `restore`, `error`; `onChange(listener)` immediately sends current state and returns unsubscribe. `sendControls(payload)` and `sendAction(payload)` return whether a packet was emitted, **not whether the work accepted or applied it**. Both return false while disconnected, not admitted or closed. There is no offline queue. `reconnect()` explicitly reconnects/rejoins (useful after rejection or a server-forced disconnect); network loss otherwise uses Socket.IO's reconnect behavior. `socketOptions` can configure that behavior. `connectObserver` exposes `connected`, `state` (initially null), `onState(listener)` and `close()`. Observers never send join and do not allocate performer identity.

页面属性包括连接、加入、身份、拒绝原因、恢复标记/内容与连接错误。`onChange` 立即送当前状态并返回取消订阅函数。发送方法的布尔返回值只表示**发出数据包，不表示作品接受或执行**；未连接、未加入或已关闭返回 false，不离线排队。`reconnect()` 明确重连并重新加入（拒绝或 server 强制断开后可用）；网络断线由 Socket.IO 自动重连，`socketOptions` 可配置。观察接口有 `connected/state/onState/close`，`state` 初始为 null，观察者从不 join、不占用乐手身份。

Storage failures are reported through `error`; the current token is retained in memory for reconnect, but it cannot survive a page/browser restart when persistence fails. Wire adapter exceptions also become observable errors.

存储失败经 `error` 报告，当前 token 仍留在内存供重连使用；持久化失败时不保证页面/浏览器重启后的恢复。载荷适配回调的异常也会成为可观察错误。

Continuous filtering is **off by default**. Choose `continuousFilter:{threshold}` with a finite nonnegative threshold for a flat record of continuous/scalar fields. First payload sends; identical payloads and numeric changes below threshold drop; changes at/above threshold, removed/added fields and changed nonnumeric values send. Comparison is against the **last sent** payload, so small changes can accumulate. Threshold zero still drops exact repeats. New connections reset the comparison. Arrays, primitives and null are delivered without this flat-record filter. Nested objects compare by reference; use the unfiltered path or implement work-specific comparison when needed. `sendAction` always delivers repeats while joined. This module adds no rate limiter, schedule, recording or audio policy.

连续过滤**默认关闭**。对扁平连续/标量对象可显式选 `continuousFilter:{threshold}`（有限非负数）。首份发送，完全相同或数值变化小于阈值被过滤；达到阈值、增删字段、非数值字段改变则发送。比较针对**上次已发送**值，微小变化可积累；阈值 0 仍过滤完全重复。每次新连接重置比较。数组、原始值与 null 不走扁平过滤；嵌套对象按引用比较，需要时保留未过滤路径或由工程比较。离散 `sendAction` 逐次交付，模块不新增限频、调度、录制或声音政策。

## Verification and handoff / 验证与交接

`test/modules-clients.test.js` exercises the published source through real loopback HTTP/Socket.IO server/client connections: shared identities, rejection, observers, optional exclusive seats (seat distinct from output), reconnect, transport-loss restart, same-storage claim reuse, independent storage scopes, explicit disk claims versus session controls, chosen/unchosen filtering, repeated actions, wire adapters, denied-storage feedback, async admission cleanup and moved-seat takeover. `test/modules-monitor-state.test.js` wires both modules together with distinct files. The original Template example remains independently covered by its existing regressions.

行为测试使用本版本源码和真实 loopback HTTP/Socket.IO，覆盖共享身份、拒绝、观察者、可选独占座位（座位与输出分开）、重连、真实传输断开/重启、同 storage 认领复用、不同 storage 范围、明确磁盘声明/内存控制边界、过滤开关、重复动作、载荷适配、存储受限反馈、异步加入清理和移座接管；组合测试覆盖两模块共存。原有 Template 示例继续走独立回归。

Run `npm run check`, `npm test`, and syntax-check these new files when integrating into a custom check script. These automated tests do not establish browser localStorage behavior, actual phone lock/scan, WKWebView, audio or show-load performance; the creator validates those in the App. Record separately: files added, wiring complete, automatic checks, actual runtime/audio/device evidence, and distribution readiness. Module version differs from App version; do not infer the version of custom files from filenames.

执行 `npm run check`、`npm test`，并把这些新文件加入工程语法检查。自动测试不冒充浏览器 localStorage、手机锁屏/扫码、WKWebView、声音或演出负载验证，由作者在 App 手动验收。交接分别记录文件加入、接线、自动检查、实际运行/声音/设备证据及分发准备；模块版本不等于 App 版本，自定义文件不能按文件名推断版本。

## Test resource location / 测试资料位置

Any `test/` or `fixtures/` paths above name maintenance evidence in the [PNDS Template repository](https://github.com/xO-xN/PNDS-Template), not files copied by the App. They are not runtime dependencies or required hidden sibling resources. Use the public wiring snippets to add checks in your own project; if the corresponding maintenance tests have not been distributed, report them unavailable instead of assuming a local checkout. / 上文 `test/` 和 `fixtures/` 路径指 PNDS Template 维护仓库中的验证资料，不是 App 复制的文件，也不是运行依赖或必需的隐藏兄弟资源。按公开接线示例为自己的工程补检查；对应维护测试尚未分发时如实记录不可用，不假定本机有该仓库。
