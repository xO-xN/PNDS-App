# manifest.json

## App 共享包能力与 schemaVersion 2

自包含工程继续使用 `schemaVersion: 1`。使用 App 共享包的工程必须声明
`schemaVersion: 2`，让不支持共享能力的旧 App 明确拒绝。当前 App 同时支持 1 和 2；
其余运行、音频和路径字段保持原语义。

```json
{
  "schemaVersion": 2,
  "version": "0.2.0",
  "sharedLibraries": [{ "id": "p5", "version": "2.3.4" }]
}
```

这是字段片段，仍需包含其余必填字段。`sharedLibraries` 为确切引用数组；允许的标识只有
`p5`、`ml5`、`express`、`qrcode`、`socket.io`、`socket.io-client`、`osc-min`。
版本必须是确切 `x.y.z`，同一标识不能重复；范围、未知标识、缺版本与 `null` 均拒绝。
缺省或空数组不要求共享资源；非空数组必须用 schema 2。

在创作模式「模块」栏的「加入共享包」选择本 App 提供的候选版本并填写新的工程版本。
App 在一次原子 manifest 保存中更新引用、工程版本和 schema；manifest 草稿、只读来源、
身份变化、路径越界或磁盘版本冲突均阻止采用，失败保留原文件。加入不会复制库、接线源码、
下载资源或启动工程。App 升级和临时试验不会自动采用其它版本。

打开预检与每次启动均按确切版本检查本机资源内容；缺失、损坏或不匹配明确失败，绝不换版。
模型、谱面和音频仍由工程携带。同源接线见 [p5js.md](./p5js.md)，运行注入见
[runtime-contract.md](./runtime-contract.md) §3。示例的 2.3.4 是本版验证候选，作品验收后才冻结。

## 示例

```json
{
  "schemaVersion": 1,
  "id": "inarticulate-iii",
  "name": "Inarticulate III",
  "version": "1.0.1",
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
    "outputChannels": 2,
    "synthdefs": ["supercollider/synthdefs/inarticulate-iii.scsyndef"],
    "scsynth": {
      "blockSize": 64,
      "audioBusChannels": 128
    },
    "standaloneTarget": "127.0.0.1:57110"
  }
}
```

## 必填字段

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

## 可选字段

```text
description
sharedLibraries
telematic
performerAddress
scoreServer.supportsPerformerUrl
scoreServer.needsHttps
audio.outputChannels
audio.standaloneTarget
```

`telematic`：

- 布尔值，声明作品具有跨互联网（telematic）演奏能力；
- 缺省、`null`、`false` 与非布尔值一律视为**未声明**，不报错（preflight 容错）——只有显式 `"telematic": true` 才算声明；
- 只决定两件事：App 是否在启动时注入节点环境变量（见 [runtime-contract.md](./runtime-contract.md) §3），以及「设置节点」强制门是否适用于本工程；
- **不承载任何 hub 配置**：节点名、hub 地址、token 与房间全部由 App 一侧决定（ADR-0004），manifest 永远拿不到它们。

`performerAddress`：

- 字符串，演奏者连接地址（如 `mywork.local`）；存在且非空白时，App 注入给工程的连接地址（`PNDS_HOST_IP`）被替换为该字符串——二维码与 monitor 显示它而不是数字 IP（[network.md](./network.md)「自定义连接地址」）；
- 值是裸主机名：点分标签只允许字母、数字与连字符（IPv4 字面量同样合法），**不带**协议、端口或路径——`http://mywork.local`、`mywork.local:6868` 会被 preflight 以可读错误拒绝；
- 缺省、`null` 与空白字符串视为未声明，回落数字 IP 注入（现行为），不报错；
- 只是声明，不携带任何配置：工程零改动（仍读它今天读的那个变量），App 用于 monitor 的地址与注入值保持一致（[runtime-contract.md](./runtime-contract.md) §3/§10）。

`scoreServer.supportsPerformerUrl`：

- 布尔值，声明工程适配 Host 提供的**完整 performer URL**（`PNDS_PERFORMER_URL`，[runtime-contract.md](./runtime-contract.md) §3/§15）：二维码、复制地址与浏览器连接配置使用同一完整 URL，页面脚本与 Socket.IO 在该 origin 下同源加载与连接，monitor 保持内部连接；
- 缺省、`null`、`false` 与非布尔值一律视为**未声明**，不报错（preflight 容错，同 `telematic`）——只有显式 `"supportsPerformerUrl": true` 才算声明；
- 只声明读取完整 URL 的能力，**不请求启用 HTTPS**。普通工程即使声明该能力、全局 HTTPS 开关已开，也默认使用 HTTP；证书、域名与入口生命周期全部由 App 一侧拥有，manifest 永远拿不到它们；
- 未声明的工程不注入 `PNDS_PERFORMER_URL`，工程按原有 HTTP 方式运行；是否需要显式兼容确认由下述 `needsHttps` 规则决定。

`scoreServer.needsHttps`：

