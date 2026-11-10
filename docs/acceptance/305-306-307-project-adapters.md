# #305／#306／#307：III、IV 与 Runes 统一演奏入口

本轮仅实施这三张子票。父 #294、其他维护源、#313／#314 的跨平台与安装验收分别跟踪。
完整输入快照位于 `/private/tmp/pnds-305-306-307/{app,305,306,307}`，保存 HEAD、
staged／unstaged 差异、未提交文件及逐文件 SHA-256。没有用旧包、同名历史源或录制夹具
覆盖维护源码，没有创建 commit、push、tag、发行包或启动开发服务器。

## 维护来源

| 工程             | 指定维护树（相对 App 父目录）          | 输入版本                                                              | 本轮源分支                      |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| Inarticulate III | `PNDS-1.6.2-projects/Inarticulate III` | `1.4.1`                                                               | `codex/issue-305-browser-entry` |
| Inarticulate IV  | `PNDS-1.6.2-projects/inarticulate-iv`  | `0.2.1`                                                               | `codex/issue-306-browser-entry` |
| Runes            | `runes-pnds`                           | `0.1.0-pnds.1792394242599141000-18547-pnds.1792467239649871000-14651` | `codex/issue-307-browser-entry` |

复用三个独立维护工作区，III／IV 本身是 linked worktree。managed 新工作树请求没有返回，
终止等待后未生成附属 artifact；没有强删既有工作树。App 开始时创建
`codex/issues-305-306-307`，其后并行工具适配聊天把共享工作区切到
`codex/issues-308-309-310-311`；本轮保留该聊天的文件与分支，不将其改动归为三票成果。
在没有业务提交的情况下，以精确文件基线和内容哈希标识成果，不能从分支名推断已收录外部源码。

## 实际行为

三个源分别声明 `runtimePorts: 1` 和 `browserParticipation: 1`，接管 App 已绑定的两个
listener，原子发布当次 bound/error 报告，config／health 使用真实端口与 runId。
None 模式报告 disabled。独立运行保留原固定端口路径，monitor 仍连实际内部服务。

实际页面先加载确认 context，再从不可变演出前缀取得本地资源；所有 performer
Socket.IO 连接使用该上下文的 path。III／IV 的曲线／符号图、canvas、必需样式和实际
连接就绪后才报告准备；Runes 要求必需样式、canvas 和真实乐谱响应。隐藏候选不等待绘制帧，
也不预设演奏身份。必需资源失败报告 preparation failed，不能淘汰旧页面。

III 的座位和 claim、Runes 的 claim 和编号在普通浏览器中按稳定池主／工程命名。
原生私有来源继续使用旧键；IV 原本匿名，本次没有增加身份机制。III 的拒绝／重置仍
清除编号并重新选择。Runes 同场可恢复原 claim，服务重启后仍按既有内存 claim 表重新
签发；编号继续恢复。这与浏览器持久键分别表达，没有改变工程接纳权或录制身份。

III 的 point／line／OSC、IV 的音乐事件与相位／暂停规则、Runes 的触摸轨迹、乐器与
录制轮次归属保持。IV 的外部 M4L 若仍配置固定 6868，需要操作者按 App 诊断中的实际
performer 端口调整；没有修改 Max patch。Runes 的实际音频输入是 Pointer Events 控制
Host 乐器，没有麦克风／摄像头采集或其他新增安全上下文 API。三源保留既有 HTTPS 路径，
LAN HTTP 或保存图标不增加受限媒体权限。

## 验证路径

源测试先观察缺监听报告、错误资源范围、准备失败及缺样式门槛的失败，再逐片实现。
源没有 bundler／额外构建脚本；III／IV 执行 `npm run check` 和 `npm test`，Runes
执行变更 JavaScript 的 `node --check` 与完整 `npm test`。结果与哈希归档在
[本轮证据](./evidence/305-306-307-project-adapters-2026-11-09.json)。

最终源结果为 III 49／49、IV 49／49、Runes 135 通过／3 项既有证据导出跳过。
App 完整 `npm run check:all` 通过：前端 313 文件、3,666 测试通过；主 Rust 970 通过、
25 项显式夹具忽略，其余工作区检查通过。两个新增显式维护源用例另行执行通过，不能
把默认忽略当作浏览器验收。Standards／Spec 最终均为 0 项未解决发现。

