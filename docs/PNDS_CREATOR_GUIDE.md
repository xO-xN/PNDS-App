# PNDS Creator Guide

本文档面向 PNDS 数字乐谱的**创作者**:如何从模板创建一个工程,在 App 里编译 SynthDef、试运行,最终打包成单一 `.pnds` 文件分发给演出方。按本文走完,接收方在另一台机器上双击即可安装并演出。

延伸文档索引：

- 工程目录结构与 `manifest.json`:[`PNDS_SCORE_PROJECT_SPECIFICATION.md`](./PNDS_SCORE_PROJECT_SPECIFICATION.md)
- 进程、环境变量、health、音频 bus、关闭协议:[`PNDS_RUNTIME_CONTRACT.md`](./PNDS_RUNTIME_CONTRACT.md)
- App 产品行为与验收:[`PNDS_APP_REQUIREMENTS.md`](./PNDS_APP_REQUIREMENTS.md)
- `.pnds` 文件格式、打包规则与安装规则:[`PNDS_PROJECT_BUNDLE_SPECIFICATION.md`](./PNDS_PROJECT_BUNDLE_SPECIFICATION.md)

---

## 1. 全流程总览

```text
① 创建    从 PNDS Template 复制出新工程,改 id / name / version / 端口 / 音频配置
② 开发    写 score server 与页面;SynthDef 源码放 supercollider/source/*.scd
③ 编译    设置 → 开发者工具 →「编译 SynthDef」(创作机需装 SuperCollider)
④ 试运行  在 App 中打开工程,确认 preflight 通过、页面与声音正常
⑤ 打包    设置 → 开发者工具 →「打包工程」,产出 <name>-<version>.pnds + sha256
⑥ 分发    把 .pnds 发给接收方(附上 sha256);对方双击 / 拖入 / ⌘O 即安装并打开
```

创作机与演出机的分工:

|               | 创作机(你的 Mac)           | 演出机(接收方的 Mac)      |
| ------------- | -------------------------- | ------------------------- |
| PNDS App      | 需要                       | 需要                      |
| Node.js       | 需要(开发与 `npm install`) | 不需要(App 自带固定 Node) |
| SuperCollider | 需要(仅编译 SynthDef 用)   | 不需要(App 自带 scsynth)  |
| npm / 网络    | 创作期可用                 | 运行与安装 .pnds 均不需要 |

工程在演出机上**不得依赖**宿主安装的 Node.js、SuperCollider、`sclang` 或第三方 UGen——这是 Score Project Specification 的硬性要求。

## 2. 准备创作环境

1. **PNDS App**(macOS,Apple Silicon):开发与打包都在 App 内完成。
2. **Node.js 24**:App 用随包的 ARM64 Node.js 24 运行工程,开发期请以 Node 24 为基线,并在 `package.json` 中声明:

   ```json
   { "engines": { "node": ">=24 <25" } }
   ```

