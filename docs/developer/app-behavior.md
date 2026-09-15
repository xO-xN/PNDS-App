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

- macOS（arm64 与 x86_64 双轨，系统底线统一为 macOS 13.5）；
- Tauri v2 + 单一主窗口；
- 随包 Node（双架构同版，见运行契约 §2）与 scsynth（按架构双轨切片）；
- Host + 手机/平板的局域网演出；
- 1–64 路离散 Internal 输出；
- ad-hoc 签名发行与独立 Tauri updater 签名。

当前不要求：

- Windows、Linux 或 universal binary；
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
- App 启动进入 Welcome，不自动运行历史工程。Welcome 标题上方是涟漪 logo 舞台（v1.3.3 #86，用户要求自 site welcome 页移植）：App icon（`src/assets/pnds-icon.png`，与 site 同图）浮在 172px 圆形舞台上，三道错相水纹环扩散消散、整台缓浮——涟漪与光环取 `--pnds-accent`（各主题自有色），icon 保持自身配色（如 macOS 图标之于暗色模式）；icon 不可拖出 App（#122：`draggable=false` + App.css `-webkit-user-drag: none`，拖出去会存出裸图片文件）；`prefers-reduced-motion` 下水纹环整体隐藏、只余静态 halo + 图标（#122 修正 #115 的错误表述：fill-mode 默认 none，0.01ms 播完回退基础样式会定格满尺寸静止圈，环带 `data-welcome-ring` 钩子供该规则命中）；纯装饰（`aria-hidden`）。Brutal 下整个舞台不渲染（#87 用户要求：柔光语言不属于硬线条平面，`[data-color-theme='brutal'] [data-welcome-logo]` 隐藏，hero 文案独立承载页面）。

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
```

（输出设备自 v1.4.0 #58 起是设置面板「音频」栏的全局偏好：随时可改、下次启动生效，不再走 Change/restart；运行中的会话保持其启动时的音频配置。）

运行中选卡完全自由：

- 点击工程卡、⌘1..9、⌘O、Finder 拖放与双击 `.pnds` 五条路径统一为「选中 + preflight」：不弹确认框、不重置 session、主视图不从监视页掉回欢迎页；
- 卡片左缘运行竖线与文件夹「使用中」圆点跟随 session 所属工程（与选中无关），白色选中 pill 独立跟随选中，二者可并存于不同卡；被选工程的 preflight 结果（校验中/错误）当场显示在卡上；
- 底部设置卡完全跟随选中卡：选中运行卡时维持 Close/Change 与实时音量；选中其他卡时显示该卡的启动配置（音频模式/OSC，声明工程另有 Room 下拉）与 Load 按钮，音量行等待（调音量需切回运行卡）；输出设备与 LAN 地址自 v1.4.0 #58 起迁入设置面板（音频 / 节点栏）；
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

## 跨互联网节点行为（v1.4.0，#58）

工程在 manifest 声明 `telematic: true` 后（字段语义 → [`manifest.md`](../zh-CN/reference/manifest.md)），App 承担节点身份与 hub 连接的全部配置；设计决策见 ADR-0004。

- 设置面板「节点」栏（常显，非网络化用户可忽略）：节点名（App 全局一份，占位符提示本机主机名，必须显式填定才算设定过）、hub 地址（完整 URL）、token（独立字段存储、UI 遮蔽显示、永不拼入 URL、永不出现在日志）、LAN 地址（自侧栏设置卡迁入）；三项节点配置与 LAN 均在下次启动工程时生效，运行中会话的 env 不变；
- 「设置节点」门：选中工程声明了能力且三项（节点名 / hub 地址 / token）任一为空 → 会话按钮变「设置节点」，点击打开设置面板并定位到节点栏；填齐后恢复 Load/Change；Close 不受门影响（运行中会话永远可关）；未声明能力的工程永不拦；门只验齐全、不验连通；Enter 别名同样被门拦截；
- Room 下拉：侧栏设置卡内、仅声明工程显示；分组号 1 / 2 / 3 按工程持久化（默认 1，崩溃恢复不换组，绝不重置）；App 界面只显示序号，不显示派生房间全名（完整房间名由工程侧 monitor 展示，作为排障护栏）；改动下次启动生效，不 flag Change；
- 注入契约（四变量、齐全才注入、房间派生 `{manifest.id}_{分组号}`）→ 运行契约 §3；偏好在「节点」栏三项齐全时按 manifest id 记住分组号。

## 音频 Host 行为

- UI 只能显示 manifest 声明的模式；三模式的 Host 行为表 → 运行契约 §6（模式说明见 [`audio-modes.md`](../zh-CN/reference/audio-modes.md)）；
- `N/H/K/B` 计算、bus 规则、只桥接前 K 路与安全丢弃 → 运行契约 §7；
- 设备列表每项显示可用输出通道数；通道不足设备视觉灰显但仍可选择，最右红色 `Nch → Hch` 损失字样标注且设置区持续显示（无 toast/modal）→ 运行契约 §7.6；列表位于设置面板「音频」栏（v1.4.0 #58 自侧栏迁入），按 App 有效采样率枚举；
- 设备能力以有效采样率下的 CoreAudio/CPAL 配置为准；设备消失时回退系统默认并给出现有的设备不可用提示；
- 每次 scsynth spawn 恒携带 `-H`（issue #100）：会话传启动时解析的设备名（保存偏好，或回退解析出的系统默认），App 启动预热传启动时解析的系统默认名（解析失败不传、静默放弃）——scsynth 自身的默认设备解析路径撞 ObjC 运行时竞态（#99 实测：无 `-H` 47% 崩溃、显式名 0%）；解析与 spawn 之间设备消失则干净退出进错误页、输出落 session 日志，不做静默回退 → 运行契约 §7.2；
- 设备选择是本机偏好（v1.4.0 #58）：随时可改，修改在下次工程启动生效，运行中的会话保持其启动时配置（运行契约 §6/§7.2）；设备能力查询失败不再前置拦截 Load——启动路径在后端完成权威解析并干净失败；
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

## 投影窗口（v1.5.0）

面向场地屏幕的演出显示窗口（spec #128，设计决策见 [ADR-0006](../adr/0006-projection-window.md)）：又一个多页入口的 webview 窗口（label `projection`，独立 `projection.html` 入口，瘦根：不挂 AppShell）。行为票 #129（骨架）/#130（开演门）/#131（键盘与缩放作用域）全部落在本篇；两窗口共享的封面页行为见本篇末节。

### 生命周期与单实例

- 入口是侧栏右上角的「打开投影窗口」按钮（原「用默认浏览器打开」位置，浏览器入口与 `sidebar.share`/`shareHint` 文案已彻底移除）；按钮不随会话状态禁用——无演出时窗口自己进入待机。
- 单实例：已开再点 = 聚焦（或卡隐藏态时重跑揭示）；不重建。**切换工程窗口不重建、全屏与位置保持**（窗口生命周期与 session 完全解耦），内容随快照过渡。
- **全屏落定后的 webview 重排抖动（Intel / macOS 13 实测报告；复测仍偶发、退出再进全屏时好时坏）**：WKWebView 的布局间歇性跟不上原生全屏过渡，窗口底部留一条未绘制区（上游 [tauri#14264](https://github.com/tauri-apps/tauri/issues/14264)，open；issue 自述对策即「再 resize 一次」）。App 侧双对策：①Rust 观察投影窗口的 `Resized` 事件做全屏**边沿检测**，落定 **1 秒**后（复测表明白条在过渡**落定**时出现，抖早了没用）把 **webview**（非窗口——全屏画面永不动）边界 +2px 保持 150ms 再弹回、**两轮**（`window.rs::jog_webview_layout`；快速弹回可能赶在丢失的重排看到增长之前）——两次以上真实 setFrame 强制重排；绿钮/⌃⌘F/菜单所有入口都汇到同一事件，全覆盖。②`body` 全局铺 `var(--pnds-bg)` 主题底色：布局迟滞露出的底不再是 UA 默认白条，而是与页面无缝的主题色延续（迟滞仍可能发生，但不可见）。
- 打开时落在 **App 当前所在显示器**（`currentMonitor()` 居中落位，查询失败回退系统居中）；window-state 插件 denylist 掉 `projection`——跨启动几何持久化不在 v1.5 范围（spec #128），恢复的旧位置会与落位规则打架（帮助窗口仍被跟踪）。
- 窗口标题「PNDS 投影 — <工程名>」（简介或 monitor 在台时）/ 无演出时「PNDS 投影」，随界面语言实时更新（页面 `setTitle`；capabilities 需 `core:window:allow-set-title`）。
- **⌘W 按聚焦窗口分发**：投影窗口在前台时只关它（普通销毁），演出与主窗口不受影响；红灯关闭即销毁，退出 App 随之关闭。

### 内容状态机

内容是纯函数 `projectionContent(snapshot)`（`src/lib/projection-state.ts`，钉测试）：

| snapshot 状态           | 开演门 | 地址                         | 投影内容         |
| ----------------------- | ------ | ---------------------------- | ---------------- |
| starting / ready        | 未开   | ——                           | **简介**         |
| ready                   | 开     | 有 hostAddress / monitorPort | monitor          |
| ready                   | 开     | 缺地址                       | **简介**（兜底） |
| idle / stopping / error | 任意   | ——                           | **投影待机**     |

- **简介** = 选中内容的 信息页，经 #125 读取/渲染通道，与主窗口 README 面板**同组合**：**内置工具**（注册表 id 判定）直接渲染**工具信息页**——与主区 `UtilityIntro` 同一 `utilityCoverPage` 页面模型（builtin-utilities.ts，双窗口同款是构造保证）、同一封面画框装裱，且**不发 README 读取**（工具无作者 README）、不带 PreflightDock（投影是显示面非操作面）；工程则读根 README.md：封面格式渲染 ProjectCoverPage（PNDS 字标 + composer/github 药丸、大标题、含 cover 图的封面带；行为见「封面页」节），其余 README 仍为 HelpMarkdown 文档视图（v1.5 只渲染文字——图片隐藏、链接一律无操作）；无 README/读取失败回落工程名卡片；starting 快照已带 projectPath，加载期即显示。门开但缺地址事实也落简介——会话在台，「无演出」会是谎言，拼畸形 monitor URL 更糟。
- **投影待机** = 主题底色 + PNDS 字标 + 「无演出」，双语、随主题（错误态同此——后端恢复失败也是待机屏，不是空窗口）。
- monitor 组装复用主窗口契约：地址快照语义（`hostAddress` 优先）、`?theme=`/`?lang=` 首帧参数按导航快照、iframe load 事件 + 10 秒超时的 reveal 防闪盖层、theme/locale 桥推送；**唯一投影专属差异（#134）**：地址**无条件**多带 `?surface=venue` 首帧参数——venue 副本标识，工程可选按它分支渲染观众画面（契约 §14、模块手册「投影面」篇），主窗口 monitor 地址永不携带。session 事实经广播 `SessionSnapshotEvent` + `getSessionState` 恢复（visibility/focus 重拉，occlusion 丢事件先例同主窗口）。
- 内容切换全部渐变（400ms 主题色盖层，`data-reveal-motion` 豁免 Brutal 即时规则）：待机↔简介↔monitor、切换工程的地址/工程变化都走同一盖层（简介按 projectPath 键控，A→B 切换也渐变）；快照序列中途变卦时收敛到最新内容；**首个落定内容直接呈现**（开演后重开直接落 monitor，无简介/待机闪帧）。

### 投影开演门（#130，session 级）

门状态 `projectionStarted` 权威在 Rust（`SessionInner`，随 session 快照族事件下发；`toggle_projection_start` 命令只对 ready 会话生效）——双窗口同源一致，菜单加速器不经 web 状态。每次 Load/切换工程（`reset_run_state`）重置回简介；开演后关窗重开直接落 monitor（门是 session 事实，不是窗口事实）。主窗口 monitor 标题条右侧的**无文字 ▶ 按钮**（仅投影窗口存在时渲染；存在性由 `ProjectionWindowEvent` 驱动——创建由 opener 在 `tauri://created` 宣布、销毁由 Rust `Destroyed` 观察兜底）与 **⌘⏎** 菜单项（Window 菜单，标签随门翻转 开演⇄撤回）都调同一命令；未开演 ▶ 持续闪烁（`projection-start-blink`，关键帧自高亮态下沉，reduce-motion 全局钳制后即静态高亮），开演后常亮绿（`#34c759`）。

