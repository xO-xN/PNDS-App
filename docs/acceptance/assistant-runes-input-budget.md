# Saved-score input budget replay — 2026-10-17

The native GLM log completed five HTTP 200 model turns. The last reported input
was 11,594 tokens; the App then rejected the next local assembly before another
HTTP request. Public configuration remained unknown tokenizer, 1,000,000 manual
capacity, 32,000 input target, 8,192 output and 2,048 safety reserve.

The smallest replay uses the current saved server, performer, complete 21,095-unit
monitor, Pattern and Grid, followed by a server candidate and final reply. The
highest frontend entry produced six packets. Native assembly of the final packet
reported a 16,089-token reference; the former multiplier changed admission to
32,178 and failed at the 32,000 target. Earlier packets fit. No historical chat
was required to reproduce this failure.

Admission now compares the generic token reference directly with the token
target. Selected tokenizers, output/safety reserves and the independent 512 KiB
bound still apply; no user configuration or model capacity was changed.

The stronger replay also fully reads the manifest and generates two controlled
response candidates: schema 2 with the exact p5 2.3.4 reference, and a server
that reads the existing performer HTML from its current `.js` path, embeds a
monitor HTML shell and serves only the named p5/Grid/Pattern/monitor assets.
It still uses six requests. Native assembly/transport through a loopback model
stub succeeds for all six; the largest is 58,517 bytes / 17,240 reference tokens
against the unchanged 32,000 input target.

The frontend acceptance applies those candidates only in a disposable copy,
selects temporary ports and starts Node in None mode. Health becomes ready;
both HTML roots and all four scripts return HTTP 200, scripts carry JavaScript
UTF-8 MIME types and score script bytes match the saved originals. The p5 bytes
come from the App's installed build resource. The source `runes-pnds` is not
written. This checks page/resource wiring and App candidate capability, not
browser rendering, audio output or a live provider's repair quality.

Reproduce from the repository root (start no App dev server):

```sh
PNDS_ASSISTANT_REPLAY_PROJECT='../runes-pnds' \
PNDS_ASSISTANT_REPLAY_PACKETS=/tmp/pnds-runes-input-replay.json \
npm run test:run -- src/lib/assistant-project-replay.test.ts

PNDS_ASSISTANT_REPLAY_PACKETS=/tmp/pnds-runes-input-replay.json \
npm run rust:test -- assistant_project_replay_fits_configured_input -- --ignored --nocapture
```

Packets contain private saved text and stay in the local temporary file; they
contain no credentials and are not checked in. Without the local project option,
the frontend regression uses synthetic code and the bundled Blank server.
The native acceptance is explicitly ignored in ordinary runs because it requires
that local capture; it was run explicitly for this evidence. Live GLM testing
remains a separate real-device acceptance step.

Automatic-context follow-up: legacy settings now default to automatic; the
32,000 target is inactive unless manual limits are explicitly enabled. The same
real-source controlled replay remains a regression for candidate preparation and
runtime routing. A separate highest-flow regression reads 41 pages beyond the
former cumulative limits and verifies a complete-source patch after compaction;
native tests verify legacy/manual interpretation and explicit GLM `1261` recovery.
Live provider/App UI acceptance must still be reported separately from these
controlled replays.

Latest automatic-mode replay: all six native calls pass with `budget=None`; the
largest assembled packet is 58,836 bytes / 17,296 reference tokens. The real-source
frontend replay and disposable Node runtime routing checks pass. Native UI control
still reports no running PNDS window, so no live model run is claimed here.

## Real-device SSE regression — 21:57 local time

The next real GLM run completed 13 turns. Turn 14 returned HTTP 200, then failed
at 119,095 ms with `[model-stream] rejected reason=stream_size_limit limit=1048576`
and `ResponseTooLarge`. The local history retained 34 actual source records and
56,203 tool-result characters. This is direct evidence of the App's cumulative
SSE wire guard, not a single-file proposal rejection or configured input target.
No completed proposal from that generation was published.

A deterministic native regression emits 4,000 small reasoning/metadata events
followed by two small file candidates. The original decoder fails with the same
`ResponseTooLarge`; the corrected decoder passes both 16 KiB network chunks and
a fully coalesced chunk. A full loopback HTTP → SSE → native tool parser regression
also preserves both candidates and usage without publishing reasoning. Large
incomplete single/multiline events and oversized text/arguments still fail.

The current flow already accepts eight distinct file candidates. A store
regression explicitly applies two coordinated candidates in order and verifies
that applying the first does not invalidate the second. The real-score replay
still prepares server + manifest candidates and verifies runtime routes in a
disposable copy. These controlled checks do not claim a completed real-provider
repair after this SSE fix.

Cargo uses the configured external intermediate build cache. Final dev binaries
remain under `src-tauri/target/debug`; the rebuilt binary contains
`event_size_limit` and no longer contains `stream_size_limit`.

## Handoff/edit implementation acceptance (2026-10-17)

The creation chat now defaults to handoff. For the implementation scenario,
select **Edit · implement and save** before sending the original task. The mode
is captured at send time. The assistant can adopt the shipped p5 package, create
the HTML files, wire local routes, save coordinated changes and consume failed
saved-copy checks in the same logical task. The changes disclosure provides
whole-task and per-file undo; project-menu version/history entries are direct.

