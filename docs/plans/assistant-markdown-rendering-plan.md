# 助手 Markdown 回复显示方案研究

状态：2026-10-27 已按用户批准方案实施正文／紧凑排版、代码复制和消息回归；保持现有解析器，增量解析升级仍以实测为条件。实际 WebKit 的主题、窄栏与原生选择验收待用户启动 dev 后完成；不据自动化宣称原生视觉通过。检索日期：2026-10-27。现行规则见 [助手显示](../developer/creation-assistant.md#reply-and-work-log-presentation)与 [Markdown 排版](../developer/ui-patterns.md#assistant-message-markdown)；下文保留设计与研究依据。

## 推荐决定

PNDS 采用独立的助手 Markdown 显示组件，保留 `react-markdown + remark-gfm`，补齐正文与紧凑两套排版、代码复制和完整元素样式。保持真实流式前缀、历史原文、原生选择、现有阅读位置与可信来源动作。

当前标题与正文同大的直接原因是：`AssistantMessageText.tsx` 容器只有 `text-sm`；Tailwind Preflight 将 `h1–h6` 的字号与字重重置为继承，`creation.css` 没有补回标题样式。这是已定位的排版缺口。现有代码和本次研究尚不能证明 PNDS 必须更换解析器，或已经存在可量化的流式性能回归。

本次确定实施范围是下文的排版、局部组件、复制和回归要求。增量解析作为达到基准触发条件后的独立升级：优先对照维护中的流式组件，避免直接复制 DeepSeek 的自建解析体系。以下具体尺寸均为 PNDS 设计建议，不是对三方产品字号的复刻。

## 三方参照与取舍

| 参照             | 本次一手证据                                                                                                                                                                                                                                                                                                                                                      | PNDS 采纳的原则                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Codex            | 官方 App Server 将助手消息、reasoning、工具活动分为不同 item；消息有累计文本、增量事件与完成事件。[文档](https://learn.chatgpt.com/docs/app-server#items)                                                                                                                                                                                                         | 按可信协议和已记录状态区分正文、公开过程、工具结果；完成事件校正同一条消息。 |
| Pi               | 官方 TUI 有完整 Markdown 元素主题、文本／宽度缓存，助手正文与 thinking 分开；变化文本仍会重新解析。[Markdown 源码](https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/src/components/markdown.ts)                                                                                                                                              | 覆盖所有常用元素、适应实际宽度、减少无效更新；终端字号处理不作为桌面规范。   |
| DeepSeek Harness | 官方 Web 组件提供 `body`／`compact`；增量解析保留活动尾部，结束后全量解析。[组件](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/MarkdownText.tsx)、[增量解析](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/incremental.ts) | 主回复与工作过程分别排版；优化应保持已读内容稳定，并处理最终跨块引用。       |

三方协议和界面各有差异，不建立按模型品牌选择渲染器的分支。用户选择任何模型服务，PNDS 都使用同一个显示合同。Codex 桌面 App 的实际 CSS 字号、三个项目的视觉一致性和本机性能，均未在本次研究中测量。

## 正文与紧凑排版

抽出局部 `AssistantMarkdown`，使用明确的 `body`／`compact` variant。助手主回复使用 `body`；用户气泡和公开工作步骤使用 `compact`。`.assistant-markdown` 继续承担选中、基础换行等共享行为，具体尺度放在 variant 作用域，避免覆盖同样复用此类名的交接文档。

| 元素       | 正文建议                                      | 紧凑建议                                          |
| ---------- | --------------------------------------------- | ------------------------------------------------- |
| 正文       | 14px，行高 1.65                               | 用户正文保持 14px；工作步骤继承现有较小字号与颜色 |
| h1         | 1.5em，700                                    | 1em，600                                          |
| h2         | 约 1.286em，600                               | 1em，600                                          |
| h3         | 约 1.143em，600                               | 1em，600                                          |
| h4–h6      | 1em，600，保留各级语义                        | 1em，600，保留各级语义                            |
| 标题间距   | h1/h2 约 20px/8px；h3 16px/6px；其余 12px/4px | 约 8px/4px                                        |
| 段落与列表 | 段间 10–12px；列表项约 4px；嵌套缩进约 1.25em | 缩小段间留白，适应气泡与步骤                      |
| 代码       | 等宽字体约 13px，行高 1.6，独立 LTR           | 跟随所在区域的紧凑尺度                            |

尺寸集中在显示层的 CSS 自定义属性或 variant 规则中，字号以 `em` 比例随正文缩放。内容颜色、代码背景、分隔和焦点继续引用 PNDS 主题 token。首个元素清除上边距、末个元素清除下边距；标题后正文明确保留间距，连续标题也应可读。

块级元素保留真正的 `h1–h6`、`p`、`ul/ol/li`、`blockquote`、`pre/code`、`table` 语义。补齐强调、删除线、引用、分隔线、嵌套列表、只读任务项和行内代码；标题字号不依赖模型是否额外输出粗体。引用使用逻辑起始边框，表格单元格沿用 GFM 对齐。

普通文本自然换行；长路径、连续英文和 URL 可断行。围栏代码保持空格、缩进和行结构，代码与宽表格各自水平滚动，不能撑宽整个消息。普通正文保持对话区的阅读宽度，首版不另设窄文章栏或改变侧栏几何。

`CreationHandoff` 的 13px 正文和既有标题体系、帮助与普通 README 的 `HelpMarkdown`、固定画布封面的 `CoverMarkdown` 继续各自承担原有角色；显示层组件只先服务助手。助手在 `markdown` 围栏中提供 README 源文时，围栏内的 `#` 仍按代码显示，不递归渲染成第二份文档。

## 流式、原文与交互

沿用 [creation-assistant.md 的显示合同](../developer/creation-assistant.md#reply-and-work-log-presentation)：收到真实累计前缀就更新同一消息；进行中显示正文；失败、暂停保留已收到内容；完成不重复追加；公开过程归入默认收起的工作步骤。独立 provider reasoning 继续遵循既有隐藏与回放边界，Markdown 层不自行识别或提取“思考标签”。

首版由现有 CommonMark/GFM 解析器处理未完成输入，保证不崩溃、正文不因等待闭合标记而整段隐藏。不添加假打字、文本平滑回放或任意延迟。未闭合强调或半行表格在后续输入到达时发生语义修正是可接受的；是否影响阅读需由逐前缀样本和 WebView 验收判断。

`message.text` 始终是收到的原始 Markdown，仍用于历史、模型上下文和现有持久化。若以后引入 Remend 或增量 AST，显示修复只在渲染派生层发生，不回写原文或改变复制语义；非追加替换、重试和切换聊天须正确重置缓存。最终全篇校正必须覆盖 Setext 标题、引用式链接、脚注及表格，不能用空行切分后永久冻结的自制规则替代。

复用 `CreationAssistant.tsx` 已有的 48px 底部跟随阈值、上滚暂停、回到消息优先级和 `ResizeObserver` 高度变化处理。新增标题和代码工具条通过该机制参与重排；渲染组件不维护第二套滚动状态或主动移动焦点。原生文本选择和跨代码／表格复制继续可用。

## 代码块与来源

代码块增加静态语言标签和显式复制按钮，复用 `AssistantHandoffPrompt` 的 Tauri `writeText`、按钮、图标、toast 与 i18n 模式。复制点击时的当前已接收代码快照；流式块标注生成状态，不将未完成代码描述为完整文件。

复制合同固定为 CommonMark 解析得到的代码内容（mdast `Code.value`）：CRLF／CR 统一为 LF，保留该内容的缩进、内部空行和末尾空行；围栏及其语法分隔换行不属于代码内容。语言标签、按钮文字和展示器额外附加的换行不进入复制结果，不使用 `trim()`／`trimEnd()`。这是解析后文本的复制合同；原始 Markdown 仍按 `message.text` 保存。通过解析节点或源位置取得代码内容，并以样本测试证明附加展示换行不会混入。

代码区域可通过键盘聚焦并横向滚动，复制动作有成功和失败反馈。各语言、未知语言和无语言 fence 都先保证准确文本。首版不挂载 CodeMirror 编辑器，不引入整套高亮语言包；静态高亮若作为后续独立增强，应在闭合代码块中按需加载，失败回退纯文本。`scd` 等 PNDS 常用语言没有可用语法时保持原文。

模型生成的链接继续只显示文字、图片显示替代文字，原始 HTML 不作为可执行结构。文档、工程文件和私有资料的可点击入口继续来自已经核实的 `message.sources` 及对应 owner/version 路由。普通代码围栏、模型生成的路径和链接都不授予执行、保存、文件读取或导航能力。任务清单 checkbox 只读，不自动变成工程任务状态。

若以后加入正文内引用，应将可信来源记录映射为动作，并复用现有来源打开接口。这是独立产品增强，不作为此次排版的前置条件。

## 解析器选型

| 路线                                               | 收益                                                           | 成本与决定                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 现有 `react-markdown + remark-gfm` 加局部组件／CSS | 直接解决标题、间距、元素覆盖与代码复制，沿用当前测试和安全边界 | **本次采用。** 当前缺陷已有确定解释。                                                        |
| 加独立 Remend                                      | 改善未闭合强调、链接等临时外观                                 | 预处理不等于增量解析；增加原文、显示修复、最终校正的测试面。只在重现具体流式缺陷时单独采用。 |
| Vercel `streamdown`                                | 官方提供按块复用、未闭合语法处理及组件覆盖                     | 达到下面触发条件时的首选对照候选；须验证 PNDS 安全、最终语义、主题与实际包体。               |
| 复制 DeepSeek 的自建 mdast 渲染器                  | 细粒度控制流式尾部和源码位置                                   | 要维护 GFM、跨块引用及全部元素，当前没有足够收益支撑，不采用。                               |

Vercel Streamdown 的官方文档确认它支持 [按块缓存](https://streamdown.ai/docs/memoization)、[Remend 显示容错](https://streamdown.ai/docs/termination)、[streaming/static 模式](https://streamdown.ai/docs/configuration)及[自定义样式](https://streamdown.ai/docs/styling)。其默认安全策略允许广泛链接和图片，插件数组覆盖也会替换默认保护，不能把“可替换 react-markdown”理解为 PNDS 行为等价。[安全配置](https://streamdown.ai/docs/security)

候选库明确指 `vercel/streamdown` 的 npm `streamdown`，不混用 `@lobehub/streamdown` 的文档或接口。本次未安装候选库、未承诺迁移版本，也未测量包体、延迟或 WebKit 兼容性。采用候选库时也先关闭与本功能无关的下载、图表、数学和文本动画，不把其默认控件直接带入 PNDS。

## 实施顺序与验收

1. 从 `AssistantMessageText.tsx` 抽出 `AssistantMarkdown.tsx`，明确 variant；补标题、段落、引用、列表、行内代码和表格规则。共享样式留在 `.assistant-markdown`，尺度归入 variant；同步 `creation-assistant.md` 与 `ui-patterns.md` 对应规则。
2. 增加局部代码块组件、准确复制与本地化反馈。正文不新增执行入口，不改模型协议、状态存储和来源权限。
3. 扩展组件、滚动和安全回归；跑 `npm run check:all`。依照仓库约定，由用户启动 dev server，再验收实际 WebKit 的四主题与宽度。

| 验收范围      | 应证明的结果                                                                                                | 对应证据                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Markdown 语义 | h1–h6、ATX/Setext、强调、嵌套列表、引用、只读任务项、表格及两种代码保持语义                                 | `AssistantMarkdown`／`AssistantMessageText` 组件测试                         |
| 逐前缀输入    | 在 `#`、未闭合强调、fence、表格分隔、中文标点与 emoji 边界逐步输入，已收到内容可见且最终正文不重复          | 逐前缀测试、失败／暂停／完成／历史恢复测试                                   |
| 准确复制      | 缩进、空行、Unicode、CRLF／LF 边界、多个块、流式快照与失败反馈可验证                                        | 局部代码块测试，按上文固定的 Code.value／LF 合同断言，排除围栏及附加展示换行 |
| 安全与来源    | 模型正文不生成 `script/iframe/img/a`；来源按钮仍走当前工程身份与版本检查                                    | 保留并扩展 `CreationAssistant.test.tsx` 的安全与来源测试                     |
| 滚动与选中    | 标题、表格和代码增高时，跟随者保持到底，上滚阅读者不被拉回，指定消息导航优先，原生选择可用                  | `CreationAssistantScroll.test.tsx` 与实际 WebKit 验收                        |
| 实际排版      | 320/480/720px 内容宽度，中英文与 RTL，四主题和 App 支持的缩放下，标题层级清晰、正文可读、代码和表格局部溢出 | 原生视觉验收；jsdom 不作为字号、布局或对比度证明                             |

流式升级触发条件：实际样本出现明显反复重排、代码／表格闪动，或接近当前单轮 64KiB 上限时出现持续主线程长任务和交互卡顿。64KiB 是当前协议上限，不是性能保证，也不是字符数。用 8/32/64KiB 中英文混合回复、长代码、宽表格和多轮历史做相同前缀回放，对比当前实现与候选库的更新耗时、长任务、选择、暂停和滚动。待实测目标是避免反复超过 50ms 的长任务并保持输入响应；不预先宣称任何方案已达标。

若基准触发升级，优先只替换 `AssistantMarkdown` 内部引擎，保持 props、variant、原文与来源动作。最终校正、安全测试或阅读位置有回归时不切换生产入口，保留已完成的排版和复制改进。本次不引入虚拟化、整聊天重新挂载或自建增量解析框架。

## Codex：已核实的显示协议

官方 [App Server 文档](https://learn.chatgpt.com/docs/app-server)定义 `agentMessage` 的累计文本与可选 phase，区分 commentary、partial answer 和 final answer；reasoning、工具执行、文件变化等有各自 item。增量事件用于更新对应消息，`item/completed` 的最终 item 是权威状态。这支持消息类型与生命周期独立于 Markdown 排版的设计。

官方 [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)给出根据任务复杂度选择简洁结构、使用行内代码和带语言 fence 的写作约定。它描述生成内容的建议，不是桌面 App CSS 或最新渲染器源码。PNDS 可以采用语义正确、适度结构化的回复写作要求；具体字号与渲染安全仍由显示层负责。

## DeepSeek Harness：已核实的 Web 实现

[DeepSeek 官方入口](https://deepseek.com/harness/)指向 `deepseek-ai/deepseek-harness`，本次所读实现是 2026-10-27 抓取的 `master` 观察。

| 主题       | 已核实事实                                                                                                                                                                                                                                                                                                                                                                   | PNDS 取舍                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 解析       | `mdast-util-from-markdown` 配合 micromark GFM，再由自建 mdast→React 渲染。[parse.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/parse.ts)、[render.tsx](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/render.tsx)                   | 不把 DeepSeek 描述为使用 Streamdown，也不据此推断 PNDS 必须自建解析器。        |
| 增量       | 重解析末尾两个不稳定块，较早块复用；key 来自源偏移。结束后全量解析以修复跨块 reference／footnote；非追加输入重置缓存。[incremental.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/incremental.ts)                                                                                                      | 将尾部容错与最终正确性一起验收，不能只追求冻结速度。                           |
| 密度       | `body` 有标题字体 token，`compact` 的标题继承字号、600 字重；首尾清除多余 margin。[组件](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/MarkdownText.tsx)、[CSS](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/MarkdownText.module.css) | 采用两种密度与显式层级，章节留白按 PNDS 窄栏收紧。                             |
| 字号与代码 | 主题说明正文默认 14px，可 10–22px，标题与正文同增量缩放；代码有语言标签、复制及未知语言纯文本降级。[主题](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-theme/README.md)、[代码块](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/CodeBlock.tsx)                | 复用主题尺度和代码结构；其复制移除末尾一个换行的行为不直接作为 PNDS 原文合同。 |

该组件在流式中暂不渲染 TeX，settled 后才转 KaTeX；这个选择不能扩大为“所有 Markdown 等完成才显示”。其链接、远程图片和本地 resolver 策略比 PNDS 更开放，不能直接迁移到本项目。[渲染实现](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/client/ui-primitives/src/markdown/render.tsx)

发布页的 `dsh-v0.2.1-rc.3` 可追溯到 [短 SHA `1f81c04`](https://github.com/deepseek-ai/deepseek-harness/commit/1f81c04)，但本次固定 SHA 源码获取失败；不同 URL 的缓存存在时间差。上述 `master` 观察不冒充该发布版本的精确行为，未查得的完整标题 token 数值也不予推测。

## Pi：已核实的显示行为

官方 [pi.dev](https://pi.dev/) 将 Pi 定义为可定制的最小 agent harness，交互入口为 TUI，并提供 print/JSON、RPC、SDK 模式。旧仓库 [badlogic/pi-mono](https://github.com/badlogic/pi-mono) 当前重定向至 `earendil-works/pi`；本次引用当前官方仓库。

| 主题           | 已核实的事实                                                                                                                                                                                                                                                                                                                          | 对 PNDS 的设计判断                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 元素与主题     | `Markdown` 按 token 渲染，分别定义 heading、link、code、codeBlock、quote、hr、listBullet 等主题角色；标题通过粗体、一级下划线及较深层级的 `#` 前缀体现。代码有语言高亮回调；表格按可用终端列宽折行，过窄时回退原始 Markdown。[源码](https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/src/components/markdown.ts) | 借鉴完整元素覆盖和主题角色。终端的字符装饰不能作为桌面字号规范；GUI 需要自己的标题字号、字重与间距。                  |
| 流式与缓存     | 同一 `Markdown` 对象通过 `setText` 更新，改变文本会失效输出缓存；输出按文本与宽度缓存。尾部不完整闭合围栏有专门处理，以减少代码块结束时闪动。所读实现会重新解析变化后的源文本，未证明采用“已完成块永久冻结”的增量解析协议。[源码](https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/src/components/markdown.ts)   | PNDS 先保持真实文本前缀更新；只有重现流式问题后才增加有边界的显示容错。缓存可借鉴，不能据此声称必须换成新解析器。     |
| 正文与其他内容 | `AssistantMessageComponent` 按内容顺序渲染 `text` 和 `thinking`，后者独立控制显隐及颜色；工具执行另有组件。截断、取消和错误提示位于已经收到的内容之后。[源码](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/components/assistant-message.ts)                                   | 正文、公开工作过程和工具卡应保留各自的呈现层级。Pi 可展示 thinking 并不改变 PNDS 隐藏 provider reasoning 的既有合同。 |
| 更新与结束     | agent 的事件区分消息开始、部分更新、消息完成，以及工具开始、更新、结束；工具完成可继续触发后续助手消息。[事件文档](https://raw.githubusercontent.com/earendil-works/pi/main/packages/agent/README.md)                                                                                                                                 | 流式未完成与真正结束是显示状态，完成消息不应作为第二份正文追加。                                                      |
| 绘制层         | TUI 以可用列宽渲染行，并要求处理宽字符、emoji、ANSI；其绘制引擎合并更新请求，支持差分输出。[TUI 文档](https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/docs/tui.md)、[框架说明](https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/README.md)                                        | 应借鉴减少无效重绘、适应窄宽度与保留阅读位置的目标；不能把终端绘制算法直接搬入 React DOM。                            |

### Pi 证据边界

本次实际读取了官方 `main` 的文档和源码；不同 URL 的网页缓存快照可能有行号及细节差异，因此本文仅采用共同确认的行为，不宣称上述 `main` 内容来自同一个精确提交。

GitHub 的 [`commit/main` 页面](https://github.com/earendil-works/pi/commit/main) 当次返回 `911fbab`，其 [patch](https://github.com/earendil-works/pi/commit/911fbab.patch) 给出的完整 SHA 为 `911fbab32f2b4f98214c9043e788ad8aeb81c96e`，提交日期为 2026-10-25。固定该 SHA 的源码 URL 本次未能取得，故不把它冒充为已验证的全部源码基线。没有运行 Pi，也没有对终端或 WebView 做视觉和性能实测。

### Pi 可采纳结论

为回复提供完整 Markdown 元素样式和主题角色，保留消息状态与内容角色，针对流式尾部做有限容错，并按实际宽度验证表格与代码。这些是可借鉴的实现原则；PNDS 的具体字号、间距、链接策略与 reasoning 处理仍由自身产品需求决定。
