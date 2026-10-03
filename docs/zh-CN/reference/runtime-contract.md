# 运行契约

本节定义 PNDS App 与 score project 在一次运行 session 中的协议：启动参数、环境变量、HTTP/health、音频 bus、进程所有权与关闭语义。不规定作品自己的 Socket.IO 或 OSC 业务协议。

## 1. 参与者与所有权

```text
PNDS App
├── owns Node sidecar process
├── owns scsynth process (internal only)
├── owns App master group/synths
├── owns selected CoreAudio device and session preferences
└── embeds the project monitor page

Score project Node server
├── owns performer and monitor HTTP servers
├── owns project Socket.IO/data protocol
├── owns project OSC client
└── owns project synth/group/buffer resources
```

规则：

- App 不解释作品高频消息；
- 工程不停止 App 的 scsynth；
- 工程不修改 App 偏好；
- App 不修改工程目录或 manifest；
- 所有进程和 socket 的所有者负责关闭自己的资源。

## 2. 固定 Runtime

PNDS App 使用随包的 Node.js（`24.18.1`，两种架构同版）启动 score server。App 不调用系统 Node，也不执行 npm 安装。

启动形式等价于：

```text
<bundled-node> <scoreServer.entry> --audio-mode <mode>
```

其 working directory 为：

```text
<project-root>/<scoreServer.workingDirectory>
```

模式优先级：

```text
--audio-mode > manifest.audio.defaultMode
```

工程应将随包 Node 系列（Node 24，对所有架构同一基线）作为当前官方 runtime 基线。`package.json#engines` 仅供开发工具提示，App 暂不解析。

## 3. App 注入的环境变量

所有模式：

```text
PNDS_HOST_IP=<selected LAN IPv4 | manifest performerAddress>
```

v1.4.0（#62）：manifest 声明 `performerAddress`（如 `mywork.local`）时，`PNDS_HOST_IP` 的值被替换为该声明——工程零改动，仍读这个变量生成二维码与连接地址；未声明时注入所选 LAN IPv4（现行为）。声明格式与容错见 [manifest.md](./manifest.md)。

Internal：

```text
PNDS_OSC_TARGET=127.0.0.1:<dynamic scsynth UDP port>
PNDS_AUDIO_OUTPUT_BUS=<private project bus start>
PNDS_AUDIO_OUTPUT_CHANNELS=<manifest audio.outputChannels>
```

External：

```text
PNDS_OSC_TARGET=<validated user host:port>
```

None：

```text
PNDS_OSC_TARGET absent
```

跨互联网演奏（`telematic: true` 的工程，v1.4.0）：与音频模式正交——三种模式下要么四个全部注入，要么一个都不注入。变量名与语义遵守 TND 冻结契约：

```text
PNDS_NODE_ID=<App 全局节点名>
PNDS_HUB_URL=<App 全局 hub 地址，完整 URL>
PNDS_HUB_TOKEN=<App 全局 token>
PNDS_HUB_ROOM={manifest.id}_{分组号}
```

规则：

- 注入条件：manifest 声明 `telematic: true` **且** App 设置「节点」栏三项（节点名 / hub 地址 / token）全部非空；任一为空则一个也不注入（前端「设置节点」门负责强制齐全，注入权威在后端）；
- 房间永不由用户手填：`分组号` 来自侧栏 Room 下拉（1–3，按工程持久化，缺省 1，绝不重置），同作品同分组即同房间，开错工程互不可见（ADR-0004）；
- token 只走 `PNDS_HUB_TOKEN` 自身，永不拼入 `PNDS_HUB_URL`，永不出现在日志；
- 节点配置与分组号的修改在下次启动生效，运行中会话的 env 不变。

完整 performer URL（#138 契约冻结；#140 起由 App 的本地可信 HTTPS 入口网关实际注入）：

```text
PNDS_PERFORMER_URL=<完整 performer 根 URL，如 https://show.example.org:8443/>
```

- App 仅在本地可信 HTTPS 入口对当前演出生效时注入；入口只对声明了 `scoreServer.supportsPerformerUrl: true` 的工程开启（字段语义见 [manifest.md](./manifest.md)），且要求设置「可信 HTTPS」的启用开关打开、域名 / 端口已配置、证书材料当下重校验通过。未注入（开关关闭、工程未声明或配置不全）时工程读不到该变量，按原 HTTP 流程运行——对声明了适配的工程，配置不全会使启动失败并给出可行动的错误，绝不静默退回 HTTP；
- 它是 Host 为本次演出确定的**完整根 URL**：协议、域名与实际端口齐备。工程一切对外地址（二维码、复制地址、浏览器连接配置）以它为准，优先于任何由 `PNDS_HOST_IP` 拼出的地址；
- 它不是 `PNDS_HOST_IP` 的新取值，也不是 hub URL：`PNDS_HOST_IP`（连同上面的节点变量）语义与注入行为不变，照常注入；
- 完整契约（工程身份、入口接入上下文、claim token 的 origin 语义）见 §15。

