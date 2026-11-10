# 开发文档

App 开发的规则层：既定模式与系统做法，按问题检索——查什么 → 读哪个文件。平台契约（工程格式 / 运行协议 / `.pnds`）的索引在 [`docs/zh-CN/reference/README.md`](../zh-CN/reference/README.md)；**App 产品行为与验收 → [app-behavior.md](./app-behavior.md)**。

- **普通浏览器确认、不可变演出 URL、候选发现、成功后切换与可选保存入口（#295／#298／#299／#302）** → [browser-participation.md](./browser-participation.md)。

## 已批准的版本规格

**v1.7.0-beta.3 单一空白工程、本地能力与原生媒体（默认基础已实现，其余范围按子票验收）** → [正式规格](../plans/v1.7.0-beta.3-creation-foundation-spec.md)、[#315](https://github.com/xO-xN/PNDS-App/issues/315)：撤下 Classic 新建，默认 Express／Socket.IO／osc-min、身份／视图／输入及录制公共接线，三类按需传感器和 Host／创作窗口媒体。第六组先实现，第七组与原 beta.3 一起在 #313／#314 验收；原九源、既有 Classic 兼容和已完成记录保持。见[七组安排](../plans/v1.7.0-beta.3-implementation-runs.md)。本轮 #316–#320 的唯一 Blank、持久身份、视图同步、输入与录制闭环见[默认基础实施记录](../acceptance/316-317-318-319-320-default-blank.md)；本组不代表父 #315 或最终实机验收完成。

**v1.7.0-beta.3 统一演奏入口、工程切换与断线继续演奏** → [正式规格](../plans/v1.7.0-beta.3-browser-participation-spec.md)、[版本索引](../plans/v1.7.0-beta.3-spec-index.md)、[#294](https://github.com/xO-xN/PNDS-App/issues/294)、[ADR-0017](../adr/0017-stable-browser-performance-entry.md)：纯 HTTP、安装可选、浏览器与原生池客共用入口并单击进入新工程，失联／停演及切换失败保留原文档，本轮范围按后续确认收敛为九个维护源，另含 ASBS 分谱预取。#295／#296／#297／#300 已实现首条普通浏览器契约、完整分谱准备、稳定空闲入口及原生文档保留；随后 #298／#299／#301 完成浏览器／原生单击切换；#302／#303／#304／#312 的保存入口、网络邀请及 Template／Classic／ASBS 完整试点见[本轮验收记录](../acceptance/302-303-304-312-pilot-and-invitation.md)。四工具 #308–#311 的公开发行、正式固定资源、实际安装／入口回归及待实机项见[四工具记录](../acceptance/308-309-310-311-utility-participation.md)。其他维护源及跨平台安装验收仍按后续子票推进。[逐轮讨论](../plans/2026-11-09-browser-participation.md) 保留来源基线和核对过程。

**v1.7.0-beta.2 四项新增规格（已确认）** → [规格索引](../plans/v1.7.0-beta.2-spec-index.md)：[演奏记录／回放／叠加 #257](https://github.com/xO-xN/PNDS-App/issues/257)、[池主／池客 #258](https://github.com/xO-xN/PNDS-App/issues/258)、[自动运行端口 #259](https://github.com/xO-xN/PNDS-App/issues/259)、[待处理文档 #260](https://github.com/xO-xN/PNDS-App/issues/260)。#257／#258 的代码实现、自动化与两轴复审已完成，实机声音、媒体和双机验收待用户进行，见[实施与实机清单](../acceptance/257-258-recording-and-participation.md)。#259／#260 已接入自动运行端口和待处理文档工作流，实施、集成检查与待实机项目见[对应验收记录](../acceptance/259-260-runtime-ports-and-pending-documents.md)；规格发布与自动化通过均不代替原生验收。

**v1.7.0-beta.2 五项界面细调（2026-10-30）** → [确认范围](../plans/v1.7.0-beta.2-ui-refinements.md)：正弦变速彩环、演奏端连接状态、音频／LAN 图标及助手已完成问答折叠。

**v1.7.0-beta.2 演奏记录与叠加排练** → [正式规格](../plans/v1.7.0-beta.2-performance-recording-spec.md)、[实现规则](./performance-recording.md)、[设计讨论](../plans/v1.7.0-beta.2-performance-recording-design.md)、[2026-11-04 轮次修订与诊断](../plans/2026-11-04-performance-recording-debug.md)：整场记录、回放、创作多人轮次叠加、整轮重录及两层删除已实现，III／runes 工程适配按相同轮次规则接线；实机声音验收尚待用户完成。

**v1.7.0-beta.2 池主／池客与自动端口管理** → [角色规格](../plans/v1.7.0-beta.2-performance-roles-spec.md)、[角色实现规则](./performance-participation.md)、[端口规格](../plans/v1.7.0-beta.2-runtime-ports-spec.md)、[设计讨论](../plans/v1.7.1-performance-roles-design.md)：池主／池客角色、内嵌参与、身份门禁、隔离来源及资源收尾已实现，真实 HTTP／polling／WS 自动化通过；签名 App 的媒体、存储和双机验收尚待进行。#259 已实现显式能力声明、监听器交接、启动报告核验与冲突避让，规则见[端口管理](./ports.md#managed-runtime-listeners-259)；[HTML 原型](../prototypes/performance-roles-1.7.1.html)保留确认依据。旧设计路径仅为保留评审链接。

**已批准版本安排（2026-10-15，2026-10-20 补充）** → [v1.6.0–v1.7.0 更新规划](../plans/releases-through-v1.7.0.md)，原决定过程见[逐轮讨论](../plans/pre-v1.7-release-grilling.md)，完整创作基线见[本轮决定](../plans/post-v1.7-creation-experience.md)，最新六项调整见[讨论、逐题回答与创作资料接入规格](../plans/v1.7.0-creation-refinements-spec.md)。v1.6.0–v1.6.5 分别承接创作基础、模块与 Skills、共享库、起点与只读 Git、静态诊断及受控检查；前序全部验收后正式开发 v1.7.0。1.7.0 包括对话主入口、讨论内调参／直接编辑代码／按工程能力预演、基础编辑器、显式片段、交接基线与比较、App 自供本地 Git 和历史载入草稿。总体规格 [#190](https://github.com/xO-xN/PNDS-App/issues/190) 与 [76 票实施拆分与依赖](../plans/pre-v1.7-ticket-breakdown.md)为领取入口；#224–#230 承接完整工作流，新增 [#231](https://github.com/xO-xN/PNDS-App/issues/231) 提供参数绑定与临时预演基础，由 #208 接入建议卡。#238–#243 全部安排在 #172 收尾前，MCP 留到后续版本。任务状态与实际验收分别核对，不据规格发布宣称功能完成。

- **v1.6.0 演出与创作模式的工作流、文件操作及测试窗口** → [正式规格](../plans/v1.6.0-creation-mode-spec.md)
- **v1.6.1 标准技术模块整理与外部 PNDS Skills 重构** → [正式规格](../plans/v1.6.1-modules-skills-spec.md)
- **v1.6.2 单一较新共享库与三作品发行兼容** → [正式规格](../plans/v1.6.2-shared-libraries-spec.md)
- **v1.6.3 多模板、只读 Git 与上下选卡** → [正式规格](../plans/v1.6.3-creation-workflow-spec.md)
- **v1.6.4 静态工程诊断与 CLI** → [正式规格](../plans/v1.6.4-static-diagnostics-spec.md)
- **v1.6.5 临时副本检查、版本证据与单文件撤销** → [正式规格](../plans/v1.6.5-controlled-checks-spec.md)
- **v1.7.0 完整创作流程、模型服务、编辑器、交接比较与本地版本** → [正式规格](../plans/v1.7.0-creation-assistant-spec.md)
- **v1.7.0 只读讨论、逐题问答、手动交接、SCD 外部打开及文本资料／工程整理** → [#238–#243 补充规格](../plans/v1.7.0-creation-refinements-spec.md)
- **v1.6.0 跨票回归与真实环境验收** → [#164 验收记录](../acceptance/164-v1.6.0-workflows.md)
- **v1.7.0 讨论内调参、代码编辑、预演与完整创作流程验收** → [#172 待实施验收要求](../acceptance/172-v1.7.0-creation-workflows.md)
- **v1.7.0 八组调试的依赖、操作步骤、通过标准与阶段交付** → [阶段性调试计划](../plans/v1.7.0-staged-debugging-plan.md)
- **r6-final 真实 App 的入口映射、实施及验收状态** → [desktop-1.6-implementation.md](./desktop-1.6-implementation.md)
- **UI 定稿和逐轮交互记录** → [原型说明](../prototypes/README.md)

2026-10-15 后续追加：[模型容量、上下文用量、长对话与文档读取优化](../plans/v1.7.0-context-management-spec.md)由 #232～#235 承担，基础排在 #168 前。本轮 #165～#167 范围不扩展。#232～#235 的实现、受控前后比较与待用户实机项目见[验收记录](../acceptance/232-235-context-management.md)；不据自动化宣称原生验收完成。

以上规格是实施与验收基线；各项实际进度以对应验收记录为准，实现模式同步到下方规则篇。v1.6.0 交付首批五项模块文件添加与接线交接，v1.6.1 整理模块及外部 Skills；App 助手不安装 Skills 或实施移植。

## 架构与状态

- **演奏记录适配、共同时间、身份、持久化与恢复** → [performance-recording.md](./performance-recording.md)（#257）；真实声音由实机验收确认。

- **App 的心智模型、分层与系统总览** → [architecture-guide.md](./architecture-guide.md)
- **Rust 侧模块组织与约定** → [rust-architecture.md](./rust-architecture.md)
- **useState / Zustand / 持久化怎么选，selector 语法与 getState** → [state-management.md](./state-management.md)
- **两窗口快照恢复、请求交错与卸载清理** → [state-management.md](./state-management.md#session-snapshot-mirrors)
- **演出事实接纳、迟到回复与重选配置恢复** → [state-management.md](./state-management.md#session-snapshot-acceptance)
- **工程预检归属、迟到结果与配置准备** → [state-management.md](./state-management.md#project-preflight-ownership)
- **离线标准模块、旧版来源保护与外部 Skills 分发** → [standard-modules.md](./standard-modules.md)
- **Blank 默认输入、接纳后的共同状态、去重与释放** → [blank-input.md](./blank-input.md)（#319）。
- **固定共享库、工程采用与离线加载边界** → [shared-libraries.md](./shared-libraries.md)
- **Blank／Classic 固定创建来源、独立身份与取消／失败保护** → [creation-workspace.md](./creation-workspace.md#fixed-classic-source-and-initialization-200)
- **自供本地 Git、初始版本、完整文件记录与历史载入草稿** → [local-git.md](./local-git.md)（#228–#230）。
- **工程版本锁外阅读、身份撤销与比较代次** → [local-git.md](./local-git.md#version-reading-outside-the-workspace-lock)。
- **工程范围内只读 Git 状态、分层差异与过期快照** → [creation-workspace.md](./creation-workspace.md#read-only-git-inspection-201)
- **文件用途名称、依赖汇总、技术文件折叠与真实列表切换** → [creation-workspace.md](./creation-workspace.md#purpose-view-and-real-file-list-2026-10-22)。
- **创作阅读、可信工程身份、文件限制与异步切换** → [creation-workspace.md](./creation-workspace.md)
- **待处理文档的真实文件、编辑保存、迁移、整任务接入与持久恢复** → [pending-documents.md](./pending-documents.md)（#260）；[旧资料兼容入口](./creation-workspace.md#private-text-creation-materials-241--248)保留历史路径。
- **无副作用的 App Doctor、共用报告与离线 CLI** → [static-diagnostics.md](./static-diagnostics.md)（#193 / #203 / #204）。
- **临时副本检查、跨 App／CLI 运行归属、输入证据与取消清理** → [controlled-checks.md](./controlled-checks.md)（#194）。
- **已有单文本差异、审阅保存与版本保护撤销** → [single-file-changes.md](./single-file-changes.md)（#207）。
- **工程字面值绑定、受限临时预演协议与恢复** → [parameter-preview.md](./parameter-preview.md)（#231）。
- **确认交接、保存版基线、部分失败恢复与交接后只读比较** → [handoff-baselines.md](./handoff-baselines.md)（#171 / #226 / #227）。
- **在本机 SuperCollider 打开工程 SCD 保存版、可信目标与失败重试** → [creation-workspace.md](./creation-workspace.md#open-saved-scd-in-supercollider-240--247)（#240 / #247）。
- **创作草稿、手动保存、重命名与磁盘版本冲突** → [creation-workspace.md](./creation-workspace.md#manual-save-rename-and-disk-conflicts-154)；[手动新建代码与文本文件](./creation-workspace.md#manual-code-and-text-file-creation)。
- **工程文本暂存、可信目标发布、最终复核与临时清理** → [creation-workspace.md](./creation-workspace.md#project-text-publication)。
- **错误如何传播、用户反馈与重试模式** → [error-handling.md](./error-handling.md)
- **运行期工程／音频健康、持续告警、明确错误收尾与性能边界** → [runtime-health.md](./runtime-health.md)

- **池主／池客角色、接入协调、稳定网页来源与媒体验收** → [performance-participation.md](./performance-participation.md)（#258 / #259）。
- **原生池客保留原文档、持续发现、单击进入与失败保页** → [native-client-continuity.md](./native-client-continuity.md)（#300／#301）。
- **Host monitor／创作 performer 的可信原生媒体、投影结果归属与独立窗口释放** → [native-project-media.md](./native-project-media.md)（#322／#323）。
- **聊天采用设备麦克风、四特征、当前页所有权与公共事件回放** → [device-microphone.md](./device-microphone.md)（#325）。
- **摄像头 HandPose 的 p5 前提、模型字节、页面归属和录制接线** → [camera-handpose.md](./camera-handpose.md)（#326）。
- **聊天采用设备运动、字段有效性、权限和公共事件回放** → [device-motion.md](./device-motion.md)（#324）。
- **真实运行端口、监听器交接、旧工程兼容与占用诊断** → [ports.md](./ports.md#managed-runtime-listeners-259)（#259）。

- **统一网络邀请、入口 QR、故障与实际运行端口（#303）** → [network-invitations.md](./network-invitations.md)。

## 命令与系统桥

- **新增 / 使用类型安全的 Tauri command（tauri-specta 工作流）** → [tauri-commands.md](./tauri-commands.md)
- **原生菜单构建与 i18n** → [menus.md](./menus.md)
- **全局快捷键、修饰键与确认流** → [keyboard-shortcuts.md](./keyboard-shortcuts.md)
- **Tauri 插件的使用与配置** → [tauri-plugins.md](./tauri-plugins.md)

## UI 与文案

- **CSS 架构、颜色 token、shadcn/ui 用法** → [ui-patterns.md](./ui-patterns.md)
- **四工具的统一入口、真实 Worker、源码／发行包／固定资源边界（#308–#311）** → [utility-browser-participation.md](./utility-browser-participation.md)
- **Telematic 工具的公网地图、位置来源与独立 HUB 协议** → [telematic-diagnostics.md](./telematic-diagnostics.md)
- **封面标题拟合的测量、揭示与清理** → [ui-patterns.md](./ui-patterns.md#cover-title-fitting)
- **独立 HTML 原型、双语文案同步与内存演示测试** → [prototypes.md](./prototypes.md)
- **翻译系统、语言切换、RTL 支持** → [i18n-patterns.md](./i18n-patterns.md)
- **toast 与原生通知** → [notifications.md](./notifications.md)

## 数据与外部交互

- **文件存储模式与原子写入** → [data-persistence.md](./data-persistence.md)
- **偏好保存结果、失败日志与队列续行** → [data-persistence.md](./data-persistence.md#save-outcomes)
- **可信 HTTPS 证书材料：校验管线、受保护存储与设置区接线（#139）** → [https-material.md](./https-material.md)
- **HTTPS 准备操作时序、异常收尾与域名保存后的摘要重验** → [https-material.md](./https-material.md#前端准备流程)
- **可信 HTTPS 入口网关：hyper/rustls 转发、生命周期接线与探测（#140）** → [https-gateway.md](./https-gateway.md)
- **模型服务配置、钥匙串、连接测试与外部 HTTP 约定** → [external-apis.md](./external-apis.md)（#165）。
- **讨论 / 工作、只读兼容、对话收束承接、交接审阅与同任务检查撤回** → [creation-assistant.md](./creation-assistant.md#explicit-creation-modes-2026-10-17)。
- **逐题创作问题、显式作答、历史与重启接续** → [creation-assistant.md](./creation-assistant.md#one-creative-question-at-a-time-238)（#238）。
- **编辑助手的工程目录准备、归属核对与安全撤回** → [creation-assistant.md](./creation-assistant.md#task-owned-project-directories-244)（#244）。
- **按 PNDS 默认规则整理当前工程、作品行为保留与同任务检查撤回** → [creation-assistant.md](./creation-assistant.md#default-project-organization-252)（#252）。
- **整理时补充文字／工程文档／私有资料规范、真实读取与逐题冲突接续** → [creation-assistant.md](./creation-assistant.md#supplemental-organization-rules-253)（#253）。
- **编辑任务采用私有源码、入口接线、原件保留与冲突保护** → [creation-assistant.md](./creation-assistant.md#adopt-private-source-into-an-edit-task-250)（#250）。
- **创作助手请求编排、装机来源、取消归属与阅读布局** → [creation-assistant.md](./creation-assistant.md)（#166）。
- **创作助手检查证据、失效／复用与 V1 恢复接线** → [creation-assistant.md](./creation-assistant.md#assistant-check-policy)。
- **Work 自动编译、固定 Node 测试与分阶段交付证据** → [creation-assistant.md](./creation-assistant.md#work-builds-tests-and-delivery-evidence)；真实编译与离线声音验收见 [记录](../acceptance/assistant-native-build-and-nrt.md)。
- **创作助手实际阅读正文、完整覆盖、包内引用与 V1 恢复** → [creation-assistant.md](./creation-assistant.md#actual-reading-evidence)。
- **私有文本资料的按需读取、真实范围来源、历史与接续失效** → [creation-assistant.md](./creation-assistant.md#private-text-material-reading-241--249)（#241 / #249）。
- **随工程目录携带的聊天历史、旧本机迁移、副本隔离与旧授权不恢复** → [creation-assistant.md](./creation-assistant.md#private-project-history-167)（#167）。
- **帮助语料装载、运行时渲染与离线搜索** → [help-center.md](./help-center.md)
- **演出文件夹导入导出：set.json 格式与导出/导入缝** → [setlist.md](./setlist.md)

## 质量与工具

- **check:all 里每个工具的分工** → [static-analysis.md](./static-analysis.md)
- **怎么写 ast-grep 规则** → [writing-ast-grep-rules.md](./writing-ast-grep-rules.md)
- **测试模式与 Tauri mock** → [testing.md](./testing.md)
- **跨空闲／创作／池客的真实公共监听器、端口复用与故障状态（#297）** → [stable-performance-entry.md](./stable-performance-entry.md)
- **本机 Node fixture 的端口 lease、就绪诊断与清理归属** → [testing.md](./testing.md#local-node-integration-fixtures)
- **前端体积管理** → [bundle-optimization.md](./bundle-optimization.md)
- **Rust / TS 日志** → [logging.md](./logging.md)
- **本目录文档的写法与更新规则** → [writing-docs.md](./writing-docs.md)

## 发布

- **发布流程、签名、自动更新与内置工具拉取** → [releases.md](./releases.md)
- **Sensor Meter 手势线程隔离、加载状态与实际发行资源** → [sensor-meter.md](./sensor-meter.md)

工程保存版默认读取、显式选区附件、请求内概况及整工程发送（#168 / #225 / #169 / #170）
的状态、路径、预算与来源规则见 [creation-assistant.md](./creation-assistant.md#authorized-saved-project-reading-168)。
