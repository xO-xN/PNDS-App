# 开发文档

App 开发的规则层：既定模式与系统做法，按问题检索——查什么 → 读哪个文件。平台契约（工程格式 / 运行协议 / `.pnds`）的索引在 [`docs/zh-CN/reference/README.md`](../zh-CN/reference/README.md)；**App 产品行为与验收 → [app-behavior.md](./app-behavior.md)**。

## 已批准的版本规格

**已批准版本安排（2026-10-15）** → [v1.6.0–v1.7.0 更新规划](../plans/releases-through-v1.7.0.md)，原决定过程见[逐轮讨论](../plans/pre-v1.7-release-grilling.md)，最新完整创作范围见[本轮决定](../plans/post-v1.7-creation-experience.md)。v1.6.0–v1.6.5 分别承接创作基础、模块与 Skills、共享库、起点与只读 Git、静态诊断及受控检查；前序全部验收后正式开发 v1.7.0。1.7.0 包括对话主入口、讨论内调参／直接编辑代码／按工程能力预演、基础编辑器、显式片段、交接基线与比较、App 自供本地 Git 和历史载入草稿。总体规格 [#190](https://github.com/xO-xN/PNDS-App/issues/190) 与 [70 票实施拆分与依赖](../plans/pre-v1.7-ticket-breakdown.md)为领取入口；#224–#230 承接完整工作流，新增 [#231](https://github.com/xO-xN/PNDS-App/issues/231) 提供参数绑定与临时预演基础，由 #208 接入建议卡。任务状态与实际验收分别核对，不据规格发布宣称功能完成。

- **v1.6.0 演出与创作模式的工作流、文件操作及测试窗口** → [正式规格](../plans/v1.6.0-creation-mode-spec.md)
- **v1.6.1 标准技术模块整理与外部 PNDS Skills 重构** → [正式规格](../plans/v1.6.1-modules-skills-spec.md)
- **v1.6.2 单一较新共享库与三作品发行兼容** → [正式规格](../plans/v1.6.2-shared-libraries-spec.md)
- **v1.6.3 多模板、只读 Git 与上下选卡** → [正式规格](../plans/v1.6.3-creation-workflow-spec.md)
- **v1.6.4 静态工程诊断与 CLI** → [正式规格](../plans/v1.6.4-static-diagnostics-spec.md)
- **v1.6.5 临时副本检查、版本证据与单文件撤销** → [正式规格](../plans/v1.6.5-controlled-checks-spec.md)
- **v1.7.0 完整创作流程、模型服务、编辑器、交接比较与本地版本** → [正式规格](../plans/v1.7.0-creation-assistant-spec.md)
- **v1.6.0 跨票回归与真实环境验收** → [#164 验收记录](../acceptance/164-v1.6.0-workflows.md)
- **v1.7.0 讨论内调参、代码编辑、预演与完整创作流程验收** → [#172 待实施验收要求](../acceptance/172-v1.7.0-creation-workflows.md)
- **v1.7.0 八组调试的依赖、操作步骤、通过标准与阶段交付** → [阶段性调试计划](../plans/v1.7.0-staged-debugging-plan.md)
- **r6-final 真实 App 的入口映射、实施及验收状态** → [desktop-1.6-implementation.md](./desktop-1.6-implementation.md)
- **UI 定稿和逐轮交互记录** → [原型说明](../prototypes/README.md)

2026-10-15 后续追加：[模型容量、上下文用量、长对话与文档读取优化](../plans/v1.7.0-context-management-spec.md)由 #232～#235 承担，基础排在 #168 前。本轮 #165～#167 范围不扩展。#232～#235 的实现、受控前后比较与待用户实机项目见[验收记录](../acceptance/232-235-context-management.md)；不据自动化宣称原生验收完成。

以上规格记录已确认、尚待实现的行为；实现时同步更新下方对应规则篇。v1.6.0 交付首批五项模块文件添加与接线交接，v1.6.1 整理模块及外部 Skills；App 助手不安装 Skills 或实施移植。

## 架构与状态

- **App 的心智模型、分层与系统总览** → [architecture-guide.md](./architecture-guide.md)
- **Rust 侧模块组织与约定** → [rust-architecture.md](./rust-architecture.md)
- **useState / Zustand / 持久化怎么选，selector 语法与 getState** → [state-management.md](./state-management.md)
- **两窗口快照恢复、请求交错与卸载清理** → [state-management.md](./state-management.md#session-snapshot-mirrors)
- **工程预检归属、迟到结果与配置准备** → [state-management.md](./state-management.md#project-preflight-ownership)
- **离线标准模块、旧版来源保护与外部 Skills 分发** → [standard-modules.md](./standard-modules.md)
- **固定共享库、工程采用与离线加载边界** → [shared-libraries.md](./shared-libraries.md)
- **Blank／Classic 固定创建来源、独立身份与取消／失败保护** → [creation-workspace.md](./creation-workspace.md#fixed-classic-source-and-initialization-200)
- **自供本地 Git、初始版本、完整文件记录与历史载入草稿** → [local-git.md](./local-git.md)（#228–#230）。
- **工程范围内只读 Git 状态、分层差异与过期快照** → [creation-workspace.md](./creation-workspace.md#read-only-git-inspection-201)
- **创作阅读、可信工程身份、文件限制与异步切换** → [creation-workspace.md](./creation-workspace.md)
- **无副作用的 App Doctor、共用报告与离线 CLI** → [static-diagnostics.md](./static-diagnostics.md)（#193 / #203 / #204）。
- **临时副本检查、跨 App／CLI 运行归属、输入证据与取消清理** → [controlled-checks.md](./controlled-checks.md)（#194）。
- **已有单文本差异、审阅保存与版本保护撤销** → [single-file-changes.md](./single-file-changes.md)（#207）。
- **工程字面值绑定、受限临时预演协议与恢复** → [parameter-preview.md](./parameter-preview.md)（#231）。
- **确认交接、保存版基线、部分失败恢复与交接后只读比较** → [handoff-baselines.md](./handoff-baselines.md)（#171 / #226 / #227）。
- **创作草稿、手动保存、重命名与磁盘版本冲突** → [creation-workspace.md](./creation-workspace.md#manual-save-rename-and-disk-conflicts-154)
- **错误如何传播、用户反馈与重试模式** → [error-handling.md](./error-handling.md)

## 命令与系统桥

- **新增 / 使用类型安全的 Tauri command（tauri-specta 工作流）** → [tauri-commands.md](./tauri-commands.md)
- **原生菜单构建与 i18n** → [menus.md](./menus.md)
- **全局快捷键、修饰键与确认流** → [keyboard-shortcuts.md](./keyboard-shortcuts.md)
- **Tauri 插件的使用与配置** → [tauri-plugins.md](./tauri-plugins.md)

## UI 与文案

- **CSS 架构、颜色 token、shadcn/ui 用法** → [ui-patterns.md](./ui-patterns.md)
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
- **创作助手请求编排、装机来源、取消归属与阅读布局** → [creation-assistant.md](./creation-assistant.md)（#166）。
- **本机聊天历史、工程隔离、原子保存与旧授权不恢复** → [creation-assistant.md](./creation-assistant.md#private-project-history-167)（#167）。
- **帮助语料装载、运行时渲染与离线搜索** → [help-center.md](./help-center.md)
- **演出文件夹导入导出：set.json 格式与导出/导入缝** → [setlist.md](./setlist.md)

## 质量与工具

- **check:all 里每个工具的分工** → [static-analysis.md](./static-analysis.md)
- **怎么写 ast-grep 规则** → [writing-ast-grep-rules.md](./writing-ast-grep-rules.md)
- **测试模式与 Tauri mock** → [testing.md](./testing.md)
- **前端体积管理** → [bundle-optimization.md](./bundle-optimization.md)
- **Rust / TS 日志** → [logging.md](./logging.md)
- **本目录文档的写法与更新规则** → [writing-docs.md](./writing-docs.md)

## 发布

- **发布流程、签名、自动更新与内置工具拉取** → [releases.md](./releases.md)

工程只读授权、显式选区附件、可展开概况及整工程范围确认（#168 / #225 / #169 / #170）
的状态、路径、预算与来源规则见 [creation-assistant.md](./creation-assistant.md#authorized-saved-project-reading-168)。
