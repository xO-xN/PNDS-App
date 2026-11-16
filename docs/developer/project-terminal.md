# 工程终端

**#353 采用门禁已通过**：固定 next wrapper 与显式修补 WASM 已采用，#354 的正式工作台接入见下文。采用证据包括真实 arm64 宿主与双架构构建；x86_64 运行、Claude 实际改文件按用户决定暂缓，音频／monitor 和完整产品验收仍归 #357，不能把采用门禁通过当作 beta.5 已交付。

## 接入边界

`src/lib/project-terminal-surface.ts` 在现有主 WKWebView 的 DOM 中建立一个终端 surface，使用固定的 `ghostty-web@0.4.0-next.21.g640db46` wrapper 和 `src/assets/project-terminal/ghostty-vt.wasm` 的显式修补资产。没有 Node/Bun 服务、WebSocket、HTTP listener 或新增 WebView。正式工作台仅在当前可编辑工程第一次显式进入终端时动态导入该模块；原生静态验证入口复用相同链路。

每个 surface 继续使用独立 `Ghostty.load(localWasmUrl)` 实例。已发布原始候选的字素历史与页复用缺陷通过固定源码上的局部修补解决；该修补资产已通过长输出、同实例重建和独立实例重建测试。仍保留逐会话 heap 隔离，不把独立实例本身当作内存安全修复。

控制和输出均使用 `@/lib/tauri-bindings` 的类型化原生命令。每次读取取走一个有序的原始字节包，消费即释放原生有限队列容量；前端一次只保留一个未完成读取，按批次让出事件循环。UTF-8 跨包字节直接交给 VT，不逐包有损解码；输出和绘制均不进入 React/Zustand。

PTY 所有权独立于演出 SessionManager。EOF 表示输出流结束，不能替代 shell 或其作业已结束的确认。包中先出现 shell 退出码时立即报告退出，仍继续消费其受管作业的后续字节，直到 EOF 或显式结束；退出码不撤销 session 所有权。EOF 尚无退出码时，surface 停止字节读取，每 100 ms 经 `getProjectTerminal` 核对同一会话的最终退出状态；释放或成功结束后停止查询。输出和绘制继续留在 VT，状态回调只发布生命周期。

surface 的 `dispose()` 只释放显示与订阅；`close()` 等待原生命令确认清理成功。原生 session 即使已观察到 leader 退出，也仍保留未回收的 Child，直到实际受管作业清理完成。失败保留真实错误和可查询会话，不能先把 UI 报为已结束。

终端使用 App data 下独立的 `project-terminal.json` 原子持久化所有权，不读写演出的 `session-children.json`。打开成功前记录 leader 的 PID 与微秒启动身份，清理发信号前按实际变化更新已核实作业的 PID／启动身份。没有空闲时的磁盘同步或进程扫描循环。清理覆盖同一 POSIX session 的前后台作业组，每次发信号前重新核对身份与 session；仅在实际作业结束、所持 Child 回收且记录清除成功后撤销保护。

最终 manager 释放时清理仍未确认，会停止本地输出 reader，保留磁盘记录和本进程的端口释放保护。下次 App 启动或终端打开先重试：必须以仍匹配的 leader 或已记录作业身份锚定原 session，不能只凭数字 SID 发信号。若最后一个作业恰在进程枚举与启动身份核对之间退出，会再次确认该 session 已空；只有确认为空才解除旧记录，仍存活且无法核实的成员继续阻断，绝不向未核实 PID 发信号。无可核实锚点而 SID 仍有进程、记录损坏或读写失败时保留记录并阻止新终端，其他演出功能继续启动。突然崩溃若发生在作业身份首次记入之前，leader 又已消失，可能落入这条保守阻断路径；当前未承诺自动清理无法核实的作业，也不自动重启 CLI。

初始登记失败会回滚整个 PTY session；回滚未确认时保留实际 Child 与原始错误，后续打开继续报错，`get`／`close` 仍可用于查询和结束。磁盘仍不可写时无法承诺跨崩溃恢复，不能把内存保护当成已落盘。Child 已回收但记录清除失败时缓存真实退出状态，查询仍返回该退出码，重试结束继续完成记录清理。

Darwin 的 controlling TTY 可以在所有 slave 描述符关闭后仍维持到 session leader 结束。隔离探针中关闭 0／1／2 后 master 非阻塞读取仍为 `EAGAIN`；先 `TIOCNOTTY` 再关闭则在进程仍运行时观察到 EOF。因此 surface 的延迟退出回归使用可控原生命令边界，真实宿主要求最终退出码 7，并如实记录是否实际观察到提前 EOF，不把提前 EOF 当成所有 shell 的必然时序。

## 当前工程工作台（#354）

