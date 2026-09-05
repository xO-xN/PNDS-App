# App 产品行为规范

PNDS App 的产品行为、测试覆盖与 Definition of Done 的权威文档（收编自原 `PNDS_APP_REQUIREMENTS.md`）。本页只写 App 侧行为；运行协议一律链接运行契约，不重复。

规范分工与冲突裁决：

- 工程静态格式（manifest / 目录 / 资产）→ [`manifest.md`](../zh-CN/reference/manifest.md)、[`structure.md`](../zh-CN/reference/structure.md)
- 进程 / 环境变量 / health / 音频 bus / 关停 → [`runtime-contract.md`](../zh-CN/reference/runtime-contract.md)（下文简称「运行契约」）
- `.pnds` 打包与安装 → [`pnds-bundle.md`](../zh-CN/reference/pnds-bundle.md)
- App 产品行为与验收 → 本文档

## 产品定位

App 负责：

- 打开用户选择的本地工程目录；
- 执行 preflight；
- 使用随包 Node 启动工程 score server；
- 在 Internal 模式启动和管理随包 scsynth；
- 管理音频模式、CoreAudio 输出设备、External target 与适用的 master gain；
- 选择 LAN 地址并显示工程 monitor；
- 管理加载、错误、重试、切换、日志和进程清理。

App 不是：

- 数字乐谱编辑器；
- SuperCollider IDE 或 `sclang` runner；
- 作品 Socket.IO/OSC 协议代理；
- 多声道扬声器布局、校准或现场 PA 管理器；
- 工程下载、安装或在线项目库。

## 平台与交付范围

必须支持：

- macOS Apple Silicon ARM64；
- Tauri v2 + 单一主窗口；
- 随包 ARM64 Node 与 scsynth（固定版本见运行契约 §2）；
- Host + 手机/平板的局域网演出；
- 1–64 路离散 Internal 输出；
- ad-hoc 签名发行与独立 Tauri updater 签名。

当前不要求：

- Intel Mac、Windows、Linux 或 universal binary；
- 跨互联网分布式演出；
- 打开端强制 checksum / 目标平台校验（`.pnds` 本身见 pnds-bundle.md）；
- Creator Guide 与在线工程库；
- 运行中无重启地热切换模式、设备或 target；
- App 直接配置环绕声、扬声器或空间化布局。

## 工程选择与历史

必须实现：

- 通过目录选择器打开工程；
- 打开路径即保存为本机 Recent Projects（工程历史），并直接进入 preflight；
- 点击历史条目重新 preflight；
- 支持拖拽排序和移除历史记录；
- 失效路径显示可读错误；
- App 启动进入 Welcome，不自动运行历史工程。Welcome 标题上方是涟漪 logo 舞台（v1.3.3 #86，用户要求自 site welcome 页移植）：App icon（`src/assets/pnds-icon.png`，与 site 同图）浮在 172px 圆形舞台上，三道错相水纹环扩散消散、整台缓浮——涟漪与光环取 `--pnds-accent`（各主题自有色），icon 保持自身配色（如 macOS 图标之于暗色模式）；`prefers-reduced-motion` 下动画按全局规则静止；纯装饰（`aria-hidden`）。Brutal 下整个舞台不渲染（#87 用户要求：柔光语言不属于硬线条平面，`[data-color-theme='brutal'] [data-welcome-logo]` 隐藏，hero 文案独立承载页面）。

打开路径不弹信任确认：PNDS App 是「操作者即机主」的演出工具，打开的工程由操作者本人放入本机，运行前再弹一次本地代码确认是纯摩擦。工程历史的增删与数据格式（`recentProjects`）保持不变。

工程文件夹（侧栏顶部的分段控件 switch）：