规则（既有）：

- Internal 的 target 始终由 App 动态分配；
- App 不得使用 `audio.standaloneTarget`；
- External target 是 App 本机、按工程保存的偏好，不写回 manifest；
- `PNDS_HOST_IP` 必须与 App 用于 monitor 的地址一致（v1.4.0 起该值可能是 manifest 声明的地址字符串，而不仅是 LAN IP）；
- 工程可使用 `PNDS_HOST_IP` 生成 performer QR URL，不得从 monitor 请求的 host 推断。

## 4. HTTP 与网络

工程必须监听 manifest 声明的两个 TCP 端口：

```text
performerPort  → performer server
monitorPort    → monitor server
```

App 在启动前确认两个端口可用。冲突时失败，不自动换端口，也不修改 manifest。仅被当前活跃 session 自身子进程占用的端口视为可用（session 停止时即释放；判定基于占用 PID 与活跃 session 子进程 PID 的匹配）；被任何第三方进程占用仍按冲突失败。

LAN 地址规则：

- App 枚举可用的非 loopback IPv4，排除已识别的 VPN 隧道接口（如 macOS `utun`）；不按私有 IP 段或默认路由判断哪个是演出网络；
- 已选地址仍可用时，打开、切换与停止工程保留选择；运行中快照不会覆盖下一次启动的地址选择。仅有一个可用地址时自动选择，多个地址且无有效选择时由用户显式选择；
- 地址选择仅在本次 App 运行中保留，不修改 macOS 网络设置、路由器 DHCP 或工程 manifest；
- `127.0.0.1` 只用于 App 本机 health 与 scsynth OSC；
- 手机/平板与 monitor 使用所选 Host LAN IP。

## 5. Health Contract

工程必须在 **performer port** 提供：

```text
GET http://127.0.0.1:<performerPort>/__pnds/health
```

monitor port 可以提供同一 endpoint，但不是平台要求。App 只轮询 performer port。

最小 payload：

```json
{
  "status": "ready",
  "projectId": "inarticulate-iii",
  "audioMode": "internal",
  "audio": {
    "status": "ready",
    "target": "127.0.0.1:49328",
    "error": null
  },
  "scoreServer": {
    "performerPort": 6868,
    "monitorPort": 6869,
    "error": null
  }
}
```

`status`：

```text
starting | ready | error | stopping
```

`audio.status`：

```text
starting | ready | error | disabled
```

规则：

- `disabled` 只用于 `none`，此时 `audio.target` 为 `null`；
- `audio.error` 与 `scoreServer.error` 可以为字符串或 `null`；
- HTTP 200 只表示 endpoint 可达；App 必须等待 payload 的 `status === "ready"`；
- `projectId` 必须匹配 manifest；
- payload 的两个端口必须匹配 manifest；
- App 不得依赖 `score`、`performers`、`sessionId` 等工程扩展字段；
- health 超时、非法 JSON、进程提前退出或明确 error 都使 session 失败。

## 6. 音频模式

| 模式       | scsynth  | OSC target    | App master stage |
| ---------- | -------- | ------------- | ---------------- |
| `internal` | App 启动 | 动态 loopback | 启用             |
| `external` | 不启动   | 用户指定      | 不启用           |
| `none`     | 不启动   | 不注入        | 不启用           |

模式与 External target 的变更通过完整 session restart 生效，不做运行时热切换。输出设备是 App 全局偏好（v1.4.0 起在设置面板「音频」栏与采样率同住）：随时可改，修改在下次工程启动生效，运行中的会话保持其启动时的音频配置。

## 7. Internal 多通道音频

### 7.1 术语

```text
N = manifest.audio.outputChannels（1..=64，缺省 2）
H = 所选 CoreAudio 设备在 App 有效采样率下可用的输出通道数
K = min(N, H)
B = private project bus start = K
```

App 无法可靠取得设备能力或设备没有可用输出时，Internal 启动失败并显示可诊断错误。

### 7.2 scsynth 参数

```text
-i 0                              不启用音频输入
-o K                              实际打开的硬件输出通道数
-S <App 有效采样率>
-z <audio.scsynth.blockSize>
-a <audio.scsynth.audioBusChannels>
-u <dynamic UDP port>
-B 127.0.0.1
-U <App bundled UGen plugins>
-H <resolved device name>         恒携带：会话解析的设备名
```

`-H` 恒携带（issue #100）：每次 spawn——会话启动与 App 启动预热——都传入本次已解析的输出设备名：会话用保存的设备偏好或其回退解析出的系统默认名，预热用启动时解析的系统默认名（解析失败时不传 `-H`、静默放弃）。原因是 scsynth 自身的默认设备解析路径在 macOS 26 上撞 ObjC 运行时竞态（#99 实测：无 `-H` 单次崩溃 47%，显式名 0%），恒携带即永不走该路径。设备在解析与 spawn 之间消失时，scsynth 打印错误后干净退出（exit code，非信号）——不重试、直接进错误页、输出落 session 日志，不做静默回退。

