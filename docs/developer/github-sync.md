# Creation GitHub sync

The Git versions toolbar has one compact **Cloud + GitHub** entry beside
**Project versions**. It opens the existing project repository settings dialog;
account sign-in and sign-out remain in **Settings → GitHub account**. The toolbar
does not expose a separate status row or backup/update buttons. The entry retains
an accessible live status, a descriptive name and an attention color for pending
uploads, conflicts and failures.

Repository settings shows the current worktree branch and saved version, its sync
status and one applicable action, such as **Back up to GitHub**, **Update from
GitHub** or **Continue upload**. Browsing an older version leaves these operations
on the checked-out route. A remote check failure keeps the labelled last known
observation and offers refresh. A branch change refreshes the new route even when
both routes point to the same saved version. Sync errors, interrupted-upload
access recovery and the public-directory invitation also stay inside settings.
Opening settings preserves a failed operation's details until a new operation or
explicit refresh clears them.

The same dialog retains the connected repository, its visibility, the link to
GitHub, refresh and route-specific automatic backup. You can bind an empty
repository or one that shares Git history with the local project. Changing the
binding reviews both repositories and the new visibility. Unlinking reviews the
current repository. Native code checks the selected and existing repository IDs
before replacing a binding. Changing or removing the binding clears the old
destination's pending backups and preserves all local versions.

The versions toolbar displays the connected GitHub account's avatar immediately
after the **GitHub** entry. The titlebar project picker retains its folder icon;
expanding Monitor keeps the plain project name. Open **Settings → GitHub account**
to connect through the system browser or sign out. Repository selection can also
start the same device authorization. Choose **Clone from GitHub** from the project
picker. Public clones can read a GitHub repository by its `owner/repo` name.
A successful clone opens through the normal workspace flow and binds its source with manual backup
by default. [ADR-0018](../adr/0018-creator-github-backup.md)

## GitHub App registration

