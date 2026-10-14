# #218 · Inarticulate III 1.4.0 适配记录

2026-10-14。用户授权完成 III 工程适配，不创建 commit 或 release；DNS 由另一 agent 处理。初次记录保留原生与设备验收待办；用户随后明确回报「我已实机测试没问题」，并授权按流程复核后关闭 #218。本次收尾以该用户验收和确切工程包的自动验证共同判断，不以浏览器或 HTTP 成功代替实机反馈。

## 实际输入与工作目录

- App：`PNDS-App-v1.6.2` 工作树，版本 1.6.2，分支 `codex/v1.6.2-shared-libraries`。
- 工程：`PNDS-1.6.2-projects/Inarticulate III` 工作树，基于 `0755541e8b8f6e8a8a94c9f7a2831ed65cc99bea` 与原有未提交 `creator-handoff.md`／`modules` 快照；工程版本 1.4.0，schema 2。
- 精确共享引用：p5 2.3.4、Express 5.3.0、qrcode 1.5.4、Socket.IO 4.8.4、osc-min 2.1.2。资源来自本 App 固定 catalog，不在运行时下载或安装 npm。
- 原 `Inarticulate III` 源工作树未修改，保持 1.3.0 供原 1.6.1 测试。三张谱面、SynthDef、SC 源码／debug bridge、`audio/controller.js`、未接入的 `modules/pnds-qr` 与基线字节相同。

## 适配与自动证据

旧页面在实际 p5 2 Chromium 中未加载三张图片并报 `p1c is not defined`；改为异步 `setup()` 并行加载后，三个乐手各自原曲线均进入实际 Canvas 绘制。失败时显示错误，建立控制连接前停止；恢复图片后刷新可恢复。

服务端显式注入页面角色，完整 `PNDS_PERFORMER_URL` 供配置、QR 和日志使用；演奏页 Socket.IO 使用页面同源，HTTPS 入口能升级为 WSS。Monitor／venue 保留本地连接和原只读政策。未改作品触点、音高、幅度、连线、帧节流、声音映射或音频输出 bus 规则。

Node 回归 40 项通过，覆盖无本地依赖、Host 精确映射／拒绝本地回退、有限资源文件路由、standalone 确切版本、Express 5 监听失败与释放、身份接管／恢复、实时客户端关停与 OSC 2 的 DataView／UDP 字节。`npm run check` 和 `npm test` 均通过；维护依赖只在源码工作树中。

工程 `scripts/verify-shared-browser.mjs` 使用真实 Chromium、800×600 触控视口、随机 loopback 端口、无 `node_modules` 的临时工程与实际 App 共享资源，外网请求被阻断并用失败探针验证：

- 三个实际谱面各自绘制；两个 CDP 触点生成原中心坐标与距离幅度，监控端收到实际 Socket.IO 数据。
- 刷新、网络断线重连保留 player ID／claim token；服务正常关停后重启、重新加载页面恢复身份与触点控制。
- None 无 UDP；External 从真实浏览器输入经 Socket.IO 和作品 controller 生成独立 OSC 1.0 golden `/p1`、`/p1xy` 字节。
- 自签名 localhost HTTPS 验证完整地址与同源 WSS。该证书在测试浏览器中显式忽略信任错误，不代表 DNS、可信证书或手机通过。
- 图片加载失败可见、控制通道未建立；重新加载恢复，无未捕获浏览器异常。

候选包在 `.cache/v1.6.2-candidates/iii/`；`inventory.json` 记录每个文件与包 SHA-256、来源及 `uncommitted:true`／`published:false`。App 的实际安装流程安装此 `.pnds` 后，显式启用项目浏览器脚本，运行上述真实页面测试，再由 App 重新打包、再次安装；两次安装的全部源码／资产 SHA-256 保持一致，均无 `node_modules`。日志为 `.cache/v1.6.2-evidence/iii-installed-browser.log`，可用 developer 文档说明的显式忽略测试复验。

最终包在 macOS arm64、Node 24.19.0、Chromium 149.0.7827.102 中完成上述安装后浏览器复验；重复构建得到相同包 SHA-256。

App 最终 `npm run check:all` 全绿（exit 0）：前端 134 个文件／1544 项、App Rust 385 项、DNS 39 项通过，Rust 五项显式忽略保留原受控验收边界。输出保存在 `.cache/v1.6.2-evidence/iii-check-all.log`；最终工程检查日志、40 项回归、运行时报告及浏览器绘制截图也保存于该 evidence 目录。Standards 审查的交接文档位置与重复语法检查两项已修复，Spec 无可执行代码缺陷。

## 用户验收与关闭复核

用户从 `PNDS-App-v1.6.2` 启动开发 App，导入上述 1.4.0 包。旧 1.6.1 App 不支持 schema 2。

用户直接确认本作品实机测试无问题。本记录保留该总体结果，不补写未提供的手机型号、声卡型号、声音模式逐步操作或证书细节；自动环境记录为 macOS arm64、Node 24.19.0、Chromium 149.0.7827.102。实机反馈由用户给出，受控浏览器、OSC 与安装证据只证明各自覆盖的边界。

后续 HTTP 规则修正已生效：III 1.4.0 不声明 `needsHttps: true`，即使全局 HTTPS 开关打开也使用普通 HTTP 入口；`supportsPerformerUrl` 仅保留完整网址兼容能力。实际 QR PNG 经系统 Vision 解码为 HTTP，与 `__config.js` 同一地址。可信 HTTPS／DNS 不再是本作品的正常入口条件；传感器作品和父票 #191 的整体发行验收另行处理。详见 [入口规则与验证](http-default-performer-entry.md)。

关闭前复核沿用公开工程检查、实际安装和 Chromium 流程，日志为 `.cache/v1.6.2-evidence/iii-close-*`；包仍为 1.4.0，共 336,446 字节，SHA-256 为 `337ddc64cca3e59df09ee23f44bc9988b1ab5d7f5557a26c54c3b530bfc105c9`。包内 35 个源码／资产文件与当前工程一致，三张谱面、声音源码与 SynthDef 和原基线字节相同。既有未接入的 `modules/pnds-qr` 属于保留的创作交接任务，不是本次兼容票的新增要求。

本轮最终复核全部通过：工程检查与 40 项测试、安装后的真实 Chromium／控制流、App 重打包与再次安装通过；`check:all` 全绿（前端 134 文件／1544 项、App Rust 387 项、DNS 39 项，原五项显式忽略保持不变）。Standards 与 Spec 双轴审查均为 0 项问题。

本轮不启动用户 dev server 或音频设备，不改 DNS 服务，不提交、打 tag 或创建 release。依据用户实机验收和本轮复核，由 GitHub 关闭操作记录 #218 的最终状态；父票 #191 和其它作品不随之关闭。

GitHub 已确认 [#218](https://github.com/xO-xN/PNDS-App/issues/218) 为 CLOSED，六项验收已勾选；[复核与用户验收记录](https://github.com/xO-xN/PNDS-App/issues/218#issuecomment-6161047613) 已发布。关闭时间为 2026-10-14 04:41:15 UTC。
