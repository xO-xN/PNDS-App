# QR 工具发行候选与正式接入（2026-10-30）

四个工具的维护源已移除工程 QR；多轨道工具新增双端口控制台与服务器状态同步。Mobile Sensor Meter 同时保留任务开始前已有的手势 Worker 修复，因此沿用该维护源当前版本后递增为 0.4.4。全部工程检查／测试已通过。

候选包按各源仓库现有 package workflow 的运行文件 allowlist 组装，不含 node_modules；已通过 App 实际安装、重新打包与再次安装，逐文件 SHA-256 保持。下表保留最初本地候选哈希；正式发行使用下方单独核验的工作流产物哈希。

| 工程                          | 版本  | 本地候选 SHA-256                                                   |
| ----------------------------- | ----- | ------------------------------------------------------------------ |
| pnds-template                 | 0.7.1 | `9996c84349bc74ac34c4291c35f5d8718f44a020e0c635cac2c642d0451afe75` |
| multichannel-signal-generator | 1.3.1 | `1771d0d9df11ee87a450e20762dfe43eb5411070b2ee5826a96349d0b5721981` |
| local-network-diagnostics     | 0.7.1 | `8244d1a08ab8c4d50bbadbb62b43ad710c453df59dff254d790e29c518562402` |
| telematic-network-diagnostics | 0.7.1 | `d38d621aeca9200aa10f59e9802797acbd83733fcd57bff61042c9670dc180bc` |
| mobile-sensor-meter           | 0.4.4 | `8ac3d682cb9d3e874b0be4bdd62380d61d75d7a45da6866be9b4522d39f5e218` |

App 工作区内的本机候选目录：`.cache/qr-migration-candidates/`。完整源路径、运行文件和哈希在该目录的 `inventory.json`。Template 候选是 Classic 本地冻结验证输入，不需要发布。

## 四个工具的正式接入

按 `docs/developer/shared-libraries.md` 及 Mobile Sensor Meter 的 AGENTS.md，正式 Utilities 清单只接入真实固定发行产物，不能以本地暂存冒充发行来源。需要在四个工具源仓库提交此次源码变更、打相应版本标签、经既有 workflow 生成发布包并发布；以下载的真实产物重新核对哈希后再更新 `utilities.json` 与随包资源。流水线 ZIP 元数据可能使正式包哈希不同于本地候选，正式注册表必须采用实际发行哈希。

用户随后明确授权四个工具提交、打标签、通过既有流水线发布并更新 App 固定包。四个工具在 `codex/app-performer-qr` 分支提交；App 和其他作品工程保持未提交。

## 已发布固定产物

以下均由源仓库现有 package workflow 构建，按此前工具通道发布为 prerelease，不替换稳定 latest。下载的真实 ZIP 已通过布局、版本、源码内容和 App 安装／重打包／再次安装校验；`utilities.json` 使用这些正式产物 SHA-256。

