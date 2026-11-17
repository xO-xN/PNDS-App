# Sensor Meter 手势执行边界

Sensor Meter 是独立工具工程。当前修复源码位于父目录的
`PNDS-1.6.2-projects/Mobile-Sensor-Meter`，对应仓库
`xO-xN/Mobile-Sensor-Meter`；父目录另一份 `Mobile-Sensor-Meter`
是旧版，不能混作本次修改来源。运行规则及工具测试归该工程的
`AGENTS.md` 和 `docs/shared-libraries.md`，App 只负责运行与分发。

## 线程与加载状态

ml5 脚本执行、TensorFlow.js 后端初始化、模型加载、首次及后续推理都应在独立
Worker 内完成。页面保留摄像头预览与画面传递，倾斜、运动、麦克风保持各自采集
和 Socket.IO 发送。不能把 Promise 或 `async/await` 当作线程隔离；不能在
Worker 不可用时回退到页面主线程运行模型。

手势卡按真实阶段显示请求摄像头、加载识别引擎、加载模型、等待摄像头画面、准备首次识别。
首次推理完成后才算识别就绪；零手也是有效结果。停止必须立即终止 Worker、
释放摄像头并撤销待完成请求，迟到结果不改变状态。后台释放摄像头并暂停推理，
保留已经就绪的模型供前台恢复。功能不支持或加载失败只影响手势卡。
推理结果必须按提交帧的尺寸副本归一化，不能读取完成时的视频尺寸；后台前提交的帧
在恢复后仍属迟到结果，不能更新样本或就绪状态。

Safari 17 / iOS 17 起有 Worker 内 OffscreenCanvas WebGL 的平台支持，见
[WebKit 官方说明](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)。
Chromium 已用真实 ml5 和工程模型验证 Worker 加载与计算；平台支持和这条证据
都不等于真实手机验收。iPhone 的视频帧传递、后端初始化与生命周期仍需实际验证。

## 当前统一入口发行（2026-11-09）

经用户明确授权，0.4.5 已通过既有 CI 发布为公开预发行版，正式 App 注册表采用其
实际匿名下载产物。#311 保留可信 HTTPS、Worker、权限及资源释放；HTTP 下明确
限制采集。新的缓存校验回归确保 CI 不因纯校验改写模型下载时间。实际发布包的
安装／入口证据与固定资源规则见
[四工具接入说明](./utility-browser-participation.md)。真实手机采集及签名 App 媒体
验收仍待完成。下文 0.4.3 是历史修复记录。

## 历史本地候选与分发

当时的修复候选版本为 0.4.3，尚未发布。彼时 `utilities.json` 锁定已发布的 0.4.2；
不得为本地候选填写虚构的 release URL 或校验和。正式接入须先由工具仓库发布
固定 `.pnds` 产物，再更新 App 注册表的真实 tag、文件名与 SHA-256。分发契约见
[pnds-bundle.md](../zh-CN/reference/pnds-bundle.md#内置工具的形态)，构建规则见
[releases.md](./releases.md)。

开发 App 可以暂存本地候选至 `src-tauri/resources/utilities/mobile-sensor-meter/`。
该目录被 Git 忽略，不能作为唯一修改来源。`npm run utilities:fetch` 及普通
`tauri build` 会替换它并恢复正式注册表版本；本地暂存不代表正式发行已经更新。
直接在 App 中打开修复源码文件夹也可验证，源码不受工具拉取影响。

已生成的本地候选位于 App 工作树
`.cache/sensor-handpose-isolation/Mobile-Sensor-Meter-0.4.3.pnds`，可以通过 App
打开并作为独立工程测试。其 SHA-256、allowlist、模型 pin 和暂存一致性记录在
[验收记录](../acceptance/sensor-handpose-isolation.md#本地候选与暂存证据)；这是本地
开发产物，不是正式注册表更新。

完成工具检查后，在 App 仓库根目录执行以下命令，只复制运行所需文件；随后由用户
重载开发 App 的 Sensor Meter。命令不安装依赖，也不启动服务：

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const source = path.resolve('../PNDS-1.6.2-projects/Mobile-Sensor-Meter');
const target = path.resolve('src-tauri/resources/utilities/mobile-sensor-meter');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
if (manifest.id !== 'mobile-sensor-meter' || manifest.version !== '0.4.3') {
  throw new Error('Expected the Mobile Sensor Meter 0.4.3 local candidate');
}
fs.mkdirSync(target, { recursive: true });
for (const item of ['manifest.json', 'package.json', 'server.js', 'lib', 'public']) {
  fs.cpSync(path.join(source, item), path.join(target, item), { recursive: true });
}
for (const name of ['README.md', 'README.zh-CN.md']) {
  fs.copyFileSync(path.join(source, '.github/bundle', name), path.join(target, name));
}
console.log(`Staged local candidate ${manifest.version}: ${target}`);
NODE
```

## 验证边界

工具仓库运行 `npm run check` 与 `npm test`；App 仓库仍须通过
`npm run check:all`。回归必须覆盖模型加载未完成和首次推理繁忙时其他三类传感器
持续产生并发送新样本，以及停止取消、迟到消息、后台恢复与失败重试。仅让模型
Promise 等待的替身测试不能证明线程隔离；须另用真正 Worker 阻塞探针和真实
ml5／模型计算验证。具体浏览器运行证据与真机验收分别记录，不能互相替代。

2026-10-27 已完成受控长任务的红→绿验证，以及真实 ml5／模型的 Worker 计算：
首轮其他传感器最大样本间隔从旧版约 2808 ms 降为受控 Worker 约 76 ms，真实
模型场景约 85 ms；首次推理中停止约 41 ms 生效。双语阶段提示、停止后的迟到
结果与窄屏布局另有回归。输入来自受控浏览器平台替身，不是手机真实传感器。
命令、复跑记录与设备边界见
[sensor-handpose-isolation.md](../acceptance/sensor-handpose-isolation.md)。

2026-10-14 的工具人工验收属于旧版，不覆盖本次 Worker 修复。该轮 0.4.3 候选要求用户在
iPhone 15 Safari 验证首次启用、加载中停止、前后台切换以及其他参数持续传输。
