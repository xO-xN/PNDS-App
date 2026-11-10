# #322／#323：Host 与创作 performer 原生媒体

本轮实施 [#322](https://github.com/xO-xN/PNDS-App/issues/322) 和
[#323](https://github.com/xO-xN/PNDS-App/issues/323)，范围来自
[#315 的正式规格](../plans/v1.7.0-beta.3-creation-foundation-spec.md)。
集成分支 `codex/issues-322-323`，基于 `fb2f7617` 与开始时的完整未提交工作区。
保留前序及同时进行的其他任务改动；本轮不创建业务 commit 或 PR。
实现者在独立工作树以相同快照开发，再由合并子 agent 整合相对基线的补丁。

## 交付边界

Host 主 monitor、投影和创作 performer 使用受管的第一方原生 WKWebView，
复用 Client 的可信来源、代理和隔离存储机制。只由当前窗口、运行代次和导航处理
权限及消息，真实权限交给 WebKit／macOS 询问，工程页没有 App 管理权限。
主 monitor 持有 monitor 输入与分析；投影拒绝采集并消费工程自己的结果。
performer 每窗拥有独立身份、存储与手动输入，硬件共享失败不抢占其他窗口。
隐藏及临时断网保页，明确刷新、替换或关闭释放所属文档。

原有 monitor 揭示、刷新 nonce、预演、主题／语言、缩放、投影开演门、焦点和
键盘，以及 performer 测试视口、方向、原生控件、JavaScript 弹窗和单点模拟均
属于此次回归范围。规则见 [native-project-media.md](../developer/native-project-media.md)，
载体决定见 [ADR-0006 修订](../adr/0006-projection-window.md)。
稳定装机帮助路径保持，双语使用说明及助手资源说明同步。

## 自动化与原生观察

执行环境：2026-11-09–10，arm64，macOS 27.2（26B123），Node 24.19.0、npm 11.17.0。
前端测试明确进入原生承载路径，普通网页 iframe 预览不代替新增路径的证据。
聚焦用例覆盖本页导航事件、overlay 保页、媒体错误、关闭确认、迟到消息与现有
测试窗口交互。公开 HTTP 工程用例验证真实页面、派生结果流转和独立输入结果。

生产原生夹具直接使用公开创建后的真实工程与 `SessionManager`，观察 Host 主
monitor、投影和两份 performer 的可信来源、媒体／设备 API、无 App IPC、独立
identity/storage、同窗刷新存储恢复、单窗关闭后他窗原 Document 和 Worker 保持，
以及 Stop 后无活动旧文档。释放后新窗口不继承已关闭窗口的临时存储。

标准标题栏与主窗口覆盖式标题栏分别以真实 AppKit 鼠标事件点击 mask 避让区域中的
App DOM 按钮，同时验证原工程 token／timeOrigin 未变、Worker 继续。该用例先发现
32px 的 CSS viewport／NSView 安全区域偏差，修复改为匹配实际 viewport 的公开
bounds／safe-area 矩形，不以“native hitTest 命中”替代最终 DOM click。

缓存用例读取工程实际 `max-age=86400` 脚本：首次值为 first，磁盘改成 second 后，
普通同源新文档仍为 first，证明缓存实际生效；显式 `_r` 刷新才取得 second。
另验证生产 `tauri://localhost` 壳的真实 `location.origin` 与命令桥发送来源一致。

公开创建的 Classic 工程以 None 模式实际启动，通过生产代理加载确切客户端脚本，
在 performer 监听器完成真实 Socket.IO polling 握手，主文档仍走 monitor 监听器。
未声明端口及其他主机被拒绝；这项兼容不通过放宽远程 Client 策略实现。

最终 `npm run check:all` 退出码为 0，保持默认并行度：前端 317 文件、3,717 项通过，
1 文件／2 项按原配置跳过；App Rust 991 项通过、25 项默认忽略；安装／受控 CLI
14 项通过、1 项默认忽略，诊断 CLI 6 项、DNS daemon 单元 40 项及 restart 2 项
全部通过，其余 workspace 与文档测试通过。类型、lint、ast-grep、Prettier、Rust
格式与 clippy 均通过。本票的 opt-in 原生场景已单独执行，未把默认忽略当成通过。

三组实际原生报告均已核验完成标记：

- [新增 Host／投影／performer](./evidence/322-323-native-project-media-2026-11-09.json)：
  另含真实 Cmd+A／Cmd+C 编辑保护、回壳、鼠标单点、竖／横视口、失败导航后新 attempt
  重试，以及真实关闭／flush 期间拒绝重入后允许后续请求。
- [既有 Client 存储与网络](./evidence/322-323-client-storage-regression-2026-11-09.json)：
  localStorage／IndexedDB／cookie、跨代理端口、来源隔离、Worker／polling／WebSocket。
- [既有 Client 生产切换事务](./evidence/322-323-client-entry-regression-2026-11-09.json)：
  候选失败／取消保页、成功交接、存储恢复、原生输入、旧代理释放和 Leave。

可复现命令如下；独立网络／原生夹具顺序执行，完整检查内部保留默认并行：

```sh
npm run native:client:verify
npm run native:client:entry:verify
npm run native:project:media:verify
npm run check:all
```

前两轮完整检查发现三处测试拓扑前提不可靠：释放后立即重绑存在空隙；只等待自己
的 managed fork 不能排除其他并行 fork 暂持 FD。受控真实 fork／exec、额外 paused
fork 和生产 allocator 分别证明这两种充分机制，未从事后 lsof 空结果推断历史唯一
触发者。foreign fixture 改为直接转移原监听器；own-PID／LAN／受控 fork 三个拓扑
场景在 exec 后的精确测试子进程中创建自己的 FD，显式核验恰好执行并通过 1 项。
保留原 wildcard／loopback、pre-exec、子进程仍存活、单次 bind、生产分配器和业务
断言；未改生产 allocator、未加失败重放／sleep，也未把整个套件串行化。
规则已同步到 [testing.md](../developer/testing.md)。

## 手动采集与联合验收

用户在本轮明确选择“先交付实现，实机采集留到 #313／#314 联合验收”。下列物理设备
项目不作为已经通过记录，也不再阻塞本轮实现交付；联合验收继续核对同一最终构建。

可运行的 [媒体测试工程](../../src-tauri/tests/fixtures/native-project-media/README.md)
由普通 Host／创作工作流打开。用户分别点击启用相机和麦克风；相机真实帧经过
本页 Worker 计算亮度，麦克风经本页 Web Audio 链计算 RMS，仅数值进入工程
服务器，投影读取相同结果。它是可执行的验收材料，不是已经完成采集的证据。

| 项目                                              | 状态                     | 所需证据                                           |
| ------------------------------------------------- | ------------------------ | -------------------------------------------------- |
| 主 monitor 摄像头／麦克风真实采集，投影只消费结果 | 待用户实机               | 实际画面／数值变化、来源、系统指示及投影无重复授权 |
| WebKit／macOS 允许、拒绝、重试与输入切换          | 待用户实机               | 实际权限选择、当前设备列表及结果                   |
| 两份真实 performer 的独立输入／身份／存储         | 待用户实机               | 两窗来源和身份、各自启用／停用与持续工作           |
| 同一物理设备共享成功或明确拒绝                    | 待用户实机               | 系统和设备事实，不抢占另一窗                       |
| 关闭、刷新、替换、迟到授权和退出的真实释放        | 待用户实机               | 最后所有者结束后的系统媒体指示与他窗保留           |
| 既有 Client 媒体、角色、存储隔离与切换保页        | 自动化回归及实机分别记录 | 不从本轮 Host API 可见推导 Client 或反向推导       |
| 模型首次推理、arm64／Intel 签名安装与最终联合场景 | #313／#314               | 最终同一构建和真实工程版本的独立记录               |

不自动启动开发服务器，不自动启用真实设备或同意权限。API 暴露、控制数组、
模拟帧和测试成功均不能勾选上述真实采集项目。只有实际观察到的结果才能改变状态。

## Standards

**0 unresolved documented-standard violations; 0 additional actionable Fowler-smell findings.**

The initial cleanup finding is resolved by a per-label `CleanupGuard`, admission checks before dispatch and on the main thread, and captured-owner removal. Retryable `retiring` ownership remains separate from active cleanup. Native evidence includes rejected reentrant `sync`/`close` during real close/flush and successful later requests. Subscriptions use `onProjectMediaView` in `src/lib/events.ts`, retaining the registration promise and unwrapped payload.

Re-read native geometry, notice masks/hit testing, input/focus ownership, retry, cold-cache handling, proxy aliases, feature-gated probes and the verifier wrapper. The verifier requires a completed passing report, with negative-report tests. Component-local input state and central typed event/command boundaries follow repository conventions. The focus hook was reviewed despite its initial scope-list omission.

The canonical-host follow-up preserves exact authorization: bridges and native checks compare URL-canonical origins including the actual role port. Credentials, wildcard/non-origin targets and different hosts remain rejected. Mixed-case-host regressions cover Host/projection bridges and the actual preview adapter.

The listener-transfer follow-up moves original reservation sockets while retaining numerical leases, eliminating the foreign-occupant close/rebind gap. Held setup stays separate from ordinary Node startup. Controlled pre-exec/allocator tests retain the actual ownership and business assertions.

The final topology-isolation follow-up was reviewed independently. Only the three descriptor/PID-topology cases execute themselves after exec through the current test binary. The exact thread-derived filter, case-valued recursion guard, successful exit and explicit one-matched/one-passed/non-ignored output checks prevent zero-test false success. Sockets are created in the isolated process, while parent-suite concurrency remains unchanged. Own-PID preflight retains continuous wildcard and loopback listeners. The managed-fork regression retains its bounded control pipe, owned-child cleanup, child-alive and single-bind assertions; production allocation remains real. No production allocator change, sleep/retry workaround or suite-wide serialization was introduced. The controlled two-fork witness supports the diagnosis without claiming a sole historical cause.

Reviewed against the initial snapshot, limited to #322/#323 and listed follow-ups; unrelated concurrent work was excluded. Native mechanism evidence remains distinct from physical capture, permission, sharing and installation acceptance. The integrator runs repository checks separately.

## Spec

No unresolved findings in the final scoped implementation.

All three earlier findings are resolved:

- Native monitor focus now combines meaningful-input and pointer ownership. Command editing remains with the project input; idle ownership returns to the App. React coverage and the production AppKit selection/copy/focus report support the corrected boundary.
- Retry closes the owned failed document before creating a fresh attempt navigation. Old outcomes are fenced, while ordinary hide/show retains the original document. Coverage includes the frontend workflow and a real WebKit failed navigation followed by recovery.
- Declared DNS hosts and message/preview origins now use canonical URL origins. Uppercase `Stage.Local` remains a valid displayed address; exact role, listener, generation and credential checks remain in force. New authorization tests cover all three native roles, Host/projection bridge tests cover the public page flow, and the shipped preview adapter is exercised with the mixed-case source. Invalid, opaque and wildcard preview sources remain rejected.

The native evidence also records cleanup reentrancy refusal, real DOM notice clicks under both titlebar styles, viewport/mouse-touch behavior, effective cache and explicit refresh, independent storage and per-window retirement. These establish their stated boundaries only. Physical camera/microphone capture, system permission choices and hardware sharing remain explicitly deferred by the user to #313/#314; no fixture evidence is represented as those checks passing.

No additional scope creep or incorrect implementation identified. Final full-check execution is owned by the parent agent.

Spec: 0 unresolved findings.

## 工作树收尾

按 [implement-spec](/Users/xiaoxiang/.agents/skills/implement-spec/SKILL.md) 的
“Clean up all implementer subagent worktrees” 步骤，已通过 App 的
`archive_worktree` 尝试归档两份隔离树。App 分别返回：

- `issue-322-host-media`：`Another active task still uses this worktree.`
- `issue-323-performer-media`：`The task's primary checkout cannot be removed.`

把当前任务重新指向原仓库的 `attach_worktree` 也被拒绝：原仓库不是 managed
worktree。未绕过占用或主检出保护强制删除，两份隔离树因此保留。最终实现、验收
记录和全部后续修复均位于原仓库 `/Users/xiaoxiang/Coding/PNDS app 开发/PNDS-App-main`
的 `codex/issues-322-323`，不在旧的隔离树副本中。业务 commit 与 PR 均未创建。
