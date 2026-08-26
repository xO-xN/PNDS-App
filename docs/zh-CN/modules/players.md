# 乐手身份与座位

一个乐手的手机凭什么在锁屏、掉线、甚至工程重启之后，还坐回同一个座位、走同一个输出通道？答案散在四个文件里，这一篇把它们当一个故事讲完：

| 文件                 | 角色                                                 |
| -------------------- | ---------------------------------------------------- |
| `lib/players.js`     | 身份登记处：id 分配、claim token 认领                |
| `lib/seats-store.js` | 座位登记簿：token → `{ id, out }`，落盘              |
| `lib/protocol.js`    | Socket.IO 协议：join / control / 座位操作 / 状态广播 |
| `public/client.js`   | 浏览器侧连接器：乐手页与 monitor 页各用其中一半      |

## claim token：设备的持久身份

乐手第一次加入时，服务端生成一个 claim token（48 位十六进制随机串），随 `joined` 事件发给页面；页面把它存进 localStorage（键名来自 `public/shared.js` 的 `tokenKey`，Template 默认 `pnds-template-token`——基于 Template 开新工程时应改名，见创作指南）。

之后每次连接（包括断线重连）页面都带着这个 token 重新 join，服务端凭它认回原座位。token 是「这台设备在这个工程里」的身份证：

- id 会在断线后释放给别人复用，token 不会——一切持久状态都按 token 索引，而不是 id。
- 合法形状是 24–128 个字符的字符串（`lib/players.js` 的 `isClaimToken`）。

## id：1..maxClients

id 是数值座位号，在 `1..maxClients` 内分配，而 `maxClients = outputChannels`（server.js 组装处）——工程有多少输出通道，就有多少个座位。分配规则（`lib/players.js`）：

- 优先取这个 token 记录过的座位；
- 否则取最小空闲 id，**跳过已为其他 token 记录的座位**——设备的座位在记录存在期间绝不会再发给别的设备；
- 满员则拒绝 join（`rejected` 事件，`Server is full (max N clients).`）。

页面**永不硬编码 id**：自己的 id 从 `joined` 事件拿（`public/client.js` 存成 `myId`），自己的输出通道从 `state` 广播里跟踪（`myOut`）——monitor 移座后页面自动跟上。

## 两种恢复：断线重连与工程重启

|          | 断线重连（手机锁屏）                      | 工程重启（下一场演出）       |
| -------- | ----------------------------------------- | ---------------------------- |
| 恢复什么 | voice 的控制状态（原始值、register、out） | 座位 `{ id, out }`           |
| 存在哪   | 内存（`lib/protocol.js`，按 token）       | 磁盘（`lib/seats-store.js`） |
| 为什么   | 只需活过锁屏                              | 必须活过进程退出             |

- 座位文件默认是工程根的 `.pnds-seats.json`，环境变量 `PNDS_SEATS_FILE` 可指向别处（App 与测试都用它）。写入是「临时文件 + 原子改名」，崩溃不会留下撕裂状态。
- 控制状态存的是**原始值**（推子 0..1），恢复时重新映射——存映射后的频率/音量等于二次映射（映射归 `audio/controller.js` 管，见[音频：三模式与作品层](./audio.md)）。
- 工程重启后内存状态没了，但座位记录还带着输出通道。座位记录还会自愈：两次运行之间输出通道数变了、旧通道路由不了时，voice 落回默认通道，记录在下次持久化时改正。

## monitor 的座位操作

- **移座 `set-seat`（载荷 `{ id, to }`）**：把在线设备挪到另一个座位号。目标座位必须没有在线设备（留在目标上的陈旧记录会被驱逐）。分配、voice（从当前控制状态原地重生，没有可听的中间态）、座位记录三者一起移动；设备页面靠重发一次 `joined` 事件得知新 id——页面零改动跟上。
- **重置 `reset-ids`**：清掉所有座位记录与内存状态，弹掉全部乐手连接。页面自动重连重 join，此时 token 已无座位记录，id 按重连顺序重新发。不回来的手机会一直占着座位号——重置按钮就是给这个的。

## Socket.IO 事件表

事件名来自 `public/shared.js` 的 `events`（作品可以保留自己的词汇表，下表是 Template 的默认值）：

| 方向          | 事件        | 载荷                                           | 语义                                               |
| ------------- | ----------- | ---------------------------------------------- | -------------------------------------------------- |
| 页面 → 服务端 | `join`      | `{ token? }`                                   | 加入 / 重连认领座位                                |
| 页面 → 服务端 | `control`   | 工程自定义                                     | 推子等控制；`lib/protocol.js` 原样转发，作品层校验 |
| 页面 → 服务端 | `set-out`   | `{ out }`（乐手页）或 `{ id, out }`（monitor） | 改输出通道                                         |
| 页面 → 服务端 | `set-seat`  | `{ id, to }`（monitor）                        | 移座                                               |
| 页面 → 服务端 | `reset-ids` | 无（monitor）                                  | 重置全部座位                                       |
| 服务端 → 页面 | `joined`    | `{ id, token, recovered }`                     | 入座成功；也是移座后新 id 的通知通道               |
| 服务端 → 页面 | `rejected`  | `{ reason }`                                   | 拒绝（满员等）                                     |
| 服务端 → 页面 | `state`     | `{ clients: […] }`                             | 全量状态广播（id / amp / freq / register / out）   |

## 页面侧：public/client.js

`PNDSClient` 把连接细节全部收走，页面只管画图和收输入：

- `connectPerformer({ io, port, events, tokenKey, storage, hostname })`——乐手页用：join 自带持久 token、`myId` / `myOut` 跟踪、`sendControls(payload)` 自带死区（默认阈值 0.002，变化不够不发送）。
- `connectMonitor({ io, port, events, hostname })`——monitor 页用：纯观察者，永不 join；`onClients(listener)` 收状态，`setOut` / `setSeat` / `resetIds` 发操作。

io、storage、hostname 等环境依赖全部注入——测试不需要浏览器。
