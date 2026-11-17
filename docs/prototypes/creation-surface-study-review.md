# 创作模式表面层次原型

2026-10-24：用[独立 HTML](./creation-surface-study.html)比较创作模式的配色与表面层次。创作者已批准 A 桌面分层并接入正式 App 的四主题；B/C 保留为比较样例。正式接入只调整颜色与边界，不改变布局、交互或业务流程。

项目、对话、代码、版本与运行反馈均为合成样例，状态只存在内存，刷新重置。不读取工程、不执行 Git、不调用模型、Tauri、音频或网络服务。页面底部的评审控制条不属于产品界面。

## 打开与比较

直接打开 HTML，或使用以下查询参数指定初始状态：

| 参数      | 可选值                                             | 默认值       |
| --------- | -------------------------------------------------- | ------------ |
| `variant` | `A`、`B`、`C`                                      | `A`          |
| `theme`   | `pond`、`sand`、`stage`、`brutal`                  | `pond`       |
| `scene`   | `discussion`、`working`、`code`、`git`、`conflict` | `discussion` |

例如 `creation-surface-study.html?variant=A&theme=stage&scene=working`。切换方案、主题和场景会更新 URL，便于重复打开；场景切换会重置该场景的示例对话和输入。页内还可切换讨论／代码／Git、选择文件与版本、填写问题与消息、显示预览或控制台、打开聊天菜单和设计说明。

“原层级对照”通过 `--flat-*` 的近似 token 合并表面，帮助比较明度与边界关系。它沿用原型的结构和示例内容，不是真实 App 截图，也不用于逐像素核对；其中颜色不承诺与四主题的正式 token 完全一致。“标注层级”和设计说明展示各表面的职责。

## 接入前的同底色原因

接入前的主题已经提供画布、侧栏、卡片、控件与选中 token，问题主要在区域分配。以下记录原有规则，正式 A 分层由专用样式覆盖：

| 位置与源码                                                                                                                                                                                           | 当前关系                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`AppShell.tsx`](../../src/components/shell/AppShell.tsx) 的 `.desktop-frame`                                                                                                                        | 工作台根使用 `--pnds-bg`。                                                                                                                                                   |
| [`CreationView.tsx`](../../src/components/creation/CreationView.tsx) 的中间 `main`、`.creation-file-tab`；[`creation.css`](../../src/components/creation/creation.css) 的 `.creation-workspace-tabs` | 中间阅读区与标签栏没有独立底色，主要靠 `--pnds-border` 分隔。                                                                                                                |
| [`AssistantHistoryControls.tsx`](../../src/components/creation/AssistantHistoryControls.tsx)、[`CreationAssistant.tsx`](../../src/components/creation/CreationAssistant.tsx)                         | 聊天历史栏、正文和输入区外层透明；输入框另用 `--pnds-pill`。                                                                                                                 |
| [`desktop.css`](../../src/components/shell/desktop.css) 的 `.creation-monitor-host`、`.creation-console-dock`、`.desktop-bar`                                                                        | 预览宿主、控制台和底栏共用 `--pnds-bg`。侧栏仍用 `--pnds-sidebar-bg`，桌面覆盖规则只移除外距、圆角和阴影。                                                                   |
| [`creation.css`](../../src/components/creation/creation.css) 的 `.creation-editor-host .cm-editor`／`.cm-gutters`                                                                                    | 代码正文用 `--pnds-card`，行号区用 `--pnds-pill`，与讨论页的透明正文形成不同层级。                                                                                           |
| [`theme-variables.css`](../../src/theme-variables.css)                                                                                                                                               | 通用 `--background`、`--card`、`--popover` 都映射到 `--pnds-card`；`--pnds-pill` 同时承担输入、代码块和模式控件底色。Sand 的画布与 pill 接近，Stage 的用户气泡与 pill 同色。 |

原型优先区分区域职责，不通过到处增加强调色或边框解决层次问题。

## 六个表面角色

