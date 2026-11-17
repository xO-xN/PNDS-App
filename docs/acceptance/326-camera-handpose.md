# #326 Camera HandPose delivery

Scope: [#326](https://github.com/xO-xN/PNDS-App/issues/326), parent #315. Implementation
uses the existing #320 event/recording foundation and #321 combination adoption.
#321 remains open on GitHub; its implemented baseline was present for this work.
No parent/final acceptance issue is resolved by this record.

The opt-in module checks byte-trusted compatible p5 before any companion write,
groups exact ml5 1.4.0, carries complete HandPose lite v1 JSON/shard bytes and
licenses, and records all adopted text pieces in existing task recovery/undo.
Actual camera controls remain inert until enable/select. Capture, worker/model,
submitted-frame dimensions and late results belong to one page generation.
Projection is gated by native captureAllowed, venue surface and author ownership.
A concrete work mapping validates bounded 21-point samples, applies marker
position/color and restores it through common recording/replay without capture.

Automated results in the isolated #326 worktree:

- Eleven JavaScript behavior tests: normalization, malformed data, stable hand-label
  action edges, visible-state restoration, late permission release, restricted
  sources/projection, first-frame cancellation, loading-time ownership loss and
  actual enable/stop/select controls, synchronous frame/model progress stop and
  inference feedback stop.
- Eight native workflow tests: missing/spoofed p5 leaves no companion resource;
  approved exact ml5/model adoption survives task restart and whole-task undo;
  a declared shared p5 must resolve actual local bytes; module publication failure
  restores its companion manifest mutation; public Blank creation and
  chat adoption wire a real generated server, accept Socket.IO actions, observe
  marker state, record/replay, then pack/install an actual `.pnds` and repeat. The original chat task saves a
  real author monitor renderer; actual served HTML/scripts change SVG circle
  position/color from `(0,0,#ef4444)` to `(25,50,#94a3b8)` and restore the latter
  through replay. Additional public tasks retain trusted `vendor/p5.bundle`,
  preserve large author journals/approval/existing ml5 at capacity failure and
  reject final serialized overflow before publishing any model directory.
- Actual Chromium 149.0.7827.102 runs the real ml5 1.4.0 and all four pinned model
  resources in a dedicated Worker, once from generated source and once after
  install. A controlled black frame completes a valid zero-hand inference,
  releases its track, loads no ml5 on the page and makes no external request.
- Targeted ESLint passes. App `npm run check:all` is owned by the integrator and
  must pass before this issue is reported complete.

The exact controlled inference reports are in
[evidence](./evidence/326-camera-handpose-offline-2026-11-10.json). Reproduce with
`PNDS_HANDPOSE_BROWSER=1`, `PNDS_HANDPOSE_PLAYWRIGHT=<module path>` and
`PNDS_HANDPOSE_CHROMIUM=<executable>` while running
`cargo test --manifest-path src-tauri/Cargo.toml --lib camera_ -- --nocapture`.
Default native tests do not require a separately installed browser.

No physical camera, real hand, phone, camera switch/unplug, macOS permission
choice or multi-window hardware sharing was exercised here. Controlled pixels,
zero-hand inference and computed landmarks are separate evidence boundaries.
Real Client/Host/creation performer and phone hardware acceptance remains with
#313/#314 under the previously accepted split. No fake hardware or inference
result is used by the shipped module.
