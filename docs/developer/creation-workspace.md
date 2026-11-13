# Creation reading workspace

Issues #150 and #151 provide file reading plus the confirmed mode handoff;
#154 adds manual save, rename and disk-version conflict handling; #155 adds
external disk tracking, and #156 adds manual testing, monitor and console.
The visual baseline is the confirmed [r6-final desktop](../prototypes/desktop-1.6/README.md).
The shared bottom bar keeps its mode control mounted across both workspaces;
creation uses a compact file sidebar with manifest and the localized README
pinned. The compact 32px titlebar puts the project-switch button beside the
native traffic lights, followed by the independent Git menu. Preview visibility
and saved-file `.pnds` buttons remain on the right.
The packaging button is available only for a writable folder source and opens
the existing packaging dialog, retaining destination/overwrite and draft/test
warning behavior. Project switching uses an anchored DropdownMenu with recent
projects, Open folder and New project. Menu dismissal preserves the current
workspace; selection still uses the existing draft/discard and switch boundaries.
The trigger remains visible,
but disabled, when the editing surface hides for expanded Monitor mode.
See [the entry mapping and acceptance record](desktop-1.6-implementation.md).
Purpose names and the technical disclosure are presentation only; the File list
button restores the real inventory hierarchy. Grouping does not imply module provenance. #160 adds blank-project creation;
the file-list heading exposes the offline module workflow from #210.

The compact workspace keeps pinned manifest/README rows on one line, with their
actual paths available through accessible labels. File rows have no redundant
hover hints. File filtering
stays inline; the adjacent small Quick Open action and Command+P share the same
picker. Empty groups are omitted, including during filtering. The file-list
heading always retains New file, Modules and Libraries for writable workspaces,
so an empty tree cannot strand these actions. Nonempty groups retain their own
directory-aware New file action.

The workbench has no manual Checks menu, Doctor issue-count launcher or mounted
static/controlled report panel. `CreationDebugPanel` now contains only the preview
heading, expand and hide controls; `debugView`, `debugVisited` and `setDebugView`
have been removed from `creation-test-store`. Internal assistant checks, the CLI
and the shared check runner retain their services and authorization boundaries.
Preview visibility and expansion keep the same mounted monitor and URL; the
bottom transport and console remain independent.