| 角色         | 原型 token    | 职责                                                               |
| ------------ | ------------- | ------------------------------------------------------------------ |
| 外壳         | `--shell`     | 标题栏、底部运行控制与工作台背景，提供稳定框架。                   |
| 导航         | `--nav`       | 文件树与辅助导航，退后于主要阅读面；当前行仍独立表达选择。         |
| 阅读内容     | `--workspace` | 助手正文、代码与 Git 详情，是主要注意力区域。                      |
| 辅助面板     | `--aux`       | 预览宿主等次要区域，与正文有轻微明度差；不改变作品画面的配色。     |
| 输入／嵌入   | `--inset`     | 搜索、输入框、代码与版本的局部嵌入区。                             |
| 浮层／操作卡 | `--raised`    | 菜单、问题卡、任务卡和说明弹窗，以边界和适量阴影表达局部操作关系。 |

`--toolbar` 是工具条、标签和卡片标题的子角色，不增加第七种交互含义。选中、焦点、成功、警告和危险仍使用各自的语义色，正文与次要文字保持清楚。

Pond、Sand、Stage、Brutal 都使用这组职责，分别保持冷中性、暖中性、暗场和粗野的辨识度。原型重新调配明度，不直接覆写 App 的 `--pnds-*`；Stage 使用暗色控件，Brutal 保留方角、强边线与硬阴影，减少动态效果时关闭动画。

## 三种方案与取舍

| 方案               | 表达方式                                                               | 取舍                                                                               |
| ------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A 桌面分层（推荐） | 连续面板；导航和工具区退后，正文清楚，预览与输入区各有底色。           | 对现有密度和位置改动最少，优先验证表面分工是否已经足够。                           |
| B 嵌入画布         | 中间阅读区与预览嵌入外壳，增加留边、边框和轻阴影。                     | 空间关系更明确，适合大屏；留边会减少可用内容面积，窄窗口更拥挤。                   |
| C 内容聚焦         | 中间正文形成连续阅读面，辅助区后退；问题和任务用左侧轨道替代完整卡框。 | 长文和讨论更安静；独立操作卡的边界较弱，需要检查问题、任务与普通回复能否容易区分。 |

常规桌面基线保留 226px 文件侧栏、32px 顶栏、50px 底栏，以及文件导航／中间工作区／右侧预览的三栏关系。讨论、版本和单个当前文件页签、聊天入口、composer、预览开关、控制台及运行控制的位置不因方案改变。HTML 的窄窗口压缩与隐藏规则只便于独立评审，不批准正式 App 新增响应式行为。

本轮不把创作流程改成强制向导，不改变保存、冲突确认、版本切换、讨论／工作授权或运行语义。原型的选择、发送和运行按钮仅演示视觉反馈；正式 App 的草稿保护、异步归属、键盘焦点与同一预览文档保留规则继续有效。

## A 方案正式接入

正式 App 在 [`theme-variables.css`](../../src/theme-variables.css) 为 Pond、Sand、Stage、Brutal 增加 `--pnds-creation-shell`、`nav`、`toolbar`、`workspace`、`aux`、`inset`、`raised` 七个表面，以及 `line`、`hair` 边界和 `user` 气泡颜色。它们承接已批准 A 的角色，不替换通用 `--pnds-*`、动作色、文字色或选中状态色。

[`creation-surfaces.css`](../../src/components/creation/creation-surfaces.css) 将颜色限制在 `.creation-shell-frame` 内的现有区域；创作浮层通过 Content 的显式角色接入，不依靠已经脱离祖先的 portal 继承。演出、全局设置与底栏设置弹层保持原配色；主题桥传给作品 iframe 的原有 palette、iframe 身份和布局均不改变。226px 侧栏、32px 顶栏、50px 底栏与三栏工作流继续沿用现有规则。

聊天入口行保持工作区表面，composer 外壳使用工具栏表面，主输入采用浮起表面；卡内输入与搜索使用嵌入区。主输入边界用原输入色混入 10% 正文色，使 Stage 也达到 3:1。

