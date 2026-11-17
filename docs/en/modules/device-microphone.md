# Device Microphone Input

In Work chat, request the optional device microphone and confirm adoption.
The same task wires current-page input selection and activation, accepted player
actions, actual work state and recording/replay. No p5, ml5 or audio library is
required. Read `modules/pnds-device-microphone/README.md` in the actual project;
preserve existing author code.

## Data

One capture/Web Audio chain per enabled page produces at most 20 snapshots per
second: envelope (0–1 RMS with 0.8/0.2 smoothing), peak (0–1), 1024 waveform
samples (−1–1), and 512 FFT magnitudes (−100–0 dBFS; bin k is k × sampleRate /
1024 Hz). Digital levels are not calibrated SPL. Snapshots are not continuous
audio recordings; no raw-audio upload/storage or speaker monitoring is enabled.
Built-in and external choices are limited to inputs the browser actually exposes.

## Activation and verification

Enable with a button, choose an input, stop and retry. Denial, unavailable input,
restricted ordinary LAN HTTP, unplugging and switching have explicit states.
Background stops capture; foreground and replay do not reopen it. Late permission
is released immediately; closing a page affects only that page. Projection reads
the main monitor’s derived results. Replay applies the same feature/state effects.
Controlled arrays prove calculation and wiring. Phones, physical inputs, system
permissions and multiwindow sharing require separate device evidence.