`ReadingWorkspace` 将终端放在创作助手、版本历史与当前文件的同一区域。首次显式访问才创建 view／加载 wrapper 与 WASM，后续切页保持同一个 Canvas、VT 和 PTY；单调 visit intent 区分新打开请求与候选返回等重新挂载，已结束的终端不会因 hidden view 重挂而悄悄新开 shell，新的显式访问或打开按钮才可创建；展开 monitor、切阅读页与原生窗口隐藏分别停止绘制，字节消费者继续工作。只读工程、演出与合并候选没有实际工程终端入口；合并记录恢复失败时继续阻断，显式恢复确认无候选后才可打开。

`creation-terminal-store.ts` 是当前真实会话的低频控制边界：`showCreationTerminal(identity)` 导航／聚焦，`openCreationTerminal(identity, host)` 绑定正式显示，`endCreationTerminal(identity)` 返回实际清理是否成功。store 只保留 identity、sessionId、phase、exitCode、error 与 `hasSession`，不存输出。`hasSession` 也包括打开中和无法确认的失败 owner；后续离开保护不能用 `phase === running` 代替它。结束会等待未完成的打开，重复结束共享同一操作；失败保留会话与错误，迟到的 EOF／退出仅更新退出事实，不能盖掉结束中或结束失败。只有 native close 成功，或显式结束后的 get 明确确认 owner 已不存在，才释放显示并允许重新打开；查询失败或另一个 session ID 不授权清理该新会话。显示卸载本身不宣称 native owner 已结束。#355 负责离开前的确认与失败保护，不能以本切片已接入工作台宣称完整可发布。

异步打开和生命周期回调核对 request 与 actual identity。打开完成时只把实际 workspace 替换、视图退役作为失效，不能把尚未提交的模式确认或工程准备误当成已离开而提前终止会话。启动失败后查询原生 owner；回滚未确认时保留显式结束路径，查询失败也不假报无会话。错误、EOF、已观察 shell 退出与完整受管作业结束分别表达。终端不存在不会自动安装、调用或重启 Agent。

新会话在加载前从 `theme-variables.css` 的 `--pnds-terminal-*` 读取默认色、光标、选区及标准 16 色快照；四套主题的色值与其他 App palette 一起维护。更改 App 主题不重建当前终端，结束后显式打开的新会话才采用新色板。显式扩展色／RGB 保留。默认正文、选区与 12 个语义彩色槽维持可读对比；保留黑／白作为中性 ANSI 角色，不承诺程序任意指定的 SGR 前背景组合都满足正文对比。

键盘依旧使用 App 原有保留键。surface 的 custom callback 仅让既有菜单／web 的 Cmd 保存、控制台、关闭／退出、缩放等精确 chord 冒泡，避免上游 encoder 的 `stopPropagation` 吞掉 App 回退。Ctrl-C／Ctrl-D、Option 编辑、普通复制粘贴与其余终端输入继续由终端处理；没有吞掉全部 Meta。Canvas 宿主是非编辑 group，唯一输入 textarea 的名称来自当前 locale。尺寸命令一次只有一个未完成调用，拖动中的待发尺寸只保留最新值，释放后不再派发。