### 键盘与缩放作用域（#131）

全部沿用 focused-window-label 分派；对工程页面的键位承诺见 `page-interaction.md`（两树），开发侧速查见 [`keyboard-shortcuts.md`](./keyboard-shortcuts.md)：

| 键位         | 作用域与行为                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ⌘⏎           | App 级投影开演门（开演⇄撤回；投影窗口存在 + ready 会话才可用）                                                                                                                                                           |
| ⌘= / ⌘- / ⌘0 | **聚焦窗口自己的缩放**——投影窗口持自己的值（与主窗口的 session 级缩放互相独立），且**被记忆**：经 `projectionZoom` preference 持久化（跨工程、跨关窗重开、跨启动保持；投影开窗读初值，越界钳制回 50–200）                |
| ⌃⌘F          | 聚焦窗口的全屏——投影窗口保持原生标题栏、自管全屏（不进主窗口的 WindowStateEvent chrome 机制）；侧栏全屏按钮仍属主窗口                                                                                                    |
| ⌘⇧R          | 一个和弦**同时**重载主窗口与投影窗口的 monitor（各自的 `_r` nonce 冷拉取语义一致；投影在简介/待机时该动作为 no-op）                                                                                                      |
| ⌘W           | 聚焦窗口关闭（见「生命周期与单实例」）                                                                                                                                                                                   |
| Esc          | **在投影窗口直接归页面**——瘦根无 App web ⌘ 层、无关闭工程确认流；主窗口自 v1.2.0 起 plain-Esc 本就无 App 功能（关闭工程确认走 ⌘W），page-interaction.md 契约已按窗口作用域同步改写（并废止陈旧的「Esc → 关闭工程」表述） |

