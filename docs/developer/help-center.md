# 帮助中心语料与搜索（T7 基建）

v1.3.0（#53）为 Help 帮助中心（T8 窗口，#56）打的底座：三份中文语料（使用教程 / 创作指南 / 参考手册）**以 markdown 原文**进应用资源包，窗口打开时运行时渲染、内存建索引、纯函数搜索。全程离线。

**关键决策**（修订自 #48 spec）：不做构建期 HTML 转换、无任何生成产物——`docs/*.md` 是唯一事实源，打包器原样复制；渲染与索引全部在运行时完成。代价是首次打开窗口时建一次索引（全语料毫秒级，`help-scale.test.ts` 钉住），换来语料更新零流程、dev 直读仓库文件。

## 部件与位置

| 部件                | 位置                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 语料清单 + 读取命令 | `src-tauri/src/commands/help.rs`（`help_corpus`）                                                                                                       |
| 资源映射            | `src-tauri/tauri.conf.json` → `bundle.resources`（`../docs/` 下 13 个文件**逐条**映射进 `help/`，显式 allowlist——developer/、agents/ 向文档因此进不来） |
| 语料装载纯模块      | `src/lib/help-corpus.ts`（`HELP_BOOKS` 清单 + `buildHelpCorpus`）                                                                                       |
| markdown 结构模块   | `src/lib/help-markdown.ts`（`splitSections`）                                                                                                           |
| 搜索纯模块          | `src/lib/help-search.ts`（`buildHelpIndex` + `searchHelp`）                                                                                             |
| 渲染组件            | `src/components/help/HelpMarkdown.tsx`（react-markdown + remark-gfm + rehype-slug）                                                                     |

## 语料装载

Rust 侧 `help_corpus` 返回 `{ id, markdown }[]`（id 是稳定契约，markdown 是原文）。路径解析沿用 utilities 的双候选模式：release 读资源目录 `help/`，debug（`tauri dev`）直读仓库 `../docs/`——**dev 里改文档即时生效**，且每次调用都重新读文件。读不到任何一份 → 命令报错（宁可响亮，不静默藏页）。

`buildHelpCorpus`（TS）做放置与派生：按 `HELP_BOOKS` 排序归册、从文档自己的 `#` 标题取显示标题（缺失回退 id）、用 `splitSections` 切节。**两侧漂移都会炸**：Rust 多 shipping 一份 TS 清单没有的（或反之）→ throw；Rust 侧另有测试钉住"清单 id ⊆ TS 清单"与"docs/ 文件真实存在"。

## 锚点 parity（本机制的核心不变量）

搜索命中携带小节锚点，窗口要能 `scrollIntoView` 到对应标题——**`splitSections` 派生的节 id 必须等于渲染出的标题 id**。两侧用同一个 `github-slugger`、同一次文档序遍历（**所有级别的标题都要喂 slugger**，h3 的去重计数会顺延，不能跳过），重复标题自然得到相同的 `-1` 后缀。`HelpMarkdown.test.tsx` 里有一条 parity 测试钉死这一点；改任何一侧前先看它。

`splitSections` 只在 h1/h2 开新节（h1 = 文档标题节），h3+ 折叠进所属 h2 的正文；标题里若有行内 markdown 会先剥离再 slug。围栏代码块内的 `#` 不是标题；正文纯文本保留代码内容（要能搜到 `performerPort`），但剥离链接/加粗/行内代码记号——**下划线保留**（`PERFORMER_PORT` 是标识符不是强调）。

## 搜索

`buildHelpIndex(corpus)` 把语料摊平为"节"列表（标题/正文预小写化），`searchHelp(index, query)` 是纯函数，窗口可每个键击重跑。匹配是**不区分大小写的子串**（中文没有词边界，子串即模糊）；多词查询按空格切词。排序权重：文档标题命中（只作用于标题节，避免整册刷屏）> 小节标题命中 > 正文频次（封顶防单词刷屏），全词覆盖再加权；同分保持语料序。片段取首个命中前后各 40 字符，两端截断加 `…`。

## 增加一篇帮助文档

1. 文件落进 `docs/`（或 `docs/reference/`），以 `#` 标题开头；
2. `tauri.conf.json` 的 `bundle.resources` 加一行映射；
3. `help.rs` 的 `HELP_DOCUMENTS` 加 `(id, 路径)`；
4. `help-corpus.ts` 的 `HELP_BOOKS` 把 id 归册定位。

四处都改齐，`check:all`（两侧漂移测试）会替你查漏。

## T8 待接

Help 窗口（#56）消费这套底座：`commands.helpCorpus()` → `buildHelpCorpus` → `buildHelpIndex`；命中点击用 `sectionId` 滚动到标题（锚点 parity 即为此）；正文用 `HelpMarkdown` 渲染。界面文案进 locales，本版语料仅中文。
