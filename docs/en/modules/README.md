# Module Manual

What each PNDS Template built-in module is for and how to use it, written for creators basing works on the Template. The manual ships offline with the App — reachable on the rehearsal and performance machines, no dev environment needed.

The wording follows the App's shared vocabulary: seat (the code says `seat`), claim token (never translated), and performer / monitor (the two page roles, kept in English everywhere).

## v1.6.1 offline standard modules

The current App offers eight independent entries: client connection and identity recovery, monitor theme, monitor language, monitor view state, optional hub connection, device motion, device microphone, and camera HandPose. Creation mode adds them to `modules/pnds-<id>/`, with actual sources, a bilingual README, `compatibility.json` and `pnds-module.json`. Compatibility separates module version, Host protocol, runtime dependencies and project adaptation; the module version differs from the App version. Wire against the README of the actual added version.

Legacy provenance remains readable. The App shows the installed version and preserves author sources and the original handoff. Upgrades, wiring, dependency installation and startup remain explicit external work. Ask an external agent to handle unknown provenance or conflicting files. File presence does not establish wiring, validation or distribution readiness. Template seat, channel and page descriptions below describe its example work policy. Projection, diagnostics and audio continue using existing infrastructure rather than becoming additional catalog entries.

## Chapters

| Chapter                                             | Files covered                                                                 | In one line                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| [QR Code](./qr.md)                                  | App overlay                                                                   | built-in performer QR and project migration    |
| [Player Identity and Seats](./players.md)           | `lib/players.js`, `lib/seats-store.js`, `lib/protocol.js`, `public/client.js` | claim tokens, seats, the Socket.IO protocol    |
| [Theme Following](./theme-follow.md)                | `lib/theme-follow.js`                                                         | the monitor page follows the App's theme       |
| [Language Following](./locale-follow.md)            | `lib/locale-follow.js`                                                        | the monitor page follows the App's UI language |
| [Projection Surface](./projection-surface.md)       | the page entry point (e.g. `public/monitor.js`)                               | the monitor page branches for the venue screen |
| [Monitor View State](./monitor-state.md)            | `lib/monitor-state.js`, `public/client.js` (monitor side)                     | every monitor copy renders the same view       |
| [Audio: Three Modes and the Work Layer](./audio.md) | `audio/controller.js`                                                         | the file creators edit most                    |
| [hub](./hub.md)                                     | `modules/pnds-hub/`                                                           | Optional remote nodes and events               |

## Division of labour with the other documentation

