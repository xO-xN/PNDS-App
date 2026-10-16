# #232～#235：上下文基础实施与实机验收

2026-10-15，按 #232 → #233 → #234 → #235 顺序实施；2026-10-16 完成逐组实机
检查、助手界面调整及所有厂商共用的上下文估算。用户已批准全部提交并完成这四项
issue。下文按时间保留实施、失败样本、修复和复验记录，各轮的「未提交／未关闭」
描述是当时状态。开发服务器未由 agent 启动。

最终 `env RUST_TEST_THREADS=1 npm run check:all` 全绿：前端 157 文件／1,862 项，
Rust 574 项通过、5 项既有忽略；两轴复审无剩余问题。真实 GLM 的一次 `invalidTool`
和一次总时限失败仍保留，未据核心机制通过承诺模型回答质量。Intel、未覆盖的原生
窗口／输入法组合及后续工程读取联调继续按下文边界留账，不外推为已验收。

## 已交付范围

- #232：按规范化服务地址与精确模型 ID 隔离的非敏感容量配置；输出、推理、安全余量和
  App 输入目标；同一原生组装／分词入口；token、字节、消息、工具、返回量、总时限
  独立拒绝；无效输入可修正，密钥仍走独立钥匙串边界。
- #233：下一次／当前调用的真实载荷估算和分项；普通 JSON、SSE 尾块 usage；单次和
  整轮统计分开；缺失／中断为未知；本机历史保留有界统计，旧统计明确标为历史。
- #234：最多六个近期完整轮次、明确排除数、用户发起的整理范围与预算预览、带原消息
  引用的五类摘要及核对／取消／重做、新话题边界、完整原文保留、schema 1／2 → 3
  兼容加载。未知服务归属的旧记录保留本机，不自动进入模型；新消息记录服务身份。
- #235：原装机 allowlist／资源路径不变；前三个相关搜索片段、默认 1,200／最高 2,000
  UTF-16 单位的页长、范围／未读位置、App／内容 SHA-256 来源、同请求重叠去重及版本
  元数据复用。缓存命中仍计入真实载荷；重复无进展会结束请求。

工程概况、工程文件和附件的真实接入仍归 #168／#169／#170／#225；本轮使用受控
消费者验证授权、工程／服务身份及关闭读取过滤，未引入工程读取工具。

## 可复验的文档前后比较

[原始消息／工具结果与来源](./evidence/235-document-flow-packets.json)保留本轮起始
文档编排的冻结载荷、编排／搜索／分节等五个源文件 SHA-256、当前编排及四类固定问题。
[原生 HTTP 重放计量](./evidence/235-native-replay.json)将两组消息放进**同一当前原生
请求组装、loopback 受控服务、fixture-model、32,000 容量／20,000 输入目标／512 输出
预留、cl100k_base**下重放。两边都包含当前原生工具定义，因此比较的是文档编排变化，
不是对旧版原生封装的追溯测量。字节和估算来自真实发送包；服务端 usage 是明确标注的
合成值，不能当作真实服务 token 或费用证据。所有失败字段均保留，本组均为 null。

| 固定问题                      | 调用次数（前／后） | 末次输入估算 tokens（前 → 后） | 整轮累计输入估算（前 → 后） | 来源小节数（前 → 后） |
| ----------------------------- | ------------------ | ------------------------------ | --------------------------- | --------------------- |
| outputChannels                | 3／3               | 2,601 → 1,545                  | 4,106 → 3,149               | 5 → 3                 |
| internal／external／none 比较 | 3／3               | 1,244 → 1,423                  | 2,773 → 3,037               | 6 → 4                 |
| 缺失资料                      | 2／2               | 625 → 644                      | 1,189 → 1,215               | 0 → 0                 |
| 多轮追问与重叠页              | 4／4               | 4,298 → 1,924                  | 8,491 → 5,160               | 5 → 3                 |

长小节与重叠追问的末次估算分别减少约 41%／55%；短资料和空搜索有范围、语言和
来源元数据开销，分别增加约 14%／3%，没有隐藏这些样本。缩短搜索候选也减少了引用
小节数，不能据此声称回答覆盖或质量已提高，需真实模型核对。重叠追问中，旧流程
返回两个 6,000 单位页面，其中 5,400 单位重复；新流程只返回 1,800 单位页面原文，
另以引用复用 600 单位。原始输入／输出片段、剩余未读范围和来源均可在证据中查看。

复验命令（只使用本机受控服务，不调用付费模型）：

