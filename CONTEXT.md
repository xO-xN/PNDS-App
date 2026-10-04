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

**演出模式 / Performance mode**:
PNDS App 面向现场演出场景的界面模式。
_Avoid_: 演奏者模式、Performer mode

**创作模式 / Creation mode**:
PNDS App 面向创作者开发和测试工程场景的界面模式。
_Avoid_: Creator Persona

**空白工程 / Blank project**:
创作者通过 App 的「新建工程」在指定位置生成、具备 PNDS 基本运行结构而尚无作品内容的文件夹工程。
_Avoid_: 简版模板、空白 Template

**工程概况 / Project overview**:
创作模式中概括当前工程身份、内容迹象与已知验证结果的事实摘要，供创作者与内置助手理解工程现状。
_Avoid_: 完成度评分、作品是否完成的结论

**创作交接单 / Creator handoff**:
创作者在 PNDS App 中记录、供外部编程 agent 接续的工程待办与创作意图。
_Avoid_: 实现手册、工程 README

**performer / monitor**:
工程内两种页面角色（performer 页与 monitor 页）。中英文均直接用英文。

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
跨互联网演奏中一台演出机器在房间内的身份名：App 全局设定、演出前必须显式填好，同房间内唯一。
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

**参考手册 / Reference Manual**:
帮助语料中的 reference 分册：面向工程的契约文档（manifest、runtime、bundle、network 等）。
_Avoid_: specification、wiki

**模块手册 / Module Manual**:
帮助语料的第四本书：面向创作者逐个讲解 PNDS Template 自带模块的用途与用法。
_Avoid_: 模块指南、模板模块（作册名）

**内置工具 / built-in utility**:
随 App 分发、即装即用的工具工程（如 Multichannel Signal Generator），固定收纳在侧栏 Utilities 文件夹；成员与顺序由 App 注册表决定，用户不可调整。
_Avoid_: 插件、addon、实用工具（作统称）

**App 共享包 / App shared package**:
由 PNDS App 保存并供多个工程引用的依赖资源，可包含库与模型；工程也可选择携带自己的依赖资源。
_Avoid_: 内置工具（指依赖资源时）、工程包（指共享依赖时）

**加入共享包 / Add shared package**:
在工程中建立对 App 共享包的使用引用，资源文件仍由 App 保存。
_Avoid_: 移动包、复制包（指建立引用时）

**帮助中心 / Help Center**:
App 内的帮助窗口，浏览帮助语料四本书：教程、创作者指南、参考手册、模块手册。

**帮助语料 / Help corpus**:
帮助中心内可浏览的全部文档，中英双语成对维护，读者按界面语言取用对应语言版本。装机语料路径（`help/<tree>/…`）同时是创作者 AI agent 的本地契约文档来源（见 ADR-0003），是对外接口。

**实现手册 / Implementation Manual**:
PNDS Template 仓库中描述模板示例工程的文档（`docs/implementation.md`）：示例行为规格、目录职责、「创作时改哪里」。与帮助语料的「创作指南」（工作流）互指分工。
_Avoid_: creator-guide（旧名）、handoff（已并入 Template 的 AGENTS.md）

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
