# Creation assistant

The document assistant's single request entry is `runAssistantRequest` in
`src/lib/assistant-flow.ts`. `assistant-store.ts` owns the workspace draft,
transcript, progress and request generation. Components dispatch paid work through that store and use the shared assembler
for local-only previews; they start no separate model request chain.

## Minimal request policies and external handoff instructions

The built-in assistant uses short policies selected by request purpose and mode;
it does not discover or install external skills. Discussion carries the question
and plan-selection rules; Work carries only the current implementation goal and
necessary execution boundaries. Tool-specific file, resource and preview details
live in the shared tool contracts and installed platform documentation. Native
permissions, version guards and argument validation remain authoritative.
Summary requests have a distinct `summaryPolicy` context kind and send no tools
or `tool_choice`. Recovery facts describe the current task without reopening
settled decisions. Provider-required reasoning replay is unchanged.

`resources/creator-project-conventions.md` is the shared source for creation
language and project-work conventions. Project Discussion and Work policies
embed it, and Blank generation embeds the same text in `AGENTS.md`; summary,
handoff drafting, document-only and legacy candidate requests do not. Its work
rules apply only during authorized implementation, so Discussion remains read-only
and project documents never grant additional task authority. Explicit creator or
project definitions override the default score/projection/instrument meanings.
Keep parameter meanings, confirmed decisions, documentation roles and delivery
states here instead of maintaining a separate built-in glossary. Detailed edit
locations and compilation/loading steps belong in the generated bilingual
implementation guides and installed contracts. This embedded resource adds no
new installed help path and does not rewrite existing projects.

Its recording rule covers required inputs and actual random/semantic choices,
work-data versions, original-record preservation, explicit legacy defaults or
bounded inference, and existing-record playback verification. Detailed extension
steps stay in Blank's implementation guide and [recording rules](performance-recording.md#work-data-versions-and-existing-recordings).
The same text reaches new Blank AGENTS and the built-in assistant once, within
the existing policy budget; work-specific migration remains in the project.

The external instruction source is
`src-tauri/resources/skills/pnds-handoff/SKILL.md`, bundled at
`skills/pnds-handoff/SKILL.md`. Its body supplies native receipts and the English
copy prompt. The Chinese locale supplies the matching prompt. Both use
`AGENTS.md` for project conventions and retain the handoff and closeout steps. The wrapper and
instructions use the conversation's Chinese or English language, independently
of the current interface language, and add the quoted actual project root. No GitHub download,
global skill installation, or project-specific skill copy is needed. The prompt
assigns **all current tasks** in `docs/creator-handoff.md`; task IDs and revisions
remain record/comparison references rather than an external single-task limit.
Existing chat snapshots use the current bundled instructions when restored,
while preserving their recorded task/revision association. This display update
does not grant execution or file authority and does not add the skill body to
ordinary model history.