`-S` 使用 App 的**有效采样率**：App 全局采样率偏好，未设置时为 `48000`。manifest 不再声明 sampleRate（已从 schema 的活跃表面移除）；旧 manifest 中残留的 `audio.scsynth.sampleRate` 被读取后忽略——不参与启动、不被改写、不导致校验失败。§7.1 的 H 与 §7.6 的设备能力判定同样以有效采样率为准。

采样率偏好的唯一修改入口是设置面板的 Audio 区域：内联下拉，选项为所有枚举输出设备支持的标准采样率并集（全集 `44100 / 48000 / 88200 / 96000`，去重升序），枚举失败或为空时回退完整固定列表。更改立即持久化，且只在下次工程启动生效——会话运行期间控件同样可改，运行中的会话保持其启动时的音频配置。输出设备选择自 v1.4.0（#58）起同住 Audio 区域（从侧栏设置卡片迁入）：同样随时可改、下次启动生效；设备列表按 App 有效采样率枚举，通道不足设备照 §7.6 标注损失。

操作员守则：整条音频链路——App 有效采样率、虚拟音频设备、链路中的 DAW、音频接口——必须运行同一采样率。虚拟音频设备（BlackHole 等 loopback 设备）只在两端搬运原始采样，**不做重采样**；任何一端与其他端不一致（例如 44.1 kHz 的 Ableton Live 工程对上 48 kHz 链路）不会报错，而是出现周期性咔哒声——这是实际发生过的现场故障。开演前确认 DAW 工程与接口的采样率都与 App 偏好一致。

必须满足：

```text
audioBusChannels >= 2N
```

由于 `K <= N`，这保证 bus `B .. B+N-1` 始终可用。

`-z` 只设定 scsynth 的合成块大小。所选设备的 IO buffer 是 CoreAudio 设备属性，由设备自身或共用该设备的其他 app（如经 loopback 设备接收音频的 DAW）决定，App 不写入该值。设备 buffer 应不小于 `audio.scsynth.blockSize` 且为其整数倍；更小的设备 buffer 会迫使一个合成块跨越多个硬件回调，属应避免的配置。实践上：稳妥默认 512，追求更低交接延迟可用 256；先开 DAW、定好 buffer，再在 App 中 Load 工程；演出进行中不改 buffer（运行中变更会让链路短暂中断）。

### 7.3 Bus 模型

```text
hardware buses:        0 .. K-1
private project buses: B .. B+N-1, where B = K
```

工程始终产生 N 路离散信号并写入 private buses。App 只为前 K 路创建硬件输出桥；若 `H < N`，其余 `N-K` 路留在未读取的 private buses 中并被安全丢弃。

App 不重新混音、不折叠、不复制到其他硬件通道，也不解释扬声器布局。

### 7.4 App Master Stage

App 使用一个 mono SynthDef：

```text
pndsMaster: In.ar(in, 1) → Lag/gain → Out.ar(out, 1)
```

App 创建专用 master group，并在其中创建 K 个实例：

```text
instance i:
  in  = B + i
  out = i
  i ∈ 0 .. K-1
```

master group 必须位于 root group 尾部，在工程 audio root group 之后执行。App 使用 group `/n_set` 一次更新全部实例 gain，并在关闭 scsynth 前释放整个 master group。

为保证执行顺序：

- Internal 工程必须在 health 报告 `ready` 前创建至少一个工程自有的 audio root group；
- 工程的全部发声 synth 和后续动态 group 必须是这些预先创建 group 的后代；
- health ready 后，工程不得再把音频节点直接追加到 scsynth root group；
- App 在 health ready 后才把 master group 追加到 root group 尾部，因此工程后续在既有 group 内创建的 synth 仍先于 master stage 执行。

scsynth node ID 是共享命名空间。范围 `2147480000..=2147483647` 保留给 PNDS App 的 master group/instances；score project 不得使用该范围。App 必须在保留范围内为 group 和最多 64 个实例分配互不冲突的固定 ID。

### 7.5 Master Gain

当 `N <= 2`：

- 新 session 默认 `80%`；
- `100% = 0 dB`；
- `80% ≈ -6 dB`；
- `0%` 为静音；
- gain 使用短时平滑；
- 只影响当前 Internal session。

当 `N > 2`：

- master gain 固定 `100% / 0 dB`；
- App 音量推子灰显；
- App 不改变既有百分比到 dB 的曲线；
- 用户可以使用 macOS/设备音量或下游 DAW 控制监听电平。

External 与 None 的 App 音量控制始终禁用。App 不修改 macOS 系统音量，也不发送假定的通用 External 音量 OSC。

