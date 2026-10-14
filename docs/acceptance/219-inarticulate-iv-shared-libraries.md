# #219 · Inarticulate IV 0.2.0 适配记录

2026-10-14。适配代码与受控工程包检查通过；原生 App、手机、投影与实际 Max/Ableton 声音仍待用户回报。#219 不据自动结果关闭。未启动 App 开发服务器、修改 Max patch 或发布产物。

## 实际输入

- App：`/Users/xiaoxiang/Coding/PNDS app 开发/PNDS-App-v1.6.2`，版本 1.6.2，分支 `codex/v1.6.2-shared-libraries`；已有共享库工作树仍有未提交更改，本票不把它们一起 commit。
- 工程：`/Users/xiaoxiang/Coding/PNDS app 开发/PNDS-1.6.2-projects/inarticulate-iv`，分支 `codex/issue-219-shared-libraries`。基线为源仓库 `2fdc2ad865f22b4be3a212690da36f15cb5ce26c` 及当时未提交的样式／模块／交接文件快照。采用候选后版本 0.2.0，schema 2。
- 本票工程 commit：`62cbb7a`（本地，未推送）。原有样式／模块／交接文件仍保持未提交，不包含在该 commit；候选包的 inventory 记录实际工作树资产哈希。
- 确切引用：p5 2.3.4、Express 5.3.0、qrcode 1.5.4、Socket.IO 4.8.4。使用本 App 的固定 catalog；维护 Socket.IO client 为 4.8.4。未引入 ml5、osc-min 或本地声音引擎。
- macOS arm64、Node 24.19.0、Chromium 149.0.7827.102。Max/Ableton 和真实声音设备没有被本次运行启动，相关版本／环境仍待用户填写。
- 原 `inarticulate-iv` 源目录的 60 项基线文件保持 SHA-256 一致。隔离副本中三张符号、完整 `sources/original/`（含 Max patch／模型／采样等）、原音乐／relay／monitor／mini-score／样式／模块保持原字节。用户的 Ableton 工程未访问或改写。

## 适配与隔离试验

未改源工程的 p5 2 试验实际建立 Canvas，但旧 `preload()` 未执行，图片数组为空。改用异步 `setup()` 等待三张符号，再建立控制连接与绘制；图片失败显示可读提示，恢复文件后刷新恢复。

新旧 p5 真实截图还发现浅灰背景变白：原裸 Canvas save/restore 绕过 p5 2 样式缓存。用 p5 `push/pop` 配对整个裁剪帧后，原背景 `[242,242,242,255]` 恢复。颜色值、坐标与时间公式不改；开发模式见 [p5 画布状态](../developer/p5-canvas-state.md)。失败基线保存在 `iv-p5-red.log` 和 `iv-color-red.log`。

Express 5 监听回调检查错误，失败非零退出且释放另一已启动端口。两个 HTTP 入口只提供已声明的 p5／Socket.IO 同源单文件，Host 映射缺项／错版／类型或路径错误明确失败，不回退本地库。standalone 仍可使用自己的确切 npm lock。

服务端注入 monitor/performer 角色，避免外部 HTTPS 端口误判；完整 `PNDS_PERFORMER_URL` 供 QR、日志和配置使用。manifest 仍为 6868/6869，M4L 仍连 localhost:6868，原四事件、走带、sync 相位、触点与 dataset 不变。External/None 两种模式与声音所有权保持。

## 自动与受控证据

