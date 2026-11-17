# PNDS App

演出现场运行 PNDS 数字乐谱工程的 macOS 桌面 Host。本词汇表锁定 UI 文案、文档与翻译共用的语言。

## Language

**PNDS 池谱**：
产品的中文名。「池谱」只是给中文用户的解释性后缀，绝不单独出现，永远写全「PNDS 池谱」。
_Avoid_: 池谱（单独出现）、PNDS Pool、Pool Score

**PNDS**:
产品的英文名，英文文案与文档一律单独使用 PNDS。
_Avoid_: PNDS Pool、Pool Score、PNDS Stage

**工程 / Project**:
乐手打开并演出的操作单元：一个包含 manifest、谱面页面与音频配置的目录（或安装后的 .pnds 包）。中文 UI 用「工程」或「PNDS 池谱工程」。
_Avoid_: 池谱（当作物体名）、score（指工程）、作品

**工程版本 / Project version**:
创作者主动保存的某个工程内容状态，是比较、切换及继续创作的起点。它与 App 自身的发布版本、聊天记录和交接基线分别独立。
_Avoid_: 聊天快照、工程副本（指已保存的工程版本时）

**初始工程版本 / Initial project version**:
新建工程时记录的第一个工程内容状态，是创作者开始编辑前的基线。
_Avoid_: 模板版本（指新工程自身的初始状态时）

**当前工程版本 / Current project version**:
当前工程内容所处的已保存版本，尚未记录的修改可以叠加其上。仅选中一个历史版本查看详情，不会改变当前工程版本。
_Avoid_: 选中版本（指当前工程版本时）、运行中版本（运行状态未经核对时）

**版本名称 / Version name**:
创作者用来识别工程版本的可编辑显示名称。更名保持该版本的工程内容及版本之间的关系。
_Avoid_: App 版本号、分支名（指版本的显示名称时）

**创作路线 / Creative route**:
在同一个工程里沿一系列工程版本继续创作的路径。创作者可以从旧版本开始另一条路线，并保留原路线。
_Avoid_: 工程副本（指另一路线时）

**工程版本合并 / Project version merge**:
将另一个工程版本的内容和历史关系整合进当前创作路线的操作。两条路线已经分叉时，合并后的工程版本同时承接双方历史。
_Avoid_: 文件覆盖、版本切换（指合并时）

**合并候选 / Merge candidate**:
工程版本合并过程中供创作者审阅和调整的待应用结果。最终确认前，它独立于当前工程文件及已保存的工程版本。
_Avoid_: 工程文件草稿、当前工程版本（指待应用结果时）

**快进 / Fast-forward**:
当前工程版本位于合入版本的历史中时，直接前进到该已有版本，不额外创建工程版本。
_Avoid_: 新建合并版本（指快进时）

**候选测试 / Candidate test**:
最终合并前，运行合并候选的一个确定内容状态，供创作者观察、试听和交互。后续修改候选不会让先前测试自动代表新内容。
_Avoid_: 已完成合并、测试已通过（仅因服务已启动时）

**GitHub 仓库绑定 / GitHub repository link**:
一个本地工程与创作者为它选定的 GitHub 仓库之间的对应关系。
_Avoid_: GitHub 登录（指工程与仓库的关系时）

**GitHub 备份 / GitHub backup**:
将当前创作路线已保存的工程版本上传到绑定的 GitHub 仓库。覆盖范围是该路线的 Git 历史及其中的文件。
_Avoid_: 完整工程备份、作品发行

**PNDS GitHub 模板 / PNDS GitHub template**:
用于在 GitHub 创建工程仓库并保留模板来源的官方仓库。支持从 GitHub 开始创作，也用于 App 为工程首次建仓。
_Avoid_: 空白工程（指 GitHub 模板仓库时）、工程仓库（指由模板创建的仓库时）

**公开工程目录 / Public project directory**:
由创作者主动加入的公开 PNDS 工程仓库集合。仓库公开与加入目录是两个独立选择。
_Avoid_: 全部 PNDS 工程、GitHub 备份（指加入目录时）

