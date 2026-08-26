# 帮助中心语料与搜索（T7 基建）

v1.3.0（#53）为 Help 帮助中心（T8 窗口，#56）打的底座：三份中文语料（使用教程 / 创作指南 / 参考手册）**以 markdown 原文**进应用资源包，窗口打开时运行时渲染、内存建索引、纯函数搜索。全程离线。

**关键决策**（修订自 #48 spec）：不做构建期 HTML 转换、无任何生成产物——`docs/zh-CN/*.md` 是唯一事实源（v1.3.1 #66 起语料住在 zh-CN 语言树，布局见 ADR-0001；`en/` 镜像树落地后同一套契约按语言选树），打包器原样复制；渲染与索引全部在运行时完成。代价是首次打开窗口时建一次索引（全语料毫秒级，`help-scale.test.ts` 钉住），换来语料更新零流程、dev 直读仓库文件。

## 部件与位置

| 部件                | 位置                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 语料清单 + 读取命令 | `src-tauri/src/commands/help.rs`（`help_corpus`）                                                                                                             |
| 资源映射            | `src-tauri/tauri.conf.json` → `bundle.resources`（`../docs/zh-CN/` 下 13 个文件**逐条**映射进 `help/`，显式 allowlist——developer/、agents/ 向文档因此进不来） |
| 语料装载纯模块      | `src/lib/help-corpus.ts`（`HELP_BOOKS` 清单 + `buildHelpCorpus`）                                                                                             |
| markdown 结构模块   | `src/lib/help-markdown.ts`（`splitSections`）                                                                                                                 |
| 搜索纯模块          | `src/lib/help-search.ts`（`buildHelpIndex` + `searchHelp`）                                                                                                   |
| 渲染组件            | `src/components/help/HelpMarkdown.tsx`（react-markdown + remark-gfm + rehype-slug）                                                                           |

## 语料装载

Rust 侧 `help_corpus` 返回 `{ id, markdown }[]`（id 是稳定契约，markdown 是原文）。路径解析沿用 utilities 的双候选模式：release 读资源目录 `help/`，debug（`tauri dev`）直读仓库 `../docs/zh-CN/`（`CORPUS_TREE` 常量）——**dev 里改文档即时生效**，且每次调用都重新读文件。读不到任何一份 → 命令报错（宁可响亮，不静默藏页）。

`buildHelpCorpus`（TS）做放置与派生：按 `HELP_BOOKS` 排序归册、从文档自己的 `#` 标题取显示标题（缺失回退 id）、用 `splitSections` 切节。**两侧漂移都会炸**：Rust 多 shipping 一份 TS 清单没有的（或反之）→ throw；Rust 侧另有测试钉住"清单 id ⊆ TS 清单"与"zh-CN 树文件真实存在"。

## 锚点 parity（本机制的核心不变量）

搜索命中携带小节锚点，窗口要能 `scrollIntoView` 到对应标题——**`splitSections` 派生的节 id 必须等于渲染出的标题 id**。两侧用同一个 `github-slugger`、同一次文档序遍历（**所有级别的标题都要喂 slugger**，h3 的去重计数会顺延，不能跳过），重复标题自然得到相同的 `-1` 后缀。`HelpMarkdown.test.tsx` 里有一条 parity 测试钉死这一点；改任何一侧前先看它。

`splitSections` 只在 h1/h2 开新节（h1 = 文档标题节），h3+ 折叠进所属 h2 的正文；标题里若有行内 markdown 会先剥离再 slug。围栏代码块内的 `#` 不是标题；正文纯文本保留代码内容（要能搜到 `performerPort`），但剥离链接/加粗/行内代码记号——**下划线保留**（`PERFORMER_PORT` 是标识符不是强调）。

## 搜索

`buildHelpIndex(corpus)` 把语料摊平为"节"列表（标题/正文预小写化），`searchHelp(index, query)` 是纯函数，窗口可每个键击重跑。匹配是**不区分大小写的子串**（中文没有词边界，子串即模糊）；多词查询按空格切词。排序权重：文档标题命中（只作用于标题节，避免整册刷屏）> 小节标题命中 > 正文频次（封顶防单词刷屏），全词覆盖再加权；同分保持语料序。片段取首个命中前后各 40 字符，两端截断加 `…`。

## 增加一篇帮助文档

1. 文件落进 `docs/zh-CN/`（或 `docs/zh-CN/reference/`），以 `#` 标题开头；
2. `tauri.conf.json` 的 `bundle.resources` 加一行映射；
3. `help.rs` 的 `HELP_DOCUMENTS` 加 `(id, 路径)`；
4. `help-corpus.ts` 的 `HELP_BOOKS` 把 id 归册定位；
5. `help-scale.test.ts` 补一个 `?raw` import 并在 `DOC_PATHS` 登记。

五处都改齐，`check:all`（两侧漂移测试）会替你查漏。

## T8 窗口接线（#56，已完成）

