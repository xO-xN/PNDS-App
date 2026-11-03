# Assistant native build and offline audio acceptance

Local acceptance on 2026-10-29, macOS arm64. Tests use temporary projects, task
journals, generated OSC files and rendered WAV files. No Runes files, score
server, App session or audio output device are used.

## Commands and result

```sh
npm run rust:test -- assistant_compile -- --nocapture
npm run rust:test -- controlled_node_tests -- --nocapture
npm run rust:test -- assistant_compile_real_sclang_temporary_fixture -- --ignored --nocapture
npm run rust:test -- assistant_compile_eight_pads_real_nrt -- --ignored --nocapture
```

The two installed-SuperCollider acceptance tests are ignored in the portable
suite because they require the standard local installation. Both were actually
run and passed on this machine. An initial sandboxed attempt could not start Qt
because CPU feature detection reported missing `neon`; the same test passed
outside that restricted execution sandbox. This is an execution failure, not
evidence of a missing compiler. Tests do not alter compiler discovery or attempt
installation.

The silent real-compiler fixture generates `voice.scsyndef` through the current
task, validates its manifest reference, verifies fresh build state and undoes
the artifact and newly created output directory. Deterministic compiler tests
also cover unavailable versus failed compilers, retry, cancellation, source and
artifact version conflicts, binary journal recovery, protected drafts, refused
discussion mode and version-checked undo.

Real bundled-Node fixtures cover success, assertion failure, absent entries,
missing dependencies, timeout, cancellation during execution, bounded output
and changed input freshness. The score-server fixture throws if accidentally
started. Test writes stay in the temporary copy; an explicitly temporary marker
is used only to synchronize the running-process cancellation test.

## Eight-pad rendered behavior

Eight controlled waveforms use the same explicit gate envelope with release
durations 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0 and 1.1 seconds. The compile receipt
identifies saved sources and all eight published binaries. NRT loads those
published files using `/d_load`; it does not synthesize from an unchecked source
string. Rendering uses 48 kHz, stereo PCM16, a 64-sample block and `scsynth -N`.
NRT reads timed OSC from a file and writes a file without an audio device or OSC
listener. See the [SuperCollider NRT guide](https://doc.sccode.org/Guides/Non-Realtime-Synthesis.html).

Each binary is tested in three explicit scenarios: gate stays active, finger
release at 2 seconds, and element expiry at 3 seconds. Active gate is refreshed
every 100 ms. Release is sent once at the scenario's declared boundary and
rendering continues through the full release plus 250 ms. These are controlled
protocol fixtures; the labels do not infer a real project's ending rules.

Measurements use left-channel RMS, normalized to the 0.3–0.5 second stable
window. The late held window ends 50 ms before the boundary. Tail windows span
40–60% and 80–90% of the configured release. The final silence window is
50–150 ms after the release duration.

| Measure                      | Acceptance threshold | Observed range across eight pads |
| ---------------------------- | -------------------- | -------------------------------- |
| Stable RMS                   | > 0.01               | 0.028882–0.141486                |
| Late held RMS / stable RMS   | > 0.75               | 0.999895–1.002595                |
| Middle tail RMS / stable RMS | 0.30–0.75            | 0.503835–0.507191                |
| Late tail RMS / stable RMS   | 0.06–0.25            | 0.153595–0.156973                |
| RMS after full tail          | < 0.0001             | 0 in all released scenarios      |

All 24 scenarios passed. A negative control then recompiles pad 0 with a short
percussive envelope under the same valid symbol and manifest reference. Its
compiler report succeeds, but the rendered sustain assertion rejects it. This
distinguishes binary-format/build success from verified sound behavior.

The test prints `NRT_ACCEPTANCE=` JSON containing input and artifact versions,
every scenario's measurements and the negative-control result. Values above
are from the recorded local run, not hand-computed predictions.

## Limits

These thresholds apply to the chosen stationary fixture waveforms and linear
release envelope. Beating, intentional modulation, noise and artistic timbre
changes need their own sampling and baseline choices; a short RMS window is not
a universal sustain detector. This test verifies synthesis output for scheduled
gate messages. Controller rules, one-time release scheduling, arbitrary score
protocols, live instance loading, hardware loudness and artistic preference
require their separate evidence. No live or real-score acceptance is implied.
