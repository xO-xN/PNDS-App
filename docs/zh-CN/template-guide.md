# PNDS Template 创作指南

本文档将引导你基于 PNDS Template 从零开始创建、开发并发布一个 PNDS 池谱作品。

---

## 在 App 中从 Blank 或 PNDS Classic 新建工程

创作首页与「切换其他工程」选择器均提供**新建工程**。填写工程名称、新文件夹名称、可选创作者与简介，再用原生目录选择器选择已有父目录。App 创建新的可编辑文件夹，已有文件或目录不会被覆盖。

文件夹名称中的英文大写字母会自动转为小写，预览显示实际创建位置；作品名称保持原写法。空名称、非法字符或首尾连字符会显示行内原因，修正后可继续创建。文件夹名称最多 64 字符。

下次新建会默认上次选定的父目录，App 重启后也会恢复。取消表单或原生目录选择不会清除该记录；旧目录已移除或无法访问时，创建显示真实错误，请重新选择父目录后重试。

**Blank 是唯一新建起点**，提供没有艺术预设的最小可运行结构。Express 5.3.0 承担受限 HTTP 路由，Socket.IO 4.8.4 承担实时连接，osc-min 2.1.2 承担 OSC 编解码；三库离线使用 App 的确切已校验共享资源，不运行 npm 安装，不下载缺失运行资源。页面、脚本和样式分离，保留本地参数预演适配器、空参数声明和真实已加载源码快照。Internal 向注入的私有 bus 写静音；External 在作者定义作品协议前不发音乐消息；随附 SCD 源及一致的预编译 SynthDef。创建后请手动测试 Internal、External 或 None；手机行为和真实声音仍需设备验收。

既有 Classic、Template 衍生和自包含工程继续支持按原方式打开文件夹、安装 `.pnds`、编辑、运行和分发。App 不迁移、覆盖或删除其源码、身份、版本历史和艺术选择；独立 PNDS Template 维护源保留。

新建 Blank 支持统一浏览器／PNDS Client 入口。演奏者每场明确进入，静态资源与实时连接来自同一已确认入口；页面准备与工程接纳分别表达。HTTP 不增加安全上下文能力，既有 HTTPS 路径保留。

每次创建生成独立工程 ID 和初始 Git 版本，即使不同父目录使用相同文件夹名也不会共用身份。新工程从 0.1.0 开始，不继承旧 Git 历史或设备缓存；来源记录在 `docs/template-source.json`。App 创建的工程已经初始化，外部 agent 从 AGENTS 与创作交接单接续，不重新执行 `docs/start.md`。打开已有工程保留身份和历史；App 更新不会改写已创建工程。

Blank 的初始 `README.md` 使用创建时的 App 语言，只包含实际填写的简介，未填写时留空；其他界面语言可回落读取它。语言变体按需添加，新建不生成翻译待办；正式记录交接时再创建 `docs/creator-handoff.md`。根 AGENTS 指向工程实现说明及装机 App 契约。交接单与来源记录留在源工程，根 docs 不进入 `.pnds`。改动 SCD 后，再用 App 编译工具并按提示准备本机 SuperCollider。

生成的 `docs/implementation.md` 说明文件分工、实际参数回调的登记方法和刷新／重启边界。公共 HTML、脚本、样式保存后刷新加载；修改 Node server 后重启工程。p5 等依赖按任务需要在本地添加。已有工程保留原布局和模板来源版本。

取消目录、表单或放弃草稿确认会保留旧工程、草稿与运行。目录冲突、权限或部分创建失败不会发布残缺工程；完整目录已创建但工作台采用失败时，错误显示位置，可稍后重新打开。成功进入工作台**不自动启动**，并以工程名称登记演出 Home 列表首位；切回演出后手动选卡和加载，登记列表会跨 App 重启保留。

## App 本地版本与历史