- track 撑满行宽，段宽随名字分配，白色 pill 滑动切换；段为 `role="tab"` + roving tabindex；
- ←/→ 在聚焦段上循环切换视图；⌘←/→ 在任意位置切换当前文件夹视图，两端循环回绕（v1.3.1 用户反馈：三视图下旧的端点钳制读起来像卡住；与段箭头同规，经段点击同一入口）。v1.3.3（#89 用户反馈：⌘←/⌘→ 无声失效）：WKWebView 把「仅 Command + 左/右方向键」当作自身后退/前进等价键在原生层吃掉，keydown 到不了页面（实测 ⌘↓ 与裸方向键可达 DOM、⌘横箭头不可；jsdom 全绿故仅真实环境可见）——window.rs 的 `install_cmd_arrow_webview_passthrough` 沿 #79 守卫的 shadow/exchange 双路模式挂 `performKeyEquivalent:`，把精确匹配的该组合改道普通 `keyDown` 路径（页面 ⌘ 层照常接管，文本框/浮层守卫语义与 v1.3.1 一致），其余组合（含 ⌘↓/⌘↑）原样转发 WKWebView；改道守卫为类级、随启动安装一次；
- 文件夹管理走段的右键菜单：新建 / 重命名（与 ⌘R 同动作）/ 删除；Utilities 文件夹受保护（重命名与删除禁用并说明原因），文件夹上限 3 个时「新建」禁用并说明原因；
- Utilities 文件夹的成员随 App 更新单向补齐（v1.3.0，issue #55）：每个内置工具在本机只「offer」一次，凭 `offeredUtilities` 记录判断——新发售的工具（如 v1.3.0 的 TND）在升级安装的下次启动补入历史与文件夹；记录缺失的老安装以「路径已出现在索引里」视为已 offer 静默回填，容量拒收的工具不记录、留待下次启动重试；工具身份是 registry id 而非绝对路径（v1.3.1 用户反馈）：正式版与 dev 构建把同一工具暂存在不同根下却共享偏好域，按路径认曾把每个工具双列（6 条目/3 工具）——现在启动时旧根副本从索引清除、保留的工具改挂当前根（历史与 Utilities 成员），`offeredUtilities` 改以 id 记录，旧路径记录按 `/utilities/<id>` 后缀视同其工具；
- 内置工具是 App 内容，一经种入即不可变（v1.3.2 用户反馈）：卡片不拖拽（无位置重排、不可移出或移入其它文件夹）、无 ✕（不可从历史移除）、⌘R 不改名；Utilities 段不接受外部工程拖入（不高亮、落点拒绝且不弹上限提示）；`clearRecentProjects` 清空用户历史时保留工具。守卫在 project-store 的结构性动作上（`utilityPaths` 集合由每次启动的 `builtinUtilities` 注册表解析注入，不持久化；注册表解析失败时退回按 Utilities 成员的 `/utilities/` 路径形状识别，降级会话内守卫仍在），UI 的禁用只是第一道（utilities-folder.ts 负责注册）；
- 内置工具的显示顺序固定为 App 注册表顺序（v1.3.3 #81，用户要求）：multichannel → local → telematic。每次启动把 Utilities 夹内顺序归一化到注册表顺序——种子只在首次建夹时跑，v1.3.3 之前种入的老安装靠这条迁移跟上重排；顺序无变化时不动持久化；
- 内置工具在侧栏 / 设置列表 / 运行标题显示 App 提供的简洁别名（v1.3.3 #84 用户报告：320px 侧栏下长名截断）：Multichannel Gen / Local Diagnostics / Telematic Diagnostics。别名是解析层事实（builtin-utilities.ts → `projectDisplayName`，MonitorView 运行标题同序），排在「preflight 学到的 manifest 名」之上——选中卡片触发的 preflight 会照常把正式 manifest 名学进 `manifestProjectNames`（#16 的通用机制），但显示不再被它顶回长名（#84 首版把别名启动时学习进 store，恰被这条学习覆盖，用户报告后改为解析层）；manifest 与工具仓库的正式名不变，用户改名层对工具仍然禁用；
- 内置工具卡左侧定轴槽显示示意 icon（v1.3.3 #85 用户要求）：multichannel → 波形（AudioWaveform）、local → 网络节点（Network）、telematic → 地球（Globe），未映射的未来工具回退扳手；按路径形状 `…/utilities/<id>` 解析 id（与别名同键），槽宽与居中标题光轴不变，普通工程卡保持裸 spacer；glyph 相对行几何中心上移 1px——15px 标题的光轴（小写字面质量）在中心线上方，正中放置的 icon 读起来偏低（#85 用户反馈）；
- 工程拖到文件夹段上入夹、拖到未分组段返回；拖动排序期间 pill 淡出，落定后在新位置淡入；
- 正在运行的工程卡片左缘有 accent 竖条；空闲选中仅白底。Brutal 下工程列为章鱼插画预留底部整段净空（#71 v2 用户反馈：卡片翻页止于插画上方、永不压图，卡片在所有主题保持透明静止底）；「+ 导入工程」留在列表尾部（随列表滚动，不压插画），Brutal 下为实体按钮（卡色底、黑框、硬投影，按下压入投影），其余主题维持半透明 chip。
- 暗场（stage）主题的两个选择 pill——文件夹段滑 pill（`data-folder-pill`）与工程卡选择 pill（`data-selection-pill`，几何引擎按选中卡全盒定尺寸，玻璃即选中卡的表面；其上的卡片行是透明的）——渲染为**磨砂**液态玻璃（v1.3.3 #88：先严格移植 yzrt 纯 CSS 液态玻璃配方，再按用户方向加磨砂——虚化所有效果；随后多轮仅调透明度，填充 10%→6%→4%→3%）：填充 3% 白；文件夹 pill 的白色高光比工程卡 pill 弱一级（角部高光对 40/25 vs 55/35、角部高光面 45 vs 60——段 pill 更小、等值白读起来更烫，用户要求单独调弱）；六层 inset 阴影栈虚化（角对 0.9/0.55 → 0.55/0.35、blur 半径翻倍、暗内缘 2px→4px blur）；投影放宽抬高（0 6px 16px@35%）；::before 折射暗环 blur 8px→14px；::after 静态 45° 角部高光 blur 3px→8px、白 0.8→0.6；子 span 内白环（参考的 .circle-overlay）blur 1px→4px。**静态、无动态背景**（漂移高光为中间版本，用户要求移除）。与参考的两处差异均因 App DOM：`contrast(3)`/`brightness(0.9)` 外壳不移植（需包住整个侧栏、会毁文字；参考自身的 fx-layer filter 同样使其 backdrop blur 失效）；卡 pill 不带 backdrop blur（其 backdrop root 是带渐隐 mask 的滚动容器，v1.2.2 #29），文件夹 pill 的 backdrop blur 随磨砂 2px→6px。pill 的命令式几何（transform/width）不受影响。浅色主题保持实心卡色 pill，Brutal 保持硬平面。

