# Creation assistant

The document assistant's single request entry is `runAssistantRequest` in
`src/lib/assistant-flow.ts`. `assistant-store.ts` owns the workspace draft,
transcript, progress and request generation. Components dispatch paid work through that store and use the shared assembler
for local-only previews; they start no separate model request chain.

## Reply and work-log presentation

Tool-turn commentary and provisional streamed text are display activity under a
closed-by-default Work log disclosure. The completed main reply contains only
the final answer. A pending task keeps a brief visible status; failed/cancelled
partial prose remains in the disclosure. DeepSeek `reasoning_content` is retained
separately for internal protocol replay and never stored as this activity;
other provider profiles continue discarding it. Old histories with
already concatenated reply text retain that text; the App does not guess its
boundaries. Source actions and model-authored-link restrictions remain unchanged.

The flow keeps completed commentary in its request checkpoint so pausing or
retrying preserves the same goal, tool evidence and display log without repeating
it in the final reply. Activity is bounded to 128 entries, 4096 Unicode code
points per entry and 16384 UTF-16 units overall, dropping oldest display entries
when needed. Authoritative tool messages/receipts are independent. The activity
field is not included in later model history or user-reviewed summaries.
Normal reply policy asks for short factual progress at tool boundaries and a
concise final outcome, relevant verification/blocker, and use of existing Save
parameters controls. It does not change the service's reasoning configuration.

## Shared tool contracts and durable task continuation (2026-10-18)

`src-tauri/resources/assistant-tools.json` is the single model-tool contract:
names, mode availability, parameter schemas, handler and effect categories.
Rust builds provider declarations from it; `assistant-tool-contracts.ts` validates
the same declared JSON Schema subset before dispatch. A malformed argument,
unknown field or unavailable tool produces a bounded corrective refusal without
executing an operation. Invalid installed-document references are also tool
refusals. Native project admission, draft conflicts, saved versions and write
grants remain independently enforced. Nullable optional parameter fields preserve
the Rust `Option` semantics. A regression rejects unsupported manifest keywords
so declaration/validator drift cannot silently relax validation.

`assistant-resume.ts` serializes completed boundaries without reader instances,
callbacks, runtime grants, credentials or incomplete model responses. A separate
private schema-1 record under `assistant-resume/` stores the original goal,
captured mode, message/chat IDs, locale, model configuration key and checkpoint.
It is keyed by canonical directory plus inode and atomically published through
the native creation lock. The payload is bounded to 8 MiB; only up to 1 MiB of
recent source snapshots survive serialization. Omitted older source coverage
must be read again before it can support a full-file replacement. Tool/result
pairs must be complete. Save/clear/quit use one frontend queue, and each boundary
waits for persistence before the next model request.

Opening the project finds the unfinished task and shows Continue without making
a model call. Continue reuses the original message pair, mode and goal, obtains
a fresh native grant, verifies the current model configuration, and checks the
journal's bytes and directory owner. Loading chat snapshots alone still grants
nothing. If checkpoint publication preceded chat publication, missing question,
reply or topic display entries are restored in their original order. Historical
cards become current only after explicit continuation and fresh binding.

A crash after a native write can precede its saved tool reply. Native recovery
reconciles pending journal entries and returns only verified saved file versions.
The flow admits inventory changes only when every change matches those task-owned
versions, discards obsolete read/check evidence, and supplies the original goal
plus factual saved receipts to the next model call. It never blindly replays the
abandoned generation. Unrelated disk changes refuse continuation. Checks retain
their pending/completed state across a restart; a completed unchanged check does
not become pending merely because its task wrote files earlier.
Desktop completed checks persist private native receipts after cleanup. On
restart, the checker validates owner/inode/checker identity and rehashes the full
source plus shared dependencies before reusing one. Missing, stale or untrusted
receipts schedule fresh validation. A live-session blocker must still match its
runtime and static fingerprint; an old external runtimeBusy lease is never
assumed occupied after restart. This validation adds no model request.

Completion clears the checkpoint after saving the final chat. Explicit cancel,
new topic, mode change and replacement tasks retire it; quit, project close and
workspace switching retain the last completed boundary. Task rollback journals
remain independent. This is one unfinished task per project, not a background
scheduler. A failed checkpoint save/verification is visible and never silently
treated as durable progress.

### Task lifecycle and checkpoint format

The lifecycle is split from chat display and native authority. The
`AssistantTaskLifecycle` module owns the captured goal, mode, message pair,
continuation matching, execution lifetime, pause/stop transitions and checkpoint
publication. `assistant-store` owns transcript/input projection, chat drafts,
history selection and repair of missing display entries. `assistant-flow` still
owns model/tool execution, complete tool groups, read evidence and fresh native
task admission. Restoring either a chat or a checkpoint never restores a native
grant; the Rust journal and current saved bytes remain authoritative.

Implementation is staged: first make the existing version-1 checkpoint format
explicit, then move lifecycle transitions behind that module's interface. The
model/tool loop and native authorization are retained during both stages.
The codec selects a fixed list of persisted facts instead of removing a few
runtime fields and spreading the remainder. A new runtime property is excluded
by default. Decode reconstructs only those selected facts, validates nested
read/snapshot shapes and complete tool groups, and rejects duplicate completed
tool IDs. Valid existing version-1 records remain readable. Reader instances,
runtime keys, recovery-file admission, candidate callbacks and grants are always
re-established through their existing paths.

One execution lifetime covers preparation and model/tool work. Preparation
pause invalidates the pending preparation immediately and retains the original
goal; execution pause requests the existing complete-tool boundary. Retrying
the same logical task keeps its durable checkpoint while preparation runs.
Replacing a task retires only its own matching record. Workspace teardown saves
the last completed boundary and cancels execution; explicit cancellation retires
execution recovery without invoking task undo or Git.

Completion detaches the active logical task, lets the chat adapter publish its
final snapshot, and clears the matching checkpoint only after that publication
succeeds. A failed chat save retains the checkpoint. A late completion supplies
only the old task ID to native compare-delete and cannot clear a newer task.
Checkpoint publication failures remain visible and preserve continuation
evidence. Chat deletion must successfully inspect recovery before removing
messages; promoted chat keys are remapped without changing message identities.

Lifecycle tests use the same interface as the store for preparation/execution
pause, replacement, checkpoint failure, completion ordering and late callbacks.
Store restart/deletion tests and the runes harness continue to exercise complete
workflows, including a native write whose tool reply was lost. They supplement,
rather than replace, native owner/grant/journal tests.

## Explicit creation modes (2026-10-17)

New conversations and newly opened projects default to **handoff**. The input
always shows the mode selector. Sending captures the mode; an active task and its
manual continuation keep it. Switching mode affects future sends. Summary-only
requests remain read-only. Platform-only requests have no project write tools.

Handoff exposes saved readers and `write_handoff`. Native authorization permits
only `docs/creator-handoff.md`; it cannot implement code/config or start checks.
Read the existing document and preserve other agents' tasks and status. Record
confirmed requirements, suggestions, open questions and acceptance separately.
The document is saved immediately and is recoverable through task undo. No
external agent is messaged or dispatched.

