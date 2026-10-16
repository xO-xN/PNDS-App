# Reviewed single-file changes (#207)

The creation text editor offers **Review change** beside ordinary manual saving.
It captures one existing file's disk text, disk version and draft text. The
review displays a line difference using the actual text, trimming only shared
leading/trailing lines. Cancelling keeps the draft and writes nothing. Editing
again invalidates the captured review and requires a fresh review.

`saveCreationFileChange(identity, path, text, expectedVersion)` shares the
existing bounded text read, trusted project identity, protected-source checks,
manifest validation, disk fingerprint and atomic replacement used by manual
saving. It cannot create, delete or rename a file. The backend retains one
in-memory `CreationFileChange`: actual before/after text and versions, relative
path and an issued change ID. Only a successful write publishes a record; no-op
and repeated stale submissions fail. A later successful manual save, reviewed
save or rename invalidates the previous record. Reopening/switching/closing the
active workspace revokes its record. Cancelling a prepared project switch keeps
the active workspace and its undo capability.

`undoCreationFileChange(identity, changeId)` accepts only that active identity's
current record. It restores the before text through the same guarded save,
requiring disk bytes to still match the successful after version. It consumes
the record only after restoration succeeds. Missing targets, external changes,
read-only sources or stale IDs fail without recreating/overwriting work. Git
and persistent backup files are not involved. History does not survive App exit.
The fingerprint is a content version: identical bytes have the same version;
this does not promise an OS-level compare-and-swap against external editors.

`creation-files-store` owns draft and operation generations. A reviewed candidate
must still match the captured identity, disk baseline and draft before dispatch.
Undo refuses dirty/conflicted drafts. Both actions suppress late completions
after clear or workspace replacement, reject duplicate in-flight submissions,
and preserve typing that happens during an already dispatched write. The review
cannot be cancelled after dispatch; the UI waits for the actual result. Saved
changes and restoration errors remain visible, and ordinary runtime refresh,
compile and restart continue to require the existing explicit actions.

Public workflow tests cover real temporary-directory modification/restoration,
no-op/repeat rejection, normal-save/rename invalidation, external/deleted targets,
source and path guards, prepared-switch cancellation and identity revocation.
Editor/store tests cover real diff display, review cancellation, captured draft
and identity conflicts, unsaved work, typing during undo and late replies.
Native App acceptance remains with the user's final manual test.

For assistant candidates (#208), `saveReviewed` explicitly selects proposal origin.
It requires the file draft to remain clean at the proposal's before text/version,
then submits the separately captured visible candidate to the same native service.
A successful write updates the clean file draft only if it has not changed during
dispatch; new typing is preserved. Candidate buffers never enter file drafts as an
intermediate dirty save. Preview mapping and runtime state are not write gates.
