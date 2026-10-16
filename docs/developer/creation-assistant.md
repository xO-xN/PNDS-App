# Creation assistant

The document assistant's single request entry is `runAssistantRequest` in
`src/lib/assistant-flow.ts`. `assistant-store.ts` owns the workspace draft,
transcript, progress and request generation. Components dispatch paid work through that store and use the shared assembler
for local-only previews; they start no separate model request chain.

## Installed documents and tool policy (#166)

The flow loads `helpCorpus(locale)` and reuses `buildHelpCorpus`, `splitSections`,
`buildHelpIndex` and `searchHelp`. Release requests use the installed resource
allowlist; development uses the same loader's repository fallback. No online
copy, compiled document mirror or second parser is introduced. Corpus failures
stop the request explicitly rather than substituting stale or partial documents.

Platform-only requests expose `search_help` and `read_help_section`. Authorized project requests add the saved-text readers and one declarative pending-proposal tool described below. Arguments, names, call
IDs and progress are checked before producing results. Search returns at most
three section snippets; section reading defaults to 1,200 UTF-16 units, with a 2,000-unit hard maximum
and explicit offset/total/next-offset ranges. A request allows eight tool calls, 24,000 tool-result
characters and 128 KiB of serialized context. Exhaustion fails visibly; it does
not silently truncate a supposedly complete read. The native layer additionally
limits response size, model turns and elapsed time.

The trusted system message supplies the remaining tool-call and tool-result
character budgets on every model turn, plus the maximum section size. These
counters are scoped to one request and reset only on an explicit new send;
they do not count failed/cancelled history as completed conversation. The policy
asks for relevant reads and a concise answer with stated evidence gaps when
further reads cannot fit. This guidance does not relax the hard limits or
guarantee a particular model will finish within them. Exceeding a limit still
fails without retry. `[assistant-budget]` diagnostics contain only a fixed limit
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
Only `delta.content` is displayed; provider reasoning is neither displayed nor
persisted. Tool names/arguments are assembled by index and validated only after
the complete turn. Invalid/truncated streams fail visibly and retain published
text. SSE bytes are capped at 1 MiB per turn, answer text at 64 KiB and tool
arguments at 8 KiB per call, in addition to the existing flow budgets. A service
that returns ordinary JSON for the same request is consumed without a retry.

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

`assistant_history` stores schema 3 JSON (reading schemas 1/2 additively) in the App data directory under
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
limited to 2 MiB/400 messages, with bounded text and snapshot collections. Invalid
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
The assistant's native HTTP client uses the same 120-second total session
budget, including credential preparation and intervening document turns. It
must not inherit the connection probe's 30-second client timeout. Streaming
activity never resets the session deadline. `[assistant-request]` diagnostics
contain only a turn ordinal, monotonic elapsed milliseconds and fixed typed
outcomes; no request token, endpoint, model, text, arguments or credentials.
Project commit/close, successful configuration changes and key mutations revoke
the native session. The configuration-change event also cancels frontend tool
work. UI generation and identity checks run before progress, text, result or
error commits; cancellation alone is insufficient to reject a late response after
opening the same project again. Failed requests retain input and transcript;
retries require an explicit send and never replay failed messages as successful
conversation history.

The form's Stop click cancels its browser default action before changing store
state. The action slot reuses a button between Stop and submit: a browser may
commit the idle render before click activation finishes, changing that same
button to submit and sending the retained input again. A regression flushes the
real stop transition before activation completes for pointer, Enter and Space
in both reading/responding phases; stop must never invoke send. This default-
action protection belongs to the action, not the shared Button component.

`useAssistantLifecycle` belongs to the whole creation view. A file/discussion
switch must not unregister it or stop a request. Creation cleanup can cancel a
request when manual testing stops, but cannot clear the transcript or input just
because runtime cleanup ran.

## Reading surfaces and monitor

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
from the HTTP payload. Trusted consumers require fresh explicit authorization,
current owner/service identity and enabled project reading; the creation UI supplies project and attachment consumers only through the transient consent workflow. Absent categories are not reported as already sent.

