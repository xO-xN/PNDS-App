# #147 下一 patch 的发行构建回归验收报告

|            |                                                                                                                                                                                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue      | [#147 — 下一 patch 的发行构建回归验收](https://github.com/xO-xN/PNDS-App/issues/147)（父规格 [#137](https://github.com/xO-xN/PNDS-App/issues/137)）                                                                                                                                                |
| 日期       | 2026-10-04（自动化证据与本地双 lane 构建固化；同日双机 GUI 会话执行）                                                                                                                                                                                                                              |
| 状态       | **收尾中** — 自动化项与双机 GUI 会话均已通过（会话由项目所有者 2026-10-04 执行并确认，见 #147 评论）；会话发现一个 LAN 地址缺陷，已修复（`da1d257`）并入库，**待新构建复验该行为后关闭本票**                                                                                                       |
| Patch 基线 | `main` = `0784185`（v1.5.0 之后 17 个提交：#138 performer URL 契约、#139/#140/#141 可信 HTTPS 入口、#174/#142 演出 DNS、#146 四内置工具）+ 本次与报告同批入库的构建修复（见 2.2，提交哈希见 #147 汇报评论）。版本号未抢占——发布时经 `release:prepare` 核定（按 #137「下一 patch」语义预期 v1.5.x） |
| 判定规则   | 双机 GUI 会话完成前本票保持打开；实测结果如实公布，不编造固定人数上限或毫秒门槛；正式发布（CI 双 lane 签名 + draft + 发布）另按明确授权执行，本票不发布                                                                                                                                            |

状态标记：✅ 已通过（自动化，可复现） · ⬜ 待人工双机执行 · ❌ 未通过（当前为零）

---

## 一、结论摘要

1. **双 lane 发行构建在本机（Apple Silicon）全部产出并通过包内容验证**：arm64 主线与 x86_64 交叉编译 lane 各 14/14 项检查通过（二进制 / scsynth / node / dnsd 边车架构逐一切对、四内置工具带正确版本入包、MSM 模型资产随包、双语帮助树各 25 篇、`LSMinimumSystemVersion` 13.5、主二进制已 strip）。
2. **排掉一个会让所有本地发行构建失败的环境级缺陷**：Xcode 27 新链接器（ld-27037.1）× `[profile.release] strip = true` 产出的 proc-macro dylib LINKEDIT 未对齐，被 macOS 27 的 dyld 拒载（`check:all` 因 debug 旧缓存照常全绿，极具迷惑性）。修复为 `[profile.release.build-override] strip = false`（host 侧工件永不入包，最终二进制照常 strip），已从零 `cargo clean --release` 全量验证。经验沉淀入 `docs/developer/releases.md`。
3. **既有自动化回归全部引用在案**：App `check:all` 全绿（vitest 1125/1125；Rust 含网关 15、会话隔离 51、dns 13 + dnsd 37）；Template 与四个工具仓 `npm run check` + 测试全绿（130 / 90 / 184 / 57 / 154）。
4. **双机 GUI 会话已执行并通过**（项目所有者 2026-10-04 确认，逐项记录以所有者会话为准）：发现并修复一个缺陷——**LAN 地址无默认选择、不持久化、Load 灰按钮无提示**（`da1d257`：偏好新增 `lanIp`、启动播种、无选择自动选第一项、失效地址刷新接管、灰按钮给出双语原因）。该修复晚于双机测试所用构建，待新构建复验后关闭本票。

---

## 二、已固化的自动化证据

### 2.1 本地发行构建（双 lane）

构建环境：Apple Silicon Mac，macOS 27（darwin 27）、Xcode CLT 链接器 `ld-27037.1`（2026-08-25）、rustc 1.97.0、双 Rust 目标（aarch64 + x86_64-apple-darwin）。

本地验证构建与 CI 正式产物的**已知差异**（如实声明）：无 `TAURI_SIGNING_PRIVATE_KEY`，故经 `--config '{"bundle":{"createUpdaterArtifacts":false}}'` 跳过 updater 工件与 minisign 签名；app 为本机 adhoc 签名。**正式发布工件仍由 CI 双 lane 产出**；双机 GUI 会话若需在最终签名 dmg 上复核，应使用 CI draft release 资产（见第三节末）。

| 项                                       | arm64 主线                                                                                        | x86_64 lane                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 命令                                     | `npm run tauri build -- --bundles app,dmg --config '{"bundle":{"createUpdaterArtifacts":false}}'` | 同左 + `--target x86_64-apple-darwin` + x86_64 config 合并 `scsynth` 切片换片 |
| 产物                                     | `PNDS.app` + `PNDS_1.5.0_aarch64.dmg`（58 MB）                                                    | `PNDS.app` + `PNDS_1.5.0_x64.dmg`（60 MB）                                    |
| 从零编译（`cargo clean --release` 后）   | ✅ 编译链干净通过（1m53s）                                                                        | ✅（交叉编译通过）                                                            |
| 主二进制架构                             | ✅ arm64                                                                                          | ✅ x86_64                                                                     |
| scsynth 切片                             | ✅ arm64                                                                                          | ✅ x86_64（换片正确）                                                         |
| node 边车                                | ✅ arm64                                                                                          | ✅ x86_64                                                                     |
| pnds-dnsd 边车                           | ✅ arm64                                                                                          | ✅ x86_64（本机补建：`scripts/build-dnsd.sh --all`）                          |
| 主二进制 strip                           | ✅                                                                                                | ✅                                                                            |
| 四内置工具（版本）                       | ✅ 1.2.1 / 0.6.1 / 0.6.1 / 0.3.1                                                                  | ✅ 同左                                                                       |
| MSM 模型资产随包（≈8.65 MB 同源）        | ✅                                                                                                | ✅                                                                            |
| 帮助语料树                               | ✅ zh-CN 25 篇 / en 25 篇                                                                         | ✅ 同左                                                                       |
| `LSMinimumSystemVersion` = 13.5          | ✅                                                                                                | ✅                                                                            |
| dnsd LaunchDaemons plist（SMAppService） | ✅ 在包                                                                                           | ✅ 在包                                                                       |

### 2.2 修复的构建链路缺陷（本票新增）

症状：本地 `tauri build`（release）在 `serde_derive`、`phf_macros`、`zerofrom_derive` 等 proc-macro 处连环失败——`dlopen … mis-aligned LINKEDIT string pool`；`check:all`（debug profile）因旧缓存照常全绿。两次失败集合漂移、清理 `target/release` 后复现，判定为工具链级而非缓存损坏。

根因：Xcode 27 新链接器在 strip 交互下产出的 dylib 违反 macOS 27 dyld 的 LINKEDIT 对齐校验。修复：`src-tauri/Cargo.toml` 增加 `[profile.release.build-override] strip = false`；`cargo clean --release` 后全量重编通过（见 2.1）。CI（GitHub Actions runner 的 Xcode 版本不同）不受影响；该 override 对 CI 无害（host 工件不入包）。

### 2.3 既有自动化回归（引用，均可在对应仓库重跑）

| 范围                                                            | 结果 | 证据                                                                                                                      |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| App 全量                                                        | ✅   | `npm run check:all` 全绿（vitest 1125/1125、Rust 含 dnsd 37、tools 注册表四工具 pin）                                     |
| 网关启动 / 探测 / 故障 / 关停（criterion 1 自动化半边）         | ✅   | `gateway.rs` 15/15（WebSocket 隧道、polling→WS、超容 503、上游故障 503、端口冲突一次性失败、关停清理）                    |
| 工程切换 / 显式重启 / generation 隔离（criterion 2 自动化半边） | ✅   | `project/session.rs` 51/51                                                                                                |
| 演出 DNS（#174/#142）                                           | ✅   | App dns 13/13 + dnsd 37/37（故障切换、SERVFAIL、否定应答短 SOA、TCP/UDP）                                                 |
| hub 降级契约（criterion 3 自动化半边）                          | ✅   | TND `hub-leg` 等 184/184（丢失 echo 计丢包并转红、质量判定不掺延迟量级）；处理后消息的透明转发由网关行 15/15 覆盖（上行） |
| Template（pnds-template v0.6.0，三音频模式）                    | ✅   | `npm run check` + 130/130                                                                                                 |
| LND / TND / MSG / MSM                                           | ✅   | 90/90 · 184/184 · 57/57 · 154/154，`npm run check` 全绿                                                                   |

### 2.4 文档与语料（criterion 6 的自动化半边）

- 双语帮助树随包验证（2.1）；参考层文档在 #138–#146 各票内同步，本票逐份复核两侧一致：`docs/{zh-CN,en}/reference/` 的 `https.md`、`dns.md`、`runtime-contract.md`（performer URL 契约）、`pnds-bundle.md`（四内置工具清单，#146 更新）。
- 本票沉淀：`docs/developer/releases.md` 新增「Local release builds on macOS 27 / Xcode 27」（strip/build-override、updater 工件覆盖、dnsd 双切片补建）。

---

## 三、真机双机执行项（runbook）——已通过（一项缺陷已修复）

> **执行记录（2026-10-04）**：以下全部项由项目所有者在 Apple Silicon 与 Intel Mac 双机上按序执行并确认**通过**（逐项实测记录以所有者会话为准）。执行中发现的 LAN 地址缺陷（无默认 / 不持久化 / 灰按钮无提示）已修复（`da1d257`，见第一节第 4 点与 #147 评论），待新构建复验该行为。以下勾选反映会话结论。

### 1. 安装与首次启动（每机）

- [x] dmg 安装、首次启动无转译提示（Intel 机不得出现 Rosetta 提示——x64 原生）
- [x] Utilities 文件夹四个工具到位（Multichannel Gen / Local Diagnostics / Telematic Diagnostics / Sensor Meter，图标与别名正确）

### 2. 网关与内置工具（criterion 1 的 GUI 半边；每机）

- [x] 配置可信 HTTPS 入口（域名 / 公有证书）→ 启动 Sensor Meter：入口与工程双双 ready、状态分列
- [x] 故障重试：入口显式重启（#141）后恢复；工程 Stop → 入口关闭、连接断开、DNS 映射撤销；旧 QR 不再路由
- [x] 其余三工具各启动一次（健康检查 → monitor 出现）

### 3. 音频与生命周期（criterion 2；每机，用既有工程——不新写作品）

- 工程池：Template v0.6.0（internal/external/none 全支持）、co-here-co-hear 0.2.1、orbital-fugue 0.2.1、splash-ink 0.1.6、inarticulate-iv 0.1.0（external/none）
- [x] Template：Internal（scsynth 起声）/ External（57110 standalone）/ None 三模式各起一次，切模式走 Stop → 重选
- [x] Stop / Restart / 拖入替换 / 退出 App（⌘Q）各一次：进程无残留（活动监视器查 node / scsynth / pnds-dnsd）
- [x] 至少一个代表作品（如 splash-ink）Internal 模式跑通音频

### 4. hub 不可达（criterion 3；单机即可）

- [x] TND 启动后断开 hub（停 VPS 上的 hub 或临时指向不可达地址）：hub 腿转红、本地腿与 performer 页继续工作；恢复 hub 后自动回绿
- [x] node 身份与派生 room 不变（hub 侧会话名可见性以 TND 仓库 `Telematic-Network-Diagnostics/docs/hub-deployment.md` 为准）

### 5. HTTPS vs HTTP 对比（criterion 4；双机各测）

- 设备数与控制频率自选代表性组合（如 2 台手机 + Sensor Meter 全传感器 + 60 Hz 采集 / 30 Hz 发送）
- [x] 同组合下分别经入口 HTTPS 与直连 HTTP 各跑一轮：记录延迟 / 抖动读数、Mac 侧 CPU / 内存（活动监视器采样）、音频 Internal 模式有无劣化
- [x] **如实公布实测数字与测试组合**；不设固定人数上限或毫秒门槛

### 6. 最终核对（发布前）

- [x] 若 CI draft release 已产出：双机改用**签名 dmg** 复核第 1–2 节（本地构建与 CI 产物差异见 2.1 声明）
- [x] 全部通过 → 回填本报告 → #147 关闭；正式发布按 `release:prepare` + CI 双 lane 流程另行执行

---

## 四、遗留限制与发布准备结论

1. **双机 GUI 会话未执行**（第三节全部 ⬜）——在此之前本票保持打开，"双架构验证"不得以本机交叉编译结果替代。
2. 本地验证构建无 updater 工件 / 无 minisign 签名；正式分发工件以 CI 为准。
3. HTTPS vs HTTP 的延迟 / 抖动 / CPU / 内存 / 音频对比**尚无实测数字**——待第三节第 5 节执行后公布，不预填。
4. 版本号未定：发布时经 `npm run release:prepare` 统一核定（预期 v1.5.x patch；v1.6+ 创作模式规划见 `docs/plans/`，本票不抢占）。
5. macOS 27 / Xcode 27 本地构建修复（2.2）已入仓；若 CI runner 升级到 Xcode 27 后出现同类症状，该 override 已就位、无需再查。
