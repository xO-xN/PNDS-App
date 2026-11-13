# 独立 HTML 交互原型

[创作助手技能场景](../prototypes/creation-resource-media.html?scene=skills)在输入框用 `@` 补全当前模式可用的技能。讨论可试 `@check-unused-files`，切到工作可试 `@write-readme`。回车确认候选，再发送；技能可以和补充文字、文件引用一起提交。[已有英文变体场景](../prototypes/creation-resource-media.html?scene=skills-readme-conflict)演示先确认是否同步 `README.en.md`，再浏览两份 README 示例。[技能设计](../plans/creation-assistant-input-design.md#创作助手技能)

在创作资源媒体原型的「工程文件引用」场景中，可把左栏工程保存版文本或创作资源拖进助手输入框。拖放和「添加文件引用」共用可移除的标签。输入文字和讨论／工作模式随草稿保留，发送后可核对本次消息的文件引用。[输入栏设计](../plans/creation-assistant-input-design.md#文件引用)

[新建工程、版本与 GitHub 原型](../prototypes/creation-project-versions.html)可直接用浏览器打开。顶部评审区切换新建、首次授权、首次上传中断、离线、分叉和迁移等场景。版本历史页左栏显示「比较文件」，支持变更／全部、目录展开和路径筛选。中间上方按父版本关系画树，下方持续展示所选文件的代码差异，支持逐行／左右比较及打开当前文件。查看版本或比较文件只改变查看状态。`?scene=new|history|fork|interrupted` 可指定初始场景。工程、测试、GitHub 和授权均为内存示例，刷新恢复初始场景。[产品决定与验收](../plans/creation-project-and-versions-design.md) · [React Bits Pro App UI](https://pro.reactbits.dev/docs/app-ui/)

[创作资源媒体原型](../prototypes/creation-resource-media.html)采用用户选定的 A 版中栏标签。左下创作资源暂按左栏高度的 34% 预留，空态显示收件箱图标和拖入提示，列表独立滚动。中栏支持图片缩放和拖动查看、文本编辑和显式保存。底部评审条切换空收件箱、多份文件、同名冲突等场景，可预填页面接入或 SuperCollider 采样任务。拖放和多选接收浏览器本地文件。内置图像与样音为演示素材，文本保存、工程修改、助手结果和设备路由为内存模拟。[产品决定](../plans/creation-resource-media-design.md) · [React Bits Forms 7](https://pro.reactbits.dev/docs/app-ui/forms/forms-7) · [Prompt Input](https://pro.reactbits.dev/docs/app-ui/prompt-input) · [Agent Approval 1](https://pro.reactbits.dev/docs/app-ui/agent-approval/agent-approval-1?rb_item=agent-approval-1)

[演出侧栏身份区原型](../prototypes/performance-identity.html)比较单行身份、双段切换和合并入口。底部评审条切换布局、空闲／演出中、长节点名和主题。角色切换使用内存样例，演出中需先关闭工程或退出演出。App 试用 A 和 C 后，恢复角色切换在前、节点名在后的布局。[正式行为](./performance-participation.md#approved-role-presentation)

2026-11-12 用户在[池客入口原型](../prototypes/pnds-client-entry.html)的首轮评审选择 A「侧栏」。已有记录时，最近连接排在手动地址上方。首次使用直接显示地址输入。可以粘贴完整链接，也可以输入 `IP:端口`，原型会补上 `http://`，端口以池主实际显示的值为准。侧栏直接显示待确认的工程名和池主名，完整地址放在默认收起的「演奏入口」中。用户点击进入后，主区由欢迎内容切换为全宽谱面。底栏最左侧的「池主：〈池主名〉」可展开或收起侧栏，底栏移除「池客」字样。

同一池主有新工程时，原型自动展开侧栏。点击「稍后」收起侧栏，保留可切换的工程。点击「切换工程」开始模拟准备，期间原谱面保持可见，准备成功后才替换。用户确认将此方案接入 App，正式行为见[池客页面接续](./native-client-continuity.md#native-document-and-controls)。

后续 HTML 评审将与池主、创作模式同位置的主操作放到底栏最左侧，池主名按钮移到其右边。谱面打开前显示「加入演出」，有已核对的演出时可点击。已有谱面且发现新演出时显示「切换演出」，其余有谱面时显示「退出演出」。选择「稍后」后，底栏的切换按钮先重新展开侧栏供核对，再由用户确认。退出会回到连接页。

原型直接引用 App 的主题、侧栏与底栏 CSS，按桌面窗口的尺寸、字号及文案展示。池主与网络在这一轮原型里采用无边框、无底色的图标加文字样式。打开侧栏时按正式 App 的方式裁出侧栏区域，保留示例谱面的原布局。

同一 HTML 的局域网发现评审采用单层节点列表。PNDS App 首次使用前须为本机命名，各角色共用该名称，重新打开时复用已保存的名称。可达节点按池主在前、其他角色在后的顺序显示。加入演出前，选择池主可在右侧预览其当前公开工程的 README。已有谱面时，也可从同一列表选择另一台池主，右侧继续显示当前谱面。底栏的「加入演出」「切换演出」或「切换池主」明确确认后才开始准备新谱面。准备完成后才替换旧谱面，取消或失败时保留旧谱面。「退出演出」和 `⌘W` 返回节点列表。手填地址位于侧栏底部，输入框内右侧的箭头提交核对。实时预览完整地址，裸 `IP:端口` 自动补上 `http://`。本轮限于 HTML 评审，以样例数据模拟节点发现、README 读取和演出交接，设备名称由原型单独保存。

演奏入口参考 [HeroUI v3 的 Controlled Input](https://heroui.com/en/docs/react/components/input#controlled)。输入框采用 PNDS 主题的浮起表面，Pond 和 Sand 带轻阴影，Brutal 保留方角硬边。悬停时底色略深。点击或按 Tab 聚焦时，底色恢复并显示贴边的 2px 焦点环。失焦后焦点环消退。输入框提示「输入或粘贴演奏地址」，实时地址与「演奏入口」标题同一行，靠右显示，输入或清空时输入框位置不变。颜色和阴影过渡为 150ms，系统启用减少动态效果时立即切换。

创作模式已启动的测试工程与就绪的池主工程一同排在节点列表前面。池客可选中创作节点预览 README、加入测试或从现有谱面切过去。创作节点等待启动或加载时，按钮暂不可用。加入后，底栏显示「创作模式」和当前节点名。本轮用原型中的「创作台 Mac」模拟测试工程发布。

2026-11-10 演奏者浏览器入口已批准正式接入：用户选择[独立 HTML](../prototypes/performer-entry-pond.html)的 A「居中留白」，指定图标与「PNDS池谱」名称，并授权等待页、360° 拖拽切换和仅灰底座内 loading 一起用于实际演奏者浏览器入口。可操作新候选出现时旧页虚化、`inert`、焦点转圆球；取消准备或失败保留同一旧页和候选重试，候选仍可操作时继续锁定旧页；停止、元数据不可用或不兼容候选移除覆盖层并恢复旧页焦点。普通点按不确认，Enter／Space／辅助技术可明确确认，Safari 首拖鼠标兼容路径与指针路径去重。原生池客 UI 不改。生产资源在 `src-tauri/resources/browser-participation/`，由原有确认、准备与退役流程接入，文案进入正式 `browserEntry.*`；生产手势、入口生命周期和本地 HTTP 模板分别由 `browser-entry-gesture.test.mjs`、`browser-entry-lifecycle.test.mjs` 与 Rust `participation_host::browser_tests` 验证，最终全仓与显式 WebKit 结果待本轮收尾。独立 HTML 的 `scene`／`loadMs` 及内存示例只供评审，其文案源仍为 `locales/prototype-performer-entry.json`。实现边界与历史原型证据见[浏览器参与规则](./browser-participation.md)和[评审说明](../prototypes/performer-entry-pond-review.md)。

2026-11-09 正式演出动作覆盖 11 月 8 日原型：加载／重新加载（Reload）可用时默认低亮彩虹约 9 秒一圈，悬停以保相位调速恢复原 3 秒；关闭默认共用中性灰镜片边、悬停红环，节点保留金橙。同日追加出现／亮起与右侧一致的 `650ms ease`，真正隐藏至 0 保留 `180ms ease`。演出动作整钮透明度始终为 1，未选工程仅文字弱化；镜片恢复共享 hover／focus 材质，Brutal 描边统一 1px。作用域限于 `.desktop-performance-action`，不扩展到创作测试或模式按钮，当前规则见[UI 模式](./ui-patterns.md#两种模式共用底栏与按钮材质2026-10-25)。[独立 HTML](../prototypes/semantic-action-rings.html)保留 11 月 8 日已确认的历史视觉与内存演示，不再代表本轮速度、静态边线或标签。双语源仍通过 `prototype:locales` 同步。9 秒低速与材质轮的定向／完整检查、构建及四主题真实组件浏览器核对已通过；后续「统一出现动画」最终改为仅处理装饰 rim 的独立 filter alpha 包络，保留 650ms 出现与原 180ms 隐藏；最终有效透明度的四主题浏览器核对、生产构建和 `npm run check:all` 均通过，覆盖入场途中 hover、650ms 显现与 180ms 完全隐藏。未启动 dev 或 App，原生视觉仍待用户常规启动核对；分轮证据见[评审说明](../prototypes/semantic-action-rings-review.md)。

2026-11-04 操作等待反馈已选 B：[独立 HTML](../prototypes/operation-feedback.html)比较 A 按钮旁状态、B 复用持续通知与 C 新增页内细进度，覆盖保存／切换、安装／导入、保存轮次、DNS、更新检查和交接八场景，支持四主题及双语。用户已确认复用现有持续通知正式接入；HTML 仍仅内存模拟，参数、文案同步、计量边界及待完成验证见[评审说明](../prototypes/operation-feedback-review.md)。

2026-11-04 E 最终方案批准接入：用户确认将当前[角色原型](../prototypes/performance-roles-1.7.1.html)的紧凑 E 应用 App，覆盖 C 的可见布局。身份角色／只读名为 18px、行高 26px、字重 600／300，角色触发器最小高 40px、文字内缩 28px；列表标题使用当前 `folderDisplayName`，13px／550，Home／Utilities 本地化。底部居中组改用真实 Home、动态用户文件夹及 Utilities，不另有工具／返回按钮；保留真实管理、右键菜单、拖放、持久化和工程选择业务，不将原型四项样例固定到产品。

E 的 N 项框宽按 `N * 16 + 28`px 计算，四项为 92×28px、视觉背景高 22px；未选／当前触区宽 16px／36px，标记宽 6px／26px、高 6px，稳定间距 10px、端留 9px。动态项超宽时在侧栏内水平滚动，聚焦项完整可见。宽度过渡 280ms，切换两项仅做 320ms 单次微拉伸：0%／100% 单位缩放，30% enter `(1.04,.97)`／exit `(1.025,.98)`，无反向回弹或尾振，Brutal／减少动态禁用。角色记忆及活动门禁不变。本次正式接入的 `npm run check:all` 与 `npm run build` 均通过；真实组件／正式 CSS 静态浏览器已核对尺寸、四主题／双语／RTL／长名、24 项溢出与菜单焦点、36 卡长列表及展开连接信息的固定分区，Client／未命名 Host 共享身份也已核对，见[评审记录](../prototypes/performance-roles-1.7.1-review.md)。减少动态仅核对 CSS 覆盖，未模拟系统偏好；这些不代替原生窗口、网络媒体或重启验收。此前 E 原型及 C 的证据保留历史范围。

2026-11-04 历史已接入的 C 方案：用户明确选择[角色原型](../prototypes/performance-roles-1.7.1.html)的 C，并要求应用到 App。当轮批准布局为 16px、字重 600／300 的角色与只读节点名同排靠逻辑起点，文字内缩 28px，身份 header 固定并与工程滚动区分离；13px「工程」标题到首个现有 57px 序号卡间隔 8px，`HostClientAddress` 信息放在滚动区标题前。整个作品计数 footer 移除，底部固定文件夹／带文字工具为 42px，内边距 12px 16px 16px，菜单及拖放继续向上。角色记忆和活动逻辑不变。B 保留为此前已落地对照，D 未选、仅保留原型比较；本轮正式接入的 `npm run check:all` 与 `npm run build` 均通过；真实 Sidebar／池客侧栏／未命名池主及正式 CSS 的静态浏览器核对覆盖四主题、中英、RTL、长名和长列表，身份区／底部固定及连接信息滚动通过，详见[评审记录](../prototypes/performance-roles-1.7.1-review.md)。这些不代替原生窗口、网络媒体或重启验收。

C 将 16px、字重 600／300 的角色与只读节点名同排靠左，顶行文字内缩 28px，固定身份区与工程滚动区分离；13px「工程」标题到首卡间隔 8px。C／D 改用贴近当前 App 的 57px 序号卡密度及 13px 工程名，去掉整个底部计数脚注区域。C 的文件夹与带文字的工具控件高 42px，文件夹加强底色和边框；D 将身份改成两行，底部文件夹全宽 46px，工具放下一行。记忆、角色活动锁定及演出状态逻辑保持。B 仅是旧原型排布对照，保留图块卡，不表示正式 App 的精确截图；C／D 才采用当前序号卡密度。784×829 浏览器已核对 C／D 中文 Pond、C 英文 Sand、C Stage 菜单与英文长名截断、C 中文 Brutal 文件夹筛选；C 实测文字／标题／序号起点 x=54、卡片边 x=38，标题到首卡 8px、卡高 57px、底部控件 42px。一次性 DOM 走查的 608 个组合及 16386 项断言通过，覆盖双语文案同步、重复 ID、记忆／状态隔离、活动门禁、菜单及编组工具；演出中的 `host-live` 连接信息、工程滚动区与固定底部可见性也已核对。该原型轮 `npm run check:all` 全绿；这些仅是此前原型证据，不能代替当轮 C 正式接入的验证。

2026-11-04 上一轮 B 方案确认接入：用户选择[角色 HTML](../prototypes/performance-roles-1.7.1.html)的 B，并要求侧栏布局与角色记忆一并应用 App。当轮批准基线为角色及只读节点名 16px、字重分别 600／300，角色触发器高 36px，沿工程卡片两侧外边界对齐；真实 `FolderSwitch`／工具行固定在滚动区之外的底部，文件夹菜单及拖放目标向上展开。A 的 13px 工程文字轴对齐保留为原型历史对照。App 的 `lastPerformanceRole` 偏好缺省为池主，经 `src/lib/preferences.ts` 串行队列保存显式成功的角色选择，保存失败须反馈；打开 App 仅恢复角色，不自动启动／加入或启用媒体，原生活动快照优先。Creation 保留既有原生清理事务与 `resetRole`，返回演出时仅恢复本次角色界面。正式检查与原生视觉结果另行记录，见[实现规则](./performance-participation.md)。

正式实现中，`restoreRolePreference` 只接纳首次偏好装载，晚到结果不能覆盖原生事实或当前显式选择；启动的 `role: null` 仅表示准备中，`AppShell` 不展示旧角色选择卡片，偏好读取失败回落池主。`commitRole` 先同步切换界面及本次 `lastRole`，再排队保存，失败不回滚当前界面，须提示下次打开可能恢复原先保存的角色。Creation 的原生清理事务不变；成功进入后 `resetRole` 清当前角色／菜单、保留 `lastRole`，成功返回演出后，仅在 `preferencesRestored=true` 时由 `enterPerformance` 使用本次 `lastRole`；首次偏好仍在读取时保持 `role: null` 等待，避免启动中创作往返误用暂存的默认池主。不自动启动、加入或恢复媒体。

2026-11-03 角色启动规则：用户改为首次默认池主，之后每次打开 App 恢复上次使用的角色，覆盖此前每次重新选择的决定。当前先接入[角色 HTML](../prototypes/performance-roles-1.7.1.html)：`scene=launch`／无场景参数为启动入口，评审条「重新打开 App」按记忆进入空闲，「模拟首次打开」只清除专用 `localStorage` key `pnds-role-prototype:last-role`。只有明确成功的角色选择写入，场景切换与被拒绝的切换不写。角色是本原型唯一持久化例外，不访问正式 App 偏好；不恢复演出、参与或媒体。未命名池主继续展示已有命名步骤；节点名仍是内存示例，浏览器硬刷新会重置，不能据此改变正式 App 已有的节点名持久化规则。此为角色记忆的 HTML 阶段记录；2026-11-04 用户已确认与 B 布局一起接入 App，正式持久化遵循上方 `lastPerformanceRole` 规则。

2026-11-03 再次评审侧栏：用户对 App 的顶行与工程卡关系仍不满意，本轮只继续调整[角色 HTML](../prototypes/performance-roles-1.7.1.html)。文件夹与工具移到滚动区外的底部固定行；A 保留 13px、沿工程标题文字轴对齐，B 放大为 16px、沿卡片两侧边界对齐。`?variant=A|B`、评审条箭头及左右键切换布局，保持当前角色与演出；输入／选择框和菜单内不接管左右键。节点名继续只读；文件夹、工具切换只过滤内存列表。此为 A／B 比较阶段记录；2026-11-04 用户选择 B 并要求应用 App，A 保留作历史对照。

2026-11-03 角色入口定稿：用户确认将文字角色下拉和右侧节点名应用 App，并撤回点击编辑节点名。最终 HTML 及 App 顶行去掉「池主节点名」前缀，名称与角色同用系统字体和 13px 字号、字重 300，仅显示、长名省略并保留完整悬停标题；首次命名门禁和设置中的修改入口保留。正式菜单复用 Radix，Portal 菜单与清理期间保持浮动侧栏，活动角色门禁及迟到清理回复保护保持；见[实现规则](./performance-participation.md)。

2026-11-03：按用户提供的 Codex／ChatGPT 切换参考，[角色 HTML](../prototypes/performance-roles-1.7.1.html)将侧栏整宽斜面按钮改为 30px 高、按内容占宽的角色文字与下箭头。下拉菜单展示两种角色、职责和当前项勾号；空闲时明确选择即切换，演出未退出时锁定另一角色并说明先停止／离开。Esc、外点、失焦关闭，支持方向键与 Enter；菜单展开及侧栏持有键盘焦点时不自动收栏。双语仍由 `locales/prototype-performance-roles.*.json` 同步内嵌。此方案现已获用户确认作为本轮 App 接入范围，点击编辑名称的中间试验不进入产品；HTML 仍只用内存样例。

2026-11-03：演奏记录新增[独立 HTML](../prototypes/performance-recording-beta2.html)，比较底栏小面板、右侧抽屉和居中对话框。已确认的录制／回放／叠加流程使用内存样例，保留用户自行选编号与判断起录时机；Q17 收尾与 Q18 断线规则已确认，Q16 布局仍待核对。范围、预览和验证见[评审说明](../prototypes/performance-recording-beta2-review.md)。不接入设备、音频或正式 App。

池主／池客与自动端口管理的[角色原型](../prototypes/performance-roles-1.7.1.html)已由用户确认，侧栏当前采用上述 B，目标为 v1.7.0-beta.2，正式规格及跟踪票见[四项规格索引](../plans/v1.7.0-beta.2-spec-index.md)。原型保留原评审路径，以内存状态演示两击刷新、端口避让后的实际地址／详情，以及工程需适配和旧工程端口冲突；不执行真实端口绑定或媒体操作。布局、语言与验证边界见[评审说明](../prototypes/performance-roles-1.7.1-review.md)。

2026-10-30：现有 `liquid-glass-actions.html` 的 C 方案继续调参：
当前原型每圈／变速周期均为 3 秒，角速度在平均值的 80%～120% 之间按正弦变化，始终同向。
细环与柔光使用同一相位，启停和系统回退沿用原状态规则；A／B 对照不变。
预览仍使用 `http://127.0.0.1:64267/liquid-glass-actions.html?variant=C&theme=pond`。
创作者已确认此版，并同步至 App 的共享底栏按钮。
范围与验收见 [beta.2 细调](../plans/v1.7.0-beta.2-ui-refinements.md)。

2026-10-27：玻璃按钮 HTML 的 C 方案增加轻微外发光试验。独立模糊层
复用原彩环的颜色、亮暗和运动规则；按反馈扩大至 4.5px 扩散、外扩 2px，
Pond／Sand 透明度 .46、Stage .34；原细环与文字保持清晰。评审区「外发光」开关及 `glow=off`
可对照，无需切换状态。用户确认后已接入 App 的共享彩虹按钮，生产规则见
[UI 模式](./ui-patterns.md#两种模式共用底栏与按钮材质2026-10-25)。静态单文件预览
使用 `http://127.0.0.1:64267`，不启动 dev server。见
[本轮评审](../prototypes/liquid-glass-actions-review.md#2026-10-27轻微外发光试验)。

`docs/prototypes/liquid-glass-actions.html` 当前按用户反馈恢复上一版玻璃与原生文字，只在 HTML 的 C 方案移植新版彩虹边框：内联 MIT v1.0.0 引擎仅处理全谱像素，输出再裁成一条 1.1px 周边环；该环以 z-index3 位于原玻璃前，中心镂空，不覆盖或折射文字。参考 360×160、radius137／refraction60 按 30px 高度适配为传入 radius25.6875（引擎限制到 15px）／refraction11.25，其余 bezel1、curvature2.5、chroma0.12、blur0、specular0.25 保持原值，全部只用于边框。整面上层折射与文字副本已撤回；原玻璃、文字位置、0.8px 波浪、读屏和状态流程保留。“新版彩边”开关／`optics=off` 对比新旧细环，A／B、Brutal 及系统回退保持原样。本轮彩边已获确认并接入正式 App 的 `DesktopActionGlass`／`desktop-controls.css`，保留原玻璃、文字、交互和 Brutal；生产滤镜与清理规则见 [UI 模式](./ui-patterns.md#两种模式共用底栏与按钮材质2026-10-25)。当前实现边界、撤回记录与验收结果见[评审说明](../prototypes/liquid-glass-actions-review.md)。预览使用专用 `http://127.0.0.1:64267` 单文件服务，不占用 dev 1420。

`docs/prototypes/performance-surface-study.html` 将 A 桌面分层用于演出模式。初始扁平方案已接入正式 App 的四主题，保留 320px 悬浮侧栏、50px 底栏与独立全宽作品画面；后续正式实现又统一了演出／创作底栏、连续阅读底色及两端按钮规则：Pond／Sand／Stage 使用玻璃，Brutal 使用纯色方角硬边框，去掉透明滤镜、反光与柔和阴影；几何、动作色与模式斜面保持原有规则。最新效果以 `performance-surfaces.css` 与 `desktop-controls.css` 为准。此 HTML 保留初始低饱和 action 配色和 `buttons=original` 对照，尚未同步本轮主题材质调整；`theme`、`scene` 仍支持四主题八场景，工程／设备为内存示例，模式两次确认跳到创作 A 原型。设计沿革、浏览器检查与全量验证结果见[评审说明](../prototypes/performance-surface-study-review.md)。

`docs/prototypes/creation-surface-study.html` 比较创作模式的配色层次：A 桌面分层、B 嵌入画布、C 内容聚焦。创作者已批准 A 并接入正式 App 的四主题，仅调整颜色与边界，保留布局与交互；B/C 仍为原型。`variant`、`theme`、`scene` 查询参数支持三方案、四主题、五场景；“原层级对照”是 token 近似，不是真实 App 截图。表面角色、公开预览参考、原型阶段证据及正式接入验证见[评审说明](../prototypes/creation-surface-study-review.md)。

`docs/prototypes/settings-audio-network.html` 比较设置、音频与网络的三种桌面布局：A 分类设置窗口与底栏快捷面板（推荐）、B 右侧检查器、C 设置工作台页。`?variant=A|B|C` 指定方案，沿用当前四主题，中文展示，所有状态仅存内存；当前运行与下次启动配置分开，8ch 主音量固定 100%，DNS 服务操作单独说明。设计计划、参考与验证记录见[评审说明](../prototypes/settings-audio-network-review.md)，不据原型宣称正式 App 已改版。

`docs/prototypes/pnds-ui-prototype.html` 与独立 Performer 测试窗是内存演示，不接入真实工程文件、服务器、模型服务或偏好存储。产品与运行契约仍以正式版本规格为准。

`docs/prototypes/creation-git-versions.html` 单独评审工程版本窗口。Git 作为中间栏完整切换页，编辑器、预览与 Git 之间的工作区导航只改变可见页面，保留草稿、查看版本、差异页签、缩放及名称输入；实际“切换到此版本”另走保护流程。左右区域仅作定位，不据此改造 App 其他界面。产品决定见 [ADR-0011](../adr/0011-creator-git-version-navigation.md)，演示场景与验证边界见[原型说明](../prototypes/creation-git-versions.md)。

`docs/prototypes/creation-workspace-ui.html` 是 2026-10-19 九项共识的独立交互评审：三页签及单个文件页签、交接 Markdown 预览/编辑、真实目录树与树内重命名、统一资源入口、调试栏检查和 Git 位置选择。保持当前 App 的基本栏宽和密度；底部原型控制条与产品界面分离。示例内容与操作仅保留在内存，不替代 App、模型、运行或 Git 的真实实现；现有按提交切换的接口不等于原型展示的命名分支切换。确认记录、可点击流程与未完成的视觉验收见[评审说明](../prototypes/creation-workspace-ui-review.md)。

`docs/prototypes/creation-ui-refinements.html` 是 2026-10-21 的界面精简与讨论／工作承接评审：信息按需展开、讨论回复中的交接／开始工作、明确整理指令、Git 差异分段布局切换及显示名续号。第二轮删除重复差异标题，并用发送按钮演示空输入、待发送、回复中和工作中状态；加载环尊重减少动态效果偏好，停止与场景切换清理演示回复计时器。保留既有创作工作台密度，直接打开即可；`?variant=A|B` 对比统一／并排差异。所有保存、改名、交接和工作反馈仅为内存演示。已确认产品选择、文档更新位置及验证边界见[本轮评审](../prototypes/creation-ui-refinements-review.md)。

## 文案与切换

英文文案源在 `locales/prototype.en.json` 和 `locales/prototype-performer.en.json`，使用原型的中文展示短语作为键。更新后运行 `npm run prototype:locales`，将 JSON 同步到 HTML 的 `prototype-translations` 数据块，再格式化改动文件。HTML 内的数据块是生成结果，不手动维护；测试核对它与 JSON 源是否一致。嵌入使原型不必通过 fetch 读取翻译，直接打开本地 HTML 也能切换语言。

主原型通过 `state.language` 保存本次会话的选择。展示层记录文本和属性的原文，翻译动态 DOM、标题、提示和下拉标签；观察回调更新时暂时断开观察，避免自身更新再次触发。选择值使用稳定的 `en` / `zh-CN`，语言切换不重建工作台或重置工程。数字状态优先匹配带 `{count}` 的短语。

作品内容不参加界面翻译：编辑输入、README 可编辑正文、源码、路径、作品名称与用户聊天保持原样；额外作者内容使用 `data-ui-content` 标记，手写交接任务记录 `authored: true`。界面翻译不能修改工程源文案或把 README 翻译任务当作 App 语言设置。不要用新增界面文案覆盖用户填写的输入值。

独立 Performer 测试窗通过 URL 的初始语言和演示 BroadcastChannel 的 `previewLanguage` 更新测试控件。这只代表原型测试界面；真实工程的 Performer 主题与语言仍由作品决定。

## 模块演示

原型内固定六项模块，包含用途、依赖、技术边界、示例文件组、接线和验证说明。演示版本、路径和占位内容不能当成正式发行源码。添加前一次性检查整组目标及来源记录是否冲突，全部通过才写入内存文件组、来源记录和交接任务；来源记为 `wiring: pending` / `runtimeVerification: not-run`。App 不从交接任务的完成状态推断模块实际运行情况，也不因加入文件自动启动、重启或修改入口。

## 验证

`src/lib/ui-prototype.test.mjs` 使用 jsdom 执行保存的 HTML 脚本，覆盖设置切换、后续弹窗、下拉标签、草稿与作者内容保留、六个模块的添加与冲突、来源记录和独立测试窗语言更新。弹窗及 BroadcastChannel 使用本地替身，不启动 dev server。

执行 `npm run test:run -- src/lib/ui-prototype.test.mjs` 做集中验证，再执行 `npm run check:all`。jsdom 不做布局测量或真实窗口验收；浏览器视觉与独立窗口通信仍需要本地 HTTP 预览，dev server 由用户启动。

## 1.6 桌面工作台提案

`docs/prototypes/desktop-1.6/index.html` 是独立的新 UI 提案，保留旧原型作为对照；不接入 App、真实音频、工程磁盘或偏好存储。相邻 CSS、JS 和 Performer HTML 必须一起保留，可直接打开本地 HTML，也可通过用户已启动的 Vite 访问 `/docs/prototypes/desktop-1.6/index.html`。

侧栏底部“原型”菜单提供四主题、语言与状态场景；`theme`、`lang`、`scene` 查询参数可用于重复检查。所有工程与编辑状态均在内存中，刷新即重置。独立 Performer 与投影窗口仅通过校验 opener/source 的消息模拟状态。作品内容是演示素材；不代表原工程源码或新增版本能力。

该提案以 `P.t(中文, English)` 就地配对界面文案，作品内容不随界面语言改写。运行配置通过 `applied` 保存快照，区别于下次启动配置；未保存草稿、保存版文件和运行状态分开。文件分组强调 manifest、README 与运行入口，保留真实路径。

执行 `node --test docs/prototypes/desktop-1.6/prototype.test.mjs` 验证核心流程及状态边界，再运行 `npm run check:all`。浏览器检查需覆盖宽/窄桌面、四主题、README/manifest、底部音频面板、模式切换及独立测试窗口；jsdom 不替代布局验收。

1.6 桌面定稿去除顶部栏和侧栏 toggle，侧栏顶行只保留 macOS 红绿灯。创作工程标题下拉承载工程操作；演出保留一个三点菜单，作品操作收在其中。控制台只在创作模式提供入口与快捷键。演出侧栏采用独立悬浮圆角面板（320px、12px 外距），运行时默认隐藏，与沉浸状态解耦；左边缘 14px 悬停或按住 ⌘ 唤出，离开后收回，覆盖 Monitor 而不改变其尺寸。菜单、对话框、模式确认和拖拽期间保持可见；创作仍为常驻文件侧栏。右下角固定尺寸模式按钮在正式 App 中已采用 C 方案：Pond／Sand／Stage 悬停或键盘聚焦点亮单层彩虹环，首击显示 0.8px 轻微波浪与柔和彩虹确认文字，再次点击后以原 300ms 提交节奏切换。Brutal 保留斜向色块悬停露角、首击半幅、再次点击填充和标签滑动，确认文字静态继承主题字色；只有系统减少动态效果偏好让提交立即完成。保持同一按钮 DOM，结束后暂停 hover，直到指针离开。普通切换不展示说明浮层，仅未保存文件损失在按钮上方显示一行提示；Esc／外部点击／窗口失焦取消准备状态。模式切换的运行继承、草稿清理与键盘焦点规则保持不变。

## 1.7 创作工作台预览

2026-10-15 用户已确认当前布局和讨论内参数／代码／临时预演／明确应用流程，作为 [1.7.0 实现基线](../plans/v1.7.0-creation-assistant-spec.md)。原型和下述内存实现用于表达交互关系；真实模型选参、工程适配及像素／原生窗口验证仍须按 [#172 验收要求](../acceptance/172-v1.7.0-creation-workflows.md)完成。保留相邻 README 中各轮检查证据，包括既有失败；定稿不会使其自动通过。

`docs/prototypes/creation-1.7/index.html` 为助手优先的独立原型，继承 1.6 主题并保留冻结版本。`prototype.js` 管理工作台、草稿、固定回复与 Monitor；`catalogs.js` 演示共享包和模块；`workflows.js` 演示保存版交接基线、Git 记录和历史草稿。所有状态仅存在内存中，三者通过同一 `P` 对象协作，文件操作不连接 App。

工作视图更新不能重建 Monitor 节点。保存文件使检查事实失效；文本刷新与运行配置待重启分别表达。代码附件捕获选取时快照，关闭工程读取会阻止发送并保留输入。交接基线独立于 Git，外部提交后仍比较；历史内容进入草稿而不直接写保存版。共享包精确版本与模块路径核对随附资源，文件正文仍为明确标注的示例。

执行 `node --test docs/prototypes/creation-1.7/prototype.test.mjs` 走点击式流程，再运行 `npm run check:all`。完整体验与尚未覆盖的视觉验证见相邻 README。对话内布局预览只用于快速评审，仓库中的独立原型为完整交互入口；不把内存模拟视为 1.7.0 功能验收。

### 讨论内参数预演（2026-10-15）

用户认可总体布局后，要求在讨论中的修改建议直接调参并即时查看效果。原型增加独立临时参数状态：`parameters` 保留建议、当前值、来源保存版及输入校验，`runtimeParameters` 只在手动刷新／启动时采用保存版。拖动只更新同一 Monitor 的演示视觉；应用才写入内存文件并追加不可变实际差异。切换视图保留预演，结束预演恢复临时覆盖前的参数状态；停止测试、新建工程、目标草稿或外部／未经核验的来源变化清理／阻止失效预演。正式实现中，本次明确应用后重新核验仍有效的原预演可保留临时标记；运行采用保存版仍需手动刷新／重启。结束预演不承诺倒退工程时间或完整运行状态，恢复失败明确尚未恢复，不自动重启。

该原型不提供真实工程的通用热更新机制。正式方案由助手按当前意图与实际工程内容提供合适控件，不强制显示 fader，也不按画面／声音或工程类型划定预演范围。参数声明、版本绑定及受限消息接口由 [#231](https://github.com/xO-xN/PNDS-App/issues/231) 形成可审查方案；只有实际适配支持时才即时预演，不支持须说明原因并走明确应用后手动测试。不能把原型解释为任意模型代码注入、自动启动／重启音频或服务、真实声音输出或运行验收。测试覆盖预演、保存、运行和 Git 独立，以及输入范围、草稿／外部修改保护和差异不被后续调参重写；真实模型的适时选参与不同工程适配另行验收。

### 讨论内代码编辑（2026-10-15）

用户进一步要求直接修改非数字内容和代码。同一建议卡提供参数与代码两个入口，共用待应用内容；这份建议不等于当前文件草稿或已执行差异。代码输入不触发执行并结束旧预演，用户明确点击预演才使用示例中的受限映射；显式应用才保存目标文件，并保留当次实际前后文本。切换工作视图保留待应用内容，工程草稿或外部版本冲突继续阻止覆盖。

代码手改后，仅在绑定仍能准确识别时更新参数控件。无法解析的表达式或结构保持原样，停用受影响控件并显示原因，不能通过回切参数界面重新生成代码覆盖用户输入。已执行记录不可变，后续编辑产生新的修改记录。原型不将“能编辑”“能预演”“已保存”“运行已采用”合并为一种状态，也不证明任意模型都能可靠决定何时调用参数面板。

## Git 文件差异联动提案（2026-10-19）

`docs/prototypes/creation-git-diff-review.html` 为独立、无持久化的 HTML。
沿用当前 App 的 32px 顶栏、真实文件树位置、三页签、右预览和 50px 底栏，
仅比较 Git 查看区的三个布局：`?variant=A` 横向版本关系图与主代码区（建议）、
`?variant=B` 版本列表常驻在代码区旁、`?variant=C` 连续浏览所有变更文件。
评审控制条可切布局与 Pond/Sand/Stage 主题；它不属于产品界面。

Git 页的左栏明确切换为对比文件范围（仅变更 / 全部），单击选择差异或在
连续布局中定位，保持 Git 页；显式“打开当前文件”进入当前工程的文件页签，
返回保留对比选择。删除文件仍可检查，但不冒充当前存在的文件。默认比较
父版本 → 选中版本；另可比较选中版本 → 当前保存文件。红色/− 表示删除，
绿色/+ 表示添加，具备行号、局部加深、上下文展开和逐处跳转。保存回执提议
改为短暂提示与版本图定位；警告不因收拢回执而被隐藏。

版本、文件和运行画面均为合成样例，不读取 runes-pnds、不执行 Git、不调用模型、
不运行工程。点击版本只查看；切换按钮仅展示现有保护的说明，不执行切换。
新比较方向、完整变更文件与逐行块需在正式实现中补齐原生契约：优先让 libgit2
提供结构化差异、行号及文件状态，分别固定前后版本/保存版指纹；保留大文件、
二进制、受保护路径、迟到回包和资源限制。原型中的小型 LCS 只用于样例展示，
不能直接升格为生产大文件比较算法。创作者已确认 A 方案并接入 App：图在上、代码在下，左栏比较文件联动，
逐行／左右对比与明确比较方向复用原生只读结果。B/C 仍仅为评审样例。
实现、边界与自动化验证见 [local-git.md](./local-git.md#git-comparison-files-and-code-layout-a-2026-10-19)；
原生布局及 runes-pnds 的实际操作待用户实测。

底栏的两项明确调整已单独接入 App：运输区按内容占宽，音量取消两侧竖线和
多余内边距，运行与音频行为不变。
