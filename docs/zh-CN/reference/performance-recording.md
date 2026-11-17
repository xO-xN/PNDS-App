# 演奏记录与回放

## 可选演奏记录适配（协议 1）

工程根目录的 `pnds.recording.json` 声明 `{"protocolVersion":1,"adapterId":"my-score-v1"}`。本地 performer 服务实现 `GET/POST /__pnds/recording`。GET 返回声明，路由仅接收回环的非浏览器管理请求。外部入口不得暴露它。随包 `recording/adapter.cjs` 由工程提供作品回调。

POST 带 `operationId` 和 `action`。每次新操作使用新的 ID。

| Action  | 字段与行为                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `begin` | `mode` 为 `record`、`playback` 或 `overdub`。回放输入含 `initialState` 与 `replayPerformers`（`id`、`label`、`selection`）。录制或叠加提供 `livePassId`，响应须以相同的 `passId` 确认。响应另含 `initialState`、`performers`、`events`、`elapsedMs`。 |
| `poll`  | 带 `afterSequence`，返回演奏者、经过时间和游标后的全部事件。                                                                                                                                                                                          |
| `drive` | 带 `elapsedMs` 与到期事件，按唯一序列号去重。                                                                                                                                                                                                         |
| `end`   | 带 `afterSequence`、`elapsedMs`、`release`。同一操作可重试，开始响应丢失也须确认清理。                                                                                                                                                                |

事件含整数 `atMs`、唯一 `sequence`、可空 `performerId`、工程定义的 `kind` 与 `payload`，按 `(atMs, sequence)` 排序。空身份表示共同指挥。保留有效的重复保持、释放和 START／暂停／定位，定位不倒退记录时间。管理命令顺序执行，过期 ID 无权控制新操作。

- 录制与乐谱起停相互独立。回放恢复初态和实际乐谱，拒绝现场音乐输入与手动指挥，结束释放回放来源。
- 叠加记录当轮全部获接纳的现场来源，包括中途加入，逐源使用独立 ID 并记录结束释放。已有回放不再次录入，第一遍时长固定。
- 回放初态只恢复 `replayPerformers` 中的来源。重录或删除以整轮为单位，保留其他轮次与共同指挥。

工程仍可在缺少适配器时普通运行。回放需要兼容的工程、记录格式和适配协议，未完成记录不可回放或续录。普通回放使用当前兼容工程，保留原始记录与来源。工程内容变化后的叠加和重录须明确确认。操作见[携带与恢复演奏记录](../app-tutorial.md#携带与恢复演奏记录)。