- IV `npm run check` 与 `PNDS_TEST_PORT_BASE=49330 npm test` 全绿，44 项通过（Node 的发现统计包含一个 helper 文件）。覆盖无本地依赖、有限同源路由、Host 精确映射／禁止回退、standalone 版本、占用端口与原事件／曲线／join 同步。
- App `npm run check:all` 全绿，exit 0：前端 134 个文件／1544 项，App Rust 385 项，DNS 39 项。五项原有显式忽略保留；本次候选包验收另行显式运行，没有把忽略测试当作默认通过。
- 真实 Chromium 在无 `node_modules` 临时工程中使用 App 资源，随机 localhost 端口，阻断所有公网并通过实际失败探针核对；External/None 都通过三符号实际绘制、100s 暂停画面、seek／resume、monitor 与 performer 刷新精确恢复、离线后重入跟上200s、触点协议、server 重启与正常关停／端口重绑。Canvas 哈希覆盖圆角背景内的谱面，避开原透明边缘抗锯齿累积；首帧完成后再比较。
- 缺符号图片时，真实页面显示错误且没有活动 p5 Canvas；恢复路径后刷新成功，无未捕获页面异常。
- App 的实际安装入口安装候选 `.pnds` 后，用工程 browser 脚本在安装字节上重复上述检查，再执行 App 重打包／第二次安装。52 项源码／资产 SHA-256 保持一致，安装目录均无本地 `node_modules`。所有库从本机取得，原包不改。

日志位于 `.cache/v1.6.2-evidence/iv-*`，包括 `iv-check-all.log`、`iv-project-tests.log`、`iv-browser.json`、`iv-installed-browser.log`、原源目录基线 `iv-source-baseline.json`。安装后复验沿用 [共享库开发说明](../developer/shared-libraries.md) 的 `PNDS_CANDIDATES_DIR`、`PNDS_CANDIDATE_BROWSER_SCRIPT`、Playwright 与 Chromium 显式参数。

## 双轴审查

以用户确认的 `2fdc2ad` 为基点，审查本票暂存的修改，排除复制来的既有样式／模块／交接文件。

- Standards：0 项硬性违规，1 项低优先级设计判断（测试 fixture 与独立 browser 脚本各自构造 catalog→Host map）。保留两套验证输入来源：fixture 固定预期版本，真实 browser 根据实际被安装 manifest 取引用；该维护脚本重复不影响运行契约，不属阻塞问题。
- Spec：0 项可修改代码问题，1 项必要人工证据缺口（原生、实体设备、Max/Ableton 实际声音及设备环境）。本记录及 issue 状态明确保留待验收，不冻结候选。

## 候选包

路径：`.cache/v1.6.2-candidates/iv/inarticulate-iv-v0.2.0.pnds`。当前包 **419,732 字节**，SHA-256 为 `2ac42fafab5e1a2c7f8e8ea0157d9903195a25ee13f88951188b1c2c67de43e9`。`inventory.json` 记录每个文件的哈希、来源 HEAD／branch、共享引用和 `published:false`；本地脚本不是正式 release。源码或 README 改变后需重建并重验相应产物；以上值以该确切输入为准。

包保留原作品／外部真源环境，只删除活跃 `public/libraries` 旧依赖副本；真源存档不清理。没有声称把 App 共享库或 Max/Ableton 安装环境物化到工程包。

## 待用户实机验收

用户从 `PNDS-App-v1.6.2` 启动 App 开发服务器并导入上述包。检查 installed 工程在断公网、本机／局域网环境下：

1. 原生 WKWebView 指挥台、实体乐手设备与投影冷开出谱；开始 BPM 5 与渐快曲线、三符号／小球、暂停／继续、±5s／段跳、刷新同步和缩放均保持排练行为。
2. 原 Max/Ableton 环境与 node.script 连入 `localhost:6868`；指挥台触点进入原 ML／kNN、采样实际发声，changeNotes 回传符号；dataset 重建与晚开指挥台补发正常。
3. External 实际发声、None 无音频；重启和关停后连接与声音链正确恢复，没有工程残留进程。实际使用可信 HTTPS 时验证手机证书、同源库与 Socket.IO。
4. 记录 macOS／架构、App／工程／库、Max／Ableton、音频设备及每项实测结果。必要验收未完成或失败时保持 #219 开放，不能据 health／HTTP 或本报告视为作品通过。