Workspace navigation is defined once under [Reviewed workspace navigation](#reviewed-workspace-navigation-and-real-directory-tree-2026-10-19). Handoff Markdown uses the normal file tab; proposal recording and comparison services retain their separate ownership.

Known page, script and CSS paths show their localized purpose beside the real
basename. Unknown author files retain their names. Paths, editable capabilities,
draft identity and runtime invalidation still use native file facts. The embedded Blank server reads public files for
each GET/HEAD request, serves recognized MIME types with `Cache-Control: no-store`,
and rejects hidden or escaping canonical paths. Saving then manually refreshing
can therefore adopt a newly saved page/script/style without restarting Node.
Changes to the Node server itself still require a project restart.

Recent creation rows reveal their named remove-history button on row hover or
keyboard focus, reserving its space so the project name does not shift. The row
owns one shared hover/focus background for the name and remove button. `removeRecent` updates
only `recentCreationProjects` through the preference queue; it never deletes
files, releases the current identity, clears drafts or stops a run. Removing a
history item does not change the independent performance index. Opening a
project again can add it back normally.

The bottom transport and console controls remain visible on creation home and
expanded preview, disabled when unavailable. The console shortcut likewise
requires a workspace. Pane-only test controls retain their existing visibility.

## Private text creation materials (#241 / #248)

The file area exposes a persistent **Creation resources** group for the current
editable folder. **New text file** creates a stable document ID and an unsaved
main-editor draft. Inline naming and the first explicit Save publish a private
UTF-8 file. **Inbox** opens a multi-file picker, and the group accepts Finder
drops. Imported copies appear in the list and open when selected. Editing,
renaming, confirmed deletion and Finder reveal use the
dedicated typed native commands. The external source and already integrated
project files remain independent of those operations. Supported text formats,
private storage, exact-byte migration and limits are owned by
[pending-documents.md](./pending-documents.md).

`CreationAccess` owns saved list/import/read/save/rename/delete operations under
the native creation lock and the currently issued project identity. Bodies are
independent files in `.pnds-creation/pending-documents/<id>/<display name>`;
`pending-documents.json` schema 3 stores metadata and body fingerprints. Opaque
saved revisions protect renames and identical-byte saves from stale requests.
The collection permits 64 documents and 8 MiB of body text, with a 1 MiB per-body
limit. The schema-1 App-data and schema-2 JSON copies are migration inputs, not
current body storage. Migration retains original UTF-8 bytes, IDs, names,
versions and historical chat associations before publishing the new ready marker.
An authoritative empty collection never repopulates itself from old copies;
corruption, missing published metadata and unsafe paths raise explicit errors.

Aliases of one actual directory share its documents; independent physical copies
remain independent even with identical manifests. Moving or copying the complete
folder carries the private bodies, index and durable integration recovery. A
revoked identity or late reply cannot access a replacement project. The private
boundary stays excluded from the ordinary file tree, assistant file tools, Git,
performance bundles and runtime-check inputs. Project-version changes neither
reconstruct consumed sources nor clear private pending state.

`creation-pending-store` owns identity/document-keyed drafts and their main-editor
buffers. Save, Command-S and Save/Discard/Cancel on leaving follow the ordinary
creation lifecycle; failed publication retains the draft and prevents leaving.
The native catalog refreshes on focus and by polling. Clean buffers adopt saved
external edits and renames; dirty buffers keep their bytes and require an
exact-version decision before replacing newer saved content. Deleted documents
with dirty buffers remain reachable. Retry uses the group's refresh action or
the normal editor save operation; there is no separate materials dialog.

Compatibility source navigation still uses
`useCreationMaterialsStore.getState().open(identity, id, version)` as viewing
intent. `CreationMaterials` resolves that intent through the native catalog and
opens the same pending-document editor. Missing or changed requested versions
remain unavailable rather than reinterpreting an old chat excerpt as current
content. The independently labelled historical request snapshot stays readable.
Assistant reads retain their paginated UTF-16 contract; pagination is not a
separate viewer workflow. Adding, saving, importing, reading and Discussion make
no model request or execution grant on their own.

Adoption writes only the selected project destination and necessary task changes,
retaining all pending originals until explicit whole-task completion validates the
saved sources, targets, references and check evidence. Durable completion then
moves selected sources out together. Full-task and originals-only recovery are
separate from ordinary task-log retirement; newer edits block overwriting, and
interrupted recovery follows its durable progress after a full folder relocation.
The [integration owner](./pending-documents.md#explicit-integration-and-recovery)
defines these publication and retry boundaries.

`CreationPendingDocuments.test.tsx`, the pending store tests and
`PendingIntegrationRecovery.test.tsx` exercise editor entry, naming, drafts,
external conflicts, failure/retry and recovery actions. Native `materials_tests`
and assistant-task tests drive real temporary projects, independent body files,
exact versions, migration, capacities and durable full-task undo. These checks do
not replace native input, Finder, real-model or artwork acceptance.

## Blank project creation

The home and project menu open the same `CreationNewProject` form. Native
selection chooses an existing parent and a single folder name.
Blank is the public starting point. Opening an existing project preserves its source and identity.
The folder suggestion follows the lowercase work name with `-pnds` appended;
separators become hyphens. The first manual folder edit stops name-following
for that form. Unicode letters/numbers are supported; uppercase input becomes
lowercase. The actual target preview and typed command use the same value.
The work name itself is preserved. Empty names,
invalid characters and leading/trailing hyphens expose a localized inline reason
through `aria-describedby`; correcting the folder clears that error. The input
retains its 64-character maximum. The backend checks lowercase Unicode alphanumeric
characters and hyphens; the independent manifest/package ID retains an ASCII
stem plus random suffix.
The new-project work-name and folder-name inputs explicitly set
`autoCorrect="off"`, `autoCapitalize="none"` and `spellCheck={false}`. These
fields carry creator-chosen names rather than natural-language prose; system
input assistance must not substitute their spelling or case. This policy is
local to the two fields, leaving the shared Input and other editing surfaces
unchanged. Work-name case remains user-owned; folder normalization above still
applies. WebKit's macOS field-policy history is documented in
[151019](https://bugs.webkit.org/show_bug.cgi?id=151019) and
[220598](https://bugs.webkit.org/show_bug.cgi?id=220598). Existing creation
workflow tests remain the regression seam; jsdom and browser DOM inspection do
not simulate macOS correction, which requires user native retesting.

`lastCreationParent` is an optional App preference, mirrored in `creation-store`.
An owned, non-cancelled native selection updates the mirror and writes through
`updatePreferences`' serialized queue. Cancelling the form retains the selection
for the next form. Picker cancellation and replies from an old workspace/epoch
update neither mirror nor preference. `AppShell` restores the field on startup
only while no parent has been picked in this run, so a delayed preference load
cannot replace a new user choice. The form reads the mirror with a selector;
an already-open form without its own selection also receives startup restoration.
Save failures retain the existing preference queue's logging/no-rollback behavior.
Path validation checks absolute shape and rejects NUL without probing existence;
a removed or inaccessible remembered directory remains visible and the existing
creation command reports the failure for manual retry, with no automatic fallback.

Each creation generates a random 128-bit suffix for an independent manifest ID,
even when identical folder names are used under different parents. Cancelling the native picker or form preserves the
workspace and runtime. The existing serialized project-switch flow confirms
discard **before** calling `createBlankProject`;
a declined discard creates no directory. Filesystem creation completes before any old runtime is stopped.
Success adopts a prepared identity through the ordinary commit command, without
starting. A later switch failure reports the complete directory already created
so a retry never silently overwrites it.

Successful new-project adoption also registers its canonical path and declared
name at the front of performance Home through `project-store`, then shows Home
when returning to performance. Path, folder membership and learned name persist
together through the preference queue; no preflight, selection or start is
implied. Creation registration retains all existing entries even when Home is
already at its manual-addition cap, like loading an existing over-limit index.
Manual imports retain their existing cap. Cancellation and failed adoption do
not register a performance card.

`CreationAccess::create_blank` uses the staged generator and publication boundary.
The generator validates the target against backend bundle and
utility protection. It writes fixed assets and localized metadata into a private
sibling staging directory, using held directory descriptors and no-follow,
exclusive file creation. Parent/staging identities are checked before publication;
`renameatx_np(RENAME_EXCL)` publishes the whole directory without replacing even
an empty existing target. Failed staging is cleaned, and publication/opening
failures are reported separately. Generation prepares a new identity while
leaving the old active capability valid until the frontend commits the switch.

The generator embeds `resources/blank-project/` at compile time. Its ESM server
uses Express, Socket.IO and osc-min with the existing manifest/health/lifecycle contract;
both HTTP roots serve responsive static pages and tolerate bridge/cache query
parameters. The default is Internal, with External and None also declared.
Internal loads the shipped mono `pndsBlank`, creates its group before readiness,
and instantiates one zero-signal synth per injected private output bus. It waits
for `/done` and `/synced`, releases its own group on stop and never quits the
Host's scsynth. External sends no piece messages; None opens no audio socket.
Blank declares schema 2 with the exact shared production references Express
5.3.0, Socket.IO 4.8.4 and osc-min 2.1.2. The creation command supplies the shipped
resource root and validates all three before publication. Missing/corrupt resources preserve the active
workspace and leave no new folder. There is no install or version fallback.
Express owns the HTTP role routes while the restricted canonical-path resolver
continues serving only approved MIME types with no-store caching. The ESM server
uses createRequire with the injected absolute Express and Socket.IO entries;
the audio controller imports osc-min by file URL and converts its DataView
using the actual offset/length, preserving OSC acknowledgments and cleanup.
The original preview script snapshot routing stays on the same server.

standalone local npm resolution is used only without the Host environment.
Each HTTP port owns a Socket.IO instance and serves the bundled browser client
on its own origin. Connections receive project ID and server-owned port role;
realtime.get('performer') and realtime.get('monitor') expose the role instances for later
piece handlers. Both page scripts connect, and the default players policy supplies
persistent identities without seats; no artistic control or sound mapping is
preselected. Shutdown closes both Socket.IO instances,
including active upgraded connections, before releasing audio resources.

Blank source version **1.7.0** separates `public/monitor.html` and `monitor.js`,
`public/performer.html` and `performer.js`, plus initial shared `public/style.css`.
It copies the shipped `public/pnds-preview.mjs` adapter and an empty schema-1
`pnds.preview.json`; no artistic parameter or fader is preselected.
`monitor.js` owns an empty `previewParameters` callback map and activates the
adapter only with actual callbacks and a Host origin. The monitor HTTP response
captures its source and declaration bytes, embeds their digests, and serves that
source through `/monitor.js?pndsSnapshot=<id>`. The last eight source snapshots
are retained; unknown/evicted IDs return 404 rather than newer disk bytes. Script injection
preserves attributes and tolerates whitespace/quote changes; a Host preview
request without the actual monitor script tag fails rather than claiming loaded
source evidence.
The normal script URL preserves relative imports. The default evidence covers
`public/monitor.js`; parameter callbacks moved to other files require extending
their actual load evidence. Source/declaration edits need a monitor refresh
before new-version live preview; they do not restart the Node server.

Generated `docs/implementation.md` follows the creation-time language, documents
file responsibilities and refresh/restart boundaries, and provides a native-bound
parameter recipe. It owns confirmed creative decisions, parameter meanings and
units, documentation roles, and the saved/compiled/loaded/verified distinctions.
Server player-policy callbacks validate ownership and delegate to recording;
actual recorded work effects use the common performance application, snapshot,
restore and release callbacks, rather than live-only server hooks.
The recording section also requires needed input and actual chosen/random data,
work-owned versioning, detached legacy interpretation that preserves originals,
and checks using existing records. It explains the default input whitelist and
the distinction between work-data, container and adapter-protocol versions.
Generated AGENTS starts with the localized initialized-project/current-task hint,
then embeds `resources/creator-project-conventions.md`, which also supplies the
built-in project assistant's conventions. Installed platform-contract pointers
and the conditional external-handoff branch follow. Direct work follows the
current request; an explicit handoff assignment follows the shared entry point
for all current handoff tasks. Untouched generated Blank JS/MJS/CSS
and role-specific HTML are recognized as placeholders in assistant overviews;
modified JS, MJS or CSS become authored source. Opening an existing project never
rewrites its layout or provenance. See
[Blank layout acceptance](../acceptance/blank-1.7.0-layout.md).

The new-project form presents the Blank source, work name, folder name and location
before optional metadata. Author, description and the independent Git identity
live in a native disclosure with mounted fields, retaining both manual edits and
preference defaults. Invalid optional inputs synchronously open that disclosure
before native form validation focuses them. Collapsing it never changes the
creation payload or creates a second draft.

The initial README.md uses the creation-time App language and supplies a fallback
in either display language. Its introduction is only the creator's supplied text,
empty when omitted. Language variants and translation handoffs are explicit later
actions; Blank does not create a pending translation or creator-handoff.md.
AGENTS points to the local implementation guide and installed platform contracts.
The generated .gitignore carries private creation/seat data, dependencies and
transient-file exclusions to external Git tools; source and compiled runtime
assets remain versioned.

The committed silent SynthDef is real sclang output. Normal builds compare its
and the source's SHA-256 against `synthdef.sha256`, requiring no local sclang.
Release provisioning uses the mounted SuperCollider compiler to regenerate it
and compare bytes through `scripts/check-blank-synthdef.sh --check`. Updating the
source requires the script's explicit `--write`, followed by `--check`; runtime
creation only copies the checked bytes. Generated SCD uses `.add`, so the existing
App compiler can rebuild it after the creator changes the source.

Tests exercise UI cancellation/creation, temporary-directory publication and
no-clobber conflicts, and generated artifacts through the fixed bundled Node,
real HTTP and controlled OSC replies. The mode matrix starts and restarts each
mode, checks private-bus routing/absence of External messages and graceful process
and port cleanup. These are protocol evidence; native App/device acceptance
remains with the user-started development App.

## Confirmed mode handoff

The first bottom-button click prepares a target from the authoritative runtime. A running
project takes precedence over another selected card. Without a live runtime,
the selected folder is used without starting it. Backend-prepared workspace
identities leave the current identity valid until explicit commit; cancellation
releases only the preparation. Folder, bundle and utility origins still come
from backend protection, not frontend classification.

The performance card context menu's **Start creating** is an explicit-target
entry: `prepareModeSwitch(path)` prepares that card even when another project
is running, then commits directly to its creation workspace without another
bottom-button activation. No runtime is started. The same canonical folder keeps
its existing performance; a different live runtime first asks for explicit stop
confirmation. This confirmation runs in the settling phase, so a native dialog's
window blur cannot cancel its prepared identity. Declining releases only that
identity, without stopping the performance or closing projection. An accepted
confirmation rechecks the captured runtime generation before either effect.
The card path is captured before asynchronous focus and preparation; stale
selection or mode replies are rejected. Explicit targets must
be backend-classified editable folders. Bundle, utility and read-only origins
show the existing source error and release the prepared identity without stopping
the running performance. The parameterless bottom-button flow keeps its
running-project precedence, two-click confirmation and creation-home fallback.
Both entries share cancellation, generation checks and canonical-folder runtime
preservation.

The r6-final bottom-bar mode control uses the prototype's fixed 44px slant and 300ms fill/name
transition. A shared phase prevents duplicate submissions; startup/shutdown
also disable it. Esc, an outside pointer press and window blur cancel preparation
or confirmation. The performance overlay remains visible during confirmation.
After completion, hover is paused until pointer exit/re-entry; keyboard focus
is restored to the new control. Brutal keeps the same fill and name transitions;
only the system reduced-motion preference completes directly.
The focused mode control owns native Enter/Space activation even when a selected
project can Load; the global Enter session alias yields to `data-mode-switch`.
Confirmation exposes its target in the accessible name. Only actual unsaved-content loss adds a consequence note and `aria-describedby`. A failed keyboard submission restores focus
to the same control so the error can be reviewed and the switch retried.

Confirmation checks the runtime generation/status again before effects. An
editable live folder is adopted without stop/start, preserving the monitor's
component, iframe, navigation nonce and session generation. The existing
`MonitorView` stays at the same child position/key; only its grid placement and
chrome change. Ready/stopping creation frames retain the same grid placement.
The applied audio/LAN/External target and device come from runtime facts, rather
than the selected card's pending settings.

Bundle/tool/noneditable targets end the old runtime and enter the creation home.
Returning to performance ends testing and clears selection/temporary creation
state, with no auto-load. Both directions close only the projection through the
fixed-label `closeCreationProjection` backend command. It needs no broad frontend
window-destroy permission. `creation-lifecycle.ts` is the registration seam for
editors' unsaved confirmation and performer-window cleanup; a cancelled discard
happens before stop or window cleanup.
Projection opening captures the mode epoch and rechecks it after native queries.
Submitted native creation stays pending until its created/error event; a mode
commit waits for that outcome before closing projection. Duplicate opens while
creation is pending are ignored. The created callback suppresses its existence
announcement during committed handoff. Cancelling confirmation leaves the pending
window intact. A delayed open cannot leave a venue window after a mode handoff;
new projection opens are accepted only in idle-phase performance mode.

The mode transaction also acknowledges native performance-key ownership through
`setMainPerformanceKeyOwner(epoch, owns)`. Creation awaits revocation before its
`active=true` publication. Performance publishes `active=false` while retaining
`modePhase=settling`, then awaits restoration before ending the transaction. The
main-window-only command rejects old epochs, so late requests cannot reclaim
creation keys or disable a newer performance visit. No session/overlay business
state is mirrored into Rust. Cancelled and generation-rejected switches never
submit an ownership change. A failed entry acknowledgment leaves performance
published; a failed return acknowledgment reports `modeError` on the already
published performance side, preserving the ordering and authoritative stopped
runtime rather than reopening creation with uncertain native ownership.

Before committing, Rust checks the runtime generation under the lifecycle lock;
only the already-validated in-memory identity activation happens inside that
critical section. Filesystem work stays outside it. Frontend command adoption
captures `snapshotRevision`; newer authoritative `latestSnapshot` facts win over
a late response, including a runtime error or volume change. Session/UI resets
do not erase that fact record. Start/replace actions share the mode-phase gate.

## Opening and trusted scope

`commands/creation.rs` derives protected roots from the App bundle-install path
and every staging candidate in the embedded utility registry. The frontend
cannot supply a source flag. Canonical folder roots inside protected roots, or
containing them, retain their bundle/utility source, including symlink access.
An unwritable folder has a separate read-only reason. No editable copy is made.

File commands are asynchronous adapters using `spawn_blocking`; filesystem
latency must not block native input or an async runtime worker. The backend
access mutex is acquired within the blocking task and preserves identity
replacement ordering. Selector descriptions use independent temporary access.

`project/creation.rs` owns one active identity and one prepared identity, each
with an open root-directory handle. Only open, preparation and description accept
raw roots. Listing, reading and Finder calls
accept an issued identity and relative path. Every call rechecks the root inode,
device and source; replacing the directory invalidates the identity. Canonical
containment rejects external symlinks. Component-by-component `openat` with
`O_NOFOLLOW` prevents a symlink replacement between resolution and opening from
redirecting a read outside the held root. Directory enumeration uses
`fdopendir`, since macOS cannot enumerate a directory through `/dev/fd`.
Enumeration opens a fresh file description so walks do not share their cursor.

Creation opening checks manifest schema, the server entry and working directory,
then produces the bounded file list before replacing the active identity. It
does not require available ports, installed dependencies, compiled SynthDefs,
successful startup or sound. Runtime, compile and pack retain their existing
independent validation. A failed open leaves the previous identity usable.

## Bounded reading

File categories describe purpose without moving paths. `.git`, `node_modules`
and the reserved `.pnds-creation` directory are omitted. Private creation data
is accessible only through its history/material commands, including when an
ordinary file path uses a symlink alias. Listing is limited to 4,096 entries and depth 32; text to 1 MiB and
images to 4 MiB. Reads enforce limits both before and during I/O. Error codes
distinguish missing files, permission denial, invalid UTF-8, size limits, invalid
identity, escape, invalid project and I/O failures; UI translates the code and
retains diagnostic detail.

Images are requested only after selection, served as data URLs for PNG, JPEG,
WebP and GIF, and decoded by the browser. Decode failure leaves file information
and Finder access available. Audio and other binaries return metadata without
playing or decoding the asset. The file column has one project-folder Finder
button; the reader can also reveal the selected file.

A failed first read keeps the selected file and offers an explicit Retry next
to its error. Retry and the file menu's Reload action before a draft exists
start the same owned `creation-files-store.read` operation again; they never
save or run the project. The editor retires the previous attempt's local reply,
while the store's workspace epoch, path generation and watcher revision still
reject stale results. Existing clean drafts continue through the ordinary disk
reload path, and dirty drafts are not replaced by a retry.

## Manual save, rename and disk conflicts (#154)

Editable folder projects get lightweight text editing; bundle, utility and
read-only-folder sources keep the plain reader. Every opened text file keeps a
draft in `creation-files-store.ts` keyed by project-relative path, holding the
working text, the disk text it was read from and that read's `version`
fingerprint (content length plus hash, computed by the backend at read time).
Switching files — and later the console tab — never drops drafts; only a
successful workspace identity change clears them (the store subscribes to
`creation-store`'s workspace identity, so a failed or cancelled switch keeps
drafts, run and windows). Save writes only the current file through
`saveCreationFile`; drafts never enter the running version, and nothing saves,
refreshes or restarts automatically.

Saves are atomic and version-checked at write time, never through watcher
notifications. The backend resolves an admitted internal alias once, captures
that canonical target and its parent directory handle, and compares actual saved
bytes with the echoed `expectedVersion`. After writing and syncing the staged
file, it rechecks the project identity, the captured parent directory and the
actual target bytes before renaming into that directory. Rebinding the original
alias cannot redirect this save: it still addresses the captured canonical
target. A same-byte external replacement retains the same content version;
target inode equality is not required. `VersionConflict` keeps the draft and fetches the
newest disk content; the choice dialog offers reload (adopt the displayed disk
version) or explicit overwrite. An overwrite binds to exactly the version shown
in that dialog — which also previews the fetched disk content — so a disk that
changes again refuses the overwrite and re-opens the choice. A conflicted save
without an explicit overwrite (⌘S included) re-arms the choice instead of
writing. Conflicted files stay marked until resolved. Clean drafts can adopt an
external disk change through the toolbar reload button; dirty drafts never
re-read implicitly. Read-only sources,
non-text targets, missing files, oversize content, escape symlinks and unwritable
directories each surface their existing readable error codes.

Rename goes through `renameCreationFile` with a project-relative target path,
moves the draft with the file and refreshes the tree through the same trusted
identity. Existing targets are never replaced (`TargetExists`), references are
never rewritten, and the editor shows the external-agent adjustment hint after
a rename; `manifest.json` disables rename in the UI. The mode button's
two-click confirm stays the whole confirmation for mode switches (its hint
reports the real unsaved-file count); switching projects asks once through the
native `confirm` gate in `confirmDiscardCreationDrafts` before the switch
proceeds. Late save/rename/read results re-check the workspace identity before
touching store state, so an old project's return cannot modify the new one.
⌘S saves the active draft from any focus position in creation mode.

The file-action rename dialog ignores Enter while the native event is composing
or carries WebKit's legacy key code 229, matching the assistant's explicit-submit
boundary. A subsequent ordinary Enter submits the confirmed path.

The draft lifecycle participant's explicit save-for-quit action captures the
workspace identity and operation epoch, rejects pending creation, busy drafts or
disk conflicts, and saves dirty files sequentially through their normal version
checks. A partial failure keeps successful writes and all remaining drafts and
stops the sequence. Workspace replacement, new typing or newly added dirty
drafts prevent quit; this action does not record a Git version or handoff.

### Project text publication

`project/creation/text_publication.rs` owns the common staging seam for ordinary
saved text, assistant-created text, the active handoff document and its archive:
exclusive no-follow temporary creation in the held destination directory,
complete writing, the operation's permission and file-sync policy, final caller
validation, publication, and RAII temporary cleanup. Replacement uses rename;
creation uses no-clobber link publication. The module does not authorize an
edit, parse a manifest, choose an assistant path or commit a task journal.

For normal saving, `SavedTextTarget` binds the canonical parent and final name.
The final check rejects revoked project roots, replaced canonical parents,
changed or missing bytes, symlinks and nonregular targets. It reads the captured
directory entry without following a new symlink. The existing manifest schema
error still takes precedence over a stale-version error. Captured permissions
are retained, and replacing one hard-linked directory entry does not modify the
other entry's old inode. These checks do not provide an operating-system
compare-and-swap against arbitrary external editors in the final check/rename
interval.

Assistant task authorization, direct-path requirements, pending recovery
records and successful-operation records keep their existing order. Handoff
review, source fingerprints, archive-before-write and exact retry recognition
remain in their owners. Private task and baseline JSON use only the narrow
path-based staging wrapper; they do not acquire project publication authority.
Manual empty-file creation, compilation artifacts, bundle installation and
private-material storage retain their separate publication workflows.

Temporary cleanup runs on ordinary returns and Rust unwinding. A cleanup problem
after the destination was published cannot be reported as if the target were
unchanged. This does not add a general power-loss durability guarantee; directory
sync remains specific to the archive workflow that already requires it.

## Open saved SCD in SuperCollider (#240 / #247)

The existing SCD file-actions menu offers **Open saved file in SuperCollider**
for editable folder workspaces. The menu label and reader hint explicitly name
the saved version; opening never saves, copies or sends the App draft. The
existing dropdown owns keyboard activation and restores its trigger focus.
Pending and completed feedback belongs to that editor's identity/path; a file
or project switch retires its pending result. Failures retain the draft and
performance and offer a manual retry, including when only a recoverable draft
remains after the saved file disappears.

`openCreationScd(identity, path)` accepts an issued identity and relative path
only. Its native adapter permits the main workspace window, acquires the existing
creation-access mutex inside a blocking task and holds it through dispatch.
`CreationAccess::open_scd` rechecks the current root capability and editable
source, canonical containment, both requested/canonical `.scd` extensions and a
regular saved file opened through the held root's no-follow path. It rechecks
root identity and file inode/device immediately before dispatch. Missing,
non-SCD, non-regular, escaping links, obsolete identities and replaced project
roots cannot reach the system-open boundary. Each retry repeats these checks.

`supercollider_open.rs` resolves the fixed GUI bundle identifier
`net.sourceforge.supercollider` through `NSWorkspace`, then supplies exactly one
file URL to that app. Native completion reports either a confirmed running app
or a system error; discovery failure is `supercolliderMissing`, and unsuccessful
completion is `externalOpen`. No application name/path, shell, `sclang`, model
tool, evaluation text, launch arguments or audio environment is accepted from the
frontend. The native completion does not prove that a particular SuperCollider
editor displayed the expected bytes; actual GUI reception remains a manual check.

External saves use the unchanged polling and disk-conflict flow: clean drafts
adopt disk content; dirty drafts retain both texts and ask for a conflict choice.
They can mark pending compile/restart work but never run it or reload a monitor.
The full `CreationView` workflow tests the actual file action and command intent,
feedback/retry, editor preservation, late-result retirement, Chinese keyboard
activation and external-save adoption/conflicts. Native temporary-project tests
observe the same dispatch boundary without launching an installed app. See the
[acceptance record](../acceptance/240-supercollider-open.md); real GUI reception,
external saving and both release architectures are recorded by #172.

## Native file export

Pinned and ordinary saved-file rows start `dragCreationFile(identity, path)`
through HTML dragstart. Rust resolves the current issued identity and contained
regular saved file immediately before starting an AppKit `NSDraggingSession`.
The pasteboard carries a file URL and the system file icon. Only Copy is offered,
so Finder or another receiving app gets the saved file; drafts are not saved and
the project file cannot be moved by this export. Removed recoverable drafts do
not offer dragging. OS acceptance and the end of an actual gesture remain native
manual checks; contained-path and obsolete-identity refusals have native tests.

## Manual code and text file creation

Editable folder projects expose a labelled plus at each file-group heading.
It opens a focused inline filename row with its actual parent directory shown.
File groups remain virtual categories: a bare filename uses the suggested real
parent, while an input containing `/` is a path relative to the project root.
The inline hint shows the final destination, so `public/sketch.js` entered under
Pages does not become `public/public/sketch.js`. No group label becomes a folder.
Enter/check creates, Escape/cancel keeps current files, and IME composition
cannot submit. Errors preserve the name and return focus for correction.
The creator enters a filename in an existing parent directory, creates an
empty text file, then pastes code into the editor and saves normally. Unknown
binary extensions are refused. Cancellation and errors retain the current file
and drafts; success clears file search, expands the destination group and opens
the new file without starting, refreshing or restarting the project.

`createCreationFile` resolves the issued identity through `CreationAccess`, checks
editable source, text classification, bounded inventory/depth, and recoverable
draft destinations. It refuses traversal, control characters, `.git`,
`node_modules` and reserved save-temp names, including canonical aliases.
Existing draft paths use the same harmless leading-`./` semantics as reads when
checking destination collisions; parent escapes and external symlinks remain
rejected, and aliased recoverable drafts still block creation.
Creation opens the canonical parent through the held root-directory capability
and uses `openat(O_CREAT | O_EXCL | O_NOFOLLOW)`. Existing targets, including
symlinks and concurrent creations, are never overwritten. It creates no folders
and does not replace the version-checked normal save path.

The shared file module's `create` action owns duplicate dispatch and the workspace
epoch. It commits the returned file through the existing directory seam and
advances the local revision, so an older watcher list cannot undo creation.
Late results cannot select or populate files after workspace replacement, even
when reopening the same identity. A missing saved file's recoverable draft
blocks creation rather than being silently replaced.

## Manifest declaration form (#158)

`manifest.json` stays a normal draft-backed text file — the form
(`CreationManifestForm.tsx`) is a pure _view_ over that same draft text, so
dirty markers, ⌘S, the conflict flow, rename-disable and the lifecycle
discard count all keep one source of truth. There is deliberately no second
field-shaped store: every edit goes through
`src/lib/creation-manifest-form.ts`, which parses the current draft JSON,
mutates the one edited declaration and re-serializes (two-space indent plus
trailing newline). Unrecognized fields — `roles`, `scoreServer.routes`,
legacy `audio.scsynth.sampleRate`, `supportsPerformerUrl`, `needsHttps` —
and any unedited lenient declaration survive every round-trip untouched,
because serialization starts from the parsed object, never from a typed
literal. Editing through the form therefore reformats the file once; field
_values_ are what must be preserved, not the original byte layout.

The editor header offers a form/text toggle (form is the default; the find
bar is text-view only). When the draft is not a JSON _object_ — unparseable,
an array or a scalar — the form shows a fallback note and the text view is
where it gets fixed. Field semantics: contract-required strings stay
writable even blank (the save gate judges); blank optional strings
(`description`, `performerAddress`, `standaloneTarget`) remove the
declaration; numeric fields write only sign-free integers and remove the
declaration otherwise, so the save gate names the missing field instead of a
stale number silently surviving; `synthdefs` is one path per line, blank
lines dropped; clearing `telematic` returns the project to _undeclared_
(only an explicit `true` is ever written, per manifest.md); an empty
supported-modes selection writes `[]` so the rejection reads "no allowed
mode", not "missing field". Text inputs hold local string state while
focused and settle back to what the draft declares on blur — an invalid
number must not snap away mid-keystroke.

Save-time schema enforcement lives at the Rust `save` boundary
(`project/creation.rs`): a save whose (containment-checked) target is the
project-root `manifest.json` runs `parse_manifest` first and refuses with
`CreationErrorCode::ManifestInvalid` (field-specific English detail under the
localized headline) **before** the version-conflict check — a
confirm-and-overwrite can never land an invalid manifest. A `manifest.json`
in a subdirectory is an ordinary text file and is not validated.
Validation deliberately stops at `parse_manifest`: a declaration referencing
not-yet-compiled SynthDefs saves fine, because runnability and packability
stay separate gates — launch preflight and `validate_packable` still fail on
the missing artifacts. Sample rate and devices remain global App settings;
the form never touches them. Read-only sources keep the plain text reader
for `manifest.json`. Labels live under `creation.manifest.*` in both locales.

## README editing and creator handoff (#159)

Root README variants use the existing locale-variant → `README.md` fallback.
The language choice retains that requested locale while naming the actual file;
switching variants keeps their separate drafts. Covers reuse `ProjectCoverPage`
and its optional image. Ordinary documents render through `HelpMarkdown`, with
a text-edit toggle and intercepted links using the existing project README
policy. Unsafe cover candidates explain their duplicate fields, missing first
section or unclosed fence and stay in read-only preview.

Covers are edited directly on the finished composition. Hover/focus reveals an
edit target on title, all four top metadata fields (composer, duration,
performers, contact), first-section heading/body and the palette mark;
click opens a small anchored field editor. Palette details retain URL metadata.
Edits update the existing draft immediately; Done/Escape only close the field,
while explicit Save remains the disk-write boundary. No form/preview switch or
second preview exists. Empty title/heading and unfinished Markdown fences retain
the same cover instance and field editor; preview values come from the known
source-span document instead of reclassifying each keystroke.

A definite flex viewport owns the editor cover. `readme/cover-frame.ts` observes
that viewport and uniformly scales the complete 1200 × 800 artwork with 24px
safety gutters. App, creation preview and projection use this same composition;
there is no second 16:9 preview frame or theme-separated paper card. Inline
popovers live in a portal; prose auto-scroll pauses while a field is open. Plain
README documents retain their bounded reading measure and text-edit toggle.

`creation-readme.ts` edits source spans rather than serializing the presentation
parser's sanitized values. It preserves every unedited byte, including unknown
metadata, whitespace, line endings, fenced content and later sections. Inline
fields remain views over the existing file draft, save version and conflict flow.
The heading and title may be temporarily empty while being edited.

A successful README save offers an explicit language-sync handoff, tied to the
saved content fingerprint. A plain README has no intrinsic language tag; the
selected language supplies it, while a localized filename names its language.
No translation is performed. Manual task drafts and these offers live in
`creation-handoff-store.ts`; cancelling the task dialog retains them. They join
the creation lifecycle discard gate and clear only when the workspace identity
successfully changes. Existing handoff text remains editable through the usual
file editor, including external agent status and evidence.

`readCreationHandoff` reads `docs/creator-handoff.md` and its optional disk version;
absence has a distinct null version. `appendCreationHandoff` accepts a task with
a stable UUID, intent, project-relative affected files, acceptance and a
creator-supplied pending/in-progress/blocked status. Appending preserves the
existing document verbatim, including unknown task formats and agent states.
The command returns an already-recorded task unchanged on retry with the same
ID. It does not translate, modify code, install Skills or claim agent completion.

The commands use the existing issued identity, source protection, bounds and
blocking-task lock. Handoff directory/file access additionally uses `openat`
with `O_NOFOLLOW`: `docs` and the target must be real source entries, so task
records cannot land through an alias in runtime assets. A synced, permission-matched
temporary file is committed with `renameat`; first creation uses a no-clobber
`linkat`. Root and parent identity plus content versions are rechecked before
commit. Conflicts preview the latest document and require a new explicit append;
a further disk change refuses it again. An open dirty handoff draft must be
saved or resolved first. Root `docs` remains excluded by the existing packer.

`project/handoff.rs` owns task validation/rendering and the initial document.
The resource `creator-agent-entry.md` is the reusable AGENTS entry for the
new-project generator; `creator-handoff.md` supplies the initial text when a
handoff is first recorded. Module
adding uses the same task format and append boundary.

## External changes and running versions (#155)

Rename also sends the other opened draft paths to the backend. It resolves
the destination and those reservations under the same project capability,
refusing a canonical destination with a recoverable draft even when its disk
file has been deleted and the entered parent is a symlink alias. Checking only
the frontend's entered string would silently replace that draft.
If a destination draft arrives only after dispatch, the frontend retains it
and keeps the source draft reachable at its now-missing old path. Neither
draft's text or pending save is replaced by the command response.

The mounted workspace runs a serial, one-second polling watcher through
`pollCreationChanges(identity, since)`. The backend takes its baseline during
preparation, then scans through the same held-root capability, entry/depth
limits and exclusions as listing. Device/inode, size, nanosecond mtime and
ctime detect writes and atomic replacements without reading large assets.
Failed scans retain the last baseline; changed paths remain pending until the
frontend acknowledges their revision. Preparation cancellation keeps the active
watch baseline. No filesystem scan belongs inside the runtime lifecycle lock.

`creation-files-store.ts` owns disk revisions, per-file reader revisions and
pending refresh/restart/compile work. All polls share one in-flight request
per identity; a successful identity change resets pending state and errors. Clean
text drafts adopt new disk text. Dirty drafts retain their text and compare it
with the newest disk version; unreadable or deleted files retain a marked,
reachable draft. A batch that encounters an in-flight save is replayed after
that save settles. Reads, saves, conflict adoption and rename also carry a
per-file operation generation, so an older same-project result cannot undo a
newer operation or new keystrokes. Non-text and read-only previews re-read only
when the selected file's disk revision changes.

### Saved mutation synchronization

Assistant writes, task-bound parameter saves, task undo, Git restoration and
shared-library adoption use `creation-files-store.synchronizeSaved(identity)`
after their own native operation succeeds. This interface drains any scan
already dispatched before the save and requires a new scan afterward. The file
module adopts the actual directory and saved-file observations, retains dirty
drafts as conflicts and fences workspace replacement. Callers never publish
the cumulative task journal as a list of newly changed files. A no-op native
write therefore raises no file revision or runtime refresh/restart prompt.

`pollCreationChanges` also returns optional `changeRevisions`, the stable native
observation revision for each pending path. Frontend notification is separate
from batch acknowledgement: replaying an incomplete batch retries source reads
and directory adoption without raising those paths' revisions again. A new
path in a later batch does not republish older pending paths. Failed source
reads remain unacknowledged; a confirmed missing file keeps its recoverable
draft while the current directory drops the deleted entry. Older native replies
without per-path revisions conservatively use the batch revision.

Native mutation success and frontend synchronization success remain separate.
The assistant returns `status: saved` with `workspaceSync: pending` when needed,
and never repeats a completed write to repair synchronization. The workspace
retains the synchronization error for its normal watcher/retry. Git restoration
consumes its native preview once and offers a synchronization-only retry after
a successful restore; it reports completion only after synchronization succeeds.
The legacy task-undo command retains its draft guard while its recovery journal
exists. Explicitly finished tasks retire that journal; Git provides lasting file
recovery. Neither Git nor task undo is implemented in the file synchronization
module.

Page paths and HTML/CSS changes flag refresh; server/module source, manifest,
audio declarations and SynthDef artifacts flag restart. SuperCollider source
also flags compilation. These are action prompts over saved disk facts, never
claims that the runtime adopted the files. README/agent/docs edits do not flag
runtime work. Saving and polling never invoke navigation, start/stop, compilation
or health updates. The bottom-bar console control and its details retain these
pending states; Discussion and Git have no pending-work banner above their
content. A new compilation obligation can raise the single transient reminder
defined in [notifications](./notifications.md#pending-compilation-reminder),
without repeating it for subsequent saves or polls in the same pending cycle.

Manual actions capture an identity and revision after a fresh poll.
`creation-runtime-updates.ts` uses the existing monitor nonce/reveal gate and
acknowledges pages only when that navigation loads; a timed-out navigation
retains the prompt. Shared session start/restart acknowledges page/source
prompts only after its new run reaches ready and `getCreationRuntime` confirms
the same canonical root. A successful start command only spawns the supervisor;
it cannot acknowledge health readiness. Successful compilation acknowledges captured source
work and still flags restart for a live runtime. Later edits and another
identity cannot be acknowledged by an older action. Unsaved drafts never enter
any of these operations. Registered test pages use the refresh seam described
below; native performer windows register that seam as described below.

## Manual testing, monitor and console (#156)

`creation-test-store.ts` keeps saved manifest declarations and the creator's
next-test audio mode / App OSC target separately from authoritative session
facts. `getCreationManifest` reads the issued workspace's bounded manifest,
without requiring compiled artifacts. File revisions reload these declarations;
only saved supported modes appear. Initial adoption takes the real ready
snapshot's mode and OSC target, while later snapshots never replace the pending
choice. External targets use the existing per-project preferences queue, never
`standaloneTarget`. Device/rate settings remain global; the device warning reads
the creation manifest's channel requirement while this mode is active.

The bottom-bar restart button uses the neutral glass appearance after a ready
test with no pending saved page/source or test configuration changes. Saved
runtime changes light its color ring until the captured changes are acknowledged;
a successful ready restart dims it again, retaining any newer edits. Compilation
prompts alone do not keep the restart ring lit. Documentation and unsaved drafts
follow the saved-disk rules above. The dim button still allows manual restart;
initial loading and error retry retain the primary appearance.
Expansion keeps this action available under the same workspace, manifest,
network and submission guards. A manual restart retains the expanded layout
through stopping, the command-owned idle transition, starting and ready; its
placeholder offers the same restore action while the monitor is unavailable.
An unowned idle state, runtime error or workspace replacement restores the
ordinary workspace. File polling continues while the editor is hidden.

`startCreationTest` uses the same `dispatchStart` submit/consent/stop/start and
ready acknowledgement as performance. It first runs `preflightCreationProject`
over the trusted identity through the complete existing preflight (including
managed-child exclusions), then `startCreationProject` rechecks that identity
before invoking the same `SessionManager::start`. Its reply carries the backend
generation and snapshot; newer mirrored facts win over a late reply. Each manual
creation start changes the navigation nonce for a saved-page cold fetch, and
generation-aware readiness restores a run even if hidden-window startup events
were missed. No second session engine or
compiler is introduced. Validation failure leaves an existing runtime running;
startup failure remains retryable. `testValidation` and `testStartup` describe
these stages separately from the lightweight reading contract. Submission
holds the existing command gate. Closing a creation test keeps the workspace,
drafts, pending settings and prepared project selection; lifecycle participants
clean up test windows, while ordinary native window hiding does not end testing.

Refresh uses the existing monitor nonce and reveal gate. It also dispatches
`CreationPageRefresh` to every registered page participant; implementations
resolve after their current navigation loads, or reject with page-specific
detail. All participants are attempted even on failure. The captured page
prompt clears only after monitor and registered pages succeed in the same run;
failures, timeouts and newer edits retain it. #157 implements the real performer
windows through this seam. No unused client-list controls ship here.

The ready monitor keeps its existing child position, iframe and URL during
adoption and temporary expansion. Expansion changes the grid and hides/inerts
the mounted workspace; restoration reveals the same editor and drafts. The
title carries creation mode, performer-device controls and restore/expand;
it does not repeat a network address. Native
Escape restoration covers iframe focus only while the main creation monitor is
expanded, has focus and has no App dialog/submission. The web fallback has the
same plain-key guard. Menu focus and dialog subscriptions preserve other
windows' Escape behavior; late menu actions check identity and expansion revision.

The preview pane defaults to automatic visibility: idle/error workspaces keep it
closed, while starting, running and stopping tests show it. A titlebar toggle
can explicitly show or hide it, including before testing to reach audio-mode
and performer controls. That workspace-local choice survives ordinary runtime
snapshots and resets on project replacement; it is not persisted. Collapsing a
running pane retains its dimensions, mounted iframe and URL through an invisible,
inert positioned surface rather than `display: none`. Its focus-reclaim callback
stands down while collapsed. Layout toggles never start, stop or refresh a run;
expanded Monitor remains a separate layout with its existing restore action.

The docked console reads the existing bounded session output tail, retaining
`[node]` / `[scsynth]` source prefixes, with generation-fenced session snapshots.
Console polling is serial and cannot adopt a late old-run response. Runtime
errors remain available without opening or resizing the console; an explicit
error-details action can open it after checking ownership. Revisiting files
keeps editor state.
The recent tail remains available after stop, while copied runtime facts use
current ownership/status. Details contain no preference/token dump. No log is
created inside the project and no terminal is provided.

The bottom-bar control is the persistent entry for pending compilation, page
refresh and restart details. Opening the console from Git retains the selected
Git workspace and docks the console beneath it; it does not navigate to a file
or discard the mounted editor, open drafts or current difference selection.

Creation's bottom network popover is the sole phone-invitation surface in both
preview layouts. Its address, copy action and QR use the ready workspace's
actual performer URL, retaining HTTPS failures without an HTTP fallback. The
ready test is also available to native PNDS Clients on the LAN for README
preview and explicit entry. The ordinary browser landing at the stable
performance entry continues to wait for a Host performance. The performer
header and expanded device popover keep window/connection actions
without another QR button, and the monitor has no QR overlay. See
[network invitations](./network-invitations.md) for request ownership.

## Project file ownership

`creation-files-store.ts` is the shared project file module: reads, drafts,
conflicts, renames, disk revisions and watcher acknowledgements use the same
workspace epoch and per-file operation generation. These guards and the watcher
draft synchronizer are private implementation. Editors call `read(identity,
path)` and display its typed result; a stale read returns `null`. Editable text
is retained as a versioned draft inside the module, while read-only text, images
and binary metadata remain local previews. Reopening a draft uses its current
text without a disk read. A watcher change arriving during the first read causes
the module to reread before adopting the reply. Views only guard their own
mounted preview lifetime, not project ownership.

One workspace identity subscription clears drafts, selection, disk prompts and
operation ownership together. Cancelled or failed project switches leave the
identity unchanged and retain all of them. Saves retain typing made after
dispatch while updating the disk baseline to the submitted text.

Watcher and rename results commit `workspace.files` through one private path.
The captured workspace epoch, file operation and local revision determine
whether a returned list is still current. A stale watcher list cannot undo a
completed rename; its disk revision remains unacknowledged for replay. A late
rename list cannot erase files from a newer watcher result. Polls share one
in-flight request, and a reset revokes it even if the identity string is reused.
None of these file actions saves drafts or updates the runtime automatically.

Regression tests use the file module's `read`, `save`, `rename` and `poll`
interface with deferred typed-command replies to cover their actual ordering.
`src/test/creation-files.ts` provides only already-opened draft fixtures for
other workflows; draft seeding is not a production action.

## Frontend ownership

`creation-store.ts` owns mode, active workspace, opening errors and recent
creation paths. Modes and issued identities are transient. Folder history is
stored through the existing serialized preferences queue, independently of
performance selection. Recent paths are revalidated on every open; selector
descriptions use temporary backend access and do not revoke the active identity.
Runtime adoption retains the backend's canonical root paired with its raw
runtime path, so a preserved folder alias still identifies the same running
workspace. A stale snapshot for another runtime cannot supply that association.

Only one file-workspace open is accepted at a time. Mode preparation is blocked
until that open completes, including its backend identity commit. A queue and
request ownership preserve open ordering. Idle window blur or outside clicks do
not change the mode epoch. Native selection
captures the mode epoch, so a late picker cannot reopen a folder in a new visit.
The reading workspace is keyed by project identity and the reader by identity
plus path. Effect cleanup ignores both late content and late failures. Switching
clears file selection, search, find state and reading errors. List and Finder
responses check the current identity before updating UI.

⌘O and Finder folder drops use creation opening while this view is active.
Performance project navigation/rename shortcuts are inactive. The native picker
selects directories only. General new-file/import/delete and assistant controls
are absent. Manual editing, the creation console and the narrow five-module file
addition workflow are implemented at their documented entries.

Tests use the approved workflow/typed-command boundary in the frontend and the
public creation access boundary over Rust temporary directories. See
[testing.md](./testing.md) for mock conventions and
[app-behavior.md](./app-behavior.md) for acceptance scope.

## Viewport and sidebar bounds

The creation view stays within its parent viewport in both idle and running
states. The running frame uses an explicit `minmax(0, 1fr)` grid row; creation
root, inner flex row, reader and sidebar permit a zero minimum block size.
This prevents the file tree’s intrinsic height from expanding the running grid
and placing the mode footer below the App window. File trees and recent lists
scroll within their remaining space; a bottom error/status surface is capped
at a quarter of the view and scrolls independently. Keep the mode control out
of those scrollers. Do not infer physical layout from jsdom visibility tests;
small-window and long-list geometry need validation in the native Tauri window.

## Independent performer windows (#157)

`performer-window.ts` owns native windows; `creation-performers-store.ts` exposes
only their transient list and errors. Each create uses a unique UUID label and
an independent `incognito` webview. On macOS the installed wry implementation
uses a fresh nonpersistent WKWebsiteDataStore, isolating cookies/local storage
between clients while retaining each client's identity across same-shell
refresh/restart. See [Tauri v2 webview options](https://v2.tauri.app/reference/javascript/api/namespacewebview/).
No user agent, hardware-touch, sensor or mobile-browser capabilities are spoofed.
The explicitly labelled mouse-to-single-touch option is synthetic DOM input,
as described below; it never reports hardware capability or trusted touch. The
local `performer.html` entry boots only the thin shell; its cross-origin iframe
loads the actual applied performer address/port. Music traffic stays entirely
between that page, the project server and audio target. Unadapted projects work.

Phone (390 × 844) and tablet (820 × 1180) select real CSS viewport dimensions;
landscape swaps them. A ResizeObserver fits the frame visually into the native
window without changing the iframe's viewport. Changing device/orientation,
theme or locale retains that iframe and navigation. Theme/locale use the same
exact-origin postMessage bridges as monitor, on load, change, focus and heartbeat.
The shell waits for targeted configuration before its themed native reveal;
current page load and window focus put keyboard focus into the performer iframe.

The event protocol is centralized in `events.ts`; its performer subscriptions
return registration promises that constructors and shell-ready replay await.
Main-window listeners are installed before native creation. A shell-ready
handshake replays current config; config revisions reject out-of-order delivery.
Every page navigation captures workspace identity, frontend run and a monotonic
navigation number. Manual refresh uses the shared nonce, and awaits every current
shell's matching load result before acknowledging saved pages. Restart suspends
old pages, keeps the windows and isolated stores, and navigates to the new ready
runtime's actual address. Old load/timeout/config results cannot update a newer
run. Error publication also checks the client, workspace, run and config revision;
successful identity changes clear old errors. Delayed send/focus/close failures
from retired clients cannot pollute the next workspace. A DOM load event records only that navigation finished, including possible
browser error documents. Once navigation finishes, the list primarily displays
the health roster's Connected / Not joined result, or Connection unknown when
that evidence is unavailable. Loading, timeout and standby remain visible.
The focusable status tooltip retains the navigation fact and explains its
distinction from joining. Labels stay whole on one line, with the row allowed
to wrap the entire status in narrow panes and the expanded-monitor popover.
See the roster contract below; page loads never stand in for joined clients.

The registered creation participant cleans up after confirmed project close,
project switch or creation-mode exit. It waits for pending native creation,
then uses the typed `closeCreationPerformerWindows` command. Rust accepts only
UUID performer labels, checks the whole target list before destruction, and
attempts every target. `None` closes all test shells, including orphans after a
main-webview reload. Native red-close and Cmd+W requests hide the focused client, leaving the row,
page, isolated storage and connection alive. Explicit visibility requests
also mark the native device as manually controlled. The first automatic reveal
checks that intent on the UI thread immediately before showing, so a delayed
prepare/fit result cannot reopen a user-hidden device. Destruction removes the
transient native intent; it is never persisted. Visibility is a Rust-owned event
plus typed command; the numbered focus action also shows a hidden client. Only
the list X deletes a device. Its shell navigates the existing iframe to
`about:blank`, acknowledges that blank document with matching workspace/run/
navigation/revision, then the manager destroys only that native UUID. A bounded
1.5-second fallback still destroys an unresponsive shell; repeated deletes share
one task. Retiring clients ignore configuration/refresh that could reconnect them.
The App observes only the blank lifecycle, never the real score DOM or music
protocol. Inarticulate III releases its player assignment on actual socket
disconnect; the App does not force-clear project IDs with invented messages.
Native destruction events retire exactly one row. Cmd+W targets the focused client; fullscreen targets
its native window; monitor zoom does not alter its simulated viewport. Main
window hiding/blur and cancelled confirmations do not run cleanup. Actual exit
also destroys test shells in Rust. Window-state persistence excludes these
transient labels; their local capability exposes only event/focus and fitting geometry APIs, with no
remote-origin IPC access and no music relay.

Automated coverage uses native window substitutes through the App workflow and
shell interface, plus the Rust scoped close boundary. WKWebView verification of
independent client identities, phone/tablet orientations and actual keyboard /
pointer input remains a real macOS check; jsdom dimensions are not that evidence.

### Connected performers, pinning and expanded monitor

The optional `/__pnds/health.performers` schema is a read-only list of clients
accepted by the work's own join policy. `inspectCreationRuntime(identity, false)`
reads it from the native ready session's loopback performer port; the roster is
not a socket subscription and never joins an observer or player. One sequential
two-second polling owner serves every list surface. Workspace/run revision
changes fence late replies; a failed request clears stale rows. Unsupported or
invalid rosters mean unknown connection status, not zero devices. See
[runtime-contract.md](../zh-CN/reference/runtime-contract.md#optional-connected-performer-roster).

Virtual page URLs carry `pndsTestClient=<issued native UUID label>`. Supporting
projects pass that marker in their own join payload and echo it in a roster row;
the Host correlates it with the native list to avoid counting one test client
twice. Unmarked rows appear as external performers (which can be phones or other
browsers). This is diagnostic metadata, never identity, recovery or permission.
The Host never invents music join/control events or exposes claim tokens. Runes
has a small work-side adapter attached to its existing accepted join, controls
and release callbacks; observers remain absent. Other works require equivalent
explicit support and continue to run without it.

The local performer shell has a visible **Keep on top** toggle. A native scoped
command queries/sets `always_on_top` only for issued performer labels. A successful
setter returns its requested state; macOS queues the level update, so querying
immediately after setting could return the old level and make the button require
a second click. Initial shell queries still read native state. Performer webviews
accept the first click when inactive, so a click also reaches the control while
activating the window. Pin failures preserve the previous button state. Pinning
does not reload the iframe or persist a global preference. The expanded
creation monitor strip opens the same performer list in a compact popover, so
existing windows can be shown/focused/hidden or deleted without leaving the
monitor. The score iframe stays mounted. Physical phone and macOS window-level
acceptance remain real-device checks; isolated Socket.IO replay covers joins,
observer exclusion, disconnect removal and reconnect correlation.

## Performer JavaScript dialogs and simulated input

Inarticulate III deliberately draws black until its standard `prompt()` selects
a player. The macOS wry UI delegate omits JavaScript alert/confirm/prompt handlers,
so socket connection alone left that project connected but unselected. A Safari
comparison with the identical project rendered the score after choosing an ID.
`preparePerformerWindow` now awaits UI-thread setup before shell-ready / iframe
creation. It accepts only issued UUID performer labels. A per-instance subclass
of the existing native delegate supplies standard AppKit sheets, preserving
wry's other handlers; completion blocks are copied and completed with normal
prompt string/null and confirm true/false semantics. The page origin is displayed
without URL query tokens. Buttons follow the App locale. No page prompt function,
project source or music protocol is rewritten. A preparation failure reveals a
readable shell error. Native menu focus resolves a sheet's owning App window.

The user approved mouse-to-single-touch simulation after real testing. New test
clients enable it with a visible checkbox in their own shell;
turning it off restores original mouse/pointer input without navigation. Native
setup installs `performer-touch-script.js` once at document start in each project's
frames. Only a parent-window `pnds:test-touch` message enables it. Pointer
listeners queue a task after each dispatch, without cancelling or stopping the
original event. This includes handlers registered later on `window`. A page's
cancelled pointerdown owns its gesture, so no touch simulation or capture is
added; this preserves existing native pointer controls. Other
mouse down / move / up events add one untrusted DOM touch sequence in order;
native mouse defaults are not suppressed. Blur and disabling invalidate queued
input, cancellation releases the contact, and capture-loss callbacks retain
their contact identity so an old release cannot cancel a new gesture. Native text/form controls keep
their mouse behavior. This includes a TouchList-shaped payload for desktop WebKit
without Touch constructors, rather than pretending it has mobile APIs. Events
are delivered directly to the page: no OSC, score state or audio goes through
Rust/React. Real multitouch, pressure, sensors and mobile-browser APIs still need
a device. Run/navigation/revision checks also protect input-option messages.

Regression coverage waits for native preparation before ready, shows failures,
and exercises the exact embedded script through frame input/message boundaries.
On 2026-10-12 the user confirmed in the real App that Inarticulate III's ID prompt,
score display and mouse dragging all work. This verifies the reported failure;
it does not replace other real-device or multi-client identity acceptance checks.

## Creator monitor and performer surfaces

The workbench right pane shows the Monitor, performers and a bottom Audio section.
Audio groups the applied mode and runtime indicator with the spectrum and engine
statistics. The titlebar Monitor button expands or restores the layout from a
fixed position. The project menu contains **Generate .pnds**. Expanded Monitor
shows project and Git location as text, with the spectrum centered in the Monitor
strip and engine statistics at its trailing edge. The spectrum uses the strip
background directly. A thin divider separates the text-style performer control
from the Monitor label.

The spectrum taps the current ready Internal creation session before host master
volume. The bundled SuperCollider SynthDef runs an 8192-point Hann-window FFT.
It reads one channel for mono or the first two channels independently for stereo
and multichannel outputs, displaying the higher magnitude per bin. The graph
uses a logarithmic frequency scale, with fixed columns for dBFS, frequency and
pitch available by pointer or keyboard. A shared telemetry owner follows the
runtime generation across both layouts. CPU average, CPU peak and Synth count
come from the runtime status cache. Stale values clear, and External and None
sessions omit telemetry.

Manual start/restart, close, refresh and live gain remain in the shared bottom
bar. Handoff opens from its pinned document in the file list. Save and Compile
remain in the compact file toolbar, with Finder/reload/rename in its actions
menu. The console starts closed and is creation-only, toggled by the bottom
control or Command + backtick. Its dock preserves the selected workspace and
editor state, including while viewing Git. See [console ownership](#manual-testing-monitor-and-console-156).

The same monitor surface/viewport ancestry is used in both modes. The small preview renders the current main window’s full CSS viewport, uniformly
scaled into the right panel. Its aspect follows window resize instead of a fixed
4:3 card. Expansion uses the actual available monitor area (excluding its strip)
and changes layout and hides controls/list without reparenting the iframe or changing
its URL. Its load cover belongs to the monitor viewport, so it cannot cover test
controls. Client-number buttons show/focus their native window; the separate visibility
button hides/shows it, while X deletes only that device UUID. List device/orientation summaries follow shell
configuration; page navigation status remains distinct from unknown connection.

Independent performer shells place device/orientation segments in the top toolbar
and viewport size, fit percentage and the explicit mouse-to-single-touch option
in the bottom status bar; the main list contains no input checkbox. Initial
configuration and device/orientation changes fit the native window to the device
plus measured toolbar/footer/padding. `performer-window-size.ts` converts the
current monitor's work area and window chrome to logical pixels, uniformly caps
the device at 100%, remeasures wrapped controls, and keeps the outer window within
the work area. Fullscreen/maximized windows retain their chosen bounds; ordinary
manual resizing is not undone by theme, input, refresh or runtime-only changes.
Only current configurations may apply late geometry, and a failed fit reveals
usable content plus an error. A bounded layout wait also works while the initial
window is hidden. The fitted device wrapper scales a full-size inner
surface, rather than shrinking the iframe's CSS viewport. Its geometry stays
LTR even in RTL shells; the embedded page retains its own locale/layout. Shell
option requests carry the current workspace/run/navigation/revision and wait
for authoritative configuration before accepting another request. The main
window ignores stale requests and replays the authoritative configuration to the
same client. A request without a configuration reply releases its controls after
five seconds with retry feedback; late request failures cannot clear newer
requests. Device/orientation/input changes retain the
current document and client identity; only explicit runtime navigation reloads.

Workflow tests cover shell actions, list focus/close, stale options and unchanged
iframe identity. Actual visual fitting, theme painting and WKWebView input still
require native macOS acceptance. Automated geometry uses controlled DOM measurements
and native substitutes; those do not establish actual WKWebView painting.

On 2026-10-12 the user restarted the development App and confirmed all three
adjustments: performer windows tighten on opening/orientation changes, the main
list omits the mouse checkbox, and the monitor thumbnail follows the main window
aspect while expansion fills its available area. This is native acceptance for
these adjustments, rather than a claim about untested multi-monitor arrangements
or other device input capabilities.

## Performance sidebar control ownership

Plain up/down project selection belongs to the sidebar capture boundary. Hover
entry into the overlay hands document focus to the sidebar surface, preserving
existing focus inside it and open overlays. Inputs, sliders and comboboxes keep
their normal arrow keys; main/projection monitor input remains page-owned. The
retired Cmd-arrow project/folder handlers no longer run globally.

Bottom control popovers hold the performance sidebar while they are open.
Closing the final popover releases that hold if the pointer has left. The shared
bar itself stays available while the sidebar retracts, so a live-gain gesture
never loses its control. Sidebar-local drags, portals and rename focus retain
their own independent holds. Native controls follow sidebar visibility without
changing decorations or the monitor document.

On 2026-10-12 the user confirmed in the restarted development App that hiding
retains/restores the same performer, X deletion frees the Inarticulate III player
number for a new device, and settings selections keep Change available. Sidebar
plain arrows switch projects correctly; the user reported a blue outline on its
noninteractive focus receiver, so that surface now suppresses the browser's
outline while controls retain their normal focus rings.

## SynthDef compilation

Issue #161 moves compilation from Settings to the SCD toolbar. The toolbar and
the [pending-compilation reminder](./notifications.md#pending-compilation-reminder)
use the same compilation store and gates. The typed command accepts only the
active backend-issued creation identity. The source must be an
editable folder; protected bundle/tool roots and read-only folders are rejected.
All saved `supercollider/source/*.scd` files are compiled together with the existing
`.add`/`writeDefFile` wrapper. No compiler is shipped: standard SuperCollider app
installation wins, with PATH fallback and a 120-second ceiling.

`CreationAccess::prepare_synthdefs` captures bounded manifest/source bytes and
output versions. The command releases the creation access mutex while the compiler
runs, so reading, saving and switching workspaces remain responsive. A separate
process lease prevents overlapping commands. Output goes into private staging;
finish rechecks the capability, source set and versions before descriptor-relative,
no-follow atomic artifact writes. Output headers must name exactly the artifact
basename. Every manifest reference is checked through the held project root,
regardless of audio mode. Existing valid referenced files can satisfy references;
only this run's published files appear in `produced`. This header/name check is not
an audio or complete SynthDef graph validation.

Both output pipes are drained with bounded tails. The compiler has its own process
group; completion, failure and timeout terminate descendants before joining readers.
A missing compiler, failed process, empty output or name mismatch leaves references
unchecked. A completed compile can publish valid files while reporting other missing
or invalid declarations; it never reports overall verification in that case.

The frontend gates on all SCD and root manifest drafts (including saves, renames and
disk conflicts), then rechecks after its pre-dispatch watcher synchronization.
Compilation has an independent store and console section, so runtime log polling
cannot erase its report. Workspace identities and replacement generations fence late reports and tree updates;
the global process lease lasts until the old request settles. Successful completion
clears only the captured compile revision, preserving later source edits. Published
artifacts refresh the tree; a running session remains unchanged with restart pending.
If the post-compile tree poll fails, keep the completed report and show a file-list
synchronization warning; refreshing the tree must not repeat compilation.
No runtime start, stop, reload or monitor refresh is dispatched by compilation.

Tests use the confirmed SCD toolbar/console command seam and the trusted Rust
workflow with temporary projects and executable substitutes. Release validation
with installed sclang is deliberately ignored by CI:
`cargo test creation::compile_tests::compile_with_real_sclang -- --ignored`.
Run it from `src-tauri`, then perform the release's native device/audio acceptance.

## Workspace bundle generation (#162)

`CreationBundle` is offered for writable folder workspaces. It confirms unsaved
draft exclusion and, when there is no successful test record, recommends testing
while allowing the user to proceed. The test store records readiness for the
current workspace in memory; starting, failure and another project's runtime do
not count. Closing retains the record; changing workspace identity resets it.
This is advisory history, not proof that subsequently saved changes were tested.

The native save dialog starts with the existing sanitized manifest name and
version. Its cancellation dispatches no pack command. `getBundleOutputInfo` and
`packProjectBundle` extend the existing commands with `outputPath: string | null`;
`null` retains the Settings sibling destination. The chosen output is probed for
an explicit overwrite confirmation and revalidated by the packer. Each awaited
step checks workspace ownership, and a local operation lock prevents duplicate
requests. Late results cannot package or decorate a replacement workspace.

Rust uses the existing static manifest and dependency gates, plus every declared
SynthDef path regardless of audio mode. It never invokes launch preflight, npm,
network operations or compilation. The source is only read. Output containment
checks reject destinations inside the source tree, including symlink aliases;
root docs/test/tests directory links obey the same exclusions as directories.
Staged content is revalidated after exclusions and materialization. Unique sibling
temporary files are atomically published, with no-clobber publication unless
overwrite was explicitly approved; failed publication cleans up its temporary
file. SHA-256 is computed from this operation's completed archive before publication.

Tests drive the actual workbench and typed commands for draft exclusion, advisory
testing, save/overwrite cancellation, duplicate clicks and late selection. Rust
temporary-directory pack/install round trips cover output choice, source protection,
required files/dependencies/artifacts, containment, metadata and permission retention.
The existing bilingual reference-manual paths remain unchanged. Native macOS save
panels and theme rendering still require the user's normal App acceptance run.

## Offline module files (#210)

The resource catalog exposes the current modules for identity, monitor view,
theme, language, hub and optional device inputs. Native commands accept only a
backend-issued workspace identity and registered module IDs. Embedded snapshots,
source hashes and accepted versions are owned by `resources/modules/SOURCE.json`;
see [standard modules](./standard-modules.md) for publication and adoption.

The backend builds a complete flat staging directory through held no-follow
directory handles and publishes it with exclusive rename. Existing targets
without a matching source record conflict; recognized additions retain custom
source bytes and agent task updates. The dialog echoes the displayed provenance
and handoff versions; external changes require reloading and another explicit
action. Unsaved module/handoff drafts block adding.

After publication, the existing handoff writer appends one deterministic pending
task. A failure returns the actual published paths and an error, not complete
success. Retry uses the persisted record and stable task ID to append only the
missing handoff. It never recopies or upgrades existing files. Disk polling
refreshes the real tree and preserves the saved-versus-running distinction;
late replies cannot update another workspace. Root `docs/` remains excluded
from bundles, so the creator handoff stays in source.

## Read-only Git inspection (#201)

The project-title menu opens `CreationGit`. Its local snapshot names branch and
Git HEAD separately (including unborn and detached HEAD), then lists project-relative
staged, unstaged and untracked paths. Staged compares HEAD with the Git index;
unstaged compares the index with saved disk; untracked files have a bounded saved
text preview. Unsaved draft count and current runtime facts remain separate.
A clean Git result or a commit never implies that drafts are saved, pages are
refreshed, the server restarted or the current content tested.

`getCreationGitStatus` and `readCreationGitDiff` accept an issued creation identity;
the latter also accepts a literal relative path and one comparison layer.
`project/creation/git.rs` prepares a held-root job under the access lock, runs
outside that lock and checks identity/root/source again on completion. The native
reader resolves the held directory handle before opening its repository; it does
not launch a Git child process. Root replacement cannot authorize its old result.
Git's repository-root paths are stripped through its exact project prefix; status
has a project pathspec and diff disables rename pairing, so a project nested in a
larger repository never returns other projects' paths or cross-boundary rename
headers. Existing and untracked files use the ordinary containment check;
untracked previews refuse symbolic links and nonregular files.

The production reader now uses statically bundled libgit2, without a Git child
process or system developer tools. Text/diff and path limits remain explicit;
partial clones are refused before object reads, and no hook, filter, external
diff or transport runs. #228–#230 add separate confirmed recording and history
surfaces; see [local Git](./local-git.md) for the engine, write boundary, fixed
resource rules, index isolation and history-to-draft contract.

The file workflow revision makes a displayed result stale after disk changes,
including changes during an in-flight read. Returning focus from another tool or
keeping a snapshot open for 30 seconds also marks it stale, covering Git-only
changes that the file watcher cannot observe. Refresh clears the old comparison
and reads fresh Git facts; it never edits drafts or refreshes a running project.
Dialog/workspace/request ownership prevents old status or diff results from
replacing a newer request or another project's inspection. Close restores focus
to the project menu. Text stays in a keyboard-scrollable plain-text preview and
uses the existing theme tokens and translated labels.
Loading, errors and results share a reserved scrolling body inside a bounded
fixed-height shell, so delayed status or diff reads retain the dialog's position.

Tests use the public trusted project workflow with real temporary Git repositories,
including larger repositories, separate index/disk changes, missing/unborn/detached
Git, deleted/binary/invalid text, literal filenames and helper-execution markers.
The partial-clone fixture deliberately omits blobs and compares the entire
repository file inventory and bytes before/after status and diff, covering the
object store, config, index and working files plus a transport-helper marker.
The process-free reader keeps the bounded text and path regression cases. UI workflow tests
exercise the project-menu entry, stale/refresh and late-result behavior, and retain
drafts plus a running session. Native visual/focus and user-started App validation
remain separate acceptance evidence.

## Static Doctor (#203)

There is no manual Doctor launcher or mounted report in the workbench. Assistant tools and CLI share the static service; [static-diagnostics.md](./static-diagnostics.md) owns report shape, freshness, scope and test seams. Workspace tests verify absence of old check controls and preservation of the mounted monitor. Retained standalone components are isolated test consumers only.

## Reviewed changes and guarded undo (#207)

The existing-file text editor adds captured draft review and one in-memory saved
change with guarded undo. See [single-file-changes.md](./single-file-changes.md)
for command, ownership, cancellation and content-version boundaries.

## Session text editor (#224)

Readable text now uses CodeMirror 6: virtualized line numbers, syntax colors for
JS/TS/JSON/HTML/CSS/Markdown/SCD, bracket matching, two-space indentation, literal
case-insensitive find/replace and line navigation. Other already-readable text
uses plain text. This adds no language server, diagnostics or compiler claim.
SCD coloring uses a local stream parser for strings, symbols, nested comments,
keywords and class names. Dedicated syntax tokens in the four theme palettes
separate code categories from the more muted UI file/status colors. Function
names and properties (including JSON keys, HTML attributes and CSS properties)
use their own ink. See [UI patterns](./ui-patterns.md#component-roles) for palette
and contrast checks.
Long lines scroll horizontally; the editor owns its scroller, and toolbar rows
wrap within the existing workspace. No monitor/dock ancestry or runtime action
changes when a text surface mounts.

File paths and save/compile/file actions share one header row; file type and size
live in the file-actions menu. The text editor keeps compact undo/redo/find and
selection-discussion controls, with line navigation, indentation and keyboard
guidance in More editing tools. Those menu actions restore the editor selection
and focus after menu dismissal. The editor's one status bar combines save/conflict
state with cursor position and language/encoding; non-editor previews keep the
outer save status. Saved changes default to a collapsed review with guarded undo
still directly available; each new saved record starts collapsed again.

`TextBuffer` owns document, selection, history, search and scroll independently
of React mounting. `CreationDraft.editor` retains that object for the workspace
session, including file, form/preview and layout switches. Rename moves the same
draft and history and reconfigures its language. Draft forms synchronize as
ordinary edits once a text buffer exists. `editorRevision` advances only when
adopting a different disk version (watcher clean adoption, explicit conflict
reload or saved-write undo); that resets both undo directions with visible
feedback. Saving the current draft retains its editing history. A conflicted
external version stays outside the buffer until explicitly adopted. No undo
stack is persisted across workspace closure or App restart.

`TextEditor` is the reusable view. Its caller supplies a distinct `TextBuffer`,
current value and optional change callback; it has no persistence action.
`text`, `selection`, `selectedText`, `select`, `replaceSelection`, `undo`, `redo`,
`goToLine` and subscriptions are the local-text/selection integration seam for
#208. Offsets use CodeMirror's UTF-16 document positions with one character per
line break. File drafts and suggestion buffers must have different buffer
objects even when their source path/text match. Only the file wrapper marks
`data-file-draft`; the global save shortcut ignores standalone suggestion
surfaces and App overlays. Draft undo and **Undo saved change** remain separate.
Normal CRLF files retain their line endings, and opening text alone does not
normalize the draft or dirty the file.

`openCreationFileAtLine(identity, path, line)` is the #166/diagnostics integration
seam. It checks the current identity, exact listed text path and positive integer
line before selecting. The text surface validates the actual line count and
announces out-of-range requests. The existing manifest and safe README editors
remain available; locating manifest or ordinary Markdown switches to text.
Structured README covers retain their existing safe field boundary; explicit
line requests inspect their source read-only. Each retained location request
is consumed once, so remounts and language changes do not move a later selection.

Quick open (`⌘P` in the host creation workspace) searches only the backend's
bounded inventory, renders at most 100 matches and uses arrows/Enter. It never
accepts an arbitrary filesystem path or lists recoverable removed drafts as
current files. Reading still calls `readCreationFile` with the issued identity;
size, UTF-8, permissions, protected sources and path containment remain Rust
checks. The normal error panel explains refused reads and binaries.

The editor owns `⌘F`, `⌘G`, undo/redo and indentation only while focused. Escape
then Tab leaves the indentation keymap for accessible keyboard navigation.
Quick open is blocked by modal overlays, mode transitions, opening and expanded
monitor. No new native menu accelerator or guest-page key ownership is added.

`TextEditor.test.tsx`, `CreationEditorWorkflow.test.tsx` and the existing creation
save/README/compile suites use the real editor with controlled typed-command
replies. `src/test/text-editor.ts` drives CodeMirror's public transaction API;
jsdom Range stubs represent absent layout, never native geometry or IME proof.
Rust's existing temporary-directory creation tests cover actual versioned writes,
invalid manifest/README content, size/UTF-8 limits, protected sources and escapes.
Native IME, clipboard, menu delivery, narrow layout and running monitor evidence
remain in [#224 acceptance](../acceptance/224-basic-editor.md). #166/#208/#172
must record actual downstream integration separately from this verified seam.

## Reviewed workspace navigation and real directory tree (2026-10-19)

The middle workspace has fixed Discussion / Git versions controls and one
closable current-file tab. The dedicated Handoff control is removed. Opening
`docs/creator-handoff.md` from the file list uses the ordinary file tab and safe
Markdown preview/source editing with version-checked Save and `⌘S`. Existing
explicit handoff-document links normalize their old reading-view request into
that same file view. Closing it returns to Discussion and retains every draft.
Page navigation never stops runtime or resumes an assistant task. Git remains
mounted while hidden; file drafts stay in the shared file store.

The handoff document is not created by visiting. If an explicit document link
opens an absent document, the existing explicit create action remains available.
The old manual-task/baseline dropdown is not restored; baseline records and
confirmed proposal workflows remain independent.

`CreationFileTree` pins the actual root `manifest.json`, all root README variants
(default first, even when no default exists), then `docs/creator-handoff.md`.
Each appears once, with a quiet purpose label, separator and smaller monospace
basename: Project settings / Piece introduction / Handoff. This is presentation only;
no path is moved or renamed. Full relative paths remain in title, selection,
keyboard actions, drag/export, creation and conflict handling. Other docs and
nested READMEs keep their directory positions. Git comparison files use the same
pin order and labels while retaining comparison-only selection. Real empty
directories from the trusted inventory remain visible.
File rows display basenames and expose full paths. New file/folder uses the
focused directory. F2 and context-menu rename share `creation-files-store.rename`
and its draft/conflict protections; the inline field selects the filename stem.
References are not rewritten. The existing manifest rename restriction remains.
Quick open stays available with `⌘P`; rescan and Finder move to the file-list menu,
while the ordinary one-second poll continues. Add resources opens one picker with
local-module/shared-package categories and each category's existing native policy.

`CreationWorkspace.directories` and `CreationChanges.directories` are optional for
older fixtures/readers but issued by the native inventory. Directory-only changes
update the tree without attributing a file write to the assistant task. Native
`create_creation_directory` uses the issued project identity, held parent fd,
containment/private-path/depth/count checks and exclusive `mkdirat`; no overwrite,
recursive arbitrary directory creation or symlink escape is allowed. Reopening a
project reconstructs empty directories from disk. Directory creation does not
select an editor or alter another draft. Tests use temporary projects, never the
creator's live workspace.

2026-10-19 UI refinement: runtime/command errors no longer expand the console
automatically. Shell project, watcher, file-export/Finder and test failures use
`CreationErrorToast` (4 seconds, Sonner fade transitions) without changing layout.
The stored error, retry action and manually opened console remain available;
repeated watcher results with the same code/detail do not re-notify. The details
action checks project identity before opening a console. Form validation and
version-conflict recovery remain beside their controls. Saved-page refresh moves
from transport/change prompts to Window → Refresh Score Pages (`⌘⇧R`).

## Purpose view and real file list (2026-10-22)

The file sidebar starts in Purpose view. Known paths carry localized purpose
names while retaining their actual filenames; monitor/performer HTML is named
Conductor interface / Performer interface, and their scripts retain a logic
qualifier. Tree search, Quick Open and Git comparison search accept English or
Chinese purpose names as well as actual paths. Custom files receive no guessed
roles. Selection, editing, drag/export, rename and conflict handling keep native
project-relative paths.

A visible File list / Purpose view button changes only the sidebar presentation.
File list uses the complete issued inventory in its real hierarchy, plain
filenames and no pinned nested handoff. It does not expand the native inventory
into .git, node_modules or private creation data. The same file editor stays
mounted and all drafts, selected files and running state survive switching.
The view choice and disclosure state are local to the keyed workspace, without
writing preferences or project files.

Purpose view folds an explicit set of support/configuration files and compiled
SynthDefs under Technical files. Other author documents, source files and real
empty folders remain available. Search reveals matches through collapsed
sections; a newly selected technical file is revealed. The disclosure retains
unsaved/conflict indicators even when closed. It is not a real directory and
cannot be used as a rename, export or creation path. New-file context resolves
the actual focused/selected directory even if its file is currently folded.

Dependencies opens an on-demand summary of saved manifest.sharedLibraries and
package.json runtime, optional and development declarations. Exact shared/package
matches appear once; mismatched declarations retain both versions and identify
the project-provided requirement. This is declaration evidence, not installation,
wiring, health or connectivity evidence. No transitive package files are read.
Native read failures and invalid JSON remain explicit with Retry. Result keys
include workspace identity, saved-file revisions and file presence; effects
reject old/closed requests and refresh an open summary after a saved-file change.
The summary does not touch editor drafts. Add shared package delegates to the
existing catalog/adoption dialog, including its existing writable-source and
manifest-draft checks, and returns focus to the dependency entry on close.

Component regressions cover real editor preservation across view switching,
Chinese/path searches, technical disclosure keyboard actions and state markers,
saved-only dependency reads, revision refresh, retry and cross-workspace late
replies. Native geometry and actual App interaction remain device acceptance.

## Pending document editor (#260)

The **Creation resources** group for editable folder projects has two toolbar
icons. **New text file** creates a stable document ID and an in-memory draft.
Inline naming and the main CodeMirror editor share `creation-pending-store`.
The first explicit Save publishes a private independent UTF-8 file. **Inbox**
offers a multi-file picker and shows a drop hint. The picker and Finder drops
use the same native text import command. The resulting copies appear in the
group and open when selected. Existing material source links enter the same
editor. Historical chat excerpts retain their own saved text, name and version.

Pending drafts are keyed by issued project identity and document ID, separately
from ordinary project paths. They retain their `TextBuffer` across navigation,
use the normal Save / Command-S controls, and register a creation lifecycle
participant. Leaving with pending edits offers Save, Discard and Cancel; failed
or conflicting saves prevent leaving. Saving a project version first saves
pending drafts, although private pending data is excluded from Git. Switching
project versions keeps private pending data and cannot restore an integrated
source. **Last integration recovery** is available from the title bar's project
menu.

The group polls the native saved catalog and refreshes on focus. A clean open
buffer adopts external changes; a dirty buffer retains its text and shows the
current saved content before exact-version reload or replacement. An externally
deleted dirty buffer remains reachable. CRUD results, catalog reads and editor
callbacks reject another workspace's identity; pending source integration asks
to save dirty content, then requires the assistant to read the new saved version.
Native storage and durable whole-task recovery are specified in
[pending-documents.md](./pending-documents.md).

`CreationPendingDocuments.test.tsx` drives the actual editor, keyboard save,
navigation, external conflicts, version-save blocking, leave choice, rename,
Finder command and confirmed deletion. `CreationMaterials.test.tsx` covers the
empty group, migration errors, inbox import and cancellation, localized naming
and late project replies. These tests use the typed command boundary. Actual IME,
clipboard, Finder external editing and layout remain native acceptance.