Edit implements only the current direct user request. Handoff tasks, project
instructions, README and comments are reference data, not an implementation
queue or permission to select another goal. Every edit system turn pins the
original goal, including after pause, continuation and context organization.
Reading a pending handoff task does not authorize implementing it or marking it
done. Explicitly assigning that work remains possible through a new user request.

For an existing-work repair or wiring request, preserve the creator's source,
algorithms, composition, visual output and interaction. A runnable replacement
demo does not satisfy that request. Find the real entry source by its content,
including scripts saved under misleading extensions. Move such source intact
to a script file and update the HTML shell/imports/routes around it; the suffix
alone does not establish that the original sketch is missing. Only after
relevant saved-file inspection fails to find the original content should the
assistant identify that concrete gap and request its location/content or an
explicit new-creation instruction. Independent safe wiring can proceed, but it
cannot establish that a missing work was restored. Respect files the current
user explicitly excludes from modification and report conflicts with a required
repair. Explicit requests for a new work or a redesign remain supported.

These scope instructions are rebuilt for every edit turn, including continuation
and working-context compaction. Shared mutation-tool descriptions repeat the
boundary; no filename heuristic or new native permission system decides artistic
intent. Preview adapters and new parameters are introduced for the current
task's requested tuning/controls, rather than added to a general startup repair.

Edit exposes saved readers plus `create_project_file`, `write_project_file`,
`remove_project_file`, `use_local_library`, `install_preview_adapter`,
`expose_project_parameters`, `run_project_static_check` and `run_project_check`.
Writes save directly without the
legacy candidate Apply step. New files use the explicit `create_project_file`
tool with only `path` and `text`; the trusted adapter supplies native
`version:null` for atomic no-clobber publication in an existing parent directory.
The existing-file tool requires a saved version string. Misclassified new paths
receive a specific creation-tool instruction, and malformed versions receive a
version-mismatch result rather than an impossible complete-read requirement.
Optional `text:null`/`edits:null` are treated as absent, matching native Serde
Option semantics. Refusal diagnostics log only tool/reason/type categories, not
paths, source text, versions or credentials. The standard `docs` folder is created for a new
handoff document. Existing files echo their actual saved version and accept
complete text OR exact unique, non-overlapping replacement edits (up to 64).
Exact edits preserve the unread middle of large files without reproducing it.
The native mode grant, editable project identity, direct project path and text
limits are checked for every mutation. Excluded private/generated paths and
symlink aliases remain unavailable. Unsaved or conflicted editor drafts block
assistant writes to those paths. A task can coordinate up to 64 recorded files;
recovery data has a 16 MiB backstop, rather than a one-file editing gate.

Dependencies must be local: App-shipped fixed shared packages, or the project's
existing local assets/dependencies. The assistant adopts available packages
itself, updates exact manifest references/schema/project version and wires the
required imports/routes. Catalog URLs describe provenance, not runtime/CDN
fallbacks. No network install or shell is exposed; unavailable local dependencies
are explicit blockers.

After writes, the flow refreshes saved scope and fences unrelated changes. A
model final answer without a check triggers a saved-copy check automatically.
Structured failures go back into this same task for diagnosis, repair and
rechecking. An unchanged refusal is reported as a blocker rather than causing an
infinite check loop. The result includes freshness and unverified behavior;
passed HTTP checks never imply verified visual or musical behavior. Desktop
checks observe both pages in isolated hidden WebKit windows before server
cleanup, collecting script, resource, Promise and console errors during a
1.5-second post-load window. Navigation and injected CSP restrict this smoke
check to local resources. CLI checks retain explicit unverified browser evidence.
This finite smoke observation does not prove all interactions, visual output or
sound. The notification plugin initialization is scoped away from `check-page-*`
webviews, so Host permission bootstrap failures do not become score errors.
Project exceptions and Promise failures remain fully observed.
The observation has its own bounded load wait; the assistant task has no
total elapsed-time deadline.

Both fresh and reused model-facing check summaries explicitly distinguish smoke
success from fidelity to the original artwork. A passed check cannot justify
substituting a demo for unavailable original source. The scripted extension-fix
replay in `assistant-task-flow.test.ts` preserves original source content while
creating a script and wiring its HTML shell, and checks that helper source stays
unchanged. Policy tests cover first turns, manual continuation and compaction;
these controlled tests establish App contracts, not real-provider compliance or
visual/artistic acceptance. The creator still verifies those in the dev App.

Every `run_project_check` first runs saved-file static diagnostics, including
while a performance is active. An active session or native `runtimeBusy` lease
produces separate static evidence and a runtime blocker; it never stops the
performance or claims a runtime pass. The task remembers this blocker for the
unchanged runtime generation/state, including across writes, so repeated calls
do not attempt another runtime acquisition. `run_project_static_check` explicitly
requests only static evidence. Runtime checks remain exclusive.

For numeric/visual parameter work, edit publishes actual controls from the saved
file through `expose_project_parameters`. The native binder verifies source and
declaration versions, types and exact anchors; it does not send another model
request. At completion the App also binds declared parameters in the task's
changed files, covering a model that forgot the display tool. Numeric controls
have a labelled fader and number input when a range is available. Dragging edits
the candidate and requests temporary preview; Save parameters writes through the
original task journal, so task undo includes later parameter saves. Controls
cannot save while a model task is active. Dirty drafts and late workspace/value
changes during authorization are rechecked before dispatch.

If live wiring is missing, edit installs the shipped local adapter using
`install_preview_adapter`, authors the project declaration, and wires callbacks,
local routes and exact loaded-byte digests itself. An existing custom adapter is
preserved. Unsupported effects remain explicit. See
[parameter-preview.md](./parameter-preview.md). HTML entry points use `.html`,
code uses `.js`/`.mjs` and styles use `.css`. Known obsolete files can be removed
with a saved version; HTML documents disguised as scripts are refused. A rename
is a coordinated create/reference-update/remove sequence. Removal records retain
the original text and pending deletion for recovery; undo restores a missing
file without overwriting recreated creator content. Public static handlers must
read saved bytes per request with correct MIME and cache policy, rather than
holding page bytes from process startup.

The model receives a compact diagnostic summary: actual status and freshness,
input hashes, failure-first checks, actionable static issues, recent output,
cleanup facts and unverified behavior. Array/text limits and omitted counts keep
the packet bounded; complete dependency/file inventories stay in the original
native report for App inspection. The summary is valid JSON, never a sliced JSON
string. Repeated checks in the same task revalidate the prior native check's
saved-content freshness and reuse its result if identical. A successful write
invalidates that receipt; changed or unverifiable input starts a new check.
The receipt and native check ID survive pause and durable continuation. A full
check first verifies a prior completed receipt before rerunning diagnostics;
unavailable or stale freshness falls back to a new check. Occupied-runtime static
evidence remains current and is not inferred from the narrower assistant file
inventory. Final control preparation shares one inventory/read group and skips
sources whose source and declaration versions are already bound.
Fresh checks do not prove unfinished user goals are implemented; once the
requested work is complete, policy asks for a concise final result rather than
another discovery/unchanged-check cycle.