### 7.6 通道不足设备

设备不足不是启动错误：

- 设备仍可选择；
- App 显示 `Nch → Hch`；
- 设备菜单中的不足项视觉降级，以红色 `Nch → Hch` 损失字样标注；
- 不弹 modal、不显示 toast；
- Load/Change 直接按 `K = min(N,H)` 启动；
- App 不通过解析 scsynth 日志猜测设备通道数。

设备能力应以 App 有效采样率的可用配置为准，而不是仅使用设备名称或系统默认声道数。

### 7.7 Internal 工程义务

Internal 模式下，App 托管的 scsynth 进程是工程的唯一音频输出目标。工程必须：

- 只加载已编译 `.scsyndef`；
- 读取 `PNDS_OSC_TARGET`，向 App 启动的 scsynth 发送标准 OSC；
- 读取 `PNDS_AUDIO_OUTPUT_BUS` 作为首个输出 bus，`PNDS_AUDIO_OUTPUT_CHANNELS` 作为离散工程输出数；
- 创建发声 synth 时将其 `out` control 指向 `PNDS_AUDIO_OUTPUT_BUS`；
- 连续写入声明的 N 路输出，不直接写硬件 bus `0`；
- 在 standalone 模式缺少 `PNDS_AUDIO_OUTPUT_BUS` 时可以回退到 `out = 0`；
- group 纪律与保留 node ID 范围遵守 §7.4；
- 拥有并释放自身创建的 group、synth、buffer 与 OSC 资源。

PNDS 只保证离散信号输出，不负责声道到扬声器的空间布局。需要现场多声道 PA 时，应将 PNDS 输出路由到有多声道能力的 DAW、矩阵调音台或其他专用软件。

## 8. Internal 启动顺序

```text
1. App 清理可确认归属的遗留子进程
2. preflight manifest、路径、依赖、端口、模式与 bus 容量
3. 枚举所选设备能力，计算 N/H/K/B
4. 启动 scsynth，等待 /status
5. 启动 Node score server，注入环境变量
6. 轮询 performer health
7. health ready 后加载/显示 monitor
8. 加载 mono pndsMaster SynthDef
9. 创建 master group 与 K 个 master instances
10. session 进入 ready
```

Master stage 创建失败必须使整个 session 失败并清理已启动的子进程。Internal session 只有在 health ready、monitor 可显示、SynthDef 已加载且 master group 的 K 个实例全部确认创建后才能进入 `ready`。

可信 HTTPS 入口生效的启动（#140）插在同一次顺序里：步骤 2 的端口 preflight 通过后、步骤 3 之前，App 重校验证书材料并在所选 LAN 接口的配置端口上**绑定**入口 listener（冲突 / 材料失败 = 本次启动失败，沿既有清理路径）；完整 performer URL 在此固定，随步骤 5 的环境变量注入；session ready 后 App 经入口发起本地 TLS/HTTP 探测（连绑定地址、以域名校验证书、经隧道要求 health 200），探测成功才发布入口 `ready`——它与 session `ready` 是两项独立事实，入口探测失败只报告入口故障，不结束本地音频或服务。

## 9. External 与 None

External：

- App 校验 target 为有效 `host:port`；
- 没有有效 target 时不得启动；
- 工程拥有 External OSC socket 和作品协议；
- target 变化执行完整 restart。

None：

- App 不启动 scsynth；
- 不注入 `PNDS_OSC_TARGET`；
- health 返回 `audio.status: "disabled"`；
- score server 和 monitor 仍正常运行。

## 10. Monitor Runtime

App 使用：

```text
http://<PNDS_HOST_IP>:<monitorPort>/
```

monitor iframe 在 session 中保持同一文档实例。窗口 resize 和进入/退出全屏不得触发 Node restart，也不应触发 iframe reload。

工程 monitor 页面必须：

- 可通过上述地址加载，并允许 iframe 嵌入——不发送阻止嵌入的 `X-Frame-Options` 或 CSP `frame-ancestors`；
- 不依赖 Tauri API 或 App DOM；
- 依据标准 viewport resize 更新布局与绘图表面（不要求 App 重建 iframe）——canvas/WebGL/p5 页面在尺寸变化时同步更新内部 drawing buffer 与坐标映射；
- 把持续的交互状态存为相对或归一化坐标，避免窗口尺寸变化后固化在旧像素坐标；
- 在窗口顶部中央为 App 的窗口标题 / 拖动覆盖区保留无关键交互区域。

进入或退出 macOS 全屏只改变窗口尺寸与装饰状态：App 不重启 Node、不重载 monitor iframe，工程必须依靠标准 resize 事件完成适配。