**从 GitHub 更新 / Update from GitHub**:
把已有本地工程的当前分支推进到对应的 GitHub 分支版本。
_Avoid_: GitHub 备份、克隆工程（指更新已有本地分支时）

**从 GitHub 克隆工程 / Clone project from GitHub**:
从 GitHub 仓库在本机新建可编辑的工程文件夹，包含工程文件与 Git 历史。
_Avoid_: 从 GitHub 更新、安装工程包

**数字乐谱 / Digital Score**:
网络原生的数字乐谱——工程所实现的艺术形式（领域标准用法：Craig Vear, _The Digital Score_；EU DigiScore 项目）。
_Avoid_: electronic score、digital sheet、e-score

**网络数字乐谱演奏平台 / The Platform for Network Digital Score**:
产品定位语，用作欢迎页副标题。

**`.pnds` 工程包 / `.pnds` bundle**:
工程的打包分发形态，安装进 App 后成为可演出的工程。
_Avoid_: archive、zip、package file

**演出 / Performance**:
从加载工程到关停的一次运行，乐手视角的说法。内部技术生命周期叫 session；面向用户的文案只说「演出 / performance」。
_Avoid_: show、gig、session（面向用户的文案）

**演奏记录 / Performance recording**:
供回放使用、按时间组织的演奏信息；可以来自真实演出，也可以由创作者逐遍叠加演奏形成。回放时依据这些信息实时生成声音。
_Avoid_: 音频录音、工程版本（指演奏记录时）

**记录演奏者 / Recorded performer**:
演奏记录中一份独立演奏的身份，与工程的乐谱选择序号分别表达。同一设备逐遍叠加可以形成多个记录演奏者，同一乐谱选择序号也可以被多个记录演奏者使用。
_Avoid_: 乐谱选择序号、设备编号（指记录演奏者时）

**乐谱选择序号 / Score selection number**:
由工程定义、用户在演奏端选择的谱面或演奏角色编号。是否允许多人选择同一序号由工程决定，序号本身不代表记录中的独立演奏者。
_Avoid_: 记录演奏者、设备身份（指乐谱选择序号时）

**记录时间 / Recording elapsed time**:
演奏记录内持续前进的经过时间，包含准备等待与乐谱暂停期间；乐谱定位不会令记录时间倒退。
_Avoid_: 乐谱进度、作品播放位置（指记录时间时）

**乐谱进度 / Score position**:
工程表达的乐谱进行位置，可受指挥的暂停与定位控制；它与演奏记录的经过时间分别表达。
_Avoid_: 记录时间、录制时长（指乐谱进度时）

**叠加录制 / Overdub recording**:
播放已有演奏信息的同时新增一轮演奏，合成一份包含各轮内容的演奏记录；每轮可以由一人或多人共同录制。
_Avoid_: 演出分支、重复录制（指已有内容被继承时）

**录制轮次 / Recording pass**:
从一次开始录制到该次结束所形成的一轮演奏内容，可以包含一人或多人。它是演奏记录内独立管理、删除和重录的单位，与参与设备及乐谱选择序号分别表达。
_Avoid_: 演奏者编号、轨道（指一轮可含多人演奏的内容时）

**整轮重录 / Rerecord pass**:
用新录的一轮演奏完整替换选定轮次的演奏内容，保留其他轮次。原轮次即使包含多人，也作为整体被替换。
_Avoid_: 整位重录、片段覆盖（指整轮替换时）

**本地演出 / Local performance**:
参与设备通过场地局域网连接的演出；池客连接另一台池主，仍属于本地演出。
_Avoid_: 远程演出（指局域网池客参与时）、跨互联网演出（指局域网连接时）

**演出模式 / Performance mode**:
PNDS App 面向现场演出场景的界面模式。
_Avoid_: 演奏者模式、Performer mode

**池主 / PNDS Host**:
在一场演出中提供工程运行与参与入口的 PNDS App 角色。
_Avoid_: 池客、节点（指演出角色时）

**池主身份 / Host identity**:
区分不同池主的稳定身份；修改节点名、网络地址或当前工程不改变这项身份。
_Avoid_: 节点名、IP 地址、工程身份（作为池主身份的替代时）

