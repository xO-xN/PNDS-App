# Camera HandPose / 摄像头手势传感

Opt-in only. Read the existing project before adopting. p5 is a PNDS product
prerequisite for this module, not a claim that ml5 generally depends on p5.
A verified self-contained p5 2.3.2 (maintained Template snapshot) or 2.3.4
(shipped npm snapshot), or exact shared p5 2.3.4 must already be present.
Unknown/customized versions stay unchanged and require explicit compatibility
resolution. Never add/upgrade p5 automatically. The chat plan includes only the
missing exact ml5 1.4.0 reference and this module; one confirmation covers both.

本模块按需采用，p5 是 PNDS 产品前提，并非声称 ml5 普遍依赖 p5。
已有可信自带 p5 2.3.2／2.3.4 或共享 2.3.4 可用；未知版本保留作者源码并明确解决兼容性，
不自动加入或升级 p5。缺少时显示“本工程还没有 p5.js”，不加入任何伴随资源。

## Offline assets / 离线资源

`PINNED.json` identifies ml5 1.4.0, MediaPipe HandPose lite detector/landmark v1,
upstream URLs, Apache-2.0 model license and SHA-256 of every original byte file.
The two original `model.json` files remain byte-identical. Weight shards are
transported as base64 text pieces below 1 MiB each, so the existing guarded
text journal can recover/undo every byte without a second mutation path.
`assets.js:createHandPoseAssets({ml5Path})` reads those pieces and decodes them,
checks the original shard hashes and ml5 hash before returning an HTTP handler.
Supply only the App-verified `PNDS_SHARED_LIBRARIES.ml5.path`; do not use a CDN,
bare module install, arbitrary input path or a runtime download fallback.
The helper serves `/modules/pnds-camera-handpose/handpose/{detector,landmark}/model.json`
and adjacent `group1-shard1of1.bin`, and the same-origin ml5/worker/page scripts.
Missing, changed or incomplete assets fail before model startup. The project
and `.pnds` include all encoded pieces, model documents, pins and license.

完整模型字节随工程携带，文本分片只用于现有安全任务恢复与撤回；服务端先解码核对
原始哈希，才提供模型和权重。模型、ml5 缺失或损坏明确失败，运行时不下载修复。

## Activation and ownership / 启用与归属

Serve the helper from both role HTTP handlers under the confirmed performance
context. Load `handpose-worker-client.js` then `camera-handpose.js`.
For ready-to-wire accessible controls use `mountCameraControls({element,baseUrl,messages,canSend,send,onState})`; provide translated labels/phases, check joined/connected in canSend, and send through the existing admitted action channel. It stays inert until a real enable/select action. Dispose it with the page.
Create one `PNDS_CAMERA_HANDPOSE.createCameraHandPose({video,baseUrl,onSample,onState})`
per enabled page. Connect a real user button to `start({deviceId})` or
`start({facingMode:'user'|'environment'})`, a stop button to `stop()`, and a
selector to `devices()` (permission controls labels/visibility). There is one
camera stream and one dedicated inference Worker per instance. No main-thread
inference fallback is provided. Use p5 already owned by the work for its visuals.

State phases distinguish requesting-camera, waiting-frame, frame-ready,
loading-runtime, loading-model, model-ready and inference-ready. Only a completed
real inference, including a valid zero-hand result, is inference-ready.
Restricted HTTP, missing APIs, denial, device loss and load failure are separate
states. Retry/switch calls start again explicitly. Background/pagehide/dispose
stop this owner's camera/Worker and invalidate pending authorization/frames.
Foreground does not silently reopen hardware. `PNDS_MEDIA_SURFACE.captureAllowed`
and `surface=venue` forbid projection capture; share accepted main-monitor
results with projection. Never close another page's stream.

用户主动启用；可选可见摄像头及手机前后方向。授权、真实出帧、模型就绪和完成推理分别
报告。普通 LAN HTTP 不冒充可信入口。后台释放，返回前台需再次主动启用。

## Features, actions and replay / 特征动作与回放

`onSample` receives `{hands,actions}` from the original submitted frame size.
At most two hand slots, each exactly 21 keypoints. x/y are unmirrored image
coordinates divided by frame width/height (right/down positive, not clamped);
z is supplied model z / width or null when absent, not calibrated depth.
`handedness` is model Left/Right/Unknown, not a persistent performer identity.
Pinch is thumb-tip/index-tip distance / wrist-middle-MCP distance < 0.35.
Open requires all four fingertips >1.2 times their corresponding PIP distance
from the wrist, and no pinch. Distances use image pixel aspect ratio.
Pinch/open start/end actions occur only on transitions, including hand loss.
Actions use hand=0 for a unique model Left label and hand=1 for a unique Right
label, independent of result-array order. Unknown or duplicate labels retain
continuous features but generate no new discrete actions; prior known actions
end when identity becomes ambiguous. This is not persistent person tracking.

Use `createHandPoseWork({publish})` from `work.js` as a concrete, editable mapping:
accepted palm x/y and pinch/open drive per-source marker position/color, included
in snapshots and restored by replay. Connect its prepareAction/applyWork/
snapshotWork/restoreWork/releaseWork to the existing performance object and
recording adapter. Merge with existing hooks instead of replacing authored work.
The server accepts only validated bounded camera samples after player admission
and current claim ownership. `recording.action(sourceId,payload)` captures once;
replay calls the same applyWork and never opens a camera. The browser sends
`{kind:'camera-handpose',...sample}` only while admitted and connected, using a
volatile emit; do not replay an offline input queue on reconnect. Main monitor
uses its existing authenticated work input policy; projection consumes results.
Neither raw video nor a video recording is saved/uploaded by this module.

实际工程须在同一聊天任务完成按钮、输入选择、可信本地资源路由、作品映射、事件校验、
状态和录制回放接线。复制资源不是交付证据；实际手机、原生媒体和真实手部推理分别留证。