工程版本保存、查看与恢复的完整操作见[使用教程：工程版本与历史](./app-tutorial.md#工程版本与历史)。每个创作里程碑可手动保存版本；查看历史不改变当前文件，切换版本才改变工程内容。Git 版本不是交接比较基线，也不代表运行或声音验收通过。

## 准备工作

在开始之前，请确保本地已具备以下环境：

- **PNDS App 最新版**：已安装并可正常运行
- **Node.js 24**：只有在 App 外运行开发工具或安装工程自带依赖时需要；App 自带运行时。
- **SuperCollider**：修改 SCD 并编译 SynthDef 时需要；App 创建的预编译起点可直接测试。
- **Git 与编辑器**：App 自供本地 Git 和文本编辑器；远程协作或更复杂开发按需使用外部工具。
- **AI-Coding Agent**：建议配合 DeepSeek Harness、ZCode (GLM) 等 AI-Coding Agent 使用

---

## 1. 创建与初始化工程

1. **基于模板创建仓库**  
   访问 GitHub 上的 [PNDS Template](https://github.com/xO-xN/PNDS-Template) 仓库，点击右上角的 **Use this template** → **Create a new repository** 生成专属项目仓库。

2. **克隆工程到本地**  
   在新仓库中复制 Git 地址，通过终端或 IDE 将工程克隆至本地：

   ```bash
   git clone <your-repo-url>
   ```

3. **查阅工程文档**  
   用编辑器打开项目：根目录 `README.md` 是概览；`docs/implementation.md`（实现手册）讲模板示例作品的行为规格与「创作时改哪里」；`AGENTS.md` 是 AI-Coding Agent 的入口——agent 会自动读取它，并经它按问题索引平台契约文档（优先读取装机 App 自带的本地帮助语料）。端口在 `manifest.json` 中声明，惯例与选择建议见[参考手册 · manifest](../reference/manifest.md)的「端口」一节。

**第二路径：从既有作品移植**  
不从模板起步也行：已有 OpenProcessing（p5.js）+ SuperCollider + TouchOSC 形式的作品，可以交给 AI agent 用 [pnds-agent-skills](https://github.com/xO-xN/pnds-agent-skills) 中的 **pnds-port** 技能整体移植为 PNDS 工程——一次生成完整的工程目录与 `.pnds` 包，随后回到上面的工作流迭代。

---

## 2. 创作与迭代工作流

PNDS 推荐先在 **PNDS 创作助手 → 讨论**中商量想法与实现方式，再交给外部编程智能体或内置“工作”模式实现，最后回到 App 核对音画与演奏交互：

- **AI 驱动开发**  
  将工程目录导入你的 AI-Coding Agent；从 App 交接时，把原聊天中“复制 prompt”的说明交给它，保留确切任务与修订。通过对话引导 AI 理解乐谱的交互逻辑、音频/视觉渲染规则以及通信协议，快速编写或重构代码。工程自带的 `AGENTS.md` 会替 agent 取读平台契约与模块手册，无需手动投喂文档。对在 App 外克隆且尚未初始化的模板工程，对 agent 说规范开始语即可——中文**「开始新作品」**、英文 **“start a new piece”**，说哪句 agent 就用哪种语言工作——它会按工程内置的 `docs/start.md` 完成初始化（作品名 / 作者 / 简介就位、版本归零、安装与测试跑绿）。
- **实时加载与预览**  
  在创作过程中，随时在 PNDS App 中载入本地工程目录，即时测试交互响应、音画表现与多端同步机制；通过实时测试、独立 performer 窗口及“窗口 → 刷新乐谱页面”验证保存版。
- **持续验证与微调**  
  遵循小步迭代原则，在修改后立即于 App 内验证效果，确保各模块表现符合预期。

### 在聊天中接入可选 hub

在工作模式说明需要接入的既有 hub 与工程事件。助手先组合 hub 能力和必要依赖，点击一次“添加并继续”后仍在原任务中完成采用、配置、事件和关停接线，再检查保存版。已有同版资源直接复用；版本冲突或未保存草稿会保留并提示处理，不静默换版或覆盖定制源码。完整边界和接线要求见[hub 模块手册](./modules/hub.md)。

普通新增资源不再单独提供 `socket.io-client` 或 `qrcode`；已有引用事实仍显示，hub 的必要客户端由资源规则自动组合。二维码继续由 App 提供。hub 不默认加入 Blank，不创建中央中继；真实跨互联网连接、设备和声音仍需实机核对。

### 为作品选择连接协议

创作 agent 在新增或修改手机交互、QR 或浏览器连接时，先读取 [manifest.md](./reference/manifest.md) 的两项声明与 [runtime-contract.md](./reference/runtime-contract.md) §15，并检查实际使用的浏览器 API：

1. 普通触摸、手机参与和扫码使用 HTTP；`supportsPerformerUrl: true` 只保留读取 Host 完整网址的能力。
2. 只有作品的普通浏览器参与端实际需要运动传感器、摄像头、麦克风等安全上下文 API 时，才声明 `scoreServer.needsHttps: true`，并记录所用 API 与原因。Host 在能力已适配、全局开关打开且材料有效时选择 HTTPS。App 内的原生 Host monitor／Client／创作 performer 通过可信第一方来源处理媒体，不因此要求整个 HTTP 场地改用 HTTPS。
3. QR、复制地址与浏览器配置读取同一个 Host 选择的网址，已注入的 `PNDS_PERFORMER_URL` 优先；页面脚本与 Socket.IO 使用当前 performer origin。
4. 在创作交接中记录需求判断、声明值、实际网址及 QR／连接验证结果。普通工程验证 HTTP；需要安全上下文的工程另由作者验证可信 HTTPS、浏览器权限与真实设备能力。尚未完成的实机验证明确保留为待验收。

为原生媒体页面接线时，保留手动启用、拒绝后重试、当前输入选择与页面释放。两份
monitor 中仅主 monitor 初始化采集和模型，投影在 `surface=venue` 或
`PNDS_MEDIA_SURFACE.captureAllowed === false` 时只订阅工程结果；performer 可分别
启用自己的输入。不要因设备共享失败抢占另一窗，不把网络暂停当作文档结束。
协议和证据边界见[原生媒体运行契约](./reference/runtime-contract.md#原生-host-monitor-与创作-performer-媒体)。

创作工作台会自动更新外部 agent 增删或修改的文件。未修改的文本可重新读取；未保存草稿会保留，并在磁盘变化时显示冲突，外部删除文件后草稿仍可打开。保存或外部修改不会自动刷新页面、重启工程或编译，也不会改变当前运行的 health 状态。

页面变化提示「待刷新」，源码、音频声明或产物变化提示「待重启」，SuperCollider 源码另提示「待编译」。手动刷新、重启与编译使用已保存的磁盘内容，未保存草稿不会进入测试版本。monitor 成功刷新后清除所更新版本的页面提示；重启失败保留提示，编译成功仍需手动重启以采用新产物。操作期间又发生的修改会继续提示待更新。

---

## 3. 试运行自检

先按[实时测试与 performer 窗口](./app-tutorial.md#实时测试与-performer-窗口)启动保存版并接入测试客户端，再核对以下现场链路。

打包前必须完成一次真实运行——App 的打包校验是静态的（结构、产物、依赖齐全），它证明不了工程行为正确：

1. 在 App 中打开工程目录（`⌘ O`、侧栏 `+` 或把目录拖进窗口）；
2. 确认 preflight 通过、session 启动、health 变为 ready；
3. 用手机连入同一局域网扫码进入 performer 页面，确认交互与声音正常；确认 monitor 页面在 App 窗口内正确嵌入、随窗口缩放；
4. 走一遍关闭流程，确认工程释放自己创建的资源。

任一步失败，先修工程再回来打包。

## 4. 打包与发布

当完成一个阶段性版本后，通过以下步骤完成作品交付：

1. **导出 `.pnds` 工程包**  
   在创作工作台顶栏右侧选择 **生成 .pnds**，核对保存版与测试提示，再选择输出位置。
2. **自动化发布**  
   将本地改动提交并推送到 GitHub 仓库（或创建 Release Tag），触发 Template 内置的 **GitHub Actions** 自动化工作流，完成作品的构建与在线分发。

发布前检查清单：

1. `manifest.json` 通过 App 完整校验（id / name / version 就位，端口、模式、bus 容量合法）；
2. 修改过的 SCD 已在文件工具栏重新编译，manifest 声明的全部 SynthDef 产物均存在；
3. 工程刚在 App 里完整跑通过一次（health ready、performer 可演奏、monitor 正常、关闭干净）；
4. 生产依赖由工程本地携带，或由 App 共享包的同名确切版本覆盖；未覆盖部分需准备本地依赖，详见[打包校验](./reference/pnds-bundle.md#打包)；
5. `version` 相对上一次分发的包已递增（内容变更必须升版本，原因见[参考手册 · .pnds 工程包](../reference/pnds-bundle.md)）；
6. 打包成功，记下产物路径与 sha256，连同文件一起分发。

## 外部 PNDS Skills

Skills 是自愿安装的创作辅助。资源入口：[pnds-agent-skills](https://github.com/xO-xN/pnds-agent-skills)。按资源目录的说明选择统一创作入口或所需独立能力，在你的外部编程 agent 环境安装完整目录，保留它声明的支持资源；App 不执行安装。通用入口支持新建、修改及任意来源移植评估，移植方案先由作者确认；CM1 仍为明确选择的课程入口。资料优先使用装机 App 的本地参考手册，不能用远程最新版代替本机能力。

普通任务默认交付可编辑源工程、决定、验证和创作交接记录，明确需要分发再打包；课程任务交两者。结构就绪、接线完成、实际运行、声音与设备、可分发分别记录。缺少 Skill 不影响 App 阅读、编辑、添加模块或手动测试。

## 讨论、编辑与独立检查

先用讨论确认目标、关键选择与验收，再明确选择内置工作或记录交接给外部 agent。工作完成后按工程能力预演，手动测试真实音画，并在合适里程碑保存工程版本。按钮、权限及中断操作统一见[使用教程](./app-tutorial.md#使用装机文档问答)；文档接入见[待处理文档](./app-tutorial.md#待处理文档)，交接见[记录交接与外部接续](./app-tutorial.md#记录交接与外部接续)。

调参和候选代码的具体操作见[修改建议与临时预演](./app-tutorial.md#修改建议与临时预演)。运行协议保留在[运行契约](./reference/runtime-contract.md#可选临时参数预演协议-1)。助手在工作任务中检查及修复，手动测试与 CLI 路径见[临时副本运行检查](./app-tutorial.md#临时副本运行检查)。

## 默认演奏输入

Blank 已把 `public/pnds-input.js` 接到获得接纳的 `PNDS_PLAYER` 和 `<main>`。
按作品修改这个输入区域及其反馈，不必再加 p5/ml5 或选装输入模块。鼠标始终是单点，
真实触屏可以提供多个独立触点。支持 PointerEvent 的页面只消费 pointer 一条路径，
App 鼠标测试和其合成／兼容 touch 不会重复进入业务；旧触摸页面读取 changedTouches，
保留普通鼠标单点并抑制触摸后的兼容鼠标事件。原生表单控件仍按自己的方式工作。

每个手势有独立、不透明的 ID，具有 start/move/end/cancel 语义；每次事件都从当前尺寸
计算相对 x/y、归一化 nx/ny 及 width/height，缩放、方向、全屏与 resize 不沿用旧几何。
每个演奏者最多 64 个并行触点是技术资源上限。失焦、页面隐藏、丢失捕获、断线及显式关闭
只清理自有手势；区域变为零尺寸时，终止事件仍能复用最后有效几何。旧终止不能清掉后继
手势。`PNDS_INPUT.close()` 只释放输入，不退出身份；释放页面时两者一起关闭，重连不补发
旧的持有输入。

`server.js` 在当前 claim 所有者校验之后调用
`performance.prepareInput(identity.id, payload)`，再调用 `performance/state.js` 的
`performance.applyEvent(identity.id, event)`。这是共同作品应用入口；扩展声音或画面时
同步维护实际状态和释放语义。接纳后的触点属于每次运行的真实状态，与持久身份、选谱、
记录时间和声道分别表达。`release(id)` 清理该来源；`snapshot()` 返回独立副本：
`{ performers: [{ id, contacts: [{ id, pointerType, x, y, width, height, nx, ny }] }] }`。
两个角色已有的 Socket.IO 连接在 `pnds:performance` 发布完整快照，初次连接也有快照；
monitor-view 只处理低频视图。作者明确接出反馈时，可在 monitor 用
`socket.on('pnds:performance', render)` 绘制已接纳触点。默认工程提供真实接线，不塞入
示例作品或音色预设。

通过实际编辑后的工程和可观察反馈验证。受控 DOM pointer／TouchEvent 只证明数据通路，
不代表手机多指硬件、原生体验或真实听音已经验收；这些结果单独记录。