3. **SuperCollider**(标准安装到 `/Applications/SuperCollider.app`):只在第 ③ 步编译 SynthDef 时用到其命令行 `sclang`。App 先查标准安装路径,再回退到 `PATH` 里的 `sclang`。没装时会给出安装引导(https://supercollider.github.io/downloads)。

## 3. 从 PNDS Template 创建工程

模板仓库:https://github.com/xO-xN/PNDS-Template ——一个可直接运行的最小工程(双推子 performer、16 声道 sine、monitor、断线重连),复制它作为新工程的起点:

```sh
git clone https://github.com/xO-xN/PNDS-Template.git <你的工程目录>
cd <你的工程目录>
npm install          # 创作机一次性装好生产依赖
```

一个典型工程的目录:

```text
project/
├── manifest.json              # 工程声明(见 §4)
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

三件事必须立刻改掉,且全程保持唯一:

- **`id`**:工程的全局标识(如 `inarticulate-iii`)。它决定接收方机器上的安装目录,永远不要与别的工程重复,也不要中途更换。
- **`name`**:显示名(如 `Inarticulate III`)。打包产物文件名由它生成。
- **`version`**:版本号。每次内容变更必须递增,原因见 §8。

目录结构、必填字段、路径 containment 的完整规则以 [`PNDS_SCORE_PROJECT_SPECIFICATION.md`](./PNDS_SCORE_PROJECT_SPECIFICATION.md) 为准;下文只列创作时最常碰到的要点。

## 4. manifest 要求速览

`manifest.json` 示例(节选自模板):

```json
{
  "schemaVersion": 1,
  "id": "pnds-template",
  "name": "Template",
  "version": "0.1.1",
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
    "scsynth": { "sampleRate": 48000, "blockSize": 64, "audioBusChannels": 64 }
  }
}
```

创作时最常踩的规则:

| 规则                                                               | 违反的后果                     |
| ------------------------------------------------------------------ | ------------------------------ |
| `performerPort` 与 `monitorPort` 必须是不同端口                    | App 打开工程时直接校验失败     |
| `audio.defaultMode` 必须包含在 `audio.supportedModes` 里           | 同上                           |
| `internal` 模式必须声明 `synthdefs` 与 `scsynth` 三参数            | 同上                           |
| `audioBusChannels ≥ 2 × outputChannels`                            | preflight 失败                 |
| `entry` / `workingDirectory` / `synthdefs[*]` 必须是工程内相对路径 | 拒绝绝对路径与 `../` 逃逸      |
| 声明了非空生产依赖就必须携带 `node_modules/`                       | 无法打开,也无法打包(见 §5、§6) |

端口选择:两个端口由工程自己声明,没有平台默认值。App 启动前确认端口可用,**冲突即失败,不自动换端口**——建议给自己的工程选一对不易与其他 PNDS 工程撞车的端口(模板默认的 6868/6869 被很多工程沿用)。

## 5. 依赖与 node_modules

- App **从不执行 `npm install`**,演出机上也没有网络安装这一步;
- 因此 `package.json` 声明了非空 `dependencies` / `optionalDependencies` 的工程,必须把**可用的 `node_modules/` 一起打包带走**——在创作机上 `npm install` 完成后保持原样即可;
- 没有生产依赖的工程不需要(也不要)空的 `node_modules/`;
- devDependencies 不影响打包校验,但会随 `node_modules` 原样进包——发布前 `npm prune --omit=dev` 清理可显著减小 `.pnds` 体积(下次开发时重新 `npm install` 即可)。

## 6. SynthDef 编译契约

**契约:SynthDef 符号名 = 产物文件名 = manifest 引用。** 三处必须写同一个名字:

```text
supercollider/source/voice.scd          SynthDef('my-voice', { ... }).add;
                     ↓ 编译
supercollider/synthdefs/my-voice.scsyndef
                     ↓ 引用
manifest.json         "synthdefs": ["supercollider/synthdefs/my-voice.scsyndef"]
```

- `.scd` 源码放 `supercollider/source/`,是**唯一事实源**——不要手改 `.scsyndef`,不要在工程里保留旧的构建脚本;
- 带连字符的名字必须用引号符号写法 `SynthDef('my-voice', …)`(裸标识符不允许连字符);
- 编译入口在 **App → 设置(⌘,)→ 开发者工具 →「编译 SynthDef」**,默认作用于当前选中工程,也可「浏览…」选择任意文件夹;
- 编译完成后 App 逐个点名校验 manifest 引用的产物:缺哪个、这次实际产出了哪些,都会精确列出;
- 常见失败形态:
  - **未装 SuperCollider** → 提示安装地址,或把 `sclang` 放进 `PATH`;
  - **`supercollider/source/` 缺失或没有 `.scd`** → 明确报错,没有东西可编译;
  - **源码编译错误** → 错误通知显示 sclang 输出原文(类库横幅已裁掉),据此定位是代码问题还是环境问题;
  - **名字对不上** → 契约报错,点名缺失的产物与实际产物,改三处中的任意一处对齐即可。
- External 模式的创作期 debug bridge(`.scd` 手动跑 `sclang`)不受影响,见 Score Project Specification §7;它不进 App 编译流程,也不能替代 internal 运行时的 `.scsyndef`。

`.scd` 与 `.scsyndef` 的角色划分:`.scd` 只属于创作与调试;App 托管运行时只加载已编译的 `.scsyndef`。

## 7. 在 App 中试运行

打包前**必须**完成一次真实运行:App 的打包校验是静态的(结构、产物、依赖齐全),它证明不了工程行为正确。

1. 在 App 中打开工程目录(⌘O、侧栏 + 或把目录拖进窗口);
2. 确认 preflight 通过、session 启动、health 变为 ready(行为契约见 [`PNDS_RUNTIME_CONTRACT.md`](./PNDS_RUNTIME_CONTRACT.md));
3. 用手机连同一局域网扫码进入 performer 页面,确认交互与声音正常;确认 monitor 页面在 App 窗口内正确嵌入、随窗口缩放;
4. 走一遍关闭:确认工程在 SIGINT/SIGTERM 后释放自己创建的资源。

任一步失败,先修工程再回来打包。

## 8. 打包、分发与版本号

### 8.1 打包

入口:**设置(⌘,)→ 开发者工具 →「打包工程」**。默认打包当前选中工程,可「浏览…」换任意文件夹。

打包行为(Bundle Specification §3 的完整规则):

- 在系统临时目录的 staging 中组装,**源工程目录零改动**,全程不执行任何 npm 命令、不联网;
- 打包前硬校验:manifest 完整校验(含 synthdefs 产物逐个存在)、声明生产依赖时 `node_modules` 必须在场——任一不过即拒绝并给出可读错误;
- 排除清单:`.git*`、`.DS_Store`(任意深度)与工程根目录下的 `docs/`、`test/`、`tests/` 不进入包;其余原样复制;
- 产物:工程同级目录下的 **`<name>-<version>.pnds`**(如 `Template-0.1.1.pnds`);`name` 中的 `/\:*?"<>|` 会被替换为 `-`;
- 同名文件已存在时先弹确认框,同意后整体覆盖重写;
- 成功后结果面板显示**产物路径与 sha256**,均可一键复制。

