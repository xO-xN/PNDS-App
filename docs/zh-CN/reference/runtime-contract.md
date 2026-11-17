# 运行契约

App 启动工程服务，按 health 判断就绪，并在结束时释放受管资源。工程定义自己的演奏数据与声音。

## 1. 参与者与所有权

**monitor** 是工程的监视／指挥页面。主窗口与投影加载各自的 monitor 实例。**performer** 是演奏者在设备或创作测试窗口中打开的页面。

App 托管 Node、Internal 模式的 scsynth、音频设备与 master stage。工程管理两个 HTTP 服务、作品通信、OSC socket 和自己的音频节点。各方释放自己的资源。运行与 App 升级保留工程源码与 manifest。

## 2. 固定 Runtime

App 使用随包 Node.js 24.18.1，在 `<project-root>/<scoreServer.workingDirectory>` 执行 `<bundled-node> <scoreServer.entry> --audio-mode <mode>`。`--audio-mode` 优先于 `manifest.audio.defaultMode`。工程自行备齐依赖，App 不执行 npm 安装，也不解析 `package.json#engines`。

## 3. App 注入的环境变量

| 变量                                                   | 注入条件与值                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `PNDS_HOST_IP`                                         | 所有模式。使用 manifest 的 `performerAddress`，缺省为所选 LAN IPv4。monitor 使用同一地址。                     |
| `PNDS_OSC_TARGET`                                      | Internal 为 App 动态分配的 `127.0.0.1:<port>`，External 为用户配置的 `host:port`，None 不注入。                |
| `PNDS_AUDIO_OUTPUT_BUS` / `PNDS_AUDIO_OUTPUT_CHANNELS` | 仅 Internal。首个私有 bus 与工程声明的通道数。                                                                 |
| `PNDS_SHARED_LIBRARIES`                                | 工程引用 App 共享包时注入确切版本的 JSON。                                                                     |
| `PNDS_RUNTIME_PORTS`                                   | 声明端口交接能力时注入[监听器分配](./runtime-ports.md)。                                                       |
| `PNDS_PERFORMER_URL`                                   | [可信 HTTPS 入口](./browser-participation.md#完整-performer-url-与可信-https)生效时注入完整 performer 根 URL。 |

共享包条目以包名为键，包含 `version`、`kind`（`browser` 或 `node`）、校验后的本机绝对 `path` 及可选 `browserPath`。Node 用绝对入口加载，ESM 可用 `pathToFileURL`。浏览器文件由工程提供同源 HTTP 路由。确切版本缺失或损坏时启动失败，无引用时清除继承变量。参见[共享包](./structure.md#app-共享包)。

`telematic: true` 且 App 节点名、hub URL、token 均已配置时，任一音频模式均注入 `PNDS_NODE_ID`、`PNDS_HUB_URL`、`PNDS_HUB_TOKEN`、`PNDS_HUB_ROOM`。四项同时存在或缺席。房间为 `{manifest.id}_{分组号}`，分组范围 1–3，缺省 1，按工程保存。节点与分组修改下次启动生效，token 单独注入并排除在日志外。参见 [hub 接线](../modules/hub.md)。

## 4. HTTP 与网络

工程分别提供 performer 与 monitor HTTP 服务。未声明 `scoreServer.runtimePorts: 1` 时使用 manifest 的固定 `performerPort` / `monitorPort`。第三方占用端口时启动失败。

### Runtime ports v1

见[运行端口交接](./runtime-ports.md#runtime-ports-v1)。

## 5. Health Contract

App 通过 `GET http://127.0.0.1:<performerPort>/__pnds/health` 检查实际 performer 端口。示例为固定端口的 Internal 工程。

```json
{
  "status": "ready",
  "projectId": "my-score",
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

- `status` 为 `starting | ready | error | stopping`，`audio.status` 为 `starting | ready | error | disabled`。None 用 `disabled` 与 `target: null`。两个 `error` 字段均为字符串或 `null`。
- `projectId`、`audioMode`、OSC target 与端口必须匹配本次运行。采用[端口交接](./runtime-ports.md)时，`scoreServer` 还须返回当次 `runtimeRunId`。
- App 等待 `status: "ready"`。启动期超时、非法 JSON、明确错误或进程提前退出都会使启动失败。响应上限 256 KiB，禁止重定向。
- 工程可提供[演奏端连接名册](./browser-participation.md#演奏端连接名册)。扩展字段不影响基础就绪判断。

### 运行期监督

就绪后 App 每 3 秒检查工程 health，Internal 每 5 秒检查 scsynth 的 OSC `/status`。同一运行的 health 返回错误状态、非空错误字段，或受管进程退出时，App 收尾并等待手动 Retry。任一探测连续失败 3 次显示告警，成功后清除该告警，工程继续运行。External 只检查工程 health。探测成功不代表扬声器有声。

## 6. 音频模式

| 模式       | scsynth  | OSC target    | App master stage |
| ---------- | -------- | ------------- | ---------------- |
| `internal` | App 启动 | 动态 loopback | 启用             |
| `external` | 用户提供 | 用户指定      | 禁用             |
| `none`     | 无       | 不注入        | 禁用             |

模式、External target、输出设备与采样率的变更在下一次启动应用。

## 7. Internal 多通道音频

工程写入私有 bus，App 将设备可用的前 K 路分别送至硬件 bus。

### 7.1 术语

`N` 为 `audio.outputChannels`（1–64，缺省 2）。`H` 为所选设备在有效采样率下可用的输出通道数。`K = min(N, H)`，首个私有 bus `B = K`。无可用输出或无法确定设备能力时，Internal 启动失败。

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

有效采样率由 App 设置，缺省 48000 Hz。旧 manifest 的 `audio.scsynth.sampleRate` 被忽略。`audio.scsynth.audioBusChannels` 至少为 `2N`。`-z` 设置 scsynth 合成块大小，设备 IO buffer 由 CoreAudio 设备或共用该设备的应用控制。设置入口见[音频与通信配置](../app-tutorial.md#3-音频与通信配置)。

### 7.3 Bus 模型

硬件 bus 为 `0 .. K-1`，工程私有 bus 为 `B .. B+N-1`。App 将私有 bus `B+i` 映射到硬件 bus `i`（`0 ≤ i < K`）。其余通道舍弃，输出保持离散。

### 7.4 App Master Stage

工程在 health 报告 ready 前创建至少一个自有 audio root group。全部工程发声 synth 和后续 group 置于这些 group 下。App 在 health ready 后将 master group 放在 root group 尾部，保证工程先写入、App 再读出。node ID `2147480000..=2147483647` 留给 App。

### 7.5 Master Gain

`N ≤ 2` 时，Internal 音量缺省 80%（约 −6 dB），100% 为 0 dB，0% 为静音。`N > 2` 时固定 100%，App 音量不可调。External 与 None 也禁用 App 音量。

### 7.6 通道不足设备

`H < N` 时仍可启动。App 显示 `Nch → Hch`，仅输出前 `H` 路，工程仍按 `N` 路写入。

### 7.7 Internal 工程义务

- 只加载已编译的 `.scsyndef`。编译见 [SynthDef 契约](./supercollider.md)。
- 向 `PNDS_OSC_TARGET` 发送标准 OSC，将 synth 的 `out` 设为 `PNDS_AUDIO_OUTPUT_BUS`，连续写入 `PNDS_AUDIO_OUTPUT_CHANNELS` 路。独立运行缺少 bus 变量时可用 `out = 0`。
- 按 §7.4 创建节点，关闭时释放自己创建的 group、synth、buffer 与 OSC socket。

## 8. Internal 启动顺序

App 校验工程与设备，启动 scsynth 并等待 `/status`，再启动 Node 并等待 performer health。health ready 后加载 monitor 并建立 master stage。master stage 创建成功后本次运行才进入 ready。失败时清理受管子进程。

## 9. External 与 None

External 启动需要有效的 `host:port`，取自 App 的工程偏好。独立运行的 `audio.standaloneTarget` 不参与 App 启动。None 仍运行工程和 monitor，health 返回 `audio.status: "disabled"`。

## 10. Monitor Runtime

monitor 源地址为 `http://<PNDS_HOST_IP>:<monitorPort>/`。macOS App 托管[原生页面](./native-media.md)，iframe 预览须允许嵌入。工程页面使用标准浏览器 API。

窗口大小与全屏变化保留当前文档和连接。页面按标准 resize 事件调整布局、绘图缓冲区与坐标映射。显式 Refresh 重建文档并附加 `?_r=<n>`，工程须忽略未知查询参数。资源缓存仍取决于工程的 HTTP 响应。

键盘、右键和触摸规则见[页面交互](./page-interaction.md)。

## 11. 主题与语言推送（Theme / Locale Bridge）

主题与语言跟随均可选。初始 URL 参数按导航确定，后续更新经 `postMessage` 发送，页面按最新值幂等应用并允许参数缺席。主 monitor、投影和创作 performer 测试页接收推送，普通设备浏览器使用工程自身设置。

### 主题推送

初值可从 `?theme=<name>` 读取。`palette` 提供 App 的语义色值。

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

接线见[主题跟随](../modules/theme-follow.md)。

### 语言推送

初值可从 `?lang=<code>` 读取。`locale` 是解析后的语言代码，目前为 `en` 或 `zh-CN`。

```json
{
  "type": "pnds:locale",
  "version": 1,
  "locale": "zh-CN"
}
```

接线见[语言跟随](../modules/locale-follow.md)。

## 12. Shutdown Contract

工程收到 `SIGINT` 或 `SIGTERM` 时停止接收连接，关闭 HTTP、Socket.IO 和 OSC socket，释放自己的 synth、group、buffer 后退出。

App 撤销当前演出转发，通知 Node 退出，超时强制终止，随后释放 master group 并停止受管 scsynth。启动或运行失败同样清理本次资源。无法确认终止时保留归属记录，下次启动前只清理归属已核实的遗留进程。

## 13. Runtime 合规验证

使用随包 Node 验证所声明模式的启动与 health。Internal 核对私有 bus 与输出通道。检查窗口缩放时保留页面与连接，停止后工程资源已释放。

## 14. 投影面协议（?surface=venue 与缩放归属握手）

协议仅用于投影中的 monitor 副本。主窗口缩放由 App 管理。接线见[投影面](../modules/projection-surface.md)。

### 面参数（?surface=venue）

投影加载或刷新 monitor 时附带 `?surface=venue`。工程可据此选择场地画面。参数缺席或值未知时使用普通 monitor 画面。

### 缩放归属握手（{type:"pnds-projection", zoom:"page"}）

```js
window.parent.postMessage({ type: 'pnds-projection', zoom: 'page' }, '*')
```

App 仅接受当前投影页面的匹配声明。声明后，该次导航的 App 缩放回到 100%，缩放键由页面处理。下一次导航恢复 App 缩放，页面可重新声明。

## 15. 完整 performer URL 与外部入口（#138 冻结契约）

见[完整 performer URL](./browser-participation.md#完整-performer-url-与可信-https)。

### 变量与能力声明

见[完整 performer URL](./browser-participation.md#完整-performer-url-与可信-https)。

### 工程身份与入口接入上下文

见[完整 performer URL](./browser-participation.md#完整-performer-url-与可信-https)。

### claim token 与 origin

见[完整 performer URL](./browser-participation.md#完整-performer-url-与可信-https)。

### 故障、重试与隔离（#141 冻结）

见[完整 performer URL](./browser-participation.md#完整-performer-url-与可信-https)。

## 16. 演出 DNS 与后台守护进程（#174）

见[演出 DNS](./dns.md)。

### 映射生命周期

见[演出 DNS](./dns.md)。

### 网络边界与承诺范围

见[演出 DNS](./dns.md)。

## 可选临时参数预演（协议 1）

见[临时参数预演](./parameter-preview.md)。

## Optional connected performer roster

见[演奏端连接名册](./browser-participation.md#演奏端连接名册)。

### App 内置演奏端二维码

见[演奏端连接名册](./browser-participation.md#演奏端连接名册)。

## 可选演奏记录适配（协议 1）

见[演奏记录与回放](./performance-recording.md)。

## 浏览器演奏接入协议 1（#295）

见[浏览器参与协议](./browser-participation.md#浏览器演奏接入协议-1)。

## 原生 Host monitor 与创作 performer 媒体

见[原生页面与媒体](./native-media.md)。
