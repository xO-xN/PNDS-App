# Task X: 工程侧——performer 断线重连自动恢复角色

**注意：本任务在 `Inarticulate III` 仓库中执行**（`../Inarticulate III/`），不属于 PNDS App 代码库；但它阻塞 task-7 的现场验收，建议在 task-7 之前完成。

来源：handoff §7 已知限制 2 + 2026-07-29 用户确认的需求。

## 需求（用户原话）

> 客户端断联之后，当他重新连接时，自动连回他的 id 内容，这样就可以接上演奏了，而不是卡在再次要求 id。

现状：前端保留 `selectionMade`，但断线重连后新的 Socket.IO connection 不会自动重新 `selectId`——服务端不接收其事件，performer UI 看似已选角色实则失控。现场演出中手机锁屏 / WiFi 抖动必然触发，属高风险项。

## 已定实现与协议

- 前端将 player ID 与一个随机的 per-browser claim token 保存到 `localStorage`；socket 每次 `connect` 时自动发送 `selectId`；
- 服务端以 `player ID → { socket ID, claim token }` 保存当前归属；
- 同一 claim token 的新 socket 可以接管旧 socket。旧 socket 随后的 event 与 disconnect 不再影响新归属，避免误释放声音或清空 monitor 点位；
- 不同 claim token 的设备抢同一仍在线 ID 会被拒绝。这样不需要在 V1 引入登录、配对或抢号确认框；
- 浏览器存储不可用时，首次选择仍可使用；但不能保证旧 socket 尚未断开时的无缝接管；
- 已同步移除 `Inarticulate III/PROJECT_HANDSOFF.md` §7 的旧限制；修改后必须运行该仓库的 `npm run check` 与 `npm test`。

## 验收

- 演奏中途断开（锁屏/断网）再恢复：自动恢复原 id，无需重新选择，可继续演奏
- 两个设备抢同一 id 的行为符合所定策略
