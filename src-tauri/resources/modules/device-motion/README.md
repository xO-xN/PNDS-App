# Device motion / 设备运动传感

Optional native current-device input. This module is not part of Blank defaults;
no p5, ml5, npm library or synthesized desktop sensor is added.
按需读取当前参与设备；不默认启用，不添加 p5、ml5 或其他库，不伪造桌面传感器。

## Input contract / 输入约定

Load `device-motion.js` in the participating page as `PNDSDeviceMotion`, or use
CommonJS on the server. `createDeviceMotion({target, onSample, onState})` creates
one page-owned instance. Call `enable()` directly from a user button, `stop()` to
remove hardware listeners, `dispose()` when retiring the page. Re-enabling replaces
listeners rather than stacking them. `visibilitychange` to hidden and `pagehide`
stop capture and revoke pending permission replies. Returning to the foreground
requires explicit enable; no automatic permission request or queued sample replay.

页面加载后由用户按钮直接调用 `enable()`；`stop()` 移除传感器监听，页面退役用
`dispose()`。后台／关页立即停止，迟到授权失效；前台需重新明确启用，不积压输入。
多个页面各自持有实例，不移除其他页面监听。不要在回放或恢复连接时启用硬件。

`onSample` delivers JSON `{version:1, kind, value, intervalMs?}` at most 30 Hz per
kind, dropping intermediate samples without a queue. `normalizeMotion(payload)`
on the server returns a sanitized valid sample or `null`. Its fields are:

- `tilt`: `beta` degrees [-180,180], front/back rotation about the device X axis;
  `gamma` degrees [-90,90], left/right rotation about device Y. Device-local axes
  follow the browser event, not screen orientation; screen rotation does not
  remap them. Positive rotation uses the device right-hand convention; CSS
  transform conventions differ, so author the visual mapping explicitly.
  Heading/alpha and angular velocity are outside this module.
- `acceleration`: `x,y,z` in m/s², excluding gravity; `gravity` is the separately
  labelled acceleration including gravity. X points right, Y toward the top,
  Z out of the screen. Each component must be finite and within [-200,200].
- `intervalMs`: browser-reported motion sample interval [0,1000] ms when present;
  this is not the module delivery period. There is no smoothing or integration.

`null` means that specific field was not supplied; numeric zero is real zero.
An entirely missing/nonfinite/out-of-contract vector is never delivered as a
valid sample. A no-data timer reports the absence of valid fields after 1.5 s;
API presence alone does not prove hardware. This cannot identify every hardware
failure or promise complete gyroscope/orientation fusion.

`tilt` 的 beta/gamma 单位度，分别绕设备 X/Y 轴，方向依浏览器设备坐标；不随屏幕旋转重映射。
`acceleration` 不含重力，`gravity` 含重力且单独命名，单位 m/s²；X 向右、Y 向设备顶部、Z 向屏幕外。
每分量限制 [-200,200]。`intervalMs` 是浏览器原始采样间隔，不是模块发送周期。
不做平滑、积分或完整陀螺仪融合。每类最多 30 Hz，直接丢弃中间样本。
`null` 为缺失，0 为真实零；全部缺失不会生成有效样本，等待 1.5 秒后提示 no-data。

## Permission and ownership / 权限与归属

`state`/`onState` expose `idle`, `requesting`, `restricted`, `unavailable`,
`denied`, `error`, `waiting`, `no-data`, `active`, `suspended`, `stopped`, plus an
error detail. Render these with the project's own localized copy. Only `active`
means this instance received a real valid event. `waiting` only means listeners
are installed. Show retry for denial/failure/no-data. Ordinary LAN HTTP may be
restricted even when the device has sensors; use a supported native or trusted
HTTPS entry. Permission methods are invoked synchronously by `enable()` while
the user's activation is live. A failed request installs no hardware listener.

界面需区别请求权限、拒绝、受限入口、API 不可用、等待真实数据、无有效字段、实际采集、后台暂停及停止。
只有收到有效原生事件才 active；仅 API 存在或获得权限不等于有传感器。
拒绝／失败／无数据均提供重试。普通 LAN HTTP 能力限制如实保留，不能绕过系统权限。

## Complete the work / 完成工程接线

Read actual customized project source before changing it. Serve the one script
through a fixed safe route; do not expose the entire module or project tree.
The enable/stop UI belongs to each participating page. Forward fresh samples
through `PNDS_PLAYER.sendAction(sample)` only while joined/connected; that method
drops disconnected input. Never cache and flush samples on reconnect.

On the server, the existing players protocol verifies ownership/admission before
`recording.action(id,payload)`. Extend `performance.prepareAction` with
`normalizeMotion`; `applyWork` maps the accepted feature to the author's actual
visual/music state. Extend `snapshot`, `restoreWork`, and `releaseWork` for that
same state. Live and replay must share `applyWork`; replay does not recapture or
request hardware. Validate restore membership and preserve current live sources
when overdubbing; release retired sources. Capture only the features actually
used by the work. App supplies recording UI/storage/clock; no recording module
selection is required.

先读实际定制源码，固定安全路由只发布此脚本。每页用户明确启用，确认接纳／连接后用
`PNDS_PLAYER.sendAction` 发送新样本；断线丢弃，不恢复时冲刷。服务端先由 players 核验归属与接纳，
再由 `prepareAction` 调用 `normalizeMotion`，经既有 `recording.action` 捕获后进入 `applyWork`。
音乐／画面映射由作品决定；同步扩展真实 `snapshot`、`restoreWork`、`releaseWork`，校验回放成员，
叠加时保留本轮现场来源；回放使用同一业务入口而不重录、不启用传感器。

Check confirmation/cancel/whole-task undo, custom-source preservation, admission,
invalid samples, permission denial/retry, close/background/late authorization,
disconnection without backlog, and actual visual/music replay. Controlled event
vectors prove transformations and lifecycle only. Real phone motion, axis
orientation and platform permission results require separate device evidence.

测试需涵盖聊天确认／取消／整任务撤回、作者源码、接纳、非法样本、权限重试、后台与迟到结果、断线不积压和实际效果回放。
确定性事件只证明计算与生命周期；真实手机运动、方向和权限必须另外留证。

Main/projection capture ownership is also enforced by default through
`PNDS_MEDIA_SURFACE.captureAllowed` and `surface=venue`. An optional `isOwner`
callback further restricts capture; it cannot override those projection guards.
主／投影归属默认由上述原生标记与页面角色核验；调用者可用 `isOwner` 进一步收紧，不能解除投影限制。

Axis and permission semantics: [W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/).
The delivery ceiling and acceleration bounds above are this module’s own contract.
