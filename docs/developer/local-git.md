# Local Git recording and history (#228–#230)

The confirmed merge workflow now uses isolated candidates before publication.
See [merge candidates](./merge-candidates.md) for native ownership, recovery,
assistant rounds and saved-copy testing; ordinary version navigation below
continues to use its existing controls.

For editable folder projects, **Version history** next to **PNDS creation
assistant** opens the comparison file list, version tree and code differences.
**Save current version** opens a separate naming dialog, saves drafts through
their normal version checks, then records eligible disk changes. The saved
commit becomes the selected version; the pencil beside its name edits that
exact version in place. Selecting a historical version or file changes only the
comparison. Switching to a route tip checks out the named route;
continuing from an older version keeps its history and forks on the next save.
The advanced **Git status and differences** inspection dialog remains
available for protected and read-only projects.
Assistant recovery records are independent and never create a commit.
Blank and Classic are the only automatic-commit
exception: generation makes an independent repository and `Initial project`
inside private staging before publication. Any failure leaves the old workspace
and target untouched. Existing folders never initialize merely by opening them.

The recording surface leads with the change message and selectable saved-file
changes; author/email and project/repository metadata are separate disclosures.
The explicit confirmation still shows message, identity and every selected path.
The middle page shows each version name and time in the graph. Its adjacent
operation area displays the selected version's real author, recorded time,
identifier and parents directly. Selecting a text file shows its difference
before optional complete source snapshots. The legacy recording and history
dialogs retain their disclosures; the middle version page uses a brief success
toast and graph selection, with native warnings retained for explicit inspection.