CLI 写盘继续通过既有 watcher 更新工程文件和草稿。干净文件采用磁盘文本，脏草稿保留并显示冲突；进程输出／退出不会自动保存、刷新、重启、编译、检查、记录版本或上传，也不会创建 Work journal 或任务完成记录。`CreationTerminal.test.tsx` 通过正式工作台、真实 VT/WASM、原生命令／Canvas／剪贴板系统边界验证上述行为；真实宿主四主题、菜单与 CLI 文件回流见 [#354 工作台验证](../acceptance/v1.7.0-beta.5-terminal-workbench.md)，不能用 jsdom 替代。

## 固定依赖和局部修补

这是第三方 wrapper，不等于官方稳定 VT ABI 或 Ghostty.app 完整原生组件。实际 npm 发布包、WASM 哈希、源码 gitHead、Ghostty 子模块 SHA 和原始版权许可保存在 `src-tauri/licenses/GHOSTTY-WEB.txt`。安装后运行 `scripts/patch-ghostty-web.mjs`；脚本核对固定 wrapper 版本、原始／已修补 ESM SHA 和显式资产 SHA 后应用可审阅的少量兼容修改，遇到未知字节直接失败。npm 原版 WASM 不被覆盖；源码补丁、构建工具链、字节一致的未修改对照构建和复现步骤见 `vendor/ghostty-web/`。

- 底层页回收保留实际 backing capacity，并在 WASM ReleaseSmall 的两条页初始化路径清零复用内存，避免字素输出持续增长和 resize 后卡死。改动保持 VT API、终端状态、历史裁剪及 renderer，不插入清空历史指令。
- 新增公开 `Terminal.setVisible`，隐藏时取消无条件 rAF，并阻止输入回显的直接绘制，继续消费 VT 输出；恢复时完整重绘。没有运行期修改私有字段或替换全局 rAF。隐藏不保证完全没有短期输入/滚动动画绘制。
- 初始化色值用 ABI 高位标记区分“显式纯黑”和零值“未指定”，WASM 原有 RGB 掩码保留准确的黑色。默认色、ANSI 黑及显式 RGB 黑均用真实 WASM 测试。
- 必须显式传入本地 WASM URL，移除发布 ESM 的默认内嵌 data URI，避免严格 CSP 冲突和重复二进制。生产 CSP 只新增 `'wasm-unsafe-eval'`，没有放宽普通 `'unsafe-eval'`。
- 选区复制跳过宽字符的占位 cell，保留完整 CJK 与组合字素。文本 paste 统一经过公开 `paste()`，保留 bracketed paste。

该固定 wrapper 的自定义按键回调以 `true` 表示“已处理”；与一些终端 API 的习惯相反。普通按键必须返回 `false`，复制已选文字才返回 `true`。每次 surface 使用可丢弃容器，释放时移除容器，避免上游匿名 DOM 监听留在复用宿主。

## 输入所有权与输入法

Canvas 宿主不可编辑且不进入 Tab 顺序；公开 `focus()`／`blur()` 和选区鼠标动作统一操作同一个已有 textarea。keydown／composition 继续冒泡给 wrapper 的输入处理，textarea 的 beforeinput 及已有去重机制保留。提交组合文本后清空 helper 的旧值，避免把已提交的拼音或文字留给下一次组合。

这修复了真实 WKWebView 中的独立布局故障：原 wrapper 把焦点重新交给 contenteditable 宿主，原生 marked text 会在 Canvas 前留下编辑行，令画布整体下移。不能仅凭终端接收到的字节正确就判断输入法可用。

helper 的候选矩形在 focus、keydown 和 compositionstart 时按公开 VT cursor、renderer 字体指标和 Canvas 相对宿主的位置更新；不在逐帧绘制里读写布局，不改 renderer，也不在运行期访问私有字段。临时原生右键菜单的 helper 定位被保留。组合文字仍由 wrapper 处理，不把候选文本写进宿主 DOM。

固定 patch v2 可以从精确已知的 v1 输出升级，或由原始 npm ESM 应用；两条路径必须产生 `vendor/ghostty-web/provenance.json` 中相同的 ESM SHA，未知中间字节仍拒绝。公开焦点、Canvas 选区焦点、组合只提交一次以及候选矩形的 DOM／真实 VT 回归不能替代物理 macOS 输入法与画布不移位的验收。

## 验证入口

- `node scripts/verify-native-app-shell.mjs --creation-terminal --interactive --build-only`：只构建正式 AppShell／CreationView 的静态验收资源并输出 dist 与源码 provenance，不启动 Cargo、App 或 dev server。实际启动前应协调 macOS 前台与输入占用；省略 build-only 会运行原生宿主，省略 interactive 则自动运行并结束。interactive 从真实 creation prepare／commit 进入临时工程，显式点击 `Run workbench checks` 后写 `pnds-real-app-shell-*/result.json`；Cmd-W／红按钮走 hide 路由，最终 End／Quit 的 cleanup 单独记录。该入口不替代完整 App、物理输入或发布验收。
- `npm run native:terminal:verify`：构建静态本地资源，运行真实 Tauri/WKWebView、类型化 IPC、Rust PTY 的短语料验证，写入独立临时证据目录。沿用生产 CSP，无需启动 dev server。
- `npm run native:terminal:verify -- --interactive`：相同链路保持前台供真实输入法、复制粘贴、已安装 CLI 与 resize 检查。工程是临时 Blank，路径包含中文和空格；关闭该验证窗口会清理其 PTY。
- `node scripts/verify-project-terminal-wasm.mjs`：采用资格长输出及渲染状态/内存探针，核对真实 WASM SHA。当前修补资产的独立探针应零退出并输出 `passed`，但该结果只代表 Node/WASM 资格；它独立于正常回归测试，不能改成跳过后宣称采用通过。可用 `--candidate-root <npm 解包目录>` 检查已知且哈希匹配的替代候选，避免为研究改动生产依赖。
- `src/lib/project-terminal-ghostty.test.ts`：真实固定 WASM、真实 VT/选区/字节分片/释放逻辑；仅模拟 Canvas 系统绘制边界，不证明 WebKit 像素、物理 IME 或实际 CLI。

`scrollback` 这个 wrapper 名称及原注释容易被误读为行数；它实际传给 Ghostty `max_scrollback` 的是字节预算。surface 使用 1 MiB 的有限预算，底层还有最小页、活动屏幕和字素存储，预算不等于严格行数或整个 WASM heap／App RSS 上限。独立探针按 1 MiB 预算验证 15 组 100k 行后的容量平台，并在 1／2／4 MiB 预算下重现修复后的 resize／write／render／free。不能用旧的“128 行严格界限”衡量这个字节契约，也不通过插入 `CSI 3 J`、截断 Unicode 或重启 CLI 掩盖缺陷。

物理 macOS 输入法、目标 Agent 登录/审批、真实 CLI 修改、音频/monitor 负载，以及双架构发布运行分别记录证据。合成 composition 事件不等于候选窗验收，Rosetta 不等于 Intel 实机，跨架构编译不等于运行。当前结果见 [#353 验证记录](../acceptance/v1.7.0-beta.5-terminal-adoption.md)。

## 原生隐藏与最小化

终端绘制额外使用 `getProjectTerminalVisibility` 和 `ProjectTerminalVisibilityEvent` 的主窗口快照。首次显式订阅时，在主线程注册 AppKit 的最小化、恢复、occlusion 变化及 App 隐藏／恢复通知，按 `isVisible && !isMiniaturized && !NSApplication.isHidden` 计算；只有变化才发布递增 revision。它不轮询、不使用失焦代表隐藏，也不修改页面后台节流或 NSWindow delegate。

App 自身的集中 show/hide 路径在操作派发后也通知该私有边界，仅在已有终端 observer 时补取主线程快照；这样窗口已被遮挡时再 orderOut 也能发布隐藏，不依赖 occlusion 标志必须再次变化。

`observeTerminalHostVisibility` 先等原生事件订阅完成，再获取初值，拒绝迟到的旧 revision；调用方把该值与工作区显示、DOM visibility 合并后交给 surface。初值失败和订阅释放都会撤销监听。AppKit observer 属于主 NSWindow，替换窗口会先撤销旧注册，主窗口 Destroy 和 App／验证 fixture 退出时释放。它只控制终端绘制，隐藏时 PTY 和有限输出消费继续运行。

surface 在初值未知时暂停绘制，取得快照后采用 `paneVisible && nativeVisible && !document.hidden`，释放时撤销订阅。窗口失焦但仍显示时不暂停。原生 fixture 的 `fixtureVisibilitySnapshot()` 只保留最近 64 个原生 revision／状态及事件后 200 ms 样本，同时记录公开 `CanvasRenderer.render` 调用数和实际解析字节数；供真实隐藏／恢复时核对，调用数不是 GPU 完成或像素呈现证明，不用 AX 观察代替原生状态。

## 高输出输入延迟

自动原生 fixture 在同一真实 PTY 上运行一次受控输出：读取至少 256 KiB 后，经公开 `terminal.input` 发送 Ctrl-C，等待子进程实际中断标记与 shell prompt，再发送唯一 printf 标记。负载源码以 base64 传入，printf／prompt 用八进制编码，避免命令 echo 被误认成执行输出。Node 使用构建 launcher 的绝对可执行路径；自动 fixture 默认执行该步骤，手工交互模式只在显式点击延迟按钮后替换其临时 shell。

时间来自同一 WKWebView 的 `performance.now()`：起点为公开输入请求，终点为 fixture 包装的公开 `terminal.write` 完成实际 VT 解析之后，以及随后一次 rAF 的机会。它包含输入排队、原生命令、shell 和回传开销，并带少量 viewport 观察开销；不是 native 写入耗时、工具轮询耗时、GPU／像素完成时间或统计性能基线。没有为此扩展生产 surface API。

文档隐藏时，解析输出仍有效，但浏览器可以不安排 rAF。此时 `frameOpportunity` 为 `unobserved-document-hidden`，帧时间为 `null`，同时保留试验开始与标记解析时的 `document.hidden`。等待帧期间转为隐藏也采用该结果，不把暂停绘制误报成输入超时。交互 fixture 提供显式的单次 `Run high-output latency (temporary shell)` 按钮，窗口抬到前台后点击即可另测可见帧机会；只在点击后写入结果，不持续更新 UI。

负载在 4 秒或 4 MiB 后自行结束；非 Ctrl-C 的结束不算通过。整个探针 8 秒超时，失败时发送 Ctrl-C 并等待原生 `close()` 清理；清理失败保留错误。单次试验、唯一标记与帧等待均随结果结束，不留下后台采样器。

失败诊断仅含阶段、计数、时间、尺寸、DOM visibility 和自动临时 shell 的末尾 1000 字符 VT 文本；不采集用户工程、CLI 凭据或环境变量。诊断先于原生 close，避免清理后丢失故障现场。
