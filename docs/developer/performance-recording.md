# Performance recording and replay (#257)

The 2026-11-04 [debugging and product discussion](../plans/2026-11-04-performance-recording-debug.md)
confirms multi-performer recording passes, list/detail management and whole-pass
replacement ([ADR-0016](../adr/0016-recording-pass-as-management-unit.md)).
Native audible acceptance remains separate from automated verification.

The main shell owns one native `RecordingManager`. Its common-time driver
survives a collapsed panel, hidden window and a mode change retaining the run.
Session Start/Stop saves the current pass before retiring that runtime.
The musical driver retains its 20 ms step; UI revisions/emissions change only for
status, support, errors, operation identity or a whole elapsed second. Reading a
snapshot does not manufacture revisions, and idle polling emits no new status.
Native Quit saves before `app.exit`; the ExitRequested fallback prevents exit and
shows a localized native error if recording publication fails, including when no
main WebView remains. Ordinary window hiding does not finish a pass. Generation
loss or adapter failure publishes an error and preserves incomplete checkpoints.
Main-window guards exclude score WebViews. Overdub/rerecord additionally require
the native creation workspace identity to match the running physical project.
A session-held target guard serializes begin against runtime replacement. The
late external exit path does not recreate an already destroyed main window; its
native error and durable incomplete data remain the recovery evidence.

## Adaptation

Root `pnds.recording.json` declares `{"protocolVersion":1,"adapterId":"my-score-v1"}`.
The performer server must implement loopback-only `GET/POST /__pnds/recording`;
GET returns that exact capability. The shared helper lives at
`recording/adapter.cjs` in adapted projects. New Blank generation includes its
helper and real project-side wiring by default; opening or running an existing
project never retrofits or replaces its adapter. III and Runes retain their own
actual snapshot/restore/apply/release integration and source bytes.
It rejects remote sockets, non-loopback Host headers and browser Origin headers.
Managed entry proxies must reject the reserved management path before forwarding.

POST actions all carry a fresh `operationId`:

- `begin`: mode `record`, `playback` or `overdub`; replay also supplies opaque
  `initialState` and separate `replayPerformers`. Recording and overdub supply
  `livePassId`, acknowledged by matching `passId` in the begin response; missing
  acknowledgment refuses pass recording rather than reverting to one source.
  Recording snapshots the current state without START/reset. Replay restores
  actual composition and controls. Rerecord excludes every performer of its
  explicit target pass from replay, including their held initial-state touches,
  and keeps the pass position in the merged record.
- `poll`: `afterSequence` returns every later accepted live event, performer
  metadata and `elapsedMs`. Events are retained for the operation, never sampled
  or coalesced. Each has integer `atMs` (1 ms precision), unique `sequence`,
  nullable `performerId`, opaque `kind` and `payload`. Null performer is common
  conducting. The common clock includes waiting, pauses and disconnection.
- `drive`: `elapsedMs` and due events, ordered by `(atMs, sequence)`. The native
  monotonic driver runs about every 20 ms, independent of WebView timers.
  Sequence IDs are unique across merged passes and need not increase across
  different times. Projects apply replay without recapture, correct progression
  to common time and lock manual conducting at effective server handlers.
- `end`: `afterSequence`, `elapsedMs`, `release`. Ordinary recording uses false
  to leave live music running. Replay/overdub release their managed sources;
  overdub captures a terminal release for each live source at its early/fixed boundary for future
  playback. Same-operation end is idempotent; stale IDs cannot control another.
  An inactive end also revokes its operation ID, preventing a delayed begin from
  acquiring authority after cancellation.