Open [New GitHub App](https://github.com/settings/apps/new) for a personal
registration. Use the PNDS repository URL as the homepage, leave webhook
delivery inactive, and enable **Device Flow** and **Expire user authorization
tokens**. Set the repository **Contents** permission to **Read & write** for
clone, fetch and push, and **Repository creation** to **Read & write** for new
repositories from the official template. Existing installations must approve
the added permission. Choose who may install the app according to the
distribution audience, and install it on the repositories intended for sync.
[GitHub App registration](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)
· [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)

Set these two public values in the PNDS release repository's GitHub Actions
variables. The release workflow passes them to both macOS build lanes.

| Variable                | Value                                          |
| ----------------------- | ---------------------------------------------- |
| `PNDS_GITHUB_CLIENT_ID` | Client ID displayed in the GitHub App settings |
| `PNDS_GITHUB_APP_SLUG`  | Slug used in `https://github.com/apps/<slug>`  |

For local testing, replace both sample values and launch PNDS from the same
shell. Restart an existing development run to pick up the values.

```sh
PNDS_GITHUB_CLIENT_ID='your-client-id' PNDS_GITHUB_APP_SLUG='your-app-slug' npm run tauri:dev
```

Unconfigured builds retain local Git and public cloning. The native device flow
uses the public client ID and saves user access and refresh tokens in macOS
Keychain. The WebView receives account metadata, the verification code and a
browser URL. [GitHub device flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token)

## Sync boundaries

- Sync commands resolve the current editable creation workspace. The binding and
  pending backup belong to its native directory identity and are stored in
  `creator-github.json` under App data. Closing the project suspends retries.
  Unbinding or changing the repository clears pending backups for the previous
  target.
- The native transport uses the selected `github.com` repository and the checked
  out branch's exact ref name. An existing GitHub `origin` can suggest the
  initial binding. Sync uses explicit libgit2 remotes and a native credential
  callback. Existing Git remotes and branch tracking settings remain available to
  external Git tools.
- The push plan captures the local head, remote head and repository. The native
  command revalidates them before publishing. If preparation finds the same
  commit on both branches, it returns the refreshed status without a push plan.
  The first public backup and recreation of a previously backed-up branch
  require confirmation. Retry sends only the queued branch under its original
  binding.
- Native pushes check the commits the destination branch would gain for
  tracked PNDS private data. New branches check all reachable history. Existing
  branches check only commits absent from that branch's reviewed remote tip.
  This includes protected paths removed in a later commit. A rejected push
  leaves the GitHub branch and local history intact.
- GitHub REST reads retry once on timeout, with a 15-second deadline per
  attempt. Native logs record the operation and request phase for transport
  failures using fixed labels.
- The frontend blocks updates while editor drafts are present. Rust fast-forwards
  a clean branch through the existing staged change, assistant task and runtime
  protections and returns the affected paths from the completed checkout. Local
  version switches and GitHub updates use those paths to clear outdated editor
  copies from the pre-checkout snapshot. A watcher may see the deletion first.
  The checkout still clears its unedited copy and preserves later edits for the
  normal conflict workflow. The shared version workflow returns a
  `CompletedGitOperation` immediately after native success, before presentation
  callbacks or file synchronization. Its recovery clears captured copies once
  and retries only unfinished synchronization or history reading, without
  issuing another GitHub update. False results and exceptions retain the
  completed update and pending follow-up; concurrent recovery shares one
  attempt. Pending follow-up belongs to the workspace rather than the most
  recent operation: a later save or rename also recovers an earlier update's
  unfinished synchronization instead of discarding its retry. An older
  in-flight result cannot clear pending work from a newer completion.
  A private workspace ownership token, project identity and caller
  lifetime fence every follow-up, so an old recovery cannot affect a reopened
  project. Cancelling a mode confirmation preserves recovery for the current
  workspace. Progress remains presentation rather than evidence of native
  completion. See
  [completed version operations](./local-git.md#completed-version-operations).
  A diverged branch requires external reconciliation before sync can resume.
- Cloning stages the selected branch, validates it as a creation project and
  publishes it to a new directory. Runtime validation remains part of the
  existing explicit creation test.

## Create and upload an initial Blank version (#343)

The new-project form retains its input during browser device authorization.
Once connected, its read-only installation check lists owners that grant
repository creation and content writes. GitHub evaluates organization policy and
the user's permissions when handling the request. The public and private submit
buttons confirm the shown owner, repository name and visibility. **Create
locally** writes the Blank and initial Git version without an upload intent.

The native generator returns the actual new commit ID. Only after the local
workspace is adopted does the frontend send that ID and the confirmed target
to `githubUploadNewProject`. The command validates the active project, account
and exact initial version. It persists the intent in
`creator-github-uploads.json`, keyed by the same native project identity as
the binding database. The record distinguishes preflight, a started request
with no known result, and the repository ID returned by GitHub. An unknown
result leaves the original intent reserved for recovery.

GitHub receives one template creation POST, with only the default branch.
The response does not establish push permission. PNDS rechecks the authorized
repository ID, visibility and default branch, verifies the official source
and full published snapshot, then uses the existing pinned template merge and
normal push. The merge tree is the confirmed local tree and keeps both parents.
On success the repository is bound with manual backup. An installation that
has not yet exposed the new repository, or a remote ref that has not yet
propagated, leaves the local project and intent available to resume.

## First backup from the official Blank template (#329)

For an unbound App Blank with a saved version, **Manage → First template
backup…** verifies a repository already created from the official template. In
the GitHub template creation page, choose
the repository owner, name and visibility and use the template's default branch.
Add the new repository to the existing PNDS GitHub App installation, then
refresh the repository list in PNDS and select the target.

`githubVerifyTemplateBackup` checks the authorized target by repository ID and
requires push permission. The authorized target's REST response must identify
its template as `xO-xN/PNDS-Template` (repository ID `1326767366`). PNDS reads
the published tag from the official Git remote. The target's default branch
must contain a single root commit. A new-generation snapshot declares
`template: "Blank"` and its version in `docs/template-source.json`. The complete
Git tree of the root commit must equal the tree of the official tag
`pnds-blank-v<version>` for that declared version. Publish and retain that tag
for each template snapshot, including when updating the template's default
branch. The target version can differ from the version used to create the local
project.

The verification result names the selected repository and default branch. A
verified target requires a local branch with that exact name. Verification
fetches into temporary Git storage and leaves the project's Git history, index,
working files and binding untouched. See the [template workflow specification](https://github.com/xO-xN/PNDS-App/issues/327).

## Sending and recovering the first template backup (#330)

Review shows the target repository, default branch and exact saved local
commit. Public confirmation covers the committed files and all reachable
history through that commit. Immediately before a send, native code rechecks
the repository, installation access, visibility and branch tips. A normal
fast-forward push uses the original remote commit as the expected old value.

The first backup joins the saved local commit and the template root as parents
of a new commit whose tree is exactly the saved local tree. Before sending,
PNDS pins the merge commit under `refs/pnds/template-backup/` and saves its
identity, both parents, account, repository, visibility and branch in the
existing App-data database. An open pending operation reserves its original
target. The ordinary backup queue remains independent.

A refresh compares the remote default branch with the two recorded commits.
If it already points to the merge, PNDS completes the local integration and
binding. If it still points to the template root, **Continue first backup…**
opens a new review for the same saved version and merge. Any other state
reports a conflict. Public visibility is reviewed again before continuing.

After delivery, PNDS advances the original local branch without checking out
files. If later saves advanced that branch, a local integration commit keeps
the latest local tree and both histories. Those later saves are available to
back up separately. Drafts and the external Git index are left intact.

## Resume a new project's first upload (#344)

**Continue upload** opens a review of the saved target, route and commit. An
intent recorded before dispatch can create the original repository after that
review. If the creation response is unknown, PNDS reads the original name
using the original account. An inaccessible repository stays unresolved. A
same-name candidate needs explicit selection even when it passes official
template verification. PNDS does not infer a failed creation from an absent
repository in a selected installation, and does not repeat an uncertain POST.
**Keep project local** explicitly clears the unpinned intent and leaves any
GitHub repository in place.

A known repository is checked by immutable ID. A changed visibility is shown
in the review and is checked again on confirmation. Before preparing the
merge, PNDS rechecks the reviewed default branch tip and the full official
snapshot. A different repository, changed history, or nonmatching template
leaves both histories intact.

Once the merge is pinned, the same recovery may check the remote tip for an
already received push. Preparing or pushing the original confirmed version
checks the original named local branch and its ancestry even when the
creator has checked out another branch. The remote receives only the tree
and history through the confirmed version. Finalizing advances the original
route without changing the checkout, disk files or index. Its later local
versions remain available for a normal fast-forward backup.

## Upload an existing local route (#345)

**Upload to GitHub** opens a review for the checked-out route's saved commit.
The creator selects the owner, repository name and visibility. The review
covers the reachable commit history, including files deleted in later
versions and the original commit identities. Opening the review and
checking installation access perform reads only. A branch change or a new
save expires the review before it can submit.

`githubUploadSavedRoute` checks the active branch and head again, verifies
that the route came from an App Blank and reuses the first-upload intent.
Its persisted scope distinguishes a saved route from new-project creation.
The official template's default branch must match the confirmed route
before PNDS creates the repository. If GitHub returns a different default
branch after creation, the intent retains the original route and repository
ID for review. **Manage** offers ordinary binding for empty repositories or
repositories with shared history, as well as verification of existing
repositories generated from the official template.

Before creating the repository, PNDS also checks every parent of the confirmed
commit for tracked PNDS private project data, including data removed in later
versions. If found, the route stays local with its history intact. On success,
the pinned merge has the exact tree of the confirmed commit and keeps both
histories. Other routes, editor drafts and private creation resources stay on
the Mac. An interruption uses **Continue upload** and the existing
exact-version recovery. Local commits created after confirmation remain
available for separate backups.

## Automatic backup for one route (#346)

A repository binding starts in manual mode. Back up the checked-out branch
successfully once, or explicitly confirm that GitHub already contains the saved
version. Then open **Manage** and turn on **Automatic backup for this route**.
The switch applies to that local branch and its bound remote branch. A clone,
another branch and a replacement binding each require their own first backup
and opt-in. Drafts are never queued.

Only the active project and branch can retry their queued saved version.
Offline retries keep the queue. Losing authorization stops the retry until
the original account has access again, including when write access is lost at
the final check before sending. A route-specific retry failure applies only if
the original workspace, repository, branch, and queued commit still match.
Branches at the same commit keep their own retry state. An observed repository
visibility change pauses automatic backup for all its authorized routes, even
if visibility later changes back. Review the new visibility and enable the
route again to resume. Older project-wide settings are migrated as paused,
preserving any already queued versions.

## Manual verification

With a configured build and an installation on a test repository, connect in
the browser, verify the account avatar, bind the repository and back up a saved
version. Confirm the first public backup or branch recreation only on a repo
designated for testing. Enable automatic backup, disconnect the network, save a
version and reopen the same branch after reconnecting to verify the queue. Use a
second checkout to confirm clean fast-forward and the blocked states for staged
changes or diverged history. Clone a public project and an authorized private
project to new folders and verify both open in creation mode.