### 8.2 分发

把 `.pnds` 文件发给接收方(网盘、AirDrop、U 盘、邮件皆可),并**连同 sha256 一起发**。

接收方(需要已安装 PNDS App):

- **双击** `.pnds`(App 已关联该扩展名)、把文件**拖到 App 窗口或 Dock 图标**、或在 **⌘O** 对话框选中——三种方式等价;
- App 校验 bundle 元数据与结构后,解压安装到 App 数据目录 `bundles/<id>-<version>/`,随即进入与目录工程完全相同的打开 → preflight → 运行流程;
- 接收方**不需要** Node.js、SuperCollider,也不需要网络。

sha256 的用途:确认“发出去的”和“收到的”是同一个文件。接收方在终端执行:

```sh
shasum -a 256 Template-0.1.1.pnds
```

与创作者提供的值一致,即传输无损、且是预期的那次构建。v1 的 App 打开端不强制校验 sha256,这是人工核对步骤。

### 8.3 版本号语义:内容变更必须升 version

接收方的安装槽位由 **`<id>-<version>`** 决定,且同 `id`+`version` 重复打开**总是覆盖重装**(删旧目录再解压,最后打开的文件获胜)。

因此,**任何内容变更都必须递增 `manifest.json` 的 `version`**。不升版本号的后果:

- 新旧两次构建共用同一个文件名 `<name>-<version>.pnds` 和同一个安装槽位,接收方在 App 里**无法分辨**装的是新内容还是旧内容;
- 接收方一旦重新打开手头的旧 `.pnds` 副本(下载文件夹、邮件附件里很常见),覆盖重装写回的就是**旧内容**——你以为发出了修复,对方演出的仍是旧版;
- 两次构建的 sha256 不同,但 App 不校验它,救不回来。

升了版本号则是干净的新槽位、新文件名,新旧互不干扰。注意两点:

- 新版本安装后,接收方列表里的旧版本条目不会自动消失,可手动移除(移除会顺带回收其解压目录,`bundles/` 之外的用户目录永远不受影响);
- `id` 与 `version` 各自必须是单一路径段(不含 `/`、`\`、`..`),建议 `id` 用小写连字符串、`version` 用 `0.1.2` 这类语义化版本:修复递增 patch,新增能力递增 minor,破坏性变更递增 major。

## 9. 发布前检查清单

1. `manifest.json` 通过 App 完整校验(id / name / version 就位,端口、模式、bus 容量合法);
2. SynthDef 已用开发者工具重新编译,manifest 引用全部验证通过;
3. 工程刚在 App 里完整跑通过一次(health ready、performer 可演奏、monitor 正常、关闭干净);
4. `npm install` 已完成,`node_modules/` 完整在场;
5. `version` 相对上一次分发的包已递增;
6. 打包成功,记下产物路径与 sha256,连同文件一起分发。

---

平台自己的两个内置工具(Local Network Diagnostics、Multichannel Signal Generator)发布的 release 同样是 `.pnds`——你分发工程所用的格式,与平台自身工具的发布格式一致。它们随 App 以解包后的文件夹形态直接运行(见 Project Bundle Specification §5),因此打开 Utilities 里的工具走的是普通工程流程;要体验接收方安装 `.pnds` 的流程,把你打包的 `.pnds` 在另一台机器上双击打开即可。
