# PNDS App — V1 Requirements

本文档定义 PNDS App 第一版（V1）的实现范围、运行契约与验收标准。

它面向开发者与后续 coding agent。文中的内容分为三类，必须严格区分：

- **必须实现**：V1 的确定需求；
- **不得实现**：明确排除在 V1 之外的功能；
- **Deferred**：未来版本方向，V1 不设计、不预留复杂度。

参考实现：`Inarticulate III` 是第一个 PNDS score project，其 manifest、health 与关闭契约已经过真实运行验证，可作为 V1 的基准样例。

---

## 1. 产品定位

PNDS App 是一个 macOS 桌面 Host 应用，用于打开并运行 PNDS 数字乐谱工程。

它负责：

- 打开用户选择的本地工程；
- 校验工程运行资产；
- 启动并管理内置 `scsynth` 与内置 Node.js 运行的乐谱服务器；
- 管理音频模式、输出设备与总音量；
- 显示工程自己的监视/指挥页面；
- 管理工程切换、错误处理与进程清理。

它**不是**：

- 数字乐谱编辑器；
- SuperCollider IDE 或 `sclang` 运行器；
- OSC 中继器（演奏者的高频控制不经过 Rust 层）；
- 特定作品的专用程序。

作品的乐谱视觉、演奏规则、Socket.IO 逻辑、OSC 映射、SynthDef 结构与监视界面，全部属于工程本身。

---

## 2. V1 平台与范围

**必须实现：**

- macOS Apple Silicon（ARM64）；
- App 内置 ARM64 `scsynth`；
- App 内置 ARM64 Node.js runtime；
- 局域网演出：Host + 手机/平板；
- 立体声输出。

**不得实现（V1）：**

- Intel Mac、Windows、Linux 构建；
- universal binary runtime；
- 跨互联网、多地共奏；
- 多声道 / 环绕输出；
- 工程压缩包、导入安装、在线工程库；
- 运行时热切换音频模式、设备或 OSC 目标。

**Deferred：** 以上被排除项均为未来版本的合理方向，需通过新的 schema version 或明确的扩展设计引入。

---

## 3. 运行架构

```text
手机 / 平板演奏者
      │ HTTP + Socket.IO
      ▼
Node.js 乐谱服务器（工程提供，App 用内置 Node 运行）
      │ UDP / OSC
      ▼
scsynth（App 内置并启动）
      │
      ▼
CoreAudio 输出设备
```

App 自身：

```text
PNDS App（Tauri + React）
├── 工程选择与历史
├── manifest 校验（preflight）
├── scsynth 进程管理 + App Master Synth
├── Node 进程管理
├── 局域网地址选择
├── health 轮询与生命周期
└── 全屏 monitor WebView + 浮出式侧栏
```

职责边界：

| 组件            | 负责                                            | 不负责             |
| --------------- | ----------------------------------------------- | ------------------ |
| React 前端      | 工程与运行控制 UI、monitor 承载、加载与错误界面 | 处理演奏者高频消息 |
| Rust 后端       | 进程、端口、设备、bus、生命周期、日志           | 作品声音与交互逻辑 |
| Node 乐谱服务器 | 乐谱页面、Socket.IO、OSC 映射、Synth 控制       | 窗口与进程管理     |
| `scsynth`       | DSP 与音频输出                                  | 执行 `.scd`        |

`.scd` 仅用于创作阶段；运行阶段只使用 `.scsyndef`。App 不内置 `sclang`。

### 3.1 创作者的 External Debug Bridge

PNDS 框架允许作品在开发期提供自己的 SuperCollider debug bridge：创作者手动运行项目内的 `.scd`，以 `sclang` 的 `OSCdef` 接收 Node score server 在 `external` 模式下发送的作品专属 OSC，再由该 bridge 创建和控制 SynthDef。它适合在未启动 PNDS App 时调试乐谱交互与声音设计。

这不是 PNDS App 的运行时功能或通用 OSC 标准：

