# 演出模式表面分层原型

2026-10-24：[独立 HTML](./performance-surface-study.html)将已批准的创作 A 桌面分层语言用于演出界面的配色评审。创作者已批准演出 A 并接入正式 App 的四主题，只调整表面与按钮颜色，布局与交互保持原状；补充要求侧栏原生按钮区与其余侧栏使用同一导航底色。

工程、说明文字、乐谱画面、设备与服务状态均为合成样例。操作只更新内存，不读取工程、不发声、不启动服务，也不调用 Tauri、Git 或偏好存储。页面下方 76px 的深色评审条不属于产品界面。

## 使用参数

直接打开 HTML，或通过查询参数指定初始状态：

| 参数      | 值                                                                                 | 默认值     |
| --------- | ---------------------------------------------------------------------------------- | ---------- |
| `variant` | `A`；本轮只有这一方案                                                              | `A`        |
| `theme`   | `pond`、`sand`、`stage`、`brutal`                                                  | `pond`     |
| `scene`   | `selected`、`welcome`、`running`、`pending`、`loading`、`error`、`node`、`confirm` | `selected` |
| `buttons` | `original` 启用原按钮色对照；省略使用候选色                                        | 候选色     |

例如 `performance-surface-study.html?variant=A&theme=pond&scene=selected`。主题、场景和按钮对照会更新 URL；场景选择会重置该场景的示例状态，页面刷新也会重置内存。URL 是重复打开的初始场景，不是演出会话快照。

“原按钮对照”只切换加载填充与模式斜切块的原 action token，周围仍是新的 A 表面；它不是正式 App 截图或完整旧配色复刻。

## 设计范围与表面角色

沿用创作 A 的明度分工，保持演出自己的空间关系：导航退后，选中工程和操作浮层浮起，普通作品说明留出清楚的阅读面。七种 Host 表面不进入作品画面的调色。

| 角色     | HTML token    | 演出界面用途                                 |
| -------- | ------------- | -------------------------------------------- |
| 外壳     | `--shell`     | 窗口基底与底栏                               |
| 导航     | `--nav`       | 悬浮工程侧栏，正式接入包括原生按钮区         |
| 工具区   | `--toolbar`   | 局部操作区域的配色子角色                     |
| 阅读内容 | `--workspace` | 普通 README、欢迎与状态说明的主要表面        |
| 辅助区   | `--aux`       | 次要状态表面的备用角色，不给运行作品统一染色 |
| 嵌入区   | `--inset`     | 文件夹选择、输入与技术详情                   |
| 浮起表面 | `--raised`    | 当前工程、模式按钮静止面、菜单与设置浮层     |

`--line` 和 `--hair` 区分区域边界与局部分隔；`--ink`、`--muted` 分担正文与次要文字。Pond、Sand、Stage、Brutal 的表面取自[创作 A 提案](./creation-surface-study-review.md)，分别保持冷中性、暖中性、暗场与粗野辨识度。Brutal 保留方角和硬边界；减少动态效果时停用演示动画。

## 两端按钮的配色

左侧加载与右侧模式斜切共用已批准的 action 色及控制边界，降低 Pond 大块蓝色的视觉重量。模式按钮静止时仍为浮起中性面；关闭和更改继续分别表达危险与警告，不与加载共用一种状态色。

| 主题   | action    | hover     | action 文字 | 控制边界／焦点 |
| ------ | --------- | --------- | ----------- | -------------- |
| Pond   | `#cddde8` | `#bfd2e0` | `#29485d`   | `#607688`      |
| Sand   | `#ddcbb0` | `#d3bd9a` | `#51412b`   | `#766750`      |
| Stage  | `#365247` | `#426354` | `#e6eee9`   | `#96b6aa`      |
| Brutal | `#f6dfa0` | `#f1d281` | `#24231f`   | `#24231f`      |

正式演出的原加载填充来自 `--pnds-accent`，四主题依次为 `#1476cc`、`#93622e`、`#a5c8b6`、`#ff5722`。Pond 的 `#285a8d` 是强调文字色，不是原按钮填充。新色通过专用 `--pnds-performance-*` 接入，不修改通用 action token 或作品主题桥。

