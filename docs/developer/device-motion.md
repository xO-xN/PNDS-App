# Device motion adoption and runtime (#324)

The optional `device-motion` catalog entry is a native browser UMD module, with
no drawing or inference dependency. It shares creator-confirmed local-resource
adoption, exact provenance, exclusive publication, task recovery and undo with
other modules. Adding its files never means work wiring is complete. Do not add
it to Blank defaults or overwrite existing customized module/entry sources.

The agreed test seams are public creation/chat task operations and the actual
generated project. `modules_motion_tests.rs` creates Blank, proposes the module,
checks no adoption before approval, adopts it, then uses task-owned writes to
extend the existing work action/state/recording callbacks and page controls.
`motion_project.mjs` executes the actual served page scripts with a controlled
platform boundary. Real Socket.IO policy checks, accepted state, App recording
adapter and monitor DOM are exercised; the authored mapping in
`motion_piece.mjs` is a test composition, never a shipped Blank default.

`createDeviceMotion` has explicit enable/stop/dispose ownership. Native permission
methods run synchronously inside the enable action; every asynchronous reply is
fenced by the instance generation. Hidden/pagehide removes hardware listeners and
invalidates pending requests. Foreground resume requires another enable. Default
ownership refuses a projection (`PNDS_MEDIA_SURFACE.captureAllowed === false` or
`surface=venue`); the caller's `isOwner` must also remain true. Recheck after
permission and before sample delivery. Independent pages remove only their own
listeners. Replay and reconnect must never call enable automatically.

The shared `normalizeMotion` contract preserves real zero and per-field null,
limits tilt and acceleration to documented finite ranges, and rejects all-missing
vectors. The page limits each signal to 30 Hz by dropping intermediate samples;
there is no pending transport queue. `PNDS_PLAYER.sendAction` gates joined and
connected delivery. Server policy still owns current claims/admission and the
recording adapter's live/replay mode. Extend `prepareAction`, `applyWork`, real
`snapshot`, `restoreWork` and `releaseWork` together. Snapshot restoration must
respect included replay members and preserve eligible live overdub sources.

`src/lib/device-motion.test.mjs` checks controlled event values, permissions,
late replies, background/retirement, projection and throttle behavior. These and
the project integration are automation evidence, not physical sensor capture.
Record real phone/native/browser permissions, direction and input changes
separately, including ordinary HTTP restrictions and no-sensor devices.

Bilingual installed guidance extends the existing modules README with the stable
`Device motion input` section. No existing installed help path or title is moved.

Axis, nullable-field and platform permission terminology follows the
[W3C Device Orientation and Motion specification](https://www.w3.org/TR/orientation-event/).
The module's 30 Hz delivery ceiling and ±200 m/s² input bounds are its own
contract, rather than claims about a hardware sensor's range or accuracy.