- App 不启动、管理或打包 `sclang`；
- `external` target 由创作者或用户显式提供；
- OSC 地址、参数和 debug helpers 完全属于作品，框架不得要求额外接口；
- 作品正式的 Internal runtime 仍只加载已编译的 `.scsyndef`，由 App 管理 `scsynth`。

---

## 4. 工程与信任模型

**必须实现：**

- 通过文件夹选择器打开本地工程目录；
- 工程根目录必须包含 `manifest.json`；
- 首次打开某个路径时，提示用户该工程将执行本地 Node.js 代码，需用户确认；
- 工程必须自带已安装的生产依赖 `node_modules/`；
- App **不得**在运行时执行 `npm install` 或任何网络安装。

**不得实现：** 沙箱隔离、工程签名、远程工程下载、自动执行未经用户选择的工程。

依赖缺失时，App 必须在启动前报错，例如：

```text
Project dependencies are missing.
Expected: <project>/node_modules
```

### 4.1 Recent Projects

**必须实现：**

- 保存用户曾打开并确认可信的工程绝对路径；
- 保存在 App 本机数据目录；
- 点击历史条目时重新执行 preflight；
- 路径或资源失效时显示错误并允许移除记录。

App **不得**复制、修改、打包或上传工程内容。

---

## 5. `manifest.json`（schemaVersion 1）

### 5.1 示例

```json
{
  "schemaVersion": 1,
  "id": "inarticulate-iii",
  "name": "Inarticulate III",
  "version": "0.1.0",
  "description": "A networked digital score for three performers.",
  "scoreServer": {
    "entry": "server.js",
    "workingDirectory": ".",
    "performerPort": 6868,
    "monitorPort": 6869
  },
  "audio": {
    "defaultMode": "internal",
    "supportedModes": ["internal", "external", "none"],
    "synthdefs": ["supercollider/synthdefs/inarticulate-iii.scsyndef"],
    "scsynth": {
      "sampleRate": 48000,
      "blockSize": 64,
      "audioBusChannels": 128
    },
    "standaloneTarget": "127.0.0.1:57110"
  }
}
```

### 5.2 字段规则

必填：

```text
schemaVersion
id
name
version
scoreServer.entry
scoreServer.workingDirectory
scoreServer.performerPort
scoreServer.monitorPort
audio.defaultMode
audio.supportedModes
```

条件必填：

```text
supportedModes 包含 "internal"
  → audio.synthdefs 必填且每个文件必须存在
  → audio.scsynth 必填
  → audio.scsynth.sampleRate 必填
  → audio.scsynth.blockSize 必填
  → audio.scsynth.audioBusChannels 必填
```

可选：

```text
description
audio.standaloneTarget
```

`standaloneTarget` 仅用于脱离 App 的手动调试。**App 不得使用它**；Internal 模式的 OSC 目标始终由 App 动态分配。

### 5.3 已从 schema 中移除

以下字段不属于 V1，不得要求或读取：

```text
scoreServer.preferredHttpPort
scoreServer.routes
roles
audio.sampleDirectory
audio.pluginDirectory
audio.scsynth.controlBusChannels
audio.scsynth.bufferCount
audio.scsynth.memorySize
```

角色由端口直接确定：

```text
http://<Host-LAN-IP>:<performerPort>/   → 演奏者页面（客户端访问）
http://<Host-LAN-IP>:<monitorPort>/     → 监视/指挥页面（App 显示）
```

两个角色在 V1 中都是**必需**的。

### 5.4 版本与路径校验

**必须实现：**

- `schemaVersion` 必须存在且等于 `1`，否则拒绝加载并提示 unsupported schema version；
- `entry`、`workingDirectory`、`synthdefs[*]` 必须是相对于工程根目录的相对路径；
- 解析并处理 symlink 后，真实路径必须仍位于工程根目录内；
- 拒绝绝对路径、`../` 逃逸与指向工程外的 symlink；
- 文件缺失时给出可读错误。

