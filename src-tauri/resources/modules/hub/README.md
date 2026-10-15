# Optional hub connection / 可选 hub 连接 — 0.2.0

Files: `hub.js`, `package.json`, `compatibility.json`, this README. Node 24 and socket.io-client 4.8.x are runtime dependencies; put socket.io-client in the project's production dependencies when wiring. Existing central PNDS hub uses Socket.IO 4 relay/welcome protocol; this module does not replace the hub. Host protocol 1; App's telematic injection is available since 1.4.0. Module source version is separate from App version, and copied code belongs to the piece. / 必需文件如上；Node 24 与 socket.io-client 4.8.x，接线时须加入工程生产依赖。复用既有中央 hub 的 relay/welcome 协议，不替换 hub；Host 协议 1，App 1.4.0 起提供 telematic 注入。复制源码归作品维护，源码版本与 App 分开。

The App adds this module at `modules/pnds-hub/`; wiring examples below use that installed path. The Template maintenance directory is `modules/hub/`, so maintenance fixtures use that source path. / App 将本模块加入 `modules/pnds-hub/`，以下接线示例使用加入后的路径；Template 维护目录为 `modules/hub/`，维护 fixture 使用源码目录。

Declare `telematic:true` in the existing manifest contract for remote capability. Keep the App's node configuration completeness gate. Host injects all of `PNDS_NODE_ID` (global node name), `PNDS_HUB_URL`, `PNDS_HUB_TOKEN`, `PNDS_HUB_ROOM` (`{manifest.id}_{group}`, group 1–3). Room is already derived by Host; do not invent it from seats, request host, URL or client names. Config changes apply at the next run. Tokens stay in handshake auth, never in URL or status/log output. / 声明既有 telematic 字段并保留 App 节点完整性门。Host 注入节点名、hub URL、token、派生 room 四项；room 使用工程 id 与分组，不从座位/请求/客户端推断。配置下次启动生效，token 仅走握手 auth，不进 URL、状态或日志。

```js
const { createHubConnection } = require('./modules/pnds-hub/hub');
const hub = createHubConnection({
  environment: process.env,
  summary: () => ({ role: pieceRole, performers: localPerformerSummary() }),
  onEvent: (event, payload, { from, hubReceivedAt }) => {
    // Project adapter validates its own event payload and decides whether to adopt it.
    applyRemotePieceEvent(event, payload, from);
  },
  onStatus: state => publishMonitorHubStatus(state),
  onPeers: peers => publishMonitorRemoteNodes(peers),
  heartbeatMs: 2000, peerOfflineMs: 8000, peerPruneMs: 30000,
});
hub.start(); // synchronous; never await this in local performer processing
// Local control is accepted first; remote delivery is best effort.
handleLocalControl(payload);
const sent = hub.send('piece-gesture', payload); // true only when connected
// In the existing score server shutdown path:
hub.stop();
```

`readHubConfig(environment, standalone)` exposes config resolution. `createHubConnection({environment,config,...})` reads the same resolution: any injected Host field, even an empty one, makes Host configuration authoritative as a unit; incomplete injection is `unconfigured` and cannot be masked by standalone values. Only with all Host fields absent may an explicit standalone `{nodeId,url,token,room}` be used. Standalone is for rehearsal outside App and does not bypass Host gating. Missing/invalid configuration makes `start()` report `unconfigured`; it does not throw or wait. / 任一 Host 字段存在（包括空值）就以 Host 四项整体为准，部分或空值注入不能被 standalone 补齐。仅全部缺席时允许明确 standalone 四项，供 App 外排练，不绕过 Host 门。配置缺失/无效时同步报告未配置，不等待。

Public methods: `start()` (idempotent), `send(event,payload)` (nonempty event string, JSON payload), `announce()` (broadcast current summary), `snapshot()` (safe status/peers), `stop()` (idempotent; closes socket, retries and heartbeat; clears remote state). Sending disconnected, stopped, invalid or non-serializable data returns false; it never queues events for later replay. Summary-provider failure skips that announcement. Callbacks run synchronously; the project should handle adapter errors. Restarting after stop creates a new connection. / 接口如上；断线、停止、无效/不能 JSON 序列化的数据返回 false，不离线排队。摘要回调失败跳过本次心跳。适配回调同步执行，错误由作品处理；停止后可重新启动。