**右键属于页面作者**：App 抑制 WKWebView 的原生 web 菜单（Reload / Open Frame in New Window / Back 等；可编辑字段保留系统复制粘贴菜单）。抑制只 `preventDefault`、不拦截事件传播——工程在 monitor 页监听 `contextmenu` 实现的自定义右键菜单与它天然共存，App 侧无需也不提供任何接线。App 自身界面（侧栏等）的右键属于 App 设计的菜单；performer 页不在 App 中打开，右键完全由工程自理。

App 不读取、注入或调用跨 origin iframe DOM。

手动 Refresh 可以由用户显式重建 iframe；它是恢复工具，不是正常 resize 流程。

v1.4.1：显式刷新（侧栏刷新按钮、「重新加载监视窗」⌘⇧R）重建 iframe 的同时在地址上追加 `?_r=<n>` 破缓存参数，随每次刷新递增。背景：WKWebView 持有一份跨 App 重启、按完整 URL（含查询串）作键的磁盘缓存——工程 server 未发送 `Cache-Control` 时，按 RFC 7234 启发式新鲜期直接离线直出旧页面，普通重导航（重挂 iframe）无法绕过；`_r` 变化让显式刷新成为真正的冷拉取。约定：

- `_r` 是 App 内部信号，工程必须忽略未知查询参数（与 §11 对 `?theme=` / `?lang=` 的容忍要求一致）；普通导航（加载、地址变化）不携带该参数。
- 需要精细控制缓存行为的工程应在 server 响应上发送显式 `Cache-Control`；`_r` 只保证显式刷新取回最新页面，不改变普通导航的缓存语义。

## 11. 主题与语言推送（Theme / Locale Bridge）

App 以同一机制向 monitor 页单向推送当前主题与语言，工程**可选**支持：不监听的工程行为完全不变。用法层面的零配置路径与进阶选项见模块手册的[主题跟随](../modules/theme-follow.md)与[语言跟随](../modules/locale-follow.md)——本节是协议规范出处。

### 主题推送

v1.2.3 起，App 在 monitor iframe 加载完成、主题切换与窗口重获焦点时，通过跨域 `postMessage` 向 monitor 页面推送当前主题。v1.3.0 起，App 加载与重载 monitor 时还会在 iframe 地址上**总是**携带 `?theme=<name>` 首帧参数（语义见下方约定），让跟随主题的页面首帧即正确配色。

消息（App → monitor 页，单向）：

```json
{
  "type": "pnds:theme",
  "version": 1,
  "theme": "pond",
  "palette": {
    "bg": "#eef0f8",
    "sidebar-bg": "#e2e5f3",
    "card": "#ffffff",
    "pill": "#e8ebf7",
    "accent": "#5a4ff3",
    "accent-hover": "#4a3fe0",
    "accent-foreground": "#ffffff",
    "text": "#171a2b",
    "text-secondary": "#5d6484",
    "danger": "#e11d48",
    "danger-hover": "#c2143c",
    "danger-foreground": "#ffffff",
    "warning": "#ffb020",
    "warning-hover": "#f0a20c",
    "warning-foreground": "#171a2b"
  }
}
```

约定：

- `palette` 是最终颜色值（键名与 App 的语义 token 同名）——大多数工程只消费 palette，无需知道主题概念；App 新增主题时工程零改动自动跟随。`theme` 名留给需要整套设计语言分叉的工程（如按主题切换圆角/字重）。
- 送达语义是 best-effort、“最新值覆盖”：App 不保证恰好一次（挂起的 WebView 可能丢消息，App 在焦点重获时重推）。页面必须幂等地应用消息（把值写入自己的 CSS 变量即可）。
- 页面首帧配色如需避免闪变，可在加载时读取 URL 查询参数 `?theme=<name>` 作为初值。v1.3.0 起 App 加载与重载 monitor 时**总是**携带该参数（值在 iframe 导航时快照——会话中切换主题不会重载页面，更新仍由 postMessage 推送）；工程仍须容忍其缺席（直接在浏览器打开、旧版 App 等）。
- performer 页不参与（不在 App 中打开，永远使用工程自带配色）。
- App 不会注入或改写 monitor 页的任何内容——是否、如何使用推送完全由工程决定。

### 语言推送

v1.3.0 起，App 以与主题桥相同的机制向 monitor 页面推送当前**解析后的**语言代码：推送触发器完全共用（monitor iframe 加载完成、语言切换、窗口重获焦点、心跳）。同一版本起，App 加载与重载 monitor 时还在 iframe 地址上**总是**携带 `?lang=<code>` 首帧参数（语义与 `?theme=` 一致）。

消息（App → monitor 页，单向）：

```json
{
  "type": "pnds:locale",
  "version": 1,
  "locale": "zh-CN"
}
```

约定：