缩放的实现分内容：monitor 走共享 MonitorScaleFrame（transform + inverse-size，跨域 iframe 的既有方案）；简介**不走变换帧**——封面页是 cq 纯比例布局，会自我补偿补偿帧（视觉尺寸不变、只剩文字变糊，用户报告后改），改为**缩放内容本身**：封面缩放画框盒尺寸（85%×80% 基准 × zoom，>100% 由根裁切）、工程名卡片与文档视图用 CSS `zoom`（WebKit 布局级缩放，文字按最终尺寸重新光栅化、保真）；待机固定排版不缩放。**画框盒按 zoom 键控重挂**（Intel 报告：ASBS 投影缩放在 M 芯片正常、Intel 失灵——旧 WebKit 只改容器尺寸时不重解析后代的 cq 单位，改挂即全新布局、cq 从新画框从头解析，引擎无关）。持久化走单写者纪律：投影页持值并上报（`pnds:projection-zoom` 事件），**主窗口**是唯一的 preferences 写入方（两个 webview 各自整文件写会互相踩）。

### 封面页（README cover page，两窗口共享）

主窗口 README 面板与投影简介渲染同一 `ProjectCoverPage`；以下是 v1.5 定稿的共享行为（测试锁定）：

- **标题自适应「诚实测量」**（两窗口共用）：可用宽取自**标题区**内容盒（不受标题自身样式的 min-width 反馈影响）、文字真实宽度用**探针**量——绝对定位 + `width: max-content` 的隐藏克隆 append 进同一标题区（同容器查询单位上下文；块盒收缩宽度=文字宽**含字距**，纯布局算术、无 Range 语义、无 flex/scrollWidth 钳制，测量同步完成即移除、从不绘制），每 px 字距的渲染增量**实测斜率**（不数字符——波纹 span 会双计费）、`fonts.loadingdone` 后补测（cq 字号+无单位行高下字体交换不触发 RO）、ResizeObserver 观察**区域**而非标题（min-content 钳住盒宽后标题自身的 RO 会哑）；分支数学纯函数化于 `title-fit.ts` 并钉测试。宽度仪表**第三轮迭代**（Intel / macOS 13 报告：每个工程的标题都保 0.37em 溢出右缘）——旧仪表 Range 的字距语义跨 WebKit 代际不稳：Range 对字距失明时斜率塌向 0，退化守卫弃权、类默认 0.37em 原样上屏且无后续事件纠正；故宽度真相改探针、**Range 降级第二仪表**（真实渲染行）——溢出取两仪表**较大者**，互盖盲区（探针的尾部空格语义 ↔ Range 的字距失明），Range 仍是居中测量（translateX 1:1 修正的几何来源）；退化弃权后 300ms **重试链**（上限 16 次）兜住「首答来晚的机器」。**第三轮**（Intel 复测仍「任何窗口宽度都右侧溢出」）再拔四根钉子：①计划**不再带 text-indent**——居中行上 indent 只移一半（CSS22 §16.1）、是引擎变量半量，与实测 translateX 居中叠加成持续右偏的嫌疑源；光学居中唯一真源 = 实测 translateX（glyph 边缘位置在任何引擎都诚实）；②探针宽度对比列宽时**补一个尾部字距单位**（渲染行带最后一个字后的间距，探针收缩盒是否计入是引擎方言；多压一个单位不可见、少压正是「永远差一点」的溢出）；③`em` 取 computed fontSize 解析失败时**回退探针行盒高 / 1.05**（cq 字号在旧 WebKit 可能序列化成 min() 表达式——NaN 的 em 曾让每次 fit 直接弃权、0.37em 类默认永久上屏）；④**硬兜底**：三次收敛仍溢出 → 字距归零 + 按实测宽度**比例**缩字号（≤3 轮，下限 0.25em）——纯比例、不依赖任何引擎词汇，终结「没有合适的窗口大小」这一类。首提交/退化/兜底各记一条 info 日志（release 也落盘，目录为 `~/Library/Logs/com.xo-xn.pnds-app/`——按 bundle identifier 命名、不叫 PNDS），下次再出问题日志里就是全部测量现场。**第四轮**（Intel 复测：title **左置起排、仅右溢出**、字距仍 0.37em——非居中溢出，说明 fit 提交过错误判定且测量与绘制所见不一致；该机 Safari 18.6，旧 WebKit 假设作废）三仪表 + 一钳制：溢出真值加入**第三仪表 `scrollWidth − clientWidth`**（渲染盒自身滚动溢出，零 Range 语义、零 cq 依赖——「左起右溢」恰是它必然捕捉的形态，硬兜底的所需宽度也取它与探针的较大者）；**居中修正钳制**在一个字距 + 1em 内（合法光学修正不会更大——Range 若把 rect 报宽，无界 translateX 自己就能把整行推成左溢）；**提交后延迟校验拍**（+600ms/+2s/+5s 重跑完整 fit——度量迟滞落定后盒子不变、RO 永不再触发，必须主动复查）；同轮 body 铺主题底色（全屏布局迟滞时露出的不再是 UA 白条而是主题色延续）。**第五轮（根因锁定，页上诊断条取证）**：诊断条拍出 `dW === zW === 3119、slope 0.0、computed="144.31px"`——Safari 18.6 对**已布局元素**的 letter-spacing 变更**不重算 `width: max-content` 的本征宽度缓存**（Safari 26 已修，故 Apple Silicon 正常）：三个字距探针全读到首个布局的宽度，斜率塌 0，退化守卫永远弃权，0.37em 类默认永久上屏。修法：**每次测量全新探针**（spacing/fontSize 在插入前设好，首布局即按该值计算——`probeRect` 克隆→样式→append→量→remove）；该机文件日志目录存在但 mtime 停在 9 月 8 日（新构建未写入，原因未查），故诊断条是本轮唯一取证通道。**第六轮（棘轮根因，两帧诊断条锁定）**：全新探针后 fit 开始运行，但 title「从大到小逐拍缩小、最终缩到 10.7px」——大帧 `scrollOv=973 HARDFALL fs=36`（收敛用的 scrollWidth 在**同一 tick 刚改完样式**时读的是旧布局溢出）＋终帧 `em=16`（清掉内联字号后 getComputedStyle 未重解析 cq 类值、返回垃圾）。定性：**该引擎对「同 tick 内 改样式→问派生值」全面不可靠**。重构为「同步真相只出自全新探针、真实盒子的真相只出自落定后」：①em 一律取探针行盒高/1.05（computed 串只进诊断）；②收敛循环纯探针（widthAt 按计划的字距+字号现造克隆）；③硬兜底纯探针；④居中修正挪进 rAF（下一帧布局落定后测 Range，钳制不变）；⑤上轮的 scrollWidth 第三仪表降级为**拍间取证**（fit 开头读「上一次 apply 落定后」的溢出，只进日志/诊断条）。fit 因探针恒定而**幂等**——校验拍重跑不漂移，棘轮消失。
- **标题适配的「实测收敛」兜底**（打磨轮，投影报告二连：不居中、字距大右溢）：首版判定仍可能吃进谎报的输入——投影窗口**隐藏创建**（#51 防闪），首测可能跑在上屏前的退化布局上，且之后无任何事件再触发（尺寸未变、字体已就绪），错判挂整个 session。三重自愈：① 退化输入守卫（全零/倒挂的测量一律不落样式，保持类默认等下一触发）；② 应用方案后**重测渲染结果**，对列的真实边缘做有界收敛（`refineTitleFit` 纯函数：超宽按实测斜率收字距、字距耗尽缩字号），宽度收完再**实测居中偏差**——glyph 团中心 vs 列中心的差值经 `translateX` 1:1 修正（**不能走 text-indent**：居中行上 indent 只产生一半位移，投影字号下半误差仍肉眼可见）；③ `visibilitychange` 转 visible 即重算，兜住隐藏启动。
- **边距镜像不变量**：头部行的顶距与封面带的底距解析**同一个 `--cover-edge-inset` token**（默认 5cqh）——上沿间隙 = 下沿间隙由构造保证而非配对常数（`ProjectCoverPage.test.tsx` 钉死）；改 token 只在根上改，永不单改一侧。标题区的底部预留同样读该 token（+ 带高），嵌入侧的加宽覆写（投影侧 2cqh）经同一变量再平衡整个构图。
- **标题逐字波纹**：标题按字素切分（`Intl.Segmenter` grapheme——组合记号随基字进同一 span），每字素一个 span、错相负延迟，一道缓浪横穿标题（5.2s 循环、0.045em 幅度，幅度用 em 单位随适配算法的字号缩放）；**延迟步进按字数归一**（打磨轮：固定 0.16s/字在长标题上把相位摊满半个周期，浪散成乱跳——工具别名触发报告；总铺散封顶 0.8s，短标题保持原节奏）；**波纹 span 的 key 掺入标题**（打磨轮二：按下标复用的 span 在换选中工程时不重建、CSS 动画沿用创建时刻的起点，新增下标的 span 才从当下起跑——多选几次工程后各字素时间轴任意偏斜、浪散成乱跳；换标题即整组重建，所有字素共享同一动画起点）；**连字脚本（阿拉伯等）绝不逐字拆分**——字母会被拆散；全局 `prefers-reduced-motion` 块把波纹钳停为静止。
- **简介单向自动滚动**：封面带文字列超出时自动缓速下滚——12px/s、两端各驻留 3.5s、到底后回顶重走；滚轮/指针一碰即接管，静置 2.5s 后从读者停留处恢复；混合驱动：WebKit 的 scrollTop 整数化（整数部走 scrollTop、亚像素余量走内层 transform 合成补齐），每帧写绝对位置、外部跳动大于自漂移时重同步累加器。放得下的段落永不移动；reduce-motion 下从不自动驱动（滚轮照常可用）。
- **composer/github 链接按钮**：只有 README 元数据给出 http(s) URL 的药丸才是按钮，点击经系统浏览器打开（opener 插件；打开失败记日志、绝不 unhandled）；其余药丸是纯展示。`github` 按钮文字是品牌名，硬编码在组件里（与 PNDS 字标同姿态），**不入 locales**。封面组件另接受 `headerNote`（无药丸页右上角的角标——内置工具信息页的 `PNDS Utility`，**与工程药丸同圆角矩形底**，同品牌名姿态硬编码）与 `centerBandText`（横带文字列双轴居中——工具页一句话简介）；`sectionLabel` 为空串时不渲染节标题（工具页横带只有简介正文）。
- **投影侧画框式留白（仅投影）**：封面在约 7.5%（水平）/10%（垂直）内框中构图，随屏幅与缩放等比，且投影侧做两项加宽：带高走 `min(40cqh,42cqw)` 份额（容纳更多首节内容）、标题上下间距走更紧的边缘内缩 `--cover-edge-inset` 5cqh→2cqh（标题在其开阔区垂直居中——pt/pb 覆写只会被居中余量吸收、或仅平移标题；缩小内缩令上沿抬升与下带下移同量，两侧可见间距对称变宽；外层画框本就提供四周留白。主窗口 README 面板不传覆写、渲染与原版完全一致，测试钉死）。
- **cq 参考系按轴分置**：封面根节点是 inline-size 容器（`@container`，cqw 随面板宽），块轴 cqh 随嵌入环境解析——投影画框盒自身挂 `[container-type:size]`（缩放下构图不变式），主窗口 README 面板无尺寸容器、cqh 回退视口解析——这正是组件原版被认可的观感（size 根会把全部 cqh 重参考到 p-8 内缩面板、垂直律动整体缩约一成，用户报告「app 端间距被扩大」后回归）。

