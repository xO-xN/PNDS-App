# PNDS Runtime Contract

本文档定义 PNDS App 与 score project 在一次运行 session 中的协议：启动参数、环境变量、HTTP/health、音频 bus、进程所有权与关闭语义。

工程静态格式见 [`PNDS_SCORE_PROJECT_SPECIFICATION.md`](./PNDS_SCORE_PROJECT_SPECIFICATION.md)。App 产品行为与验收见 [`PNDS_APP_REQUIREMENTS.md`](./PNDS_APP_REQUIREMENTS.md)。

本文档是 evergreen runtime contract，不规定作品自己的 Socket.IO 或 OSC 业务协议。

---

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

---

## 2. 固定 Runtime

PNDS App 使用随包 ARM64 Node.js `24.18.1` 启动 score server。App 不调用系统 Node，也不执行 npm 安装。

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

工程应将 Node 24 作为当前官方 runtime 基线。`package.json#engines` 仅供开发工具提示，App 暂不解析。

---

## 3. App 注入的环境变量

所有模式：

```text
PNDS_HOST_IP=<selected LAN IPv4>
```

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

规则：

- Internal 的 target 始终由 App 动态分配；
- App 不得使用 `audio.standaloneTarget`；
- External target 是 App 本机、按工程保存的偏好，不写回 manifest；
- `PNDS_HOST_IP` 必须与 App 用于 monitor 的 LAN 地址一致；
- 工程可使用 `PNDS_HOST_IP` 生成 performer QR URL，不得从 monitor 请求的 host 推断。

---

## 4. HTTP 与网络

工程必须监听 manifest 声明的两个 TCP 端口：

```text
performerPort  → performer server
monitorPort    → monitor server
```

App 在启动前确认两个端口可用。冲突时失败，不自动换端口，也不修改 manifest。

LAN 地址规则：

- App 枚举可用的非 loopback IPv4；
- 多个地址时由用户显式选择；
- `127.0.0.1` 只用于 App 本机 health 与 scsynth OSC；
- 手机/平板与 monitor 使用所选 Host LAN IP。

---

## 5. Health Contract

### 5.1 Endpoint

工程必须在 **performer port** 提供：

```text
GET http://127.0.0.1:<performerPort>/__pnds/health
```

monitor port 可以提供同一 endpoint，但不是平台要求。App 只轮询 performer port。

### 5.2 Payload

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

---

## 6. 音频模式

| 模式       | scsynth  | OSC target    | App master stage |
| ---------- | -------- | ------------- | ---------------- |
| `internal` | App 启动 | 动态 loopback | 启用             |
| `external` | 不启动   | 用户指定      | 不启用           |
| `none`     | 不启动   | 不注入        | 不启用           |

模式、设备或 External target 的变更通过完整 session restart 生效，不做运行时热切换。

---

## 7. Internal 多通道音频

### 7.1 术语

```text
N = manifest.audio.outputChannels（1..=64，缺省 2）
H = 所选 CoreAudio 设备在工程 sampleRate 下可用的输出通道数
K = min(N, H)
B = private project bus start = K
```

App 无法可靠取得设备能力或设备没有可用输出时，Internal 启动失败并显示可诊断错误。

### 7.2 scsynth 参数

```text
-i 0                              不启用音频输入
-o K                              实际打开的硬件输出通道数
-S <audio.scsynth.sampleRate>
-z <audio.scsynth.blockSize>
-a <audio.scsynth.audioBusChannels>
-u <dynamic UDP port>
-B 127.0.0.1
-U <App bundled UGen plugins>
-H <selected device name>         非系统默认时
```

必须满足：

```text
audioBusChannels >= 2N
```

由于 `K <= N`，这保证 bus `B .. B+N-1` 始终可用。

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
- App 在 health ready 后才把 master group追加到 root group 尾部，因此工程后续在既有 group 内创建的 synth 仍先于 master stage 执行。

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

设备能力应以工程 sample rate 可用配置为准，而不是仅使用设备名称或系统默认声道数。

---

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

---

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

---

## 10. Monitor Runtime

App 使用：

```text
http://<PNDS_HOST_IP>:<monitorPort>/
```

monitor iframe 在 session 中保持同一文档实例。窗口 resize 和进入/退出全屏不得触发 Node restart，也不应触发 iframe reload。

工程 monitor 必须依据标准 viewport resize 更新布局与绘图表面。App 不读取、注入或调用跨 origin iframe DOM。

手动 Refresh 可以由用户显式重建 iframe；它是恢复工具，不是正常 resize 流程。

---

## 11. Shutdown Contract

工程必须响应 `SIGINT` 与 `SIGTERM`：

1. 停止接收新连接；
2. 关闭 performer/monitor HTTP 与 Socket.IO；
3. 释放工程 OSC socket；
4. 释放工程 synth、group、buffer；
5. 进程退出。

App 停止顺序：

```text
1. 向 Node 发送 SIGTERM 并等待 graceful shutdown
2. 超时则强制终止 Node
3. 释放 App master group
4. 请求/终止 App scsynth
5. 清理 child registry 与 session state
```

App 退出后不得遗留其拥有的 Node 或 scsynth。崩溃或 force quit 后，下一次 App 启动必须使用记录的 PID 和命令行确认归属，再进行 best-effort orphan cleanup。

任何启动或运行时失败在对外进入 `error` 前，必须先执行当前 generation 的失败清理：停止 Node、释放 master group、停止 scsynth并清空进程句柄。若强制终止无法确认，child registry 必须保留归属记录；从 `error` 直接 Retry 时，start flow 在端口 preflight 前对该 generation 执行定向 orphan cleanup。Retry 不调用面向正常 session 的公开 stop flow。

---

## 12. Runtime 合规验证

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
- 固定 Node `24.18.1` 下官方工程完整启动。