- `locale` 是**解析后的**语言代码（当前词表：`en` / `zh-CN`），不是 General 设置项——选择“跟随系统”的会话推送系统解析出的代码。App 未来新增语言时只扩词表，消息形状不变。
- 送达语义与主题桥一致：best-effort、“最新值覆盖”，页面必须幂等地应用消息；App 不保证恰好一次。
- 页面首帧如需避免语言闪变，可在加载时读取 URL 查询参数 `?lang=<code>` 作为初值。值在 iframe 导航时快照——会话中切换语言不会重载页面，更新由 postMessage 推送；工程仍须容忍其缺席（直接在浏览器打开、旧版 App 等）。
- 不实现语言跟随的页面完全不受影响：App 不注入或改写 monitor 页的任何内容，`?lang=` 对忽略它的页面只是无害的查询参数。
- performer 页不参与（不在 App 中打开，永远使用工程自带语言）。

## 12. Shutdown Contract

工程必须响应 `SIGINT` 与 `SIGTERM`：

1. 停止接收新连接；
2. 关闭 performer/monitor HTTP 与 Socket.IO；
3. 释放工程 OSC socket；
4. 释放工程 synth、group、buffer；
5. 进程退出。

App 停止顺序：

```text
0. 关闭可信 HTTPS 入口（若本次演出启用）：停 listener、断开活动连接、释放受管资源（#140）
1. 向 Node 发送 SIGTERM 并等待 graceful shutdown
2. 超时则强制终止 Node
3. 释放 App master group
4. 请求/终止 App scsynth
5. 清理 child registry 与 session state
```

入口在一切停止路径（Stop、Restart、工程替换、确认退出、启动失败的清理）中都最先关闭：手机立即看到断连而非被路由进后续内容；入口生命周期 = session 生命周期，替换工程后旧 QR 不会路由到新工程。

App 退出后不得遗留其拥有的 Node 或 scsynth。崩溃或 force quit 后，下一次 App 启动必须使用记录的 PID 和命令行确认归属，再进行 best-effort orphan cleanup。

Orphan cleanup 永远跳过属于当前活跃 session 的子进程（以 SessionManager 持有的进程句柄 PID 判定）：运行中对其他工程执行 preflight 不得伤害正在运行的 session，其归属记录同步保留；无活跃 session 时（App 启动、error 后 Retry）清理行为不变。

任何启动或运行时失败在对外进入 `error` 前，必须先执行当前 generation 的失败清理：停止 Node、释放 master group、停止 scsynth 并清空进程句柄。若强制终止无法确认，child registry 必须保留归属记录；从 `error` 直接 Retry 时，start flow 在端口 preflight 前对该 generation 执行定向 orphan cleanup。Retry 不调用面向正常 session 的公开 stop flow。

## 13. Runtime 合规验证

至少验证：

- Internal、External、None health 状态；
- Node/scsynth 提前退出与 health 超时；
- SIGTERM graceful shutdown 与强杀升级；
- 无残留进程；
- mono、stereo、16ch 与 64ch manifest 边界；
- `audioBusChannels < 2N` 被 preflight 拒绝；
- `N > H` 时仍 ready，只创建 K 个 master instances；
- master group gain 更新与释放；
- monitor resize 不产生 iframe reload 或 Socket.IO reconnect；
- 固定随包 Node（`24.18.1`）下官方工程完整启动。

## 14. 投影面协议（?surface=venue 与缩放归属握手）

v1.5.0 起，App 的**投影窗口**与它加载的 monitor 副本之间有两条投影面协议：URL 首帧参数 `?surface=venue`（宿主 → 页面，副本标识）与缩放归属握手（页面 → 宿主，能力声明，#135 起）。主窗口（指挥的操作面）**永不参与**这两条——它不带参数、也永远由 App 拥有缩放。用法层面的分支与声明示例见模块手册的[投影面](../modules/projection-surface.md)——本节是协议规范出处。

### 面参数（?surface=venue）

投影窗口加载与重载 monitor 时，在 iframe 地址上**无条件**携带首帧参数 `?surface=venue`——与 `?theme=`/`?lang=`（§11）同机制、同快照语义。

约定：

- 取值 `venue` 表示该副本正被投影窗口加载到场地屏幕。本版仅此一值，取值集合保留扩展空间——App 不理解参数语义，未来新增取值不构成破坏性变更的前提是工程遵守下一条。
- 工程**可选**响应：不读取该参数的工程（契约本就要求忽略未知查询参数）在投影窗口上的画面与主窗口完全一致——「未适配 = 镜像 monitor」，行为与引入该参数之前完全相同。
- 读取该参数的工程**必须容忍未知取值**（含完全忽略——把不认识的取值当作参数缺席处理），不得因取值不在已知集合而报错或渲染失败。
- 值在 iframe 导航时快照：加载 / 地址变化 / ⌘⇧R 显式重载时重新携带，会话中不因窗口状态变化重导航；`?_r=` 重载 nonce 照常叠加。参数也可能整体缺席（直接在浏览器打开、旧版 App 等）——页面必须容忍。
- 投影面的缩放、主题/语言桥（§11）、reveal 防闪与重载语义对 venue 副本原样生效——origin 不变，页面无需任何特殊配合。
- 简介与投影待机阶段不加载 monitor 页，参数不出现——`surface=venue` 只作用于 monitor 阶段。

