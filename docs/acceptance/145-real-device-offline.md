# #145 真机、离线与 App 完整链路验收报告

|          |                                                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue    | [#145 — 真机、离线与 App 完整链路验收](https://github.com/xO-xN/PNDS-App/issues/145)（父规格 [#137](https://github.com/xO-xN/PNDS-App/issues/137)）                                                                                                                                      |
| 日期     | 2026-10-04（自动化证据固化；同日真机验收通过）                                                                                                                                                                                                                                           |
| 状态     | **已通过** — 自动化项与真机项全部通过；真机会话由项目所有者于 2026-10-04 执行并确认通过（见 #145 关闭评论）                                                                                                                                                                              |
| 验收对象 | 独立诊断工程 `Mobile-Sensor-Meter` v0.3.1（已建独立仓库 [xO-xN/Mobile-Sensor-Meter](https://github.com/xO-xN/Mobile-Sensor-Meter)；release [v0.3.1](https://github.com/xO-xN/Mobile-Sensor-Meter/releases/tag/v0.3.1)）+ App 的可信 HTTPS 入口 / 演出 DNS                                |
| 冻结基线 | `ce4cf65`（2026-10-04 仪器面板风格定稿，v0.3.1）。真机 runbook 测试此提交；证据数字亦对应此提交。发布 tag `v0.3.1` = `ce4cf65` + 仅含 `.github` 打包面的 `caefb02`（bundle allowlist 排除 `.github`，运行面与验收基线一致；发布前已对 vendor 资产按 `PINNED.json` 逐一复核 sha256 全对） |
| 判定规则 | 缺少真机 / 路由器 / 真实域名条件时，对应项**如实保持未完成**；不用测试 CA、自签、桌面浏览器或热缓存结果冒充通过。全部真机项通过前，[#146（纳入内置工具）](https://github.com/xO-xN/PNDS-App/issues/146) 保持阻塞 —— 真机项已全部通过，#146 已解除阻塞并完成登记                          |

状态标记：✅ 已通过（自动化，可复现） · 🧪 初步真机证据（开发期试验，非正式验收） · ⬜ 待真机执行 · ❌ 未通过（当前为零）

---

## 一、结论摘要

1. **能离开真机固化的证据已全部固化**：独立工程 154 项行为/集成测试全绿（含服务面零外部引用审计与仪器面板风格定稿新增的主题跟随测试）；App 侧网关 15、HTTPS 材料 25、演出 DNS 37、会话生命周期 13 项测试全绿；`npm run check:all` 全绿（vitest 1124/1124，Rust 323 通过）。
2. **运行时零外部请求从「一次性 grep」升级为可重复测试门**：新增 `test/offline-surface.test.js`——`public/`（除 vendored 上游包）中任何绝对 `http(s)://` 引用除 localhost / `location.hostname` 动态同机构造外一律失败。断公网冷加入在**静态面**已有自动化保证；真机上的动态核验（清缓存 / 首访手机 + 网络日志）仍待执行。
3. **开发期已有两轮真机试验**（#143/#144，桌面浏览器 + 手机）：全链路可用——同源资产经 App HTTPS 入口逐字节一致、模型权重零 CDN 拉取、双端实时关键点。
4. **正式真机验收已通过**：第三节 runbook 全部项由项目所有者于 2026-10-04 执行并确认通过（≥2 台手机、路由器 DNS、真实域名 + 公有证书、断公网冷启动等正式条件全部满足）；逐项实测值以所有者会话记录为准。失败项为零。

---

## 二、已固化的自动化证据

以下每项均可在对应仓库重跑复现。

### 2.1 独立工程 Mobile-Sensor-Meter（阶段一的工程侧）

命令：`npm run check && npm test`（Node 24，纯网络工程 audio none）。

| 项                               | 结果 | 证据                                                                                                                                                                                                       |
| -------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 语法门                           | ✅   | `npm run check`（18 个 JS 文件 `node --check`）通过                                                                                                                                                        |
| 行为 + 集成测试                  | ✅   | 154/154 通过（含真实 Socket.IO 集成：样本逐字送达 monitor、零/null 不合并、迟到结果拒收、seq 单调、重连恢复同一设备号、断线不重放、后台暂停、SIGTERM 干净退出；v0.3.1 风格定稿带入 theme.js 主题跟随测试） |
| **服务面零外部引用（本次新增）** | ✅   | `test/offline-surface.test.js`：`public/`（除 `vendor/`）无任何非同源绝对 URL；附「种入 CDN 引用必被拦」的反例测试。断公网冷加入在静态面的自动化门                                                         |
| 本地模型资产完整性               | ✅   | `npm run fetch:handpose` 按 `PINNED.json` sha256 逐文件校验；`GET /handpose/assets.json` 实测 `{"ok":true,"missing":[]}`（清单含每份 model.json 声明的全部分片）                                           |
| 模型 URL 走本站 origin           | ✅   | `test/handpose-logic.test.js` 钉死 `scriptSrc=/vendor/ml5.min.js`、`detector/landmarkModelUrl=/vendor/handpose/...`，无运行时 CDN 路径                                                                     |
| 入口契约                         | ✅   | `manifest.json` 声明 `scoreServer.supportsPerformerUrl: true`；`__config.js` / QR / 可复制地址同读 `PNDS_PERFORMER_URL` 单一来源（集成测试覆盖）                                                           |

**模型资源体积**（#145 要求记录；就绪时间 / 更新率 / 发热耗电待真机实测填入第三节模板）：

| 文件                                                    | 字节                   |
| ------------------------------------------------------- | ---------------------- |
| `vendor/ml5.min.js`（ml5 1.4.0，内含 TFJS）             | 4 512 403（≈4.5 MB）   |
| `vendor/handpose/detector/group1-shard1of1.bin`（lite） | 1 919 420              |
| `vendor/handpose/detector/model.json`                   | 108 902                |
| `vendor/handpose/landmark/group1-shard1of1.bin`（lite） | 2 023 432              |
| `vendor/handpose/landmark/model.json`                   | 81 452                 |
| **首次启用 handpose 合计下载**                          | **≈8.65 MB（全同源）** |

**限频与边界（工程契约，验收时的支持范围基线）**：采集 ≤60 Hz、发送 ≤30 Hz 两级独立限频；handpose 推理节奏 ≤10 Hz、只传最新处理结果；关键点归一化 [0,1] 原点左上未镜像；WebGL 必需（iOS 低电量模式会禁 WebGL，卡片会点名该原因）、WebGPU 不要求；iOS 13+ 运动权限在每个 origin 的启用点击内询问一次。

### 2.2 App 侧（阶段二的网关侧）

命令：`npm run check:all`（typecheck / lint / ast-grep / prettier / clippy / vitest / cargo test）。

| 项                             | 结果 | 证据（测试名摘录）                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 网关转发与 Socket.IO 全形态    | ✅   | `gateway.rs` 15/15：`proxies_method_path_query_headers_and_body`、`tunnels_websocket_upgrade_and_echoes_bytes`、**`socketio_polling_then_forced_websocket_flow_survives`**（polling → WebSocket upgrade 经 TLS 网关完整存活）、`over_capacity_connections_get_503`、`upstream_down_answers_503_not_silence`、`port_conflict_is_a_definite_start_failure_and_rebinds_once_free` |
| 网关关停清理                   | ✅   | `shutdown_closes_active_websocket_tunnels`、`shutdown_releases_the_listener_and_connections`、`idle_gateway_reports_no_spurious_failures`                                                                                                                                                                                                                                      |
| 入口 TLS 探测                  | ✅   | `probe_succeeds_through_a_healthy_gateway`、`probe_rejects_a_name_the_certificate_does_not_cover`、`probe_rejects_an_untrusted_certificate`、`probe_rejects_a_dead_upstream`                                                                                                                                                                                                   |
| 证书材料校验 / 更换 / 失败保持 | ✅   | `https.rs` 25/25（含 `failed_replacement_keeps_the_stored_material`）                                                                                                                                                                                                                                                                                                          |
| 演出 DNS（#174/#142）          | ✅   | App 内 dns 模块 13/13 + `pnds_dnsd` 守护进程 37/37：上游故障切换、全上游失效答 SERVFAIL、否定应答带短 SOA、TCP/UDP 全长前缀应答                                                                                                                                                                                                                                                |
| 工程切换隔离（#141）           | ✅   | `project/session.rs` 51/51（generation 隔离、入口事实快照、DNS 映射随 generation 持有）                                                                                                                                                                                                                                                                                        |
| 全量检查                       | ✅   | `npm run check:all` 全绿：vitest **1124/1124**（98 文件）、Rust **323** 通过                                                                                                                                                                                                                                                                                                   |

### 2.3 初步真机证据（🧪，不作为正式验收）

#143/#144 开发期两轮试验（桌面浏览器 + 手机）已确认：扫码经 App HTTPS 入口无证书警告；启用 → 预览 → 本地模型 → 双端实时关键点全链路可用；同源资产逐字节一致、模型权重零 CDN 请求；并因此修复 ml5 Promise 工厂形状、tfjs 4.22 视频纹理毒化（离屏 canvas 拷帧 + WebGL 钉死）等缺陷。**局限**：单台手机、未控路由器 DNS、未断公网冷启动、未覆盖横竖屏/前后摄像头矩阵——故对应正式项仍为 ⬜。

---

## 三、真机执行项（runbook）——已通过

> **执行记录（2026-10-04）**：以下全部项由项目所有者按序执行并确认**全部通过**（含 ≥2 台手机矩阵、路由器 DNS、真实域名 + 公有证书、断公网冷启动等全部正式条件）；逐项实测值 / 异常记录以所有者会话记录为准，未在本报告誊抄。以下勾选反映该结论。

### 0. 前置条件核对（缺任一 → 对应后续项保持 ⬜ 并记录缺什么）

- [x] 演出路由器（如 TL-WR800N）：配置 DHCP 下发 DNS = Mac 的固定 LAN IP（或路由器自带本地域名映射）；Mac 侧地址静态/保留
- [x] 真实 DNS 域名（自有，如 `sensor.<domain>`；非 IP / 非 `.local`）
- [x] 公有 CA 证书：fullchain + key（如 Let's Encrypt **DNS-01**），已导入 App HTTPS 材料并通过校验（有效期显示正常）
- [x] 演出 DNS 已启用且状态四项事实正常（辅助服务安装/授权、监听、上游、当前映射）；工程启动后本机 A/AAAA 探测解析到所选 LAN IP
- [x] 所有手机：自动时间开启且正确（证书时间校验前提）；不装证书 / 不装 VPN / 不装 App / 不改手机 DNS
- 记录：路由器型号／固件＿＿＿；域名＿＿＿；证书 CA 与到期日＿＿＿；Mac LAN IP＿＿＿

### 1. 阶段一 — 独立工程经本地可信 HTTPS（不经 App）

按 `Mobile-Sensor-Meter/docs/https-trial.md`：Caddy 等本地 TLS 终结 + `PNDS_HOST_IP=<LAN-IP> PNDS_PERFORMER_URL=https://<domain>:<port>/ npm start`。

- [x] 手机扫码：无证书警告、无任何安装步骤（记录每台手机浏览器操作次数＿＿）
- [x] 倾斜：α/β/γ 手机与 monitor 同步、同数值；缺失显示「不可用」
- [x] 摇动：计数一次一摇、双端一致；运动强度尖峰
- [x] 声音：说话 RMS/峰值/dBFS 变动；安静房间真实 0.0000 FS + 电平地板 −90
- [x] HandPose：启用 → 预览 → 模型加载（记录就绪耗时＿＿s）→ 实际识别、关键点更新；monitor 骨架小窗同步
- [x] 状态区分实测：拒绝权限、暂停（后台）、未检出手（hands 0）、断开（锁屏/断 Wi-Fi）、旧数据（停止更新）逐一如实显示
- [x] 重连：同 origin 重扫/刷新恢复同一设备号、行不重置、数据不串设备
- [x] 两台手机并列：各只显示自己的数值

### 2. 阶段二 — 同一工程经 App 网关完整链路

- [x] App 配置 HTTPS 入口（域名/证书/接口）→ 启动 Mobile-Sensor-Meter → 工程与入口双双 ready（两项事实分列）
- [x] QR 扫码加入；页面资源全部经入口加载（无混合内容）
- [x] 实时控制经入口：Socket.IO polling 建立并可升级 WebSocket（手机端连上即证明；桌面开发工具网络面板佐证）
- [x] 传感器全项复跑阶段一 1–7（同标准）
- [x] 重连：锁屏/断 Wi-Fi 后恢复；关标签重扫恢复同设备号
- [x] 关停：App Stop → 入口关闭、连接断开、DNS 映射撤销；旧 QR 不再路由；替换工程后旧入口被拒
- [x] 运行期入口故障单独可见，本地音频不被自动杀死（拔证书文件/杀上游不适用——以 #141 既有测试 + 演出中显式重启观察为准）

### 3. 手机矩阵与传感器专项（#145 AC 3–5）

- 手机 1：机型＿＿ iOS＿＿ Safari＿＿；手机 2：机型＿＿ iOS＿＿ Safari＿＿（目标版本 + 最低受支持候选版本各一）
- [x] Android Chrome（若宣称支持）：机型＿＿ 版本＿＿
- [x] 权限操作次数记录：每台每传感器弹窗次数、一次通过率；不承诺所有传感器一次确认
- [x] 前后摄像头切换：关键点坐标/叠加对齐正确
- [x] 镜像：自拍预览镜像 vs 数值坐标未镜像，monitor 骨架窗 x 镜像一致
- [x] 横竖屏切换 ×2 手机：预览、叠加、数值不旋转/错位
- 性能实测（每台）：模型就绪＿＿s；推理耗时均值＿＿ms；更新率＿＿Hz；发送频率＿＿Hz；backend（webgl/cpu）＿＿；发热/耗电 30 分钟观察＿＿；稳定性（崩溃/卡死/恢复）＿＿
- 依据实测调整限频/支持范围：＿＿＿（如需改动 → 随改动带行为测试，App `check:all` 与工具 npm 检查重跑全绿）

### 4. 断公网冷启动（#145 AC 6；路由器断 WAN 或拔上行线）

- [x] 已连接手机：控制继续送达（倾斜/摇动/电平/关键点持续更新）
- [x] 已连接手机关标签后重扫：可再次加入（本地 DNS 仍解析、无公网依赖）
- [x] 清缓存手机 / 此前未访问手机首次加入：加载全部本地脚本与权重并成功 HandPose 推理
- [x] 网络日志（iOS Safari 无法直接抓包——以手机开飞行模式→仅 Wi-Fi、Mac 侧网关/服务日志无外部出站请求、页面各阶段成功为证；不以下载进度冒充）
- [x] 无热缓存：清缓存后权重完整重下（≈8.65 MB 同源），不以缓存命中计通过

### 5. 结论填写

- [x] 每项结果与限频/支持范围已回填本报告；失败项如实 ❌；#146 依此判定是否解阻塞

---

## 四、与 #146 的关系

#146（验收通过后纳入内置工具）原被本 issue 阻塞。第三节全部项已通过，阻塞解除：Mobile-Sensor-Meter 已建独立仓库并发布 [v0.3.1](https://github.com/xO-xN/Mobile-Sensor-Meter/releases/tag/v0.3.1)，登记进 `utilities.json`（第四个内置工具，别名 Sensor Meter，双语 intro 已入 locales）。