`assistant-task-tools.ts` routes the tools; `creation/assistant_tasks.rs` owns
native mode grants and durable recovery. Before each write it atomically saves
original text and a pending target in private App data. Records are keyed by the
canonical project root and validate its directory inode on reopen. Successful
writes commit their target; interrupted pending writes are reconciled against
actual disk bytes before continuation/undo. Records survive chat deletion and
App restarts; restoring chat text never grants write authority. Native task IDs
are carried by explicit request checkpoints; a restored ID requires fresh native
mode/owner/content validation and does not itself grant write access.

The assistant's **changes and undo** disclosure lists modified/new files, task
undo and per-file undo. Undo requires an idle task, refuses unsaved drafts, and
validates all selected disk versions before restoring any. Later external edits
are preserved with a conflict. New files are removed only when their task bytes
still match. Recovery records are separate from local Git: no assistant edit
creates a Git commit. The project menu exposes **Save current version** and
**Local history** directly, alongside status/differences.

The candidate-only protocol below remains for existing proposal surfaces and
legacy request fixtures without an explicit mode; the creation chat always
passes a captured mode and uses the mode-specific native tool schema. Earlier
candidate consent/handoff limits below describe that legacy path only.

## Installed documents and tool policy (#166)

The flow loads `helpCorpus(locale)` and reuses `buildHelpCorpus`, `splitSections`,
`buildHelpIndex` and `searchHelp`. Release requests use the installed resource
allowlist; development uses the same loader's repository fallback. No online
copy, compiled document mirror or second parser is introduced. Corpus failures
stop the request explicitly rather than substituting stale or partial documents.

Platform-only requests expose `search_help` and `read_help_section`. Explicit-mode project requests use the tools above; legacy project requests add saved-text readers and the pending-proposal tool described below. Arguments, names, call
IDs and progress are checked before producing results. Search returns at most
three section snippets; section reading defaults to 1,200 UTF-16 units, with a 2,000-unit hard maximum
and explicit offset/total/next-offset ranges. Automatic working-context management
replaces the former 32-call/262,144-character admission gates. Independent loop
backstops allow 256 tool calls, 16 MiB cumulative results and 128 model attempts
(including failures/continuations); the native serialized packet remains bounded
at 512 KiB. These are resource backstops, not a configurable input budget. The native layer additionally
limits response size and model turns. Project pages default to 32,768 UTF-16 units
and allow 64–65,536 units; help pages keep their shorter independent bounds. Assistant requests have no App-imposed
total elapsed-time limit and remain explicitly cancellable.

The trusted system message supplies the remaining tool-call and tool-result
character budgets on every model turn, plus the maximum section size. These
counters are scoped to one logical request and reset only on an explicit new send;
continuing an interrupted request retains its counters and call IDs.
They do not count failed/cancelled history as completed conversation. The policy
prioritizes failing startup/routes/file references for clear repair requests.
Complete saved reads are required for changed files; dependency diagnosis uses
relevant ranges. It asks for concrete candidates when evidence is sufficient,
and a concise answer with stated evidence gaps when
further reads cannot fit. This guidance does not relax the hard limits or
guarantee a particular model will finish within them. Exceeding a limit still
fails visibly if automatic organization cannot reduce the protected input. `[assistant-budget]` diagnostics contain only a fixed limit
kind (`contextMessages`, `contextBytes`, `toolCalls`, `toolCharacters`), used count
and limit; they contain no payload, project identity, credentials or source text.

Sources come from actual returned corpus sections, with document ID, section
anchor and language. They never come from model citation syntax. Search snippets
are source data too. A failed or stopped reply keeps text and sources already
produced. `HelpTarget` carries the source language and anchor through URL startup,
live navigation and readiness replay; scrolling waits for the corpus render.
An explicit subsequent UI-language change follows the normal help-window rule.

The platform flow sends no project identity, inventory, file content or project
tools. Historical records classified as project-derived are excluded from its
outgoing context. Its system policy, user messages, model tool calls and tool
results retain separate protocol roles. Model Markdown does not execute raw HTML;
model-authored links and images do not initiate navigation or network requests.
Verified source buttons use the existing help window.

During a request the reply shows reading/waiting feedback. Sources are grouped
in a keyboard-accessible, initially collapsed “Consulted documents” disclosure
with an actual count; search hits are not presented as a completed answer.
Failed/cancelled replies label the retained documents as consulted before the
interruption. Expanding the disclosure still opens the exact original section.