### 缩放归属握手（{type:"pnds-projection", zoom:"page"}）

页面 → 宿主方向的首条消息（#135）：适配工程的 monitor 页可在加载后向宿主声明**自己拥有缩放**：

```js
window.parent.postMessage({ type: 'pnds-projection', zoom: 'page' }, '*')
```

背景：App 投影窗口的 ⌘= 缩放（MonitorScaleFrame 布局缩放）与工程页面自己的缩放绑在同一颗键上，焦点/菜单路由决定谁吃到键、双发时叠加——声明让键的归属确定。`targetOrigin` 用 `'*'` 是契约的一部分：载荷是能力声明、无敏感内容，而页面不知道宿主 origin。

约定：

- `type` 固定为 `pnds-projection`，`zoom` 本版仅取 `'page'`（声明缩放归页面）；取值集合保留扩展空间，宿主只按 `type` 与 `zoom` 的取值匹配（载荷携带其他字段时忽略之）。
- App 收到声明后，**该次导航**的 monitor 舞台不再应用 App 自己的 ⌘=/⌘-/⌘0 缩放动作：菜单 Zoom In/Out/Reset 对该窗口为**无操作**（菜单保持可用、派发照常送达，窗口侧不再应用）——键留给页面，页面自己的缩放（光标锚定、密度跟随等）全部保留。舞台同时撤下 App 缩放的站姿（缩放帧回落 100%）：页面自己的缩放从 1× 起算，两套缩放永不叠加。
- **归属生命周期 = 单次导航**：加载、地址变化、⌘⇧R 显式重载即复位回默认（App 拥有），页面重新声明后再次让位——不跨导航记忆，无配置、无迁移。
- **默认 = App 拥有**：未声明的副本（未适配工程）行为与本握手引入之前逐字节一致。简介、内置工具、封面等非 monitor 阶段不加载 monitor 页、无声明通道，App 缩放照常。
- **消息校验**：宿主只认**本 iframe 自己的窗口**发出的、`type` 与 `zoom` 取值精确匹配的消息；type 不匹配、`zoom` 取值未知、来源不对、载荷畸形的消息一律忽略——页面内容是不可信输入，任何消息都不得使宿主抛错。
- App 侧的缩放值与持久化（窗口记忆）不因让位改变：让位期间记忆值原地等待，未声明导航（或重载后的默认期）照常生效。

## 15. 完整 performer URL 与外部入口（#138 冻结契约）

本节冻结本地可信 HTTPS 入口与工程之间的公开契约。证书材料的配置、导入、校验与受保护存储随 #139 交付，入口本身（TLS 网关、入口状态与生命周期）随 #140 交付（操作者准备见[https.md](./https.md)：域名与端口是普通偏好字段，证书链与私钥只存在后端受限权限文件中，不进偏好回传 / 工程 / manifest / `.pnds` / 日志）。本节冻结的是命名、容错、优先级与两侧义务。PNDS Template 已按此契约适配（见其 docs/implementation.md「完整 performer URL」）；未适配工程不受任何影响。

### 变量与能力声明

- 启动变量 `PNDS_PERFORMER_URL`（§3）：入口生效时注入的完整 performer 根 URL，含协议、域名与实际端口；
- 能力声明 `scoreServer.supportsPerformerUrl: true`（[manifest.md](./manifest.md)）：工程承诺读取该完整 URL、据它生成二维码与连接配置，并能在该 origin 下加载页面脚本与建立实时连接；缺省 = 未适配的旧工程，入口不得静默对其生效（#140 交付的兼容行为：设置卡显示醒目提示，启动前弹确认对话框，操作者显式选择「使用 HTTP 启动」才继续，取消则不动任何东西）；
- 优先级：提供 `PNDS_PERFORMER_URL` 时，工程一切对外地址使用该完整 URL；未提供时沿用 `http://<PNDS_HOST_IP>:<performerPort>/`（现行为），不强制迁移旧 manifest。

### 工程身份与入口接入上下文

- 外部入口绑定**当前演出的工程身份**：`manifest.id` 加上该次 session。入口发布的 URL 与其接入上下文（入口服务的页面、`__config.js` 注入的 `projectId` / `performerUrl` / 页面角色）都派生自当前工程——App 的网关据此**拒绝与当前工程不匹配的旧入口**——结果要求是冻结的：替换工程后，旧 QR 不得路由到新工程。#140 以结构方式落实：入口生命周期 = session 生命周期，替换工程时旧 listener 先关闭再开新的——旧 QR 经由的网关已不存在；
- 工程身份**不是**座位身份：claim token、座位与恢复语义仍完全归工程（模块手册[乐手身份与座位](../modules/players.md)），本契约不重定义它们，也不解释任何艺术事件；
- 页面角色由服务端注入（`__config.js` 的 `role` 字段），**不得凭共享外部端口推断**：入口端口与 manifest 端口无关，浏览器端的端口比较在入口之下不可靠；
- monitor 页保持**内部连接**：经原内部地址跨端口连接 performer 服务，不经外部入口，也不新增公网管理入口。

