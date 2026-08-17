# PNDS App Requirements

本文档定义 PNDS App 当前产品范围、Host 行为、用户体验和 Definition of Done。它是 evergreen requirements，不绑定单个 release 名称。

相关规范：

- score project 静态格式：[`PNDS_SCORE_PROJECT_SPECIFICATION.md`](./PNDS_SCORE_PROJECT_SPECIFICATION.md)
- App 与工程运行协议：[`PNDS_RUNTIME_CONTRACT.md`](./PNDS_RUNTIME_CONTRACT.md)
- 实施阶段与 release scope：[GitHub issues](https://github.com/xO-xN/PNDS-App/issues)（milestone 分组）

规范发生冲突时：工程格式以 Score Project Specification 为准，进程/环境变量/health/audio bus 以 Runtime Contract 为准，App 产品行为以本文档为准。

---

## 1. 产品定位

PNDS App 是运行 PNDS 数字乐谱工程的 macOS 现场 Host。

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

---

## 2. 平台与交付范围

必须支持：

- macOS Apple Silicon ARM64；
- Tauri v2 + 单一主窗口；
- 随包 ARM64 Node.js `24.18.1`；
- 随包 ARM64 scsynth、标准 UGen plugins 与 App master SynthDef；
- Host + 手机/平板的局域网演出；
- 1–64 路离散 Internal 输出；
- ad-hoc 签名发行与独立 Tauri updater 签名。

当前不要求：

- Intel Mac、Windows、Linux 或 universal binary；
- 跨互联网分布式演出；
- `.pnds` bundle、checksum、目标平台/runtime asset 安装检查；
- Creator Guide 与在线工程库；
- 运行中无重启地热切换模式、设备或 target；
- App 直接配置环绕声、扬声器或空间化布局。

---

## 3. 工程选择与历史

必须实现：

- 通过目录选择器打开工程；
- 打开路径即保存为本机 Recent Projects（工程历史），并直接进入 preflight；
- 点击历史条目重新 preflight；
- 支持拖拽排序和移除历史记录；
- 失效路径显示可读错误；
- App 启动进入 Welcome，不自动运行历史工程。

v1.2.0 移除了首次打开路径的信任确认：PNDS App 是"操作者即机主"的演出工具，打开的工程由操作者本人放入本机，运行前再弹一次本地代码确认是纯摩擦；工程历史的增删与数据格式（`recentProjects`）保持不变。

运行时 App 不复制、修改、上传或安装工程内容。开发者工具的显式操作除外（编译写入 synthdefs 产物、打包只读源工程）；App 自管数据目录内的解压副本随历史移除回收。设备、OSC target 与 recent paths 是 App 本机偏好，不写入 manifest。

Preflight 必须包含：

- schema 与字段；
- 路径 containment 和资产存在性；
- 仅在工程声明生产依赖时检查 `node_modules`；
- Internal outputChannels 与 audioBusChannels；
- performer/monitor 端口占用；
- 模式与 External target；
- 设备能力可用性。

---

## 4. 状态与 Session

外部可见状态至少包括：

```text
idle | starting | ready | stopping | error
```

启动与停止必须遵循 Runtime Contract。以下操作执行完整 restart：

```text
切换工程
切换音频模式
更改 External OSC target
更改输出设备
```

已有 session 时切换工程必须确认将关闭当前工程。restart 过程中必须保留当前工程选中状态和待应用设置，不得让侧栏无故取消选择。

Rust session manager 是运行状态真源。React 不得用本地 reset 伪造后端已经停止。

---

## 5. 网络与 Monitor

必须：

- 枚举非 loopback LAN IPv4；
- 多地址时让用户明确选择；
- 使用同一地址注入 `PNDS_HOST_IP` 并打开 monitor；
- 以 performer health `status === "ready"` 判断 score server 就绪；
- Internal session 只有在 health ready、monitor 可显示且 App master stage 完整创建后才能进入 `ready`；
- monitor iframe 完整占据主区域；
- 保留手动 Refresh 以重建 monitor iframe。

正常窗口 resize、进入全屏和退出全屏不得自动重载 iframe 或重启 Node。工程 monitor 必须依据 Score Project Specification 响应 viewport resize。

App 不读取跨 origin monitor DOM，也不让演奏者高频数据经过 Rust。

---

## 6. 音频 Host 要求

### 6.1 模式

UI 只能显示 manifest 声明的模式：

| 模式     | Host 行为                                           |
| -------- | --------------------------------------------------- |
| Internal | 启动 scsynth、分配 private buses、创建 master stage |
| External | 不启动 scsynth，注入用户 target                     |
| None     | 不启动 scsynth，不注入 target                       |

### 6.2 多通道

App 必须按 Runtime Contract 计算 `N/H/K/B` 并启动 scsynth。

- manifest 缺少 `audio.outputChannels` 时按 2；
- 合法范围 1–64；
- `audioBusChannels < 2N` 时 preflight 失败；
- 工程需要的通道多于设备能力时仍可启动；
- 只桥接设备可用的前 K 路，剩余路丢弃；
- 不 downmix、不复制、不重新排列工程通道。

### 6.3 设备 UI

设备列表每项显示可用输出通道数。对当前工程通道不足的设备：

- 视觉灰显但仍可选择；
- 最右显示红色叉号；
- 不显示 toast 或 modal；
- 设置区域持续显示例如 `16ch → 2ch`。

设备能力必须由 CoreAudio/CPAL 配置取得，并考虑工程 sample rate。设备消失时回退系统默认并给出现有的设备不可用提示。

设备选择是本机偏好，变更通过 Change/restart 生效。

### 6.4 Master Gain

`outputChannels <= 2` 的 Internal session：使用当前百分比到 dB 曲线，默认 80%。

`outputChannels > 2`：

- gain 固定 100%；
- 推子灰显；
- 不修改曲线；
- 不控制系统音量。

External/None 也禁用推子。

---

## 7. Window 与全屏

### 7.1 窗口模式

窗口模式保持当前无装饰 PNDS 壳层：

- 自绘 traffic lights；
- Welcome/Error 使用常开侧栏；
- ready monitor 使用左边缘 hover 浮出侧栏；
- 顶部中央显示 `PNDS - <project>` 并作为 drag region；
- 侧栏覆盖 monitor，不改变 monitor 布局。

### 7.2 全屏入口

必须提供：

- macOS Window 菜单项；
- `⌃⌘F`；
- 侧栏按钮。

所有入口必须调用同一 action。

### 7.3 原生全屏 title bar spike

首选实现：

- 进入全屏时动态启用 native decorations/title bar；
- 鼠标靠近顶部时由 macOS 显示原生 unified title bar 和 traffic lights；
- 全屏时侧栏中的自绘 traffic lights 隐藏；
- 顶部热区优先于左侧 sidebar hover；
- native title bar 与侧栏不同时显示；
- 退出全屏恢复无装饰窗口。

必须先在 macOS release-like 环境验证动态 decorations、透明度、styleMask 与 WKWebView 没有抖动或布局错误。

若 Tauri/macOS 无法可靠动态切换，则 fallback：保持无装饰窗口，在顶部 hover 显示自绘 title bar。fallback 仍须满足互斥与原有三个全屏入口。

全屏切换不 reload monitor。

### 7.4 整窗淡入淡出

使用 macOS 原生窗口 opacity，而不是只给 React 内容添加 CSS：

- 首次显示：150–180ms 淡入；
- Dock 重开隐藏窗口：150–180ms 淡入；
- 点击红灯/Close Window：150–180ms 淡出后 hide；
- `⌘Q` 不等待动画，立即进入进程清理和退出；
- 动画被打断后必须恢复一致 opacity，不能留下不可见但可交互的窗口。

---

## 8. Sidebar

必须包含：

- Recent Projects 与打开工程；
- 当前工程名称；
- Audio Mode；
- External OSC target；
- CoreAudio device 与通道能力；
- master gain；
- Load/Change/Close；
- Share 与手动 monitor Refresh；
- 全屏入口。

正常演出不显示常驻 Node/scsynth 技术状态面板。

侧栏字体和 App icon 属于发行前人工视觉调整，不是当前工程实现任务的阻塞项。

---

## 9. Loading、Error 与 Retry

### 9.1 Loading

保持两阶段 Logo 契约：

1. 五点和背景圆约 0.8 秒自主入场；
2. 若工程未 ready，保持完成构图等待；
3. session ready 且 monitor 可显示后播放约 1.5 秒成功收束；Internal 的 session ready 必须包含 master stage 创建成功；
4. loading layer 淡出，monitor 淡入且不移动。

若 ready 早于第一阶段结束，先完成第一阶段再收束。若启动失败，立即停止后续动画并进入 Error Page。

每次 loading session 独立随机颜色；颜色不代表启动阶段。

### 9.2 Error Page

必须显示：

- 简明摘要；
- Retry；
- Back/Close；
- 可展开和复制的技术详情。

技术详情至少包含工程路径、模式、LAN IP、target、设备、失败阶段、输出尾部和 health payload。

### 9.3 Retry

Retry 必须真正重新启动：

- `canStart()` 允许 `idle` 和 `error`；
- error 状态下侧栏主按钮文字保持 `Load`；
- 调用现有 start flow，由 Rust 增加 generation、重置 run state 并启动；
- `error` 状态必须满足失败 generation 已完成资源清理；若强杀未确认，Retry 在 preflight 前执行该 generation 的定向 orphan cleanup；
- 不先执行多余的公开 stop flow；
- 防止同一次 retry 的重复提交；
- 新 loading session 从第一阶段开始。

Back/Close 返回 Welcome，不自动重启。

---

## 10. 日志与清理

每个 session 写独立日志，保存在 App data 的 `session-logs/`，记录：

- manifest/preflight；
- session 元数据；
- Node/scsynth stdout/stderr；
- health；
- master stage；
- stop 与错误。

保留最近 20 份，删除最旧文件。日志不写入工程目录，也不上传。

关闭工程、红灯隐藏、restart 与 `⌘Q` 的语义必须区分。只有 session stop/实际 App exit 才停止工程；普通窗口 hide 不应终止正在运行的 session。

实际退出必须清理 Node/scsynth；下次启动执行 orphan cleanup。

---

## 11. 自带验证工程

仓库提供普通 score project：

```text
examples/Multichannel Signal Generator/
```

它不是安装到 App 数据目录的“内置项目”基础设施。

要求：

- manifest 声明 Internal、`outputChannels: 16`；
- 生产依赖仅 `qrcode`（monitor QR 端点），其余使用 Node `http`、内置 `fetch` 与最小 OSC 实现；
- performer 和 monitor 两个 server 都存在；
- performer `/` 只显示无 performer UI 的说明并提供 health；
- monitor 提供 16 个垂直推子；
- monitor 提供指向 performer 页的 QR 码；
- 16 路 sine 从 110Hz 开始按半音递增；
- 默认全部静音；
- 每路范围为 Mute / `-60 dBFS .. -6 dBFS`；
- 增益约 20ms 平滑；
- 无自动发声、自动巡检、p5.js 或 Socket.IO。

该工程用于验证 manifest、bus、master stage、设备通道不足和 BlackHole/DAW 路由。

---

## 12. 测试要求

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
- Node `24.18.1` sidecar；
- `examples/Multichannel Signal Generator` 16ch → BlackHole/DAW；
- 16ch 工程选择 2ch 设备仍 ready 并显示 `16ch → 2ch`；
- 设备、模式、target restart；
- 全屏进入/退出时 monitor 正确 resize 且 Socket.IO 不重连；
- 红灯淡出/hide、Dock 淡入/reopen、`⌘Q` 清理；
- 强制错误后 Retry 生效；
- release artifact 在干净 Apple Silicon Mac 安装运行。

---

## 13. Definition of Done

PNDS App 当前要求完成的判定：

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
12. `examples/Multichannel Signal Generator` 可验证 16 路路由；
13. 可产出可更新的 macOS ARM64 release artifact。
