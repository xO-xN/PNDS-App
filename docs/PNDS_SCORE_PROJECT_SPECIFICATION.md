# PNDS Score Project Specification

本文档定义一个本地目录何时构成有效的 PNDS 数字乐谱工程。它是工程结构、`manifest.json`、静态运行资产与工程网页职责的唯一规范来源。

运行时进程、环境变量、health、音频 bus 与关闭协议见 [`PNDS_RUNTIME_CONTRACT.md`](./PNDS_RUNTIME_CONTRACT.md)。PNDS App 自身的产品与验收要求见 [`PNDS_APP_REQUIREMENTS.md`](./PNDS_APP_REQUIREMENTS.md)。

本文档是 evergreen specification，不绑定 App release 版本。版本阶段与实施顺序只记录在 [GitHub issues](https://github.com/xO-xN/PNDS-App/issues)（milestone 分组）。

---

## 1. 工程定义与边界

PNDS score project 是用户明确选择的一个本地目录。工程拥有并实现：

- 乐谱服务器入口；
- performer 页面与 monitor/conductor 页面；
- 工程自己的网络交互与 Socket.IO 协议（如使用）；
- 工程自己的 OSC 地址、参数与声音控制逻辑；
- Internal 模式需要的已编译 `.scsyndef`；
- 生产运行所需的本地依赖和静态资产。

工程不是 PNDS App 插件，也不获得 Tauri API。高频演奏消息必须在客户端、工程 Node 服务器和音频目标之间直接传递，不经过 PNDS App 的 Rust/React 层。

当前工程格式是**目录**。`.pnds` bundle、工程安装、更新与 checksum 见 [`PNDS_PROJECT_BUNDLE_SPECIFICATION.md`](./PNDS_PROJECT_BUNDLE_SPECIFICATION.md)。从模板创建工程到分发 `.pnds` 的完整创作流程见 [`PNDS_CREATOR_GUIDE.md`](./PNDS_CREATOR_GUIDE.md)。

---

## 2. 最小目录结构

工程根目录必须包含：

```text
project/
├── manifest.json
└── <scoreServer.entry>
```

根据工程实现，还可以包含：

```text
project/
├── package.json
├── node_modules/                 # 仅在存在生产依赖时需要
├── public/                       # performer / monitor 静态资源
├── audio/                        # 工程音频与 OSC 控制代码
└── supercollider/
    └── synthdefs/*.scsyndef      # Internal 模式的运行时 artifact
```

规则：

- App 不执行 `npm install`，运行时不得依赖网络安装；
- `package.json` 声明了非空 `dependencies` 或 `optionalDependencies` 时，工程必须携带可用的 `node_modules/`；
- 工程没有生产依赖时，不要求创建空 `node_modules/`；
- `.scd` 只属于创作与调试阶段，不能作为 App 托管运行时资产；
- 工程不得依赖宿主机器安装 Node.js、SuperCollider、`sclang` 或第三方 UGen。

官方工程应在 `package.json` 中声明其开发和验证过的 Node major，例如：

```json
{
  "engines": {
    "node": ">=24 <25"
  }
}
```

当前 App 不解释或强制执行 npm semver；兼容性最终由实际启动与 health 结果判定。

---

## 3. `manifest.json`

### 3.1 示例

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
      "sampleRate": 48000,
      "blockSize": 64,
      "audioBusChannels": 128
    },
    "standaloneTarget": "127.0.0.1:57110"
  }
}
```

### 3.2 必填字段

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

### 3.3 可选字段

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

### 3.4 Internal 模式的条件必填字段

当 `audio.supportedModes` 包含 `internal` 时：

```text
audio.synthdefs                       非空路径数组
audio.scsynth.sampleRate              正整数
audio.scsynth.blockSize               正整数
audio.scsynth.audioBusChannels        正整数
```

此外必须满足：

```text
audio.scsynth.audioBusChannels >= 2 × audio.outputChannels
```

该约束为硬件 bus 与工程私有 bus 提供足够空间。违反时 preflight 必须失败。

### 3.5 音频模式

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

工程自定义 OSC 地址不是 PNDS 平台协议。平台不得要求 `/p1`、`/p1xy` 等作品专属地址。

### 3.6 Score server 与端口角色

`performerPort` 与 `monitorPort`：

- 都必须是 `1..=65535` 的整数；
- 两者必须不同；
- 端口值由每个工程声明，不存在平台默认端口；
- 两个 HTTP server 都必须在 session 中运行。

角色由端口确定：

```text
http://<Host-LAN-IP>:<performerPort>/  → performer/client 页面
http://<Host-LAN-IP>:<monitorPort>/    → monitor/conductor 页面
```

工程可以不提供可演奏的 performer UI，但 performer server 仍必须提供 health endpoint，并可在 `/` 显示说明页面。`examples/Multichannel Signal Generator/` 使用这种模式。

### 3.7 不属于 schema 的字段

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

创作者、checksum、目标平台、runtime asset 列表与 bundle metadata 留给 Project Bundle 规范，不加入目录工程的 schema。

---

## 4. 路径与资产安全

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

---

## 5. 工程网页

### 5.1 Performer 页面

performer 页面由客户端通过 Host LAN IP 访问。工程负责移动端交互、身份、断线恢复和作品数据协议。

PNDS 不规定 Socket.IO event 名称、客户端 ID、角色数量或 UI 框架。

### 5.2 Monitor 页面

monitor 页面必须：

- 可通过 `http://<Host-LAN-IP>:<monitorPort>/` 加载；
- 允许嵌入 iframe，不发送阻止嵌入的 `X-Frame-Options` 或 CSP `frame-ancestors`；
- 不依赖 Tauri API 或 App DOM；
- 响应 viewport resize，不要求 App 重建 iframe；
- canvas/WebGL/p5 页面在尺寸变化时同步更新内部 drawing buffer 与坐标映射；
- 将持续的交互状态存为相对或归一化坐标，避免窗口尺寸变化后固化在旧像素坐标；
- 在窗口顶部中央为 App 的窗口标题/拖动覆盖区保留无关键交互区域。

