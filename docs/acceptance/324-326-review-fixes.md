# #324–#326 review fixes

This record supplements the individual delivery evidence after the Standards and
Spec review. It does not complete the parent #315 or physical acceptance in
#313/#314. Full App checks remain the integrator's final gate.

All three collectors now capture activation ownership before external feedback
and recheck it after feedback before permission requests, model creation, sample
publication or scheduling. The actual public APIs have red→green regressions for
requesting/waiting/active/frame/model/inference feedback stopping the same owner;
a synchronous model-progress stop disposes its returned Worker without touching
a newer activation. The three JavaScript files pass 28 tests in total.

Camera adoption checks exact final and pending journal capacity before module
publication. A legal large existing task rejects adoption without retaining a new
ml5 reference, model directory, false changed-file entry or lost author work.
The regression covers newly adopted and already present ml5. A separate boundary
case places the real pending serialization one byte below 16MiB: the larger final
shape must fail before publication while keeping the public task recoverable.
Trusted self-contained p5 is found by safe existing file enumeration, known byte
length and exact hash regardless of public/vendor path or filename extension.
The eight native camera tests pass.

The same approved microphone and camera chat tasks now save actual author SVG
monitor renderers. Tests load the real monitor HTML and scripts with real
Socket.IO rather than treating named state fields as graphics. Microphone live
input changes circle radius 50→75, opacity 0.1→0.23, waveform y=30→20 and FFT
path y=40→20; replay restores the saved SVG attributes and paths without opening
another input. Camera changes circle `(cx,cy,fill)` from `(0,0,#ef4444)` to
`(25,50,#94a3b8)` and restores the latter during replay, both in the generated
project and after actual `.pnds` packing/installation. These author renderers are
test compositions and do not become Blank defaults or fixed musical policy.

The latest camera source and installed projects also run actual ml5 1.4.0 and all
four pinned local model resources in a Worker. Controlled black pixels produce
one valid zero-hand inference per run, with zero external requests, track
release and no page-thread ml5. These results remain distinct from physical
capture and real-hand recognition, which were not exercised.

The existing Client cleanup test used a bind as a listener-release observation.
Test-only refusal observation now retains the transaction/native cleanup/late
preparation/reentry assertions and fences known managed spawn transitions.
Deterministic tests show an exclusive bind can fail on a released listener's
established outbound source port while the listener correctly refuses new
connections; a genuinely held listener still fails the observation. Darwin's
reusable std listener can allow that outbound overlap, so this is not evidence
identifying the historical std-bind failure's sole cause. The target Leave,
existing held-fork regression and both new observation cases passed without
production, deadline, allocator or suite-concurrency changes.

The module manual's original headings, anchors and installed paths are retained;
its current catalog description and original five-module add test now state the
eight-entry catalog accurately.

Results and concrete SVG/model observations are in the
[review evidence](./evidence/324-326-review-fixes-2026-11-10.json). Relevant commands:

```sh
npm run test:run -- src/lib/device-motion.test.mjs src/lib/device-microphone.test.mjs src/lib/camera-handpose.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib camera_ -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib microphone_chat_adoption_runs_four_features -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib listener_release_tests -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib participation_client::tests::leave_owns_all_sources_before_prepared_candidate_cleanup_begins -- --exact --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib test_support::local_fixture::tests::listener_handoff_waits_for_a_managed_fork_to_finish_exec -- --exact --nocapture
```

Real Worker inference additionally uses `PNDS_HANDPOSE_BROWSER=1`,
`PNDS_HANDPOSE_PLAYWRIGHT=<module>` and `PNDS_HANDPOSE_CHROMIUM=<executable>`.
