# 任务指南

每一节解决一个具体任务,互相独立——从你需要的那节进来即可。字段含义查[参考](./reference.md),背景动机看[解析](./explanation.md)。

## 如何选择或更换工程端口

**适用:** 创建新工程时选端口,或工程与同机其他软件端口冲突。

1. **默认答案:沿用 6868(performer)/ 6869(monitor)。** 这是平台惯例——模板、官方工程(Inarticulate III)与两个内置工具全部使用这对端口,App 的端口管理面板在未选中工程时也以它为参考。App 启动前确认端口可用,**冲突即失败,不自动换端口**。
2. 只有当 6868/6869 被你确定要同时运行的其他软件占用时才换。改 `manifest.json` 的 `scoreServer.performerPort` / `monitorPort`(两端口必须不同),并避开:

| 避开范围               | 原因                                                        |
| ---------------------- | ----------------------------------------------------------- |
| 1–1023                 | 系统保留端口(well-known),macOS 系统服务使用且权限敏感       |
| 49152–65535            | macOS 临时(ephemeral)端口范围,任何出站连接都可能随机占用    |
| 5000、7000             | AirPlay 接收器(Mac 开启「隔空播放接收器」时监听)            |
| 3000、5173、8000、8080 | 常见开发服务器(Vite、React dev server、Flask、Django、代理) |
| 3306、5432、6379       | 常见数据库(MySQL、PostgreSQL、Redis)                        |

3. 拿不准端口是否空闲:打开 **设置 → 端口**,选中工程后 App 显示占用状态与占用者身份,并可一键释放。

**注意:** 使用相同端口对的两个工程不能在同一台机器上同时运行——切换作品时先关闭当前工程再打开下一个。

## 如何编译或重新编译 SynthDef

**适用:** 首次产出 `.scsyndef`,或修改 `supercollider/source/*.scd` 后重新编译。改完 `.scd` 必须重新编译,否则 App 加载的是旧声音。

**前提:** 创作机装有 SuperCollider(`internal` 模式工程);App 依次查 `/Applications/SuperCollider.app/Contents/MacOS/sclang` 与 `PATH`。

1. `.scd` 源码放 `supercollider/source/`,在文件里以 `.add` 注册 SynthDef;
2. **App → 设置(⌘,)→ 开发者工具 →「编译 SynthDef」**,默认作用于当前选中工程,可「浏览…」换任意文件夹;
3. 编译产物写入 `supercollider/synthdefs/`,App 随后逐个点名校验 manifest 引用。

**命名契约:SynthDef 符号名 = 产物文件名 = manifest 引用**,三处必须同名(带连字符的名字在 `.scd` 里写作 `'like-this'` 引号符号形式)。对不上时错误会点名缺失与实际产物,改三处中任意一处对齐即可。

**失败排查:**

| 现象                                    | 含义与处理                                                 |
| --------------------------------------- | ---------------------------------------------------------- |
| 提示安装 SuperCollider                  | 创作机没装,或 `sclang` 不在标准路径/PATH——装好或配置后重试 |
| `supercollider/source/` 缺失或无 `.scd` | 没有可编译的源码——确认源码目录与扩展名                     |
| 错误通知显示 sclang 输出原文            | 源码编译错误——按行号修 `.scd`;类库横幅已裁掉,直接读报错    |
| 契约报错(点名缺失产物)                  | 名字对不上——对齐 SynthDef 名 / 文件名 / manifest 引用      |
| sclang 超时被终止                       | SuperCollider 可能在弹窗等待——关掉对话框重试               |

External 模式的创作期 debug bridge(`.scd` 手动跑 `sclang`)不走此流程,见 Score Project Specification §7。

## 如何打包 `.pnds` 并分发

**适用:** 工程已开发完成、刚在 App 里完整跑通过一次,要交给演出方。

**打包(创作者侧):**

1. **设置(⌘,)→ 开发者工具 →「打包工程」**,确认目标工程(可「浏览…」);
2. App 先做硬校验:manifest 完整校验(含 synthdefs 产物逐个存在)、声明生产依赖时 `node_modules` 必须在场——任一不过即拒绝并给出可读错误;
3. 同名 `.pnds` 已存在时先弹确认框,同意后整体覆盖;
4. 成功后结果面板显示**产物路径与 sha256**,均可复制。