- 布尔值，声明作品实际使用**需要可信安全上下文的浏览器功能**，如运动传感器、摄像头或麦克风。只有显式 `"needsHttps": true` 算声明需要；缺省、`null`、`false` 与非布尔值均视为不需要，不报错。手机参与、扫码或普通触摸本身不构成 HTTPS 需求；
- **参与实际入口选择**：只有 `needsHttps: true`、`supportsPerformerUrl: true`、全局 HTTPS 开关打开且域名、端口和证书材料有效时，App 才启用 HTTPS；未声明需要的工程始终沿用 HTTP，HTTPS 配置缺失或无效不影响其启动；
- 开关关闭时沿用 HTTP。声明需要但未声明适配、且开关打开时，设置卡显示「未适配」，启动需操作者显式选择「使用 HTTP 启动」；取消不启动。声明需要且已适配、开关打开但配置无效时，启动明确失败，不静默回退；
- 创作 agent 应先检查作品实际调用的浏览器 API，再决定是否声明需要；把判断依据和 HTTP／HTTPS 验证结果写入作品交接。完整入口与地址优先级见 [runtime-contract.md](./runtime-contract.md) §3/§15。

`audio.outputChannels`：

- 必须是 `1..=64` 的整数；
- 缺省值为 `2`；
- 表示工程产生的离散输出信号数量；
- 不表示扬声器布局、声道标签、空间位置或现场 PA 配置；
- 允许单声道、立体声及多通道工程；
- 仍属于 `schemaVersion: 1` 的向后兼容扩展。

`audio.standaloneTarget` 只供脱离 App 的手动调试。App 不得读取或使用它。

## Internal 模式的条件必填字段

当 `audio.supportedModes` 包含 `internal` 时：

```text
audio.synthdefs                       非空路径数组
audio.scsynth.blockSize               正整数
audio.scsynth.audioBusChannels        正整数
```

`audio.scsynth.sampleRate` **已从 schema 的活跃表面移除**：internal 模式不再要求它，新工程不应再声明它。App 托管的 scsynth 一律运行在 App 的全局采样率设置（未设置时 48000，见 [runtime-contract.md](./runtime-contract.md) §7.2）。旧 manifest 中残留的该字段被读取后忽略——永不参与启动，永不被改写，也永不导致校验失败。工程脱离 App standalone 调试时自行决定 scsynth 采样率。

此外必须满足：

```text
audio.scsynth.audioBusChannels >= 2 × audio.outputChannels
```

该约束为硬件 bus 与工程私有 bus 提供足够空间。违反时 preflight 必须失败。

`audio.scsynth.blockSize` 只声明 scsynth 的合成块大小（App 以 `-z` 传入，见 [runtime-contract.md](./runtime-contract.md) §7.2），不等于音频设备的 IO buffer，也不构成延迟承诺。

## 音频模式字段

有效模式只有：

```text
internal | external | none
```

规则：

- `audio.supportedModes` 必须是非空数组且不能包含未知值；
- `audio.defaultMode` 必须包含在 `audio.supportedModes` 中；
- `internal` 使用 App 托管的 scsynth；
- `external` 向用户指定的 OSC target 发送工程自定义协议；
- `none` 不建立音频或 OSC 输出。

## 端口

`performerPort` 与 `monitorPort`：

- 都必须是 `1..=65535` 的整数；
- 两者必须不同；
- 端口值由每个工程声明，不存在平台默认端口；
- 两个 HTTP server 都必须在 session 中运行。

平台惯例是 `6868`（performer）/ `6869`（monitor）——模板、官方工程与内置工具均使用这对端口。没有特殊理由直接沿用；App 启动前确认端口可用，**冲突即失败，不自动换端口**。使用相同端口对的两个工程不能在同一台机器上同时运行——切换作品时，先关闭当前工程再打开下一个。

需要换端口时，避开：

| 避开范围               | 原因                                                          |
| ---------------------- | ------------------------------------------------------------- |
| 1–1023                 | 系统保留端口（well-known），macOS 系统服务使用且权限敏感      |
| 49152–65535            | macOS 临时（ephemeral）端口范围，任何出站连接都可能随机占用   |
| 5000、7000             | AirPlay 接收器（Mac 开启「隔空播放接收器」时监听）            |
| 3000、5173、8000、8080 | 常见开发服务器（Vite、React dev server、Flask、Django、代理） |
| 3306、5432、6379       | 常见数据库（MySQL、PostgreSQL、Redis）                        |

拿不准端口是否空闲时，打开**设置 → 端口**：选中工程后，App 显示 manifest 声明的两个端口的占用状态与占用者身份，并可一键释放。

## 路径与资产安全

下列字段必须是工程根目录内的相对路径：

```text
scoreServer.entry
scoreServer.workingDirectory
audio.synthdefs[*]
```

App 必须：

- 拒绝绝对路径；
- 拒绝 `../` 路径逃逸；
- 解析 symlink 后确认真实路径仍位于工程根目录；
- 校验 entry 是文件、working directory 是目录、SynthDef 是文件；
- 在文件缺失时返回包含字段和路径的可读错误；
- 对不支持的 `schemaVersion` 在其他校验前失败。

## 不属于 schema 的字段

以下字段不得被 App 要求或解释：

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

创作者、checksum、目标平台、runtime asset 列表与 bundle metadata 属于 `.pnds` 工程包，不加入目录工程的 schema。