帮助中心是**第二个 webview 窗口**（label `help`），独立最小入口 `help.html` + `src/help-main.tsx`（vite 多页构建，`build.rolldownOptions.input`）——不引导主 App 的 store / 菜单 / 会话机制，react-markdown 只进 help 分块不进主包。启动链复刻 App.tsx 的 #51 防闪：`loadPreferences → setColorThemeAttribute → initializeLanguage`（主题先于首帧落地）→ 渲染 `HelpCenterApp`；**窗口由 `HelpCenterApp` 在语料就绪（或失败出错误态）后调 `commands.fadeInWindow('help')` 揭示**——内容未到也揭示，窗口绝不卡在隐藏态。

| 部件                                   | 位置                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| 菜单 Help 子菜单（⌘? + 三入口）        | `src/lib/menu.ts`（Window 之后，macOS 惯例末位）                            |
| 窗口生命周期（创建/复用/导航/⌘W）      | `src/lib/help-window.ts`                                                    |
| 帮助中心 UI（搜索/命中/侧栏/文档视图） | `src/components/help/HelpCenter.tsx`                                        |
| 高亮                                   | `HelpMarkdown` 的 `highlightTerms` + `splitTextOnTerms`（同一算法两处消费） |
| 入口                                   | `help.html` / `src/help-main.tsx`（boot 顺序见上）                          |

关键行为：

- **打开**：`openHelpWindow(target)`——窗口不存在则**隐藏创建**并把目标编进 URL（`?doc=<id>` / `?search=1`）；已存在则 `setFocus` + `emitTo('help', 'pnds:help-navigate', target)`。已存在但卡在隐藏态 → 重跑揭示而不是聚焦看不见的窗口。
- **⌘W 分发**：File > Close Window 的 action 先问 `commands.focusedWindowLabel()`——help 在前台就关 help（普通销毁，不进主窗口的关闭流），否则走原主窗口流（会话确认 / 红灯流）。
- **⌘?**：注册为 `Cmd+Shift+Slash`（⌘? 与 ⇧⌘/ 是同一物理键序，一个加速键两个拼写都吃到）。
- **实时跟随桥**：主窗口 `setupHelpWindowBridge()`（App.tsx 装配，help-window.ts 实现）——`languageChanged` 推 `pnds:help-locale`、settings store 的 `colorThemeSetting` 变化推 `pnds:help-theme`（帮助页 `changeLanguage` / `setColorThemeAttribute`）。标题只在创建时本地化（chrome 非界面文案）。
- **boot 握手**：页面监听注册完毕后 `emit('pnds:help-ready')`，主窗口回放 `lastTarget`——窗口刚创建、页面监听未就绪时被丢掉的导航目标不会静默丢失。
- **窗口属性**：`resizable`、标准标题栏、⌘W/红灯正常关闭即销毁；window-state 插件（Rust 侧）记尺寸位置（VISIBLE 已被全局排除在持久化外）。Brutal 下方角不是只改 mask——标准标题栏窗口的圆角是窗服务器画的（NSThemeFrame），content mask 裁不动它，所以 `sync_corner_radius` 会连窗口 chrome 一起翻转（非不透明 + 透明标题栏，主窗口创建时的同款结构；`window.rs` 的 `sync_window_chrome`，#70），主题离开 Brutal 时整体还原。capabilities：`default.json` 的 `windows` 含 `help`（`core:window:allow-set-focus` 供主窗口聚焦它）；`desktop.json` 保持 main-only，不给 help 顺带放宽 updater。
- **Rust 侧**：`fade_in_window(label)` 参数化（缺省 main）；**非 main 窗口用独立 FadeGen 计数**（`reveal_generation`，有单测钉住隔离性）——不共享主计数器，否则 help 揭示会打断主窗口进行中的渐变（半透明卡死，契约禁止）。
- **文档间链接**（#56 用户报告后补）：语料 md 里的链接**绝不允许**触发 webview 导航——曾把整个主 App 引导进帮助窗口导致窗口报废。`HelpCenter` 在根节点拦截所有 `<a>` 点击，交给 `resolveHelpLink`（`lib/help-links.ts`）：相对 `.md` 目标按**链接所在文档自己的语言树内路径**解析（`..` 在语言树根处钳制——部分语料按仓库根基准书写），`#fragment` 作小节锚点（未命中回退页首）；带 scheme 的 URL（https/mailto…）走系统浏览器（opener 插件）；解析不到 → 无操作。为此 `help_corpus` 的每份文档带 `path`（**语言树内相对路径**，随 Rust 清单一并下发——#66 迁树时特意不把 `zh-CN/` 前缀编进 path，链接解析的"世界"就是语言树本身）。
- **文档字体**：正文用平台标准无衬线栈（内联在 `HelpMarkdown` 上）而非品牌字体——语料是参考文本不是 UI。注意主题的 `font-sans` token 是自引用未定义变量（`@theme inline { --font-sans: var(--font-sans) }`），工具类会静默回退继承品牌字体，所以显式内联。
