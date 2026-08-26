# Audio: Three Modes and the Work Layer

`audio/controller.js` is the file creators edit most — the work's **semantics** live here: what the faders control, how a voice becomes sound, how output is routed. The transport and engine primitives live in `lib/` and stay untouched.

## Three modes, one class

What makes a Project's sound is decided by the audio mode (internal / external / none). **The contract details — how the mode resolves, scsynth startup, the OSC target, the App master stage — are the reference manual's to state: [audio-modes.md](../reference/audio-modes.md) and [runtime-contract.md](../reference/runtime-contract.md); this chapter does not restate them.** As far as controller code is concerned, the mode only shows up as `engine.mode` branches:

- **internal**: `engine.createGroup` / `createSynth` / `setControls` / `freeNode` drive the built-in scsynth with the Project's `.scsyndef` files (the compilation contract is [supercollider.md](../reference/supercollider.md)).
- **external**: `engine.send` ships the voice state out as OSC addresses — `/c1/amp`, `/c1/freq`, `/c1/out`, … (the protocol is [osc.md](../reference/osc.md)).
- **none**: no audio from the engine; the controller's voice bookkeeping runs as usual (the pages and network interactions carry on).

The engine only has to satisfy the interface (`mode` / `outputChannels` / `outputBus` and the command methods) — no class check, so tests and alternate engines slot in at this seam.

## The Template work layer's example semantics

The conventions at the top of the controller are one whole work's design; swap in yours the same way:

- one voice per joined performer (in internal mode, one sine synth);
- odd ids default to output channel 1, even ids to channel 2; the monitor can reassign any voice's channel;
- each voice is capped at −6 dB in the SynthDef (`amp * 0.5`).

## The control payload: the one owner of its shape at this seam

`lib/protocol.js` forwards the `control` payload **opaquely** — its shape is entirely the work layer's vocabulary (the event table is in [Player Identity and Seats](./players.md)). `applyControls` is the single wire→voice entry, serving three paths at once (first seating, born-restored rebirth, live control) so they cannot drift apart:

- fields are read one by one: `range` (1|2|3, default 3), `amp` / `freq` (raw 0..1);
- **any non-finite number is ignored** — a malformed message must never zero someone's fader mid-show; unknown fields are not read.

The mapping functions live at this layer too: `mapFreq` (linear over a register's range to Hz; the ranges come from `registers` in `public/shared.js` — change them there, do not copy numbers into the controller) and `mapAmp` (squared, an audio taper like a mixing desk's).

## The shapes of recovery and routing

- `voiceState(id)` / `restoreVoice(id, state)` are the single owner of the reconnect-restore shape: it stores **raw values** (0..1 plus register plus out) and re-maps on restore — feeding already-mapped values in would map them twice.
- `addVoice(id, state)` supports **birth with state**: one `/s_new` (or one message burst) carries the correct values directly, skipping the audible intermediate state of "born default, then restored". In internal mode it also reads a control back (`verifySynthControl`) to prove the node really exists — a failed join is rejected, leaving no phantom voice the server believes in but nothing plays.
- `setOutChannel(id, channel)` validates `1..outputChannels`; `busFor(channel)` translates a 1-based work channel to the physical bus (`outputBus + channel − 1`).
- When a birth-with-state hits a persisted channel the current Project cannot route (the channel count changed between runs), the device is not rejected: the voice falls back to the default channel and the seat record heals at the next persist.
- `snapshot()` is the data source of the `state` broadcast.

## When you edit this file

Ask yourself: did the fader mapping change (`mapFreq` / `mapAmp` / registers)? Did control fields come or go (`applyControls` is the only entrance; the page side follows)? Did the default routing change (`defaultOutChannel`)? Is the loudness cap still there (SynthDef)? Those are the whole surface of the work's semantics; transport, identity, seats and persistence are all none of this layer's business.