**演出身份 / Performance identity**:
区分池主每一次演出的身份；关闭后重新开始，即使工程相同，也属于新的演出身份，普通网络中断不改变它。
_Avoid_: 工程 ID、池主身份（指一次演出时）

**池客 / PNDS Client**:
连接池主提供的演出并使用演奏端页面参与的 PNDS App 角色；池客角色与工程分配的座位身份分别表达。
_Avoid_: 演奏者模式、performer（指 App 角色时）、座位（指 App 角色时）

**创作模式 / Creation mode**:
PNDS App 面向创作者开发和测试工程场景的界面模式。
_Avoid_: Creator Persona

**空白工程 / Blank project**:
从 Blank 初始化、具备 PNDS 基本运行结构而尚无作品内容的工程。
_Avoid_: 简版工程

**标准技术模块 / Standard technical module**:
供工程按需接入通用技术能力的源码，加入后由工程维护。
_Avoid_: App 共享包（指可接入技术能力时）

**工程概况 / Project overview**:
创作模式中概括当前工程身份、内容迹象与已知验证结果的事实摘要，供创作者与内置助手理解工程现状。
_Avoid_: 完成度评分、作品是否完成的结论

**PNDS 创作助手 / Creation assistant**:
PNDS App 中围绕当前工程与创作者讨论创作意图、完善方案并按明确任务修改工程的助手；创作者也可通过创作交接单将任务交给外部编程 agent 接续。
助手栏使用完整名称，行文中可简称“创作助手”。
_Avoid_: 只读咨询助手、通用编程 agent（指 App 内置助手时）

**讨论 / Discussion**:
创作助手围绕当前工程推敲创作意图、澄清选择及完善方案的工作方式。
_Avoid_: handoff（指讨论方式时）、交接模式

**工作 / Work**:
创作助手按创作者明确指派的当前任务实施工程修改的工作方式。
_Avoid_: 编辑、编程、实现并保存（指助手模式名称时）、创作模式（指助手的工作方式时）

**工程终端 / Project terminal**:
创作模式中供创作者围绕当前可编辑工程执行命令、使用编程 agent 的交互工具。
_Avoid_: 控制台、内置工具（指工程终端时）、创作助手工作模式

**终端会话 / Terminal session**:
工程终端中归属于某一工程、承载持续命令交互的上下文。它与一次演出及交给 agent 的方案分别独立。
_Avoid_: 演出、工作模式、任务记录（指命令交互上下文时）

**终端任务文件 / Terminal task file**:
交给编程 agent 读取的单次已确认方案及其上下文入口说明。它与包含多项未完成任务的创作交接单分别独立。
_Avoid_: 创作交接单、完整聊天记录（指单次终端任务文件时）

**创作助手技能 / Creation assistant skill**:
PNDS 提供的一组创作任务指令，由创作者在助手输入框中以 `@` 加名称调用。

**文件引用 / File reference**:
创作者为一条创作助手消息明确选定的工程保存版文件或待用资源，作为该次请求的依据。

**创作资源 / Creation resources**:
创作模式左侧栏中存放当前工程待用文件的分组。

**收件箱 / Inbox**:
创作资源中接收外部文件副本的入口。

**创作资源接入 / Creation resource integration**:
创作助手根据当前工程和任务用途，将待用资源纳入工程，并调整使用该资源的代码或引用。

**待处理文档 / Pending documents**:
创作者为当前工程保存、等待结合创作任务使用或接入的代码或文本文档。它与已经接入工程的文件相区别。
_Avoid_: 创作资料（新功能名称）、临时文件、工程资产（指尚未接入的文档时）

**待处理文档接入 / Pending document integration**:
将选定待处理文档纳入工程代码或工程文档，并建立其必要入口和引用关系的创作操作。
_Avoid_: 导入（指完成工程接线时）、移动文件（指整次接入时）

**修改建议 / Change proposal**:
创作讨论中针对一个已有文本文件、可由创作者通过参数或代码继续调整的待应用内容；它与工程文件草稿、保存版和已执行差异分别表达。
_Avoid_: 已执行改动、文件草稿（指待应用建议时）