```sh
npm run test:run -- src/lib/assistant-document-benchmark.test.ts
npm run rust:test -- document_flow_comparison
```

显式重记当前载荷与原生结果时，可分别在上述命令前设置 `PNDS_DOCUMENT_CAPTURE=1`；
冻结的 before 载荷和源文件摘要会被保留。Native 重放测试验证所有实际请求的模型和
输出参数，使用生产计量入口，未另建业务 token 计数器。

## 两轴审查与自动化

以本轮开始时的工作区快照为基线执行 code-review；必要前置实现按用户授权一并提交。

- Standards 首轮 2 项：移除新增 disclosure 的手形光标；把分词器未知状态和来源格式
  枚举映射到中英文。已修复。
- Spec 首轮 3 项：补写新消息服务身份并排除未知／其他服务历史；用显式内容类型修复
  空输入预览的历史／本次输入／资料分项；补齐上述四类问题和原生前后比较。已修复。
- 定向回归覆盖容量边界、中文／英文／代码、长工具／转义结果、JSON／SSE usage、缺失
  统计、停止／迟到、模型切换、摘要失败与核对、新话题、真实临时目录迁移／损坏拒绝、
  页长／重叠／无进展和来源保留。
- 最终 `npm run check:all` exit 0：类型、lint、ast-grep、Prettier、Rust fmt、Clippy
  全绿；前端 157 文件／1,835 项，App Rust 517 项、CLI 9＋6 项、DNS 39 项及重启
  2 项通过，保留 5 项既有忽略。日志 `/private/tmp/pnds-232-check-all-final.log`。
- 修复后两轴复审均为 0 未解决项。文档比较的五份原始文件摘要与起始快照一致，
  before 载荷保留旧搜索字段；短样本开销和来源覆盖减少均已明确记录。

## 用户实机清单

1. 设置中切换服务地址和模型，核对容量隔离与恢复；输入非法／矛盾容量后保存，确认
   输入和新密钥仍可修正，未覆盖旧密钥；容量未知／手填时没有虚假的精确百分比。
2. 输入中文、英文和代码，展开上下文；发送 outputChannels 和三音频模式比较，观察
   文档读取中的分项变化、调用次数、单次 usage 与整轮累计。空输入时历史不能误算
   为本次输入／资料；缺失 usage 必须明确未知。
3. 连续多轮后检查原消息选入／排除数量；打开整理面板确认尚未调用服务，再选择范围
   并生成。核对五类摘要及原消息定位，测试放弃、重做、采用、失败、停止和迟到响应。
4. 开始新话题，确认输入、旧记录、工程草稿都保留，后续不再发送旧话题；重启／重开
   目录恢复边界与摘要。切换工程、服务或模型时，旧候选、测量与回调不能污染新上下文。
5. 查看来源的语言、版本、格式、范围和原小节；按 nextOffset 展开长节，复问重叠范围
   不重发相同原文。缺失资料明确缺口，搜索片段不能被说成整节／整本文档已读完。
6. 在中英文、四主题、最小窗口及真实键盘／输入法下测试展开、返回原消息、焦点、停止
   和布局；真实服务核对答案质量、来源覆盖及真实 usage。双架构与下游工程读取仍分别留账。

## 2026-10-16 首次实机反馈：钥匙串读取失败，待复验

用户使用 `glm-5.3-flash`，配置后在助手聊天看到「无法访问 API 密钥。请检查 macOS
钥匙串访问权限后重试。」截图中输入与已有记录保留。尚未逐项确认 #232 的保存、
非法配置拒绝及模型隔离结果，不将「配置完成」记为整组通过。

只读取固定诊断标记，发现 `[model-keychain] operation=read os_status=-25293`；
macOS 将该状态定义为授权／认证失败。失败位于本机凭据读取边界，尚无证据表明本次
请求到达 GLM，不能归为容量或模型接口错误。没有读取密钥或更改钥匙串，未修改代码。
原生授权弹窗需用户操作，当前自动化凭据替身不能证明该原生权限已经恢复。

下一步仅由用户点击一次「手动重试」，核对是否出现系统钥匙串授权窗口；如出现，
使用钥匙串密码（通常为 Mac 登录密码）允许当前 PNDS App 访问。弹窗及恢复结果待回报。

