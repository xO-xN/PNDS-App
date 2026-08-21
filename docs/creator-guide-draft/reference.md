# 参考

创作者视角的速查资料:干燥、准确、可检索。规则以四份规范为唯一权威,本页只摘创作常碰到的部分——冲突时以规范为准:

- 目录工程格式(结构/manifest/资产/页面职责):[`PNDS_SCORE_PROJECT_SPECIFICATION.md`](../PNDS_SCORE_PROJECT_SPECIFICATION.md)
- 进程、环境变量、health、音频 bus、关闭协议:[`PNDS_RUNTIME_CONTRACT.md`](../PNDS_RUNTIME_CONTRACT.md)
- App 产品行为与验收:[`PNDS_APP_REQUIREMENTS.md`](../PNDS_APP_REQUIREMENTS.md)
- `.pnds` 格式、打包与安装规则:[`PNDS_PROJECT_BUNDLE_SPECIFICATION.md`](../PNDS_PROJECT_BUNDLE_SPECIFICATION.md)

## 创作环境要求

|               | 创作机(你的 Mac)                       | 演出机(接收方的 Mac)                   |
| ------------- | -------------------------------------- | -------------------------------------- |
| PNDS App      | 需要                                   | 需要                                   |
| Node.js       | 需要(开发与 `npm install`)             | 不需要(App 自带固定 Node)              |
| SuperCollider | Internal 模式:需要(仅编译 SynthDef 用) | Internal 模式:不需要(App 自带 scsynth) |
| npm / 网络    | 创作期可用                             | 运行与安装 .pnds 均不需要              |

开发基线是 Node 24(App 用随包 ARM64 Node.js 24 运行工程),官方工程在 `package.json` 声明:

```json
{ "engines": { "node": ">=24 <25" } }
```

工程在演出机上**不得依赖**宿主安装的 Node.js、SuperCollider、`sclang` 或第三方 UGen。`external`/`none` 模式的工程在创作机上也无需 SuperCollider。

## 工程目录结构

```text
project/
├── manifest.json              # 工程声明(字段见下)
├── package.json               # 声明生产依赖与 Node 版本
├── server.js                  # score server 入口(manifest 的 scoreServer.entry)
├── lib/                       # server 逻辑(模板自带可复用骨架)
├── audio/                     # fader → synth 参数映射等工作音频层
├── public/                    # performer / monitor 浏览器页面
├── supercollider/
│   ├── source/*.scd           # SynthDef 源码(创作期;唯一事实源)
│   └── synthdefs/*.scsyndef   # 编译产物(App 托管运行的运行时资产)
├── node_modules/              # 声明了生产依赖时必须存在
└── test/                      # 回归测试(不进入 .pnds)
```

最小要求:工程根目录必须有 `manifest.json` 与 `scoreServer.entry` 指向的入口文件。

## `manifest.json` 字段

示例(节选自 PNDS Template):

```json
{
  "schemaVersion": 1,
  "id": "pnds-template",
  "name": "Template",
  "version": "0.2.0",
  "scoreServer": {
    "entry": "server.js",
    "workingDirectory": ".",
    "performerPort": 6868,
    "monitorPort": 6869
  },
  "audio": {
    "defaultMode": "internal",
    "supportedModes": ["internal", "external", "none"],
    "outputChannels": 16,
    "synthdefs": ["supercollider/synthdefs/template-sine.scsyndef"],
    "scsynth": { "blockSize": 64, "audioBusChannels": 64 }
  }
}
```

必填字段与主要约束:

| 字段 / 约束                                                                         | 违反的后果                 |
| ----------------------------------------------------------------------------------- | -------------------------- |
| `schemaVersion`(当前为 `1`)                                                         | 其他校验前即失败           |
| `id`、`name`、`version`                                                             | 校验失败                   |
| `scoreServer.entry` / `workingDirectory` / `performerPort` / `monitorPort`          | 校验失败                   |
| `performerPort` 与 `monitorPort` 必须是不同的 `1..=65535` 整数                      | App 打开工程时直接校验失败 |
| `audio.defaultMode` 必须包含在 `audio.supportedModes` 里                            | 同上                       |
| `supportedModes` 只允许 `internal` / `external` / `none`                            | 同上                       |
| `internal` 模式必须声明 `synthdefs` 与 `scsynth` 的 `blockSize`、`audioBusChannels` | 同上                       |
| `audioBusChannels ≥ 2 × outputChannels`                                             | preflight 失败             |
| `entry` / `workingDirectory` / `synthdefs[*]` 必须是工程内相对路径                  | 拒绝绝对路径与 `../` 逃逸  |
| `outputChannels` 为 `1..=64` 整数(缺省 2)                                           | 校验失败                   |