**临时预演 / Temporary preview**:
在工程支持的范围内，供创作者体验待应用修改效果的临时呈现，不代表工程已保存或正式运行已采用该修改。
_Avoid_: 已应用、已保存、运行验证通过（指临时体验效果时）

**创作交接单 / Creator handoff**:
创作者在 PNDS App 中记录、当前供外部编程 agent 接续的未完成工程任务与已确认创作意图清单。
_Avoid_: 实现手册、工程 README

**交接基线 / Handoff baseline**:
创作者确认写入交接单时已保存的工程内容，是核对该次交接之后工程变化的初始比较起点，不代表实施完成或验证通过。
_Avoid_: Git HEAD、恢复点、最终执行报告（指交接比较起点时）

**交接历史 / Handoff history**:
保留已替换交接内容或已实施任务最终记录的归档，供回溯；它与当前未完成任务清单和交接基线分别独立。
_Avoid_: 当前待办、交接基线（指历史归档时）

**performer / monitor**:
工程内两种页面角色（performer 页与 monitor 页）。中英文均直接用英文。

**演奏端连接 / Performer connection**:
演奏端已被工程的加入规则接纳且仍在线的状态。页面导航结束本身不代表建立演奏端连接。
_Avoid_: 页面就绪、加载成功（指演奏端连接时）

以下入口与断线演奏术语的当前实现边界见 [浏览器参与](docs/developer/browser-participation.md) 与 [原生池客持续性](docs/developer/native-client-continuity.md)；发行与实机验收状态见 `docs/acceptance/`。

**演奏入口 / Performance entry**:
池主向浏览器演奏端与原生池客共同提供、归属于该池主的参与入口；演奏者从这里查看当前工程并选择进入一次演出。
_Avoid_: LAN IP、QR IP、工程包地址（指参与入口时）

**浏览器演奏端 / Browser performer**:
通过浏览器或浏览器提供的独立窗口使用演奏入口、参与工程演奏的方式；保存主屏幕或桌面入口是演奏者的可选操作。
_Avoid_: 池客（指 PNDS App 角色时）、完整 PWA（概括所有浏览器参与方式时）

**演奏端二维码 / Performer QR code**:
供设备扫码接入、内容为完整网址的二维码；演出时指向池主演奏入口，创作测试时指向当前测试运行的 performer 页。
_Avoid_: QR 模块（指 App 的二维码显示功能时）、工程包（指二维码功能时）

**断线继续演奏 / Performance continuation after disconnect**:
演奏设备与池主失联后，已经打开的工程依照自身规则继续演奏的能力；这不等于设备已保存完整工程资源或可以离线重新打开工程。
_Avoid_: 自动重连、完整离线运行（指仅保持已打开工程继续运行时）

**页面交互 / page interaction**:
工程页面（monitor 与 performer）可依赖的交互事件边界：哪些键盘、指针、触摸、右键事件归页面，哪些被 App 或 macOS 永久保留。
_Avoid_: 输入通道、input channel、快捷键表（作统称）

**座位 / seat**:
乐手的稳定演出位：claim token 对应的 id 与输出通道的组合，跨工程重启持久化；monitor 页可移座或重置。中文文档用「座位」，代码与文件名用 seat。
_Avoid_: 位置、席位、slot

**claim token**:
乐手加入工程时持有的身份令牌（字符串），断线重连凭它取回原座位。中英文均直接用英文。
_Avoid_: 认领令牌、identity token

**节点 / node**:
一台演出机器由操作者显式设定的身份名：本地演出用于识别池主，跨互联网演奏用于标识房间内的节点，同房间内唯一。
_Avoid_: site、站点、设备名

**房间 / room**:
hub 上按消息隔离的分区：由正在演出的工程与其分组号共同决定（用户只选分组号，不手填房间名），同房间互相可见，跨房间互不可见。
_Avoid_: 群组、channel、房间字符串

**hub 地址**:
跨互联网演奏中继服务（hub）的完整 URL，含协议与端口；App 全局配置，token 永不拼入其中。
_Avoid_: hub IP、服务器地址

