# 工程终端采用验证

当前是 #353 的可复用验证链路，**Ghostty 候选尚未通过采用资格**。工作台终端、离开保护和方案交接仍受 #353 阻断；不能把这里的短语料测试或原生 fixture 当作 beta.5 完成。

## 接入边界

`src/lib/project-terminal-surface.ts` 在现有主 WKWebView 的 DOM 中建立一个终端 surface，使用固定的 `ghostty-web@0.4.0-next.21.g640db46` wrapper 和 `src/assets/project-terminal/ghostty-vt.wasm` 的显式修补资产。没有 Node/Bun 服务、WebSocket、HTTP listener 或新增 WebView。调用方应延迟导入该模块；当前仅由显式启动的原生验证入口加载，不改主工作台导航。

每个 surface 继续使用独立 `Ghostty.load(localWasmUrl)` 实例。已发布原始候选的字素历史与页复用缺陷通过固定源码上的局部修补解决；该修补资产已通过长输出、同实例重建和独立实例重建测试。仍保留逐会话 heap 隔离，不把独立实例本身当作内存安全修复。

控制和输出均使用 `@/lib/tauri-bindings` 的类型化原生命令。每次读取取走一个有序的原始字节包，消费即释放原生有限队列容量；前端一次只保留一个未完成读取，按批次让出事件循环。UTF-8 跨包字节直接交给 VT，不逐包有损解码；输出和绘制均不进入 React/Zustand。

PTY 所有权独立于演出 SessionManager。EOF 表示输出流结束，不能替代 shell 或其作业已结束的确认。EOF 尚无退出码时，surface 停止字节读取，每 100 ms 经 `getProjectTerminal` 核对同一会话的最终退出状态；释放或成功结束后停止查询。输出和绘制继续留在 VT，状态回调只发布生命周期。

surface 的 `dispose()` 只释放显示与订阅；`close()` 等待原生命令确认清理成功。原生 session 即使已观察到 leader 退出，也仍保留未回收的 Child，直到实际受管作业清理完成。失败保留真实错误和可查询会话，不能先把 UI 报为已结束。

终端使用 App data 下独立的 `project-terminal.json` 原子持久化所有权，不读写演出的 `session-children.json`。打开成功前记录 leader 的 PID 与微秒启动身份，清理发信号前按实际变化更新已核实作业的 PID／启动身份。没有空闲时的磁盘同步或进程扫描循环。清理覆盖同一 POSIX session 的前后台作业组，每次发信号前重新核对身份与 session；仅在实际作业结束、所持 Child 回收且记录清除成功后撤销保护。

最终 manager 释放时清理仍未确认，会停止本地输出 reader，保留磁盘记录和本进程的端口释放保护。下次 App 启动或终端打开先重试：必须以仍匹配的 leader 或已记录作业身份锚定原 session，不能只凭数字 SID 发信号。无可核实锚点而 SID 仍有进程、记录损坏或读写失败时保留记录并阻止新终端，其他演出功能继续启动。突然崩溃若发生在作业身份首次记入之前，leader 又已消失，可能落入这条保守阻断路径；当前未承诺自动清理无法核实的作业，也不自动重启 CLI。

初始登记失败会回滚整个 PTY session；回滚未确认时保留实际 Child 与原始错误，后续打开继续报错，`get`／`close` 仍可用于查询和结束。磁盘仍不可写时无法承诺跨崩溃恢复，不能把内存保护当成已落盘。Child 已回收但记录清除失败时缓存真实退出状态，查询仍返回该退出码，重试结束继续完成记录清理。

Darwin 的 controlling TTY 可以在所有 slave 描述符关闭后仍维持到 session leader 结束。隔离探针中关闭 0／1／2 后 master 非阻塞读取仍为 `EAGAIN`；先 `TIOCNOTTY` 再关闭则在进程仍运行时观察到 EOF。因此 surface 的延迟退出回归使用可控原生命令边界，真实宿主要求最终退出码 7，并如实记录是否实际观察到提前 EOF，不把提前 EOF 当成所有 shell 的必然时序。

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

- `npm run native:terminal:verify`：构建静态本地资源，运行真实 Tauri/WKWebView、类型化 IPC、Rust PTY 的短语料验证，写入独立临时证据目录。沿用生产 CSP，无需启动 dev server。
- `npm run native:terminal:verify -- --interactive`：相同链路保持前台供真实输入法、复制粘贴、已安装 CLI 与 resize 检查。工程是临时 Blank，路径包含中文和空格；关闭该验证窗口会清理其 PTY。
- `node scripts/verify-project-terminal-wasm.mjs`：采用资格长输出及渲染状态/内存探针，核对真实 WASM SHA。当前修补资产的独立探针应零退出并输出 `passed`，但该结果只代表 Node/WASM 资格；它独立于正常回归测试，不能改成跳过后宣称采用通过。可用 `--candidate-root <npm 解包目录>` 检查已知且哈希匹配的替代候选，避免为研究改动生产依赖。
- `src/lib/project-terminal-ghostty.test.ts`：真实固定 WASM、真实 VT/选区/字节分片/释放逻辑；仅模拟 Canvas 系统绘制边界，不证明 WebKit 像素、物理 IME 或实际 CLI。

`scrollback` 这个 wrapper 名称及原注释容易被误读为行数；它实际传给 Ghostty `max_scrollback` 的是字节预算。surface 使用 1 MiB 的有限预算，底层还有最小页、活动屏幕和字素存储，预算不等于严格行数或整个 WASM heap／App RSS 上限。独立探针按 1 MiB 预算验证 15 组 100k 行后的容量平台，并在 1／2／4 MiB 预算下重现修复后的 resize／write／render／free。不能用旧的“128 行严格界限”衡量这个字节契约，也不通过插入 `CSI 3 J`、截断 Unicode 或重启 CLI 掩盖缺陷。

物理 macOS 输入法、目标 Agent 登录/审批、真实 CLI 修改、音频/monitor 负载，以及双架构发布运行分别记录证据。合成 composition 事件不等于候选窗验收，Rosetta 不等于 Intel 实机，跨架构编译不等于运行。当前结果见 [#353 验证记录](../acceptance/v1.7.0-beta.5-terminal-adoption.md)。