App 显式 HTTP 用例从维护树复制运行输入到测试自有目录，经真实 `SessionManager::start`
启动 Node。测试占用自己的两个首选端口，验证避让后的公开入口、明确确认、带查询资源、
独立 Client 的私有来源及停止后旧 POST／grant 返回 409。没有代理替代 Host，也没有向普通
浏览器手工注入原生身份头。

实际普通 WKWebView 提交生产入口控件，读取真实 canvas 与准备报告。III 通过原生 prompt
回调选择座位并接收 point 广播；IV 执行 start／pause 与同场重连；Runes 通过实际编号控件、
PointerEvent 和原 monitor conductor 路径，把触摸送入真实 Host 状态。同场 reload 恢复
凭据，Stop/restart 保持原 Document 和 timeOrigin，旧路径被拒绝；主动进入缺 CSS 的候选
保留旧文档，恢复资源后重试才交接。同工程重开恢复选择并尊重工程 claim 更新规则。

Standards／Spec 两轴审查分别进行；Spec 发现的必需样式遗漏由单一实现 agent 在三个源
统一修复，并用实际缺 CSS 候选保页用例复验。

恢复测试曾因程序化提交仍禁用的 Retry 控件而失败；夹具改为等待真实可点击状态，
三源最终完整通过。Runes 的真实 GET／HEAD 回归还核对缺失资源带 `no-store`，恢复后
同一 URL 返回原字节，没有为负缓存猜测修改其既有生产缓存策略。

后续完整检查曾在 `host_entry_reuses_last_actual_port_and_avoids_new_occupants`
释放后的原单次重绑中出现 `AddrInUse/48`。25 次单独 exact 运行通过，慢 lsof／netstat
也没追上占用者；这些历史失败本身未记录 PID，不能倒推为外部抢占或关停泄漏。

正确同进程反馈组选 Host 重绑、真实 runtime listener/pre_exec 与 adapted controlled
check，保持默认并发。临时 SDK libproc 快照在首红现场捕获：直接子进程仍是 test-image，
与原 Host 相同的 fd74 正在 LISTEN 127.0.0.1:49269，CLOEXEC 已设置；原 Host 的
`stop_server` 返回 `Ok(())`／1.358ms。402µs 后的第二次诊断 bind 已恢复，但原失败
仍判失败。同轮低位 10244 的交接也捕获到 CLOEXEC=true 的 exec 前子进程暂持。
快照 errors=0／truncated=false；慢外部命令随后已空。这项已实证的故障模式是 fork
复制 fd 后、exec 关闭前的合法短暂持有，不是 exec 后 Node 泄漏或缺少 CLOEXEC。

最终只修测试协调：`FixturePorts.release_for_start` 在现有 managed-child spawn
mutex 内关闭预留 listener，文件租约保持；Host 测试每次 Drop 后的第一次原 bind／
HostEntry::bind 也经过相同短边界，等待既有受管 spawn 越过 exec。没有重试单次 bind、
降低 suite 并发或修改生产 CLOEXEC、Drop、timeout。真实受管 fork＋pre_exec 管道
暂停回归先 RED：exec 前交接过早返回；修复后必须等 exec，且 child 仍存活时唯一
重绑成功，失败路径解除暂停并回收自有 child。临时 dlopen/SDK hook、Drop 观察槽与
第二次诊断 bind 已移除，仅保留通用失败快照；C 探针和原始诊断日志留在外部调试目录。
确定性管道暂停回归已 RED→GREEN；清理后正确同进程 15 项组仅实际执行一次，默认
并发 15／15 通过（`fork-handoff-correct-seam-validation.log`）。此前一条构建命令曾被
并行维护中的 `modules_tests.rs` 编译错误阻断，未执行该组；该独立改动修正后才验证，
没有修改其文件或用既有二进制替代当前树编译。最终完整 `check:all` 结果另行核对。

音频取消用例的另一项失败日志显示 UDP EADDRINUSE；诊断证实 App 存在可复现的
自身端口复用路径，历史失败的实际占用者未记录。临时分配释放音频目标后、受管
音频进程 bind 前，`OscClient::connect` 的 `bind(:0)` 可能取得同一目标。
30,000 次最小回放出现 4 次自复用，注入该分配顺序的实际受控检查也复现音频
`EADDRINUSE`。确定性回归先观察真实 UDP 自环回包，再验证旧 socket 持有至替代源
socket 分配完成，随后真实目标 listener 可绑定并接收客户端的 OSC `/status` 字节。
修复只在 local_addr 与 peer_addr 完全相同时分配一次替代源，保持旧 socket 到替代
绑定／连接完成；同端口不同 IPv4 地址不替换。没有重试循环或扩展 UDP 目标保留策略，
不宣称解决外部进程抢占，TCP 释放断言的未定原因亦不能据此归为同一故障。