默认主题的 id 为 `pond`（v1.3.3 #91，语汇与显示名 池塘/Pond 对齐；#90 先改的显示名）：`ColorTheme` 联合、`DEFAULT_COLOR_THEME`、主题表、设置面板选项、`data-color-theme` 属性与主题桥（§11 的 `theme` 值 / `?theme=`）全部用 `pond`。`lavender` 与 `midnight` 同入 `LEGACY_THEME_NAMES` 静默迁移（存量偏好 `lavender` → `pond`）；Rust `validate_color_theme` 白名单同时容纳新旧值。改名对页面跟随是视觉无操作：页面（Template `theme-follow`）不认识的 id 会被忽略并保持自身默认配色——恰与 pond 同款；Template 仓的 `THEME_PALETTES` 以 `pond` 为主键、`lavender` 为同调色板别名（双向版本偏斜保险，老 App 推 `lavender` 新页面仍跟随）。唯一实质影响：显式分支 `onTheme('lavender')` 的自定义页面在 pond 主题下不再触发回调。

列表与导入：

- 工程列表上下边界为静态 20px 淡出，两端内边距让静止位置天然避开淡出带；
- 选中避让滚动对键盘与鼠标同权：⌘↑/↓/⌘数字选中的卡片与点击落在淡出带内的卡片都会自动滚到完全避开淡出带的位置（最小位移，上限为两端内边距）；
- ⌘↑/↓ 只在当前文件夹视图内移动选择，不自动跳到所选工程所在的文件夹；所选工程不在当前视图时，选择从对应端进入该视图；
- 导入入口共两处：工程列表末尾居中的 ghost 按钮与 ⌘O——两者走同一 `promptOpenProject` 流程。

运行时 App 不复制、修改、上传或安装工程内容。开发者工具的显式操作除外（编译写入 synthdefs 产物、打包只读源工程）；App 自管数据目录内的解压副本随历史移除回收。设备、OSC target 与 recent paths 是 App 本机偏好，不写入 manifest。

Preflight 必须包含：

