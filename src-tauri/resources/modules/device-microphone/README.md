# Device microphone / 设备麦克风

Optional, no p5/ml5 or audio library. Read the actual saved project before wiring;
never replace an author's custom state or recording adapter. Copying this module
is adoption only. Complete activation, work mapping, event/state/replay and tests
in the same confirmed chat task. Existing exact resources and task approvals are
reused. Cancellation/recovery/whole-task undo remain the assistant task's concern.

可选模块，不依赖 p5/ml5 或其他音频库。先读工程保存版，保留作者状态与录制适配。
复制只是采用；在同一获准聊天任务完成启用、作品映射、公共事件/状态/回放与验证。

## Enable the current page / 启用当前页

Serve `microphone.js` through an explicit restricted project route (for example `/pnds-microphone.js`); do not publish private project files. After the
players connector is ready, create **one instance per enabled page**:

```js
const mic = PNDSMicrophone.connectMicrophone(PNDS_PLAYER, {
  onState: state => { status.textContent = state.status + ': ' + state.message },
  canSend: () => recordingMode !== 'playback',
})
button.onclick = () => mic.enable({ deviceId: inputSelect.value || undefined })
stopButton.onclick = () => mic.stop()
// Populate inputSelect from await mic.devices(); repeat after permission grants
// labels. Use devicechange to refresh the choices, without automatic selection.
addEventListener('pagehide', () => mic.dispose())
```

`devices()` exposes only browser-visible audio inputs, including built-in and
external inputs. An explicitly selected id uses `exact`, with no silent fallback.
Allow/deny, unavailable device, restricted LAN HTTP, retry, ended tracks, stop and
page ownership are separate states. Refresh choices after permissions change;
labels may be absent before permission. A busy device reports failure; never stop
another page to acquire it. A new selection releases only this instance's old
stream and AudioContext. Background/pagehide stops it; foreground/replay never
re-enables hardware. A late permission result is stopped immediately.

设备来自当前参与页面，而非远程 Host。普通 LAN HTTP 明确受限；可信原生页面也
不代表系统一定授权。仅由按钮动作开麦；选择失败或拔出后显示状态并由用户重试。
后台暂停并释放，返回前台须重新启用。关闭/迟到授权只清理本页，不抢占另一页。

## Four features, one chain / 四项数据与同一分析链

For ready-made native controls, call `PNDSMicrophone.mountMicrophoneControls({ player: PNDS_PLAYER, container, locale })`; it includes input selection, enable/switch, stop, live status and devicechange refresh. Its returned `dispose()` also removes those controls.

One getUserMedia stream → one source → one analyser, **no speaker destination**.
At most every 50 ms while active (20 Hz; browser scheduling may be slower), it
publishes one snapshot with `version:1`, actual `sampleRate` in Hz, `fftSize:1024`:

- `envelope`: normalized RMS, 0–1, `0.8 * previous + 0.2 * currentRMS`; resets at enable.
- `peak`: instantaneous maximum absolute sample, 0–1, unsmoothed.
- `waveform`: 1024 normalized PCM samples, −1–1; a window, not continuous recording.
- `fft`: 512 frequency-bin magnitudes in dBFS, clamped −100–0; negative infinity
  (silence) becomes −100. Bin k is k * sampleRate / 1024 Hz. Analyser smoothing is 0.8.

这些是数字电平，不是校准声压 dB SPL。波形/FFT 是可能有间隔的快照，不是完整录音；
默认不保存或上传原始声音、不扬声器监听。只有工程真正选用的特征进入业务与记录；
若作品只需要包络，可在作者自己的有效载荷中裁减，且同步更新校验和快照/回放。

## Accepted events and replay / 接纳、事件与回放

`connectMicrophone` sends `{kind:'microphone',sample}` through the existing joined
player's `sendAction`, dropping disconnected samples. It does not create another
namespace, bypass player ownership, or replay a reconnection backlog.

On an ESM server use `import microphone from "../modules/pnds-device-microphone/microphone.js"` (adjust the relative path), then `const { microphoneAction } = microphone`; the shipped module is CommonJS/UMD. In the work's
`prepareAction`, validate with it **before** `recording.action` captures the
accepted event. Preserve other actions. In `applyWork`, use that same event for
live and replay effects (for example envelope → brightness, peak → radius,
waveform → trace, FFT → bars). Put the actual state used by those effects into
`snapshot`; `restoreWork` restores that state for recorded performer ids,
`releaseWork` clears owned work resources. Use the existing recorder's replay
source mapping and live/playback/overdub admission rules. Do not call `enable`
from a replay callback. Invalid, unjoined or obsolete-owner input must produce
neither effects nor captured events. Test real state, not just API exposure.

主/投影 monitor 由主 monitor 采集，投影只读公共结果；独立 performer、Client 可
各自手动启用。需要 monitor 输入时由工程显式声明操作员来源和公共事件政策，不能
把普通观察 monitor 当作已接纳演奏者。页面隐藏与 App 外壳遮挡按工程媒体规则区分。

## Verification / 验证

Test public chat confirmation/adoption/undo and a real generated score using the
same validator and live/replay callbacks. Test four changing hardware features,
permission denial/retry, external-device selection/unplug, background, late
permission and multiwindow release separately. Controlled arrays prove arithmetic
and lifecycle only. Actual input, signed App and phones require physical evidence.