用户随后回报重试仍为同一错误，是否弹窗未明确。日志又增加一次相同的读取失败。
只读查询确认专用条目仍存在于 login 钥匙串，钥匙串已解锁；当前运行的是
`target/debug/pnds-app`，临时签名的 designated requirement 绑定本次构建 cdhash。
专用条目解密 ACL 中五条可信应用均指向同一开发路径，但五条旧签名要求对当前
构建的校验全部返回 `-67050`，没有一条匹配。此结果区分了钥匙串锁定和旧构建
授权失效；未读取密码数据、改变 ACL 或自动移除条目。

原生只读判定 `/private/tmp/pnds-check-keychain-trust.py` 首次 exit 1：
`keychain_unlocked=True current_build_matches=0 old_build_mismatches=5`。
它仅检查该专用条目的可信应用要求，不能代替真实密钥读取或真实模型测试。
下一步由用户准备好原 API 密钥，在设置中明确移除已保存密钥，再重新填写并保存，
使当前开发构建建立专用记录；不移除模型配置，不重置系统钥匙串。恢复结果仍待回报。

用户完成重新保存后，测试连接及手动重试仍提示无法访问密钥。只读核对发现新条目
创建／修改时间为 2026-10-16 00:18:56（Asia/Shanghai），当前磁盘构建的可信应用
校验已通过：`current_build_matches=1 old_build_mismatches=0`。因此前述旧授权
不匹配并非完整原因，不能把重新保存后的失败继续归于该状态。

进一步通过 Security.framework 查询实际运行的 PID 96030：进程在 2026-10-15
23:17:45 启动，磁盘可执行文件在 23:19:07 更新；`SecCodeCheckValidity` 返回
`-67034`（`errSecCSStaticCodeChanged`：运行后磁盘代码发生变化）。读取静态签名
信息会取得磁盘上的新标识，不能用静态 cdhash 相等冒充动态进程校验通过。
原生只读反馈命令 `/private/tmp/pnds-running-signature 96030 <PNDS开发版绝对路径>`
已实际 exit 1，固定输出 `running_code_validity=-67034`。没有访问密钥正文或修改
任何钥匙串授权，未改运行代码、未启动 App／dev server。

下一步由用户完整退出当前 App、停止旧开发运行，再按原方式启动新进程；保持已保存
密钥，随后复验留空密钥的连接测试。动态签名恢复及实际密钥读取仍待回报，不将静态
授权检查通过记为已恢复，也不据此进入 #233。

## 2026-10-16 完整重启后连接恢复：通过；继续 #232

用户明确回报完整重启后测试连接通过。此次恢复记为真实连接测试通过，之前的失败
和不完整诊断保留；没有据此宣称 #232～#235 的全部实机验收完成。用户同时观察到
较早信息未被带入、近期信息可见。当前规则只选当前服务下最多六个近期完整轮次，
未知服务归属的旧消息不自动发送；这条观察尚不能区分具体排除原因，留到 #234
核对选入／排除计数与完整本机记录，不将其直接记为缺陷或通过。

#232 下一小组仅验配置输入目标的实际拦截：暂设 1，发送短测试文本，应在本机报告
输入预算超限并保留输入；恢复 32,000 后再手动发送，核对可恢复正常回复。
此组结果待用户回报。

用户回报预算拦截与恢复两步均通过：App 输入目标为 1 时，短请求被本机预算错误
拦截且输入保留；恢复 32,000 后手动发送同一句能够收到回复。按本组范围记为
原生通过，不据此推定真实工具循环、usage 或长对话已经通过。

重启后的只读对照同时确认 `running_code_validity=0`、原生签名探针 exit 0，日志
显示 `credential_source=keychain` 随后 `text=true tool_call=true`。动态进程校验与
已保存密钥连接的恢复证据均已取得，未再读取或输出密钥。

#232 接下来补验非法输入目标的保存拒绝（1,000,000 → 恢复 32,000），以及临时
改模型名称后容量草稿隔离、改回后恢复；结果待回报，尚不进入 #233。

用户回报上述两步均通过：输入目标 1,000,000 被拒绝且可修正，恢复 32,000 后可
保存；临时切换模型名称时使用独立默认草稿，改回后恢复原配置。结合预算拦截／恢复
与重启后的已保存密钥连接，#232 本轮快速实机检查记为通过。未单独覆盖的真实多
服务容量准确性、全部分词器和双架构表现不据此推定通过。开始按顺序验 #233。

#233 第一小组计划用一次短问答核对未知分词器下的字符／字节分项、空输入分类及
真实服务调用统计。服务没有返回的 usage 字段应显示未知，不要求补造数字；结果待回报。