- schema 与字段；
- 路径 containment 和资产存在性；
- 仅在工程声明生产依赖时检查 `node_modules`；
- Internal outputChannels 与 audioBusChannels；
- performer/monitor 端口占用；
- 模式与 External target；
- 设备能力可用性。

## 状态与 Session

外部可见状态至少包括：

```text
idle | starting | ready | stopping | error
```

启动与停止遵循运行契约 §8 与 §12。以下操作执行完整 restart：

```text
切换工程
切换音频模式
更改 External OSC target
更改输出设备
```

运行中选卡完全自由：

- 点击工程卡、⌘1..9、⌘O、Finder 拖放与双击 `.pnds` 五条路径统一为「选中 + preflight」：不弹确认框、不重置 session、主视图不从监视页掉回欢迎页；
- 卡片左缘运行竖线与文件夹「使用中」圆点跟随 session 所属工程（与选中无关），白色选中 pill 独立跟随选中，二者可并存于不同卡；被选工程的 preflight 结果（校验中/错误）当场显示在卡上；
- 底部设置卡完全跟随选中卡：选中运行卡时维持 Close/Change 与实时音量；选中其他卡时显示该卡的启动配置（音频模式/OSC/设备）与 Load 按钮，音量行等待（调音量需切回运行卡）；
- 「切换工程必须确认」的契约保留，确认时机在启动动作：按下 Load（或 Enter）且存在 live session 时确认「将先关闭正在运行的工程」，确认后停旧工程并自动启动新工程（选择保持）；上一个工程处于 error 状态时直接启动、不弹确认；
- restart 过程中必须保留当前工程选中状态和待应用设置，不得让侧栏无故取消选择；停止运行工程时若选中的是另一张卡则保持选中。

Rust session manager 是运行状态真源。React 不得用本地 reset 伪造后端已经停止。

## 网络与 Monitor

- LAN 枚举、多地址用户显式选择、`PNDS_HOST_IP` 注入与端口冲突语义 → 运行契约 §4；
- 以 performer health `status === "ready"` 判定就绪；Internal session 的 ready 门槛（health ready + monitor 可显示 + master stage 完整创建）→ 运行契约 §5、§8；
- monitor iframe 完整占据主区域；resize / 全屏切换不重载 iframe、不重启 Node；手动 Refresh 重建 iframe；App 不读取跨 origin monitor DOM → 运行契约 §10。

页面焦点优先（v1.3.5 #105）：monitor 页面的键盘交互（tnd/template 的输入框、下拉菜单）永远不被 App 的焦点夺回机制打断——

- 全帧注入的 reporter 脚本（`window.rs` `GUEST_FOCUS_SCRIPT`，all-frames WKUserScript，页面无需配合）报告页面焦点状态：页面内 body/html 之外的元素持焦点即「用户在交互」（`pnds:guest-focus` postMessage，宿主校验消息来源为该 iframe 才采信）；
- 交互期间所有夺回路径（2s 心跳、window focus、visibilitychange、`pnds:window-focus`）在唯一收口处一律暂停；web 层 ⌘ 快捷键（⌘1..9、⌘←→↓↑、⌘R、⌘,）同期对页面让位——键盘属于页面聚焦的元素；
- 指针位于 monitor 区域内时同样暂停夺回（v1.3.5 #107，兜住不产生 focusin 的自制控件——无 tabindex 的 div 菜单）：iframe 区域 mouseenter/mouseleave 维护指针状态、≤500ms 防抖吸收边界抖动，每次夺回前以最后已知指针坐标 `elementFromPoint` 复核（leave 事件缺失时坐标仍可判定；防抖窗口内以防抖为准）；指针移到 chrome 后键盘即时或至多一个心跳（≤2s）归还；与 guest 焦点信号在同一收口叠加为双门控；
- 页面焦点落回 body（或离开页面）时键盘立即归还，⌘ 层随之恢复；点 App chrome（标题条、hover 侧栏）任何时候可手动拿回；
- 原生菜单加速器（⌘M 静音、缩放、⌘⇧R、⌘W 等）不走 web 层，交互期间照常工作；
- 无 guest 信号且指针不在区域内的自发丢焦点（#29 桌面切换回来 activeElement 落 iframe）照常被夺回；mount/onLoad/reload 时点的夺回保留（v1.3.4 行为）。

