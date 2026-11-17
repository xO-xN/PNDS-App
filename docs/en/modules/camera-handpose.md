# Camera HandPose

`camera-handpose` is an optional input from the current device. Chat first checks
for an existing verified self-contained p5 2.3.2/2.3.4 or shared p5 2.3.4. Without
one it reports “This project does not yet have p5.js”, adding no ml5, model or
module. Other author versions remain unchanged for explicit compatibility
resolution. p5 is this module’s product prerequisite, not a general ml5 dependency.
One confirmation groups exact ml5 1.4.0 with the module; wiring, validation,
recovery and whole-task undo remain part of that same task.

## Offline model

Complete HandPose lite detector/landmark v1 model JSON, original weight bytes
(carried as text pieces), sources, Apache-2.0 license and hashes travel with the
project and `.pnds`. The project’s `assets.js` decodes and verifies the original
hashes before serving same-origin models/shards. Missing or damaged bytes fail
explicitly with no CDN or runtime download fallback.

## Capture and permission

A real button activates capture. Choose visible cameras or request front/back
facing on phones within actual platform capabilities. Each page reuses one
camera stream and one Worker model chain for all features. Permission, real
frames, model readiness and completed inference are distinct stages. Ordinary
LAN HTTP retains its restrictions. Denial, unplugging and failures permit an
explicit retry. Background, page close and stop release this page’s resources
and invalidate late results, without closing other pages’ streams. Projection
consumes the main monitor’s accepted results and never captures again.

## Data

Each hand has 21 unmirrored x/y points divided by the submitted image width/height,
positive right/down. Model z divided by width is null when missing and is not
calibrated depth. Pinch means thumb/index tip distance divided by wrist-to-middle
MCP distance <0.35. Open means all four fingertip distances from the wrist exceed
1.2 times their PIP distance, without a pinch. Start/end actions occur only on transitions, including hand loss, keyed to unique
model Left/Right labels rather than detector array order. Unknown/duplicate labels
retain features without new actions. This does not recognize arbitrary gestures
or provide persistent hand/person tracking.

## Work wiring and verification

The assistant wires used features through project validation/admission, common
actions, actual visual or sound state, recording and replay. Editable `work.js`
maps palm position/gestures to marker location/color with saved state recovery.
Replay applies the same effect without opening a camera. Disconnected input is
not queued. No video recording or raw-video upload is enabled by default. Keep
model computation, physical capture and real-hand inference evidence separate;
copied assets alone do not complete acceptance.
