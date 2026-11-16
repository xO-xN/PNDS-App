# 开发文档

先定位 App 分层与产品行为，再按任务查实现约束。工程与 App 的接口见[参考手册](../zh-CN/reference/README.md)。

## 架构与状态

- App 总览、Rust 模块与状态归属。[架构地图](./architecture-guide.md) · [Rust 架构](./rust-architecture.md) · [状态管理](./state-management.md)
- 会话、窗口、侧栏与交付标准。[App 产品行为](./app-behavior.md)
- 工程运行、受管端口与健康监督。[运行端口](./ports.md) · [运行期健康](./runtime-health.md)
- 偏好保存、原子写入、错误与日志。[持久化](./data-persistence.md) · [错误处理](./error-handling.md) · [日志](./logging.md)

## 创作

- Blank 创建、文件编辑、测试窗口与版本。[创作工作台](./creation-workspace.md) · [本地 Git](./local-git.md) · [GitHub 同步](./github-sync.md) · [GitHub 模板导出](./github-template-export.md)
- 当前工程终端、PTY 字节流与采用门禁。[工程终端](./project-terminal.md)
- 讨论、工作授权、构建与恢复。[创作助手](./creation-assistant.md) · [模型服务](./external-apis.md)
- 工程版本合并、候选编辑与试听。[合并候选](./merge-candidates.md)
- 创作资源、确认交接与保存版比较。[创作资源存储与接入](./pending-documents.md) · [交接基线](./handoff-baselines.md)
- 静态诊断、受控副本、单文件撤销与预演。[静态诊断](./static-diagnostics.md) · [受控检查](./controlled-checks.md) · [单文件变更](./single-file-changes.md) · [参数预演](./parameter-preview.md)
- 默认输入、离线模块与共享依赖。[Blank 输入](./blank-input.md) · [标准模块](./standard-modules.md) · [共享库](./shared-libraries.md)
- 运动、麦克风与摄像头接线。[设备运动](./device-motion.md) · [设备麦克风](./device-microphone.md) · [摄像头 HandPose](./camera-handpose.md)

## 演出

- 池主／池客、公开入口与邀请。[角色](./performance-participation.md) · [稳定入口](./stable-performance-entry.md) · [网络邀请](./network-invitations.md)
- 浏览器接入、原生池客页面与原生媒体。[浏览器参与](./browser-participation.md) · [池客页面接续](./native-client-continuity.md) · [原生媒体](./native-project-media.md)
- 证书、网关与 DNS。[证书材料](./https-material.md) · [HTTPS 网关](./https-gateway.md) · [DNS 服务](./dns-service.md)
- 录制与演出文件夹。[演奏记录](./performance-recording.md) · [Setlist](./setlist.md)
- 内置工具、真实运行资源与浏览器接入。[工具入口](./utility-browser-participation.md) · [Telematic Diagnostics](./telematic-diagnostics.md) · [Sensor Meter](./sensor-meter.md)

## 界面与系统桥

- 命令、插件、原生菜单和快捷键。[Tauri 命令](./tauri-commands.md) · [插件](./tauri-plugins.md) · [菜单](./menus.md) · [快捷键](./keyboard-shortcuts.md)
- 界面、双语与 RTL、提示、画布与原型。[UI 模式](./ui-patterns.md) · [本地化](./i18n-patterns.md) · [通知](./notifications.md) · [p5 画布](./p5-canvas-state.md) · [原型](./prototypes.md)
- 装机帮助与文档维护。[帮助中心](./help-center.md) · [文档写法](./writing-docs.md)

## 质量与发布

- 检查、测试、体积与发行。[静态分析](./static-analysis.md) · [ast-grep 规则](./writing-ast-grep-rules.md) · [测试](./testing.md) · [体积优化](./bundle-optimization.md) · [发行](./releases.md)
- 版本范围与验证证据见 [规格](../plans/)及[验收记录](../acceptance/)。