### 主区信息页路由（v1.5.0）

主区（README 面板位）按选中态分六路（`ReadmePanel`）：无选中回 Welcome；选中工程卡渲染其根 README（封面格式→封面页，否则文档视图/空态）；钻入文件夹显示**文件夹自述**；选中**内置工具**（路径 `…/utilities/<registry id>`，注册表成员才算——防用户同名目录误判）渲染**工具信息页**：封面页的最简形——别名为大标题、横带文字列只有一句双轴居中的简介（左侧无 cover）、右上角 `PNDS Utility` 药丸角标（同工程药丸底）、四点钻石取主题墨色单色（工具是 App 内容，品牌四色留给作者工程）、无 composer/github 药丸（`UtilityIntro`；页面模型 `utilityCoverPage`（builtin-utilities.ts）由主区与投影简介**共享**——双窗口同款是构造保证而非配对常数；简介文案进 locales `utilities.intro.<id>` 双语，测试钉注册表↔双词表对齐）。文件夹自述展示态用封面式排版（大标题居中 + 其下描述，面板为容器查询单位），无 PNDS/composer 头部、无横带与 cover；编辑流（名称走 renameFolder 同守卫、简介走 setFolderIntro）不变；受保护的 Utilities 文件夹不可编辑，展示 App 固定的一句话描述（locales `folderReadme.utilitiesIntro` 双语）而非空态提示。内置工具不走 README 空态——工具是 App 内容，无作者 README，写作指引对它不适用。