进入或退出 macOS 全屏时，App 只改变窗口尺寸与装饰状态，不重启 Node、不重载 monitor iframe。工程必须依靠标准 resize 事件完成适配。

---

## 6. Internal 音频工程要求

Internal 工程必须：

- 只加载已编译 `.scsyndef`；
- 读取 `PNDS_OSC_TARGET` 并向 App 启动的 scsynth 发送标准 OSC；
- 读取 `PNDS_AUDIO_OUTPUT_BUS` 作为首个输出 bus；
- 读取 `PNDS_AUDIO_OUTPUT_CHANNELS` 作为离散工程输出数；
- 创建发声 synth 时将其 `out` control 指向 `PNDS_AUDIO_OUTPUT_BUS`；
- 连续写入声明的 N 路输出，不直接写硬件 bus `0`；
- 在 standalone 模式缺少 `PNDS_AUDIO_OUTPUT_BUS` 时可以回退到 `out = 0`；
- 在 performer health 报告 `ready` 前创建工程自有的 audio root group；
- 将全部发声 synth 和后续动态 group 放在这些预先创建 group 内，health ready 后不向 scsynth root group 直接追加音频节点；
- 不使用 PNDS App 保留的 node ID 范围 `2147480000..=2147483647`；
- 拥有并释放自身创建的 group、synth、buffer 与 OSC 资源。

PNDS 只保证离散信号输出，不负责声道到扬声器的空间布局。需要现场多声道 PA 时，应将 PNDS 输出路由到 Ableton Live、DAW、矩阵调音台或其他专用软件。

---

## 7. External Debug Bridge

工程可以提供创作期 `.scd` debug bridge，由创作者手动使用 `sclang` 运行并接收 external 模式的作品自定义 OSC。

该 bridge：

- 不由 PNDS App 启动、管理或打包；
- 不构成平台 OSC 标准；
- 不能替代正式 Internal runtime 的 `.scsyndef`；
- 可以包含作品专属 helper、OSCdef 和声音设计工具。

---

## 8. 工程合规清单

一个工程至少应通过：

1. manifest 必填、模式、端口、outputChannels 与 bus 容量校验；
2. 所有声明路径的 containment 与存在性校验；
3. 有生产依赖时携带完整 `node_modules`；
4. performer health 按 Runtime Contract 返回 ready；
5. monitor 可嵌入并正确响应 resize；
6. Internal 输出严格遵守 App 注入的 bus 与通道数；
7. SIGINT/SIGTERM 后释放工程拥有的全部资源；
8. 在 App 固定 Node runtime 下完成实际启动验证。
