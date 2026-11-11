# 帮助中心语料与搜索

`docs/zh-CN/` 与 `docs/en/` 是装机帮助的唯一正文来源，原样离线打包。帮助窗口运行时渲染 Markdown、切节并建立内存搜索索引；不生成 HTML，不收录 developer、agents 或历史档案。

## 清单与装载

| 职责                            | 位置                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| 双语路径、稳定文档 ID、读取命令 | `src-tauri/src/commands/help.rs`：`HELP_TREES`、`HELP_DOCUMENTS`、`help_corpus(locale)` |
| 逐文件资源白名单                | `src-tauri/tauri.conf.json`：`bundle.resources` → `help/<tree>/…`                       |
| 归册、排序、标题和结构校验      | `src/lib/help-corpus.ts`：`HELP_BOOKS`、`buildHelpCorpus`                               |
| 切节与搜索                      | `src/lib/help-markdown.ts`、`src/lib/help-search.ts`                                    |
| Markdown 渲染                   | `src/components/help/HelpMarkdown.tsx`                                                  |
| 旧标题兼容                      | `src/lib/help-section-aliases.ts`                                                       |

`help_corpus` 返回 `{ id, path, markdown, version }[]`，`path` 相对语言树。Release 读资源目录，debug 直读仓库；每次调用重新读文件。非法 locale、缺文件或前后端清单不一致均显式失败，不静默切换语言或隐藏文档。

两树文件集合、Rust 清单、资源映射和前端归册必须一致。`help.rs` 与 `help-trees.test.ts` 校验漂移、标题、链接及渲染锚点；`help-scale.test.ts` 以真实语料验证装载和搜索开销。

新增文档需同时补齐两语文件、资源映射、`HELP_DOCUMENTS` 与 `HELP_BOOKS`。测试用 glob 读取语料，无需另加 raw import。

## 标题、旧链接与检索

`splitSections` 与渲染端使用同一 `github-slugger`，按文档顺序处理所有标题级别；重复标题的后缀也必须一致。仅 H1/H2 开新节，H3+ 留在所属 H2 内，但保留可导航锚点。围栏代码不作标题，正文保留可检索的字段和代码标识符。

正文只保留当前能力。删除或改名已发布标题时，在 `help-section-aliases.ts` 将旧锚点映射到同篇的现行标题；不要留下可见占位段落。文档链接、帮助窗口直接目标与 `read_help_section` 共用解析器。助手返回现行 section ID，其证据、分页范围和已读覆盖使用同一身份；未知小节仍报错。`help-compatibility.test.ts` 固定装机路径及原有锚点，验证它们能直接或经别名解析。

搜索按 H1/H2 索引标题、纯文本和原始 Markdown。独立任务使用 H2。空正文标题不占结果，完全相同的正文只保留排名最高的一项；不能合并仅数字或否定条件不同的规则。

`searchHelp` 保留精确标识符、去掉有限问句套语，并用原生中文分词补充多字词；未知词不补造候选。标题与正文相关度是主要依据，少量意图路由只存权威目标，不复制规则正文。检索质量由 `help-retrieval.test.ts` 的双语关键词和问句验证。

窗口显示纯文本片段；助手获得同一命中的 Markdown 范围和可传给 `read_help_section` 的 `readTarget`。offset 是该版本 `section.markdown` 的 UTF-16 坐标，不能复用纯文本 offset。来源版本、分页及覆盖复用由 `assistant-documents.ts` 管理。

## 窗口与导航

帮助中心使用独立 webview（label `help`），入口为 `help.html` / `src/help-main.tsx`，不引导主窗口的 store、菜单或会话。启动顺序为读取偏好、应用主题、初始化语言、装载语料；语料就绪或进入错误态后均揭示窗口，避免永久隐藏。

| 职责                       | 位置                                 |
| -------------------------- | ------------------------------------ |
| 菜单与 ⌘?                  | `src/lib/menu.ts`                    |
| 创建、复用、导航和主窗口桥 | `src/lib/help-window.ts`             |
| URL 与事件目标编解码       | `src/lib/help-target.ts`             |
| 搜索、目录、文档与滚动     | `src/components/help/HelpCenter.tsx` |

`openHelpWindow(target)` 隐藏创建新窗口并将目标写入 URL；已有窗口聚焦后发送 `pnds:help-navigate`。页面注册监听后发送 `pnds:help-ready`，主窗口回放目标，防止首开事件丢失。已有但仍隐藏的窗口重新揭示。非 main 窗口使用独立渐变计数，不能打断主窗口渐变。

`HelpTarget` 可带 docId、anchor 和来源 locale，首开、事件导航与 ready 回放均保留。来源可打开原语言小节，窗口 UI 语言仍跟随 App；用户随后切换语言时重取语料和索引。加载期间保留旧内容，失败显示可重试错误。锚点滚动须等待目标文档与所需语言语料均已渲染。

主窗口桥同步主题和语言。⌘W 按实际焦点分发；帮助窗口直接销毁，不进入主窗口会话关闭流程。使用原生标题栏，尺寸位置由 window-state 保存，VISIBLE 不持久化。正文显式采用平台无衬线字体。

文档链接必须经 `resolveHelpLink` 拦截，不能导航 webview。相对 `.md` 路径以当前文档的语言树内位置为基准，`..` 在树根钳制；锚点经过兼容解析，未命中则回页首。https、mailto 等外部链接交系统 opener，解析不到则无操作。
