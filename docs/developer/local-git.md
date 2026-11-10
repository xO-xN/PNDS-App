# Local Git recording and history (#228–#230)

For editable folder projects, the top-left Git menu and **Git versions** reading
button open a complete page in the existing middle workspace. **Save current
version**, version relationships and current saved differences share that page.
The existing discussion, file editor, sidebars and preview layout remain in
place. The advanced **Git status and differences** inspection dialog remains
available for every project, including protected/read-only projects.
Assistant recovery records are independent and never create a commit.
Blank and Classic are the only automatic-commit
exception: generation makes an independent repository and `Initial project`
inside private staging before publication. Any failure leaves the old workspace
and target untouched. Existing folders never initialize merely by opening them.

The recording surface leads with the change message and selectable saved-file
changes; author/email and project/repository metadata are separate disclosures.
The explicit confirmation still shows message, identity and every selected path.
History leads with each message, date and changed-file count. Full commit IDs,
author/email and timestamps expand under Version details; selecting a text file
shows its difference before optional complete source snapshots. The legacy
recording dialog retains the receipt disclosure; the middle version page uses
a brief success toast and graph selection, with native warnings retained in
its toolbar details.

The version page follows the approved B flow notification pattern: saving,
switching/restoring and renaming update the same notification at real operation
boundaries. Saving before switching is one flow with no intermediate success.
A returned commit receipt is preserved before refreshing history. Refresh
failure is a warning with an owner-checked refresh action, never a failed-save
claim or another commit attempt. Completed checkout with incomplete file
synchronization similarly retries only synchronization and reading. Native
receipt warnings remain available in toolbar details and produce a warning outcome. Unmounting
or replacing the workspace dismisses pending presentation and rejects late
feedback. See [operation feedback](./notifications.md#approved-b-operation-feedback-2026-11-04).

## Engine and distribution

`git2` 0.21.0 statically links vendored libgit2 1.9.7 through
`libgit2-sys` 0.18.8. SSH/HTTPS features are disabled. All production Git reads
and writes use library calls; no Git executable, shell, hook, credential helper,
external diff, signing or filter program is launched. No remote API is exposed.
The engine never hydrates missing objects; partial-clone configurations are
rejected before status, diff or history. Ordinary missing objects return errors.
The license texts and source pointers ship at `licenses/LOCAL-GIT.txt`.
The [upstream linking exception](https://github.com/libgit2/libgit2/blob/v1.9.7/COPYING)
and [git2 feature/API contract](https://docs.rs/git2/0.21.0/git2/) inform this choice.

`GitReader` retains the #201 prepare/run/finish capability interface. It now uses
`native_git.rs`, retaining project-prefix filtering in parent repositories and
linked worktree reads. Unsupported read configurations remain explicit failures.
Processes and their timeout probes were removed: native reads use bounded text,
path inventories and history counts instead. Do not reintroduce `/usr/bin/git`
or developer-tool discovery as a production dependency.

## Version reading outside the workspace lock

Eight version-reading commands use `CreationState::read_git`: history, history
file, history-text loading, version graph, version paths, version file,
comparison creation and comparison file. Their existing command parameters,
return types and budgets remain unchanged. Status/diff retain their existing
held-root jobs. Recording, renaming, switching and restoration retain their
write transactions and runtime/index/reference locks.

The shared `git_read::run_read` coordinator prepares a concrete owned job under
the `CreationAccess` mutex, releases the mutex for `GitReadJob::run`, and locks
again for `finish_git_read`. Preparation validates the issued identity and
captures its real descriptor, root and directory handle. `ReadProject` has no
watcher or mutable workspace state; saved-file paths share the ordinary
`read_root` containment/openat implementation. Independent directory enumeration
still opens a new description with `openat(".")`, rather than sharing a dup's
cursor. libgit2 repositories/objects, traversal, content reads, hashes and
patches stay inside the unlocked worker.

Every worker Result, including an error, retains its private ownership receipt.
Completion first checks identity/root/source, then comparison ownership, and
only then returns the original result. Closing, replacing or reopening a project
cannot authorize an old result. Completion performs no tree walk, whole-project
hash or content reread. Failed operations are not automatically rerun.

These are bounded reading snapshots, not atomic filesystem or repository
snapshots. HEAD, refs and repository-local display names may change while a graph
or history read runs; existing frontend request/revision/focus staleness and
refresh rules continue to apply. The polling `OpenProject.revision` is not an
immediate counter for every save or rename. There is no new global write epoch.
History text loading still checks its expected disk version; future editor saves
retain their own baseline check. Comparison file reads retain their actual
byte/OID, executable-mode and missing/appeared-file checks.

Comparison creation also publishes a read-only session. Its preparation retires
the old session and advances a private comparison epoch. Only the still-current
successful build may install a session. A stale build's success or failure
cannot overwrite or clear a newer session. File jobs capture only their path's
two inventory entries, saved flag, token and epoch; completion rechecks that
session. Equal content can produce equal public tokens, so the epoch is distinct
from the unchanged content token. Multiple file reads of one session do not
retire each other. No comparison token grants file writes or execution authority.

Real temporary-repository tests exercise the shared coordinator. A test-only gate
pauses an actual job in `run`, proves another operation can acquire the mutex and
save or close, then releases the job. Further tests cover revoked identities,
root replacement, reverse comparison completion and identical-token/new-epoch
reads. Timeouts only bound a broken test; machine-dependent millisecond limits
do not stand in for the lock and publication assertions.

Before the first commit, show the actual unborn branch when known, or only
“No commits yet” when no repository exists. “Detached HEAD” requires a real
HEAD target. In the Git dialog, boundary refusals retain their technical detail
with a Git validation summary; they do not imply that a runtime test failed. External
index additions remain “Added” even though their staged contents make them
ineligible for selection.

## Preview and write ownership

`previewCreationGitRecord` checks an issued editable identity and prepares a
one-use token. Cancellation creates no repository. The backend rechecks saved
bytes/modes, HEAD, index, local config and relevant repository metadata before
confirmation. Tokens belong to the current identity and cannot be replayed.
Changes require a fresh preview. Existing unborn repositories are reused after
an initial-commit failure; no cleanup deletes a user's folder or repository.

Only independent project-root repositories support writes. Parent repositories,
linked worktrees, submodules, nested repositories, symbolic metadata, alternate
object stores, shallow repositories, conflicting/in-progress operations and
locks require external tools. Signing requirements, EOL normalization settings and filters are preserved
and refused, including filter attributes without a configured driver and text/eol/crlf transforms.
Version switching is the explicit, guarded operation described below; no general
reset, index clearing or automatic repair command is exposed. The legacy whole-version
saved-file restoration remains a separate compatibility operation.

The commit tree starts from HEAD and receives only selected complete saved
files. A separate replacement index starts from the actual index. Selected
externally staged files are refused; unselected staged entries retain their
original blobs. Standard index/reference locks cover the final check. Once the
reference advances, index/config failures return a receipt containing the real
commit ID and a warning. UI refresh failures cannot erase that receipt.

New-project signatures default to the supplied creator or `PNDS Creator`, with
an independently editable Git name. Empty email means the disclosed local
placeholder `creator@pnds.local`. Existing valid resolved Git identities prefill recording through an identity-only
read; engine operations still use isolated repository-local configuration. Only local user name/email are written; project metadata and
global configuration are never changed by recording.

## Fixed inclusion rules

Existing ignore rules participate in preview. Code, config, lock files, docs and
ordinary resources are selected by default. Dependency/cache/build directories,
App `.pnds*` data, `.env*`, private-key/certificate files, credential/secret
files and logs are excluded. Excluded files remain named in preview where they
are ordinary entries; excluded directories are omitted under the stated policy.

Project-local `.pnds-creation/` chat and material records are always outside
version capture and saved-source fingerprints. Saving a conversation does not
invalidate a source comparison; switching or restoring versions preserves the
private directory. A complete filesystem copy carries these records, while
ordinary Git push/clone does not. Historical Git content cannot replace them.

Audio/video/model extensions at **10 MiB or more** are unselected by default and
can be explicitly included: WAV/AIF/AIFF/FLAC/MP3/OGG, MP4/MOV/MKV/WEBM,
ONNX/PT/PTH/BIN/GGUF/SAFETENSORS. Already tracked resources remain visible;
new large-media defaults never delete or untrack them. Each file is capped at
**64 MiB**, collected content at **256 MiB**, inventory at **4,096 entries** and
depth **32**. Git metadata is limited to 65,536 entries with the same depth
bound; symbolic metadata is refused. Over-limit operations require external tools. Sizes describe saved
bytes and possible history growth, not compressed Git storage guarantees.

Draft count, unapplied proposals and temporary-preview state are separate facts.
The low-level recording command receives saved bytes only. The version page first
saves all drafts through their existing version-checked save path, then records
default-eligible changes. It refuses external staging, reports excluded files and
does not create empty versions. Neither path applies proposals, refreshes pages,
starts/restarts runtime, requests a model or creates a handoff. Initial generation
is the sole automatic commit.

## Middle workspace version page (2026-10-19)

[ADR-0011](../adr/0011-creator-git-version-navigation.md) defines the user workflow.
`CreationGitPage` stays mounted across reading-view changes. Selection, difference
view, graph height/collapse, optional names and loaded graph pages survive navigation; entering
the page never saves, stops runtime or ends an assistant task. Native graph,
comparison and file reads remain independent of write authorization.

The fixed toolbar leads directly into the graph/difference split. Results,
read errors, synchronization reminders, native receipt warnings, excluded-file
lists and raw repository status do not add rows between them. Progress and
outcomes use the existing flow toast; the toolbar's details popover retains
the underlying errors, warnings, exclusions and repository facts for explicit
inspection. Dismissing feedback does not clear those facts. The fixed Refresh
button retries pending file synchronization and version reading without saving
or switching again. Rename/switch confirmation errors remain inside their
existing dialogs.

`getCreationGitVersions` walks HEAD and local branch tips with explicit bounded
commit reads, following every parent, including external merge commits. Pages
contain at most 60 commits, with a 1,200-commit scan bound and at most 128 local
branches. Existing Git object, tree and message/path bounds remain enforced.
Missing older parents are shown as unloaded boundaries, never invented edges.
Parent-repository history is filtered to project-affecting commits. The legacy
30-result / 300-first-parent history and single-file adoption APIs retain their
original limits; new version-file comparison uses the multibranch reader.

`saveGitVersion` saves drafts sequentially, stops on conflicts or newly edited
drafts, and then uses the native one-use recording preview. The name is optional
and generated locally when blank. Existing author preferences and placeholder
fallbacks apply. Earlier successful draft saves remain on disk if a later step
fails. A native receipt, including warnings, is retained even if refreshing the
page fails. The operation never asks a model to name or validate the version.

`previewCreationGitSwitch` binds an issued editable identity, target commit,
explicit discard choice, saved-file/index/config fingerprint and local refs to
a one-use token. Confirmation holds the shared App/CLI runtime lease, index lock,
HEAD lock and current branch lock, revalidates, checks out the selected tree and
publishes the matching index and detached HEAD. Ordinary branch tips stay fixed.
A previously detached version without a retained route is pinned before moving
away. Saving from detached HEAD atomically creates a unique `pnds/…` branch and
advances it, making A→D after returning from A→B→C while keeping B/C reachable.
Optional branch names are converted to valid local ref names with a unique suffix.

The switch/restore dialog shows save-first, discard and cancel as visible footer
buttons when relevant unrecorded changes or live editor drafts exist. Before
opening either the history or named-branch confirmation, the page rereads current
Git status rather than trusting its earlier inspection snapshot. If there are
untracked files, it consults the existing native recording preview and retains
only default-included untracked paths in this save-first decision. Tracked and
externally staged changes remain protected regardless of recording defaults.
Generated/private/log files and default-excluded new large media alone do not
require a new version. Raw Git inspection can still show these files.

The dialog lists relevant saved paths together with live dirty draft paths.
Saved-only changes say they are not yet recorded in Git, without claiming there
are unsaved editor drafts. A clean project offers only switching (or stopping
and switching), plus cancellation. Failed status/recording reads block preparing
the confirmation; they are never treated as a clean tree. The preparation token
does not authorize a write: saving and final native switching still acquire
fresh previews and retain all native containment, staging and collision checks.

Discard remains a secondary action and opens a separate explicit
confirmation step before any files change. The final discard confirmation uses
the destructive button style; cancelling either step leaves files and drafts
untouched. Discard never touches excluded or ignored files.
Selecting HEAD with saved edits or dirty drafts offers **Restore this version's
contents** rather than a disabled **Already at this version**. It uses the same
save-first or explicit-discard confirmation and runtime/task guards. Native
preview admits a same-commit target only for explicit discard, including a
draft-only restoration with no saved disk differences. Restoring the current
commit keeps HEAD's symbolic/detached state and branch refs unchanged, creates
no version or route, and still replaces the index with the target tree. Saving
changes first records a new version, then switches back to the chosen baseline
through the ordinary version-navigation path. Clean current versions remain
disabled. Cancellation or failure retains drafts; only confirmed eligible
changes are discarded.

Untracked collisions can only be replaced if included in the explicit eligible
discard snapshot; ignored files and symbolic ancestors still block checkout.
External staging, filters, unsupported repositories, locks, sensitive historical
paths and size violations remain native refusals. Partial disk/index/reference
publication failures report which stage failed; there is no silent rollback claim.

Unfinished assistant tasks, including restored checkpoints, require explicit
ending. Frontend producers are stopped and queued checkpoints drained before
native grant revocation and checkpoint removal. Ended task IDs reject late
checkpoint publication. Chats and saved changes remain; the explicitly ended
task's execution checkpoint and recovery journal are retired and cleaned through
the shared task lifecycle. Git recording, history and restoration are unchanged.
Native preview and confirmation independently reject a new active grant or
checkpoint; restarting the App does not authorize resuming an ended task on
another code version. A running project is explicitly stopped before switching
and stays stopped; a foreign runtime or stop failure blocks the operation.

Drafts are retained through failure. After a successful explicit discard, only
the captured dirty draft objects are removed; newer drafts survive and enter the
normal conflict workflow. Both restoration choices also evict captured editor
copies of the native preview's affected paths, including saved new files removed
by checkout. Otherwise the common external-deletion recovery would revive their
old text as unsaved edits after the user restored a version. Unaffected and
newer editor copies remain. Existing `synchronizeSaved` owns inventory, saved
versions and editor resets, keeping task undo and Git logic independent.

Tests live in `git_versions_tests.rs`, `CreationGitPage.test.tsx`,
`CreationWorkspaceNavigation.test.tsx`, `creation-git-workflow.test.ts` and
`creation-git-graph.test.ts`. Native App layout, clicks and runes-pnds workflow
remain user-run acceptance; automated tests do not constitute that evidence.

## Git comparison files and code (layout A, 2026-10-19)

The compact vertical version graph sits above the full-width code difference.
The duplicate current-version strip and circle legend are removed. Nodes form
32px rows, with branch lanes on the leading side and readable one-line messages,
branch names, date and short ID. Current and selected states remain explicit.
The topological order puts loaded children before parents despite timestamp
skew; missing ancestors stay boundaries, not invented edges. A 1,200-commit
linear history stays one lane without recursive layout or zooming tiny labels.

`CreationGitSplit` provides an 8px pointer-captured horizontal separator. Drag,
arrow keys, Home/double-click reset and context-menu taller/shorter/reset actions
share readable graph/difference bounds. Cancel/lost capture restores the initial
ratio; window resizing clamps it. Height and collapse survive reading-view
navigation locally without preference writes, code writes or runtime changes.
A collapsed graph gives its space to the difference view. Selecting/locating a
version only scrolls or changes inspection. The save/switch/task guards remain
in `CreationGitPage`; these presentation components acquire no native authority.
The left sidebar
switches to comparison files while Git is visible: **Changed / All**, path
filter and directory expansion use the comparison inventory, including historical
deletions. Selecting a path changes only `gitPath`; it never selects a writable
workspace file. **Open current file** explicitly enters the existing editor only
when the current workspace contains that path, retaining its draft. The normal
file tree remains mounted but hidden and disabled, so its search, expansion and
new-file form survive navigation. No comparison click saves, checks out, stops
runtime or starts/continues an assistant task.

`getCreationGitComparison` defaults to **first parent → selected commit**,
including empty tree → initial commit. Merge commits can select another actual
parent. **Selected commit → saved files** and the unrecorded node's **HEAD →
saved files** read disk only, excluding editor drafts and the staging layer.
The before/after names and short IDs stay visible. `git_comparison.rs` builds a
bounded project-relative union with added/deleted/modified/unchanged states;
private/generated paths are excluded. An identity-scoped read token binds the
selected immutable objects and saved byte/mode fingerprints. It grants no writes.
The parent-repository prefix is retained; existing native checkout and task
permissions remain separate.

`readCreationGitComparisonFile` reads one catalog path through held project
access or bounded Git blob access. Saved bytes are hashed again and newly
appeared/deleted/replaced paths reject the old snapshot. libgit2 buffer patches
provide actual hunks, old/new line numbers, signs, statistics and missing-newline
markers. Unified and paired split layouts render escaped React text, using theme
red/green backgrounds plus signs. Context expansion and hunk navigation do not
write files. Binary/nonregular/unsupported text and over-limit files have explicit
outcomes; none is represented as an empty text file. Text and patch output are
bounded to 1 MiB, at most 4,000 rendered lines and 1,000 hunks. Saved catalog
hashing retains the existing 64 MiB/file, 256 MiB total, 4,096-entry/depth-32
bounds and rejects symbolic saved paths without reading their targets.

The reading store shares only the inventory, loading outcome and selected path.
Comparison requests and file results reject late completion after selection,
project, saved revision, focus refresh or ref changes. Failed comparisons are not
cached as successful reads; returning to an earlier selection retries it. Hiding
and returning without changes retains mode, selected file, graph height, layout
and loaded results. Workspace changes clear comparison paths. Save receipts remain internal
so warnings survive graph-refresh failures and remain accessible through toolbar
details. Successful saving shows a brief result toast and selects/locates the new
node, without a permanent success card or a status row above the split.

Native fixtures cover directions, initial files, deletion/addition, saved-byte
conflicts, paths/tokens, binary/large files, symbolic boundaries, merge parents,
hunks and missing newlines. UI tests cover sidebar selection, filters, layouts,
late results, navigation, toast/warnings and the existing restoration/task guards.
Real App layout and runes-pnds remain user-run acceptance.

## Editable display names and name series (2026-10-21)

`git_version_names.rs` stores one JSON name/base/sequence value per immutable commit in repository-local `pndsVersion.<oid>.display` configuration. No commit, tree, index, branch, working file, global config or remote is rewritten. All graph, branch, history and comparison labels use the same display lookup. Copies that preserve `.git` retain names; ordinary clone/push and `.pnds` do not carry this local metadata.

`renameCreationGitVersion` requires the current editable identity, an independent writable repository, a reachable commit and the expected old display name. Names are trimmed, nonempty, control-free and at most 120 characters; stale names reject with VersionConflict. Existing config/repository lock and boundary refusals remain. Native Git config publication is atomic; failure leaves the old value. Renaming starts that commit’s new name series at zero and never bulk-renames descendants.

The graph’s optional `nextName` comes from HEAD’s stored base/sequence, not the inspected node. Naming skips current display names across the bounded graph and all retained local name metadata, including other routes. Legacy names with a trailing positive ordinal can continue that convention. New custom names start a literal series; generated names retain their original base so “Name 1” continues as “Name 2”. The UI preserves a manually entered name across refreshes; after saving it uses the new native suggestion. A renamed current version changes the next default; renaming an inspected historical version does not change the origin.

Config metadata is regular, bounded to 1 MiB and never interpreted as file or execution authority. Recording retains its real commit receipt if subsequent metadata publication fails and reports that warning. Saving from history keeps the existing branch/checkout guards. Tests in `git_version_names_tests.rs` cover reopening, commit/tree/index/disk invariance, current versus historical naming, branches, collisions, stale names and identity changes.

## History and editor adoption

`getCreationGitHistory` shows up to 30 project-affecting commits, scanning at most
300 along the first-parent chain from HEAD. It reports a limit explicitly, scopes changed paths to the trusted
project, and compares merges with their first parent. Author, timestamp, message,
full ID and changed paths come from real commits. Messages total at most 1 MiB;
changed paths total at most 4,096. Commit/tree inputs are checked before library
materialization: 1 MiB per object, 16 MiB distinct object bytes per request,
4,096 entries per tree inventory and 65,536 accumulated entries. Index input is
at most 1 MiB / 4,096 entries; tracked saved bytes keep the same 64 MiB / 256 MiB
bounds. Reachability checks follow at most 300 first-parent commits. This is a
bounded view, not all branches or all history.

`readCreationGitHistoryFile` independently reads the selected immutable object
and the current supported text. Binary, missing, directory, symbolic-link,
unsupported/invalid UTF-8 and over-1-MiB content cannot be loaded. Out-of-project
paths fail containment. `loadCreationGitHistoryText` rechecks reachability and
the captured current disk fingerprint; it returns text and never writes files.

`creation-files-store.loadHistory` requires the exact captured draft object and
checks that capture again after the command. Keep/cancel preserve it; explicit
replacement adopts historical text with the **current disk text/version** as
its save base. A different disk version resets editor history through the #224
`editorRevision` rule; loading against the same baseline is an ordinary draft
edit. Late file operations or project switches cannot seed another draft.
Save still uses the existing manifest/README validation and conflict workflow.

Public temporary-repository and React workflow evidence is recorded in
[the acceptance record](../acceptance/228-230-local-git.md). Native App, theme,
keyboard, real runtime/sound and installed arm64/Intel acceptance remain separate
from the automated contract tests.

## Legacy saved-file restoration

The retained legacy history surface offers **Return to this version** on a selected commit. Preview
lists every changed path; explicit confirmation restores the complete tracked
saved tree, including resources, additions and deletions. HEAD, index and all
recorded commits remain unchanged; the result is an ordinary uncommitted change
that can be reviewed and recorded with Save current version.

`previewCreationGitRestore` owns a one-use identity/snapshot token. Confirmation
revalidates the full files/HEAD/index/config fingerprint while holding standard
index and reference locks. Only clean independent writable repositories qualify.
Uncommitted files, staged content and conflicting untracked paths must be handled
first. Ignored files are never overwritten. Historical links, submodules,
checkout attributes, excluded sensitive/generated paths and oversized input are
refused. History/tree and 64 MiB per-file / 256 MiB total bounds remain in force.
Libgit2 safe checkout uses `update_index(false)`; no hooks or external tools run.
I/O failure can leave partially restored working files and reports that fact;
recorded history and HEAD remain available for recovery.

The UI also requires no drafts, an idle assistant and no runtime operation.
The native confirmation acquires the shared App/CLI runtime lease through the
entire restore, closing the start-versus-restore race. Successful restoration
polls disk through the existing watcher/adoption flow and shows a receipt.

Settings has a separate **Git identity** category. `gitName` / `gitEmail` are
optional app-local preferences saved on field blur through the existing queue.
New projects and version recording prefill them; each form retains manual
edits. Empty values retain the existing creator/local-placeholder fallbacks.
They never change global Git configuration.

## Workspace Git location (2026-10-19)

The titlebar shows the current local branch and HEAD version name. A detached
checkout is labelled Historical position. Its menu lists local branches and their
tip summaries, plus full graph and Save current version. Selecting a branch routes
through the existing graph confirmation, draft-save/discard choice, explicit task
end, parameter-preview shutdown and runtime-stop protections. Navigation alone
never checks out code. A successful switch remains stopped.

Branch selection uses `preview_creation_git_branch_switch(identity, branch,
expected_commit, discard)` and the same one-use native switch session as version
selection. Preview rejects a moved branch; confirmation locks its full ref and
checks the tip again before updating HEAD symbolically in the Git transaction.
A historical-version selection still detaches HEAD. Attaching another branch at
the same commit is supported; subsequent save advances that branch. Existing
private-file, index/staged, worktree fingerprint, runtime lease and project identity
checks apply to both flows. Graph branch metadata includes each tip's bounded
summary even when that version lies outside the first graph page. Completed saves
and switches publish a separate `gitRevision` refresh signal; they do not replay
navigation/record intents.