### 桥接与 dev 排障

- 主题/语言实时跟随：主窗口 `setupProjectionWindowBridge()` 推送（与帮助中心同模式）；投影窗口自身不写 preferences。
- **dev 排障须知（v1.5.0 实战教训）**：webview 疑似显示旧版界面时，**⌘R 不会重载 webview**——它被菜单绑定为「重命名工程」（menu.ts §v1.1.2 T6），被遮挡/后台的 webview 还会静默丢 HMR 连接，形成「改了代码但窗口不动」的假象（曾把 cq 布局中间态误诊为回归）。正确刷新：**关掉重开该窗口**或重启 `tauri dev`；vite dev 已配 `Cache-Control: no-store`（vite.config.ts），真实 reload 不会被 WKWebView 缓存喂旧模块，且 vite 自身重启会让存活 webview 整体 reload 自愈。

## Sidebar

必须包含：Recent Projects 与打开工程；当前工程名称；Audio Mode；External OSC target；CoreAudio device 与通道能力；master gain；Load/Change/Close；打开投影窗口与手动 monitor Refresh；全屏入口。

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

reload monitor（⌘⇧R / 侧栏 Refresh）走同一套门控：重建的 iframe 由主题色 cover 即时遮盖（无淡入——淡入会闪出未就绪画面），新导航上报就绪或超时后交叉淡出。放行条件与生命周期在 `src/lib/monitor-reveal.ts`（纯函数 + 常量）与 session-store（`monitorLoaded` / `monitorLoadTimedOut`）实现并测试。v1.4.1 起显式刷新还是真正的冷拉取：`bumpMonitorReload` 的 nonce 经 `buildMonitorUrl` 以 `?_r=<n>` 随 URL 下发（只随刷新变化，theme/lang 仍是导航时快照）——WKWebView 的磁盘缓存按完整 URL 作键，只重挂 iframe 会把启发式新鲜的旧页面原样直出（契约 §10「重载与 HTTP 缓存」）。

