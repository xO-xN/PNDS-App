# #324：设备运动传感聊天采用与演奏事件

范围：[issue #324](https://github.com/xO-xN/PNDS-App/issues/324)，父规格
[#315](https://github.com/xO-xN/PNDS-App/issues/315) 第 9 个纵向切片。
实现基于已交付 #316–#320 的 Blank 身份、公共动作和录制回放基础。
本记录不代表父规格或 #313／#314 联合实机验收完成。

## 实现与边界

`device-motion` 是独立按需模块，不默认进入 Blank，不新增 p5、ml5 或第三方依赖。
沿现有工作聊天资源确认、固定来源、同任务恢复／撤回采用；不覆写作者源码。
浏览器实例提供明确 enable/stop/dispose 与可观察权限／采样状态，后台／关页移除
监听并使迟到授权失效。主／投影归属和调用者 `isOwner` 都必须允许采集。

倾斜、线性加速度、含重力加速度分别表达；真实零与缺失字段不同，不生成桌面
假传感数据。单位、设备坐标、范围、无平滑、每类 30 Hz 上限和 no-data 状态见
模块双语 README 与既有装机模块手册。普通 LAN HTTP 限制保持。

模块提供输入能力，作者决定作品映射。公开任务测试在真实生成工程内新增一份
作者 composition：倾斜驱动画面 X/Y 旋转，加速度 X 驱动画面 Y 旋转。这是测试
工程的明确映射，不是所有新作品的默认音乐或 Blank 内容。工程沿正式 players
归属／接纳与 `recording.action` 通道，校验后捕获，再经同一 `applyWork` 应用；
扩展真实 snapshot/restoreWork/releaseWork，回放不请求运动权限。

## 自动化证据

2026-11-10，隔离工作树 `codex/issue-324`：

- `vitest run src/lib/device-motion.test.mjs`：6 项通过。确认真实零／缺失、无 API／
  受限入口／无有效字段、权限拒绝重试、停止后迟到授权、后台释放、页面退出、
  每类节流、非法载荷和主／投影／退休归属。浏览器硬件事件由受控平台替身提供。
- `cargo test --manifest-path src-tauri/Cargo.toml confirmed_motion_task --lib -- --nocapture`：
  1 项通过。经公开 create/open/begin/propose/decide/adopt/write，实际产生工程，
  未批准前无采用，无新增共享依赖。执行 HTTP 实际提供的 performer/monitor
  页面脚本，按钮启用后以原生事件替身驱动真正 Socket.IO、工程接纳／校验、
  状态、记录端点和 monitor DOM；验证非空初始状态恢复、两类事件回放、拒绝
  未接纳与非法输入、纯回放不采用现场输入、不重复授权、同页重连无积压。
  停止后整任务撤回恢复入口和 manifest；已有作者定制模块复用及撤回保持原文。
- 新改代码 ESLint、`npm run typecheck`、双语帮助树／锚点测试通过。
- App `npm run check:all` 及维护源适用检查由本轮集成方统一执行，结果应见
  #324–#326 的最终集成验收记录；这里不以单项检查代替全部完成门槛。

## 真实设备与待验收

本轮没有实际手机运动数据。上述向量、JSDOM 页面和 Node 进程只证明计算、
生命周期与工程接线，不能证明传感器存在、真实方向、用户系统权限或手机采样。

#313／#314 联合验收需记录具体手机／系统／浏览器及 App 版本、可信 HTTPS／
原生参与路径、启用／拒绝／重试、真实倾斜和加速度方向与变化、横竖屏、后台／
关页释放、无传感器桌面与普通 LAN HTTP 的实际限制；同时验证真实输入产生的
作品效果与录制回放。不得把 API 暴露、资源复制或本记录自动化当作这些结果。

开发规则见 [device-motion](../developer/device-motion.md)，稳定装机说明仍在
[模块手册](../zh-CN/modules/README.md#device-motion-input)和
[英文模块手册](../en/modules/README.md#device-motion-input)。