- **[The Template repository's implementation manual](https://github.com/xO-xN/PNDS-Template/blob/main/docs/implementation.md)** (genre division): that one is about the template's example Project itself — the example's behaviour spec, directory responsibilities, and what to change where; this manual is a per-module usage reference for rehearsal and performance — answering questions like "how do seats persist?" or "which CSS variables does theming drive?" when you need the answer now. The follow-along create-to-publish workflow guide for the dev machine is the help center's [Creator's Guide](../template-guide.md), which shares the same division with this manual.
- **[The Reference Manual](../reference/README.md)** (contract division): the reference manual is about the Project as a contract layer — manifest, runtime behaviour, `.pnds` bundling, OSC: the interfaces between the App and a Project. This manual is about the Template's own module implementations — how those files work inside a Project. Contract details are always the reference manual's to state; this manual links, never restates.

## Modules deliberately not covered

- `lib/config.js`, `lib/network.js`, `lib/health.js`, `lib/lifecycle.js`, `lib/osc-transport.js` — infrastructure a creator almost never touches; the contracts live in the reference manual's [runtime-contract.md](../reference/runtime-contract.md) and [osc.md](../reference/osc.md).
- `public/performer.js`, `public/monitor.js` — the example work layer: real works replace them wholesale; the workflow is the Creator's Guide's subject.

## Currency

This manual is written against the Template's implementation; whenever the Template cuts a release, re-check this manual so implementation and manual do not drift apart.

## Device motion input

`device-motion` is an optional capability adopted after Work chat confirmation. It is not a Blank default and needs neither p5 nor ml5. It reads the current participating device's tilt and acceleration, independently of the Host hardware. It does not provide a complete gyroscope.

The work provides localized enable, stop, retry and status controls. Call `createDeviceMotion().enable()` directly from a user action so the platform can request permission. Ordinary LAN HTTP can be restricted. Distinguish denial, missing API, waiting for valid fields and no data; permission does not prove actual capture. Backgrounding and page exit remove listeners and invalidate late permission replies. Foreground return requires explicit enable. Only the main monitor captures for its projection copy; each Client and performer page can enable its own input.

`tilt` beta/gamma are degrees around device X/Y, bounded to ±180°/±90°, without remapping for screen rotation. `acceleration` x/y/z excludes gravity; the separately named `gravity` includes it. Components are m/s², bounded to ±200; X points right, Y toward the device top, Z out of its screen. Zero is a measured zero; `null` is a missing field. An entirely missing vector never becomes valid input; after 1.5 seconds without valid fields, state reports no-data. Each kind updates at most 30 Hz without smoothing or integration. `intervalMs` is the browser-reported sampling interval, not the module delivery period.

Within the same approved task, the assistant reads actual source and wires page controls, a fixed safe script route, server `normalizeMotion` validation after current player admission, the author's effect, and the same common action/state/recording path. Check ownership/admission before capture and application. Replay restores the same effect without requesting motion permission or recording again. Send only fresh input while joined and connected; discard disconnected samples rather than flushing a backlog on reconnection. Whole-task undo preserves subsequent author customizations. The adopted directory's bilingual README specifies the full interface and limits.

Deterministic vectors and injected native events establish calculation, lifecycle and project wiring only. Real phone direction/tilt/acceleration, platform permissions and browser/native entry behavior require separate hardware evidence.

## Device microphone input

In Work chat, request the optional device microphone and confirm adoption.
The same task wires current-page input selection and activation, accepted player
actions, actual work state and recording/replay. No p5, ml5 or audio library is
required. Read `modules/pnds-device-microphone/README.md` in the actual project;
preserve existing author code.

One capture/Web Audio chain per enabled page produces at most 20 snapshots per
second: envelope (0–1 RMS with 0.8/0.2 smoothing), peak (0–1), 1024 waveform
samples (−1–1), and 512 FFT magnitudes (−100–0 dBFS; bin k is k × sampleRate /
1024 Hz). Digital levels are not calibrated SPL. Snapshots are not continuous
audio recordings; no raw-audio upload/storage or speaker monitoring is enabled.
Built-in and external choices are limited to inputs the browser actually exposes.

Enable with a button, choose an input, stop and retry. Denial, unavailable input,
restricted ordinary LAN HTTP, unplugging and switching have explicit states.
Background stops capture; foreground and replay do not reopen it. Late permission
is released immediately; closing a page affects only that page. Projection reads
the main monitor’s derived results. Replay applies the same feature/state effects.
Controlled arrays prove calculation and wiring. Phones, physical inputs, system
permissions and multiwindow sharing require separate device evidence.

## Camera HandPose sensor

`camera-handpose` is an optional input from the current device. Chat first checks
for an existing verified self-contained p5 2.3.2/2.3.4 or shared p5 2.3.4. Without
one it reports “This project does not yet have p5.js”, adding no ml5, model or
module. Other author versions remain unchanged for explicit compatibility
resolution. p5 is this module’s product prerequisite, not a general ml5 dependency.
One confirmation groups exact ml5 1.4.0 with the module; wiring, validation,
recovery and whole-task undo remain part of that same task.

Complete HandPose lite detector/landmark v1 model JSON, original weight bytes
(carried as text pieces), sources, Apache-2.0 license and hashes travel with the
project and `.pnds`. The project’s `assets.js` decodes and verifies the original
hashes before serving same-origin models/shards. Missing or damaged bytes fail
explicitly with no CDN or runtime download fallback.

A real button activates capture. Choose visible cameras or request front/back
facing on phones within actual platform capabilities. Each page reuses one
camera stream and one Worker model chain for all features. Permission, real
frames, model readiness and completed inference are distinct stages. Ordinary
LAN HTTP retains its restrictions. Denial, unplugging and failures permit an
explicit retry. Background, page close and stop release this page’s resources
and invalidate late results, without closing other pages’ streams. Projection
consumes the main monitor’s accepted results and never captures again.

Each hand has 21 unmirrored x/y points divided by the submitted image width/height,
positive right/down. Model z divided by width is null when missing and is not
calibrated depth. Pinch means thumb/index tip distance divided by wrist-to-middle
MCP distance <0.35. Open means all four fingertip distances from the wrist exceed
1.2 times their PIP distance, without a pinch. Start/end actions occur only on transitions, including hand loss, keyed to unique
model Left/Right labels rather than detector array order. Unknown/duplicate labels
retain features without new actions. This does not recognize arbitrary gestures
or provide persistent hand/person tracking.

The assistant wires used features through project validation/admission, common
actions, actual visual or sound state, recording and replay. Editable `work.js`
maps palm position/gestures to marker location/color with saved state recovery.
Replay applies the same effect without opening a camera. Disconnected input is
not queued. No video recording or raw-video upload is enabled by default. Keep
model computation, physical capture and real-hand inference evidence separate;
copied assets alone do not complete acceptance.
