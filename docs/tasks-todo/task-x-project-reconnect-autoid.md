# Task X: 工程侧——performer 断线重连自动恢复角色

**注意：本任务在 `Inarticulate III` 仓库中执行**（`../Inarticulate III/`），不属于 PNDS App 代码库；但它阻塞 task-7 的现场验收，建议在 task-7 之前完成。

来源：handoff §7 已知限制 2 + 2026-07-29 用户确认的需求。

## 需求（用户原话）

> 客户端断联之后，当他重新连接时，自动连回他的 id 内容，这样就可以接上演奏了，而不是卡在再次要求 id。

现状：前端保留 `selectionMade`，但断线重连后新的 Socket.IO connection 不会自动重新 `selectId`——服务端不接收其事件，performer UI 看似已选角色实则失控。现场演出中手机锁屏 / WiFi 抖动必然触发，属高风险项。

## 实现方向

- 前端：选定 player id 后持久化（如 localStorage）；socket `connect`/reconnect 时若已有选择，自动重新发送 `selectId`
- 服务端：处理同 id 的新 socket 声明——将旧 socket 的绑定/状态移交给新 socket（接管而非拒绝），保持点位等状态连续
- 注意区分"同一演奏者重连接管"与"两个设备同时抢一个 id"；后者可拒绝或后连接者接管，取简单可靠者
- 按 §14：修改后同步更新 `Inarticulate III/PROJECT_HANDSOFF.md`（§7 限制 2 移除）与需求文档（如涉及协议变化）；运行该仓库的 `npm run check` 与 `npm test`

## 验收

- 演奏中途断开（锁屏/断网）再恢复：自动恢复原 id，无需重新选择，可继续演奏
- 两个设备抢同一 id 的行为符合所定策略