修复后 OSC 目标回归 3 项与原 status 回归 3 项通过。首次默认并发 controlled-checks
分组为 21 通过、1 失败、1 忽略；失败在 TCP 10240 已占用的静态预检阶段，未到达
health 或音频启动，保留原日志。已发起的一次相同默认并发复跑为 22 通过、1 忽略；
此后停止重复网络测试，由最终完整检查统一验证，不以复跑结果推断首次占用原因。

后续完整检查的主 Rust 用例为 972 通过／25 忽略，安装 CLI 集成仍有两项失败：
一个在 TCP 10242 已占用的预检阶段失败，另一个从 10252／10253 收到
`projectId: controlled-fixture` 的其他工程 health。真实双测试进程回归将原
`InstalledFixture` 保持在 listener 已释放、Node 尚未启动的交接窗口，确定性观察到
两个独立进程都选中 `[10240, 10241]`。原进程内数字登记不足以隔离这种交接。

本轮只修测试夹具：库 `FixturePorts` 与安装 CLI 共用逐端口 nonblocking advisory
文件租约，先取稳定 host／user 目录中的锁再做 `0.0.0.0` 监听预留；释放 listener
给真实 child 后仍保留租约至 fixture 生命周期结束，不 unlink 锁文件。单一 LAN
地址监听的另一项 RED 证明原 loopback 预留漏检；wildcard 预留修复该路径。
保持生产端口检查、health 身份断言、默认并发与失败策略，不运行时重试；文件租约
只协调参与夹具，不承诺阻止不合作软件在 listener 交接窗口显式抢占。

修复后的安装 CLI 定向组保持默认并发，12 项通过、0 失败；列表中的 1 项 ignore
是 `installed_fixture_handoff_child` 子进程入口，由父交接回归以 `--exact --ignored`
实际启动两次，并等待两个真实测试进程成功退出，不是跳过业务失败。该组也实际
执行单地址占用回归；其修复前 RED 在本机 LAN IPv4 `192.168.31.13` 复现。

该组通过后的一次完整检查仍在同一单地址回归失败：普通 Rust wildcard listener
在 Darwin 上自动启用 `SO_REUSEADDR`，可以与特定地址监听重叠；仅改为
`0.0.0.0` 仍不足以排除占用。保留该次 RED（`check-all-complete.log`），仅将测试
共同预留 helper 改为 libc exclusive listener：关闭 `SO_REUSEADDR`／`SO_REUSEPORT`、
设置 CLOEXEC，以 RAII descriptor 处理全部失败清理。单地址回归原断言保持，并直接
检查 exclusive bind 的 `AddrInUse`，不让其他并发租约恰好繁忙掩盖监听器行为；另核对
真实 socket 的两个 reuse 选项均为 0 且 CLOEXEC 生效。生产端口检查没有改动，
当前完整检查尚需按修复后的最终运行结果确认。exclusive listener 的两项定向回归
均通过；随后仅执行一次默认并发 CLI 组，13 通过、0 失败、1 子进程入口 ignore（由
父回归实际执行）。没有通过更换断言端口、重复组跑或降低 suite 并发取得结果。

```sh
export PNDS_III_SOURCE='<维护清单的 Inarticulate III 绝对路径>'
export PNDS_IV_SOURCE='<维护清单的 inarticulate-iv 绝对路径>'
export PNDS_RUNES_SOURCE='<维护清单的 runes-pnds 绝对路径>'
cargo test --manifest-path src-tauri/Cargo.toml maintained_scores_use_actual_ports -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml plain_browser_maintained_scores -- --ignored --nocapture
npm run check:all
```

## 证据边界

这些结果证明本机实际 Host／Node／WebKit 和独立 Client HTTP 路径，资源请求全部留在本地
确认范围，无新增 WAN 依赖。没有更改机器路由来物理切断 WAN。自动 PointerEvent 证明
真实页面处理器到 Host 的控制链路，不代表物理手机触摸、麦克风采集或扬声器听音。
Runes 完整源回归包含实际 instrument／Internal／External 与录制测试；现有三项 timbre
A/B 证据导出需额外输入，按原规则跳过。手机、双机、真实 WAN 断开、签名 App、最低系统、
双架构和听音结果仍由 #313／#314 记录，不因本组完成而宣称已验收。
