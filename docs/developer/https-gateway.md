# 可信 HTTPS 入口网关（#140）

#139 交付了证书材料的配置 / 导入 / 校验 / 受保护存储（见 [https-material.md](./https-material.md)）；#140 交付入口本体——一个随 session 生命周期启动与关闭的本地 TLS 反向代理。手机 → 网关 → 本机 performer 服务是唯一新增路径；monitor、投影、本机 health 与 node → hub 的处理后消息路径保持原边界。契约层见运行契约 §3（`PNDS_PERFORMER_URL`）、§8/§12（启动与关停中的入口步骤）、§15（完整入口契约）；行为验收见 [app-behavior.md](./app-behavior.md)「可信 HTTPS 入口行为」。

## 技术栈与模块

| 部件                                              | 位置                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| TLS 反向代理 + 探测                               | `src-tauri/src/gateway.rs`                                                                                |
| 生命周期接线（激活 / env 注入 / 状态 / teardown） | `src-tauri/src/project/session.rs`（`resolve_entry_launch`、`HttpsEntryState`、`spawn_entry_supervisor`） |
| 启动材料取回（校验后交出 chain+key）              | `src-tauri/src/https.rs`（`launch_material`）                                                             |
| 启用开关偏好                                      | `types.rs` `https_enabled` + 前端 `settings-store` / `preferences.ts`                                     |
| 前端面                                            | `SettingsCard` 入口行、`HttpsSection` 开关、`HttpsCompatDialog`、`menu.ts` 地址段、`session-store` 镜像   |

栈选型：**hyper 1（http1）+ tokio + rustls（ring provider）**——成熟实现、纯 Rust、无系统运行时依赖、macOS 13.5 基线双架构。这是父规格 #137「使用现有成熟 TLS / 反向代理实现，不自造密码协议」的直接落实；ring 与 #139 校验管线同一 crypto 家族。tokio 运行时是网关线程私有的（`worker_threads(2)`），不与 tauri 的运行时共享。

## 转发规则（传输透明性）

- **请求**：method、path+query、header、body 逐项重建到 `http://127.0.0.1:<performerPort><原 path+query>`；body 是 `Incoming` 流（零全量缓冲）。`Host` 原样透传（透明代理——工程按 §15 契约绝不凭端口猜 origin）；
- **hop-by-hop**：`connection / keep-alive / proxy-* / te / trailer / transfer-encoding / upgrade` 双向剥除；**升级交换例外**——请求带 `Connection: Upgrade` 时 `Connection` 与 `Upgrade` 必须放行（那就是握手本身）；
- **WebSocket**：上游 101 后，两侧 upgraded 连接交给 `tokio::io::copy_bidirectional` 逐字节桥接——网关不解析 WS 帧协议；101 的响应头（Sec-WebSocket-Accept 等）全部透传；
- **有界资源**：`Semaphore(64)` 限制并发连接，超限者收一条明文 503 即断；每个 permit 的归属随连接（hyper 的 serve future 在 101 握手完成后即返回，permit 经共享槽位移交给桥接任务——升级隧道活多久、许可就持有多久，这是容量测试钉住的不变量）；所有 body 流式、转发缓冲固定；
- **上游不可达**：回答 503（带英文细节），不静默。

## 生命周期接线

- `resolve_entry_launch`（纯函数，anchors 参数化）：开关 × `supportsPerformerUrl` × 域名端口 × `launch_material` 当下重校验（与导入同一套 webpki 规则）。`Ok(None)` = 原 HTTP 流程；「开关开 × 已声明 × 配置不全」= `Err` → 启动失败（fail-start 既有清理路径）；
- **绑定时机**：`start_generation` 里端口 preflight 之后、音频解析之前——冲突 / 材料问题在任何子进程 spawn 前失败。`GatewayConfig` 携带绑定地址（所选 LAN IP + 偏好端口）、上游（127.0.0.1:performerPort）与 chain/key；
- **状态**：`SessionSnapshot.httpsEntry`（off/preparing/ready/error + url + error）。preparing 在绑定后立即发布（URL 已固定）；探测线程（`spawn_entry_supervisor`）等 session ready 后探测，10 秒期限；入口状态更新全部 generation-guarded——被替换 session 的迟到结果改不了新演出；
- **运行期故障**：accept 循环致命错误经 `FailureSink` 回调 → `mark_entry_failure`（入口 error，会话照跑）；探测超时同理；
- **关停**：`teardown_children` 第一步 `gateway.shutdown()`——取消信号 → 各连接任务 select 退出 → runtime `shutdown_timeout(2s)` → join 带 5 秒看门狗（病态线程宁可泄漏也不挂死 Stop）。日志只记地址与端口，证书细节永不进日志。

## 探测（readiness 的构成）

`probe_tls_http`：连**绑定地址**（域名不必在 Host 本机可解析）+ `ServerName` = 域名 + 生产 Mozilla 根（`public_root_store()`，OnceLock 缓存）+ `GET /__pnds/health` 要求 HTTP 200，`Connection: close` 使读到 EOF 即 body 终止。它证明「TLS + 转发 + 上游」整条隧道，**不**证明手机可达（§15：真机验收才是）。超时与 health 请求共用 `HEALTH_REQUEST_TIMEOUT`。

## 测试纪律

- **测试 CA 只进测试客户端**：rcgen 生成 CA/leaf，anchor 只注入测试的 `RootCertStore` / resolve 的 anchors 参数——绝不触碰系统信任（#140 AC 明文要求）；
- 网关测试用**真实 TCP 上游 fixture**（hyper echo 服务：回显 method/URI/header/body + 升级后字节回显）走真实 TLS：转发保真（路径 / 查询 / 头 / body / Host）、WS 101 + 字节回环、容量 1 时超限 503（用 channel 等持有者拿到 101 再探测，消竞态）、上游死 503、关停后端口释放、探测四态（通过 / 名不匹配 / 无信任 / 上游死）；
- session 集成测试沿用 mock-app + 真 listener 的既有模式：真实网关 + 探测线程发布 ready、stop 释放端口并复位 off、fail_generation 归零入口、运行期故障不断会话、旧 generation 迟到报告被丢弃；
- 前端：`session-flow` 兼容门（等待选择 / 取消不动任何东西 / restart 同门）、`SettingsCard.entry`（四态行 + 提示）、`menu`（入口 URL 优先、漫游选择不受影响）、`HttpsSection`（开关提交 + hint）、`HttpsCompatDialog`。

## 已知边界（有意为之）

- 入口 URL 的 Host 侧探测**不能**代替手机端验证——状态文案已明确措辞；
- 网关不实现热重启：运行期故障由操作者显式重启演出恢复（父规格明确不为本 patch 引入第二套热重启状态机）；
- ALPN 只提供 `http/1.1`（hyper http1 服务）；Safari 会正常回退；
- 绑定地址在启动时固定：演出中网络接口变化表现为入口故障（如实报告），下次启动重绑。