## 音频 Host 行为

- UI 只能显示 manifest 声明的模式；三模式的 Host 行为表 → 运行契约 §6（模式说明见 [`audio-modes.md`](../zh-CN/reference/audio-modes.md)）；
- `N/H/K/B` 计算、bus 规则、只桥接前 K 路与安全丢弃 → 运行契约 §7；
- 设备列表每项显示可用输出通道数；通道不足设备视觉灰显但仍可选择，最右红色 `Nch → Hch` 损失字样标注且设置区持续显示（无 toast/modal）→ 运行契约 §7.6；
- 设备能力以有效采样率下的 CoreAudio/CPAL 配置为准；设备消失时回退系统默认并给出现有的设备不可用提示；
- 每次 scsynth spawn 恒携带 `-H`（issue #100）：会话传启动时解析的设备名（保存偏好，或回退解析出的系统默认），App 启动预热传启动时解析的系统默认名（解析失败不传、静默放弃）——scsynth 自身的默认设备解析路径撞 ObjC 运行时竞态（#99 实测：无 `-H` 47% 崩溃、显式名 0%）；解析与 spawn 之间设备消失则干净退出进错误页、输出落 session 日志，不做静默回退 → 运行契约 §7.2；
- 设备选择是本机偏好，变更通过 Change/restart 生效（运行契约 §6）；
- master gain 的默认值（80%）、百分比到 dB 曲线与 `N > 2` 固定 100% → 运行契约 §7.5。

scsynth 瞬态启动崩溃的自动重试（issue #92；2026-08-30 实测修订）：捆绑 scsynth 3.14.1 在 macOS 26 上按 spawn 概率崩溃——ObjC 运行时损坏竞态（实测帧：AVAudioSession/objc_initWeak、`_objc_fatalv`、method-cache insert、SCSession 符号intern，同族多死法，SIGTRAP/SIGABRT/SIGSEGV）。判定是纯函数（退出状态 → 是否可重试，`audio.rs` 表驱动测试）：**信号死亡即可重试**。初版的「且零输出」前提已被实测证伪——真实崩溃带着 CoreAudio 设备清单（stdout）与 ObjC 运行时自身诊断（stderr 无缓冲），零输出永不成立，重试从未触发；配置错误（如 `-H` 设备被拒）是打印错误后干净退出（exit code 非信号），不受放宽影响。两条路径共用同一判定：

- 会话启动：信号死亡透明重试至多 3 次（fresh 端口，界面保持 starting 不闪错误页；实测 53% 单次崩溃率下，3 次重试把连续失败率压到约 8%）；每次重试记入 App 日志与 session 日志。重试耗尽或首遇其他形态（超时、干净退出）直接进入错误页——错误页出现即需人工介入，手动 Retry 行为不变；最终失败的形态与死亡子进程的末 8 行输出也落 session 日志（启动失败的输出不会出现在错误页 tail——读取器仅在成功后挂载）；
- App 启动预热：同一判定下静默重试至多 3 次，成功才置预热标志；真失败静默放弃（session 启动路径自会向用户呈现真失败）。

上游 SC 3.15 发布后应评估升级捆绑二进制；重试去留按升级后实测决定。

静音（UI 语义）：

- 设置卡的喇叭是静音按钮：点击静音（记住当前值为恢复值），再点恢复；拖动滑杆到 >0 解除静音、落 0 视为静音态（图标同步）；
- 静音状态仅会话内有效，不写 preferences——每次开演回到已知默认 80%；
- 静音按钮的禁用条件与推子一致（External/None、未运行、N>2 固定增益）；
- ⌘M 为静音切换（菜单加速器抢占系统隐藏键），与滑杆共用同一门控与命令路径；音量微调只留滑杆（⌘←/→ 已改派给文件夹切换，见 [`keyboard-shortcuts.md`](./keyboard-shortcuts.md)）。

## Window 与全屏

窗口模式保持无装饰 PNDS 壳层：

