# #220 · ASBS 2.1.0 与 App 1.6.2

2026-10-14。问题为 [v1.6.2：ASBS 新依赖兼容与工程包验收](https://github.com/xO-xN/PNDS-App/issues/220)。
用户确认在适配目录中手动测试完毕，没有问题。工程包的安装后运行与文件往返
另由下述受控 App／Chromium 流程验证；不补写用户未提供的设备或逐项操作细节。

## 验证输入

- App：`/Users/xiaoxiang/Coding/PNDS app 开发/PNDS-App-v1.6.2`，版本 1.6.2，
  分支 `codex/v1.6.2-shared-libraries`，沿用现有共享资源与公开安装／打包流程。
- 工程：`/Users/xiaoxiang/Coding/PNDS app 开发/PNDS-1.6.2-projects/All-Sentient-Being-Sounds`，
  版本 2.1.0，分支 `codex/v1.6.2-asbs`。基线为
  `a513c6e8b05ed6704f87ba4415f8d60230551397` 加开始时完整的未提交 2.0.1 源快照。
  原 `All-Sentient-Being-Sounds` 源目录保持不变。
- schema 2，确切引用仅为 Express 5.3.0、qrcode 1.5.4、Socket.IO 与 client 4.8.4。
  App catalog 完整性检查通过。未引入 p5、ml5、osc-min、模型或合成器。
- 自动环境：macOS arm64、Node 24.19.0、Chromium 149.0.7827.102；随机 loopback
  端口、实际 App 共享资源、无工程 `node_modules`，浏览器公网请求阻断且有失败探针。
- 音频模式始终为 `none`，health 的 audio target 为 null；声音仍由真人演奏者产生。
  跨场地真实 hub／实体手机环境未获得单独明细，不把本机协议回归写成这些设备的实测。

## 适配与验证结果

在隔离工程中采用引用与新版本，不自动改写原作品。Node 入口验证 Host 的版本、
kind 和绝对文件路径；缺失、错版、畸形输入或缺浏览器入口会在监听前明确失败，
即使存在本地依赖也不回退。standalone 开发通过 npm lock 使用同样确切版本。

预编译 Preact 页面不再嵌入旧 Socket.IO client，而是在 Vite 入口前加载工程同源
`/__pnds/shared/socket.io-client.js`。只服务该文件，不暴露整个 App 资源目录。
Express 5 的监听错误进入统一关停流程，两个端口均成功后才报告 ready。
另补齐未完成 HTTP 请求的关停：失败回归原先超时，加入 `closeAllConnections`
后通过，避免中断连接拖住 App 的 Stop／Restart。

真实 Chromium 在源工程和 App 安装后的工程中验证：

- **684 张 PNG** 全部实际解码，尺寸符合分谱索引，响应 SHA-256 与工程文件相同；
  venue 的 **24 个声部 Canvas** 均实际绘制，A1 演奏页保留谱面及红色读谱光标。
- 指挥认领、开始小节、开始／停止／续播／复位驱动真实 Socket.IO 状态和画面；
  暂停后 Canvas 不继续滚动，重置编号返回演奏者选择器。
- 演奏页刷新与断网重连恢复同一编号／token；monitor 刷新释放指挥权；
  服务正常关停后端口重新绑定，重启恢复页面与身份。无未捕获浏览器异常。
- 程序音频保持 none，无音频引擎接入。谱面、字体、纯业务模块、滚动渲染器、
  score-session 和 venue 源文件与原快照逐字节一致。

用户在本次对话中先确认使用上述适配文件夹，随后明确回复：
“手动测试完毕，没有问题。”该原生 App 总体反馈与受控安装后证据分别记录，
不据此声称用户已提供手机型号、系统版本或跨场地 hub 的专项证明。

## 工程包与复验

可见产物：`PNDS-1.6.2-projects/All.Sentient.Being.Sounds-2.1.0.pnds`。
同字节候选及复现 recipe／inventory 在 App 工作树的
`.cache/v1.6.2-candidates/asbs/`。包由显式运行文件清单生成，标记为本地未发布
候选，保留预编译 `dist/`、字体、全部谱面及工程源码 `lib/`、`shared/`。
不包含维护 `node_modules` 或 App 共享库字节。

- 包大小 **11,126,079 字节**，719 个工程文件。
- SHA-256：`0749367141821947d4e5bb34f67da76c0a20a41c36794d8924731aafcaac18f4`。
- App 真实 `install → installed browser → pack → install` 通过；两次安装中
  每个工程文件 SHA-256 保持一致，共享引用和版本准确，均无 `node_modules`。
  浏览器验证输入来自实际已安装包，不使用另造页面或模拟绘图。
- `inventory.json` 保存文件哈希、来源 HEAD／branch／remote、共享引用和
  `uncommitted: true`／`published: false`。固定 ZIP recipe 可重复构建。

复验复用 App 的显式忽略测试 `local_shared_project_candidates_install_and_repack`，
提供 `PNDS_CANDIDATES_DIR`、`PNDS_CANDIDATE_BROWSER_SCRIPT`、
`PNDS_PLAYWRIGHT_MODULE` 和 `PNDS_BROWSER_EXECUTABLE`；工程脚本入口和边界见
[开发规则](../developer/shared-libraries.md)。不依赖后续 v1.6.5 CLI。

证据目录为 `.cache/v1.6.2-evidence/asbs/`：`project-check.log`、
`project-tests.log`、`project-budget.log`、`runtime-green.log`、
`shutdown-red.log`、`installed-browser.log` 和候选包 JSON。
工程 `npm run check`、`npm test` 和 `npm run check:budget` 全绿，110 项
测试通过；预编译工程 JavaScript 总量为 21,052 gzip 字节（不含同源共享
client 文件，完整运行已另验）。实际 App 共享输入下的本机 hub／指挥／
venue 协议六项回归也通过，日志为 `host-protocol-tests.log`。

App 最终 `npm run check:all` exit 0，前端 134 文件／1544 项、App Rust
387 项和 DNS 39 项通过；五项显式忽略保持原验收边界，安装后浏览器与
候选包往返测试已单独显式执行通过。完整输出为 `check-all.log`。

Standards 审查发现当前交接文档仍残留 Vite 打包 client 与发布包预装
依赖的旧说明，已同步修正 handoff 和 creator guide；Spec 审查无实现
缺陷或范围扩张。复核后 Standards 与 Spec 均为 0 项遗留问题。

本次未启动用户的 App dev server，未 commit、push、打 tag 或创建 release。
作品验收不代替父票 #191／#199 的共享版本冻结和双架构发行验收。

GitHub 已确认 [#220](https://github.com/xO-xN/PNDS-App/issues/220) 为 CLOSED，
六项验收已勾选。仅关闭本作品票，父票和发行冻结保持各自验收边界。
