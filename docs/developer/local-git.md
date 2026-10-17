# Local Git recording and history (#228–#230)

The project menu's Git dialog owns three explicit surfaces: status/differences,
recording and local history. Blank and Classic are the only automatic-commit
exception: generation makes an independent repository and `Initial project`
inside private staging before publication. Any failure leaves the old workspace
and target untouched. Existing folders never initialize merely by opening them.

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
and refused, including filter attributes without a configured driver and text/eol/crlf transforms. No reset,
index clearing, branch switching or automatic repair exists.

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

Audio/video/model extensions at **10 MiB or more** are unselected by default and
can be explicitly included: WAV/AIF/AIFF/FLAC/MP3/OGG, MP4/MOV/MKV/WEBM,
ONNX/PT/PTH/BIN/GGUF/SAFETENSORS. Already tracked resources remain visible;
new large-media defaults never delete or untrack them. Each file is capped at
**64 MiB**, collected content at **256 MiB**, inventory at **4,096 entries** and
depth **32**. Git metadata is limited to 65,536 entries with the same depth
bound; symbolic metadata is refused. Over-limit operations require external tools. Sizes describe saved
bytes and possible history growth, not compressed Git storage guarantees.

Draft count, unapplied proposals and temporary-preview state are separate facts.
Recording never saves drafts, applies proposals, refreshes pages, starts/restarts
runtime, requests a model or creates a handoff. The user can always type a message
offline. Initial generation is the sole automatic commit.

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
