# Audio: Three Modes and the Work Layer

## Application and state

Blank live input and replay share the application in `performance/recording.js`. Actual state and work callbacks such as `applyWork`, `restoreWork` and `releaseWork` belong in `performance/state.js`, which then calls `audio/controller.js` for sound. Sound added only to live server callbacks bypasses replay. The project's `docs/implementation.md` specifies complete callbacks and edit locations.

## Audio modes

- **internal**: load project `.scsyndef` files and write to Host-injected private buses; Blank initially outputs silence.
- **external**: send project-defined OSC; Blank initially sends no work messages.
- **none**: create no audio resources; pages and networking remain active.

Modes and Host responsibilities follow [audio modes](../reference/audio-modes.md) and the [runtime contract](../reference/runtime-contract.md). Message and target rules follow [OSC](../reference/osc.md).

## When you edit this file

Maintain parameter meanings, units, limits, live/replay application and snapshot restoration together. Release only project-owned sound resources. Compile changed SynthDefs and validate artifacts; JavaScript-only mapping changes do not require recompilation. Follow the [compilation contract](../reference/supercollider.md). Verify source, compilation, loaded code and listening separately.