**演奏者地址 / performer address**:
manifest 可选字段 `performerAddress` 声明的连接地址字符串（如 `mywork.local`）：存在时替换 App 注入的 `PNDS_HOST_IP` 与 monitor 地址，二维码显示它；未声明回落所选 LAN IPv4。裸主机名（不带协议/端口），工程零改动。
_Avoid_: 自定义域名、连接 URL、host IP（作声明名）

**演出映射 / performance mapping**:
演出域名与本次演出机器所选局域网地址的临时对应关系，由当前演出持有，供乐手通过域名加入。
_Avoid_: 域名配置（指临时演出映射时）、普通 DNS 转发

**参考手册 / Reference Manual**:
帮助语料中的 reference 分册：面向工程的契约文档（manifest、runtime、bundle、network 等）。
_Avoid_: specification、wiki

**模块手册 / Module Manual**:
帮助语料的第四本书：说明工程默认基础与可选能力的采用和接线。
_Avoid_: 模块指南、模板模块（作册名）

**内置工具 / built-in utility**:
随 App 分发、即装即用的工具工程（如 Multichannel Signal Generator），通过侧栏独立“工具”入口浏览；随包成员与默认顺序由 App 注册表决定。
_Avoid_: 插件、addon、实用工具（作统称）

**App 共享包 / App shared package**:
由 PNDS App 保存并供多个工程引用的第三方依赖库；工程也可选择携带自己的依赖，模型属于工程自带资源。
_Avoid_: 内置工具（指依赖资源时）、工程包（指共享依赖时）

**加入共享包 / Add shared package**:
在工程中建立对 App 共享包的使用引用，资源文件仍由 App 保存。
_Avoid_: 移动包、复制包（指建立引用时）

**帮助中心 / Help Center**:
App 内的帮助窗口，浏览帮助语料四本书：教程、创作者指南、参考手册、模块手册。

**帮助语料 / Help corpus**:
帮助中心内可浏览的全部文档，中英双语成对维护，读者按界面语言取用对应语言版本。装机语料路径（`help/<tree>/…`）同时是创作者 AI agent 的本地契约文档来源（见 ADR-0003），是对外接口。

**工程实现说明 / Project implementation guide**:
工程内的 `docs/implementation.md`，记录已确认作品规则、参数含义和修改位置。
_Avoid_: 创作交接单（指实现说明时）

**投影窗口 / projection window**:
面向场地屏幕的演出显示窗口：原生标题栏、单实例、跨工程保持原位与全屏，由侧栏按钮打开；内容经「投影开演」门控，主窗口 monitor 显示不受影响。设计决策见 ADR-0006。
_Avoid_: monitor 窗口、外部窗口、镜像窗口、浏览器 monitor

**投影开演 / projection start**:
指挥在主窗口触发的投影内容切换动作（▶ 按钮 / ⌘⏎），可反向：投影窗口在「简介」与 monitor 页之间渐变过渡。
_Avoid_: 开始演出（指该动作时）、start show

**投影已开演 / projection started**:
「投影开演」后的状态：按钮常亮绿，投影窗口显示 monitor 页；session 级，每次 Load / 切换工程重置回简介态。
_Avoid_: 演出中（指投影状态时）

**投影待机 / projection standby**:
无运行工程时投影窗口的状态（错误态同此）：主题底色 + PNDS 标识 + 「无演出」。
_Avoid_: 屏保、no-signal 画面

**简介 / intro**:
投影开演前投影窗口的状态与内容：渲染工程根目录 `README.md`——封面格式与主窗口 README 面板同版式（含封面图），其余为文本文档视图；无 README 时回落工程名卡片。
_Avoid_: README 页（作状态名）、封面

**投影面 / surface**:
monitor 页正被投影窗口加载到场地屏幕这一事实，由首帧查询参数 `?surface=venue` 表达（运行契约 §14）：工程可选按它分支渲染观众画面，未适配工程与主窗画面一致；取值集合从 `venue` 起步，工程必须容忍未知取值。
_Avoid_: 投影模式、屏幕类型、venue 页
