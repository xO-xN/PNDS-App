# Blank {{templateVersion}} implementation guide

The App has initialized this project, including its first local Git version.
Implement the current user request. When assigned the creator handoff, follow
the AGENTS entry point for all current tasks. Maintain this guide as the project changes.

## Where to edit

| File                                              | Purpose                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `public/monitor.html`                             | Monitor markup and script entry                                      |
| `public/monitor-view.json`, `lib/monitor-view.js` | Low-frequency view declarations, validation and lazy synchronization |
| `public/monitor.js`                               | Score drawing, monitor interaction and parameter callbacks           |
| `public/performer.html`, `public/performer.js`    | Performer markup and interaction                                     |
| `public/style.css`                                | Initial shared styles; split by page when needed                     |
| `pnds.preview.json`                               | Exact tunable literal declarations; initially empty                  |
| `public/pnds-preview.mjs`                         | Shipped local preview protocol adapter                               |
| `server.js`                                       | HTTP resources, health, script snapshots and lifecycle               |
| `audio/controller.js`, `supercollider/`           | Audio and OSC implementation; initially silent                       |

Keep HTML, JavaScript and CSS in their respective files. Add shared code and
assets when needed. The server serves public files and the local Socket.IO client, with MIME and
`Cache-Control: no-store`. Save public files and refresh the monitor to load
them. Changes to the Node server or its imported audio code require restarting
the project. The App performs those actions only when the creator requests them.

Express 5.3.0, Socket.IO 4.8.4 and osc-min 2.1.2 are the default production
dependencies, supplied by the App's exact shared references. Express owns the
role routes while the bounded public-file resolver retains its MIME, canonical
path and cache rules. The server loads the injected absolute Node entries;
the audio controller imports osc-min's ESM entry by file URL and uses its actual
DataView byte offset/length for UDP. Missing or mismatched entries fail explicitly,
without an npm, CDN or download fallback. Both pages
load `/socket.io/socket.io.js` locally and connect with `io()` to their own origin.
The server owns one Socket.IO instance per HTTP port, available through
`realtime.get('performer')` and `realtime.get('monitor')`. A connection receives
`pnds:connected` with the project ID and server-assigned role. Add piece handlers
in the server's policy callbacks; performers send through
`PNDS_PLAYER.sendControls` / `sendAction`, while monitor keeps its own `socket`.
For example, a monitor handler can call `realtime.get('performer').emit(...)`.
Socket IDs identify connections. The default players core is already wired with
a no-seat persistent identity policy; do not adopt it again. No piece-specific
control or sound mapping exists yet.

Internal is the default: the audio controller and compiled SynthDef produce
silence on the injected private buses. External and None remain available.
Keep these three audio files together when replacing the placeholder.

Adopt other fixed shared packages only when the task needs them, then wire local
routes/imports. App playback stays offline and needs no npm installation.
Standalone development can install the exact package.json dependency locally;
Internal still requires the Host's audio environment.

README.md starts in the creation-time language and contains the creator's actual
introduction, initially empty if omitted. Add language variants when requested.
The App creates docs/creator-handoff.md when a handoff is recorded; a new Blank
has no pending tasks. Keep implementation notes here and audience-facing text
in README. The project .gitignore also applies to external Git tools; runtime
assets, SCD sources and compiled SynthDefs remain versioned.

## Adding an adjustable parameter

The monitor's preview plumbing is ready but starts with no parameters or controls.
In Work mode, the assistant completes all three steps, then publishes the saved
controls. For a title-size task, for example:

1. Define the actual mutable value in `public/monitor.js`, apply it to the page,
   and replace `previewParameters` with real callbacks:

   ```js
   let titleSize = 48 // px
   const renderTitleSize = () => {
     document.querySelector('h1').style.fontSize = `${titleSize}px`
   }
   renderTitleSize()
   const previewParameters = {
     titleSize: {
       kind: 'number',
       limits: { min: 12, max: 120, step: 1 },
       get: () => titleSize,
       set: value => {
         titleSize = value
         renderTitleSize()
       },
     },
   }
   ```

2. Register the same ID, kind, limits and exact whole-line anchors in
   `pnds.preview.json`, preserving other entries:

   ```json
   {
     "schemaVersion": 1,
     "parameters": [
       {
         "id": "titleSize",
         "path": "public/monitor.js",
         "prefix": "let titleSize = ",
         "suffix": " // px",
         "kind": "number",
         "limits": { "min": 12, "max": 120, "step": 1 },
         "preview": "live"
       }
     ]
   }
   ```

3. Save, run available checks, and expose the native-bound saved parameter.
   Refresh the saved monitor once before previewing newly saved code. Dragging
   is temporary; Save parameters persists adjustments with task undo. Ending
   preview restores the runtime baseline, not elapsed musical time.