用户回报 #233 第一组 1～3 均通过，且用量显示数字：空输入时本次输入／文档分项
为零，混合中文／英文／代码输入改变对应字符／字节分项，真实短回复显示调用次数、
输入／输出及小计。此次确认的是界面显示与服务返回统计可用，未独立比对服务账单，
不据此认定本机未知分词器已有精确 token 估算。

#233 下一组核对生成中显式停止后的不完整统计，以及重开同一工程后完整／已停止
消息和历史用量的保留。结果待用户回报。

用户询问能否由 Codex 控制 App 执行这些操作。开始尝试 Computer Use，按 PNDS 名称
及 bundle ID 连接均超时，开发版完整可执行路径和进程名均被返回 Invalid app。
只读进程检查确认开发版仍运行，Computer Use 应用清单将已注册 PNDS 标为未运行，
当前通道没有连接到开发窗口。尚未执行发送／停止／重开操作，不将连接尝试记为
测试通过。已准备只读 AppleScript 窗口探针于 `/private/tmp/pnds-ui-probe.applescript`，
未执行；替代 UI 自动化方式须先取得用户明确授权。

用户已明确授权 AppleScript，并要求优先用最可靠的电脑控制工具。只读 AppleScript
确认当前 PID 6374 的开发进程没有 bundle ID；原电脑控制工具能正常读取 System
Settings，且 ChatGPT／Codex Computer Use 的系统控制开关已开启。AppleScript
通过 System Events 读取窗口另被系统拒绝辅助功能访问，不能把两条通道混为同一
权限故障；未更改任何系统权限。

已运行 `npm exec tauri -- bundle --debug --bundles app --ci`（仅关闭 updater 工件），
使用现有构建生成 `src-tauri/target/debug/bundle/macos/PNDS.app`，未编译／替换当前
运行的裸开发可执行文件。标准包有正确的 `com.xo-xn.pnds-app` 标识。首次自动启动
仍超时；用已授权 AppleScript 发出 launch 后，原控制工具已识别新包与
`/Applications/PNDS.app` 的同标识歧义，但精确路径连接仍超时。进程检查表明仍只有
旧开发进程；源码确认单实例插件会把第二次启动交给旧进程并退出，需先结束旧实例。
用户启动的前端服务仍在 1420 监听，agent 未启动开发服务器。

准备向已核对路径的旧开发进程请求正常退出时，自动审批拒绝执行，理由是用户虽已
授权 AppleScript 测试，但尚未明确授权退出；正常退出也可能丢失未保存输入或应用
状态。请求没有执行，当前 App 未关闭。只保存了待审查脚本
`/private/tmp/pnds-quit-development.applescript`；等待用户保存所需内容并明确同意
退出后，才重试该动作。#233 第二组尚未执行，不能记为通过。

## 2026-10-16 #233 自动实机检查：停止与历史用量通过

用户明确确认已保存内容，并授权正常退出旧 PNDS、打开测试包继续自动测试 #233。
旧开发进程已正常退出。仅包装开发二进制的 debug 包仍不适合独立测试，因此又用
`tauri build --debug --bundles app` 构建包含前端资源的标准测试包，exit 0；未启动
dev server。另确认 debug 入口会以相对路径导出绑定，需从 `src-tauri` 工作目录
启动；此为测试包启动限制，未改业务代码，不据此宣称 Finder 启动通过。此前把启动
超时仅归于单实例的判断不完整，保留前述排查过程。

标准包成功通过精确 `.app` 路径连接原 Computer Use 工具，后续点击、输入、停止、
正常退出和重开后的核对均使用原生界面。AppleScript 只用于已授权的退出／启动，
没有通过 System Events 绕过辅助功能权限。用户完成一次新测试包的钥匙串授权。

在 `/Users/xiaoxiang/Desktop/test copy` 找到用户第一组的原始短回复及统计。整数
请求被真实模型简短拒绝，未把该次完成算作停止成功；改用原创舞台音乐说明后，
在正文出现时点击停止。结果如下：

- 已显示的标题、两段正文和末尾未完成句保留，共 396 个 UTF-16 单位（含段落分隔）。
  输入立即保留，消息显示已停止，本机保存完成。
- 尚未收到的单次 usage 显示输入／输出「未知」，整轮「未知／不完整」，没有冒充 0。
- 正常退出并重开同一测试包、同一路径工程后，四段界面文字与退出前逐段完全一致，
  消息仍已停止、已保存，未自动请求或续写；用量改标「历史服务端用量」。
