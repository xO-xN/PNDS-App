# Sensor Meter 0.4.3 手势加载与首次推理隔离

2026-10-27。用户报告 iPhone 15、当前 iOS Safari 中，启用手势后摄像头可以打开，
模型开始输出前已有的倾斜、运动和麦克风数值一起冻结，随后恢复。本次修复修改
`PNDS-1.6.2-projects/Mobile-Sensor-Meter` 独立源码，版本为本地候选 0.4.3。
正式 App `utilities.json` 仍锁定 0.4.2；没有提交、发布或伪造发行来源。

## 实现与验证目标

ml5 脚本执行、TensorFlow.js 后端与模型初始化、首次及后续推理移至独立 Worker。
页面维护摄像头预览与画面快照，并继续运行其他传感器的采集、处理和 Socket.IO
发送。每次只传递一个推理帧，模型慢时不积压帧。Worker 不可用或失败只报告
手势卡的错误，不在页面主线程运行备用模型。

加载提示区分摄像头授权、识别引擎、模型、等待画面、首次识别和识别已就绪。
模型加载结束不能提前显示识别就绪；零手是有效首结果。加载和首次推理期间
停止按钮保持可操作，停止撤销待完成操作并释放摄像头，迟到结果不重启采集。
执行规则与本地暂存步骤由 [sensor-meter.md](../developer/sensor-meter.md) 维护。

## 受控浏览器红→绿

工具脚本 `scripts/verify-handpose-isolation.mjs` 通过 Playwright 的请求路由从本地
文件提供真实页面和资源，不启动开发服务器。摄像头、运动输入、麦克风与 Socket.IO
边界由受控平台提供；Worker、页面事件循环、状态渲染与采集控制器使用实际实现。
三个其他通道都必须持续出现新样本，最大间隔门槛为 750 ms。

| 场景                                           | 首轮观测结果                                            |
| ---------------------------------------------- | ------------------------------------------------------- |
| 旧实现：引擎、模型与首次推理长任务运行在页面内 | 其他通道最大样本间隔约 2808 ms，隔离断言失败            |
| 修复：三个阶段的长任务运行在独立 Worker 内     | 其他通道最大样本间隔约 76 ms，所有阶段各至少 10 个样本  |
| 修复：首次推理忙碌时点击停止                   | 约 41 ms 生效，等待原任务时间后仍为 off，无迟到手势样本 |
| 修复：真实 ml5 与工程模型文件                  | 其他通道最大样本间隔约 85 ms，实际推理完成              |

首轮为 Chromium 149.0.7827.102，393×852 CSS px 手机视口。受控和真实模型两种
运行均只有一个 Worker，页面中 `window.ml5` 不存在，无外网请求或页面错误。
真实模式检查 detector／landmark 两份 JSON 与两份权重均被实际加载；输入画面
为受控画布，不能据此宣称实体摄像头或真实手部识别已经验收。

源码冻结后的最终中文受控复跑：倾斜／运动／麦克风最大样本间隔分别为
79／79／65 ms，首次推理中停止为 33 ms，无迟到结果。英文真实模型复跑最大间隔为
82／82／65 ms。阶段文字包含引擎、模型、等待画面、首次识别与就绪；手机视口
下加载和就绪界面均无水平溢出。复跑数值是同一机制的重复观察，不是手机性能指标。
本地复跑日志及加载／就绪截图保存在 App 工作树
`.cache/sensor-handpose-isolation/`，不随 App 或工程包分发。

在工具源码根目录运行：

```sh
node scripts/verify-handpose-isolation.mjs \
  '../../PNDS-App-main/src-tauri/resources/shared-libraries' \
  '/Users/xiaoxiang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright' \
  '/Applications/Chromium.app/Contents/MacOS/Chromium' controlled zh-CN
```

将最后两个参数改为 `real en-US` 运行真实 ml5／模型场景。脚本不使用公网 CDN，
不申请实体摄像头、麦克风或运动权限。浏览器和模块路径属于本机测试环境。

## 自动回归与交付边界

`test/performer.test.js` 的 32 项页面回归通过，包括中英文加载阶段、首次结果前
无 ready、零手首结果、每阶段其他三个通道连续发送新序号、停止取消及原有采集、
错误和后台恢复。Worker 客户端与运行时另覆盖单帧限制、初始化／推理超时、
位图资源释放、加载中终止与错误传播。控制器继续验证单调序号、迟到结果和
摄像头生命周期。独立审查另发现推理中视频尺寸改变会按新尺寸归一化旧帧，
已通过失败回归后修复为提交帧尺寸副本；640×480 提交的 (320,240) 关键点在
视频改为 320×240 后仍归一化为 (0.5,0.5)。后台之前的推理结果在恢复后也被丢弃。

最终工具 `npm run check` 与 `npm test` 全绿（185／185）；App
`npm run check:all` exit 0，包含 TypeScript、lint、ast-grep、Prettier、Rust 格式、
Clippy 与前后端测试。未把显式忽略的原生／声音验收项记为通过。
最终日志保存为 `.cache/sensor-handpose-isolation/meter-tests.log` 和
`app-check-all.log`。

## 本地候选与暂存证据

已按工具正式 package workflow 的 allowlist 组装本地候选：manifest、package、
server、lib、public 及两份发布 README。没有 node_modules、测试、开发文档或
工程私有资料。归档顶层为唯一 `Mobile Sensor Meter/` 与 `pnds-bundle.json`，
metadata 为 formatVersion 1、packedWith `1.7.0-beta.1`，附独立候选说明记录，
未创建 GitHub release 或更改正式注册表。

- 候选：`.cache/sensor-handpose-isolation/Mobile-Sensor-Meter-0.4.3.pnds`
- 大小：3,640,368 字节。
- SHA-256：`0e85fb9c6be9ce729d0c20836f5d23a52c697995a053dbde96c3c68892e74950`。

本地检查全部四项生产依赖有确切 sharedLibraries 引用，所用共享库完整文件清单、
大小和 SHA-256 均与 App catalog 一致；`npm run libraries:check` 另验证全部七项
App 共享库。detector／landmark 的四个模型文件 SHA-256 与工程 PINNED 一致，
模型 JSON 声明的权重也均被 pin 覆盖，未运行下载脚本或请求网络。

ZIP 已检查无重复路径、绝对路径、`..` 逃逸或符号链接，两个新增 Worker 文件均在包内。
实际解包后 32 个运行文件逐字节匹配最终源码／发布 README。完整记录保存为
`.cache/sensor-handpose-isolation/bundle-verification.json`。

开发 App 的 `src-tauri/resources/utilities/mobile-sensor-meter/` 已同步 0.4.3：
30 个源码运行文件与两份发布 README 逐一匹配，见同目录证据下
`staged-verification.json`。没有修改 `/Applications/PNDS.app` 或旧版源码。
再次运行 `utilities:fetch` 或普通发行构建仍会恢复正式 0.4.2；可重新暂存，或直接在
App 打开上述候选包验证。正式工具接入仍须固定发布产物和注册表更新。

## 真机验收状态

**0.4.3 的 iPhone 15 Safari 验收待用户完成。** 需在真实 HTTPS 手机入口验证首次
开启手势时倾斜、运动与麦克风持续采集传输，加载中与首次推理中可停止，前后台
切换能恢复，加载失败可重试，并检查实际手部移动的坐标与画面一致。用户尚未
提供此次修复后的测试结果，不记录具体 iOS 版本号、等待秒数或设备通过结论。
2026-10-14 的旧工具整体验收不适用于这次 Worker 改动。
