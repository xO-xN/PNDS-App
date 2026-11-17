# Confirmed handoffs and saved-file comparison (#171 / #226 / #227)

Discussion offers a contextual **Write handoff file** action and accepts an
explicit natural-language request to generate a draft. A current live plan
opens the editable task from that exact plan and its submitted decisions, without
a second model request. A newly selected historical plan remains fixed reference
for a bounded extraction request. Generation actions never become implementation
requirements, and unresolved decisions block successful drafting. Generating and cancelling write no
project files or baseline. Only a separate reviewed confirmation records the
task. The generation task always holds read-only Discussion authorization;
missing decisions use the existing one-question task lifecycle. See
[manual current-topic handoff](./creation-assistant.md#manual-current-topic-handoff-239--246).

Discussion exposes the read-only `propose_handoff` preview for choosing a handoff
draft or a new Work task; it neither records nor dispatches anything. Only the
creator's subsequent explicit choice proceeds. Edit does not expose that preview.
No external agent is dispatched.

## Task and confirmation ownership

`previewCreationHandoff(identity, task)` validates the native workspace and
prepares the actual full active document. An explicit existing-content edit uses
`previewCreationHandoffUpdate` with that saved document version. Both issue a
transient token bound to the task, its SHA-256 revision, planned output, archive,
handoff document version and saved-file inventory. Editing the task or existing
content invalidates the frontend review. `confirmCreationHandoff(identity, token)`
uses the issued native review; changing projects, changing saved files or using
an unknown token cannot authorize a new write. A content revision is stable
across retries, while edited requirements produce a different revision under the
same task ID. The baseline list can reopen a task for an explicit revision.

The dialog presents a readable task and optional Edit task controls, with no
creator-supplied initial status. Preview handoff shows the complete document to
be published; the normal view does not require a raw current-disk pane. Manage
existing content is an optional editor for explicitly correcting old mistakes or
obsolete content against its saved base version.

Reopening a recorded task that is absent from the active document is read-only.
The creator can explicitly create a new task from that record, which assigns a
fresh UUID; reviewing an archived record does not add it to the current list.

`docs/creator-handoff.md` is the active task list. A recognized correction of the
same task replaces its earlier block/revision instead of accumulating duplicates.
Unrelated unfinished tasks and unknown text are retained by default. Before a
same-task replacement or explicit existing-content change, the writer preserves
the previous saved document at `docs/handoff-history/<contenthash>.md`; publication
checks that archive and the source version. The App never infers completion or
silently deletes old errors from chat claims. Legacy module-generation appends
remain a narrow separate seam, not a model tool.

After successful recording the originating chat reply shows a localized external
coding-agent prompt with a copy button and the actual project root. It assigns
the current handoff under `AGENTS.md` and states how to check and archive the work.
English uses the bundled `pnds-handoff/SKILL.md` body. Chinese uses the locale catalog.
Native receipts retain the canonical source. Interface-language changes do not
change a recorded chat's prompt language. The record retains its task/revision association for reopening
and comparison; the prompt assigns the whole current handoff. Restoring an old
chat updates its copy instructions without changing those record references;
actual native records can reconcile an older stale draft-ready message. A
prepared draft cannot claim recording.
Copying only updates the clipboard: no capture, write, dispatch or completion
marking. Only explicit reviewed task fields enter the handoff, never the private
transcript/request/configuration objects.

### Shared text publication

The active document and content-addressed archive use the common held-directory
text staging implementation. Handoff review, document versions, source inventory
fingerprints and archive-before-write remain handoff-owned checks. Publishing an
absent active document uses no-clobber linking; replacing an existing document
uses rename after the final directory and saved-version checks. Neither path
follows a substituted file or directory symlink.

An archive collision is accepted only when its actual bytes match the exact
planned archive. The existing archive directory sync and post-publication content
check remain after the link. A later active-document failure keeps that archive
available for the existing exact-plan retry; it does not roll back history or
recapture the origin. Task and baseline journal ordering is unchanged.

Staging cleanup is owned by the common module, including error and unwind paths.
Cleanup after a successful link cannot be confused with a failure to publish.
The wrapper does not turn file sync into a cross-file transaction or an OS-wide
compare-and-swap. See [project text publication](./creation-workspace.md#project-text-publication)
for the shared mechanics and the distinct ordinary-save alias policy.

### External completion and history

The copied prompt directs the external agent to complete all current handoff
tasks using the project's existing terminology and design documents. Once actual
implementation and checks succeed, that agent archives the full completed tasks,
actual modifications, check results and unverified items in a Markdown report
under `docs/handoff-history/`, then removes the completed active items. This
authorized cleanup needs no further creator approval. Remaining sound, visual or
device review by the creator is listed as unverified in the history report and
alone does not keep implemented and checked work active. The current handoff
contains only unimplemented or blocked work with reasons; existing history is
preserved. Before replacing superseded rules, the external agent archives the
full previous handoff and leaves only the latest confirmed rule active. App
publication does not rewrite existing project documents automatically. Merely
generating a handoff, receiving an optimistic chat reply or observing changed
files cannot substitute for that work.

Source history contains both previous-document snapshots and final execution
reports. The App's private immutable comparison baseline below records the
initial saved origin; it is not the final execution report. Source `docs/` stays
with the engineering project and remains outside the performance `.pnds` bundle.

## Draft choice and real outcomes

Discussion's structured public-plan snapshot is distinct from a recorded handoff
or execution checkpoint. A restored plan is read-only; an explicit new selection
rechecks current source/material versions and creates a new display offer. It
does not revive a previous task or grant. Both next-step actions select the exact
public plan and submitted answers. Work delivery evidence and pending creator
acceptance remain separately visible in chat; compilation belongs to automatic
Work execution, not a routine manual handoff step. See
[discussion selection](./creation-assistant.md#discussion-to-work-and-handoff-2026-10-21).

If dirty file drafts exist, the dialog lists them and requires **Save drafts
first** or **Use saved files only**. The former invokes the normal guarded save
workflow and stops if any required draft remains dirty, conflicted, saving or
renaming. It applies no proposal and consumes no preview. The latter preserves
all drafts. A handoff-document draft receives the actual published disk text and
version as a conflict; it is never silently rebased or allowed to overwrite the
new task. A changed draft after review requires a fresh choice.

`HandoffReceipt` reports `taskRecorded`, `baselineId` and `baselineError`
separately. A recorded task with failed baseline finalization does not mean a
comparable handoff is complete. The baseline list exposes pending records and
explicit retry. A failed task publication retains its captured origin too.
Retries use the same task/revision and never recapture the current project as a
replacement origin. If unpublished task inputs changed, the pending record stays
intact and a new reviewed task revision is required.

## Private durable journal

Schema 1 JSON lives in App data at
`handoff-baselines/<SHA256(canonical-real-project-root)>/<baselineId>.json`.
The baseline ID derives from task ID and revision. Separate actual project
folders remain isolated, including cloned manifest IDs; reopening the same real
folder preserves its baselines. These records share neither chat history nor
Git storage. Clearing chat has no baseline side effect. They never enter the
source handoff, Git commits or `.pnds` publication.

A confirmation captures saved content twice and compares inventories/content
fingerprints. Each read verifies held and reopened file metadata; directory
versions and native root identity are checked as well. Files changed during
capture fail explicitly. Local comparison includes dependency lockfiles; their assistant-reading exclusion remains unchanged. This is bounded filesystem observation, not an OS-wide
atomic snapshot or compare-and-swap against arbitrary external editors.

The immutable pending record is atomically published **before** task writing.
Its handoff document contains the exact reviewed planned output, including the
revision marker. Publication is guarded by the reviewed document, archive and
file versions; only its actual successful version can finalize the record. Thus
the App's own task publication is part of the baseline. A crash between handoff
publication and final journal publication can be resumed by recognizing that
exact task revision without replacing the captured origin with later external
edits or an execution report. Retrying returns
current disk text for draft conflict feedback while the origin stays immutable.

Text stores actual UTF-8 bytes for comparison, up to 1 MiB each and 8 MiB total.
Resources store only SHA-256 and size, with a 512 MiB per-file / 1 GiB total
hashing limit; they have no recoverable resource copy. Dependency/build/cache/Git
paths, sensitive files, generated third-party content, links,
nonregular files, invalid text and exhausted content budgets are explicit
exclusions. Trees are limited to 4,096 entries / 32 levels. A journal record is
limited to 64 MiB and per-project storage to 256 MiB. Capacity exhaustion stops
rather than deleting history. The UI shows usage and supports explicit deletion
of selected records, including damaged or unsupported ones. Storage directories
are private, records are mode 0600, reads reject symlinks, and replacement is
atomic. Invalid schemas/identity/content fail visibly instead of loading an
empty baseline.

## Read-only comparison and reading navigation

`compareHandoffBaseline(identity, id)` requires a complete baseline, captures the
current saved content and compares path unions. Task-mentioned files sort first;
other covered changes remain visible. Text differences use actual before/after
content; binary differences show status, SHA-256 and size only. Uncovered paths
are shown as exclusions, never inferred to have been deleted or added. Rename
identity and authorship are not inferred. Git status and HEAD are not consulted,
so clean external commits and no-Git projects behave alike.

The reading extension preserves the existing discussion, console and monitor.
Only **Open current file** enters the regular editor, retaining its draft and
undo workflow. Deleted files have historical differences but no recreation
control. Navigation back to **Changes since handoff** preserves the selected
comparison; the discussion return remains available. No comparison invokes a
model, save, runtime refresh/start, restore, Git operation or task completion.
The mounted reading extension reloads its catalog whenever it becomes visible or
a handoff receipt changes, so tasks confirmed while editing or revising in place
appear without discarding the selected comparison. The handoff document owns
the durable receipt presentation: a compact, keyboard-expandable summary,
the current-handoff prompt's Copy action, task/revision and baseline details,
and any baseline publication failure. These facts stay available after their
transient flow toast has expired.

`CreationHandoff` mounted in `menuOnly` mode above the workspace navigation owns
only the explicit review dialog. It must not render receipt summaries, Copy
actions or baseline errors in normal document flow above Discussion or Git.
Opening or switching reading views never republishes a completed handoff's
result or changes the saved document. Dialog validation and cancellation stay
in their existing review surface. See
[workspace feedback placement](./notifications.md#workspace-feedback-placement).

`beginHandoffOperation` reserves an owner-bound native operation before dispatch.
Confirmation and comparison carry that operation ID. `handoffOperationProgress`
and `cancelHandoffOperation` access only its independent registry, so cancelling
can stop the native worker even while it holds the creation access lock. Each
64 KiB read checks cancellation and reports actual per-file bytes; UI polls only
while work is active. Cancellation before task publication writes no task and
retains any already-published origin. Once guarded task publication begins, the
operation becomes noncancellable and reports that phase; the UI waits for its
actual result rather than pretending the write was cancelled.

The comparison owns a separate generation and identity. Cancellation, baseline
selection and project replacement reject late replies. While visible, file-poll
changes, focus and a three-second metadata check mark stale results; failures
remain visible and stale. Refresh is explicit and clears the old comparison
before a fresh read. Missing, incomplete and damaged baselines are errors, never
empty “unchanged” results. Draft paths are shown separately from the disk result.

The workflow/UI and native temporary-project tests cover these boundaries.
[Acceptance steps](../acceptance/171-226-227-handoff.md) retain user-started native,
theme, keyboard, monitor and sound verification separately. The revised dialog,
real-model discussion and external-agent completion/archive workflow remain
manual acceptance items; controlled tests do not establish those outcomes.