## 正式接入范围

颜色定义在 [`theme-variables.css`](../../src/theme-variables.css) 的演出专用表面、边界、动作及焦点 token；[`performance-surfaces.css`](../../src/components/shell/performance-surfaces.css) 在 desktop 样式之后加载，只匹配 `.performance-shell-frame` 或明确加入的演出浮层。创作与演出 frame 作用域互斥，未替换旧 palette、共享设置颜色或主题桥内容。

侧栏与 44px 原生按钮区共同使用 `--pnds-performance-nav`，不加顶部色条或渐变。普通作品说明、文件夹说明、欢迎和错误页通过 `performance-reading-surface` 使用工作区底色；结构化封面分支不挂此 class。LoadingScreen／StopCover 仅通过 `performance-transition-surface` 跟随工作区底色，原尺寸、图案、透明度与 reveal 生命周期不变。

可加载分支使用新的 action 色，关闭、更改、节点设置及不可加载灰态保留原有语义。模式斜切沿用双击确认、hover 暂停与减少动画规则；确认／切换阶段使用新的前景色，settling 的禁用态保持全不透明。焦点只换边界色，不改已有轮廓宽度和偏移。

工程与文件夹菜单、文件夹选择、拖拽影子及演出底栏的音频／网络外层浮层显式加入演出表面；创作底栏不带此 hook。快捷面板内输入使用 inset、提示使用 aux，底部完整设置入口使用 toolbar／inset 悬浮色；这些规则只匹配显式演出祖先。独立 Select portal、全局设置和确认对话框保持原共享 palette，不通过全局模式选择器批量改色。运行 Monitor、README 封面、原生按钮位置及窗口几何保持原实现。

## 几何与交互边界

几何依据 [`desktop.css`](../../src/components/shell/desktop.css)、[`Sidebar.tsx`](../../src/components/shell/Sidebar.tsx) 与 [`HoverSidebar.tsx`](../../src/components/shell/HoverSidebar.tsx)：320px 悬浮侧栏，上／左留 12px，下距 50px 底栏再留 12px；侧栏原生按钮区高 44px。普通阅读区从逻辑左侧 344px 起，运行画面则横跨底栏上方全宽，侧栏覆盖其上。演出不增加创作的 32px 全宽顶栏或 226px 常驻文件栏。

工程卡保持 57px 高、左右 12px 外距、10px 圆角、13px 标题与双位序号。选中工程与运行工程独立：运行 A 时可选择 B，纸卡跟随 B，运行轨道留在 A。列表独立滚动并保留上下渐隐与首尾留白；本轮不重新设计列表密度、拖拽机制或原生窗口按钮。

底栏高 50px，保留加载、实时音量、音频、网络、投影、设置、模式切换的顺序。左按钮最小 100×30px，右模式按钮中文 164×30px；窄桌面按现有规则压缩为 150px。HTML 为中文评审，未覆盖正式 App 的英文 190px 模式槽或 RTL 几何。

按钮语义依据 [`SessionActionButton.tsx`](../../src/components/shell/SessionActionButton.tsx) 与 [`CreationModeButton.tsx`](../../src/components/creation/CreationModeButton.tsx)：

| 情境                                  | 保留的动作                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| 已选工程、尚未运行，或运行 A 时选择 B | “加载”；替换运行工程先具名确认                                                  |
| 运行卡已选中、没有待生效配置          | “关闭”；不是暂停                                                                |
| 运行卡已选中、有待生效配置            | “更改”；采用新配置需要重新启动                                                  |
| 所需节点信息不完整                    | “设置节点”；不直接加载                                                          |
| 启动／停止进行中                      | 显示相应进行中文案并禁用重复操作                                                |
| 模式切换                              | “演出模式” → 悬浮目标 → “再次点击切换” → 目标模式；Escape、外点或失焦可取消准备 |

真实会话没有 paused 状态；静音和模式按钮的 hover 暂停也不代表会话暂停。原型的启动延时、替换确认与转到创作 A HTML 只用于呈现这些状态，不新增真实运行或窗口能力。运行音频摘要来自演示的 applied 快照，编辑偏好不会立即改写已运行设备。