- 第一组已完成回复的数字前后均为一次调用：输入 1,080、输出 81、缓存输入 1,024、
  推理 64；完整状态保留。已停止消息的未知／不完整状态也保持。
- 生成中真实上下文显示容量 1,000,000、有效输入 32,000、输出预留 8,192、分词器
  未知；整包 4,530 字符／6,138 UTF-8 字节，本次输入 120／272，文档分项 0／0。

[最小前后证据与构建指纹](./evidence/233-native-stop-and-usage-2026-10-16.json)
已保留。结合用户回报的第一组，#233 本轮快速实机检查通过；未独立比对账单，
未把此结果外推到双架构／全部主题／正式发行。本组止于 #233，#234／#235 待继续。

## 2026-10-16 #234 自动实机检查：修复后本轮快速检查通过

沿用 #233 的同一标准测试包、Computer Use 原生界面和 `test copy` 工程，不启动
dev server，不修改模型配置或凭据。原界面显示选入 10 条近期原消息、14 条仅留本机。

- 点击整理仅打开范围与本机测量预览，明确说明将调用当前 GLM 服务、最近两轮保留
  原文及摘要可能遗漏。默认范围为 6 条较早消息，6,091 UTF-8 字节；改为一轮后为
  2 条消息，3,838 字节。分词器未知仍显示未知 tokens。
- 轮数为 0 时生成按钮禁用；取消预览后未发送输入保留。
- 首次实际整理在生成中点击停止，回到可操作状态，原文、选入数量和未发送输入保留。
  日志明确记录该次 `Cancelled`，未冒充摘要成功。
- 第二次整理六条消息后，App 报摘要分类／原消息引用校验失败，显示未采用文字，
  原文和输入保留；没有自动重试或采用。该次真实模型返回不能算作成功摘要，原因尚未
  确定。随后显式缩小为一轮重试，结果待核对。
- 为新话题检查在 README 原空白作曲者字段输入临时标记；界面确认未保存，未写磁盘。
  新话题、摘要采用、持久化与测试草稿恢复尚待完成。

一轮重试也被拒绝。通过原生滚动查看完整返回的末尾，确认 JSON／Markdown 结束后
还有 `{"remainingCalls":8,"remainingResultCharacters":24000}`；AX 单个文字节点
只返回前 512 字符，不能据其可见尾部判断模型截断。当前摘要请求沿用了普通文档问答
策略的「最后一行给出预算」及预算 JSON。新增最高请求入口／受控 HTTP 回归先在
该策略断言处失败（22ms），再为摘要使用独立 JSON-only 策略，不放宽结果解析。
定向两个文件／37 项通过；全套检查与新测试包的真实 GLM 复验仍待完成。

重建前已在原生表单中撤掉唯一临时作曲者标记，确认保存按钮禁用、状态恢复「已保存」，
随后正常退出测试包。没有保存测试文件内容或清除聊天历史。

修复后 `npm run check:all` exit 0：前端 157 文件／1,836 项，Rust 合计 573 项通过、
5 项既有忽略；类型、lint、ast-grep、格式和 Clippy 全绿。完整日志
`/private/tmp/pnds-234-check-all.log`。含前端的标准 debug 测试包重建 exit 0，
新可执行文件 SHA-256 为
`c5b06afb5281039e71b92f6dff939508cb662b39f76848f881120cf9ece03b44`。
重开同一工程后原有 10／14 条选入／排除计数恢复，摘要预览为 4,488 字节；
复验调用暂处于凭据准备阶段，已请求用户处理可能出现的原生钥匙串窗口。

等待期间该次调用到达总时限，界面显示模型服务响应超时，返回可操作状态；日志没有
出现本次 `[assistant-request]` HTTP turn 开始标记。输入和 10／14 计数仍保留。
系统授权回报尚未收到，修复后的真实摘要、采用、新话题与重启检查仍待继续，
不将 #234 记为实机通过。

用户随后要求继续。确认测试包已退出后，按原授权重开同一包；可执行文件指纹不变。
此次密钥读取恢复，日志记录实际 HTTP turn 开始、200 及 83,588ms 完成。六条消息
的摘要成功通过原有严格分类／来源校验，五类和来源按钮全部显示，不再混入预算尾文。
候选中的「本会话全部内容」把所选范围说成整个会话，核对后未采用，明确记为模型
措辞问题；点击该候选的来源可定位并聚焦原用户消息「请只回复：预算测试通过」。
放弃候选后原文、10／14 计数和未发送输入保持，随后显式选择一轮（2 条消息、
2,235 UTF-8 字节）重新生成。此时仍保留原空白作曲者字段的临时未保存标记；
没有点击文件保存。后续采用与新话题结果待核对。