### claim token 与 origin

- claim token 存放在浏览器 localStorage，**按 origin 隔离**：同一 HTTPS origin 的断线重连照常复用 token、恢复原座位——工程既有逻辑零改动；
- 协议、域名或端口任一变化即不同 origin：App 与工程都**不承诺跨 origin 迁移**旧 token。设备在新 origin 下按新加入处理（拿新 token、新座位）；服务端旧座位记录仍在，操作者可用 monitor 的重配入口清理。普通 HTTP → HTTPS 切换同样改变 origin——入口的准备说明必须把这一点明确告知操作者。

## 16. 演出 DNS 与后台守护进程（#174）

后台 LAN DNS 服务（守护进程 `dnsd`）随 App bundle 分发，经 SMAppService 以 LaunchDaemon 形式由系统管理：操作者在设置里一次性授权后随登录/重启自启，普通域名持续转发到独立上游，**不依赖 App 存活**。演出域名映射由当前 session 以租约持有。本节冻结映射的激活条件、生命周期与两侧义务；操作者流程见 [dns.md](./dns.md)。

### 映射生命周期

- **激活条件**（三者同时成立，缺一不装）：DNS 服务开关已开（App 偏好）× 本次 start 实际打开了可信 HTTPS 入口（§15 的 `resolve_entry_launch` = `Ok(Some)`，即操作者开关 × 工程声明 × 证书可启动）× 入口域名可解析；
- **安装与验证**：入口网关绑定成功后、入口发布可用之前，App 经控制面下发映射（域名 × 本次所选 LAN 地址 × session generation），守护进程**在自己内部用真实查询管线完成验证**（对本域 A 查询必须解析到该地址）后才算生效——安装失败或验证失败只反映为快照上的 `dnsMapping: error`，**永不使 session 失败**（入口是独立事实，映射是入口之上的独立事实）；
- **租约**：映射以 60 秒租约持有，session 的租约监督线程每 20 秒续期。Stop / Restart / 替换 / 模式切换 / 正常退出在关停序列中**紧跟入口关闭之后**撤销映射（以 run id + generation 为持有凭据）；App 异常退出后租约到期由守护进程撤销——任何路径都不会把旧地址留给下一次演出；
- **已知域名不转发**：守护进程持久记忆"曾被用作演出映射的域名"。无活跃映射时对这些域名的查询一律本地应答 NXDOMAIN——既不沿用旧 LAN 地址，也不转发公网旧地址（演出网络里的手机在两场演出之间不应到达公网旧入口）；
- **普通转发**：非演出域名按序转发独立上游（App 内置默认公共解析器，无编辑 UI；控制面 `config.set` 缝隙仍接受 IP 上游列表），带每上游 2s 超时与 6s 整体预算的故障切换；缓存有硬上限（正应答 ≤300s、负应答 ≤10s、容量 512），演出切换不清普通缓存；
- **端口与特权**：守护进程以 root 绑定 UDP/TCP 53 于**操作者选定的固定物理 LAN 地址**（未指定或地址已失效时如实回退全接口并在状态中说明）；绑定失败（已有 DNS 服务占用）不使守护进程退出——控制面继续应答并在状态 `bindError` 中如实报告，App 的启用流程据此给出「停用占用者后重试」的明确结果——App 不抢占、不杀已有服务，主 App 永不提权；
- **控制面**：App ↔ 守护进程走固定路径 Unix socket 的 line-JSON 协议，仅 `mapping.set / mapping.refresh / mapping.clear / config.set / verify / status / stop` 七个动词；写操作按对端 uid 鉴权（root 或 console 用户）。守护进程不执行工程脚本、不执行 shell、不持有任何凭据。

### 网络边界与承诺范围

- 日常转发仅在**本机开机、未休眠、联网且服务健康**期间可用；Mac 关机/休眠/离网期间的全网 DNS 不在保证范围内，恢复路由器原 DNS 的步骤属于操作者文档（dns.md）；
- DNS 与 HTTPS 是两个事实：映射生效只证明"域名解析到这台 Mac"，不证明入口可用（§15 的入口探测、乐手设备验收各自独立）；
- 地址选择沿用 §4：映射使用操作者在「节点」区显式选定的物理 LAN 地址；VPN 隧道接口不参与选址，App 不从默认路由或首地址猜测，也不修改 macOS 网络设置、路由器 DHCP 或工程 manifest。
