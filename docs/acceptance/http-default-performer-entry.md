# 普通工程默认 HTTP，HTTPS 按作品需求启用

2026-10-14。用户发现 III 扫码地址采用 HTTPS 后，明确要求普通工程默认 HTTP，只有使用需要安全上下文的手机传感器等功能的工程才使用 HTTPS。此次修正属于 1.6.2 隔离工作树；不修改原 1.6.1、DNS 实现、系统服务或正式发布 registry，不提交或创建 release。

## 规则与实现

App 的 `resolve_entry_launch` 在读取域名、端口或证书前检查全局开关、`needsHttps: true` 和 `supportsPerformerUrl: true`。`supportsPerformerUrl` 只声明读取完整 URL 的兼容能力；缺省、false、null 或非布尔的 `needsHttps` 均保持 HTTP，普通工程不会因全局 HTTPS 配置失效而启动失败，也不会请求演出 DNS 映射。开关关闭、需要但未适配的工程仍保留现有 HTTP／显式兼容选择；需要且已适配、开关打开但配置无效时明确失败。

Node 启动前清除父进程继承的 `PNDS_PERFORMER_URL`，再应用本次 Host 决定的环境。QR、复制地址、页面配置与同源 Socket.IO 消费该同一网址；QR 模块和作品不自行选择协议。

双语 manifest／runtime／HTTPS／DNS／网络／QR 手册、创作指南、开发行为文档与新工程生成的 agent／handoff 指引已同步。Template 的四份创作指引要求先检查实际浏览器 API，手机、扫码、普通触摸本身不构成 HTTPS 需求，再记录声明依据和实际地址。

Mobile Sensor Meter 声明 `needsHttps: true`，版本更新为 0.4.1；manifest、npm 元数据与双语包说明一致。候选包位于 `.cache/v1.6.2-candidates/mobile-sensor-meter-v0.4.1.pnds`，开发工作树的内置工具已同步此本地候选。正式 utility registry 仍使用已发布固定产物；运行 `utilities:fetch`／发行构建会恢复 registry 对应版本，此本地暂存不视为正式发行接入。

III 1.4.0 与 Template 0.7.0 不声明 HTTPS 需求，已有工程包不变；新版 App 启动它们时使用 HTTP。原谱面、音频、传感器／模型处理和权限政策未改。

## 验证

- 红→绿：有效证书、全局开启、完整 URL 能力已声明但无 HTTPS 需求，旧代码错误启动入口，新代码保持 HTTP。
- 58 项 session 与两项 manifest 回归通过；矩阵覆盖缺省/null/false/字符串/数字/对象需求声明及有效/缺失/非法/错域名证书配置，普通工程均不激活入口或演出映射。既有 HTTPS fixture 显式声明需要，真实网关与生命周期回归继续覆盖原路径。
- 最终 App `npm run check:all` 全绿（exit 0）：前端 134 文件／1544 项、App Rust 387 项、DNS 39 项，原五项受控验收保持显式忽略。
- Mobile 159 项回归与检查通过；0.4.1 实际 App 安装、重打包、再次安装通过，每个源码与模型文件哈希保持一致，不含本地依赖。其余四个候选包哈希未变。
- Template 合流后检查及 161 项回归通过；Standards／Spec 双轴审查均无遗留问题。
- 三个无本地依赖的真实 Node 工程，用系统 Vision 解码实际 `/qr` PNG：III 和 Template 为 HTTP，Sensor 为 Host 注入的完整 HTTPS URL；对应 `__config.js` 地址完全一致。HTTPS 的 QR 编码验证使用受控 URL，不代表手机可信证书或 DNS 可达。

证据位于 `.cache/v1.6.2-evidence/http-policy-*`；回归、源码合流、安装、真实 QR JSON 与完整检查输出均保留。继承环境清除按 Node 实际命令接线核查，未为此引入全局 setenv 测试或新的生产抽象；完整 `SessionManager.start` 的父环境继承未新增独立端到端验收。用户仍从 `PNDS-App-v1.6.2` 启动 dev、重新载入工程，验证原生扫码行为。