Native begin registers provisional operation ownership before sending the request.
A lost or invalid response triggers end; unacknowledged cleanup remains owned and
retryable through Stop, while another begin stays blocked. A confirmed same-run
Session teardown is a separate authority: only the owner of the real Node/audio
children can mint a retirement proof after reaping them and confirming cleanup.
That proof checkpoints incomplete data, retains the error and releases native
recording ownership without publishing a completed pass. HTTP failure or a
generation mismatch alone cannot mint it. Uncertain teardown retains the pending
run IDs, actual supervised child handles and Host-entry objects for a targeted
retry; a later successful cleanup can mint the same proof without guessing from
an HTTP error, PID lookup or orphan-registry read. Session start/stop and Quit reconcile
these proofs; supervisor-detected death also reconciles immediately. Explicit
Session Stop/replacement/Quit still tears down its owned run after a failed save,
returns the save failure and retains incomplete data. Record-panel Stop preserves
live music for a healthy ordinary recording; a fault requires actual cleanup.
Unconfirmed initial state is never published as a complete record. A failed confirmed pass retains
only incomplete recovery data, and cleanup retries cannot publish it later.

The catalog uses the running project first, then an active Creation workspace,
then the Host card selection, so inactive Creation projects can open/export records.

Pure replay admits no live musical source. An overdub pass admits every
project-accepted live source, including arrivals after begin. Each has an
independent recorded ID for this pass and retains the project's reconnect
identity within it. Reusing a physical device in another pass creates another
recorded source. Selection remains in the work's page; no device picker or
readiness gate is added, and the App never chooses score numbers. The old helper
request `livePerformerId` remains a compatibility path for older controllers;
the App's new pass controls always use `livePassId`.

III keeps its exclusive musical slots: live sources must not reclaim a slot
owned by retained replay. Its performer page provides a manual number-change
entry. Runes permits independent live/replay sources sharing the same number.
Neither policy can be inferred from an App virtual-window display number.

## Blank foundation and authored work (#320)

New Blank includes `pnds.recording.json`, the shared helper and
`performance/recording.js`. It uses the existing App record controls, native
common-time driver and project recording store; there is no selectable recording
module or extra adoption/handoff task. Existing projects, III and Runes keep
their authored adapters. The default Blank work supports actual accepted contact
state and its restoration/release. It supplies no composition, voice, score
transport or artistic audio mapping, and does not claim that arbitrary later
work code is already replayable.

Player policy first verifies current claim ownership. The recording wrapper
checks source admission and calls the side-effect-free `prepareInput`; only an
accepted canonical event is captured, then applied through the same
`applyEvent` used by replay. Replay supplies a separate `replay:<recorded-id>`
source and never recaptures the applied event. `pnds:performance` publishes the
actual work state on both role servers. Persistent performer UUID, socket,
recorded pass performer, work selection and audio output remain separate facts.
Same-claim reconnection retains the source inside a pass; another overdub or
rerecord pass receives fresh recorded performer IDs.

The contact snapshot retains every held gesture. Restoration filters it against
native `replayPerformers` before rebuilding contacts through real `start` input.
Deleting or rerecording a pass can therefore leave the opaque initial snapshot
intact without restoring that removed pass's held input. An ordinary healthy
Record stop uses `release:false`, preserving actual live fingers and effects.
When the next overdub/rerecord begins, the wrapper separately captures true
current live sources before clearing old replay state, restores retained replay
and those live contacts, then seeds only the live contacts into the new pass.
An already held finger can keep moving without a missing start; retained replay
is never mistaken for another live source.

The shared factory's optional `seed(sourceId)` returns an array of
`{kind,payload}` events. For pass-based overdub it runs after restore, beside the
online source's join capture, while the helper explicitly captures at `0 ms`.
The seed's pass-mapped performer ID and sequence precede its following move,
even when restore advances the actual monotonic clock before the helper resets
its begin clock. Omitting the hook preserves the prior no-seed path. This
addition does not replace the helper files already maintained by III or Runes.

### Extending the actual work

An author or assistant adding input, state, drawing or sound must extend the
whole work path in the same approved edit task, then validate its real effects.
Copying a helper or keeping the capability declaration is not that validation.
Keep the current full `snapshot()` meaningful and include the actual work state;
preserve `snapshotInput()` as the separate pure contact snapshot used to identify
cleanup targets even if richer authored snapshot code fails.

