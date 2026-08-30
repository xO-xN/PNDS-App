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

**performer / monitor**:
工程内两种页面角色（performer 页与 monitor 页）。中英文均直接用英文。

**座位 / seat**:
乐手的稳定演出位：claim token 对应的 id 与输出通道的组合，跨工程重启持久化；monitor 页可移座或重置。中文文档用「座位」，代码与文件名用 seat。
_Avoid_: 位置、席位、slot

**claim token**:
乐手加入工程时持有的身份令牌（字符串），断线重连凭它取回原座位。中英文均直接用英文。
_Avoid_: 认领令牌、identity token

**参考手册 / Reference Manual**:
帮助语料中的 reference 分册：面向工程的契约文档（manifest、runtime、bundle、network 等）。
_Avoid_: specification、wiki

**模块手册 / Module Manual**:
帮助语料的第四本书：面向创作者逐个讲解 PNDS Template 自带模块的用途与用法。
_Avoid_: 模块指南、模板模块（作册名）

**内置工具 / built-in utility**:
随 App 分发、即装即用的工具工程（如 Multichannel Signal Generator），固定收纳在侧栏 Utilities 文件夹；成员与顺序由 App 注册表决定，用户不可调整。
_Avoid_: 插件、addon、实用工具（作统称）

**帮助中心 / Help Center**:
App 内的帮助窗口，浏览帮助语料四本书：教程、创作者指南、参考手册、模块手册。

**帮助语料 / Help corpus**:
帮助中心内可浏览的全部文档，中英双语成对维护，读者按界面语言取用对应语言版本。