A native acceptance test uses `PNDS_ASSISTANT_REPLAY_PROJECT` as optional private
input and copies it into a temporary workspace. It reproduces the missing-page
failure, adopts the actual verified local p5 package, creates performer/monitor
HTML, updates server routes, runs real embedded Node/health/HTTP checks, then
undoes all four recorded files and compares original contents. The source score
is never changed. Browser-kind p5 uses `PNDS_SHARED_LIBRARIES.p5.path`;
`browserPath` is an optional additional distribution and is absent for p5. The
older controlled-model replay fixture now follows that actual contract too.

The native temporary-copy acceptance passed. This validates the native file and
runtime services, not live provider behavior or the work's visual/musical output.
Desktop checks additionally use isolated WebKit page observations. Script,
resource, Promise and console failure collection is tested by executing the
injected observation source, and a native test proves observer failure propagates
while the server is alive and still cleans the owned process. Real App/provider
and work-specific visual behavior remain part of the creator's dev testing.

## Live edit follow-up (2026-10-17)

The creator's real GLM run made 19 completed model turns and saved manifest/p5
adoption plus server routes and inline HTML. The journal contains those two
files. The new HTML paths were repeatedly refused by the complete-replacement
path; exact failed arguments were not persisted, so their original field values
are not asserted here. The protocol now separates creation from existing-file
replacement and returns actionable creation/version refusal reasons. Tests also
cover explicit null optional fields at the read-coverage gate.

The live check then reported notification permission denial. Executing the
actual installed notification-plugin script reproduced an automatic permission
query in check windows. Its scoped bootstrap now skips those windows while
retaining Host plugin behavior and native permission boundaries. Project script
errors are still reported.

The terminal transport result was HTTP 200 with `finish_reason:length` on model
turn 20, not an App task deadline or network timeout. The configured output
allowance was 8192; no configuration is silently raised. Completed file writes
remain recoverable. This acceptance separates the real run evidence from the
controlled regression and temporary-copy runtime checks.

## Output truncation before creation (2026-10-18)

After undo to `starting point`, the next real GLM run completed 15 turns and
returned HTTP 200 with `finish_reason:length` on turn 16. Only the native p5
manifest adoption had been saved; no HTML creation or runtime check had run.
There was therefore no new-file refusal or notification-check result in this
run. The output allowance remained 8192. The last completed turn reported
5733 output tokens, including 5579 reasoning tokens; final truncated usage was
unavailable. No input-budget or App elapsed-time rejection was observed.

A regression reproduced the App ending this task on typed `outputTruncated`
after local adoption. Edit now attempts up to two in-task continuations with a
single-small-action policy, preserving saved steps and discarding incomplete
generations. Tests cover exactly-once adoption/creation, bounded repeated
truncation, retained manual checkpoints, and cancellation before another paid
turn. This proves orchestration behavior under the observed error; a real
provider completion of the original task remains to be tested.

## Completed repair, lost continuation and repeated checks (2026-10-18)

The creator confirmed the next real edit run met the original runtime goal.
The interrupted repair saved `server.js`, `public/monitor.html.js` and
`public/performer.html`. However, its chat was recorded cancelled; after the
creator sent `继续`, a new native task implemented the unrelated pending README
handoff and marked it done. Replaying the actual context selector confirmed the
cancelled objective was excluded. Logs do not identify who/what initiated the
cancellation.

Between 00:05 and 00:29 Shanghai time, 25 completed model calls consumed about
1189 seconds; seven local check stages occupied about 9–10 seconds each. The
reply repeatedly announced discovery/checking. Completed usage reported 51074
output tokens, including 48478 reasoning tokens. Cumulative tool results were
2122419 characters. A final generation reached `finish_reason:length` and the
bounded automatic recovery started before cancellation.

Regressions now cover explicit pause + typed continuation in the same message
pair, saving through a complete tool boundary without replay, hard cancellation
while pausing, the pinned user goal/handoff reference policy, and compact check
results with native freshness reuse and write/change invalidation. A report
fixture with 3000 dependency inputs reproduced the old 240227-character model
packet; inventories now stay in the full App report. These controlled tests do
not establish real-provider latency or task-boundary compliance; the creator's
next App run remains the acceptance for those behaviors.

## Static checks, edit controls and saved resources (2026-10-18)

The next font-size edit saved the requested outline/size, but runtime validation
was refused because the creator's project was already running. The model
repeated the request and no parameter card appeared: explicit edit tools had
excluded the legacy proposal surface without providing a saved-parameter
publication tool. The project also kept HTML in `monitor.html.js`, duplicated
`performer.html` as `performer.js`, and served startup-cached page bytes.

Edit now separates saved-file static diagnostics from exclusive runtime checks,
retains occupied-runtime evidence, and publishes native-bound saved parameter
cards. It can install the shipped local adapter and complete project wiring.
Declared parameters in changed task files also get controls at final completion.
Parameter saves reuse task recovery; obsolete-file removal is version guarded,
recoverable after reopen, and refuses recreated creator content on undo. The
file list separates HTML entries, scripts and styles. Blank's HTTP regression
reproduced stale HTML before the fix and now sees saved page bytes plus new JS
routes without restarting Node.