| Work interface                                                        | Required behavior                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applyWork(event)`                                                    | Apply real input, action or conducting effects. The event separates `sourceId`, recorded `performerId`, `kind`, `payload` and time: live events use `atMs:null`, replay supplies recorded milliseconds. `join`/`selection` metadata updates membership/selection without triggering the musical action twice. |
| `restoreWork(initialState, replayPerformers, {liveIds,currentState})` | Restore actual composition/control state, filtering replay membership. Retain only the explicitly supplied true live state needed for overdub; reconstruct held effects through the input path rather than restoring removed pass voices.                                                                     |
| `releaseWork()`                                                       | Release actual voices, timers and other work-owned effects. A failure is an error requiring cleanup retry, not evidence that resources were released.                                                                                                                                                         |
| `advanceWork(elapsedMs)`                                              | When the work progresses with time, implement actual progression from recorded play/pause/seek anchors. Recording elapsed includes waiting and pauses and must not be assigned directly to score position. Time-independent contacts need no pretend musical clock callback.                                  |
| `prepareAction(payload)` / `prepareConductor(payload)`                | Validate and normalize an action before capture; return no event for rejected data. Performer actions retain source admission, while shared conducting uses the effective monitor gate.                                                                                                                       |
| `selectionFor(sourceId)`                                              | Return the work's actual independent selection or `null`; do not derive it from a socket, device, test-window number or recorded source ID.                                                                                                                                                                   |

Install `applyWork`, `restoreWork` and `releaseWork` together; a partially supplied
set is rejected. These project hooks run synchronously. Adding asynchronous
resource work requires its own explicit completion and failure handling; the
management-command queue does not serialize arbitrary asynchronous work against
Socket.IO input. The optional callbacks extend the real contact application,
not an alternate simplified work used only by tests.

The monitor's actual `pnds:conduct` handler calls `recording.conduct`, which
validates through `prepareConductor`, enforces `conductorAllowed`, captures the
common event with no performer and applies the real work. Pure playback and
overdub/rerecord reject manual common conducting there. Identity-owned performer
actions use their own admission/capture/application path and remain available to
admitted overdub sources. A hidden or disabled UI button is not the gate.

### Work data versions and existing recordings

The shared `creator-project-conventions.md` reaches both the built-in project
assistant and newly generated Blank AGENTS files. Recording-related changes
must preserve needed input plus actual random/semantic choices, version
work-owned data, keep original recordings, define older-field defaults or
bounded inference, and verify existing-record playback. The bilingual Blank
implementation guide carries the detailed procedure; this policy adds no
piece-specific geometry, migration engine or new recording protocol.

Default contact validation rejects whole payloads with unknown fields. Authors
extend `prepareInput`, shared application and snapshots together, or capture
validated authored actions through `prepareAction`. Version authored work
snapshots/events separately from the App container and adapter protocol. Restore
detached data through `restoreWork` and the common business entry, retaining
saved random choices or repeatable seed/state. Record explicit inference limits
and test existing plus new recording, overdub and rerecord effects; use a minimal
older-version fixture when no existing recording is available.
The adapter captures its work snapshot at begin. Choices made later must be
captured as events when made or derived deterministically from restored seed/state;
adding a later random value only to `snapshot()` does not record that decision.

### Cleanup, faults and page input

The wrapper reports captured work-application errors with the shared helper's
`reportFault(error)`; its `fault` getter stops further live business input while
the operation needs cleanup. Replay apply/advance failures and the event limit
also fault the active operation. A Stop arriving before the next poll must not
turn a faulted pass into a completed recording. If cleanup succeeds before the
fault has been reported to the controller, the helper releases actual resources,
caches the same-operation cleanup response, then reports the error. The native
manager retains incomplete recovery data and requests end again on that same ID;
that request only acknowledges the completed cleanup and never releases twice
or publishes the failed pass.

If release itself throws, the helper retains the active operation until a
same-operation retry actually succeeds; failed begin/restore cleanup follows the
same rule. The Blank wrapper attempts all known contact cleanup even if a work
callback or richer snapshot fails, and server shutdown releases work/replay
resources before closing its owned audio. A healthy ordinary recording end with
`release:false` does not clear live work. Stale IDs cannot drive or release a new
operation. These error-then-cleanup acknowledgments depend on the existing single
native `RecordingManager` serializing its operation, not independent competing
management clients.

Mode/cleanup notifications are emitted only when mode or cleanup epoch changes,
not on every native poll/drive. Pure playback suppresses new local starts;
current server admission remains authoritative. Connection/identity loss still
cancels owned input, but a mode notice never globally clears current gestures.
Playback restore and completed/failed releases identify the actual released live
performer and gesture IDs; the page cancels only matching contacts. Pending IDs
survive a failed restore's subsequent cleanup. Even FIFO-delayed old playback,
end and new-record notices therefore cannot cancel a successor gesture or add
that cancel to the new pass. Ordinary Record stop leaves its held input available
for the next live pass. Reconnecting pages receive the
current mode snapshot; losing transport does not itself replace the document or
its existing recovery connector.

The public integration seam is creation/open/save of a real Blank, real
Node/Socket.IO sources and monitor effects, and existing
`RecordingManager.begin/advance/stop` plus project storage. An authored test work
adds actual gain, selection and play/pause/seek behavior through public saved
source; only the monotonic clock is injected. This proves the exercised business
path rather than endpoint status alone. Final combined App completion still
requires `npm run check:all`; physical listening, phone multitouch and signed
native/device acceptance remain separate results.

## List and pass management

The popover opens to the project recording list. New recording creates a new
record; entering a record shows replay, overdub and its passes. A pass may contain
one or several performers. The UI names passes instead of requiring users to
track performer IDs. Return-to-list and popover dismissal keep the native
operation alive; native snapshot `projectPath` and `recordId` associate it with
its project and detail view. Arrival order of events and initial status replies
must not infer ownership from whichever project the UI currently shows.

Stopping/completing saves automatically. List export writes an independent file;
it is not the save operation. Deleting a record removes it from the catalog;
deleting a pass removes all its performer membership and events while retaining
other passes, common composition/conducting and fixed duration. Deleting the last
pass leaves an empty record that accepts a later overdub. An active record and
its passes cannot be deleted, enforced under the native operation lock.
Early rerecord saves an empty tail instead of reconnecting old participants.
Discard or failed publication leaves the prior complete record intact.

## Storage and compatibility

Editable folder projects keep recordings in
`<project>/.pnds-creation/recordings/` in both Creation and Performance modes.
Renaming, moving or copying the complete stopped project carries its recordings;
subsequent changes affect only that physical copy. Symlink aliases of the same
actual project share one store. Installed `.pnds` projects and built-in utilities
retain App data `recordings/<sha256(canonical-project-directory)>/`, because
reinstallation can replace their managed directories. Read-only folders can read,
play and export carried local recordings; writes fail explicitly rather than
silently selecting a different store. The recording panel can reveal the actual
recording directory in Finder.

The native storage module opens validated project roots and holds no-follow
directory descriptors for record reads, atomic publication and deletion. The
frontend never supplies a storage destination inside a project. Each active
operation retains its original store across panel dismissal and mode changes;
replacing the former project path cannot redirect a save into another project.
Move projects after stopping their run; cross-volume moves during recording are
not a supported hot-migration workflow.

On first use, a folder store validates and copies the current canonical path's
legacy App data recordings into a sibling staging directory, retaining record
IDs, unfinished checkpoints and schema-1 backup bytes. Only the fully durable
collection and its non-JSON `storage.ready` initialization marker are published.
The old App data files remain intact as backups. Migration failure publishes no
partial collection and preserves the old files. A valid initialized local store
is authoritative even when all recordings have been deleted: opening it never
reimports legacy backups. Invalid local storage reports an error instead of
falling back to old data. A project moved before migration cannot safely locate
its former path hash by name or manifest ID; explicitly open its old `.json` or
`.pndsrecord` files, or reopen it once at its original location before moving.

The private directory, including symlink aliases, stays outside source
fingerprints, ordinary project file tools, Git versions and default `.pnds`
bundles. A complete filesystem copy including hidden files carries recordings;
Git clone and default project packing do not. Switching project versions preserves
the private recording collection. Storage location is separate from the current
run's physical identity and the record's original/interpreting provenance.

Schema-2 `.json` records and
`pending-<operation>.json` checkpoints contain initial state, independent
performers, effective events, fixed first-pass duration, completion state,
original source and interpreting source. `passes` stores each pass's `id`,
`performerIds` and `legacy` flag. Each performer belongs to exactly one pass;
pass IDs and membership are unique, while common-conductor events have no
performer or pass ownership. Independent `.pndsrecord` files use
the same bounded JSON, carry no runtime grant or required absolute project path,
and are imported/exported explicitly. The Open recording picker also accepts
legacy `.json` files without a manual extension change. Import validates first, assigns a new local
ID and never overwrites an existing record. Protocol mismatch is refused.
Ordinary Play from start directly uses the currently running compatible work,
including changed content, without a source-change confirmation. Overdub and
rerecord still require explicit changed-content consent before adding or
replacing a pass.
Both original and interpreting adapter contracts must match protocol 1 and each
other; changed-content consent cannot bypass a foreign interpreting contract.

Schema-1 records normalize read-only to one `legacy` pass containing all their
performers; the original pass boundaries cannot be inferred. Before mutation,
original bytes are durably retained in `legacy/<record-id>.json`, outside the
catalog scan. Successful rerecord clears the target pass's legacy flag. Import
keeps the external source untouched and assigns a new local record ID. Deleting
a pending recovery entry removes its own operation file, never its completed
base record. An active operation guards both its record ID and pending-file ID.

Content fingerprints are captured before Node starts and rechecked after project
health/audio startup completes. A change or unreadable source during that window
revokes recording capability for this run without blocking ordinary operation.
This brackets source loading; it is not a Node loader attestation or a snapshot
filesystem and cannot detect an external edit that is undone between scans.
After ready the applied source remains fixed; later disk edits do not silently
replace it. Restarting applies changed saved content. Ordinary playback uses
that compatible running source directly and leaves original recording bytes and
provenance unchanged; adding or replacing a pass retains changed-content
consent. Fingerprints cover sorted project
source (including linked source content) and dependency declarations. `.git`, installed `node_modules`, private creator
data, build output and Finder metadata are excluded. Shared installed libraries
remain governed by their existing verified-library contract. Original provenance
is retained when a later pass uses changed compatible content.

The complete tree fingerprint uses the existing `ring` SHA-256 implementation.
Keep its sorted path/type/length framing, included file bytes, lowercase hex and
`sha256:` prefix unchanged: switching implementations must not mark an existing
record's source as changed. Debug-profile Rust SHA compression previously made
each 175 MiB Runes scan take about 6.9 seconds; both launch scans are on the
readiness path. The equivalent `ring` scan took about 0.07–0.11 seconds on the
same Mac (0.08–0.16 seconds when re-extracted from the final production function).
Do not omit documentation/resources, reuse unchecked metadata or remove
the post-start verification to hide this cost. A pinned public `launch_source`
fixture checks the existing digest, UTF-8 paths, directory markers, chunk
boundaries, ignored dependencies and same-size resource/document edits; actual
latency is measured separately rather than with a machine-dependent CI deadline.

Successful polling publishes an incomplete checkpoint about once per second;
events since the last durable checkpoint may be lost on interruption. Atomic
publication syncs a temporary file, renames it and syncs the directory. Complete
records are replaced only after a successful pass save. Discard/failure retains
the previous complete record. Remaining durable data stays incomplete and cannot
be played or resumed. Limits: 24 h, 64 MiB/container, 1,024 performers/passes and
1,000,000 events. Creating a new record is how duration/conducting changes.

## Verification

Public native controls exercise the shipped adapter over real HTTP and temporary
storage: source isolation, repeated holds, fixed duration, overdub/rerecord,
discard, failed publication, generation loss, import/export, direct changed-source
playback, strict adapter compatibility and mutation-mode consent. Only the
monotonic clock may be injected. The provenance-stamped actual
Runes fixture in `src-tauri/tests/fixtures/recording-runes` tests App persistence
and replay against its real composition, Socket.IO inputs and effective conductor
handlers. Frozen fixture/adapter bytes keep source formatting and run native
integration checks. Component tests cover bar status, mode controls and panel
dismissal through typed commands. App integration must pass `npm run check:all`.
III/Runes original suites cover their adapters; actual audible three-pass III
distance interaction and Runes random score/same-number release remain user
acceptance in the native App and real audio chain.
