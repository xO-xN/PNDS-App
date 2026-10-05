# 开发文档

App 开发的规则层：既定模式与系统做法，按问题检索——查什么 → 读哪个文件。平台契约（工程格式 / 运行协议 / `.pnds`）的索引在 [`docs/zh-CN/reference/README.md`](../zh-CN/reference/README.md)；**App 产品行为与验收 → [app-behavior.md](./app-behavior.md)**。

## 已批准的版本规格

- **v1.6.0 演出与创作模式的工作流、文件操作及测试窗口** → [正式规格](../plans/v1.6.0-creation-mode-spec.md)
- **v1.6.1 标准技术模块整理与外部 PNDS Skills 重构** → [正式规格](../plans/v1.6.1-modules-skills-spec.md)
- **v1.7.0 创作助手的读取、模型服务与交接边界** → [正式规格](../plans/v1.7.0-creation-assistant-spec.md)
- **UI 定稿和逐轮交互记录** → [原型说明](../prototypes/README.md)

以上规格记录已确认、尚待实现的行为；实现时同步更新下方对应规则篇。v1.6.0 交付首批五项模块文件添加与接线交接，v1.6.1 整理模块及外部 Skills；App 助手不安装 Skills 或实施移植。

## 架构与状态

- **App 的心智模型、分层与系统总览** → [architecture-guide.md](./architecture-guide.md)
- **Rust 侧模块组织与约定** → [rust-architecture.md](./rust-architecture.md)
- **useState / Zustand / 持久化怎么选，selector 语法与 getState** → [state-management.md](./state-management.md)
- **两窗口快照恢复、请求交错与卸载清理** → [state-management.md](./state-management.md#session-snapshot-mirrors)
- **工程预检归属、迟到结果与配置准备** → [state-management.md](./state-management.md#project-preflight-ownership)
- **错误如何传播、用户反馈与重试模式** → [error-handling.md](./error-handling.md)

## 命令与系统桥

- **新增 / 使用类型安全的 Tauri command（tauri-specta 工作流）** → [tauri-commands.md](./tauri-commands.md)
- **原生菜单构建与 i18n** → [menus.md](./menus.md)
- **全局快捷键、修饰键与确认流** → [keyboard-shortcuts.md](./keyboard-shortcuts.md)
- **Tauri 插件的使用与配置** → [tauri-plugins.md](./tauri-plugins.md)

## UI 与文案

- **CSS 架构、颜色 token、shadcn/ui 用法** → [ui-patterns.md](./ui-patterns.md)
- **封面标题拟合的测量、揭示与清理** → [ui-patterns.md](./ui-patterns.md#cover-title-fitting)
- **翻译系统、语言切换、RTL 支持** → [i18n-patterns.md](./i18n-patterns.md)
- **toast 与原生通知** → [notifications.md](./notifications.md)

## 数据与外部交互

- **文件存储模式与原子写入** → [data-persistence.md](./data-persistence.md)
- **偏好保存结果、失败日志与队列续行** → [data-persistence.md](./data-persistence.md#save-outcomes)
- **可信 HTTPS 证书材料：校验管线、受保护存储与设置区接线（#139）** → [https-material.md](./https-material.md)
- **HTTPS 准备操作时序、异常收尾与域名保存后的摘要重验** → [https-material.md](./https-material.md#前端准备流程)
- **可信 HTTPS 入口网关：hyper/rustls 转发、生命周期接线与探测（#140）** → [https-gateway.md](./https-gateway.md)
- **HTTP 请求与外部 API 调用** → [external-apis.md](./external-apis.md)
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