---

## 6. 音频契约

### 6.1 音频模式

模式由 manifest 驱动：

```text
默认选中   → audio.defaultMode
可选项     → 仅 audio.supportedModes 中的模式
其他模式   → 不显示或禁用，且不得启动
```

| 模式       | App 行为                                                     |
| ---------- | ------------------------------------------------------------ |
| `internal` | 启动内置 `scsynth`，动态分配 OSC 端口，创建 App Master Synth |
| `external` | 不启动 `scsynth`；使用用户输入的 OSC target                  |
| `none`     | 不启动 `scsynth`；不注入 OSC target                          |

### 6.2 scsynth 启动约定（Internal）

**必须实现：**

```text
-i 0                    不启用音频输入
-o 2                    固定两个硬件输出通道
-S <sampleRate>         来自 manifest（注意：采样率参数是大写 -S；小写 -r 是随机种子数，与音频无关）
-z <blockSize>          来自 manifest
-a <audioBusChannels>   来自 manifest
-u <dynamic port>       App 选择的可用本地 UDP 端口
-B 127.0.0.1            OSC 仅监听本机回路，不向局域网开放控制端口
-U <plugins path>       指向 App 内置的 UGen plugins 目录；App 不依赖宿主机器上的 SuperCollider 安装
```

Bus 模型：

```text
hardware output bus 0 / 1   → CoreAudio 设备前两个输出通道
private project bus 2 / 3   → 当前工程的立体声输出
```

### 6.3 输出总线协议（严格）

所有支持 `internal` 的 V1 工程必须遵守：

```text
App 注入环境变量
  PNDS_OSC_TARGET=127.0.0.1:<dynamic scsynth port>
  PNDS_AUDIO_OUTPUT_BUS=2
  PNDS_AUDIO_OUTPUT_CHANNELS=2

工程的乐谱服务器
  → 创建发声 Synth 时，将标准 out control 设为 PNDS_AUDIO_OUTPUT_BUS
  → 不得在 App 托管模式下直接输出到硬件 bus 0

standalone 手动运行
  → PNDS_AUDIO_OUTPUT_BUS 缺失时回退 out = 0
```

不遵守此协议的工程不是合格的 V1 工程。V1 **不提供兼容模式**。

### 6.4 App Master Synth 与音量

**必须实现：**

```text
App Master Synth
  In.ar(2, 2) → gain → Out.ar(0, 2)
  必须在工程 group 之后执行
  gain 使用短时平滑，避免 click
```

Master Synth 的 SynthDef 内部名为 `pndsMaster`，源码保存于本仓库 `src-tauri/resources/synthdefs/source/pnds-master.scd`，由 `npm run synthdefs:build` 在开发期调用本机 `sclang` 编译为 `.scsyndef` 并随 App 打包；App 运行时不包含 `sclang`（与 §3 一致）。参数：`in`（默认 `2`）、`out`（默认 `0`）、`gain`（默认 `0.5`，即 `80% = -6 dB`）。

音量规则：

| 项              | 规则                                                                  |
| --------------- | --------------------------------------------------------------------- |
| 默认值          | 每个新 session 固定 `80%`，不恢复上次值                               |
| 曲线            | 分贝线性插值；`100% = 0 dB`，`80% = -6 dB`（锚点非严格值），`0%` 静音 |
| 作用域          | 仅当前 session 的工程输出                                             |
| Internal        | 启用                                                                  |
| External / None | 灰显禁用                                                              |

App **不得**修改 macOS 系统音量，也不得为 External 模式发送假定的通用音量 OSC。

### 6.5 输出设备

**必须实现：**

- 列出可用 CoreAudio 输出设备；
- 默认使用系统默认输出设备；
- 用户选择保存为**本机 App 偏好**；
- 下次启动尝试恢复；设备不存在时回退系统默认并提示；
- 更换设备触发完整 session 重启。

设备选择**不得**写入工程 `manifest.json`。

### 6.6 External target