| 工具与版本                                                                                                        | 源提交                                                                                                            | 流水线                                                                                  | 正式产物 SHA-256                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [multichannel-signal-generator 1.3.1](https://github.com/xO-xN/Multichannel-Signal-Generator/releases/tag/v1.3.1) | [3a737e6](https://github.com/xO-xN/Multichannel-Signal-Generator/commit/3a737e60b402216e71ee981eb95ed27a18b1ac66) | [通过](https://github.com/xO-xN/Multichannel-Signal-Generator/actions/runs/41058168142) | `2dbe3543260bdff50d7a2af59db5dc33d4e92e031b87fabcc6cfb4037b251a4a` |
| [local-network-diagnostics 0.7.1](https://github.com/xO-xN/Local-Network-Diagnostics/releases/tag/v0.7.1)         | [31b477a](https://github.com/xO-xN/Local-Network-Diagnostics/commit/31b477ae931393b3cf2e542b3c40b1712227189e)     | [通过](https://github.com/xO-xN/Local-Network-Diagnostics/actions/runs/41058174009)     | `1c33fa10c4d1a7dbefb35f83a4242e61d6ea810ddd8ae85664ef0f4b06fff77c` |
| [telematic-network-diagnostics 0.7.1](https://github.com/xO-xN/Telematic-Network-Diagnostics/releases/tag/v0.7.1) | [79b75cd](https://github.com/xO-xN/Telematic-Network-Diagnostics/commit/79b75cd85be359b10368b96c3b541030080e1586) | [通过](https://github.com/xO-xN/Telematic-Network-Diagnostics/actions/runs/41058181526) | `ed169f9dd2fe85151bfd0972eefb2b0fa21ccd5bc228d92abcc81d5b9e3195ad` |
| [mobile-sensor-meter 0.4.4](https://github.com/xO-xN/Mobile-Sensor-Meter/releases/tag/v0.4.4)                     | [fe43c5f](https://github.com/xO-xN/Mobile-Sensor-Meter/commit/fe43c5f5a06a99c50adc254cd806f066c276813d)           | [通过](https://github.com/xO-xN/Mobile-Sensor-Meter/actions/runs/41058394968)           | `deb82d899ac0fd3c7b2e46525c05f76c830b120e07d65c777144bbae77f1a244` |

本机正式包与验证清单：`.cache/qr-official-releases/`。传感器工作流按现有 `fetch:handpose` 脚本刷新 `PINNED.json.fetchedAt`；除该核验时间戳外，运行文件与提交源码匹配，模型四个文件及其固定哈希保持。实际发行清单记录该差异，并以发行文件原始哈希执行安装往返校验。

传感器锁文件从原完整 npm peer tree 保留依赖版本，仅移除 qrcode 及其无用项；隔离目录中的 npm ci dry-run 与现有 GitHub Actions 的真实 npm ci 均通过，源码 check／185 项测试通过。

## 提交前修复与新固定包（2026-11-03）

Host 配置空值回归修复来自同一 Template 维护工作树，候选版本升为 0.7.2；Classic 仍冻结 89 份来源文件，并重新核对全部哈希、构建 inventory pin 与 provenance。标准模块目录由维护源重新同步，归档旧 0.7.1 内容快照，不以新哈希否定工程此前采用的旧来源。Template 的 check 与 155 项测试通过。

Template 0.7.2 本地包 SHA-256 为 `532f2e3861104c97a94a63be8727cd85dc56227f94dbf2e5524c092b27f05732`。它与多轨道工具修复候选均通过 App 的实际安装、重打包和再次安装，逐份运行文件／资源 SHA-256 保持；本机清单位于 `.cache/commit-readiness-fixes/`。Template 是本地验证来源，不宣称公开发行。

用户明确授权多轨道工具提交和发布修复后，源码 7 文件提交为 [8b59464](https://github.com/xO-xN/Multichannel-Signal-Generator/commit/8b594646ef8717bccbe4773bf989f620cd4564cc)，经[既有 package workflow](https://github.com/xO-xN/Multichannel-Signal-Generator/actions/runs/41577757194)成功构建，发布为 [v1.3.2 prerelease](https://github.com/xO-xN/Multichannel-Signal-Generator/releases/tag/v1.3.2)。既有 v1.3.1 保留，稳定 latest 仍为 v1.2.1。

正式资产 `multichannel-signal-generator-v1.3.2.pnds` 的 SHA-256 为 `738985bdb108041b803706b2ac33193be48fa73007ab7a127074c3c05fe676c9`，与本地候选的 ZIP 元数据哈希不同；16 份运行文件与标签提交逐字相同。`utilities.json` 使用此正式哈希，经普通公开发行下载入口重新获取并核对，随包目录逐文件一致。工具 check 与 68 项测试通过，包含实际页面／控制客户端和两个 HTTP 端口的并发确认回归。App 仓库不随工具发布自动提交。