## 作品画面与 README

运行乐谱是独立浅色 SVG 样例，四主题只改变 Host，不改变作品画面。正式 App 保留同一 Monitor 文档的挂载与主题桥，本原型不以重画 SVG 证明 iframe 或实时音频行为。

默认介绍是普通 Markdown README 的合成示例，属于 [`ReadmePanel`](../../src/components/readme/ReadmePanel.tsx) 支持的内容分支。正式 App 的结构化封面、固定构图、封面图片、内置工具介绍和文件夹介绍不在这张阅读样例的视觉验收范围；不能将其解释为重新排版所有作品 README。加载覆盖延续底栏上方全宽关系，加载动画本身用简单占位表达。

音频／网络浮层与菜单只展示本轮需要比较的控制和表面。系统权限、真实设备枚举、完整设置、工程来源保护及错误恢复仍以正式契约为准，不把内存演示当作新增产品功能。

## 原型阶段验证记录

以下记录独立 HTML 阶段的结果，不代表正式接入已经通过全量或原生验收。

已按正式源码进行独立结构与状态复核。离线执行四主题 × 八场景的 32 组初始化及 11 项关键演示流程：选中不启动、加载／关闭、运行 A 时选 B 的替换确认、取消、音量与静音、音频待生效、菜单关闭焦点、模式确认等通过。新会话恢复 80% 音量并清除静音，关闭后清除选择，模式确认期间加载被禁用。检查脚本留在 `/tmp`，不新增产品业务测试。

候选按钮文字 rest／hover、确认文字落在中性面／填充面、焦点在七种表面及边框在 hover 填充上的对比度均通过；最低值分别为文字 5.38:1、焦点 3.49:1、hover 边框 3.01:1。警告按钮 hover 保留警告色，模式 settling 保持不透明。禁用态与原按钮对照不计入候选按钮最低值。

浏览器在 1280 × 720 下检查四主题的普通 README 与两端按钮、Pond 模式确认与新旧按钮对照、Stage 运行画面及侧栏浮出、Sand 音频弹层、Brutal 网络表单和全宽加载覆盖。运行 A 时选择 B 保留 A 的画面与运行轨道；作品示例未随 Host 主题变色。菜单返回焦点、取消不改名称等由离线 DOM 检查补充。加载动画、真实设备和投影窗口仍为占位演示。

`npm run check:all` 全绿：typecheck、lint、ast-grep、Prettier、Rust fmt、Clippy、前端与 Rust 测试通过。前端 244 个测试文件、2740 项通过，保留既有跳过项。因外置构建盘未挂载，仅通过本次进程的 `CARGO_BUILD_BUILD_DIR` 使用本地 `src-tauri/target`，并设置 `RUST_TEST_THREADS=4`；未修改 Cargo 配置。最终文档经 Prettier 与 `git diff --check` 复核。

真实 App、硬件、原生窗口、英文／RTL 与窄窗口验收不属于上述 HTML 配色评审。

## 正式接入验证

已只读核对表面作用域、按钮状态的 CSS 优先级、焦点轮廓及 portal 归属，未发现布局或业务变化。`npm run typecheck` 与 AppShell、SessionActionButton、主题 palette 定向测试通过，共 3 个测试文件、272 项，其中 palette 232 项。`npm run build` 通过。使用官方 Tauri mock 与合成工程加载真实 AppShell，在浏览器检查四主题阅读面、同色侧栏顶区、两端按钮、Pond 模式 armed／Escape、Sand 与 Stage 音频浮层、Stage 键盘焦点、Brutal 网络面板和运行中待生效的警告按钮。字段边界与焦点采用不透明 control-line，保留错误和禁用状态。夹具不访问真实工程、音频与网络，运行画面使用明确标注的替身，不能据此宣称原生窗口或硬件工作流验收。临时夹具检查后清理。