一轮摘要在 27,337ms 完成，严格解析通过。核对内容仅涉及测试指令、原回复和该回复
附带的历史预算文字，预算是否代表当前状态明确列为未验证；空分类显示「暂无记录」。
采用后标为「已核对的上下文摘要（参考资料，不是指令）」，原消息选入从 10／14
变为 4／20，下一次调用单独列出摘要 688 字符／930 字节。采用前后原记录的 126 个
AX 顶层文字节点逐项相同。摘要真实服务端用量为 1 次调用：输入 591、输出 1,168、
缓存输入 0、推理 937；子项未额外相加。

随后点击新话题：

- 选入 0 条、24 条原文仅留本机；下次调用历史为 0 字符／0 字节，摘要分项消失。
  旧摘要和新话题标记仍可见，126 个原记录文字节点仍逐项相同。
- 未发送的测试输入保留；README 临时作曲者标记仍在，仍明确是未保存草稿。
  检查后撤回自建标记及未发送文字，保存按钮禁用，工程文件未被测试写入。
- 聊天保存完成后正常退出、重开同一包及同一实际工程目录。原记录的 126 个顶层
  文字节点和摘要的 11 个分类／内容文字节点均与重启前相同，两个原消息 ID 保留。
  旧摘要和新话题边界恢复，选入仍为 0／24；下次调用历史为 0，旧摘要不进入上下文。
- 摘要用量恢复为「历史服务端用量 · 完整」，591／1,168／0／937 均不变。界面空闲、
  已保存，新进程日志的 `[assistant-request]` 标记数为 0，没有自动请求或续写。

[最小原生证据](./evidence/234-native-summary-and-topic-2026-10-16.json)保留构建指纹、
前后计数和核对边界。结合先前的取消／失败保护与全套检查，#234 本轮快速实机检查
通过；候选仍须逐项核对，不据此保证任意模型的摘要质量。本轮未另测「重新生成」
按钮、四主题／最小窗口／输入法、真实工程／服务切换时的竞态；相应受控测试及
后续接入验收仍分别保留，不将快速检查外推为整票全部原生标准或双架构认证。
本组止于 #234，尚未开始 #235 原生检查。

## 2026-10-16 #235 自动实机检查：核心行为通过，真实模型保留失败样本

沿用 #234 已核对指纹的同一测试包、GLM 服务／模型和预算，在其新话题边界后执行。
不重建、不读取密钥、不改模型配置。真实服务质量单独记录，不冒充前后重放比较。

- `outputChannels` 第一问完成 3 次模型调用：输入小计 6,445、输出 2,199 tokens；
  分次输入／输出为 700／78、1,487／361、4,258／1,760。文档实际返回 5,067 个
  UTF-16 单位，本机复用 55，工具结果载荷 8,308。生成中真实载荷的文档／工具
  分项为 10,212 字符／14,429 字节，并未把复用说成零 token。
- 来源区区分纯文本片段和 Markdown 分页，明确范围／小节总长及 App 1.6.5 内容
  SHA-256；可见长页分别为 0–2,000／2,241 和 0–2,000／4,029。两个文档指纹
  与当前本机原文哈希一致。点击 manifest 来源打开本机帮助，URL 保留中文语言与
  精确「可选字段」锚点，截图确认滚动到该标题；没有联网打开文档。
- 回答说明可选、缺省 2、1..=64、N／H／K 关系及 bus 约束，并明确列出未读尾部；
  未把部分读取说成整节读完。其预算尾文是模型文字，不能当作 App 实际计数证据。
- 首次重叠页追问被本机 `invalidTool` 校验拒绝，输入保留、无自动重试。尚无该次
  实际工具参数证据，不把原因武断归为某一字段。由真实来源按钮确认准确小节锚点后，
  显式提供该 ID 重试；失败样本保留。
- 重试实际返回 Markdown 范围 1,800–3,000 和 3,000–3,200，均属于同一 4,029
  单位小节和同一内容版本；两次请求页原范围为 1,800–3,000、2,000–3,200。
  界面记录只新返回 1,400 个单位、复用 1,000，工具结果载荷 2,397，证明同请求
  重叠原文未再次发送；后续模型调用仍有非零文档／工具载荷。最终答复与其余问题待核对。