- 自绘 traffic lights；
- Welcome/Error 使用常开侧栏；ready monitor 使用左边缘 hover 浮出侧栏；
- 顶部中央显示 `PNDS - <project>` 并作为 drag region；
- 侧栏覆盖 monitor，不改变 monitor 布局；
- 右下角隐形 resize grip（v1.3.3 #80，用户报告）：无边框透明圆角窗口的角外像素全透明，macOS 把点击穿给下层 app，而系统的斜向 resize 光标恰好显示在角上——用户被引导去点一个点不到的角。grip 是弧内侧约 20px 的隐形命中区（`cursor: nwse-resize`），主键按下走 `startResizeDragging('SouthEast')`；全屏隐藏，其余三角不处理（上两角属标题栏拖拽区）。

全屏入口共三处——macOS Window 菜单项、`⌃⌘F`、侧栏按钮——所有入口必须调用同一 action。全屏切换不 reload monitor。

全屏 title bar：首选实现是进入全屏时动态启用 native decorations/title bar，鼠标靠近顶部时由 macOS 显示原生 unified title bar 和 traffic lights；全屏时侧栏自绘 traffic lights 隐藏；顶部热区优先于左侧 sidebar hover；native title bar 与侧栏不同时显示；退出全屏恢复无装饰窗口。必须先在 macOS release-like 环境验证动态 decorations、透明度、styleMask 与 WKWebView 没有抖动或布局错误。若 Tauri/macOS 无法可靠动态切换，则 fallback：保持无装饰窗口，在顶部 hover 显示自绘 title bar——fallback 仍须满足互斥与三个全屏入口。

整窗淡入淡出使用 macOS 原生窗口 opacity，而非只给 React 内容加 CSS：

- 首次显示与 Dock 重开隐藏窗口：150–180ms 淡入；
- 点击红灯/Close Window：150–180ms 淡出后 hide；
- `⌘Q` 不等待动画，立即进入进程清理和退出；
- 动画被打断后必须恢复一致 opacity，不能留下不可见但可交互的窗口。

v1.3.0（#51）冷启动防闪模式——**隐藏创建 → 生效 → 显示**：主窗口以 `visible: false` 创建；前端在保存的主题（含深色）写入 DOM 后才调用 `fadeInWindow` 显示并淡入，窗口首个可见帧即为正确配色（深色用户不再先见浅色默认调色板）。显示门控在前端启动链（主题未落地不显示，读取失败也必须显示——DOM 保持 Lavender 默认仍是正确配色）；Rust 侧 `fade_in_window` 对已可见窗口是 no-op（dev reload 不得重淡入），lib.rs 的兜底线程在宽限期（4 秒）后强制显示仍未显现的窗口——应用绝不能保持不可见但运行。**持久化窗口状态不得包含 `VISIBLE` 标志**（`persisted_state_flags()`）——window-state 插件的恢复路径会自行 show，绕过门控。新窗口若要求首帧即正确（帮助中心，T8），复用同一模式。

v1.3.0（#56）帮助中心窗口——第二个 webview 窗口（label `help`，独立 `help.html` 入口）：

- 打开自 Help 菜单（⌘? 搜索 + 使用教程 / 创作指南 / 参考手册三入口；⌘? 注册为 `Cmd+Shift+Slash`，同一物理键序两种拼写）；已开则聚焦并窗口内导航。
- 防闪复用 #51 模式：隐藏创建 → 主题先于首帧落地 → 语料就绪（或加载失败出错误态）后 `fadeInWindow('help')` 揭示；非 main 窗口揭示走独立渐变计数，不干扰主窗口进行中的动画。卡在隐藏态的复用窗口由打开方重跑揭示兜底。
- 搜索为实时纯函数（每键击重跑），命中含文档/小节/片段；点击命中在同一窗口打开文档页、滚动到小节锚点并高亮关键词；侧栏按四册浏览全部语料（教程、创作者指南、参考手册、模块手册——书序 v1.3.3 #81 用户要求，模块手册排在参考手册之后）。本版语料仅中文，界面文案随 App 语言（运行中语言切换实时推送）。
- 可缩放、标准标题栏；⌘W / 红灯关闭即销毁。**⌘W 按聚焦窗口分发**：帮助中心在前台时关闭它，绝不触发主窗口的关闭流或会话确认。
- 语料内链接永不导航 webview（用户报告教训）：文档间 `.md` 链接解析为窗口内跳转（`#fragment` 为小节锚点），外部 URL 走系统浏览器，解析不到则无操作。文档正文用平台标准字体，不用品牌字体。
- 语料加载失败：显示错误态 + 重试；窗口仍被揭示（不得留用户对着不可见窗口）。

