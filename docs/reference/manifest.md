# manifest.json

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
audio.outputChannels
audio.standaloneTarget
```

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
