# manifest.json

## App 共享包能力与 schemaVersion 2

App 支持 `schemaVersion` 1 和 2。自包含工程可使用 1，非空 `sharedLibraries` 要求 2。

`sharedLibraries` 是 `{ "id": "...", "version": "x.y.z" }` 数组。允许的 ID 为 `p5`、`ml5`、`express`、`qrcode`、`socket.io`、`socket.io-client`、`osc-min`。同一 ID 只声明一次。缺省或空数组表示无需共享资源，`null`、未知 ID 和版本范围会校验失败。

预检和启动检查 App 内确切版本的资源，缺失或不匹配时失败。生产依赖如何匹配引用见[工程结构](./structure.md#目录结构)，接线见[运行契约](./runtime-contract.md#3-app-注入的环境变量)。

## 示例

```json
{
  "schemaVersion": 1,
  "id": "my-score",
  "name": "My Score",
  "version": "0.1.0",
  "scoreServer": {
    "entry": "server.js",
    "workingDirectory": ".",
    "performerPort": 6868,
    "monitorPort": 6869
  },
  "audio": {
    "defaultMode": "none",
    "supportedModes": ["none"]
  }
}
```

## 必填字段

| 字段                                                   | 值                                 |
| ------------------------------------------------------ | ---------------------------------- |
| `schemaVersion`                                        | 整数 1 或 2。                      |
| `id`、`name`、`version`                                | 工程 ID、名称、版本，均为字符串。  |
| `scoreServer.entry`、`scoreServer.workingDirectory`    | 工程根目录内的入口文件和工作目录。 |
| `scoreServer.performerPort`、`scoreServer.monitorPort` | 两个不同的端口整数。               |
| `audio.defaultMode`、`audio.supportedModes`            | 默认模式和允许模式。               |

## 可选字段

| 字段                                                           | 含义                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `description`                                                  | 工程说明字符串。                                                      |
| `sharedLibraries`                                              | 确切共享包引用。                                                      |
| `telematic`                                                    | 工程支持跨互联网演奏。App 管理节点、hub、token 和房间。               |
| `scoreServer.supportsPerformerUrl`                             | 工程接受完整 `PNDS_PERFORMER_URL`，其资源及 Socket.IO 使用该 origin。 |
| `scoreServer.needsHttps`                                       | 普通浏览器使用需安全上下文的 API。                                    |
| `scoreServer.runtimePorts`、`scoreServer.browserParticipation` | 独立的监听器交接与浏览器接入能力。                                    |
| `audio.outputChannels`                                         | 声明离散输出信号数，整数 1–64，缺省为 2。                             |
| `audio.standaloneTarget`                                       | 工程脱离 App 调试时使用的目标字符串。                                 |

`telematic`、`supportsPerformerUrl` 和 `needsHttps` 仅在值为布尔 `true` 时启用。节点注入见[运行环境](./runtime-contract.md#3-app-注入的环境变量)，HTTPS 入口选择见[浏览器演奏接入](./browser-participation.md#完整-performer-url-与可信-https)。

`performerAddress` 可填裸主机名或 IPv4 地址，省略、`null` 或空白时使用所选 LAN IPv4。主机名以点分隔，各段只含 ASCII 字母、数字和连字符，段首尾不可为连字符。整名最多 253 字符，各段最多 63 字符，禁止协议、端口和路径。该值用于工程的 `PNDS_HOST_IP` 和 monitor 源地址。池主的稳定公开入口由 App 管理。见[演出组网](./network.md)。

## Internal 模式的条件必填字段

`audio.supportedModes` 包含 `internal` 时，`audio.synthdefs` 必须是非空路径数组，`audio.scsynth.blockSize` 和 `audio.scsynth.audioBusChannels` 必须是正整数。

`audio.scsynth.audioBusChannels` 至少为 `2 × audio.outputChannels`。块大小是 scsynth 合成块大小。运行采样率由 App 音频设置决定。见[多通道音频](./runtime-contract.md#7-internal-多通道音频)。

## 音频模式字段

`audio.supportedModes` 是非空数组，只包含 `internal`、`external` 或 `none`。其中必须包含 `audio.defaultMode`。见[音频模式](./audio-modes.md)。

## 端口

两个声明端口必须是 1–65535 的不同整数。固定端口发生冲突时启动失败。使用运行端口 v1 时，声明值作为首选端口。

### Runtime ports v1

`scoreServer.runtimePorts` 只接受整数 `1`，缺省使用固定端口。声明 v1 的工程接管 App 分配的两个监听器，发布绑定报告，并在 health 回显实际端口与运行身份。见[运行端口](./runtime-ports.md)。

## 路径与资产安全

`scoreServer.entry`、`scoreServer.workingDirectory` 和 `audio.synthdefs` 从工程根目录解析。路径须相对且不得含 `..`，解析符号链接后仍须在工程内。

预检核对入口文件、工作目录及 Internal 所需的 SynthDef 文件。打包检查每个声明的 SynthDef。缺失路径及类型错误会校验失败。

## 不属于 schema 的字段

包校验和、目标平台和运行资产清单属于 [.pnds 工程包](./pnds-bundle.md)。

## 浏览器演奏接入版本 1（#295）

`scoreServer.browserParticipation` 只接受整数 `1`。声明 v1 的工程使用确认 URL 前缀加载页面、资源与连接。缺省表示未声明该能力。见[浏览器演奏接入协议](./browser-participation.md#浏览器演奏接入协议-1)。
