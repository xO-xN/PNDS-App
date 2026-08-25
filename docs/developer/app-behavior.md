# App 产品行为规范

PNDS App 的产品行为、测试覆盖与 Definition of Done 的权威文档（收编自原 `PNDS_APP_REQUIREMENTS.md`）。本页只写 App 侧行为；运行协议一律链接运行契约，不重复。

规范分工与冲突裁决：

- 工程静态格式（manifest / 目录 / 资产）→ [`manifest.md`](../reference/manifest.md)、[`structure.md`](../reference/structure.md)
- 进程 / 环境变量 / health / 音频 bus / 关停 → [`runtime-contract.md`](../reference/runtime-contract.md)（下文简称「运行契约」）
- `.pnds` 打包与安装 → [`pnds-bundle.md`](../reference/pnds-bundle.md)
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
- App 启动进入 Welcome，不自动运行历史工程。

打开路径不弹信任确认：PNDS App 是「操作者即机主」的演出工具，打开的工程由操作者本人放入本机，运行前再弹一次本地代码确认是纯摩擦。工程历史的增删与数据格式（`recentProjects`）保持不变。

工程文件夹（侧栏顶部的分段控件 switch）：

- track 撑满行宽，段宽随名字分配，白色 pill 滑动切换；段为 `role="tab"` + roving tabindex；
- ←/→ 在聚焦段上循环切换视图；⌘←/→ 在任意位置切换当前文件夹视图且两端钳制不循环（与 ⌘↑/⌘↓ 同规，经段点击同一入口）；
- 文件夹管理走段的右键菜单：新建 / 重命名（与 ⌘R 同动作）/ 删除；Utilities 文件夹受保护（重命名与删除禁用并说明原因），文件夹上限 3 个时「新建」禁用并说明原因；
- 工程拖到文件夹段上入夹、拖到未分组段返回；拖动排序期间 pill 淡出，落定后在新位置淡入；
- 正在运行的工程卡片左缘有 accent 竖条；空闲选中仅白底。

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

启动与停止遵循运行契约 §8 与 §11。以下操作执行完整 restart：

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

## 音频 Host 行为

- UI 只能显示 manifest 声明的模式；三模式的 Host 行为表 → 运行契约 §6（模式说明见 [`audio-modes.md`](../reference/audio-modes.md)）；
- `N/H/K/B` 计算、bus 规则、只桥接前 K 路与安全丢弃 → 运行契约 §7；
- 设备列表每项显示可用输出通道数；通道不足设备视觉灰显但仍可选择，最右红色 `Nch → Hch` 损失字样标注且设置区持续显示（无 toast/modal）→ 运行契约 §7.6；
- 设备能力以有效采样率下的 CoreAudio/CPAL 配置为准；设备消失时回退系统默认并给出现有的设备不可用提示；
- 设备选择是本机偏好，变更通过 Change/restart 生效（运行契约 §6）；
- master gain 的默认值（80%）、百分比到 dB 曲线与 `N > 2` 固定 100% → 运行契约 §7.5。

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
- 侧栏覆盖 monitor，不改变 monitor 布局。

全屏入口共三处——macOS Window 菜单项、`⌃⌘F`、侧栏按钮——所有入口必须调用同一 action。全屏切换不 reload monitor。

全屏 title bar：首选实现是进入全屏时动态启用 native decorations/title bar，鼠标靠近顶部时由 macOS 显示原生 unified title bar 和 traffic lights；全屏时侧栏自绘 traffic lights 隐藏；顶部热区优先于左侧 sidebar hover；native title bar 与侧栏不同时显示；退出全屏恢复无装饰窗口。必须先在 macOS release-like 环境验证动态 decorations、透明度、styleMask 与 WKWebView 没有抖动或布局错误。若 Tauri/macOS 无法可靠动态切换，则 fallback：保持无装饰窗口，在顶部 hover 显示自绘 title bar——fallback 仍须满足互斥与三个全屏入口。

整窗淡入淡出使用 macOS 原生窗口 opacity，而非只给 React 内容加 CSS：

- 首次显示与 Dock 重开隐藏窗口：150–180ms 淡入；
- 点击红灯/Close Window：150–180ms 淡出后 hide；
- `⌘Q` 不等待动画，立即进入进程清理和退出；
- 动画被打断后必须恢复一致 opacity，不能留下不可见但可交互的窗口。

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

reload monitor（⌘⇧R / 侧栏 Refresh）走同一套门控：重建的 iframe 由主题色 cover 即时遮盖（无淡入——淡入会闪出未就绪画面），新导航上报就绪或超时后交叉淡出。放行条件与生命周期在 `src/lib/monitor-reveal.ts`（纯函数 + 常量）与 session-store（`monitorLoaded` / `monitorLoadTimedOut`）实现并测试。

Error Page 必须显示：简明摘要；Retry；Back/Close；可展开和复制的技术详情。技术详情至少包含工程路径、模式、LAN IP、target、设备、失败阶段、输出尾部和 health payload。

Retry 必须真正重新启动：

- `canStart()` 允许 `idle` 和 `error`；error 状态下侧栏主按钮文字保持 `Load`；
- 调用现有 start flow，由 Rust 增加 generation、重置 run state 并启动；
- error generation 的失败清理与定向 orphan cleanup 语义 → 运行契约 §11；不先执行多余的公开 stop flow；
- 防止同一次 retry 的重复提交；
- 新 loading session 从第一阶段开始。

Back/Close 返回 Welcome，不自动重启。

## 日志与清理

每个 session 写独立日志，保存在 App data 的 `session-logs/`，记录：manifest/preflight；session 元数据；Node/scsynth stdout/stderr；health；master stage；stop 与错误。保留最近 20 份，删除最旧文件。日志不写入工程目录，也不上传。

关闭工程、红灯隐藏、restart 与 `⌘Q` 的语义必须区分：只有 session stop/实际 App exit 才停止工程；普通窗口 hide 不终止正在运行的 session。实际退出必须清理 Node/scsynth；下次启动执行 orphan cleanup（运行契约 §11）。

## 内置验证工具

分发形态与注册表管线（`utilities.json`、构建期拉取、`utilities/<id>/` 原地运行）→ [`pnds-bundle.md`](../reference/pnds-bundle.md)「内置工具的形态」。验证工程 Multichannel Signal Generator 由独立工具仓库维护，App 仓库只提交注册表与拉取管线。

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