重叠页重试随后按 `nextOffset` 读取 3,200–4,029 尾页，累计新返回 2,229、复用
1,000、工具结果载荷 3,665；真实上下文的文档／工具分项为 4,912 字符／6,503
字节。模型在写答复时触及 120 秒总时限，App 保留已显示文字、输入及三个来源，
标明中断和未知／不完整用量。前两次服务调用合计输入 4,176／输出 1,909，第三次
未收到统计，不能补零或算作整轮成功。部分回答的开头把「1800–4029 到节末」称为
全文范围，未完成的未读范围说明不能纠正这句，因此也不将其记为完整、可靠的质量样本。
这次保留为真实服务失败，同时证明总时限和中断证据保护未被绕开。

临时切换英文界面后核对英文装机语料：完成 3 次调用，输入 6,588／输出 1,573；
新返回 1,161、复用 0、工具结果载荷 3,786。英文 Audio Modes 文档 SHA-256
`65ce1e9a4e3025631e8f84452613b7a0484a0b086a8a85f46731dc336bc9f2cc`、
Runtime Contract 的
`1913385e9af5c82c2f60b86ffd04db39843011de8e0e384ee86df9d26d951681`
均与本机英文原文相同，与中文版本分开。该回答只读了 Audio Modes，准确说明运行
契约 §6 尚未读取，未编造启动／OSC／master stage 细节；但也未完整满足三列比较。
随后显式补读该短节并查询不存在功能的证据，结果及恢复中文后的来源导航待核对。

最后一问直接补读 `reference-runtime-contract` 的 `6-audio-modes`：来源显示
Markdown 0–468／468，三模式的 scsynth、OSC target、master stage 三列均与
原文一致。另检索虚构名称 `PNDS Quantum Telepathy Bridge v9`，只返回三个一般
帮助片段；模型明确没有该功能的支持证据、未编造启用步骤。回答中的「appears
uninstalled」仅是模型推断，资料缺失不能证明机器安装状态，不作为验收事实。
该轮完整完成 2 次调用：输入 4,398／输出 504，实际返回 690、复用 0、工具结果
载荷 2,240。没有强制固定句子或把一般搜索命中伪称该功能已被文档证明。

恢复简体中文后，英文来源的文档标题／版本仍保留；点击仍以 `locale=en` 打开
`reference-runtime-contract#6-audio-modes`，截图确认原节表格定位正确。关闭本轮
打开的帮助窗口，App 留在原测试工程的中文助手，空输入、空闲、聊天已保存。

[原生最小证据与失败样本](./evidence/235-native-document-reading-2026-10-16.json)
已保留。本轮 #235 核心分页、同请求去重、非零复用计量、来源／语言／版本定位、
补读与缺失资料反馈均取得原生证据；真实 GLM 问答不是全部一次成功，保留一次
`invalidTool` 与一次总时限失败，以及回答不完整／措辞过满等质量观察。没有提高
预算、隐藏失败或据此关闭 issue。前后载荷比较仍使用上文同条件受控重放，不声称
另做了旧版真实 GLM 对照、账单比对或真实 HTTP 全载荷抓取。

#232 → #233 → #234 → #235 本轮快速实机检查按顺序结束。#235 未改业务代码，
沿用 #234 修复后全套 `check:all` exit 0；本轮新增文档／JSON 另通过 Prettier 和
`git diff --check`。Intel、四主题／最小窗口／输入法、版本更新时的真实切换竞态及
后续工程读取接入仍不由本轮快速结果外推，模型回答质量也不因核心机制通过而保证。

## Assistant UI follow-up (2026-10-16)

The user's five follow-up requests are implemented: end-aligned dark user bubbles,
full-width assistant text without cards, edit-and-resend as a new chat branch,
immediate composer clearing with failure/stop recovery, a compact context ring,
and a project-local chat selector for returning to earlier discussions. The
original chat and later messages are preserved when branching. Existing topic
markers are backward-compatible chat boundaries; no history migration is needed.

Controlled regressions cover isolation when continuing an older chat, all-chat
saving and restoration, summary-source remapping in branches, per-chat drafts,
late responses after switching, edit/cancel/focus, and known/unknown context
indicators. The supported text edit action excludes messages carrying attachment
or proposal snapshots, so it cannot silently resend old project authorization.