The authorized runes cleanup extracted `monitor.html` and `monitor.css`, removed
the duplicate performer HTML/script and unused Grid script, and preserved the
creator's outline font and size 0.34. A local preview declaration and the shipped
adapter bind actual mutable size/color variables. Its server reads public files
per request, serves MIME/no-store, and pins monitor source bytes at a local
digest URL with the same snapshot's source/contract digests in the HTML.
Original files were backed up privately before this cleanup.

A temporary copy ran the real score Node server in None mode on independent
random ports. HTTP checks verified both pages and local p5/Pattern/CSS/adapter
routes, saved script adoption without a restart, exact loaded-byte pinning
across a simultaneous disk edit, new digest on refresh, and escaping-link
refusal. The actual runes source and shipped adapter then executed together in
an isolated JavaScript realm. Valid hello/set/restore messages changed and read
back the real size/color variables; the production background-number drawing
function received size 51.2 at scale 0.2 and restored size 87.04 at scale 0.34.
Drawing primitives were observed stubs, so this establishes callback/digest
behavior, not native WebKit visual quality. The creator's live process was not
stopped or restarted. The next real App/provider run remains the acceptance for
end-to-end task selection, native visual feedback and performance latency.

## Reply activity, continuous faders and tool argument repair (2026-10-18)

The latest animation-size task made 21 model calls over about eight minutes.
Its completed reply concatenated tool-turn commentary with the final answer.
Much of that visible commentary described correcting parameter publication
arguments, including using the declaration path in place of the saved script
path. Independent provider reasoning content is already discarded by transport;
this observation concerns ordinary assistant content from intermediate turns.

Two red-capable regressions reproduced the symptoms: final text included the
tool-turn process sentence, and a fader became disabled during the redundant
native bind triggered by temporary preview. New replies now keep completed
tool-turn prose and provisional output in a collapsed Work log, while completion
shows only the final answer. Continuation retains display activity separately
from authoritative wire evidence. Schema 4 round-trips bounded activity and
loads old snapshots without guessing their original text boundaries.

Control changes reuse their just-verified binding for preview, preserving a
continuous mouse gesture. Tests advance values while validation is pending and
verify the final candidate/binding without any disk write or model request.
Existing native source/runtime authorization and restoration remain in place.

Parameter publication now detects a source/spec path mismatch before binding,
returns the named source paths and an actionable correction, and merges separate
publications for the same saved file. This also fixes later calls replacing
earlier controls. Final auto-publication fills any missing declared parameters.
The response policy requests short factual progress and a concise final result,
and directs creators to Save parameters rather than another model turn.

These checks establish presentation, orchestration and input-state behavior.
The creator's restarted dev App remains the acceptance for native WebKit mouse
dragging and real-provider improvements in task duration and argument selection.

## Harness contracts and restart continuation (2026-10-18)

The approved architecture follow-up keeps Tauri, React and Rust. All sixteen
model-facing tools now share one schema/mode/handler manifest between native
provider declarations and frontend dispatch validation. Refusals preserve native
error identity and provide argument, draft or version repair guidance without
double-encoded errors. Successful source evidence and current control cards keep
their separate authority and presentation paths.

Seven deterministic runes-task replays cover independent performer sizes, a
corrected publication path, saved outline edits, occupied runtime, large-context
organization, restart at saved/check boundaries, and crash after native write
before the tool reply. They assert actual candidate drawing values, one saved
write, relevant check counts, complete protocol pairs and rejection of unrelated
disk changes. Store integration covers explicit Continue, retained original
goal/mode/message IDs, missing chat publication, fresh control cards, model
configuration mismatch, cancel/delete/clear and quit/workspace retention.

Private task checkpoints are separate from display history and never restore a
live grant. Native records validate canonical directory/inode and journal bytes.
Completed native check receipts allow full source/shared-input freshness checks
after restart; missing evidence and changed assets/packages trigger fresh checks.
Runtime occupancy from an old external lease is not assumed current.

The current real-score opt-in replay reads ten existing files (including the
current HTML/JS/CSS layout), adjusts the actual declared `pointNumberScale` in a
disposable in-memory saved copy, pauses, serializes/reloads, and publishes all six
actual declared controls. It verifies one write, one occupied-runtime static
result and unchanged SHA-256 for all ten original files. It starts no source
project process and commits none of its private bytes.

```sh
PNDS_HARNESS_REPLAY_PROJECT='../runes-pnds' \
npm run test:run -- src/lib/assistant-runes-current.test.ts
```

This current-layout acceptance replaces the old local-source replay's removed
`performer.js`/`Grid.js` assumptions for present-day runes testing; the older
synthetic regression remains useful for its original budget case. These are
controlled model/native-adapter replays plus native journal/freshness tests.
They do not measure a live provider's semantic quality, real task latency or
native WebKit dragging. Restart the dev App for the new commands before the next
real-provider test.