**必须实现：**

- 侧栏中 OSC 输入框，默认预填 `127.0.0.1:3333`，用户可编辑；
- 校验 `host:port`，无效时不允许启动；
- 生效时注入 `PNDS_OSC_TARGET`；
- 可按工程保存上次有效 target 为本机偏好；
- 修改 target 触发完整 session 重启。

target **不得**写入工程 manifest。

---

## 7. 网络

**必须实现：**

- 检测可用的 LAN IPv4 地址；
- 存在多个地址时由用户显式选择，不得自动取第一个；
- 使用所选 Host LAN IP 加载 monitor 页面:

  ```text
  http://<Host-LAN-IP>:<monitorPort>/
  ```

- 启动 Node score server 时注入同一个地址：

  ```text
  PNDS_HOST_IP=<Host-LAN-IP>
  ```

  工程可使用该变量为 performer QR code 构造 URL；二维码不得从 monitor WebView 的请求 host 推断，因为开发或 App 内部访问可能是 `localhost`。

- 不使用 `127.0.0.1` 或 `localhost` 作为演出地址（这会导致工程生成的二维码对手机无效）。

端口冲突策略：

```text
performerPort 或 monitorPort 被占用
  → preflight 失败，不启动工程
  → 显示具体端口与处理建议
  → 不自动改端口、不修改 manifest
```

**Deferred：** 动态 HTTP 端口分配需要工程侧运行时前端配置支持，属于后续版本。

---

## 8. 进程生命周期

### 8.1 启动顺序

```text
1. 清理上次会话可能残留的子进程（见 §8.2）；校验 manifest、路径、依赖、端口、模式
2. Internal：启动 scsynth，等待 /status 应答
3. Internal：分配 private output bus
4. 启动 Node 乐谱服务器（内置 Node，注入环境变量）
5. 轮询 http://127.0.0.1:<performerPort>/__pnds/health
6. status === "ready" 后加载 monitor 页面
7. Internal：创建 App Master Synth，应用默认 80% 音量
```

### 8.2 停止顺序

```text
1. 向 Node 进程发送 SIGTERM，等待其 graceful shutdown
2. 超时后强制终止
3. 释放 App Master Synth
4. 终止 App 启动的 scsynth
5. 清理 session 状态
```

App 退出时必须确保不留下孤儿 `node` 或 `scsynth` 进程。

App 还必须处理自身非正常退出（崩溃、强制退出）留下的残留进程：下次启动时、preflight 之前，检测上一次会话启动的 `node` / `scsynth`（通过记录的 PID 与进程命令行确认归属）并予以终止。此项清理完成后，端口冲突检查（§7）才具意义。

### 8.3 切换与重启

**必须实现：** 以下操作都执行完整 session 重启，不做运行时热切换：

```text
切换工程
切换音频模式
更改 External OSC target
更改音频输出设备
```

当已有运行中的工程时，切换必须先显示确认，说明将关闭当前服务器。

---

## 9. 工程运行契约

### 9.1 Health endpoint

工程必须在两个端口都提供：

```text
GET /__pnds/health
```

V1 强制字段：

```json
{
  "status": "ready",
  "projectId": "inarticulate-iii",
  "audioMode": "internal",
  "audio": {
    "status": "ready",
    "target": "127.0.0.1:49328"
  },
  "scoreServer": {
    "performerPort": 6868,
    "monitorPort": 6869
  }
}
```

`status` 取值固定为：

```text
starting | ready | error | stopping
```

`audio.status` 取值固定为：

```text
starting | ready | error | disabled
```

`disabled` 仅用于 `none` 模式，表示工程确认不启用音频；此时 `audio.target` 为 `null`。

可选错误字段：

```json
{
  "audio": { "error": "..." },
  "scoreServer": { "error": "..." }
}
```

App 必须依据 JSON 中的 `status === "ready"` 判定就绪，**不得**仅凭 HTTP 可达即认为可用。