Native verification used the updated debug app bundle (launched from `src-tauri`,
not a dev server), with existing `test copy` history. Verified: restored three
chat choices; selecting the prior chat restored its messages; dark rounded user
bubble and unboxed assistant layout; Edit populated/focused the composer and
showed “send as new chat”; Cancel restored the prior empty input; context popup
showed unknown usage against the configured 1,000,000-token capacity. Native
verification did not submit a new paid model request; fork payload, clear-on-send,
stop/failure and late-result behavior are covered at the approved controlled
request/store boundary. GLM's unknown tokenizer deliberately has no percentage.

Two-axis review used the round-start workspace snapshot, excluding earlier WIP.
Spec review reported no actionable findings. Standards review identified the
Edit control's focus contrast against the dark bubble; this was fixed with
surface-specific focus ink and four-theme contrast coverage.

Final validation: `npm run check:all` passed serially (157 frontend files,
1,847 tests; 573 Rust tests passed and 5 ignored). A concurrent packaging run
initially invalidated Rust documentation-test dependencies; the complete serial
rerun passed including documentation tests. The final debug bundle was rebuilt
and opened successfully; its executable SHA-256 is
`2b429ed7f29159dea798781b2056d27bf740448bf69512fccbfdc09ef5e67d5d`.
Native switching also preserved a chat-specific unsent test draft; the draft was
removed and the final app was left idle on an earlier chat with an empty composer.
No new paid model request or Git commit was made for this UI follow-up.

### Lighter chat palette follow-up

Pond, Sand and Brutal user bubbles now use light blue-gray (`#d8e6f1`),
warm beige (`#dccbb4`) and light amber (`#ffd987`) with their themes' dark
text, secondary text and error ink. Stage keeps its existing palette. All
100 palette checks passed, including message text, code and focus contrast.
The updated bundle was viewed natively in all three revised themes, then
returned to the user's Pond theme and fourth chat with its unsent draft restored.

### Composer keys and continuous context ring

The assistant now sends on Enter and inserts a newline on Shift+Enter. Both
composition-state Enter and WebKit's key-code 229 confirmation are excluded;
Chinese and English hints match the new behavior. Targeted component regressions
passed (24 tests across the discussion and context UI files), including dispatch
of the Enter send action, newline preservation and IME confirmation guards.

The context indicator always has a continuous faint background circle, with a
single used-fraction arc only when the token count is known. It no longer shows
a segmented track for unknown usage. The updated native bundle was checked for
the new hint, real Shift+Enter line breaks and the continuous unknown-usage ring;
the temporary input was removed. Sending is verified at the controlled store
boundary without making another paid request during this native check.

### Provider-independent estimates and the Smart zone scale

The user approved a generic display estimate for every model service. Native
measurement now publishes `referenceEstimatedTokens` from the bundled o200k_base
encoder when no encoder is selected; explicit encoder estimates retain priority.
Both count the same assembled request. Unknown-encoder byte-conservative
admission, configured capacity, hard limits and historical server usage keep
their existing meanings. The estimator makes no model-name capacity inference,
credential lookup, network probe or paid request.

The ring and its adjacent number explicitly say “Estimated” / “估算”. Small
nonzero values below 0.1% retain a “<0.1%” label. A missing capacity is described
explicitly. Green covers 0–20%; the color interpolates to amber at 60% and red
at 100%, then saturates. Theme-specific status inks supply the endpoints, with
4.5:1 text contrast verified for intermediate blends across all four themes.
The popup labels Smart zone at up to 20%, then gives focused-discussion and
context-organization/new-chat guidance; app-budget errors suppress zone hints.

Public native measurement regressions cover different model IDs, mixed
Chinese/English/code/emoji input, reference/selected-encoder consistency and
continued rejection before HTTP when the conservative target is exceeded.
Component regressions cover visible estimation labels, tiny fractions, capacity
requirements, selected-count precedence and the scale's endpoints/midpoints.
Two-axis review against this round's initial workspace snapshot found no
Standards or Spec findings. Earlier work-in-progress was excluded from that diff.

Native verification with the user's unchanged GLM configuration and 1,000,000
configured capacity showed a green “估算 0.1%” indicator and 1,236 reference
tokens, plus the generic-estimate qualification and Smart zone text. The original
first chat and empty composer were restored. No paid model request was made.

Final `env RUST_TEST_THREADS=1 npm run check:all` passed: 157 frontend files /
1,862 tests, 574 Rust tests passed and 5 ignored. The initial parallel run hit a
pre-existing temporary-port collision in `controlled_cli`; the complete serial
run preserved every test and assertion and passed including doc tests.