## Sidebar

必须包含：Recent Projects 与打开工程；当前工程名称；Audio Mode；External OSC target；CoreAudio device 与通道能力；master gain；Load/Change/Close；Share 与手动 monitor Refresh；全屏入口。

正常演出不显示常驻 Node/scsynth 技术状态面板。侧栏字体和 App icon 属于发行前人工视觉调整，不是实现任务的阻塞项。

## Loading、Error 与 Retry

Loading 保持两阶段 Logo 契约（v1.3.0 #50 起，第 3–5 步由 reveal 门控串联）：

1. 五点和背景圆约 0.8 秒自主入场；
2. 若工程未 ready，保持完成构图等待；
3. session ready 后 monitor iframe 立即在 splash 之下挂载并开始加载，随后播放约 1.5 秒成功收束；Internal 的 session ready 必须包含 master stage 创建成功；
4. 收束终帧保持，直到当前 iframe 导航上报就绪（load 事件）或超时兜底放行（10 秒，放行并记日志）——session ready 本身不放行；
5. loading layer 整体交叉淡出（约 0.4 秒），已就绪的 monitor 透出且不移动。

若 ready 早于第一阶段结束，先完成第一阶段再收束。若启动失败，立即停止后续动画并进入 Error Page。每次 loading session 独立随机颜色；颜色不代表启动阶段。

停止与切换（v1.3.0 用户反馈）：live session 停止（切换工程 / 关闭工程）时，shell 让旧 monitor 继续挂载，StopCover 主题色盖层淡入盖住输出画面（旧页面消隐而非被切断）；后端到达 idle 后，Welcome 在盖层下挂载、由同一淡出揭开（关闭工程路径），或由切换的 starting 快照直接接管为 loading splash——全程不闪现 Welcome。揭开记忆由 session-store 的 `stopUncoverPending` 承载（applySnapshot 事件上下文维护：stopping→idle 置位、重复 idle 保持、其他生命周期清除）。

reload monitor（⌘⇧R / 侧栏 Refresh）走同一套门控：重建的 iframe 由主题色 cover 即时遮盖（无淡入——淡入会闪出未就绪画面），新导航上报就绪或超时后交叉淡出。放行条件与生命周期在 `src/lib/monitor-reveal.ts`（纯函数 + 常量）与 session-store（`monitorLoaded` / `monitorLoadTimedOut`）实现并测试。

揭示淡出与主题（v1.3.0 用户反馈）：splash 交叉淡出、monitor 揭示盖层与 StopCover 三个 400ms 淡出统一带 `data-reveal-motion` 标记，theme-variables.css 据此将它们豁免于 Brutal 主题的全局 `transition-duration: 0s !important` 即时规则——防闪契约（#48）优先于主题的即时美学；Brutal 下其余状态切换仍然即时。`prefers-reduced-motion` 的全局降级不受此豁免影响（无障碍优先）。

Error Page 必须显示：简明摘要；Retry；Back/Close；可展开和复制的技术详情。技术详情至少包含工程路径、模式、LAN IP、target、设备、失败阶段、输出尾部和 health payload。

Retry 必须真正重新启动：

- `canStart()` 允许 `idle` 和 `error`；error 状态下侧栏主按钮文字保持 `Load`；
- 调用现有 start flow，由 Rust 增加 generation、重置 run state 并启动；
- error generation 的失败清理与定向 orphan cleanup 语义 → 运行契约 §12；不先执行多余的公开 stop flow；
- 防止同一次 retry 的重复提交；
- 新 loading session 从第一阶段开始。

Back/Close 返回 Welcome，不自动重启。

## 日志与清理

每个 session 写独立日志，保存在 App data 的 `session-logs/`，记录：manifest/preflight；session 元数据；Node/scsynth stdout/stderr——issue #93 起逐行落盘、带 `[node]`/`[scsynth]` 来源前缀、随写随 flush，且**包含关停窗口内该 generation 的最终输出**（落盘以日志所属 generation 为守卫：旧 generation 的迟到行不进新会话日志，也不进错误页 tail）；health；master stage；scsynth 瞬态重试（issue #92）；关停标记与结果（`Session ending` → 各子进程 stopped/未确认 → `All processes stopped`）；错误。保留最近 20 份，删除最旧文件。日志不写入工程目录，也不上传。