以下字段不属于 V1 平台契约，App 不得依赖：`score`、`performers`、`sessionId`。

### 9.2 关闭契约

工程必须响应 `SIGINT` / `SIGTERM`，并释放 Socket.IO、OSC socket、自身 Synth 与 HTTP 服务。工程**不负责**停止 `scsynth`；后者由 App 拥有。

### 9.3 monitor 页面嵌入

monitor 页面必须允许被 App 嵌入，不得发送阻止嵌入的 `X-Frame-Options` 或 CSP `frame-ancestors`。App 不读取 monitor 页面 DOM。

monitor 页面顶部中央是 App 的标题/窗口拖动覆盖区（§10.1）：工程**不得**在该区域放置视觉元素或交互控件，必须留空。区域为窗口顶部居中一条，参考高度约 32px、宽度约 320–480px（随工程名长度变化）；最终尺寸以 App 实现为准，设计 monitor 页面时应将整个顶部中央留空处理。

---

## 10. 界面要求

### 10.1 Figma 交接与窗口模型

Figma 文件 [**PNDS UI Design**](https://www.figma.com/design/gxqwfZbIrsMfXTgrZyabv1/PNDS-UI-Design?node-id=37-46) 是 V1 的视觉参考，尤其用于 Welcome、加载页、展开侧栏的排版、字体、圆角、层级与组件气质。若 Figma 与本文档的运行或交互契约冲突，**以本文档为准**。

下列 Figma 元素为旧稿，不得原样实现：

- 原生 macOS traffic lights：App 使用 `decorations: false`；
- 运行中常开的侧栏：Figma 的展开侧栏仅作为 hover 浮出后的视觉参考；
- Internal 状态下的 `External Synth` / `127.0.0.1:3333` 示例：Audio Mode、OSC 输入与禁用状态必须由当前工程模式驱动；
- 主区域的灰色占位：项目运行后，工程 monitor WebView 必须完整占据主区域。

Figma 未覆盖的确认框、Error Page、LAN IP / 设备选择器、表单校验、hover / focus 与键盘细节，由开发 Agent 在保持现有视觉语言和本文档功能要求的前提下设计。

#### 视觉方向（非强制起点）

当前 Figma 的主背景可继续作为有效基线，不要求在开发前锁定单一灰色色值。若实现时需要扩展 Welcome、Loading、Error Page 或浮出侧栏的视觉系统，可从以下方向开始探索：

- **冷雾蓝灰**而非纯中性或水泥灰，让界面保持轻盈、青春与前沿感；
- 半透明白色或浅灰白的**玻璃层侧栏**，配合克制的 backdrop blur 与细描边；
- 极弱的蓝紫色环境渐变或光感，仅用于 App 自己的空白状态，不覆盖运行中作品的 monitor；
- 深灰而非纯黑的正文、低对比次级文字，以及少量蓝色 / 紫色 focus 或选择态；
- PNDS Logo 的随机彩点是主要的高饱和色来源，App 壳层不得与其争夺视觉焦点。

这不是固定 palette，也不是 pixel-perfect 要求。开发 Agent 可在尊重 Figma 气质、可读性、对比度和作品 monitor 主体地位的前提下选择最终色值。

**必须实现：**

```text
无原生标题栏与 traffic lights（decorations: false）
单一 WebView：
  ├─ 全屏 monitor 内容
  ├─ 覆盖式 PNDS 侧栏（不改变 monitor 布局）
  └─ 顶部中央标题区：显示「PNDS - <工程名>」，整体为窗口 drag region
     （覆盖于 monitor 之上，不改变其布局）
```

侧栏行为：

| 状态                 | 侧栏                                           |
| -------------------- | ---------------------------------------------- |
| Welcome / 未加载工程 | 常开                                           |
| 工程运行中           | 默认隐藏；鼠标移至窗口左边缘时浮出；移开后收起 |

侧栏显示时必须提供窗口拖动、最小化与退出。任何状态下保留 macOS 菜单栏与 `⌘W`、`⌘Q`、`⌘M`。

窗口拖动按状态分工：Welcome / 未加载工程时由常开侧栏提供拖动区域；工程运行中由顶部中央标题区提供（侧栏隐藏时仍可随时移动窗口）。标题区只包含标题文字，不含其他控件；其尺寸与样式在 task-3 UI 实现时确定（参考：高约 32px、宽约 320–480px，随工程名长度变化）。

### 10.2 侧栏内容

**必须实现：**

- PNDS Projects 历史列表与打开工程入口；
- 当前工程名称；
- Audio Mode 选择（受 manifest 限制）；
- External 模式的 OSC 输入框；
- CoreAudio 输出设备选择；
- 音量控制（仅 Internal 可用）。

**不得实现（V1）：** 常驻的 Node.js / SuperCollider 状态指示灯与常驻运行状态面板。底层仍使用 `scsynth /status` 与 health 轮询，但正常演出时不常驻显示技术状态。

### 10.3 启动、Logo 与错误界面

**必须实现：**

```text
加载中
  → 窗口中央显示 PNDS Logo p5.js 动画
  → 五个小点与两个背景圆自主完成快速入场
  → 动画暂停，等待项目实际 ready
  → 播放整体旋转的成功收束动画
  → Logo 淡出，monitor 淡入

失败
  → 停止加载进度与成功收束动画
  → 显示 Error Page
  → 简明错误摘要 + Retry + Back/Close
  → 可展开与复制的技术详情
```

Logo 源文件在 `PNDS Logo/`。它是现阶段的独立 p5.js 视觉原型；App 开发时将其嵌入或等价重实现，但必须保留下列视觉与行为契约。

#### 两阶段加载契约

加载动画与项目启动**并行**运行；五个小点不再逐一绑定到真实启动事件。

1. **第一阶段：快速点阵入场。** 每个 loading session 开始后，五个小点和两个背景圆自主出现，时长约 **0.8 秒**（现有原型为 50 个 60fps 归一化帧）。两个背景圆仍分别与第 2、4 个点同时进入。
2. **暂停：等待项目实际就绪。** 第一阶段结束后，Logo 保持完成的点阵构图；App 继续执行 preflight、音频、Node、health 和 monitor WebView 载入。
3. **第二阶段：成功收束。** 仅在项目实际就绪（health `status === "ready"` 且 monitor WebView 已可显示）后，播放五点收束、旋转与 `PNDS` 字样淡入，时长约 **1.5 秒**（现有原型为 90 个 60fps 归一化帧）。
4. **Dissolve：交接给作品。** 第二阶段结束时，Logo/loading layer 由不透明淡出，底层已就绪的 monitor WebView 同时淡入；monitor 不移动、不改变布局。

- 若项目在第一阶段结束前已就绪，仍须先完成快速入场，再立即开始第二阶段；
- 若项目较慢，Logo 停在暂停构图，不得假装加载已经完成；
- 当前独立 p5 原型中的自动阶段切换只用于预览。App 实现必须以真实 ready 信号触发第二阶段；
- 完成后移除 loading layer，正常演出窗口只呈现 monitor 页面。

#### 随机颜色契约

Logo 的五个小点必须保持当前的随机视觉逻辑：每一个新的 loading session 独立从既有 palette 为五点随机取色，允许重复；`PNDS` 文字优先随机使用未被五点占用的颜色，没有可用颜色时为黑色。一次 loading session 中颜色不得改变。

颜色纯属视觉随机性，不代表加载阶段。Retry 创建新的 loading session，可以重新随机配色。

#### 失败与重试

任一阶段失败时：

- 不得继续显示后续点、旋转或 dissolve；
- 立即切换到 Error Page；
- Retry 创建新的 loading session 并从第 1 点重新开始；
- Back/Close 返回 Welcome，不自动再次启动工程。

技术详情应至少包含：工程路径、音频模式、所选 LAN IP、OSC target、输出设备、失败阶段、Node/scsynth stderr 末尾若干行、health payload。

具体的 Tauri/React ↔ p5 控制 API 与 WebView 承载机制留待实际开发时确定；不得改变上述两阶段、已确定节奏、随机性和转场语义。

### 10.4 启动行为

```text
App 启动
  → Welcome Page
  → 侧栏常开，显示 Recent Projects
  → 不自动运行任何工程
```

---

## 11. 日志

**必须实现：**

- 每个 project session 写一个独立日志文件；
- 保存在 App 自身 Application Support / Logs 目录；
- 记录 App 生命周期、preflight、`scsynth` 与 Node 的 stdout/stderr、health 轮询结果、关闭结果，以及 session 元数据（模式、LAN IP、OSC target、输出设备）；
- 保留最近 **20** 个 session log，超出时删除最旧的。

日志**不得**写入工程目录，也不得上传网络。

---

## 12. 实现阶段

建议按此顺序推进，每个阶段结束时应可运行、可验证：

```text
Phase 0  阅读模板与参考工程；确认技术边界
Phase 1  工程选择、manifest 解析与 preflight 校验
Phase 2  内置 Node runtime：启动/停止乐谱服务器、health 轮询
Phase 3  全屏 monitor WebView + 浮出式侧栏 + Welcome/Error 界面
Phase 4  内置 scsynth：启动参数、动态端口、private bus、Master Synth、音量
Phase 5  输出设备、External target、模式切换与 session 重启
Phase 6  Recent Projects、日志、Logo 加载动画同步
Phase 7  打包、签名、Notarization 与现场演出验证
```

---

## 13. 测试要求

**必须覆盖：**

- manifest 解析：合法样例、缺字段、错误 `schemaVersion`、路径逃逸、文件缺失；
- 端口冲突检测；
- Internal 条件必填校验（`synthdefs` 与三个 `scsynth` 参数）；
- 音量映射（`0%` 静音、`80% = -6 dB`、`100% = 0 dB`）；
- health 状态机处理（`starting / ready / error / stopping` 与超时）；
- 进程生命周期：正常停止、超时强杀、切换重启、App 退出无孤儿进程；
- 日志轮转保留 20 个 session。

集成验证（需真实环境）：

- 使用 `Inarticulate III` 完成 Internal 模式端到端发声；
- 手机通过局域网地址加入并触发声音；
- 切换音频模式与输出设备后仍可正常运行；
- 强制错误（占用端口、删除 `.scsyndef`、错误 OSC target）能显示正确的 Error Page。

---

## 14. Agent 工作规则

- 先阅读实际代码与工程文件，再相信文档描述；
- 不得把作品自定义 OSC 协议（如 `/p1`、`/p1xy`）当作平台标准；
- 不得把 `6868` / `6869` 当作平台默认端口，它们来自工程 manifest；
- 不得将 `.scd` 当作运行时文件；
- 不得内置或调用 `sclang`；
- 不得让高频演奏消息经过 Rust 层；
- 不得在 V1 中引入 Deferred 功能来"提前预留"；
- 修改工程侧协议时，必须同步更新参考工程 `Inarticulate III` 与本文档。

---

## 15. Definition of Done（V1）

V1 完成的判定条件：

1. 能打开本地工程，完成 preflight 并在失败时给出可读错误；
2. 能以 Internal 模式启动内置 `scsynth` 与内置 Node，加载 `.scsyndef` 并发声；
3. 工程输出经 private bus 进入 App Master Synth，音量控制生效；
4. monitor 页面以 Host LAN IP 显示，手机可扫码加入并演奏；
5. Welcome、加载动画、演出视图与 Error Page 的状态转换正确；
6. 音频模式、输出设备与 External target 变更可通过 session 重启生效；
7. 关闭工程或退出 App 后无残留 `node` / `scsynth` 进程；
8. session 日志正确写入并轮转；
9. 可产出 macOS Apple Silicon 安装包并在干净机器上运行。