The context popup previews the next call when idle and follows the actual
call during tool loops. Capacity is manual/unverified. The ring uses the selected
encoder estimate when available and otherwise a portable o200k_base reference
count of the same serialized request. This fallback is published separately as
`referenceEstimatedTokens`; it never changes conservative admission, usage or
model configuration. No model name implies an encoder or capacity. Missing
capacity still prevents a percentage. Every displayed proportion is explicitly
labelled as estimated; nonzero values below 0.1% display “<0.1%”.
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
rounds. Failed, partial, attachment/proposal-bearing and service-mismatched rounds are excluded as whole pairs. Project rounds additionally require enabled reading, current scope consent and matching saved source versions. The input area states
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
at most eight calls/three search hits plus split read ranges without losing
provenance; this does not enlarge the tool, result, byte, token or time budgets.
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
confirmation still clears the whole project's history, rather than one chat.
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

`assistant-project-store` owns transient scope consent. The first send displays
project, service and readable paths; cancelling preserves input. Ownership,
service changes, disabled reading and expanded readable paths revoke consent.
Content versions are separate: saving or external edits refresh facts without
asking for the same scope again. History restores no authority.

The native creation capability supplies the assistant inventory, search and
UTF-16 pages. Entry paths and canonical targets share exclusions; the held-root
open prevents symlink races. Each file is bounded to 64 KiB; inventory admits
256 files / 2 MiB, searches inspect at most 64 files and return six short hits.
Exclusions and remaining search coverage are explicit. The common request entry
adds only list/search/read tools, with the existing shared calls, result and
serialized/token budgets; at most 32 distinct files are read per request.
Project pages remain request-local, outside the installed-document cache.

Actual sources retain relative path, saved version, exact text and line/range
coordinates. Source navigation rechecks the same native read policy. Project
history is eligible only with current consent, matching service and source
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
at capture in transient state. An earlier consent inventory cannot invalidate a
newer editor selection. A subsequently refreshed inventory, the current editor
disk/conflict version and buffer edits each independently detect later changes;
none overrides another observation. These freshness markers are not history or
restored reading authority.

The highest request assembler produces attachment payloads and source records
from those exact snapshots. Disabled reading blocks the entire send, retaining
input and attachments. Workspace replacement clears pending attachments; a
service change revokes sending consent. History persists actual sent snapshots,
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
restored from chat as a current test. Hover/focus opens the single-line overview;
leaving/blurring closes it. Authorized requests refresh it and assemble the same
short, visible local facts/excerpts under the common context budget; disabled
reading never includes it.

## Explicit whole-project reading (#170)

Only the whole-project action collects the admitted saved files. The preview
shows actual paths/versions, exclusions and the shared native assembler's request
measurement. The 32-file / 24,000-character admission limits apply before a
complete candidate can be confirmed; overlarge or incomplete inventories are
refused, with focused-reading alternatives. There is no truncated “whole” result.

Planning is local-only and bounded by the existing native file/page policy.
Cancellation and project/service/attachment changes retire the candidate. Scope
fingerprints are checked after collection, at confirmation, after overview refresh
and before each actual model turn. The request consumes the same character,
serialized/token budgets and highest orchestration entry as targeted reading;
usage and context measurements describe the actual outgoing assembly. History
keeps exact source snapshots but restores no full-read confirmation.

## Pending single-text proposals (#208)

The existing highest request entry exposes `propose_text_change` only under fresh
project reading consent. One request can offer at most one candidate. It must
name an allowed existing saved text and the exact version of a complete actual
read in this request's sources. Read pages may be combined; inventory, search
fragments, attached drafts and historical snapshots do not substitute for a full
saved read. Tool output is only a pending-review receipt; it cannot write, run,
start a model request or expand scope. Ambiguous/complex or cross-file work is
clarified or handed off, never automatically split into separate writes.

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

The discussion's Run independent check action opens the same identity-scoped
`CreationControlledCheck` mounted by the workspace toolbar. Opening does not
submit; its Start action uses the App/CLI saved-copy service, task ownership,
progress, cancellation, freshness and cleanup already documented in
[controlled-checks.md](./controlled-checks.md). None remains default, Internal
explicit, External manual. Runtime busy does not stop an existing performance.
No model tool manages processes, and neither chat, candidate edit nor save starts
a check. A failed report keeps edits and offers continuing discussion, the latest
guarded single-file undo and a confirmed editable repair handoff. Confirming
prepares a separate task without replacing an existing handoff draft. The existing
Record action remains the only handoff writer. Declining changes nothing; there
is no automatic repair, new model call, Git operation or copy-output adoption.

The live saved-versus-loaded notice follows the existing verified page-refresh
or restart completion: it clears only after saved changes have no outstanding
refresh/restart prompts in a ready runtime. Historical notices remain snapshots.
Source reload transport failures preserve the candidate and show a typed error.