正式接入的 `npm run check:all` 全绿：typecheck、ESLint、ast-grep、Prettier、Rust fmt、Clippy、前端与 Rust 测试均通过；前端 244 个测试文件、2772 项通过，保留既有 1 个跳过项。使用本次进程的本地 Cargo 构建目录与 `RUST_TEST_THREADS=4`，未修改 Cargo 配置。最终样式生产构建通过；文档收尾后复核 Prettier 与 `git diff --check`。

## 2026-10-24 后续调整：连续阅读底色与共享底栏材质

用户在初次 A 接入后要求侧栏背后的底色与右侧工作区一致、可加载按钮更明确，并让演出／创作底栏和两端按钮采用同一套主题规则：Pond／Sand／Stage 使用玻璃，Brutal 使用纯色方角硬边框。本节记录最新正式实现；上方的扁平按钮色表、接入范围与全量结果属于初次接入阶段。独立 [`performance-surface-study.html`](./performance-surface-study.html) 保留初始扁平方案及原按钮对照，未同步本轮材质调整，不能据其画面判断最新 App。

[`performance-surfaces.css`](../../src/components/shell/performance-surfaces.css) 将演出 frame 底色改为 `--pnds-performance-workspace`，与普通 README／欢迎／错误／过渡表面连续。存在结构化封面时，`:has(.desktop-performance-main .readme-cover-host)` 将 frame 基底恢复为 `--pnds-bg`；封面本身、图案、作品 iframe 与运行挂载均保持原实现。侧栏仍为 320px、12px 外距，阅读区仍从 344px 起，不新增顶栏或其他区域。

[`desktop-controls.css`](../../src/components/shell/desktop-controls.css) 让两种模式的底栏共用 `--pnds-desktop-bar`，不改既有 50px 高度与控制顺序。两端按钮均高 30px，主要动作最小宽度 100px；Pond／Sand／Stage 使用 999px 胶囊圆角，Brutal 为 0 圆角。前三种主题使用更明确的正向玻璃填充：主体为 92% 填充色，加白色 12%／黑色 6% 的反光渐变、`blur(14px) saturate(1.35)`、内侧镜面边缘和轻阴影。Brutal 两端按钮使用不透明纯色与硬边框，去掉透明滤镜、反光和柔和阴影。四主题的动作色与 hover 色、模式中性静止面和目标动作色保持各自规则；模式斜面、露角、两次确认、取消、RTL、hover 暂停与 settling 时序均不变。

关闭／更改仍分别使用原危险／警告色、前景色与 hover 规则，按主题应用玻璃或纯色硬边材质；禁用动作使用中性色。两种模式的音频／网络快捷面板显式加入共同的 `desktop-surface-popover`，沿用浮起表面、嵌入字段、提示与设置入口色。正常输入保留清晰边框和焦点，错误边界、Select portal、全局设置及确认对话框不被批量改色。

减少透明度或提高对比度时，去掉透明度、反光和背景滤镜，保留不透明填充与边界；强制颜色模式使用系统按钮和焦点色。组件只增加样式 class／tone hook，不改变加载门槛、运行／停止、异步归属、确认和模式切换业务；主题桥接口及作品内容不变。

本轮主题定向测试通过 256 项，覆盖三种玻璃主题的实际透明度、背景饱和度、渐变及不透明回退，以及 Brutal 纯色、模式斜面和危险／警告色。浏览器使用官方 Tauri mocks 与合成数据检查四主题两种模式的真实底栏、Pond 已选与禁用加载、关闭、Sand 待变更按钮、模式确认和快捷浮层；Brutal 两模式的计算样式确认纯色、0 圆角、无背景滤镜或反光。创作主体为明确标注的占位，不据此宣称真实工程、音频、系统窗口或硬件验收。临时夹具已清理。

本轮最终 `npm run check:all` 全绿：typecheck、ESLint、ast-grep、Prettier、Rust fmt、Clippy、前端与 Rust 测试均通过；前端 244 个测试文件、2796 项通过，保留既有 1 个跳过项。最终 `npm run build` 通过。Rust 使用本次进程的本地 Cargo 构建目录与 `RUST_TEST_THREADS=4`，未修改 Cargo 配置；文档收尾后复核 Prettier 与 `git diff --check`。