Keep the monitor's script reference: the server pins `public/monitor.js` bytes
for each page and embeds their digest with the exact declaration digest. An
old page remains bound to its loaded version after another save. If parameters
move into additional files, extend their actual load snapshots and callbacks
too. Hashing later disk bytes cannot prove they were loaded. Callbacks should
apply declared values to real state and redraw paused scores when necessary;
audio callbacks use only the project's already enabled audio.

Static checks remain available during a performance. An occupied runtime blocks
the independent runtime check without stopping the project. Verify actual visual
and audio behavior separately. Platform contracts are linked from `AGENTS.md`.

## Confirmed browser entry

The generated manifest declares browser participation protocol 1 and runtime
listener handoff. Performer resources use relative URLs; the Host supplies
`./__pnds/context.js` after confirmation. Keep every asset/Worker request under
`PNDS_PARTICIPATION.resource(relative)` and pass a copy of
`PNDS_PARTICIPATION.socketOptions` to Socket.IO. Use
`PNDS_PARTICIPATION.storageKey(key)` for stable Host/project data, rather than a
performance ID. This namespace prevents accidental mixing, not origin-level
security isolation. Blank reports page preparation after accepted identity and persisted browser claim;
stronger piece-specific resource requirements remain your responsibility.
Standalone addresses retain their original behavior without Host confirmation.

## Default performer identities

`players/policy.js` wraps `modules/pnds-players/protocol.js`; `public/performer.js`
loads its shared connector from the bounded `/pnds-players.js` route. The page
exposes `PNDS_PLAYER` (`identity.id`, `sendControls`, `sendAction`, `onChange`).
Server callbacks `onControl`, `onAction`, `onRelease` and `snapshot` in `server.js`
are the real work wiring points. The policy checks the current connection owner
before every effective callback; keep these gates when extending the work.
The monitor is an observer and has no performer admission handler.

Only claim → random performer UUID mappings are durably stored at
`.pnds-creation/players.json`. Controls, contacts, score selection and sound state
are separate per-run work state. Corrupt, foreign-project, linked or non-private
registries and persistence failures are errors, never a successful recovery.
The private directory is excluded from Git, source tools/fingerprints and default
project bundles. Copying the complete folder including hidden data carries its
claims; ordinary project distribution starts a new identity registry.

Claims use the confirmed Host/project storage scope and never a performance ID.
Standalone keys use the manifest project ID. A native test-window label adds an
independent suffix, so test windows on one Mac are not merged. Storage rejection
shows a page error and does not report successful preparation. A new performance
still requires explicit entry; logical takeover never transfers camera or
microphone ownership. Verify real device/browser behavior separately.

## Monitor view declarations

Monitor view synchronization is included and wired. `public/monitor-view.json`
starts as `{}`: the server does not create `/monitor-view` and the page does not
open its extra socket. Declare only actual low-frequency work view choices, for
example:

```json
{
  "displayMode": { "default": "score", "values": ["score", "details"] },
  "detailLevel": { "default": 1, "min": 0, "max": 5 }
}
```

Each field requires `default`; its JSON type is enforced. Optional `values`
restrict choices; numeric `min`/`max` bound numbers. Invalid declarations fail
startup. Edit the declaration and restart the project; saved changes do not
silently replace the running schema. `lib/monitor-view.js` validates updates and
wires the frozen module in `modules/pnds-monitor-state/` only when needed.
The monitor's `/__pnds/monitor-view.json` returns that run's actual declarations.

In `public/monitor.js`, subscribe to `window.PNDSMonitorView.onViewState(state =>
{ /* render state */ })`. State is null while waiting for a fresh snapshot.
`PNDSMonitorView.setViewState('displayMode', 'details')` reports a choice; render
only from the server's resulting complete snapshot. `viewState` reads and each
subscriber receive independent copies. `error` exposes rejected updates or
configuration-loading errors. Late copies, reloads and reconnects converge on
the current run's state; stopping and reopening starts from declared defaults.
Page release closes only its own view socket. The ordinary monitor connection
remains an observer and never becomes a performer.

Do not put score time, high-frequency performance input, sound, claims, App QR
visibility or projection-start state in this channel. App QR belongs to the
Host. The frozen generic module README's historical `showQr` example describes
older custom projects, not this Blank's App QR or projection controls. This
default is already present in the resource catalog; do not add it again or
create a pending wiring/handoff task. Author changes remain project-owned.

## Default performer input

Blank already wires `public/pnds-input.js` to the admitted `PNDS_PLAYER` on
`<main>`. Edit this surface and the piece's feedback; do not add p5/ml5 or an
optional input module. Mouse means one contact; touch hardware can provide
several independent contacts. Pointer-capable pages consume only pointer events,
including the App's mouse test path; native simulated/compatibility touch cannot
enter the work twice. Older touch-only pages use changedTouches with a normal
single-mouse fallback, suppressing compatibility mouse after touch. Native form
controls retain their own behavior.