Generated AGENTS entries point to the bundled skill when no copied prompt was
supplied. Completion, pending creator review and replacing superseded rules follow
[external completion and history](./handoff-baselines.md#external-completion-and-history).
Existing projects are not automatically rewritten.

## Saved file references (#335)

The assistant composer keeps project and pending-document references in each
chat's draft, above the message field alongside the selected skill. `⌘⇧P` opens
the picker while the composer has focus. The picker and native drops use the same reference list, with one
entry per project-relative path or pending-document ID. Selection reads catalog
metadata only. Explicit send captures the versioned references, verifies they
are still available, and reads their saved text through the existing bounded
project and material readers. The request treats these reads as evidence.
Explicit editor selection attachments still provide unsaved text when requested.

Continuation checkpoints keep the references captured by the original send.
They recheck the request's saved evidence and never add newly selected draft
references. Detached tasks such as handoff preparation do not consume composer
references.

## Built-in assistant skills (#349)

The composer offers `@` completion from the App registry for the current
Discussion or Work mode. A deliberate candidate selection adds one removable
skill to the current chat draft. Enter selects a candidate before a subsequent
Enter sends the message. The skill and any creator text are captured together
on send, with the current mode and instruction version. Text typed without a
selection keeps its ordinary meaning.

`@check-unused-files` uses the existing Discussion permission and bounded saved
project readers. It reports paths, evidence and uncertainty about dynamic
loading, excluded files or incomplete reads. It finishes as a Discussion
answer. The request refuses a handoff or any mutation. Only the current request
receives the skill instructions. Chat history stores the visible skill name
separately from the creator's words. A durable checkpoint restores the validated
skill and its original scope without taking edits from a later composer draft.

### Bilingual README skill (#350)

`@write-readme` runs in Work and uses the existing saved-file readers, native
version checks and draft protections. Its write scope is the root English
`README.md` and Simplified Chinese `README.zh-CN.md`. If `README.en.md` exists,
an App-scheduled question explains which file the English interface shows. The
checkpoint binds the question to the saved variant version. Cancel writes
nothing. Sync additionally allows the variant to receive the saved English
text. Keep leaves the variant available to the English interface.

The App validates the cover format and protects existing credits, cover fields
and later sections before saving. The reply's save results come from the native
task journal. The two preview buttons open the exact saved paths in the
creation editor. A partial result lists both what saved and what did not.

## Actual reading evidence

`assistant-reading-evidence.ts` is the in-process seam for actual returned read
facts. `AssistantReadEvidence` owns the request's retained source snapshots;
`ReadEvidenceView` supplies their exact coverage, complete native saved text and
complete private-material text. Full replacements, material adoption, selected
organization rules and deterministic checkpoints consume this shared view instead
of assembling their own coverage. Reader permissions, native commands, tool JSON,
page limits, request budgets and write/version checks remain authoritative in
their existing owners. A complete-text result grants no execution or write right.

Source identities keep installed help locale/document/section/version/format,
native saved path/version, attachment source/path/version, and material ID/version
separate. Ranges use UTF-16 offsets in the exact text format and version that was
returned. Complete text requires real contiguous page bodies from zero through
the observed total, with consistent lengths and overlapping bytes. Inventory,
search targets, cached help documents and compact coverage receipts cannot fill
missing text. A material display name never becomes a project path.

Native project reads have an absent `project.source` (legacy `null` is equivalent).
Explicit `saved`, `draft` and `proposal` values identify captured attachment
selections, including saved selections whose version equals the file version.
Those selections remain useful context but never count as a complete native
saved-file read. Overview and search retain their real native ranges and totals;
the whole-project action retains its collected native pages. A compact receipt
does not make all of those pages visible to the model.

Request-held text and current model-packet visibility are independent facts.
`readPacket` inspects the actual packet for visible text and reference dependencies;
it never repopulates held source snapshots. Compaction can omit a body while the
request still holds it for complete replacement or material adoption. Reuse may
refer only to text still available in the current packet; after discarded
exchanges lose their references, a later read resends the actual text. The working
checkpoint's recent saved text contains only native saved ranges; protected
attachment messages preserve selections separately.

The version-1 continuation format and source/payload limits are unchanged. A new
runtime evidence owner is reconstructed from the source snapshots retained by the
existing allowlisted serializer. Native pages with absent or `null` source retain
their original meaning; explicit attachment sources remain selections. If the
1 MiB source limit omits a body, old messages or receipts cannot restore its full
read proof: the missing ranges must be read again. Independent used-material
version evidence still invalidates removed or changed materials after body
trimming. Runtime evidence owners, packet indexes and reusable references are not
serialized as new V1 fields or restored as write authority.

Each completed in-memory checkpoint also owns an independent evidence and reader
snapshot. Continuing or failing a later tool group cannot change the earlier
checkpoint's bodies, live references, search attempts or distinct-file budget.
Runtime forks retain those values; a durable V1 restore starts without live
references and resends actual text when needed.

## Adopt private source into an Edit task (#250 / #251)

#260 replaces the immutable-copy storage with editable [pending documents](./pending-documents.md), retaining the original tool names and historical read snapshots. Explicit integration completion and durable whole-task recovery are separate from adoption and ordinary task retirement.

`adopt_creation_material` is an Edit-only task tool, dispatched by the existing
request loop and `beginAssistantTask` adapter. It takes the private material's
opaque ID, exact version, a project-relative destination and optional complete
adapted text. Before dispatch, the flow requires all actual material page text at
that version; metadata, summaries and coverage receipts cannot substitute for
missing ranges. Trimmed checkpoint snapshots therefore require another read.
Adding materials and Discussion never grant adoption authority.

The `adopt_creation_material` tool contract directs placement from actual entry
and references, directory preparation, dependency/loading wiring and checks.
Optional adaptation changes only the project copy. The compact edit policy keeps
work within the current task and preserves existing artwork behavior; final
reports distinguish actual saved changes, checks and evidence gaps from runtime
and artistic/device acceptance. Existing live-runtime observation still cannot
establish that newly saved source loaded.

Native `adopt_assistant_material` resolves only the current saved pending
document, rechecks its opaque revision and uses the normal journaled writer for publication.
It accepts no external source path. Identical destination bytes are reusable
without acquiring ownership. A differing destination atomically records a private
reservation and its canonical scoped question. The reservation freezes the exact
material ID/version, target saved version, candidate bytes/digest, concrete free
coexistence path and task/chat/reply owner. Native excerpts show the actual first
difference with bounded context, including long lines and line endings. The
existing question card localizes the recommendation and concrete consequences;
no option is preselected. Machine prompt/option labels stay bounded tokens; complete paths remain in the bound facts and localized display. Journal publication validates questions and their material bindings before replacing the prior recovery record. Pending and free-text receipts report no saved change.
Generic questions and local-resource approvals never authorize replacement.

Only `adopt_creation_material` consumes its own linked explicit `replace` or
`coexist` answer, after fresh source, target, grant and question checks. The trusted
adapter independently protects original/coexistence paths and every parent from
editor drafts. It returns the actual adopted path for subsequent loading/reference
wiring. Replacement uses the normal versioned writer; coexistence uses its
exclusive publication and keeps the original target reservation, so a later
generic write/removal cannot undo that choice. Free text guides the same original
goal, with no overwrite permit; the assistant can clarify or use a safe new path.
The first consume after free text records a guidance receipt. A later exact adoption call can append a fresh linked conflict question after clarification, retaining the original answer and task; it still needs an explicit choice. A changed candidate cannot reuse a prior answer.

A consumed receipt is durable and bound to exact task-owned saved bytes. Repeated
adoption can report that receipt only while those bytes still match. Interrupted
publication reconciles the existing file journal before restoring a receipt; it
never replays an answer over later creator content. A destination that appears
during exclusive creation is recorded as a fresh material conflict. Earlier
unscoped reservations remain closed to generic writes and require explicit scoped
adoption to obtain a new question. Originals remain in existing task undo.

Question recovery restores facts without a model call or live write grant. After
a stale material answer fails, the card offers explicit revalidation. Native
continuation can replace a changed bound target's question with a fresh pending
question linked by `supersedesQuestionId`. The request loop accepts only that one
native-proven target version change, discards prior tool/read/check evidence and
retains the captured task/input/message owner. Unrelated project changes retain
the ordinary strict freshness refusal. Removed or changed saved pending content blocks
continuation with guidance to keep this task for undo and resend the preserved
goal using a current saved version; an old decision never authorizes that copy.

The existing owner, directory-inode, excluded-path, symlink, editor-draft and
saved-version protections still apply. Each proposed path prefix is checked for
drafts. Native saves update the normal workspace and invalidate saved-copy check
evidence; the original request loop checks automatically and repairs within the
same task. Files and necessary directories share existing whole-task/per-file
undo, which validates later creator changes before restoring anything. Adoption retains private originals; only explicit whole-task completion consumes
the selected saved versions after durable recovery is published. Whole-task undo
and originals-only restoration use that independent recovery record, protect
newer edits and never change the selected external file. See
[pending integration and recovery](./pending-documents.md#explicit-integration-and-recovery).

The controlled replay uses the real request loop and task adapter, with native
commands substituted at the system boundary. It evaluates the newly saved entry
and cooperating Grid/Pattern scripts, observes the existing artwork trace and
resource, then repairs a real missing-resource failure through automatic
check/recheck. Native temporary-project tests establish original retention,
versions, modes, ownership, direct paths, durable collisions and protected undo.
These checks do not establish real-model placement quality, macOS interaction,
sound or artistic fidelity.

## Private text material reading (#241 / #249)

Discussion and edit expose the read-only `list_creation_materials` and
`read_creation_material` contracts through the same request entry and native
private-material commands as the creation workspace. Platform chat, context
summaries and handoff drafting cannot call them. Listing returns only the current
project's material metadata; adding, retaining or listing a copy never sends its
original text. A read uses the native material ID and exact version, with UTF-16
offsets, an explicit next offset and a 64–65536-unit page limit. Only actual returned
ranges enter the following model turn. A material's display name never becomes a
saved-project path, replacement-read coverage or extra write authority.

`assistant-materials.ts` owns request-local page references and independent
material-version evidence. Reads recheck the private catalog after receiving the
page; removal, native failures and lost workspace ownership cannot publish a new
success source. Every paid turn and completed reply revalidates all used material
versions. Durable continuations retain this evidence separately from their
bounded source snapshots, so trimming a snapshot cannot allow an old completed
tool transcript to replay a removed copy. A missing or changed used copy rejects
continuation with the existing scope-change feedback.

Material pages share the existing call, result-character, working-packet and
provider admission budgets. Compaction records material IDs, names, versions and
exact read coverage separately from saved-file coverage. Omitted original text
stays omitted, and resetting page references makes a later read resend the text
instead of pointing to a discarded exchange. Returned/reused character metrics
cover material tools as well as installed help and project reads.

History sources have an additive `material` snapshot, exclusive with `project`.
The native history boundary checks project scope, identity, version and exact
UTF-16 ranges. History selection admits material-derived rounds and summaries
only against a fresh current-project catalog; a platform-scoped record cannot
bypass that check. Derived replies keep the material provenance so later removal
also excludes their facts. Summary and handoff inputs without fresh material
validation conservatively omit those records. This leaves full local history
visible without automatically resending retained originals.

A material source opens the ordinary pending-document editor through the
identity/ID/version navigation intent. A missing or changed requested saved
version is unavailable; opening current saved content is a separate action. The
labelled request snapshot remains inspectable in the transcript with its original
text, name and version. Neither navigation nor historical text restores a write
grant, and a pending ID never becomes an ordinary project-file path.

Request replay tests inspect actual following-turn packets for both creation
modes, exact ranges, unrelated-text exclusion, failures, removal/switch isolation,
history/continuation validation and compaction receipts. Native tests establish
that the pages originate from selected private files, remain project-isolated
and survive restart; controlled HTTP replay checks their emitted provider packet.
These checks do not establish real-model interpretation or macOS visual fidelity.

## Reply and work-log presentation

`AssistantMarkdown` owns message display with `body` for the main assistant
reply and `compact` for user messages and public work steps. It uses the same
CommonMark/GFM parser for pending and settled content; source text, history and
provider packets remain unchanged. Display rules live in
[message typography](./ui-patterns.md#assistant-message-markdown).

Code fences and indented code use `AssistantCodeBlock`. Copy takes the current
parsed code value, normalizes CRLF/CR to LF and preserves its whitespace, excluding
the single display LF added by mdast-to-hast. A pending reply labels its code
blocks as “Reply in progress”; copying takes the clicked snapshot, independent of
later stream updates. Markdown fences remain literal source, and task checkboxes
are read-only. Links and images remain inert labels; recorded sources retain
their existing verified actions.

Markdown element renderers have stable module-level identities. A local context
carries the pending flag so stream updates, completion and reading-state renders
preserve code-control focus and selection. Markdown components reuse the existing
transcript geometry observer and never own a second scroll/focus mechanism.

The main reply renders actual cumulative content prefixes as soon as the native
stream publishes them, while the request is still pending. This includes the
public answer or plan of a single Discussion completion tool. Its preview stays
visible through validation, and a rejected completion clears it before retrying.
The provider controls the pace and boundaries of updates. The current prefix replaces the
previous one, including incomplete Markdown; final settlement renders the same
answer without appending it again. Failed/cancelled partial replies stay visible
in the main body. A completed tool turn moves its public commentary once into the
closed-by-default activity disclosure before the next reply streams; this avoids
duplicating progress in the final answer. A Discussion plan must be fully
reviewable in the main reply. Work completion reports can stay concise.
`AssistantThoughtLine` shows the current phase even before public activity
arrives. Its decorative S3 lattice uses nine fixed dots, with an eight-cell
clockwise comet fading over a 1.7-second cycle and a dim centre, beside a
1.8-second text shimmer and a 350ms settle transition. The 28px HTML stage fits
a 20px icon; 3px dots use a 6px pitch and 6.5px grid offset. The dots remain
circular across themes, with higher resting opacity in Stage. Stopped work
shows the resting grid; reduced motion lights the centre of a static grid.
Completed public tool activity forms its manually expandable step trace; it
starts closed and closes again on completion, failure or pause, with later
expansion still available. The current reply is never hidden solely in that
trace. Its local clock measures only the mounted working cycle, survives phase changes, freezes when
work stops and restarts from zero on retry. Restored history has no recorded
duration and never receives a fabricated elapsed time. Reduced-motion preference
stops all animation; Brutal retains the comet while keeping text and settle
effects static.

`CreationAssistant` retains the single screen-reader phase status and the
composer loading/stop control. The streaming body is ordinary readable content,
outside live/status regions, so each prefix does not announce the whole answer
again. Reduced motion keeps real content updates immediate without a typing
animation. There are no body loading dots or creator-facing server-usage
disclosures. DeepSeek `reasoning_content` is retained separately for
internal protocol replay and never stored as this activity;
other provider profiles continue discarding it. Old histories with
already concatenated reply text retain that text; the App does not guess its
boundaries. Source actions and model-authored-link restrictions remain unchanged.

The flow keeps completed commentary in its request checkpoint so pausing or
retrying preserves the same goal, tool evidence and display log without repeating
it in the final reply. Activity is bounded to 128 entries, 4096 Unicode code
points per entry and 16384 UTF-16 units overall, dropping oldest display entries
when needed. Authoritative tool messages/receipts are independent. The activity
field is not included in later model history or user-reviewed summaries.
The compact reply policy asks for brief tool progress and a useful final outcome
with actual changes, checks and evidence gaps; Discussion additionally requires
the complete agreed plan in the main reply. Parameter publication and saving are
specified by the `expose_project_parameters` tool contract and the App's existing
controls. These presentation rules do not change the service's reasoning
configuration.

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
workspace switching retain the last completed boundary. Journals belong to
unfinished-task recovery and are cleaned after explicit retirement, as described
in [task snapshot retention](#task-snapshot-retention-2026-10-23). This is one unfinished task per project, not a background
scheduler. A failed checkpoint save/verification is visible and never silently
treated as durable progress.

## Task-owned project directories (#244)

`create_project_directory` is an Edit-only task tool. It prepares necessary
nested project directories through the existing native grant and journal, then
`create_project_file` saves through the usual version/draft protections. Materials,
discussion and restored chat history confer no directory authority. The tool
obeys the original task and creator-forbidden paths; it is no general filesystem
or terminal channel. Existing real directories are reusable and never become
owned merely by reuse. Files, aliases, excluded paths and invalid project owners
are refused. The frontend also preserves drafts at every proposed path prefix.

Native traversal opens each direct directory component with `O_NOFOLLOW`.
Missing directories are staged beside their destination; the journal records
their device/inode before exclusive publication. Recovery distinguishes a
published matching inode from unpublished staging, preserves verified partial
progress and never guesses ownership from a directory name. Subsequent writes,
continuation and undo recheck owned inodes. The journal remains backwards
compatible through an optional directory list; public task changes mark these
entries with `directory: true`.

Empty directories do not change the saved-text fingerprint. A restored request
therefore receives fresh native directory receipts even when creation's original
tool reply was lost. A failed nested preparation also synchronizes and reports
the task's verified partial directory progress without claiming the child exists.

All successful mutations use `synchronizeSaved` to update the existing file
tree. A synchronization failure does not repeat completed native creation.
Whole-task undo validates files first, restores/removes task files, then removes
owned empty directories from children to parents. Reused directories, creator
files and externally replaced directories are preserved. Nonempty owned
directories remain visible in task recovery with localized feedback. The normal
Undo buttons retain keyboard support; no additional creation UI is introduced.

Controlled request replay covers directory creation, pause and serialized
continuation, subsequent file saving and checks. Native temporary-project tests
cover grants, containment, aliases, ownership, interrupted publication/removal,
partial failure and safe undo. See [#244 evidence](../acceptance/244-assistant-directories.md)
for the remaining real App/model checks.

## One creative question at a time (#238)

`ask_question` is a declarative task tool in the shared manifest. It accepts one
prompt, zero to four choices with tradeoffs and an optional recommended choice;
free text is always available. Native validation rejects duplicate choice IDs,
unknown recommendations and invalid bounds. No choice is preselected. Ordinary
grilling cards are numbered Q1, Q2, … within the current chat using distinct
question IDs; answered/cancelled questions retain their numbers, and a new chat
starts again. Clicking an option, or activating its button with Enter/Space,
submits that answer immediately and continues the original task. The recommendation
is a small outlined rounded badge at the option’s trailing edge.
Ordinary explanations and final replies remain prose. The short Discussion
policy adapts grilling and domain modeling: look up available facts; ask one
consequential unresolved decision at a time with a recommendation; clarify
ambiguous terms through concrete performer scenarios; check statements against
the saved project and preserve original constraints. After each answer, revisit
the dependent choices rather than treating one answer as design completion.
Before offering the next step, put the complete plan in the main reply and
separate agreed choices from suggestions and explicitly excluded/deferred items.
Ordinary factual questions do not require an interview. No question count,
readiness score, design-tree database or extra confirmation stage is introduced.
This is model guidance, not an artistic quality guarantee.

The native task journal owns canonical question records and captures their
original project, task, chat and reply scope. A pending question blocks native
mutations, resource adoption and checks. The request loop completes the question's
tool group with waiting receipts for every later call; it starts no next model
turn until an actual answer is submitted. Answer submission accepts one valid
choice or nonempty text, verifies the current project/task bytes and scope, and
atomically changes only the private record. It creates no write grant, resource
approval, handoff consent or external dispatch. Edit continuation reopens the same
original goal and mode through fresh native admission. Every Discussion task stays read-only, including after answers. Manual handoff
drafting uses the same question lifecycle and the separate reviewed record
boundary described below.

Before a resumed model turn, `reconcileQuestionReceipts` refreshes stale
`awaitingCreatorAnswer` tool replies using canonical terminal question facts from
the same native task, question ID, chat and reply scope. Both status/answer and
the waiting note are replaced; unrelated messages and saved checkpoint inputs
stay unchanged. System evidence explicitly continues from submitted answers:
ask only the next consequential gap, or preview the confirmed plan with
`propose_handoff` for the creator's next-step choice. An answered question must
not leave a contradictory pending tool receipt or a prose-only restriction that
prevents this read-only preview. No reconciliation grants implementation,
resource adoption or formal recording. Completed old replies are not retried
automatically and local history is not rewritten by this repair.

Questions and submitted answers persist as bounded history records on the
original assistant reply. Later questions append to the same record rather than
overwriting earlier answers. Future model history and user-reviewed summaries
include these facts as reference data; automatic context compaction retains the
native task evidence. Display-only copies keep their original task/scope facts,
but cannot activate against a copied reply. Recommendations remain suggestions.

The transcript groups answered and cancelled questions into one initially closed
“Questions this turn” disclosure before that reply's body. Expanding it retains
the original numbers, prompts and actual answers; all pending questions remain
after the body, including restored questions that still require Continue.
Submitting a current answer transfers focus to the stable history summary only
after a canonical terminal result arrives. Failure leaves the live card and input
intact. Browsing the disclosure pauses automatic following before its geometry
changes; a fresh user message restores following. This presentation does not
change task/scope identity, native history, authorization or continuation.

`awaitingQuestion` and the checkpoint's optional `waitingQuestionId` and immutable
`questionScope` preserve a complete boundary. Reopening only shows historical
content and Continue. Continue validates the same saved owner and model/task
configuration, rebinds native authority, and makes a pending card answerable
without calling the model. Canonical answers written immediately before a crash
are read from the journal. Chat-key promotion does not rewrite the captured
question scope. Stop retires execution recovery synchronously, but changes question
history only after native confirmation. On a failed or uncertain cancellation,
the App rereads the private question journal: a submitted answer is preserved if
it won the race, otherwise a specific cancellation failure is visible. No
reconciliation resumes execution. If the workspace closed before its receipt,
history loading reconciles existing pending display records from the current
project’s private task journals even without a checkpoint. Reads are deduplicated
by task; only terminal facts with the exact original question/task/scope are
projected. Missing, failed or mismatched records remain unchanged, and deleted
records are never recreated. Store ownership/generation guards still govern the
load result. Workspace or chat switches retain a readable checkpoint. Deleting the question’s chat clears and fences its active submission;
promoting a surviving chat remaps only its runtime association, including an
answer already in flight. A submission latches its question
ID and task lifetime, so duplicates and late replies cannot answer the next card
or resume another project.

The ordinary card keeps a labeled free-text textarea visible alongside the
option buttons. Enter or its small send arrow submits nonempty text; Shift+Enter
inserts a line break and IME composition never submits. An in-flight latch disables
all answers against duplicate activation; a failed send preserves authored text
for retry. There is no Submit answer / End task row. Cancel this discussion round
lives in the existing conversation More menu, guarded by the current owner,
chat/question/task and idle/non-submitting state. Historical/restored cards remain
read-only until explicit Continue revalidation. Material replacement conflicts
retain their separate radio selection and explicit confirmation; choosing a file
overwrite is not ordinary grilling. Wrapping, logical spacing and semantic colors
retain minimum-window, RTL and theme support.

Workflow coverage lives at the existing `assistant-task-flow`, store restart,
checkpoint and card interaction seams, complemented by native temporary-project
journal/permission tests. Controlled model results prove waiting, answer-dependent
follow-up, original edit-task continuation, cancellation, duplicates and late
results; they do not prove real model creative judgment or macOS interaction.
See [#238 acceptance evidence](../acceptance/238-creative-questions.md).

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

### Assistant check policy

`AssistantTaskChecks` owns each task's pending check obligation, evidence,
invalidation, reuse, bounded summaries and recovery verification. Tool handlers
report confirmed native saves with `saved()`; verified new directories from a
partially failed operation use `recoveredPublication()`. Ordinary saves retain a
runtime blocker, while partial directory publication clears all old evidence.
Workspace synchronization failure does not undo a confirmed save.

The flow restores evidence only after native task admission and inventory
reconciliation. The version-1 codec retains `needsCheck`, `lastCheck` and
`lastCheckId`, including their existing missing-field defaults. Only the check
module changes their runtime values. `checkpoint()` returns an independent
read-only compatibility projection; `contextEvidence` supplies the existing
compaction summary. Neither projection grants execution authority.

`requested()` handles model check tools. `beforeReply()` invokes the same normal
tool entry, preserving question/resource gates and unified refusals, then settles
the automatic obligation only on a normal return. Cancellation or a thrown error
does not settle it. The flow retains message order, pause points and the existing
budget distinction between automatic and model-requested checks. The shared
`CreationCheckRunner` still owns check execution/cancellation, and the native
adapter owns authorization, runtime exclusion, input evidence and cleanup; this
module adds no timer, queue or separate closing lifecycle.

Tests cross this interface for save/check/reuse, version-1 restore, partial
publication, automatic refusal/cancellation and independent projections. Complete
flow/runner replays retain the tool-entry and saved-file workflow coverage.

## Work builds, tests and delivery evidence

Before a Work reply can finish after saved changes, the check adapter asks the
native task owner whether compilation is required. Changed standard SCD inputs,
missing required artifacts and stale task build receipts trigger the existing
compiler automatically. `compile_synthdefs` uses the same operation when explicitly
requested by the model. No additional creator confirmation or toolbar click is
needed. Compiler discovery, failed execution and successful artifact validation
remain distinct results; actionable errors return to the same request loop.

`assistant-task-build.ts` projects bounded model diagnostics. Native compilation
retains the complete report and exact input/artifact versions in the task journal.
Published binary bytes use task ownership, cancellation, conflict checks and undo;
generic text tools cannot read or overwrite those binary entries. Native recovery
validates their versions independently of the text inventory. A recovered check
also revalidates the build receipt; later source or artifact changes invalidate it.
Compilation does not restart an active performance.

For non-document changes with supported saved `*.test.js`, `*.test.mjs` or
`*.test.cjs` entries, Work runs the fixed Node test operation before the normal
saved-copy smoke check. `run_project_tests` exposes the same task-authorized
operation. It uses the bundled Node, existing runtime lease, temporary copy and
owned process cleanup, without a shell or dependency installation. An active
performance blocks execution; no supported entry is `notExecuted`, not a pass.
Actual exit code, test entries, output and saved-input evidence accompany the
result. A fresh failed result can be reused until inputs change; tests still need
assertions that match the creator's trigger, sustain and ending rules.

`checkOutcome` is bounded display-only history data from the trusted task check
adapter. It separates saved paths, static contracts, compilation, project tests,
runtime observation and behavior. An existing ready runtime produces `partial`
with `savedChangesVerified: false`, never a pass for new saved code. Its native
generation identifies the observed instance. The chat shows this evidence above
the model reply, including after restart; it grants no request authority. A
document-only task needs no audio/runtime stages. A passing saved-copy smoke check
still leaves interaction, sound and artistic fidelity unverified.

Pending runtime/behavior evidence offers **Continue verification (Work)** when
the original public creator goal is still available in the same topic. Explicit
activation starts a new authorized Work request with that goal and the old
receipt as historical reference, using current project/material admission. It
restores no task ID or grant and implies no listening approval or permission to
restart a performance. Busy states and unsent input disable the entry; the
creator need not redescribe the original goal after a manual step.

## Task snapshot retention (2026-10-23)

Git remains the primary lasting file-recovery mechanism. Task journals retain
before/after/pending text only while a task is running, interrupted or waiting to
resume; removing the task-undo menu does not itself establish a terminal state.
`endCreationAssistantTask` only revokes the current native grant and must retain
the journal for pauses, questions/resources, recoverable failures and workspace
teardown. Successful completion first persists the final chat. Explicit
cancellation also preserves canonical question/answer receipts before finishing
recovery cleanup; a failed publication must not discard its only durable copy.

`clearCreationAssistantResume(identity, taskId)` is the explicit retirement
boundary. It acts on the captured task even if its checkpoint is already absent,
but never removes a different task's checkpoint. Native code serializes retirement
with ordinary journal writes, durably marks the journal retired, unlinks the
matching checkpoint and then removes the journal. Retired and missing journals
cannot be resumed or recreated by late checkpoint saves. Reopening recovery or
admitting a task retries interrupted cleanup. This uses no lasting snapshot
archive or permanent per-task tombstone. Corrupt or foreign records are not
silently treated as finished, and legacy journals without terminal evidence are
not deleted merely because they are old or lack a checkpoint.

Pause, waiting, recoverable failures and closing/switching the workspace keep
their existing explicit Continue behavior. Completion, explicit cancellation,
replacement and an explicit Git task-end retire the matching task. Cleanup does
not undo source changes, create a Git commit, change Git refs, delete chats or
remove creator materials. Later parameter saves acquire their own short native
Edit task, so completed model journals need not remain for UI controls.

## Explicit creation modes (2026-10-17)

New conversations and newly opened projects default to **discussion**. The
localized Discussion / Work selector (internal `discussion` / `edit`) remains visible. Sending captures the mode;
an active task and its manual continuation keep it. Switching mode preserves
chat, composer input and file drafts, affects future sends and starts no work.

`AssistantModeSwitch` adapts React Bits RubberSegment to these two controlled
values. Motion drives its clipped thumb, drag resistance and release spring;
the store remains the only mode owner. External mode changes jump to their actual
slot, and a rejected change returns the thumb to the store value. Running work,
resource approval, an unanswered question or history operations disable the
selector and cancel an in-progress drag. Native button clicks retain Enter/Space
and assistive activation; arrow/Home/End selection keeps roving keyboard focus.
The duplicated thumb labels are decorative. Resize, fonts, locale and direction
changes remeasure the actual slots; reduced motion and Brutal settle immediately.

Discussion exposes saved readers, `ask_question`, ordinary-answer
`complete_discussion` and read-only `propose_handoff` next-step previews. The shared manifest never
exposes `write_handoff` in any mode. Native file writes require an Edit grant,
including creation and updates to `docs/creator-handoff.md`; removal, resource
adoption, preview installation and checks retain their Edit admission. A question
answer creates no new authority. Old serialized `handoff` modes deserialize as
Discussion in native journals and resume records. Their old completed evidence
remains readable, but fresh continuation rebuilds the current read-only policy
and cannot restore the cancelled handoff write capability. Platform-only and
summary requests also hold no project write grant.

### Discussion to work and handoff (2026-10-21)

`propose_handoff` in discussion accompanies a complete, visible plan. Consequential
choices must be settled or explicitly excluded/deferred by the creator; a list
of future decisions is not a completed plan. The preview grants no write or
dispatch authority. `AssistantWorkflowCard` offers Write handoff file through the
existing current-topic draft/review/record path, or Start work. Both routes carry
the same selected plan and submitted answers; neither re-interviews settled
choices or converts unrelated suggestions into accepted requirements. A new
critical conflict can justify an explained return to clarification.

Discussion has explicit terminal receipts: `complete_discussion` publishes an
ordinary answer without a card; `propose_handoff` requires the complete public
`plan` and publishes that exact text with both actions. A later free-form summary
cannot replace the plan. A plain final response without a terminal receipt gets
one protocol-repair turn. Failure preserves the public content with an accurate
incomplete notice and no live actions. Argument rejection reports its real reason.
The shared schema and runtime validation accept empty `knownProblems` without
inventing an unresolved issue. Minimal diagnostics record mode, terminal kind,
repair/rejection and publication state rather than private source or reasoning.

The store validates current identity, latest completed reply, conversation, live
proposal, editable source and idle state before Start work. That click adopts
the displayed plan, selects Work and sends a **new** task, without a prerequisite
handoff file or another confirmation button. Historical/restored or superseded
plans never reacquire execution authority.

Fresh explicit `Start work`, `开始工作` and `直接工作` inputs share the button
selection route. A missing valid offer is a local, visible refusal; it does not
fall through to a model telling the creator to click an absent button.

New history stores a bounded `discussionPlan` display snapshot whose plan must
equal the public reply. Restored snapshots are read-only. Explicitly selecting
one again validates current project sources and material versions, saves a new
selection and plan copy, then offers the next-step actions. Selection alone starts
no task and restores no old grant. Legacy unstructured replies remain readable
without being inferred into executable plans.

Selection adds one narrowly scoped creator source for the chosen plan's
final public reply and, when live, its card fields; the original assistant
messages remain suggestion sources. Activity and provider reasoning are excluded.
Write handoff can explicitly select the current historical public plan as read-only
reference without restoring its execution permissions. Start work still requires
the current live offer. Accepting a plan selects its task, not factual verification
of reference data. Native
material references in the selected reply are checked against the current
catalog; removed or version-changed materials refuse selection.
The same material ID/version evidence accompanies the new request and its private
checkpoint, so slow preparation, retry and restart revalidate it before another
provider turn. Handoff formatting gains no material-reading tool or write grant.

The discussion plan remains in private chat history. There is no default
`creation-plan.md`: the existing `docs/creator-handoff.md` remains the portable
reviewed task/status record and comparison seam for external implementation.
Only the separate reviewed Record action publishes the App-generated handoff and
captures a baseline; later authorized external work maintains its own active
block and execution archive. Durable
terms and decisions may be maintained in suitable existing project documents
during authorized recording/work; do not create a glossary or ADR scaffold for
every conversation. A separate ADR needs a consequential, costly-to-reverse
tradeoff whose reason would otherwise be unclear.

`assistant-workflow.ts` recognizes a small set of fresh explicit organization and next-step commands. Only a newly submitted creator input is routed; retries, question answers, edited historical messages, documents, model suggestions and continuations cannot switch mode. Ambiguous questions and refusals stay discussion. Organization tasks use PNDS defaults in the captured work policy, with supplemental rules supplied in chat or named documents/materials; the three old composer actions are unmounted. `organizeProject` retains its scoped source/version entry for existing task continuations.

The composer keeps the new draft editable during processing. Sending clears only the captured input, preserving text typed during asynchronous preparation; pausing keeps unsent input and saved files. The reply retains its screen-reader status alongside `AssistantThoughtLine`; the 30px pause button keeps its rotating loading indicator. Reduced motion disables rotation. Empty/ready/busy states retain its size, and the model label is separated by 16px. Synchronization and context-window details remain available on demand; per-message server consumption is not shown to creators. Context limit errors remain visible outside the closed popover.

### Default project organization (#252)

**Organize project** submits one explicit Edit task through the existing assistant
store and request path. The localized task text is shown as the creator's message
and captures the PNDS default rules as the immutable original goal. Checkpoints,
continuation, context organization and restart retain that same goal; a later
language change does not replace its rules. There is no separate write grant,
Skill system or maintenance executor.

The defaults require actual manifest/runtime contracts, entries, responsibilities
and references before structural, naming or redundancy changes. A move maintains
its imports, script order, routes and resource references. Existing suitable
layouts remain valid; filenames alone do not establish unused code. Algorithms,
composition, generation, artistic parameters, sound mappings, visuals and performer
interaction remain within the original work. New dependencies, artistic redesign
and unrequested performance optimization are outside this default task. Missing
evidence or a required behavior change must be reported as a concrete blocker.

The entry preserves unsent composer text and selections and excludes those
attachments from this request. Preparing an independent task does not validate
unsubmitted selections. Continuations with captured attachments retain the normal
attachment validation. A busy request, resumable task, question/resource decision,
question edit, whole-project plan or unavailable history blocks another
organization action. The visible **Continue task** action explicitly resumes the
captured goal even when a different unsent idea remains in the composer; editing
that text retires the continuation offer through the normal `setInput` behavior.

Saving, draft/version protection, necessary directories, checks, same-task repairs
and whole-task/per-file undo reuse the ordinary Edit workflow. Completion reports
the default basis, actual read evidence, actual changes and check scope separately
from unverified visual, sound, performer and artistic effects. Scripted replay
exercises saved module/resource resolution, a real fixture failure and repair,
preserved source/parameters and undo; it does not establish real model judgment or
artistic equivalence. Supplemental rules use the same path described below.

### Supplemental organization rules (#253)

**Organize with rules** keeps the one-click default action available. Its local
review dialog accepts this task's text and up to eight saved project-text or
private-material references. Opening lists metadata only; it sends no model
request and reads no reference text. The component is keyed by project/chat,
fences late catalogs and rechecks that captured owner on submission. The ordinary
composer and unsubmitted selections remain separate.

The visible original goal includes the defaults, the text, exact selected
identities/versions and conflict policy. `organizationSources` captures that same
bounded reference set before asynchronous preparation. It is an additive,
validated checkpoint fact; the task lifecycle restores it without restoring
permission. Continuation cannot substitute another reference list. Existing
version-1 checkpoints without this optional field remain valid.

Before the first paid turn, the normal request loop reads selected versions through
`AssistantProjectTools` and `AssistantMaterialTools`, preserving their real
range sources, material evidence and shared result/call budgets. Paging uses the
existing working-context compactor between completed reads, so a large selection
does not grow an unbounded checkpoint before model admission. Coverage receipts
distinguish omitted text from visible rules; necessary omitted ranges must be read
again. A continuation rereads exact selected versions, never a current replacement
with different rules. If this native task itself moved or edited a selected
project document, complete retained original pages can be supplied again as the
original rules. Missing/gapped original text blocks this continuation rather than
silently adopting the new document. Private originals remain unchanged.

The policy treats source contents and embedded to-do lists as reference, rather
than another implementation queue. It asks for one concrete `ask_question` with a
recommendation when rules conflict, forbidden changes block maintenance, or a
next step would change the work. The ordinary native question journal stops
mutations/checks while pending. Explicit answers guide the same organization
goal; they cannot turn it into artistic redesign or an independent performance
optimization task. Existing task grants, fingerprints, material-version checks,
answer scopes and lifecycle fences reject stale/cancelled/late work. No rules
interpreter or new write path is added.

Saved changes, reference maintenance, checks/repairs and task/per-file undo remain
the default Edit path. Reports name actual read evidence, decisions, changes,
checks and unverified artistic effects. Controlled cases exercise the three
source forms, conflict waiting/answers, restart, pagination, source changes,
reference execution and rollback. They do not establish real-model rule
interpretation, macOS UI fidelity or visual/sound equivalence; those remain #172.
See [#253 evidence](../acceptance/253-organization-rules.md).

### Manual current-topic handoff (#239 / #246)

Discussion offers **Write handoff file** contextually or accepts an explicit
natural-language request. The store selects
`conversationMessages(activeConversationId)`; other topics, unsent input, file
drafts, private activity and reasoning are excluded. Handoff-generation actions
are not creator requirement sources. Ordinary substantive document-writing tasks
remain valid requirements. Actual submitted choices retain both their labels and
descriptions, or the creator's free text, including numeric values and units.

A current live plan directly prepares the editable task from the public plan,
its scoped files and acceptance, and the submitted decisions. This route makes
no second model request to reclassify the plan. An explicitly selected historical
plan fixes the same public text and decisions as the task intent; a bounded
`handoffDraft` request can extract files and acceptance from that text, not invent
a replacement goal. Extracted paths and acceptance must occur in the selected
plan. An ambiguous historical scope returns for clarification instead of silently
omitting tasks. Selecting reference text creates no write grant.

The fallback keeps the existing read-only request, question lifecycle and
checkpoint path. Confirmed fields must cite supplied creator/answer sources;
invalid JSON or attribution gets one correction attempt. Provenance validates
references, not arbitrary model semantics. The chosen plan remains fixed even
if a formatter proposes a different requirement. Its source selection and answer
text survive interruption through the existing bounded checkpoint validators.

Consequential questions and contradictions must be resolved before discussion
presents the next-step plan. Explicit creator exclusions or deferrals are settled
scope, while `knownProblems` records implementation or verification gaps. A
nonempty `openQuestions` cannot become a successful draft. If a fallback discovers
a genuine missing decision, the existing question tool must obtain a new actual
answer before drafting can succeed; clearing the JSON array alone is insufficient.
The clarification boundary survives pause/restart. Formatting failures cannot
turn that requirement into another document-format interview. The same project,
material-version, owner and cancellation checks remain in force.

Generation opens the existing `creation-handoff-store` dialog with a stable
pending task ID and writes no project file or baseline. Cancelling retains its
edited fields; reopening the same discussion result reuses the draft without
another model request. A generated result initially uses its persisted reply
UUID for the new task. Selecting an existing task retains that task's ID;
explicitly selecting a new task creates a fresh UUID while retaining the reply
association. Returning after another topic or a restart resolves the actual
task/revision in the existing baseline catalog and reopens reviewed task fields;
identical reviewed input therefore reuses its original revision and origin.
Catalog failures or damaged matching records fail visibly instead of generating
a replacement task. No task association is inferred from localized text.
The dialog first presents a readable task with Edit task for changes; new tasks
do not ask the creator to supply an initial status. Preview handoff shows the
actual complete active document that Record will publish. Manage existing content
is an optional, version-guarded editor for correcting old errors or obsolete work,
not a mandatory raw-disk pane. A recognized correction of the same task replaces
its older revision; unrelated unfinished tasks and unknown text remain by default.
Explicit content corrections archive the previous saved document under
`docs/handoff-history/<contenthash>.md` before replacement. Nothing is deleted
merely because chat claims completion. Only the separate reviewed confirmation
records the task and saved-file baseline. Draft choices, disk conflicts, receipts,
immutable pending origins, retry and comparison retain
[their contract](./handoff-baselines.md). Switching project or ending
the request fences late generations. Catalog lookups and document opening also
carry owner/topic lifetime guards; a late result cannot open its old task in a
new topic. Handoff-draft answers, output-limit recovery and manual continuation
retain the structured JSON protocol, with only `ask_question` for a missing
decision. No external agent is dispatched.

A recorded task absent from the current list opens as a read-only record, not a
new pending task. Create a new task from this record explicitly assigns a fresh
identity before allowing publication. Reopening a record never silently adds
archived work back into the active list.

A successful native write updates the originating chat reply from draft-ready
to recorded and stores a copy-only external-agent prompt. Reopening can reconcile
a stale draft-ready reply from an actual native record; drafting alone never
claims recording. The prompt includes the bundled instructions to read AGENTS,
the active handoff and existing terminology/design documents, complete all
current tasks, and run checks. After actual successful implementation/checks it
archives full completed tasks, changes, check results and unverified items in
`docs/handoff-history/`, then removes completed active items without another
creator approval. Pending creator listening, visual or device review is recorded
in that history report and alone does not retain an implemented and checked task.
Only unimplemented or blocked work remains active, with reasons. Replacing a
superseded rule first archives the full previous handoff; the current file states
the effective rule once. This final execution
report is distinct from each immutable private initial comparison baseline.
Copying never dispatches an agent, starts an App task or changes files. The
record association restores reference data only, never write authority.
Real-model interpretation, native layout and external-agent execution remain
manual acceptance work.

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

`run_project_check` reuses a completed saved-copy report only after native
freshness verification. Otherwise it runs saved-file static diagnostics before
any runtime acquisition. A ready session receives a bounded read-only observation
of the existing runtime, explicitly marked `savedChangesVerified: false`; it does
not prove saved code has loaded. Starting/stopping or a native `runtimeBusy`
lease produces separate static evidence and a runtime blocker. The task retains
that blocker for the unchanged runtime generation/state across ordinary saves,
so repeated calls do not acquire another runtime. These paths never stop the
performance. `run_project_static_check` requests static evidence only and does not
settle a pending project check. Runtime checks remain exclusive; detailed
observation scope lives in [controlled-checks.md](./controlled-checks.md).

For numeric/visual parameter work, edit publishes actual controls from the saved
file through `expose_project_parameters`. The native binder verifies source and
declaration versions, types and exact anchors; it does not send another model
request. At completion the App also binds declared parameters in the task's
changed files, covering a model that forgot the display tool. Numeric controls
have a labelled fader and number input when a range is available. Dragging edits
the candidate and requests temporary preview. Save parameters uses a fresh,
short-lived native Edit task rather than reopening the completed model task's
journal. After a confirmed save it retires that task's recovery data; uncertain
write outcomes retain recovery evidence. Controls
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
Project-test continuation stores the bounded actual test summary, native check ID
and owning Work task ID inside the existing V1 `lastCheck` JSON. It revalidates the
native receipt before restoring either passed or failed test evidence; an old
smoke-check receipt cannot bypass an expired prerequisite test. The native
`getCreationCheck` slot contains only the latest check, so older test receipts use
the native freshness reader's private-disk fallback rather than a stale slot
lookup. Missing, unverifiable or foreign-task receipts trigger fresh checking or
an explicit `notRun` evidence gap. The V1 8 MiB payload limit and history display
field bounds remain unchanged; diagnostic summaries stay bounded and full native
reports remain separate.
Fresh checks do not prove unfinished user goals are implemented; once the
requested work is complete, policy asks for a concise final result rather than
another discovery/unchanged-check cycle.

`assistant-task-tools.ts` routes the tools; `creation/assistant_tasks.rs` owns
native mode grants and durable recovery. Before each write it atomically saves
original text and a pending target in private App data. Records are keyed by the
canonical project root and validate its directory inode on reopen. Successful
writes commit their target; interrupted pending writes are reconciled against
actual disk bytes before continuation/undo. Unfinished-task records survive App
restarts; explicit task retirement removes their snapshots after dependent
receipts are saved. Restoring chat text never grants write authority. Native task IDs
are carried by explicit request checkpoints; a restored ID requires fresh native
mode/owner/content validation and does not itself grant write access.

The retained `AssistantTasks` component lists modified/new files, task undo and
per-file undo. The discussion header no longer mounts its separate task list or
offers a changes/undo menu entry. The legacy native undo capability applies only
while a recovery journal remains; finished tasks use Git for lasting file
recovery. Undo requires an idle task, refuses unsaved drafts, and
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
(including failures/continuations). Explicit Work uses these as stage budgets,
with automatic rollover described below; other requests keep logical-request
limits. The native serialized packet remains bounded
at 512 KiB. These are resource backstops, not a configurable input budget. The native layer additionally
limits response size and model turns. Project pages default to 32,768 UTF-16 units
and allow 64–65,536 units; help pages keep their shorter independent bounds. Assistant requests have no App-imposed
total elapsed-time limit and remain explicitly cancellable.

The trusted system message supplies the remaining tool-call and tool-result
character budgets on every model turn, plus the maximum section size. These
counters are scoped to one logical request, except Work's stage allowances;
continuing an interrupted request retains cumulative consumption and call IDs.
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
The text event carries cumulative `delta.content` or the decoded prefix of a
single advertised Discussion completion tool's public `answer` or `plan` field.
The preview uses the same 64 KiB text bound. The original arguments and prose
provide the completed tool receipt and model turn. DeepSeek reasoning stays in a
bounded internal replay field in private task checkpoints and history. See
[provider compatibility](external-apis.md#deepseek-chat-completions-compatibility-2026-10-18).
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
removed on settlement. Each cumulative turn prefix replaces the current main
reply; completed tool-turn commentary is retained separately in activity, and
final settlement does not append either text again. UI updates
are immediate, while intermediate history snapshots are limited to once a
second; terminal states and explicit stop/quit persist the latest text.

## Private project history (#167)

Storage location, schema compatibility, physical-copy identity and legacy migration are defined in [Data persistence](./data-persistence.md#file-locations). This section defines history publication, queue ownership and authority-free display restoration; execution checkpoints remain a separate task lifecycle.

The schema contains messages, terminal/error states, real section sources and App
versions. Attachment and proposal records own their exact text, relative path,
source/candidate versions and project key; applied differences own before/after
text. They do not reconstruct evidence from current files. Strict field validation
excludes credentials, configuration, request tokens and callbacks. Files are
limited to 8 MiB/400 messages across all chats in one project, with bounded text,
protocol reasoning and snapshot collections. Invalid
or unsupported existing records fail visibly and cannot be overwritten by an
ordinary save. Explicit clear can recover them.

One native lock covers read/check/stage/publish. A private temporary file in the
same directory is flushed then atomically renamed; pre-publication failure leaves
the old bytes and epoch intact. Each clear publishes a fresh epoch before retiring
the old one. Every frontend queued save captures an immutable message snapshot and
its original epoch at enqueue time, so delayed old writes cannot resurrect cleared
context. A failed save remains visible and blocks new paid requests, topics,
branches, summaries and question/resource continuation. The prospective message
pair and any branch copies must pass the ordinary native save before the first
paid model call. Admission drains the queue until its latest snapshot is settled,
then rechecks saving/error state; an older successful write cannot admit paid work
ahead of a newer proposal publication. Failure removes only the attempted round
and branch records, restores its edit state and input, and preserves independent
updates to existing messages. A full
transcript keeps its in-memory content and offers the existing chat deletion or
explicit project-history clear instead of an ineffective capacity retry. Other
save errors retain explicit saving retry; a stale epoch requires confirmed reload
or clear. Known message-count exhaustion also refuses a new topic or summary
before adding its marker. A reply can still exceed the remaining byte capacity
after admission; its complete text stays visible, and further requests stay
blocked until recovery.

Completed Work receipts validate their `taskId` with the native assistant-task
ID contract (1–100 ASCII letters/digits/hyphens), shared with journal loading.
These IDs are not handoff UUIDs. A regression creates a real native task, writes
through it, saves its delivery evidence and loads it through a new history store.
Handoff UUID validation remains separate. Stage-summary strings obey the native
4096-byte UTF-8 bound; truncating a diagnostic by JavaScript character count is
not a compatible byte bound. Only display summaries are shortened; source
reports, journal data and conversation text remain intact.

A save-time format refusal uses save-specific feedback. It preserves the current
window content and previous disk bytes; it does not advise clearing or reloading
as if the write refusal proved the saved file unreadable. Explicit retry resends
the same immutable snapshot, so deterministic validation errors need a code/data
fix. Failed terminal publication retains the durable task checkpoint; retry must
not regenerate the reply or clear that recovery record before successful saving.

Explicit removal of a full chat still ends its native task and reconciles question
cancellation before retiring recovery. It may omit the retirement save only for
the reply selected for deletion, or for an explicit project-history clear; the
ordinary atomic removal publication remains authoritative. Publication failure
retains the visible transcript and canonical cancellation receipts for retry.
Other chats, saved project files and task undo journals are preserved.

Creation cleanup cancels and flushes pending history writes before workspace
replacement. Stop-and-drain reports whether publication succeeded; failed history
publication blocks workspace cleanup and native quit instead of discarding its
in-memory content. The same step runs in `quitNow`, including confirmed quit.
Load/save completion also checks
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
to the stateless service. Non-Work logical requests retain a 128-attempt limit across
sessions. Work retains its stage counters and cumulative usage across sessions.
It cannot restore provider-side generation or send an
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

The discussion header is one row: conversation selection and Conversation
options. The chat list retains its selected-chat checkmark. New chat lives inside
Conversation options; there is no separate plus button or visible history-status
glyph. Normal loading/saving/saved states retain a screen-reader-only polite
announcement, while history failures and their recovery actions remain visible
below the row. The menu also retains guarded cancellation of the current
discussion question and the existing confirmed history clear.

New chat uses the existing `newTopic` action, preserving earlier chat records and
the composed draft. It requires ready, non-busy, non-stale history, an idle request
and the current workspace owner. The action runs after the menu releases focus,
rechecks those conditions and returns focus to Conversation options. Dialog
actions keep the same deferred opening and return-focus behavior. The header no
longer offers or mounts the standalone project-overview and changes/undo dialogs;
their underlying fact/task services, components and existing task cards remain.

The composer keeps the captured-mode selector, context entry, model and send/pause
action on one row below the input. Mode labels state Discussion / Work; detailed hints and the Enter/Shift+Enter hint are available on
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
bottom. Scrolling up pauses following; scrolling back down resumes it. A 32px
bottom fade indicates content below the viewport without a separate latest-message
button or layout row. The mask follows scroll, message and resize geometry,
clears at the bottom, and is disabled for forced colors or increased contrast.
The transcript remains keyboard-focusable; automatic updates never move keyboard focus. An initial
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
completeness flag. These private statistics stay distinct from estimated
current-window occupancy and remain available to request/history bookkeeping;
creator messages and summary review expose no server-usage disclosure. Cache and
reasoning remain reported subsets, and no cost is inferred. History schema 2
accepts schema 1 additively, without inventing old statistics; strict bounds/field
validation and atomic publication still apply. Restoring private usage creates no
creator-facing receipt. Request generations and preview cleanup reject old results
after stop, workspace or model configuration changes.

## Selected context, reviewed summaries and topics (#234)

The complete local transcript and the next outgoing context are different data.
`selectAssistantContext` keeps up to six recent complete adjacent user/reply
rounds. Failed, partial, attachment/proposal-bearing and service-mismatched rounds are excluded as whole pairs. Project rounds additionally require a fresh project snapshot and matching saved source versions. The input area states
how many originals remain local; nothing is deleted. A long single round still
fails the same request budget without truncation.

For an authorized project-reading request, `creatorRecords` independently keeps
the current topic's original creator text and submitted question answers with
their selected meanings. A source revision can exclude code/model evidence
without deleting those decisions. Service, project-reading and material scope
still apply. Attachments and proposals do not become independent creator records;
old material-conflict excerpts and overwrite bindings are omitted. The actual
answer is distinct from the assistant's question and unselected alternatives.
These records are intent references, not verified code facts or renewed authority.

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
short relevant Markdown excerpts with exact ranges, not a claim to have read
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
The UI groups installed sources by language, content version and document, then by section. One section link expands its original returned ranges; document counts are not range counts. Historical source arrays remain unchanged. Project/material snapshot navigation remains independent.

Search results include a Markdown-coordinate `readTarget` for the actual matched paragraph. Search and reads share the same format/range cache, so overlapping excerpts are reused. Plain-text metadata in old history retains its original meaning; document edits create a new content version rather than reinterpreting historical offsets.
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
and keep confirmation open for retry. Other chats, drafts and project files remain
intact. Only execution recovery belonging to the explicitly removed chat is
retired; unrelated unfinished-task journals are retained. Deleting the selected chat selects its
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
history selection. Platform-only requests filter project rounds and summaries; editable-workspace requests use saved access by default. The full local transcript remains independent. Partial ranges never imply complete analysis.

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

A complete, parsed manifest of at most 8 KiB adds structured metadata with its
actual path/version, only while that version matches the inventory. Short text
excerpts retain their exact returned ranges. Headings from the bounded native
excerpt and explicit read targets provide navigation; they do not imply the
remaining document was read. Necessary details remain available through paged
saved-text reads instead of a permanent list of work-specific facts.

`assistant-overview-store` owns the current local snapshot. File revisions mark
the snapshot stale; authorized requests refresh facts without model, compile or
runtime actions. Fingerprint
changes mark earlier static/test facts stale even before watcher acknowledgement.
Explicit Doctor and controlled-check results publish their existing evidence;
manual test transitions record runtime evidence with saved revision. Nothing is
restored from chat as a current test. The standalone overview component is
retained, including its refresh behavior when mounted, but Conversation options
no longer exposes or mounts it. Authorized requests continue assembling the same
short local facts/excerpts under the common context budget.

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

The workbench exposes preview and manual runtime controls, not a Checks menu or saved-copy report dialog. Explicit Work tasks use the shared checker and repair within the same task. The assistant owns request/goal attribution; [controlled-checks.md](./controlled-checks.md) owns temporary-copy execution, input evidence, exclusion and cleanup. [static-diagnostics.md](./static-diagnostics.md) owns static reports and CLI behavior. Manual editor saves do not start checks. A busy runtime remains untouched and cannot be reported as a successful runtime test.

Retained standalone components and isolated tests are not accessible product entries. User-facing paths are documented in [the App tutorial](../zh-CN/app-tutorial.md#临时副本运行检查).

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

The independent creator-decision projection uses the existing protected summary
context kind through compaction and durable V1 continuation. If protected intent
exceeds the budget, admission fails explicitly instead of silently dropping a
correction. It carries no old tool grant or candidate overwrite permission.

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

## Work stages and progress pauses (2026-10-27)

Explicit Work keeps one native task, original goal and message pair across stages.
At 128 model attempts, 248 tool calls (leaving room for a complete native batch),
or 15 MiB of results, the flow checkpoints the complete tool boundary, compacts
the working packet, releases the native model session and opens another with the
same captured service configuration. Only stage allowances reset. Saved source
coverage, file versions, task journal, pending checks, question/resource decisions,
call IDs and cumulative consumption remain. A stage never repeats a completed
write or substitutes a summary for exact saved read evidence. Failure or pause
during rollover leaves the last complete checkpoint available for continuation.

`assistant-progress.ts` observes complete tool groups. Three equivalent groups
without new evidence, twelve groups without new evidence, forty-eight reading
groups without a saved change, or repeatedly returning to the same saved state
pause Work with `noProgress`. Saved-state hashes and the observation window survive
automatic rollover. These are conservative signals, not proof of artistic quality;
legitimate paginated reads advance evidence and saved changes reset idle counters.
An explicit **Continue task** resumes the same goal with a fresh observation window
and stage allowance. The saved task and completed operations remain authoritative.

Reader-local `noProgress` and distinct-file budget failures become complete refused
tool receipts before Work pauses, so other writes in the same batch remain
recoverable. Explicit Work budget pauses with a stage checkpoint retain the same
continuation. Project/context/configuration ownership checks still apply on resume.
This does not remove independent source, packet, task-journal or 8 MiB checkpoint
capacity limits.

Recent per-call usage stays bounded to 128 entries. `previousCalls` folds older
entries into cumulative counts and nullable token totals; unknown failed/partial
usage remains unknown. The optional stage, progress and cumulative usage fields
round-trip through the version-1 checkpoint allowlist; old checkpoints remain
readable. Native history validates cumulative numbers as JavaScript-safe integers.
Chat/history source snapshots retain at most 256 recent receipts, reserving one
exact receipt per material ID/version so removal still invalidates dependent
history. Full request-local read evidence remains available for exact replacement
and checkpoint organization.

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
alternative button; otherwise the creator can end the task. Discussion discovers and discusses recommendations in chat, without adding
resources or documenting a formal handoff.

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

### Optional hub dependency adoption (#321)

The native resource rule expands a `hub` request to its exact shipped Node
`socket.io-client`, including when the module already exists. One resource card
contains the missing capability and dependency; the model does not need to name
the client separately. Exact adopted resources and this task's prior approvals
are reused. A different shared reference or production dependency version fails
explicitly before adoption rather than silently replacing it.

After approval, `use_local_module` for hub adopts the verified shared reference,
records the exact root `package.json` production declaration and publishes only
missing module files through the same task journal. The adapter protects unsaved
manifest, package and module drafts. Existing customized module source is kept;
the assistant must read and adapt its actual loader instead of replacing it.
The current frozen loader consumes the verified absolute client entry from
`PNDS_SHARED_LIBRARIES`. An injected but missing, invalid or unusable shared entry
cannot fall back to a local install. With no injected shared map, explicitly
standalone projects can use their own production installation.

The same Work task still owns the remaining `telematic` declaration, Host
configuration use, project event validation/application, observable status and
shutdown wiring. It checks the saved result before reporting completion. The
resource receipt alone does not prove those changes. Hub stays optional and
connects to an existing relay; it creates neither a default Blank connection nor
a central hub. Theme and language remain independent optional capabilities.

Ordinary resource discovery and manual additions omit unadopted
`socket.io-client` and `qrcode` as independent recommendations. Saved references
remain visible as project facts; the underlying catalog, exact resolver, legacy
project compatibility and App QR encoder remain available. Pending hub decisions
use the existing same-task continuation, restart recovery, cancellation,
workspace ownership and whole-task undo rules above.

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

## Maintaining generated Blank recording (#320)

The edit policy and local-resource guidance require existing event recording to
remain part of the same authorized state/input/effect change. A new Blank already
has real default contact recording; no optional recording module or handoff TODO
is proposed. Read the saved application and recording wiring, preserve custom
adapters, and complete actual snapshot/restore/apply/release plus necessary time
advancement together. Verify observable live/replay/overdub/rerecord behavior;
endpoint success and source existence are insufficient. The synchronous work
extension and cleanup boundaries are specified in
[performance recording](./performance-recording.md#blank-foundation-and-authored-work-320).