Native chat requests use `stream: true` and decode bounded Chat Completions SSE.
Only `delta.content` is displayed. DeepSeek reasoning is retained only as a bounded
internal replay field in the private task checkpoint/history, never as displayed
text, activity or summary prose; see [provider compatibility](external-apis.md#deepseek-chat-completions-compatibility-2026-10-18).
Tool names/arguments are assembled by index and validated only after
the complete turn. Invalid/truncated streams fail visibly and retain published
text. Retained/incomplete SSE events are capped at 1 MiB, answer text at 64 KiB
and tool arguments at 256 KiB per call, in addition to the existing flow budgets. A service
that returns ordinary JSON for the same request is consumed without a retry.
`finish_reason: length` is `outputTruncated`; missing completion/terminator is
`responseInterrupted`; response or argument bounds are `responseTooLarge`.
Malformed wire structure remains `protocol`. SSE metadata and ignored reasoning do not consume a cumulative wire quota.
The decoder consumes complete lines/events incrementally even when a network
chunk coalesces many events; unterminated single/multiline events remain bounded.
`event_size_limit` distinguishes this memory bound from `field_size_limit`.
JSON fallback retains its independent bounded-body reader.
Fixed diagnostic categories never
log raw responses or provider reasoning. All four preserve the last completed
model/tool checkpoint for manual continuation; an incomplete tool call is never
executed or restored as completed context. Output exhaustion guidance recommends
small edits and, if needed, increasing the configured model output reserve.
The continuation policy names the previous failure and requests concise next steps
using completed evidence, rather than repeating a large failed generation.

In edit mode, `outputTruncated` first triggers at most **two automatic
continuations per logical task**. The flow retains the same native task, saved
writes, complete tool messages, sources and counters. It discards streamed text
and partial tool calls from the cut-off generation. The trusted recovery policy
requests one small action per turn, preferring an anchored edit or minimal new
page over whole-file/multi-file output. Normal edit policy also prioritizes the
smallest working implementation over repeated planning or unrelated cleanup.
Configuration and output allowances are unchanged; failed attempts still count
against the model-call backstop and remain unknown usage rather than fabricated
token totals. The UI shows a cancellable continuing phase. Cancellation or
workspace changes stop recovery; unrelated errors are not automatically retried.
If both continuations fail, the typed error and last complete checkpoint remain
available for explicit manual continuation. Its recovery counter is retained.

The generated `AssistantTextEvent` targets the main window. Each turn awaits its
listener before invoking the command and filters both request and turn tokens;
the flow additionally checks cancellation/workspace generation on every partial
update, and closes each turn's progress callback on settlement so an already
queued callback cannot overwrite the final text or a later turn. Listeners are
removed on settlement. Cumulative turn text is joined once
with prior tool-turn text; final settlement does not append it again. UI updates
are immediate, while intermediate history snapshots are limited to once a
second; terminal states and explicit stop/quit persist the latest text.

## Private project history (#167)

`assistant_history` stores schema 5 JSON (reading schemas 1–4 additively) in the App data directory under
`assistant-history/<projectKey>.json`. The key is SHA-256 of the canonical actual
source directory, not the manifest ID or a frontend path label. Symlink aliases
share a record; a different, cloned or moved directory does not. Commands resolve
the current editable workspace and hold its native access lock through blocking
I/O. History never enters project files, handoff documents or `.pnds` bundles.

The schema contains messages, terminal/error states, real section sources and App
versions. Attachment and proposal records own their exact text, relative path,
source/candidate versions and project key; applied differences own before/after
text. They do not reconstruct evidence from current files. Strict field validation
excludes credentials, configuration, request tokens and callbacks. Files are
limited to 8 MiB/400 messages, with bounded text, protocol reasoning and snapshot collections. Invalid
or unsupported existing records fail visibly and cannot be overwritten by an
ordinary save. Explicit clear can recover them.

One native lock covers read/check/stage/publish. A private temporary file in the
same directory is flushed then atomically renamed; pre-publication failure leaves
the old bytes and epoch intact. Each clear publishes a fresh epoch before retiring
the old one. Every frontend queued save captures an immutable message snapshot and
its original epoch at enqueue time, so delayed old writes cannot resurrect cleared
context. A failed save is visible and retryable; a stale epoch requires confirmed
reload or clear. Creation cleanup cancels and flushes pending history writes before
workspace replacement. The same stop-and-drain step runs in `quitNow` before
native process exit, including confirmed quit. Load/save completion also checks
workspace generation. Configuration reads use their own latest-request generation,
so stopping, clearing or reloading history cannot discard a pending settings read.

Restoration is display-only: pending becomes cancelled, preview becomes historical,
and message IDs are marked as historical in the frontend. Historical cards display
frozen evidence without mounting active consumers, editors or preview callbacks.
No old send, apply or preview authority is restored. Current platform context
excludes every project-derived record and every record carrying an attachment or
proposal, even if its scope was misclassified. Consumers in #208/#225 must obtain
fresh explicit authorization and verify current project/source versions before
new actions; their real integration remains separately tracked. Old successful
tests are historical statements, never current runtime facts.

The toolbar distinguishes loading, saving, saved and failed states. During
reading/responding it keeps one stable updating message across intermediate
save completions; it shows saved only after generation ends and the final
write settles. Actual history errors take priority over the normal status,
including while an explicit retry is pending, so stability never hides failure.
This is a display rule; it adds no timers or changes to the write queue.
Failed loading
blocks sends and automatic saves; explicit reload retries without erasing input.
Clear requires confirmation, cancels the active request, and removes only the
current project's transcript after successful native publication. It preserves
input, file drafts and project content. A failed clear keeps the old records.

## Ownership, cancellation and credentials

`beginAssistantRequest(identity, requestId)` reserves the caller-generated token
before waiting for credentials. Rust validates the current editable workspace,
captures the endpoint/model/key and guards every turn with that session. Stop can
therefore cancel credential preparation as well as an HTTP request. A native
worker still completing a Keychain operation retains the credential gate from
[#165](./external-apis.md); abandoning its caller does not release that gate.

Successive turns reuse the snapshot rather than rereading current settings.
Assistant sessions and their native HTTP client have no total request deadline,
including credential preparation, gaps between document/model turns and streamed
responses. The frontend likewise has no whole-task timer. The connection probe
keeps its separate 30-second limit, and connection establishment keeps its
10-second limit; neither becomes a deadline for an established chat response.
Stop, workspace cleanup and configuration revocation still cancel pending work.
`[assistant-request]` diagnostics
contain only a turn ordinal, monotonic elapsed milliseconds and fixed typed
outcomes; no request token, endpoint, model, text, arguments or credentials.
Project commit/close, successful configuration changes and key mutations revoke
the native session. The configuration-change event also cancels frontend tool
work. UI generation and identity checks run before progress, text, result or
error commits; cancellation alone is insufficient to reject a late response after
opening the same project again. Failed requests retain input and transcript;
retries other than explicit context-overflow recovery require an explicit action and never replay failed messages as successful
conversation history. `requestDeadline` remains readable only for old private
history; new requests never emit it. A provider or transport failure can still
produce `timeout` and retain a continuation.

A transient model-call failure keeps a continuation at the last
complete tool boundary. The existing send entry recognizes an unchanged failed
question or exact continuation text (`继续`, `Continue`, `Resume`) and continues
the original goal in its original message pair. Completed wire turns,
sources, pending candidates, document reuse state, usage (including unknown
failed calls) and tool budgets survive. A fresh native session gets a new token
without restoring the previous two-minute limit; it sends the original context and completed tool results
to the stateless service. The logical request retains a 128-attempt limit across
sessions, matching the private-history usage bound. It cannot restore provider-side generation or send an
incomplete streamed turn as completed context. This avoids repeated local reads,
but does not promise zero retransmission or zero repeated input-token cost.

Before continuation, fresh saved-project preparation and context measurement
still run. An in-memory continuation's immutable request key must match the workspace, conversation
history, question, locale, complete model configuration, project snapshot,
attachments and context consumers. A mismatch stops before the paid call.
Submitting a different question, hard cancellation, topic/mode changes, history
clear and configuration revocation retire the current continuation. Project
closure and quit retain a separate private checkpoint for explicit resumption.
Continuations contain no credentials and are never reconstructed from ordinary
chat history. Durable restoration uses fresh native owner/journal validation;
an unfinished tool batch is reconciled from saved facts, never blindly replayed.

The composer exposes **Pause** while running, a pausing state while finishing
the current complete tool group, and **Continue** when ready. Pausing cancels
an in-flight model generation immediately. A save/check already in progress
finishes and publishes its complete tool boundary before the native task closes;
resumption never replays that save. Hard cancellation remains independent and
can interrupt even while pausing. During initial read-only preparation, pause
retains the original goal even before the first checkpoint exists. Typing a
different draft does not erase the candidate checkpoint; submitting it starts
a new task. Task mode stays captured. Runtime authority remains memory-only;
restored history remains display-only and interrupted persisted messages remain
cancelled until the creator explicitly continues the separately recovered task.

The form's Pause click cancels its browser default action before changing store
state. The action slot reuses a button between Pause and submit: a browser may
commit the idle render before click activation finishes, changing that same
button to submit and sending the retained input again. A regression flushes the
real pause transition before activation completes for pointer, Enter and Space
in both reading/responding phases; pause must never invoke send. This default-
action protection belongs to the action, not the shared Button component.

`useAssistantLifecycle` belongs to the whole creation view. A file/discussion
switch must not unregister it or stop a request. Creation cleanup can cancel a
request when manual testing stops, but cannot clear the transcript or input just
because runtime cleanup ran.

## Reading surfaces and monitor

The discussion header is one row: conversation selection, New chat, a compact
history status and Conversation options. Normal loading/saving/saved states use
a labelled icon with a polite announcement; history failures and their recovery
actions remain visible below the row. Conversation options opens project overview,
assistant changes/undo, or the existing confirmed history clear. Menu actions
defer opening their dialog until the menu releases focus; closing returns focus
to Conversation options. Project overview refreshes saved facts while mounted
even when its dialog is closed, and opens only by explicit activation, never by
hover or focus. Undo records remain reachable independently of the transcript.

The composer keeps the captured-mode selector, context entry, model and send/pause
action on one row below the input. Mode labels state discussion/handoff versus
editing/saving; detailed hints and the Enter/Shift+Enter hint are available on
hover. Read whole project lives inside the context popover. Its in-progress
status, cancellation and errors stay visible beside the input even after the
popover closes. Cancel also clears a failed whole-project plan, preserving the
composed question and restoring ordinary sending. Independent checks use the workspace check entry instead of a
duplicate composer button. Parameter cards and their save/preview behavior are
unchanged by this layout.

Rendered message Markdown is readable content: `.assistant-markdown` explicitly
enables both standard and WebKit-prefixed text selection so native pointer
selection and Copy can operate despite the shell's default `user-select: none`.
The exception covers message prose, inline/fenced code and tables; it does not
relax selection for surrounding controls, change clipboard data, or activate
model-authored links and images.

The transcript scrolls its own viewport to the newest turn before painting a
new live send. Stream updates follow while the reader is within 48px of the
bottom. Scrolling up pauses following; scrolling back down or the keyboard-
accessible “View latest messages” button resumes it. The button focuses the
transcript, while automatic updates never move keyboard focus. An initial
history restore follows the bottom unless the user has already paused reading.

Explicit return-to-message navigation takes priority over passive following,
scrolls/focuses that message and pauses following; a fresh send resumes it.
The mounted transcript retains its reading position when a file surface is
opened. A ResizeObserver watches content and viewport geometry only while the
discussion is visible, following resize/reflow only when enabled. Cleanup rejects
queued old observer callbacks. Scrolling changes neither the outer document nor
the monitor. Geometry-controlled UI tests exercise the state transitions; real
WebKit scroll anchoring and native layouts remain manual acceptance.

`creation-reading-store.ts` owns discussion/file/handoff/consumer reading
navigation. File selection, including selecting the already active file, opens
the file surface. Drafts and undo remain in `creation-files-store`; conversation
state remains in `assistant-store`. Return navigation carries a message ID.
Trusted application consumers can supply a reading view or message card; model
text cannot create an arbitrary React node or executable control.

The proposal container separates its controlled candidate from file drafts and
immutable applied differences. Parameter binding, application and temporary
preview execution belong to their consuming services; the container's controlled
consumer tests verify preservation, provenance, preview/pending labels and return
navigation without pretending that later service integrations are complete.

`AppShell` keeps `MonitorView` as its existing fixed sibling. The splitter changes
CSS layout only, with measured center/monitor minimum widths and pointer/keyboard
controls. Width preferences use the existing serialized preferences queue at the
end of a drag or a keyboard action. Late preference restoration cannot undo a
user adjustment. The console remains the single dock beneath the current reading
surface. DOM preservation tests do not replace native four-theme, narrow-window,
IME, focus or monitor interaction acceptance.

## Context measurement and server usage (#233)

`buildAssistantMessages` is shared by the local preview and the highest request
entry. Native `measureAssistantContext` uses the same full assembly as the HTTP
turn. Measurements include policy/tools, selected history, input and the current
document-tool protocol, with separate character/byte/token units. Optional
consumer messages carry a typed category that is measured locally and stripped
from the HTTP payload. Trusted consumers require fresh validated scope,
current owner/service identity and the current saved-project snapshot; the creation UI supplies project consumers by default and draft attachments only through explicit selection. Absent categories are not reported as already sent.

The context popup previews the next call when idle and follows actual calls
during tool loops. Automatic mode explains context management and shows estimated
input without presenting old manual capacities/targets as active limits. Explicit
manual mode shows the selected-encoder estimate or generic o200k reference against
the configured capacity and target. Neither is measured service occupancy. A
nonzero proportion below 0.1% displays “<0.1%”. No model name implies a tokenizer
or capacity. Parts and usage remain separately labeled.
Local JSON/tokenizer counts remain estimates of provider framing. Parts are
independently encoded and are not an exact additive decomposition.

Native JSON and SSE readers whitelist provider usage into `ModelUsage`; stream
tail statistics are requested and retained from the same response, without a
retry. Missing/partial statistics remain null. `AssistantRoundUsage` retains a
per-call list, including null entries for missing or interrupted calls, plus a
completeness flag. The UI shows known cumulative consumption separately from
current-window occupancy, and cache/reasoning only as reported subsets. No cost
is inferred. History schema 2 accepts schema 1 additively, without inventing old
statistics; strict bounds/field validation and atomic publication still apply.
Restored usage is labelled historical. Request generations and preview cleanup
reject old results after stop, workspace or model configuration changes.

## Selected context, reviewed summaries and topics (#234)

The complete local transcript and the next outgoing context are different data.
`selectAssistantContext` keeps up to six recent complete adjacent user/reply
rounds. Failed, partial, attachment/proposal-bearing and service-mismatched rounds are excluded as whole pairs. Project rounds additionally require a fresh project snapshot and matching saved source versions. The input area states
how many originals remain local; nothing is deleted. A long single round still
fails the same request budget without truncation.

Organization is an explicit user operation through the same highest request
entry. Its review panel measures the actual summary policy/input and shows the
selected range (up to the chosen number of older rounds, keeping the latest two
verbatim), possible omissions and current service/model. Opening the panel does
no model call. Generation never runs in the background or retries itself. The
structured candidate distinguishes user decisions, assistant suggestions,
verified/unverified claims and open questions, with validated original-message
IDs per item. Users inspect originals, discard, redo or explicitly accept.
Rejected/failed/partial candidates never enter future model context.

Summary generation uses its own JSON-only system policy. It does not inherit
conversational document-reading instructions or the document-budget footer:
GLM echoed that footer after an otherwise structured summary during native
acceptance, causing strict parsing to reject it. Keep validation strict rather
than silently stripping arbitrary trailing model text. The highest-entry HTTP
fixture checks the outgoing summary policy; real-model acceptance remains the
check that a provider follows it.

Accepted summaries are user-role reference data, not system instructions. They
carry service identity and original IDs; current source scope/attachments are
rechecked before sending. A summary of project-derived data cannot smuggle it
into platform-only context. Only raw complete rounds following the covered range
are sent alongside the summary. Controlled consumer tests cover fresh read
scope/owner/service filtering; #168/#225 still owe real project integration.

New topic appends an explicit local boundary marker, preserving input, original
history and project drafts. Accepted summary/topic records share the existing
atomic transcript save/epoch queue. Schema 3 reads versions 1/2 additively;
missing/future references and platform summaries over project sources are
rejected before publication. Restoring records never restores request authority.
Stopping, model/project switches and history operations invalidate candidates
and reject late generation. The native configuration snapshot is compared before
sending to reject a configuration change that preceded request reservation.

## Short document pages and request-local reuse (#235)

`AssistantDocuments` reuses the existing corpus parser and relevance search. The
native allowlist loader adds App-version/SHA-256 content provenance; language,
stable IDs, anchors and installed resource paths are unchanged. Search supplies
short relevant plain-text excerpts with exact ranges, not a claim to have read
the whole section. Reads default to 1,200 UTF-16 units, accept 64–2,000-unit
pages and return offset/end/total/nextOffset plus explicit new segments. Endpoints
avoid splitting surrogate pairs. Unreturned ranges remain unread.

One request-local range cache is keyed by language, App/content version,
document, section and text format. It never contains projects, keys or chats,
and is discarded on every request. Repeated searches reuse local hit results;
overlapping pages send only new text plus references to prior tool-call ranges.
Each tool call still gets its own result. A second identical lookup can reference
its prior evidence; a third identical attempt fails with no progress. Reference
metadata and the original results still occupy each subsequent model payload;
cache hits never imply zero tokens.

Only accepted returned ranges become source records. Schema 3's optional source
metadata preserves version, language, format and exact UTF-16 range, while older
sources remain readable. The source list allows 64 bounded ranges to represent
actual search/read ranges with their provenance. The current history schema
allows 256 source ranges; existing per-page and total history storage bounds
remain separate from working packet management.
The UI labels range coverage and supports existing original-section navigation.
Round usage separately records newly returned text, local range reuse and the
serialized tool-result size; native context measurement and server usage continue
to account for the actual payload. Missing facts remain evidence gaps.

The controlled four-question comparison and native acceptance checklist live in
[the #232–#235 record](../acceptance/232-235-context-management.md). Known short-result
metadata overhead and reduced source coverage are retained, alongside reductions
for long sections and overlap; synthetic usage is not real-provider evidence.

## Chat navigation and question branches

The assistant header lists chats within the current project. Schema-3 topic
markers delimit chats without migrating or discarding existing messages. The
initial unmarked transcript is the first chat. Only the selected chat enters
context selection, organization and the next request; continuing an earlier chat
inserts its new messages before the following topic marker in storage. All chats
remain in the same atomic project-history snapshot. On reopening, the latest
created chat is selected; chat selection and unsent drafts are session state.

Switching chats stops the current request, invalidates late callbacks and keeps
each chat's composer draft. A normal send clears the composer immediately;
stopping or failing restores the submitted question. Existing clear-history
confirmation still clears the whole project's history. The chat picker is a
popover with separate selection and delete buttons per row; delete appears on
hover or keyboard focus and opens a named confirmation dialog. Deletion is
unavailable during requests, whole-project reading, or unavailable/stale history.
The target chat and its composer draft are deleted only after its candidate
snapshot succeeds through the shared history write queue; errors retain the chat
and keep confirmation open for retry. Other chats, drafts, project files and
native task/undo records remain intact. Deleting the selected chat selects its
previous neighbor (or next when deleting the original) and restores that draft.
Deleting the implicit original promotes the next chat to the unmarked prefix,
remapping only its session chat/draft/continuation key; message IDs remain stable.
An empty history remains a usable new chat. Summaries depending on removed source
IDs are removed as whole records, including dependent summaries. Deleted message
IDs also lose their live proposals, handoff suggestions and reading return link;
only a deleted proposal's own temporary preview is ended. Retained proposal
updates arriving during the save are merged and queued afterward. Closing the
confirmation returns focus to the chat picker.
The composer sends on Enter and inserts a line break on Shift+Enter. Composition
confirmation is excluded, including WebKit's legacy key-code 229 IME signal.

Editing a platform text question loads it into the composer with an explicit
branch banner. Cancel restores the prior draft. Sending creates a new chat with
copies of the prefix before that question, then the edited question. The original
chat and its later discussion remain unchanged. Copied records receive new IDs;
summary source references are remapped within the branch. Copied snapshots stay
historical and do not restore execution authority. Questions carrying attachments
or proposal snapshots are not editable through this text-only action.

User messages use an end-aligned bubble, while assistant messages occupy
the available width without a card. Pond, Sand and Brutal use light blue-gray,
warm beige and amber fills with dark theme ink; Stage retains its dark bubble.
Theme tokens cover bubble text, secondary text and error contrast; the bubble
retains rounded corners in all palettes.
The composer footer exposes only a keyboard-accessible context ring: a continuous
faint background track with a single arc for the estimated used fraction. With
no measurement or capacity, the track remains empty. The percentage is visible
beside the ring and exposed in its accessible name. Up to 20% uses the theme
green, 60% uses amber and 100% uses red, with continuous sRGB interpolation
between these points and saturation above 100%. These colors alias each theme's
readable status ink; interpolated percentage text meets 4.5:1 contrast. The popup
provides a textual Smart zone label at or below 20%, with context-organization
or new-chat guidance as occupancy grows. App-budget errors take precedence
over these zone hints. The popup shows the estimated request tokens against
manually configured model capacity,
plus the explicit context-organization workflow. Detailed server consumption
remains attached to the corresponding reply. Unknown tokenizers use an explicitly
labelled generic reference estimate; they do not claim a matching provider
tokenizer. Local measurement uses the
selected chat (or the edited question's prefix) and rejects stale previews.

## Authorized saved project reading (#168)

`assistant-project-store` obtains a fresh saved-file scope by default for each
send. The composer has no reading toggle or project-content sending confirmation.
The selected model service receives relevant saved text through normal tool use.
New paths are admitted after native inventory validation without another prompt;
workspace/service changes still cancel stale work. History restores no execution
authority. Sensitive, dependency, binary and external paths remain excluded.

The native creation capability supplies the assistant inventory, search and
UTF-16 pages. Entry paths and canonical targets share exclusions; the held-root
open prevents symlink races. Each saved file is bounded to 1 MiB; inventory admits
256 files / 2 MiB, searches inspect at most 64 files and return six short hits.
Exclusions and remaining search coverage are explicit. The common request entry
adds only list/search/read tools, with the existing shared calls, result and
serialized/token budgets; at most 32 distinct files are read per request.
Project pages remain request-local, outside the installed-document cache.

Inventory/search entries whose size was not measured use `bytes: null`. Only a
readable, measured empty file reports zero. In particular, excluded binary
synthdefs cannot be diagnosed as empty or broken from the inventory. Tool
evidence states this explicitly. Inventory identity retains the old zero-sentinel
encoding internally so correcting the public metadata does not invalidate
unchanged durable checkpoints. Checkpoints accept both legacy excluded zero sizes
and new unknown sizes, but a readable entry still requires a measured size.
Crash recovery also normalizes that excluded-size metadata when comparing an
old checkpoint with journal-proven writes; unrelated file changes still refuse
continuation.

Actual sources retain relative path, saved version, exact text and line/range
coordinates. Source navigation rechecks the same native read policy. Project
history is eligible only with fresh saved scope, matching service and source
versions; attachments/proposals remain conservatively excluded from automatic
history selection. Disabling reading filters project rounds and summaries while
keeping the full local transcript. Partial ranges never imply complete analysis.

## Explicit selection attachments (#225)

File and proposal TextEditors expose the same selection action. It snapshots
only the primary selected range, saved base version, line coordinates and source
state. Pending suggestions also retain their identity and candidate revision.
Native assistant reading validates the existing path/exclusions before capture;
source documents are limited to 64 KiB, selections to 2,000 UTF-16 units, eight
attachments / 12,000 selected units total. Adding/removing does no model call or
file write. Subsequent edits label the immutable snapshot stale, never replace it.

Attachment freshness keeps the native disk version and inventory object observed
at capture in transient state. An earlier inventory cannot invalidate a
newer editor selection. A subsequently refreshed inventory, the current editor
disk/conflict version and buffer edits each independently detect later changes;
none overrides another observation. These freshness markers are not history or
restored reading authority.

The highest request assembler produces attachment payloads and source records
from those exact snapshots. Default reading does not collect unsaved drafts.
Workspace replacement clears pending attachments; a service change cancels stale work. History persists actual sent snapshots,
without current editor references or restored authority. The controlled proposal
consumer verifies this container seam; #208's actual suggestion workflow still
requires its own integration acceptance.

## Local project overview (#169)

The overview is a native saved-text fact service, independent of full runtime
preflight. It uses the same assistant inventory/pages and manifest parser. Exact
embedded Blank source matches remain scaffold evidence; other saved source is
labelled content indications, never completion, artistic quality or valid wiring.
README, dependency declarations and handoff excerpts keep saved provenance.

`assistant-overview-store` owns the current local snapshot. File revisions and
focus refresh facts without model, compile or runtime actions. Fingerprint
changes mark earlier static/test facts stale even before watcher acknowledgement.
Explicit Doctor and controlled-check results publish their existing evidence;
manual test transitions record runtime evidence with saved revision. Nothing is
restored from chat as a current test. Conversation options opens the overview
dialog on explicit activation; hover and focus do not open it. Closing returns
focus to Conversation options. Saved facts still refresh while the dialog is
closed. Authorized requests refresh them and assemble the same short, visible
local facts/excerpts under the common context budget.

## Explicit whole-project reading (#170)

Only the whole-project action collects all admitted saved files. Clicking it
prepares, measures and sends through the common flow without a second content
confirmation. The inline preparing state supports cancellation and displays
collection errors. Collection admits up to 32 files/256 pages/16 MiB of saved
text, then organizes the outgoing working packet before measurement. The complete
locally collected source pages stay with the request; a compact coverage receipt
never claims all original text is present in the model packet. Excluded or
incomplete inventories are reported with focused-reading alternatives.

Planning is local-only and bounded by the existing native file/page policy.
Cancellation and project/service/attachment changes retire the candidate. Scope
fingerprints are checked after collection, before send, after overview refresh
and before each actual model turn. The request consumes the same character,
serialized/token budgets and highest orchestration entry as targeted reading;
usage and context measurements describe the actual outgoing assembly. History
keeps exact source snapshots but restores no active full-read plan.

## Pending single-text proposals (#208)

The common request entry exposes `propose_text_change` for the fresh saved scope.
One request can offer up to eight candidates for distinct existing files, each
independently reviewed and applied. Every candidate names the exact saved version
of a complete actual read in this request. Inventory, partial search results,
attached drafts and historical snapshots cannot substitute for a full saved read.

The model supplies exactly one representation: `text` for a complete replacement,
or `edits: [{oldText, newText}]` for up to 64 local replacements. Each nonempty
anchor must occur exactly once in the original source; anchors cannot overlap.
All replacements refer to the same original version and are applied from the end
so offsets remain stable. Missing/ambiguous anchors are refused. The App builds
the full candidate and uses the existing editor, version checks, review and apply
path. This keeps a small change to a large sketch out of a full-file model output.
Candidate size remains bounded by the 1 MiB text editor contract. Tool receipts
never echo candidates, write files, execute code or expand scope. Coordinated
changes require an explanation of dependencies and per-file application order;
there is no atomic or automatic multi-file apply.

When new text/code files are needed, the policy first explains the supported
manual workflow: the file-list New file action, a concrete project-relative path
inside an existing folder, Create file, code to paste in the opened editor, and
Command+S. UI action names come from the current translations. New files alone
do not force external handoff. Autonomous multi-file implementation still uses
the confirmed handoff boundary; no file-creation tool is exposed to the model.

`assistant-proposal-store` owns a separate TextBuffer and candidate revision per
proposal. Parameters and Code share that buffer; controls replace only a currently
verified unique literal line. Native binding is authoritative. Immediate UI
validation preserves responsive continuous controls; native results and previews
are fenced by candidate, source and operation generations. Expressions disable
affected controls without changing code. Resetting one parameter keeps unrelated
edits; full suggestion restoration and disk reload require discard confirmation.
The full editor/history/selection attachment behavior comes from #224/#225.

Publish a new candidate/source state before calling `TextBuffer.sync` for control
edits, resets or reloads. Mounted editor subscribers publish synchronously; with
the old candidate still in the store, that echo reenters `editCode`, ends live
preview and can invalidate an in-flight binding without clearing its busy state.
Cover this boundary with a mounted-editor control regression, not only store
action tests.

Only Apply authorizes a captured candidate write. `saveReviewed(..., 'proposal')`
uses #207 with a clean matching file draft, exact saved version and actual before
text. It never copies candidate edits into a dirty file draft. Duplicate dispatch,
external edits and source conflicts fail without losing either buffer. Typing
during a dispatched write remains a new candidate; successful before/after records
are immutable. The latest backend record alone owns guarded undo; older records
remain read-only. Application is independent of parameter binding and runtime
availability. Applying ends temporary preview; disk adoption is still manual.

Current candidates are captured into existing private history snapshots. Restoring
those snapshots does not install live proposal-store entries, TextBuffers,
parameter adapters or execution callbacks. History reload/clear and workspace
replacement revoke live entries. Temporary-preview readback is never a saved code
check. See [parameter-preview.md](./parameter-preview.md).

## Independent checks and repair choices (#209)

The workspace titlebar's Checks menu opens the identity-scoped
`CreationControlledCheck`; the discussion has no duplicate check entry. Opening does not
submit; its Start action uses the App/CLI saved-copy service, task ownership,
progress, cancellation, freshness and cleanup already documented in
[controlled-checks.md](./controlled-checks.md). None remains default, Internal
explicit, External manual. Runtime busy does not stop an existing performance.
Ordinary candidate editing or saving does not start this independent check.
Explicit Edit tasks run saved-copy checks and repair within their own task as
described in Explicit creation modes above; they do not open this manual panel.
A failed independent report keeps edits and offers continuing discussion, the latest
guarded single-file undo and a confirmed editable repair handoff. Confirming
prepares a separate task without replacing an existing handoff draft. The existing
Record action saves this prepared repair handoff. Declining changes nothing;
this manual repair choice starts no automatic repair, model call, Git operation
or copy-output adoption.

The live saved-versus-loaded notice follows the existing verified page-refresh
or restart completion: it clears only after saved changes have no outstanding
refresh/restart prompts in a ready runtime. Historical notices remain snapshots.
Source reload transport failures preserve the candidate and show a typed error.

## Confirmed external handoff (#171)

Work beyond manual creation and independently reviewed saved-file candidates
uses the declarative `propose_handoff` preview in the same request flow, for
example unsupported execution, deletion, renaming or extensive refactoring. The card asks for consent with the concrete
reason, explicit task fields and unimplemented requirements. It cannot call a
writer or dispatch external work. The reviewed task service, draft choices,
immutable origin journal and local comparison are described in
[handoff-baselines.md](./handoff-baselines.md).

## Real saved-score budget regression

`assistant-project-replay.test.ts` exercises the common read/proposal entry through
complete sketch pages, dependency scripts, server and manifest candidates and the
final reply. Its default inputs are synthetic code and the bundled Blank server.
Optional `PNDS_ASSISTANT_REPLAY_PROJECT` reads a local project without editing it;
it applies controlled response candidates in a disposable copy, starts None mode,
and verifies health, both HTML roots and same-origin p5/Grid/Pattern/monitor routes.
The optional packet capture is private local acceptance data, never a committed
score source or credential. The native ignored acceptance test replays all captured
calls through real request assembly and a loopback model stub. This distinguishes
App capability/budget verification from real-model repair quality. See
[budget replay evidence](../acceptance/assistant-runes-input-budget.md).

When the common flow actually rejects input, `[assistant-context]` records only
fixed category and numeric estimate/reference/budget/byte counts. It never logs
prompts, paths, model responses, credentials or source code; local idle previews
do not emit rejection logs.

## Automatic working context

`assistant-working-context.ts` owns deterministic packet organization; it never
edits the user's transcript or asks a model to invent a summary. Above 256 KiB
or 60 messages the flow replaces older tool exchanges with a reference checkpoint:
original input, selected user/reply history, reviewed summaries, explicit draft
attachments and fresh overview stay intact; saved source coverage records exact
paths, versions and ranges. Completed assistant text is quoted (last 12,000 units),
pending candidates retain path/version receipts, and recent exact saved ranges
are included when they fit. The latest complete tool exchange is retained when
it fits, so a new large read reaches the model before later compaction.
Overlapping read receipts merge only within the same source/version; unread gaps
remain explicit. Superseded task-file versions and their old text are omitted
from the model checkpoint while the original local evidence stays intact.

Full read evidence and prepared candidate text remain request-local and still
support complete-source validation and per-file explicit review/apply. Removing
old tool groups also invalidates document/project reuse references, including
version/range IDs; future reads resend omitted text instead of dangling references.
A checkpoint never turns omitted text into model-visible evidence. Already
accepted user summaries keep their existing source/version/service checks.

Explicit provider context rejection halves the working target and retries only
when the packet shrank, at most three times per logical request. Subsequent saved
read pages shrink with that target (floor 64 UTF-16 units); nextOffset and actual
ranges remain explicit. Partial failed output is discarded. Usage keeps unknown
failed calls, and retry/checkpoint counters cannot be reset by manual continuation.
Cancellation and config/workspace generation checks continue before every call.
The UI announces organization; no additional confirmation is required. Oversized
protected input/drafts or a service window too small even for policy and the task
still fail explicitly, preserving the task and pending candidates.

Regression covers a 41-page saved-file repair beyond the old cumulative limits,
full-source exact replacement after organization, provider-overflow reduction,
re-reading removed evidence, timeout continuation and large whole-project collection.

## Creator-confirmed local resources (2026-10-20)

`get_local_resources` exposes both fixed App catalogs, their existing adoption
state and module capability boundaries. For work needing a matching capability,
the edit policy requires discovery and a grouped `propose_local_resources`
recommendation before adding new standard modules or shared libraries. The
proposal explains the original task fit and impact; an optional alternative must
be a concrete viable design. `players` supplies client links and identity/token
restoration, not a mandatory nine-seat or sound policy. The work retains those
choices. Socket.IO's server package already includes its matching browser client.
All dependencies remain offline; discovery never authorizes additions.

The native task journal records bounded plans with exact catalog versions and
provenance, independently of chat text and live write grants. A UI-only decision
command approves the group or selects its stated alternative. It is absent from
the model tool contract. Existing references/modules and exact prior approvals
are reused; an explicitly named addition in captured human input can be confirmed
by the App adapter without another card. Model tool arguments and project files
cannot preauthorize it. An unapproved direct `use_local_library` or
`use_local_module` call creates a proposal instead of writing. Generic manifest
writes cannot bypass new-library confirmation. A selected alternative cannot be
silently converted into an approval or re-proposed unchanged.

A pending plan finishes the entire tool/result group, publishes a checkpoint,
closes the runner and returns `resourcePlan` without making another model turn.
Remaining task mutations/checks in that group are refused. The store projects a
card at the original assistant reply, with no spinner, send or mode switch.
Confirming resumes the same goal, message pair, mode and completed evidence;
a separate composer draft survives. Rejection only continues through the explicit
alternative button; otherwise the creator can end the task. Handoff mode discovers
and documents recommendations, without adding resources.

`awaitingResources` is a durable resume state. The checkpoint contains original
execution facts but no approval authority. Restore queries the native task's
current plans and displays the pending card without a model request; approvals
still require a fresh native grant and source validation on continuation. Chat
switches and shutdown preserve the wait, cancellation clears the checkpoint,
and Git task-ending remains independent. Native decisions are checked against
the journal owner and saved files. Stale or missing plans fail closed.

`use_local_module` reuses the frozen asset/provenance builder and exclusive atomic
module directory publication. Its exact bytes are journaled before publication;
recovery distinguishes a rename that did not happen from a published directory.
Task undo restores/removes all module files, preserves independent modifications
and removes only an owned empty module directory. Unlike manual Add module,
assistant adoption does not append unrelated handoff TODOs. The assistant must
then wire dependencies, server and pages, check and fix within the original task.
Copying a module alone is not completion evidence.

### Multiplayer resource priority and App preflight

For multi-performer identity/number selection, continuous touch, reconnects and
bidirectional performer/monitor synchronization, prefer the shipped Socket.IO
shared library plus the players connection/identity module. A successful
single-client HTTP polling test does not settle concurrency, identity recovery
or the next interaction feature. This preference does not authorize replacing
score generation, p5 drawing, sound mappings or assigning exclusive seats.

`AssistantTaskRunner.prepareResources` is an App-scheduled boundary before the
provider loop, not an optional model discovery call. `realtimeResourcePriority`
recognizes these goals from the captured input and at most three preceding human
goals in the same conversation. Reference files and assistant prose do not select
this policy. Cosmetic-only edits, static pages, documentation and explanatory
questions skip it. Other resource discovery remains available through the shared
tool contract. This is a bounded task-intent rule, not a universal classifier.

The preflight reads the current native module/library catalogs, reuses existing
adoptions, and creates one grouped native proposal for missing players/Socket.IO
resources in edit. Exact-version/provenance approval reuse remains native; the
App never manufactures an approval. The task checkpoints the original goal and
returns its confirmation card before a paid model turn or project mutation.
Catalog failures close the live grant and stop before model/writes. An unanswered
plan resumes directly to the same card. An approved group continues the original
task; a selected alternative or explicit keep-transport/no-new-dependencies
instruction is honored. Handoff receives the same preference/catalog facts but
creates no implementation approval. All sources stay local.

The short preflight review is supplied in the normal mode policy, separate from
native decision evidence. Reuse it instead of repeating discovery. Wiring must
track concurrent state per client/identity, preserve work-defined number sharing,
clear only the affected participant on disconnect, and resynchronize after a
reconnect instead of replaying stale drag coordinates. Resource copying alone
still does not establish wiring, rendering or runtime success.

Regression replay uses the real request/runner boundary with a scripted provider
that tries to skip discovery and write an HTTP relay. It must stop at a grouped
confirmation with zero provider turns and zero project writes. Fixtures also
cover the Runes follow-up wording, approval/decline/restart reuse, existing local
adoptions, handoff, explicit resource requests/restrictions, catalog failure and
cosmetic edits in a multiplayer chat. They do not claim live provider quality or
real-phone performance.