Each gesture has an opaque ID and start/move/end/cancel phases. Coordinates are
relative x/y and normalized nx/ny with width/height measured at each event, so
resize, orientation, zoom and fullscreen do not keep stale bounds. The technical
limit is 64 concurrent contacts per performer. Blur, hidden documents, capture
loss, disconnect and explicit close cancel only owned gestures; a terminal event
can reuse its last valid geometry after a surface collapses. Old terminals do
not cancel a successor. `PNDS_INPUT.close()` releases input without closing the
player; page release closes both. No held input is queued for reconnection.

`server.js` calls `performance.prepareInput(identity.id, payload)` after current
claim-owner validation, then `performance.applyEvent(identity.id, event)` from
`performance/state.js`. This is the common work application entry. Keep new
visual or audio mappings here and update their state/release semantics together.
Accepted contacts live in the actual per-run state, separate from durable
identities, score selection, recording time and audio channels. `release(id)`
clears that source. `snapshot()` returns detached
`{ performers: [{ id, contacts: [{ id, pointerType, x, y, width, height, nx, ny }] }] }`.
The existing performer/monitor Socket.IO connections publish full snapshots on
`pnds:performance`, including on initial connection; monitor-view is exclusively
for low-frequency view settings. For an explicit author feedback task, a monitor
can render these accepted contacts with `socket.on('pnds:performance', render)`.
Blank ships the input/state wiring without an example artwork or sound preset.

Validate the edited real project and its observable feedback. Controlled DOM
pointer/TouchEvent cases prove the data path, not physical multi-finger hardware,
phone behavior or heard sound; record those acceptance results separately.

## Default performance recording

The bottom-bar Performance recordings control already records accepted Blank
contacts, replays them, adds passes and rerecords a whole pass. Do not add a
recording module. `pnds.recording.json`, `performance/recording.js` and the
shipped `recording/adapter.cjs` are actual default wiring. App owns recording
storage, pass management and the common-time driver; the project owns all
meaningful state and effects. Existing custom adapters are not replaced.

Live input goes through current-owner and contact validation, then capture and
the same `applyEvent` used by replay. Replay bypasses capture. A successful
ordinary Record stop preserves live held input. Overdub preserves those real
held contacts and seeds their starts at the new pass's 0ms; a reused device has
an independent recorded source in each pass. Replay restoration filters initial
held input by the native replay performer membership, so rerecording or deleting
a pass cannot resurrect its old touches. The default contains no artistic
selection, score transport, timbre or musical voices.

When adding real state, visuals, sound or new actions, extend the closed loop in
this same task. `snapshot()` must return actual work state alongside contacts;
keep `snapshotInput()` as the pure contact snapshot used for ownership cleanup.
The editable performance object can provide these synchronous work callbacks:

| Callback                                              | Actual responsibility                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restoreWork(state, members, context)`                | Release/restore composition and choices using allowed recorded members; `context.liveIds` and `context.currentState` identify genuine retained live state. Held input is reapplied through the shared business entry afterwards.                                                                     |
| `applyWork(event)`                                    | Apply the real input/action/conductor effect. `sourceId` is the effective live or namespaced replay source; `performerId` is separate recording metadata; `atMs` is null for live work and recording-relative during replay. Treat join/selection metadata as facts, not duplicate musical triggers. |
| `releaseWork()`                                       | Idempotently release all work-owned effects/resources, including a partial restore.                                                                                                                                                                                                                  |
| `advanceWork(elapsedMs)`                              | Advance actual time-dependent work state, preserving pause/seek and the difference between score position and recording elapsed time. Add it only when real progression exists.                                                                                                                      |
| `prepareAction(payload)`, `prepareConductor(payload)` | Validate and normalize the work's real discrete actions and common conducting, or return null.                                                                                                                                                                                                       |
| `selectionFor(sourceId)`                              | Report the work's actual independent selection, if any; never infer it from a device/window number.                                                                                                                                                                                                  |

Incomplete work callbacks fail explicitly. Keep callbacks synchronous; future
asynchronous application needs its own ownership/serialization design. A
capability declaration or an empty callback does not prove arbitrary new music
can replay. Check actual live/replay/overdub/rerecord effects after extending
these callbacks. The existing `pnds:conduct` monitor handler gates common
conducting at the effective server entry; admitted performer actions still work
in overdub. No default conductor command is invented.

Pure replay blocks new page contacts, with admission enforced by the server.
Connection/identity loss still cancels owned input; mode notices only change
`PNDS_INPUT.setStartsAllowed(...)` and never clear a later gesture globally.
Playback restore and true release report only the live performer/gesture IDs
actually cleared; `PNDS_INPUT.cancel(ids)` cannot cancel a successor if old
playback/end notices arrive after a new recording has already accepted it. Mode notifications
are sent only when facts change. An application fault, including Stop before
the next poll, preserves incomplete recovery data and the prior complete record.
Failed cleanup retries only that operation's owned release; normal recording
stop does not restart or reset the work. Physical sound and real touch hardware
still need their own acceptance evidence.
