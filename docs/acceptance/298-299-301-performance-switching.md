# #298／#299／#301：保留原文档并明确切换演出

本轮仅实施这三张票，基于已完成的 #295／#300。父 #294 的维护工程适配、
保存入口、网络 QR 整合与跨平台发行验收仍由其他子票承接。集成分支为
`codex/issues-298-299-301`；本轮保留启动时 staged、unstaged 和 untracked
输入，以工作区快照核对增量，不创建业务提交或 PR。

## 行为与归属

浏览器公开根入口持续持有页面，自动检查同一池主的当前候选。正常演奏时只显示
工程；新候选在轻量提示中提供操作，发现候选不加载其资源或加入演出。
失联、Stop、无效元数据及换工程都保留已打开的真实 Document。新的进入动作
绑定当时显示的池主、工程与演出，不将 B 的点击用于后来的 C。

切换期间保留原实例，候选页面报告必需资源与初始化已准备，并再次核对身份后才
交接。失败、取消与过期结果只收尾所属候选，允许继续使用旧页和重试。成功后
交接输入并清理旧文档及其自有资源。页面准备、页面打开和工程接纳分别表达；
没有工程接纳反馈时仍报告接纳未知。浏览器规则见
[browser-participation.md](../developer/browser-participation.md)，原生私有来源、
持久存储及显式刷新规则见
[native-client-continuity.md](../developer/native-client-continuity.md)。

## 自动化证据

真实浏览器测试使用实际 `SessionManager` 启动的受管 Node 和公开入口，通过入口控件操作，核对同一
Document、未保存 token、`performance.timeOrigin` 与推进中的时钟。
元数据故障用例在测试自有 HTTP 边界注入超时、503、无效 JSON、不兼容协议和
另一池主身份，正常流量仍转发实际 Host 的原始页面及资源。

- **普通浏览器六条场景**：实际入口表单贯通 Blank、A→B→A、Stop 后发现及同工程
  重启、五类元数据故障、B→C 候选竞态、资源失败／取消／重试与成功交接。
  正常轮询保留同一个已聚焦按钮。真实 AppKit 按键在准备期间只到 A、交接后只到 B；
  被取消候选的计时器与 Worker 停止，服务端观察两条 Socket.IO 连接断开。旧页无声
  WebAudio render graph 在退休后不再运行，`currentTime` 停止。
- **原生生产事务**：实际 `SessionManager` Host 位于独立 MockRuntime App，Client
  位于 Wry App，执行生产隐藏候选、准备核验、关闭、提升、存储刷新和输入路径。
  资源失败／取消／候选竞态保留原文档；B 准备期间换到新 A，旧点击被拒绝，明确
  进入后同源的两个存储上下文并存成功，读取旧 A 刚写入的 `A-latest`。A→B→A、
  旧私有代理关闭及 Leave 无活动页面均有实际断言，见
  [原生 JSON 证据](./evidence/301-native-entry-2026-11-09.json)。
- **公开边界回归**：原生协调器 22 项聚焦测试、相关前端 66 项测试通过。既有
  `native:client:verify` 通过跨进程、跨代理端口的 localStorage／IndexedDB／cookie
  恢复、私有来源隔离、资源／Worker／polling／WebSocket 及端口占用回归。

可复现命令如下。独立网络／原生夹具顺序执行，完整检查内部保留默认并行度。

```sh
npm run check:all
cargo test --manifest-path src-tauri/Cargo.toml plain_browser_ -- --ignored --nocapture --test-threads=1
npm run native:client:entry:verify
npm run native:client:verify
```

首次六项浏览器矩阵中，候选竞态用例的复合断言未区分文档身份与相邻任务间的计时器
调度。拆开真实 Document／token／timeOrigin 检查，并等待每个 checkpoint 的实际
tick 推进后，未改变产品代码的定向用例通过；其余五项此前已通过。原生前台夹具明确
核验 App 激活、窗口 key／occlusion 和 `document.hidden === false` 后才验证时钟，
没有把可见窗口或直接发送按键当作前台证明，也没有改变生产 WebKit 调度策略。

## 审查与完整检查过程

两轴初审发现 Leave 的非原子归属捕获，以及候选回滚误取消旧页文件选择器。统一修复为
同锁取得退出事务及全部资源、按代次核对迟到结果，并将选择器绑定到具体页面和面板
实例。公开准备／提交／清理 barrier 回归覆盖并发 Leave 和进入、全部真实代理释放与
重入；实际 AppKit `o` 键打开旧 A 的 file input sheet，先复现 B 失败会关闭它，再验证
修复后保留它。原生 JSON 的 `fileSelection` 保存该结果。

首次基线检查在 sandbox 中遇到本机 `listen EPERM`，正常本机权限下前端
3,657 项测试通过。首次 Rust 基线检查与另一 worktree 的真实浏览器测试并行，
导致进程内端口编号 lease 跨进程相撞，四项夹具收到其他工程的响应或端口占用。
停止并行的独立 Cargo 测试进程后，默认并行度下 Rust 基线 960 项通过、0 失败。
后续各真实网络／原生检查顺序执行，`check:all` 内部并行度不变；没有放宽断言
或跳过失败用例。调度规则已补入
[testing.md](../developer/testing.md#local-node-integration-fixtures)。

首次整合完整检查的前端 3,663 项和 App Rust 964 项均通过；其后旧安装 CLI 夹具
因两个 `:0` 探测端口释放后被内核客户端复用，未能启动 Node。确定性新增回归复现
释放的 61966 位于自动池。复用原有内核范围查询，并为 CLI 预留自动池外、进程内不
重复的实际监听器后，分配回归和全部 10 项真实 CLI 集成测试通过。保留原业务断言、
生产 preflight 和默认并行度，不用重放失败取得验收结果。

最终 `npm run check:all` 退出码为 0：前端 313 文件通过、1 跳过，3,663 项测试通过、
2 跳过；App Rust 966 通过、17 项既有显式原生／浏览器测试忽略；安装 CLI 10 项、
诊断 CLI 6 项、DNS daemon 单元 40 项及 restart 2 项全部通过，其余 workspace 和
文档测试通过。类型、lint、ast-grep、Prettier、Rust 格式及 clippy 均通过。
被默认忽略的本轮真实浏览器／原生场景已按上述命令单独执行；原 staging 逐字节保持。

## Standards

最终定向复审为 0 项未解决标准违例、0 项可操作代码味道。唯一初审硬规则发现是
Leave 未原子捕获全部归属，已由同锁退出事务、迟到代次核验及 22 项公开协调器回归
修复。CLI 夹具补充复审为 0 项发现；原有未提交工作未混入本轮审查范围。

## Spec

最终复审为 0 项未解决发现，未发现范围扩张。Leave 事务竞态与文件选择器归属两项
初审 P2 均已修复，真实 sheet 的失败复现与修复结果、同工程重启、同源 store 并存、
候选竞态和 A→B→A 恢复证据均已核对。两轴未解决发现：Standards 0，Spec 0。

## 验收范围

本机真实浏览器与原生夹具证明各自执行到的机制；签名完整 App、最低 macOS、
arm64／x86_64 实机、真实设备媒体采集、声音及双机 LAN 的发行结果仍由
#313／#314 汇集。媒体 API 暴露不作为真实采集或释放证据。没有启动开发服务器，
也没有发布 App、标签或远端工程发行物。