关停有界化（issue #93）：score server 与 scsynth 的 SIGTERM 宽限窗是两个独立具名常量——score server 2 秒（健康工程实测 0.01–0.2 秒退出；无持久状态、手机端自带重连等待，提前强杀无副作用），scsynth 保持 5 秒（CoreAudio 释放可能更慢）。关停顺序保持先 node 优雅释放、后 scsynth：工程侧优雅关停需要 scsynth 存活以释放合成器（并行方案已评估并否决）。

关闭工程、红灯隐藏、restart 与 `⌘Q` 的语义必须区分：只有 session stop/实际 App exit 才停止工程；普通窗口 hide 不终止正在运行的 session。实际退出必须清理 Node/scsynth；下次启动执行 orphan cleanup（运行契约 §12）。

## 内置验证工具

分发形态与注册表管线（`utilities.json`、构建期拉取、`utilities/<id>/` 原地运行）→ [`pnds-bundle.md`](../zh-CN/reference/pnds-bundle.md)「内置工具的形态」。验证工程 Multichannel Signal Generator 由独立工具仓库维护，App 仓库只提交注册表与拉取管线。

对工具本身的要求（用于验证 manifest、bus、master stage、设备通道不足和 BlackHole/DAW 路由）：

- manifest 声明 Internal、`outputChannels: 16`；生产依赖仅 `qrcode`（monitor QR 端点），其余用 Node `http`、内置 `fetch` 与最小 OSC 实现；
- performer 和 monitor 两个 server 都存在；performer `/` 只显示无 performer UI 的说明并提供 health；
- monitor 提供 16 个垂直推子与指向 performer 页的 QR 码；
- 16 路 sine 从 110Hz 开始按半音递增；默认全部静音；每路范围为 Mute / `-60 dBFS .. -6 dBFS`；增益约 20ms 平滑；
- 无自动发声、自动巡检、p5.js 或 Socket.IO。

## 测试覆盖清单

自动测试至少覆盖：

- manifest 缺省/边界 outputChannels；
- `audioBusChannels >= 2N`；
- 条件依赖检查（有生产依赖时要求 node_modules 随包安装）；
- 设备能力与 `K = min(N,H)`；
- mono master group 的创建、gain 与释放；
- mono/stereo gain 曲线和多通道固定 100%；
- health 状态与超时；
- restart 保留工程选中；
- error → Load/Retry；
- 全屏 action 的菜单、快捷键与按钮入口；
- 窗口 fade 状态机；
- 日志轮转；
- 子进程关闭与 orphan cleanup。

真实环境验证至少覆盖：

- 《Inarticulate III》Internal/External/None；
- 随包 Node sidecard 运行官方工程；
- Multichannel Signal Generator（staged 内置副本）16ch → BlackHole/DAW；
- 16ch 工程选择 2ch 设备仍 ready 并显示 `16ch → 2ch`；
- 设备、模式、target restart；
- 全屏进入/退出时 monitor 正确 resize 且 Socket.IO 不重连；
- 红灯淡出/hide、Dock 淡入/reopen、`⌘Q` 清理；
- 强制错误后 Retry 生效；
- release artifact 在干净 Apple Silicon Mac 安装运行。

## Definition of Done

1. 能安全打开目录工程并完成可读 preflight；
2. 使用固定随包 Node 运行官方工程；
3. Internal 支持 1–64 路离散输出并遵守 private bus/master contract；
4. 通道不足设备不阻止 session，UI 准确显示损失；
5. External 与 None 正确运行；
6. LAN performer/monitor、health 与 QR 链路可用；
7. monitor 在窗口和全屏尺寸变化时正确适配且不被自动 reload；
8. Welcome、Loading、Monitor、Error、Retry 状态转换正确；
9. session restart 不丢失工程选择和待应用设置；
10. red close、Dock reopen 与真正退出的窗口行为正确；
11. 无残留 Node/scsynth，日志正确写入和轮转；
12. Multichannel Signal Generator（staged 内置副本）可验证 16 路路由；
13. 可产出可更新的 macOS ARM64 release artifact。