揭示淡出与主题（v1.3.0 用户反馈）：splash 交叉淡出、monitor 揭示盖层与 StopCover 三个 400ms 淡出统一带 `data-reveal-motion` 标记，theme-variables.css 据此将它们豁免于 Brutal 主题的全局 `transition-duration: 0s !important` 即时规则——防闪契约（#48）优先于主题的即时美学；Brutal 下其余状态切换仍然即时。`prefers-reduced-motion` 的全局降级不受此豁免影响（无障碍优先）。

Error Page 必须显示：简明摘要；Retry；Back/Close；可展开和复制的技术详情。技术详情至少包含工程路径、模式、LAN IP、target、设备、失败阶段、输出尾部和 health payload。

Retry 必须真正重新启动：

- `canStart()` 允许 `idle` 和 `error`；error 状态下侧栏主按钮文字保持 `Load`；
- 调用现有 start flow，由 Rust 增加 generation、重置 run state 并启动；
- error generation 的失败清理与定向 orphan cleanup 语义 → 运行契约 §12；不先执行多余的公开 stop flow；
- 防止同一次 retry 的重复提交；
- 新 loading session 从第一阶段开始。

Back/Close 返回 Welcome，不自动重启。

启动 WebKit 基线门（v1.4.2，#110）：启动时由后端读已安装的 Safari 版本（WKWebView 的 UA 冻结在 AppleWebKit/605.1.15，JS 侧无版本可读），低于 Safari 16.4 基线时经 App 风格错误对话框（`WebKitBaselineDialog`，与更新失败对话同规挂 AppShell 外）说明缘由并指引「软件更新」；满足基线或版本不可读时零打扰。文案进 locales `webkit.*`，中英成对。