The version page follows the approved B flow notification pattern: saving,
switching/restoring and renaming update the same notification at real operation
boundaries. Saving and switching are separate explicit actions in the middle
page; switching does not save first. A returned commit receipt is preserved
before refreshing history. Refresh
failure is a warning with an owner-checked refresh action, never a failed-save
claim or another commit attempt. Completed checkout with incomplete file
synchronization similarly retries only synchronization and reading. Native
receipt warnings remain available in operation details and produce a warning outcome. Unmounting
or replacing the workspace dismisses pending presentation and rejects late
feedback. See [operation feedback](./notifications.md#approved-b-operation-feedback-2026-11-04).

## Completed version operations

`src/lib/creation-git-workflow.ts` owns completion and recovery for saving,
switching/restoring, renaming and applying a GitHub update. Native success
immediately returns a `CompletedGitOperation` containing the actual outcome,
description and any receipt warning. Progress reports presentation only; a
`synchronizing` notification is not evidence that a write succeeded. The page
retains the completion before updating its selection or issuing follow-up reads.

`recover` publishes the Git change signal, clears the captured pre-checkout
editor copies once when applicable, synchronizes saved files and refreshes
history through the page's read adapter. It contains no save, checkout, rename
or GitHub update command. A false result or exception leaves the relevant
follow-up pending without removing the completed outcome. Reading the actual
HEAD remains useful when file synchronization failed; after a successful read,
another recovery attempt retries only the unfinished synchronization. Successful
synchronization likewise is not repeated just because history reading failed.
Concurrent recovery calls share the same in-flight work.

Completed outcomes and receipts remain independent, while unfinished follow-up
is shared by completions with the same workspace ownership. A later rename or
save therefore cannot clear an earlier checkout's pending synchronization. Its
recovery also attempts that synchronization; if it still fails, the latest
completion keeps the retry available. Each new completion advances the recovery
revision, so an older in-flight synchronization or read cannot clear work added
by a newer completion. Captured checkout copies are cleared once each, preserving
editor copies created after those checkouts.

The workflow captures a private ownership token before dispatch. It changes when
the workspace's project ownership or active mode changes, independently of the
mode-confirmation epoch: cancelling a mode confirmation keeps the current
project's recovery usable. Normal file polling retains that project ownership;
reopening receives new ownership even when its public identity matches. Recovery
checks the token, issued project identity and caller's lifetime before and after
asynchronous work; once invalidated it cannot become current again. Returning to
the same project therefore cannot
revive an old recovery. The page continues to own selection and notifications,
while the workflow owns completed facts and unfinished follow-up. This is an
internal ownership pattern; native transactions, explicit confirmations and
persisted formats retain their existing contracts.

## Engine and distribution

`git2` 0.21.0 statically links vendored libgit2 1.9.7 through
`libgit2-sys` 0.18.8. Production Git reads and writes use library calls.
Remote operations use HTTPS through the native GitHub integration.
Local history and diff read only local objects. Partial-clone configurations
are rejected before status, diff or history. Ordinary missing objects return errors.
See [GitHub sync](./github-sync.md) for the transport and credential boundaries.
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

New-project signatures use the independently editable Git name. Its default is
the App preference, project creator or `PNDS Creator`, in that order. The email
starts blank and becomes `creator@pnds.local` unless the creator explicitly
supplies an address, such as a GitHub noreply address. The initial commit stores
the identity in repository-local Git configuration. Subsequent versions use the
identity from the repository preview. Existing valid resolved Git identities
prefill that preview through an identity-only read. Recording operations write
identity to the project repository's configuration, separate from project
metadata and global Git configuration.

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
The low-level recording command receives saved bytes only. The save workflow first
saves all drafts through their existing version-checked save path, then records
default-eligible changes. It refuses external staging, reports excluded files and
does not create empty versions. Neither path applies proposals, refreshes pages,
starts/restarts runtime, requests a model or creates a handoff. Initial generation
is the sole automatic commit.

A route switch or restore displays any required runtime stop and assistant-task
ending inline before execution. Its reviewed snapshot captures the runtime
generation; a new session during preparation requires another review. Native
stopping accepts only that reviewed generation. After switching, the project
remains stopped until the creator starts it manually. The middle-page button
confirmation described below replaces its earlier save-first/discard dialogs;
legacy saved-file restoration retains its separate confirmation workflow.

## Historical checkout permissions (2026-11-15)

Saving defaults and checkout permissions are separate. `local_git::excluded`
still keeps new logs, generated data and credentials out of ordinary captures.
A local historical tree can restore bounded regular tracked files, including
archived `.log` files, binary resources and files beneath generated directories.
Both the target tree and the current index refuse Git metadata/attributes,
PNDS private paths and credentials/keys; checking the current index also prevents
checkout from deleting previously tracked private files. Historical symbolic
links, submodules, macOS path aliases and size/inventory excesses remain refused
with the concrete path and reason. Each tree is bounded to 4,096 entries / 32
levels; file bytes remain capped at 64 MiB each and 256 MiB per collection.

A branch/version switch may explicitly replace a target file currently present
as an untracked or ignored regular file. Its `overwrittenPaths` preview is
separate from `discardedPaths`: overwrite authority is limited to files actually
present in the selected tree and never removes unrelated excluded/generated
files. Only explicitly discarded ordinary new source files absent from the
target are removed. Private chats, materials and recordings remain outside
both sets. Checkout hashes the exact current-index/target file union through
the held project root, independently of the save inventory; even a same-length
change under an ignored directory invalidates the one-use preview. Confirmation
checks these bytes again under the existing ref/index locks. A raw HEAD-to-index
diff rejects all external staged changes, including staged deletions hidden by
the ordinary private/generated status filters; filtered UI status is never the
authority for clearing an index.

The frontend prepares an opaque switch before ending a task or stopping a
runtime. Pure native preview can inspect an active-task workspace, while native
confirmation still requires the task to have been explicitly ended. The inline
review discloses discarded source and overwritten target paths, plus the exact
route, version time and identity. The second click consumes the original native
token; it cannot obtain a fresh preview and silently authorize changed content.
Draft, owner, task, runtime and navigation changes retire the review. A completed
switch remains stopped and synchronization retries never repeat the checkout.

Temporary-repository tests cover archive round trips, excluded-directory byte
ownership, ordinary binary restoration, explicit ignored-file replacement,
private/current-index protection, stale previews and actionable refusals.
The ignored `git_checkout_acceptance` test additionally accepts source/branch/
commit via `PNDS_GIT_ACCEPTANCE_*`, copies the source repository to a temporary
project, checks out through the public native controls and verifies every target
blob, file mode, index and branch. The original project is fingerprinted before
and after; no user source path or work content is embedded in the test.

## Middle workspace version page (2026-10-19)

[ADR-0011](../adr/0011-creator-git-version-navigation.md) defines the user workflow.
The approved 2026-11-15 review supersedes the earlier toolbar, resizable split
and switch-dialog presentation. `CreationGitPage` stays mounted across
reading-view changes. Selection, comparison mode, selected file, graph scroll,
optional save names and loaded graph pages survive navigation; entering the
page never saves, stops runtime or ends an assistant task. Native graph,
comparison and file reads remain independent of write authorization.

A compact 32px **Project versions / GitHub** row sits above the graph. GitHub
opens the existing project settings and applicable actions; its scope follows
the working route, independently of the version being inspected. It is not a
separate always-visible backup action. Existing binding, authorization and
remote-update behavior is owned by [GitHub sync](./github-sync.md).

The overview has a 160px minimum height, a horizontally scrolling version graph
on the left and a fixed 176px operation area on the right. The compact operation
area uses 8px padding and 24px actions, identifies the selected version by name,
and directly lists real author, target route, short identifier and parents.
The full identifier remains available on hover; recorded time appears only
under the tree node. The merge action has no leading icon, and switching omits
the redundant live-test-stop note while retaining its existing native stop.
The route is the actual named target requested by the switch; a historical
checkout is labelled as such instead of guessing another branch at the same tip. A pencil beside
the name opens an inline input; there is no rename dialog or three-dot menu in
this page. The operation area and metadata do not scroll or paginate; rare inline
rename errors can grow the overview instead of clipping controls. The graph uses
size containment so long history keeps its own scrolling viewport. Unrecorded
changes instead show save and their summary, with no commit
metadata or rename action. Saving opens its independent naming dialog, including
an optional route name when saving from a historical position.

The overview leads directly into the unified difference view. The App's 226px
file sidebar owns comparison choices, search and changed files; the existing
preview and other middle-workspace tabs retain their roles. The page has no
route-filter/refresh row above the tree, graph-collapse/resize controls,
duplicate version header, before/after strip or split-difference toggle.

Progress, read errors, synchronization reminders, native receipt warnings and
outcomes use the existing flow notification. Underlying operation errors,
exclusions, warnings and repository facts remain available through a contextual
operation-details action in the full-width strip below the tree. Discarded-file
lists and long preparation/merge notices use that strip rather than crowding
the narrow operation area. Its Refresh action also
handles pending synchronization;
dismissing feedback does not clear them. Owner-checked failure actions retry
only unfinished file synchronization and version reading, without another save
or checkout. Removing the old fixed refresh control does not remove that
recovery path. Inline rename/switch failures retain their operation state and
native error detail rather than opening the retired confirmations.

`getCreationGitVersions` walks HEAD and local branch tips with explicit bounded
commit reads, following every parent, including external merge commits. Pages
contain at most 60 commits, with a 1,200-commit scan bound and at most 128 local
branches. Existing Git object, tree and message/path bounds remain enforced.
Missing older parents are shown as unloaded boundaries, never invented edges.
Saved-version positions stay stable when unrecorded changes appear or disappear.
The dashed working node is a presentation-only child of actual HEAD, placed one
column after it. When HEAD already has saved children, a separate lane shows the
new fork near HEAD instead of extending a descendant's tip. Inspecting another
version does not change this anchor.
Each graph version carries its real commit author name alongside its timestamp,
message and parents. Author text shares the existing bounded display-text budget;
the UI does not substitute the prototype's sample identity.
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

All inspected versions use **Switch to this version**. For a clean project,
clicking executes the switch directly after fresh preparation; no switch dialog
opens. With eligible saved-file changes or live editor drafts, the first click
arms the same button as **Discard changes and switch**, and a second deliberate
click executes. A held Enter/Space key cannot count as both clicks. Saving is a
separate action for creators who want to preserve their current changes first.

Before either history or named-branch switching, the page rereads current Git
status rather than trusting an older inspection snapshot. For untracked files,
it consults the read-only `getCreationGitRecordFiles` catalog and protects
default-included paths. The same reader filters initial, focus and post-checkout
status refreshes before counting changes or selecting the working node. Raw Git
status still includes excluded untracked files; logs, private data or unselected
large media alone cannot create a working branch. The catalog reuses recording
inclusion policy without issuing or invalidating a recording-confirmation token.
It uses read-only Git discovery and held-root file metadata, preserving history
inspection in parent repositories and worktrees; save/switch retain their write
boundaries and fresh native confirmations.
Tracked and externally staged changes remain protected regardless of
recording defaults. Generated/private/log files and default-excluded new large
media alone do not require discard confirmation. A failed status, recording or
task-recovery read blocks switching; it is never interpreted as a clean project.
This preparation authorizes no write: final switching obtains a fresh native
preview and retains all containment, staging, collision and one-use-token checks.

The armed review belongs to the selected target, current version and actual
saved/draft, assistant-task and runtime state. Target or state changes retire it;
Escape, outside interaction, leaving its focus or window blur also cancels it.
Cancellation changes no files or drafts. Known task-ending and runtime-stop
consequences appear inline beside the action before the initiating click. If
preparation discovers a previously unknown restored task, the page shows that
consequence first and requires a fresh click instead of ending it invisibly.
A new task or runtime generation requires another review; native guards still
independently reject stale authority.

Selecting HEAD with eligible changes uses the same action and inline discard
confirmation to restore its contents. A clean current version is disabled; the
page does not use separate restore/continue labels. Native preview admits a
same-commit target only for explicit discard, including draft-only restoration.
Restoring the current commit preserves symbolic/detached HEAD and branch refs,
creates no version or route, and replaces the index with the target tree. Only
the confirmed eligible changes are discarded; ignored and excluded files remain.
After successful save or switching removes the actual changes, the dashed
unrecorded node disappears and selection resolves to the real current version.

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
normal conflict workflow. Successful switching/restoration also evicts captured editor
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

The horizontal graph places saved versions strictly by recorded time, older on
the left and newer on the right, with an identifier tie-break for equal times.
Topological traversal allocates reusable lanes independently of these columns;
real parent edges may run backward when commit clocks disagree. Neither actual
HEAD nor the inspected version reprioritizes saved-node coordinates. Each node
shows a short name with its time below. Only HEAD has the
filled current marker; the inspected node has a separate selection ring and name
highlight. Route names and full identifiers are available in the node hint.
Missing ancestors stay explicit unloaded boundaries with no invented edge.
Parent-to-child paths use two tangent-continuous rounded bends in the column
gap, with up to a 14px radius and horizontal entry into each node.
`gitVersionEdgePath` in `creation-git-graph.ts` owns this bounded route: a long
merge edge stays on its source track until the final column gap, keeping its
rounded turn clear of version names and times. The same
geometry handles upward/downward merges, reverse-time edges and the unrecorded
branch beside HEAD, avoiding saved nodes and their labels.
Its label uses its intrinsic width, including the complete English name, without
moving saved-version anchors; horizontal scrolling keeps a trailing gutter.

Long history scrolls horizontally, with additional lanes scrollable inside the
graph. Selection and newly loaded versions can be brought into view in both
axes; ordinary comparison/file updates preserve the scroll position. Earlier
pages remain available through the compact load-earlier action, with the native
limit still explicit. The dashed unrecorded node exists only when actual eligible
saved-file changes or editor drafts exist. Presentation components have no native
write authority; save/switch/task guards remain in `CreationGitPage`.

While Git is visible, the 226px left sidebar contains **Changes in this version /
Compare with local files**, followed immediately by search and the changed-file
list. It has no Changed/All filter, before/after endpoint description or duplicate
version summary. The changed-files heading leads directly into compact text
tabs, without a divider. The tabs follow the workspace navigation's active-text
weight and accent underline, using theme hover and keyboard-focus states rather
than a raised segmented track. The native comparison inventory may contain
unchanged files, but they are never selectable in this view. Switching comparison
clears a path that is no longer changed; an empty comparison has no selected
historical path.
Directory expansion and search use the comparison inventory, including historical
deletions. Selecting a path changes only `gitPath`, never a writable workspace
file. **Open current file** explicitly enters the editor only when the current
workspace contains that path, retaining its draft. The normal file tree stays
mounted but hidden and disabled, preserving its own search, expansion and new-file
form. No comparison click saves, checks out, stops runtime or starts/continues a task.

**Changes in this version** compares first parent to the selected commit, using
the empty tree for an initial commit. External merge commits use their first
actual parent in this page; the native API continues to validate explicit parent
requests independently. **Compare with local files** compares the selected commit
to saved disk files, excluding drafts and staging. The unrecorded node fixes the
scope to HEAD versus saved files and hides the redundant mode choices. The two
buttons retain their comparison meaning in their accessible state and scope
hints; removing the visible endpoint strip does not change comparison direction.

`git_comparison.rs` builds a bounded project-relative union with
added/deleted/modified/unchanged states; private/generated paths are excluded.
An identity-scoped read token binds immutable objects and saved byte/mode
fingerprints and grants no writes. Parent-repository prefix handling and existing
native checkout/task permissions remain separate.

`readCreationGitComparisonFile` reads one catalog path through held project
access or bounded Git blob access. Saved bytes are hashed again and newly
appeared/deleted/replaced paths reject the old snapshot. libgit2 buffer patches
provide actual hunks, old/new line numbers, signs, statistics and missing-newline
markers. The page renders only unified escaped React text, using theme red/green
backgrounds plus signs. Context expansion and hunk navigation do not
write files. Binary/nonregular/unsupported text and over-limit files have explicit
outcomes; none is represented as an empty text file. Text and patch output are
bounded to 1 MiB, at most 4,000 rendered lines and 1,000 hunks. Saved catalog
hashing retains the existing 64 MiB/file, 256 MiB total, 4,096-entry/depth-32
bounds and rejects symbolic saved paths without reading their targets.

The reading store shares inventory, loading outcome, changed-path selection,
comparison mode and whether the working node is being inspected. Its explicit
mode bridge connects the sidebar to the page; it does not infer user intent from
an older returned comparison. Comparison requests remain serialized and file
results reject late completion after selection, project, saved revision, focus
refresh or ref changes. Failed comparisons are not cached as successful reads;
returning to an earlier selection retries them. Hiding and returning without
changes retains mode, selected file, graph scroll and loaded results. Workspace
changes clear comparison paths and modes. Save receipts remain internal so
warnings survive graph-refresh failures and remain inspectable. Successful saving
shows a brief result toast and selects/locates the new node, without a permanent
success card or another status row above the graph.

Native fixtures cover directions, initial files, deletion/addition, saved-byte
conflicts, paths/tokens, binary/large files, symbolic boundaries, merge parents,
hunks and missing newlines. UI coverage includes changed-only selection, shared
comparison modes, unified differences, graph ancestry/scroll/pagination, inline
rename and switch confirmation, late results, navigation, toast/warnings and the
existing restoration/task guards.
Real App layout and runes-pnds remain user-run acceptance.

## Editable display names and name series (2026-10-21)

`git_version_names.rs` stores one JSON name/base/sequence value per immutable commit in repository-local `pndsVersion.<oid>.display` configuration. No commit, tree, index, branch, working file, global config or remote is rewritten. All graph, branch, history and comparison labels use the same display lookup. Copies that preserve `.git` retain names; ordinary clone/push and `.pnds` do not carry this local metadata.

`renameCreationGitVersion` requires the current editable identity, an independent writable repository, a reachable commit and the expected old display name. Names are trimmed, nonempty, control-free and at most 120 characters; stale names reject with VersionConflict. Existing config/repository lock and boundary refusals remain. Native Git config publication is atomic; failure leaves the old value. Renaming starts that commit’s new name series at zero and never bulk-renames descendants.

The pencil beside the selected name opens an inline input bound to that exact
commit and expected display name. Enter saves, Escape cancels, and leaving the
field saves valid changed text; empty text restores the original name and an
unchanged name causes no write. IME composition does not submit the field.
Rename completion must not consume the click that moved focus to another
control. Failed native publication keeps the edit available with its error;
workspace/selection ownership still rejects stale completions. Metadata and the
current-version naming origin update from the successful native result, with
refresh failures following the existing retry-only feedback rules.

The graph’s optional `nextName` is a UI suggestion. When the creator leaves the name empty, native recording chooses the name under its Git locks using the current HEAD’s stored base and sequence. This reads names and commit metadata independently of the history page and its tree diff budget. The chosen name is used for the commit and returned in the save receipt. A history refresh can fail after recording and can be retried without saving again. A first save in a repository without a commit uses the localized default from the App.

Naming skips current display names across the bounded commit traversal and retained local name metadata, including other routes. Legacy names with a trailing positive ordinal can continue that convention. A custom name can start its own series. Generated names retain their original base, so “Name 1” continues as “Name 2”. The UI preserves a manually entered name across refreshes. Renaming the current version changes the origin for the next default. The inspected version has no effect on the next default unless it is also current.

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
checkout attributes, protected private/credential paths and oversized input are
refused. Historical ordinary logs/resources use the checkout policy above. History/tree and 64 MiB per-file / 256 MiB total bounds remain in force.
Libgit2 safe checkout uses `update_index(false)`; no hooks or external tools run.
I/O failure can leave partially restored working files and reports that fact;
recorded history and HEAD remain available for recovery.

The UI also requires no drafts, an idle assistant and no runtime operation.
The native confirmation acquires the shared App/CLI runtime lease through the
entire restore, closing the start-versus-restore race. Successful restoration
polls disk through the existing watcher/adoption flow and shows a receipt.

Settings has a separate **Git identity** category. `gitName` / `gitEmail` are
optional app-local preferences saved on field blur through the existing queue.
New projects prefill the name. Both preferences prefill the first version in an
existing project without history. Once the project has a history, both recording
paths start from its repository identity. The manual record form can still edit
that identity. Empty values use the existing creator and placeholder fallbacks.

## Workspace Git location (2026-10-19)

The titlebar shows the current local branch and HEAD version name. A detached
checkout is labelled Historical position. Its menu lists local branches and their
tip summaries and a link to the full version tree. Selecting a branch routes
through the shared inline version-switch review, including eligible-change
discard, explicit task-ending consequences, parameter-preview shutdown and
runtime-stop protections. Navigation alone
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