产物是工程同级目录下的 `<name>-<version>.pnds`(如 `My First Score-0.1.0.pnds`);`name` 中的 `/\:*?"<>|` 会被替换为 `-`。打包在临时 staging 目录组装:源工程零改动、不执行 npm、不联网。`.git*`、`.DS_Store` 与工程根目录的 `docs/`、`test/`、`tests/` 不进包。

**分发(交给接收方):**

1. 把 `.pnds` 连同 sha256 一起发(网盘、AirDrop、U 盘、邮件皆可);
2. 接收方(装有 PNDS App)**双击** `.pnds`、拖到 App 窗口/Dock 图标,或在 ⌘O 对话框选中——三种方式等价;
3. App 校验后解压安装到 `bundles/<id>-<version>/`,直接进入与目录工程相同的打开 → preflight → 运行流程;接收方不需要 Node.js、SuperCollider,也不需要网络;
4. 接收方想核对文件:`shasum -a 256 <文件>.pnds`,与创作者提供的值一致即传输无损(v1 的 App 打开端不强制校验,这是人工步骤)。

**发包前的检查清单:**

1. `manifest.json` 通过 App 完整校验(id / name / version 就位,端口、模式、bus 容量合法);
2. SynthDef 已重新编译,manifest 引用全部验证通过;
3. 工程刚在 App 里完整跑通过一次(health ready、performer 可演奏、monitor 正常、关闭干净);
4. `npm install` 已完成,`node_modules/` 完整在场(devDependencies 会随包,介意体积可 `npm prune --omit=dev`);
5. `version` 相对上一次分发的包已递增;
6. 打包成功,记下产物路径与 sha256。

## 如何发布修复版或新版本

**适用:** 已分发过一个 `.pnds`,现在内容变了(修 bug、加功能),要发新版。

1. **先升 `manifest.json` 的 `version`**,再打包。这不是习惯问题而是硬规则:接收方的安装槽位由 `<id>-<version>` 决定,同 `id`+`version` 重复打开**总是覆盖重装**(删旧目录再解压,最后打开的文件获胜)。不升版本号,接收方一旦重新打开手头的旧 `.pnds` 副本,覆盖写回的就是旧内容——你以为发出了修复,对方演出的仍是旧版;
2. 版本号建议语义化:修复递增 patch(`0.1.0 → 0.1.1`),新增能力递增 minor(`0.1.1 → 0.2.0`),破坏性变更递增 major;
3. 新版本是干净的新槽位、新文件名,新旧互不干扰。接收方列表里的旧版本条目不会自动消失,可手动移除(移除会顺带回收其解压目录,`bundles/` 之外的用户目录永远不受影响);
4. `id` 与 `version` 各自必须是单一路径段(不含 `/`、`\`、`..`)。

## 如何为演出机准备音频链路

**适用:** `internal` 模式工程,演出机经虚拟音频设备(如 BlackHole)进 DAW 再出声的链路。创作者把本节写进给操作员的 runbook 即可。

**采样率:整条链路同一个数。** App 托管的 scsynth 运行在 App 的全局采样率偏好(设置 → Audio,未设置时 48000)。虚拟音频设备只搬运原始采样、**不做重采样**——链路上任何一端(App 偏好、loopback 设备、DAW 工程、音频接口)与其他端不一致,不会报错,而是出现周期性咔哒声(实际发生过的现场故障)。开演前逐项核对一致。

**设备 buffer:不低于工程的 blockSize。** `manifest` 的 `scsynth.blockSize` 是传给 scsynth `-z` 的合成块大小,**不是**音频设备的 IO buffer——设备 buffer 由接收音频的 DAW 决定,App 不写这个值。给操作员的守则:

- 设备 buffer **不小于工程 `blockSize`**,且为整数倍——2 的幂档位(64/128/256/512…)对 blockSize 64 自然满足;稳妥默认 512,追求更低交接延迟可用 256;
- **红线:不要把设备 buffer 设到低于工程 `blockSize`**(部分 DAW 提供 32/16 档)——合成块被迫跨越多个硬件回调,延迟反而恶化;
- 先开 DAW、定好 buffer,再在 App 中 Load 工程;演出进行中不改 buffer(运行中变更会让链路短暂中断)。