## 更新检查（v1.4.3，#121）

更新提示为 check-only：App 只查询 latest.json，**绝不下载、安装或重启**——updater 插件的 `dialog` 配置关闭（原生弹窗与 `downloadAndInstall` / `relaunch` 反馈链一起退场，`tauri-plugin-process` 随之移除）。下载与安装永远是操作者自己的动作：所有更新面（手动 toast 的按钮、starting page 通知、失败对话框主按钮）统一走 `openReleasesPage()` 直达 Releases 页。

- 启动自动检查（启动 5 秒后，`startBootUpdateCheck`）**彻底静默**：失败/离线不弹任何框——演出环境连不上 GitHub 是常态，那是噪音。发现新版只把版本号持久进 updater store（会话内存级，不写偏好文件），starting page 底部显示一行「有新版 vX.Y.Z」+「前往 Releases 页」按钮；会话运行中发现也一样，下次回到 starting page 时可见。
- 手动检查（App 菜单 / 设置 About，`checkForUpdates` + `manualCheckRenderer`）保留完整三态反馈：「已是最新」toast；「有新版」toast（按钮为前往 Releases）；失败弹 App 风格失败对话框（可复制错误 + 打开 Releases）——失败对话框**仅手动路径可达**，boot 渲染器不触碰它。
- updater 插件、签名产物与 latest.json 基建保持不动（发布流程照旧产出可更新的双架构 dmg，只是 App 侧不再消费下载产物）。

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
- 投影窗口：内容状态机（快照序列）、窗口生命周期（单例/聚焦/落屏/桥）、⌘W 分派、缩放作用域与记忆（`projectionZoom`）、封面页（标题适配数学、边距镜像不变量、投影侧覆写）；
- 更新检查 check-only 三态（boot 静默、available 状态持久、手动反馈与 Releases 动作）；
- 日志轮转；
- 子进程关闭与 orphan cleanup。

真实环境验证至少覆盖：

- 《Inarticulate III》Internal/External/None；
- 随包 Node sidecard 运行官方工程；
- Multichannel Signal Generator（staged 内置副本）16ch → BlackHole/DAW；
- 16ch 工程选择 2ch 设备仍 ready 并显示 `16ch → 2ch`；
- 模式、target restart；设备偏好在下次启动生效（v1.4.0 #58）；
- 全屏进入/退出时 monitor 正确 resize 且 Socket.IO 不重连；
- 红灯淡出/hide、Dock 淡入/reopen、`⌘Q` 清理；
- 强制错误后 Retry 生效；
- release artifact 在干净 Apple Silicon 与 Intel Mac 安装运行。

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
13. 可产出可更新的 macOS arm64 / x86_64 release artifact。