对比度测试在 [`theme-palette.test.mjs`](../../src/lib/theme-palette.test.mjs) 直接核算四主题的实际颜色：正文、次要文字、状态与文件类别文字在七种新表面上的 4.5:1，嵌入输入及浮起主输入的实际边界与各区域焦点 3:1，代码正文及当前行混色的语法文字 4.5:1，以及新用户气泡的正文、次要文字、错误和代码文字。测试不以复制 CSS 字符串代替可读性核验。

## 参考

- [React Bits Pro Editor 3](https://pro.reactbits.dev/docs/app-ui/editor/editor-3?variantSort=latest)
- [React Bits Pro Editor 4](https://pro.reactbits.dev/docs/app-ui/editor/editor-4?variantSort=latest)
- [React Bits Pro Wizard 6](https://pro.reactbits.dev/docs/app-ui/wizard/wizard-6?variantSort=latest)

参考公开预览的页签、当前行与辅助区关系，以及就地选择和步骤状态表达。Wizard 的状态只用于已有问题与任务，不扩展成全局强制步骤。HTML 为独立重画的 PNDS 提案，未复制付费源码。

## 原型阶段验证记录

以下是独立 HTML 阶段的检查证据，不代表本轮正式接入已经完成全量或原生验收。

离线 60 组合（3 方案 × 4 主题 × 5 场景）及主要 DOM 交互检查通过。补充核验了二次点击仍表示重启测试、菜单 Escape 回到触发按钮、选择幅度后的文案与 HTML 转义。临时检查脚本位于 `/tmp`，未新增产品业务测试。

浏览器在 1280 × 720 下检查了三方案、四主题、五场景、原层级对照、菜单与原生说明弹窗的关闭焦点，以及讨论区滚动。修正了代码内空格、差异行意外换行、Brutal 页签圆角和切换主题后的作品示例重绘。作品示例明确使用独立的浅色画面，不继承 Host 的暗色控件方案。

正文及常用次要文字在新层级的底色上达到 4.5:1；Pond、Sand、Stage、Brutal 次要文字最低分别为 4.62、4.66、4.69、4.74。C 预览底部状态改用正文色。此核算不把禁用态、装饰性弱化文字和原层级近似对照视为同一验收范围。

`npm run check:all` 全绿：typecheck、lint、ast-grep、Prettier、Rust fmt、Clippy、前端测试和 Rust 测试通过；前端 244 个测试文件、2664 项测试通过，保留既有跳过项。第一次运行因外置构建盘未挂载失败；最终运行仅临时设置 `CARGO_BUILD_BUILD_DIR` 为项目的 `src-tauri/target`，并使用 `RUST_TEST_THREADS=4`，仓库 Cargo 配置未改。最终 HTML 与文档另经 Prettier 和 `git diff --check` 复核。

窄窗口布局与原生 App 的真实工程工作流未在本轮验收。该原型仅供配色评审，不作为产品功能或原生验收证据。

## 正式 A 接入验证记录

主题定向测试 `npm run test:run -- src/lib/theme-palette.test.mjs` 共 200 项通过。正式接入后重新运行 `npm run check:all` 全绿：typecheck、lint、ast-grep、Prettier、Rust fmt、Clippy、前端与 Rust 测试通过；前端 244 个测试文件、2740 项测试通过，保留既有跳过项。此次同样仅临时使用本地 Cargo 构建目录及 `RUST_TEST_THREADS=4`，没有改动仓库 Cargo 配置。`npm run build` 通过，构建仍报告插件耗时和大 chunk 提示。

浏览器在 1280 × 720 下使用真实 AppShell、CreationView、助手、CodeMirror 和 Git 组件，配合 Tauri 官方 mock 与合成的内存工程，检查四主题的讨论、问题卡、工作中、代码、Git 差异、冲突确认与聊天菜单。核对导航／正文／辅助面板／主输入的层次、菜单浮层、深色代码和原有差异着色；独立只读复核确认新增样式没有改变布局、挂载、事件或作品 iframe 的 palette。检查入口的两份临时文件已删除，不进入产品构建。

本轮是正式组件的浏览器视觉检查，不代替原生窗口、真实工程读写、模型、音频或运行流程的实机验收。最终文档另经 Prettier 与 `git diff --check` 复核。
