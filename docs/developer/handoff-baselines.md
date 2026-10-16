# Confirmed handoffs and saved-file comparison (#171 / #226 / #227)

The assistant offers `propose_handoff` as declarative preview data through the
single `runAssistantRequest` entry. It grants no filesystem or execution
capability. A card explains complexity, target files, known problems and
acceptance. Declining leaves the project and task drafts untouched. Accepting
prepares the existing editable task dialog; a separate reviewed confirmation
records it. Suggestions and temporary preview remain separate from file drafts.
No external agent is dispatched by the App.

## Task and confirmation ownership

`previewCreationHandoff(identity, task)` validates the native workspace and
issues a transient token bound to the complete task, its SHA-256 revision, the
handoff document version and the saved-file inventory's versions. Editing the
task invalidates the frontend review. `confirmCreationHandoff(identity, token)`
uses the issued native review; changing projects, changing saved files or using
an unknown token cannot authorize a new write. A content revision is stable
across retries, while edited requirements produce a different revision under the
same task ID. The baseline list can reopen a task for an explicit revision.

The dedicated handoff writer appends without parsing or replacing existing
external task status/evidence. Reviewed entries have an additional revision
marker; legacy module/README handoffs retain their existing ID marker format.
The old append service remains the narrow module-generation seam, not a model
tool. Copying instructions is a clipboard action over the confirmed task and
revision; it performs no capture, write, dispatch or completion marking. Only
explicit task fields enter the handoff, never transcript/request/configuration
objects. Users review the actual fields before recording.

## Draft choice and real outcomes

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
capture fail explicitly. This is bounded filesystem observation, not an OS-wide
atomic snapshot or compare-and-swap against arbitrary external editors.

The immutable pending record is atomically published **before** task writing.
Its handoff document contains the predicted successful append, including the
revision marker. The append is guarded by the reviewed document and file
versions; only its actual successful version can finalize the record. Thus the
App's own task append is part of the baseline. A crash between append and final
publication can be resumed by recognizing that exact task revision without
replacing the captured document with later external edits. Retrying returns
current disk text for draft conflict feedback while the origin stays immutable.

Text stores actual UTF-8 bytes for comparison, up to 1 MiB each and 8 MiB total.
Resources store only SHA-256 and size, with a 512 MiB per-file / 1 GiB total
hashing limit; they have no recoverable resource copy. Dependency/build/cache/Git
paths, sensitive files, dependency locks, generated third-party content, links,
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

The comparison owns a separate generation and identity. Cancellation, baseline
selection and project replacement reject late replies. While visible, file-poll
changes, focus and a three-second metadata check mark stale results; failures
remain visible and stale. Refresh is explicit and clears the old comparison
before a fresh read. Missing, incomplete and damaged baselines are errors, never
empty “unchanged” results. Draft paths are shown separately from the disk result.

The workflow/UI and native temporary-project tests cover these boundaries.
[Acceptance steps](../acceptance/171-226-227-handoff.md) retain user-started native,
theme, keyboard, monitor and sound verification separately.
