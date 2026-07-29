# Task 6: Recent Projects、session 日志与 Logo 加载动画

对应 Phase 6。需求引用：§4.1（Recent Projects）、§11（日志）、§10.3（启动、Logo 与错误界面）。

## 目标

补齐演出体验的最后三块：工程历史、可诊断的日志、与真实启动阶段同步的加载动画。

## 工作内容

- Recent Projects（§4.1）：持久化已确认可信的工程绝对路径（App 本机数据目录）；点击历史条目重新 preflight；失效路径显示错误并允许移除；App 不得复制/修改/上传工程内容
- session 日志（§11）：每个 session 一个文件，存 Application Support/Logs；记录生命周期、preflight、`scsynth`/Node stdout/stderr、health 轮询、关闭结果、session 元数据（模式、LAN IP、OSC target、设备）；保留最近 20 个，超龄删除；不写工程目录、不上传
- Logo 加载动画（§10.3）：嵌入父目录 `PNDS Logo/` 的自包含 p5 sketch（`index.html` + `sketch.js` + `libraries/`），或等价重实现，必须保留：
  - 五阶段契约：五个点严格由真实事件推进（preflight 完成 / 音频路径就绪 / Node 已启动 / health ready / monitor 载入完成），不得计时假装；两个背景大圆随第 2、4 点进入
  - 随机颜色契约：每个 loading session 独立随机取色（允许重复），`PNDS` 文字优先用未占用颜色；session 内不变色
  - 第 5 点后五点收束 + 旋转，然后 dissolve：Logo 淡出、monitor 淡入，monitor 不动
  - 失败：停动画 → Error Page；Retry 开新 session 从第 1 点重来；Back/Close 回 Welcome 不自动重启

## 验收

- §13：日志轮转保留 20 个 session 有测试
- 慢启动时动画停留在当前真实阶段；五阶段与事件一一对应可演示
- 完整 §15-5 状态转换（Welcome → 加载动画 → 演出 → Error）验收通过