`sampleRate` 已从 schema 移除:App 托管的 scsynth 一律运行在 App 的全局采样率设置(未设置时 48000),新工程不应声明该字段;旧 manifest 里残留的值被读取后忽略。工程脱离 App standalone 调试时自行决定 scsynth 采样率。详见 [`PNDS_RUNTIME_CONTRACT.md`](../PNDS_RUNTIME_CONTRACT.md) §7.2。

`id` 决定接收方安装目录 `bundles/<id>-<version>/`,全局唯一、永不复用;`name` 生成打包产物文件名(其中 `/\:*?"<>|` 替换为 `-`);`version` 每次内容变更必须递增(见[任务指南:发布新版本](./how-to.md#如何发布修复版或新版本))。

## SynthDef 命名契约

**SynthDef 符号名 = 产物文件名 = manifest 引用:**

```text
supercollider/source/voice.scd          SynthDef('my-voice', { ... }).add;
                     ↓ 编译(App:设置 → 开发者工具 →「编译 SynthDef」)
supercollider/synthdefs/my-voice.scsyndef
                     ↓ 引用
manifest.json         "synthdefs": ["supercollider/synthdefs/my-voice.scsyndef"]
```

- `.scd` 是创作期源码与唯一事实源;`.scsyndef` 是 App 托管运行时唯一加载的运行时资产;
- 带连字符的名字必须用引号符号写法 `SynthDef('my-voice', …)`;
- 编译入口:App → 设置(⌘,)→ 开发者工具 →「编译 SynthDef」,默认当前选中工程,可浏览;
- sclang 查找顺序:`/Applications/SuperCollider.app/Contents/MacOS/sclang` → `PATH`。

## 端口规则

推荐与避开的完整决策流程见[任务指南:选择或更换端口](./how-to.md#如何选择或更换工程端口)。速记:

- **默认 6868(performer)/ 6869(monitor)**——平台惯例;
- 避开:1–1023(系统保留)、49152–65535(macOS 临时端口)、5000/7000(AirPlay)、3000/5173/8000/8080(开发服务器)、3306/5432/6379(数据库);
- App 启动前确认端口可用,冲突即失败、不自动换端口;
- 查占用:**设置 → 端口**(显示占用者身份,可一键释放);
- 相同端口对的工程不能同机同时运行。

## 依赖与 node_modules

- App **从不执行 `npm install`**;演出机无网络安装步骤;
- `package.json` 声明非空 `dependencies` / `optionalDependencies` 时,工程必须携带可用的 `node_modules/`(创作机 `npm install` 后保持原样);
- 无生产依赖的工程不需要(也不要)空的 `node_modules/`;
- devDependencies 不影响打包校验,但会随包——发布前 `npm prune --omit=dev` 可显著减小 `.pnds` 体积;
- 打包前置校验含 node_modules 完整性:缺了无法打包(也无法打开)。

## 打包产物速记

- 产物:工程同级目录 `<name>-<version>.pnds`,同名先确认再覆盖;
- staging 隔离:源工程零改动,不执行 npm、不联网;
- 排除:`.git*`、`.DS_Store`(任意深度)、根目录 `docs/`、`test/`、`tests/`;
- 成功显示产物路径 + sha256(可复制);接收方以 `shasum -a 256` 人工核对,v1 打开端不强制;
- 安装:`bundles/<id>-<version>/`,同 id+version 总是覆盖重装。

格式细节(元数据、zip 布局、安全校验)见 [`PNDS_PROJECT_BUNDLE_SPECIFICATION.md`](../PNDS_PROJECT_BUNDLE_SPECIFICATION.md)。