Status snapshots include `status`, `reason`, `connected`, `everConnected`, `nodeId`, `room`, `remoteNodeCount`, and `peers`. States: idle, unconfigured, connecting, connected, disconnected, unreachable, authentication-failed, stopped. Reasons are language-neutral missing-or-invalid-config / transport / invalid-token. No token or raw server error is published. Connection failure is retried using Socket.IO; middleware refusal also retries explicitly. `reconnectionDelayMs` defaults to 1000, `connectionTimeoutMs` to 10000. A reconnect announces current summary but does not select/adopt a score snapshot or resolve musical conflict. / 状态字段与枚举如上，原因是中性键，不发布 token 或原始错误。传输和鉴权失败均重试；恢复重新公告摘要，不裁决进度、不自动采用乐谱快照。

Heartbeat defaults to 2000ms. A remote node is online until its receiver-local `lastSeenAt` is more than `peerOfflineMs` old (default 8000ms), then offline until pruning beyond `peerPruneMs` (default 30000ms). All timing values must be positive finite milliseconds, and prune must be at least offline; invalid values throw `TypeError` at wiring. `now` can inject a receiver clock for controlled expiry testing. Peers contain `{nodeId,summary,lastSeenAt,ageMs,online}`; heartbeat ticks notify `onPeers` so silence becomes visible. / 默认心跳、过期与移除参数如上；在线按接收端时钟判断。参数须正有限值，移除时间不早于离线时间；接线时无效值抛错。支持注入时钟测试，心跳周期回调让沉默转离线可见。

`remoteNodeCount` counts currently fresh remote **score-server nodes**, usually venue Macs. The summary is opaque project JSON; role/performer entries in it have their own meaning and count, chosen by the piece. Local phones connect only to the local performer server. The hub stamps `from` and `hubReceivedAt`; same-node stamped relays are filtered. Use distinct node names within a room: the existing hub permits duplicates and self-name filtering cannot distinguish them. / 远端节点数统计新鲜工程节点，通常是现场 Mac；角色/乐手条数是作品摘要自身含义，不能冒充节点数。本地手机仅连本现场服务。hub 权威盖章，自身名称回声忽略；同 room 需不同节点名，既有 hub 允许重名而模块不能区分它们。

Module envelopes use relay types `pnds:hub-presence` and `pnds:hub-event`, both version 1. Event names/payloads, summary schema, validation, remote adoption, roles, sound routing and disconnected performance behavior belong to the project. Unknown envelopes are ignored. There is no audio transport, timing synchronization or consensus guarantee. / 两种技术 envelope 使用 relay；事件、摘要、校验、采用策略、角色、音频与掉线演奏归作品适配。未知 envelope 忽略，不提供音频传输、时间同步或一致性保证。

`fixtures/modules/hub-node.cjs` is the minimal wired score-server example; `fixtures/modules/hub/hub.cjs` is an unchanged copy of the existing central pnds-hub source used only by tests. `test/modules-hub.test.js` starts a real hub subprocess and separate Node score servers plus local Socket.IO performer clients. It verifies token refusal, configuration authority, room isolation, stamped delivery/echo filtering, distinct node/performer counts, clock-driven expiry, never-reachable hub, hub shutdown/recovery and cleanup/local control. This is localhost integration evidence; public network, browser/mobile and actual music behavior remain author acceptance. / fixture 与测试使用同版本源码，真实 hub 子进程、独立工程 Node 进程及本地客户端覆盖上述行为；仅证明本机集成，公网、浏览器/手机与实际音乐由作者验收。

App file addition leaves wiring and runtime validation pending: App does not edit the server, install dependencies/Skills or start the piece. Preserve custom modules and existing creator-handoff records; no auto upgrade/removal. / App 仅加入文件与交接，不改入口、不装依赖或 Skills、不启动工程；接线/验证另行完成，保留定制与交接，不能自动升级/移除。

## Test resource location / 测试资料位置

Any `test/` or `fixtures/` paths above name maintenance evidence in the [PNDS Template repository](https://github.com/xO-xN/PNDS-Template), not files copied by the App. They are not runtime dependencies or required hidden sibling resources. Use the public wiring snippets to add checks in your own project; if the corresponding maintenance tests have not been distributed, report them unavailable instead of assuming a local checkout. / 上文 `test/` 和 `fixtures/` 路径指 PNDS Template 维护仓库中的验证资料，不是 App 复制的文件，也不是运行依赖或必需的隐藏兄弟资源。按公开接线示例为自己的工程补检查；对应维护测试尚未分发时如实记录不可用，不假定本机有该仓库。
