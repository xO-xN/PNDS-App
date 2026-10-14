# Creation reading workspace

Issues #150 and #151 provide file reading plus the confirmed mode handoff;
#154 adds manual save, rename and disk-version conflict handling; #155 adds
external disk tracking, and #156 adds manual testing, monitor and console.
The visual baseline is the confirmed [r6-final desktop](../prototypes/desktop-1.6/README.md).
The shared bottom bar keeps its mode control mounted across both workspaces;
creation uses a compact file sidebar with manifest and the localized README
pinned. The compact 32px titlebar puts the existing project menu beside the
native traffic lights and a saved-file `.pnds` packaging button on the right.
The packaging button is available only for a writable folder source and opens
the existing packaging dialog, retaining destination/overwrite and draft/test
warning behavior. The same menu and
picker retain draft/discard and project-switch boundaries. It remains visible,
but disabled, when the editing surface hides for expanded Monitor mode.
See [the entry mapping and acceptance record](desktop-1.6-implementation.md).
File grouping describes actual paths, not module provenance. #160 adds blank-project creation; the Modules heading adds the offline file workflow from #210.

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

## Template-project creation (#160, #200)

The home and project picker open the same `CreationNewProject` form. Native
selection chooses an existing parent and a single kebab-case folder name.
Blank is selected initially; PNDS Classic is the fixed second starting point.
The folder input normalizes ASCII uppercase letters to lowercase as the user
edits it; the actual target preview and typed command use that same value.
Work names are never transformed or used to derive a folder slug. Empty names,
invalid characters and leading/trailing hyphens expose a localized inline reason
through `aria-describedby`; correcting the folder clears that error. The input
retains its 64-character maximum and the backend's lowercase ASCII contract.

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
discard **before** calling `createBlankProject` or `createClassicProject`;
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

`CreationAccess::create_blank` and `create_classic` share the same generator
and publication boundary. It validates the target against backend bundle and
utility protection. It writes fixed assets and localized metadata into a private
sibling staging directory, using held directory descriptors and no-follow,
exclusive file creation. Parent/staging identities are checked before publication;
`renameatx_np(RENAME_EXCL)` publishes the whole directory without replacing even
an empty existing target. Failed staging is cleaned, and publication/opening
failures are reported separately. Generation prepares a new identity while
leaving the old active capability valid until the frontend commits the switch.

The generator embeds `resources/blank-project/` at compile time. Its ESM server
uses only Node built-ins and the existing manifest/health/lifecycle contract;
both HTTP roots serve responsive static pages and tolerate bridge/cache query
parameters. The default is Internal, with External and None also declared.
Internal loads the shipped mono `pndsBlank`, creates its group before readiness,
and instantiates one zero-signal synth per injected private output bus. It waits
for `/done` and `/synced`, releases its own group on stop and never quits the
Host's scsynth. External sends no piece messages; None opens no audio socket.
No production dependencies, performer business protocol or sound assets ship.

The initial README is in the creation-time App language (`README.md` for English,
`README.zh-CN.md` for Chinese). A pending other-language task reuses
`project/handoff.rs`; AGENTS points at that handoff and the installed platform
contracts. No translation model or Skills installation runs.

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

## Fixed Classic source and initialization (#200)

Classic embeds the verified PNDS Template 0.7.0 candidate source under
`src-tauri/resources/classic-project/`. It is a clean included-file snapshot,
not a live checkout or a claim of a published Template release. The provenance
record pins all 95 files, the source inventory and the previously accepted
runtime bundle. Normal Cargo builds verify every source hash and the inventory
pin. No network, runtime npm installer or alternative source lookup exists.

The full two-fader reference remains: networking, seats/reconnect, monitor
state, theme/language following, 16-channel sine example, source SynthDef,
compiled artifact, module examples and regression tests. Its exact shared
requirements are Express 5.3.0, Socket.IO 4.8.4, osc-min 2.1.2, qrcode 1.5.4
and p5 2.3.4. Before publication, the existing bundle gate checks those actual
App resources and bytes. Missing or corrupted resources abort staging with the
required versions in the error; no substitute version is used.

Generation initializes manifest/package/lock identity and version 0.1.0, creator,
description, page title and both READMEs. The client token key derives from the
new manifest ID. AGENTS, start and implementation docs state that initialization
already happened; the agent entry retains ADR-0003's installed-contract pointers.
`docs/template-source.json` records the starting template separately from module
addition records. Blank records its original v1.6.0 starting source too.
Generated AGENTS and implementation publication instructions point at the App's
saved-file `.pnds` workflow and exact shared references. The frozen upstream
release-workflow and preinstalled-dependency claims are replaced only during
generation; provenance and frozen source bytes remain unchanged.
The included tree excludes Git history, local dependencies, seat caches, logs and
device records; Classic does not adopt the upstream cover as the new project's
cover. Ordinary opening preserves the existing identity, client key and Git
history. Updating the App's template never rewrites already-created projects.

The actual creation commands, temporary directories and bundle install workflows
are the test seams. A controlled Node/HTTP/Socket.IO/OSC test starts two new
Classic projects and one installed copy in None, External and Internal, reuses
the same origin, verifies independent client storage and reconnect identity,
and checks graceful shutdown. Fake OSC replies prove the protocol boundary,
not real scsynth output, devices or sound. The frozen Template's own
`npm run check` and `npm test` also run on a temporary copy; no check mutates its
source repository. Native App and phone/audio acceptance remain user-owned.

## Confirmed mode handoff

The first click prepares a target from the authoritative runtime. A running
project takes precedence over another selected card. Without a live runtime,
the selected folder is used without starting it. Backend-prepared workspace
identities leave the current identity valid until explicit commit; cancellation
releases only the preparation. Folder, bundle and utility origins still come
from backend protection, not frontend classification.

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

File categories describe purpose without moving paths. `.git` and `node_modules`
are omitted. Listing is limited to 4,096 entries and depth 32; text to 1 MiB and
images to 4 MiB. Reads enforce limits both before and during I/O. Error codes
distinguish missing files, permission denial, invalid UTF-8, size limits, invalid
identity, escape, invalid project and I/O failures; UI translates the code and
retains diagnostic detail.

Images are requested only after selection, served as data URLs for PNG, JPEG,
WebP and GIF, and decoded by the browser. Decode failure leaves file information
and Finder access available. Audio and other binaries return metadata without
playing or decoding the asset. The file column has one project-folder Finder
button; the reader can also reveal the selected file.

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
notifications: the backend re-reads the containment-checked target, compares
the content fingerprint with the `expectedVersion` the frontend echoed, then
writes a fresh temp file in the target directory (permission-matched, synced)
and renames it into place. `VersionConflict` keeps the draft and fetches the
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

`creation-readme.ts` edits source spans rather than serializing the presentation
parser's sanitized values. It preserves every unedited byte, including unknown
metadata, whitespace, line endings, fenced content and later sections. Form
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
new-project generator; `creator-handoff.md` is its initial handoff text. Module
adding can use the same task format and append boundary. PNDS Template's source
AGENTS entry points to its handoff and installed-contract lookup rules.

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
pending refresh/restart/compile prompts. All polls share one in-flight request
per identity; a successful identity change resets prompts and errors. Clean
text drafts adopt new disk text. Dirty drafts retain their text and compare it
with the newest disk version; unreadable or deleted files retain a marked,
reachable draft. A batch that encounters an in-flight save is replayed after
that save settles. Reads, saves, conflict adoption and rename also carry a
per-file operation generation, so an older same-project result cannot undo a
newer operation or new keystrokes. Non-text and read-only previews re-read only
when the selected file's disk revision changes.

Page paths and HTML/CSS changes flag refresh; server/module source, manifest,
audio declarations and SynthDef artifacts flag restart. SuperCollider source
also flags compilation. These are action prompts over saved disk facts, never
claims that the runtime adopted the files. README/agent/docs edits do not flag
runtime work. Saving and polling never invoke navigation, start/stop, compilation
or health updates.

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
title carries creation mode, the real monitor origin and restore/expand. Native
Escape restoration covers iframe focus only while the main creation monitor is
expanded, has focus and has no App dialog/submission. The web fallback has the
same plain-key guard. Menu focus and dialog subscriptions preserve other
windows' Escape behavior; late menu actions check identity and expansion revision.

The second tab reads the existing bounded session output tail, now retaining
`[node]` / `[scsynth]` source prefixes, with generation-fenced session snapshots.
Console polling is serial and cannot adopt a late old-run response. A new
runtime error locates the console once; revisiting files keeps editor state.
The recent tail remains available after stop, while copied runtime facts use
current ownership/status. Details contain no preference/token dump. No log is
created inside the project and no terminal is provided.

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
browser error documents: connection is explicitly unknown because the platform
has no public performer connection-status contract. No fake connection success
or optional music-protocol adaptation is introduced.

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
frames. Only a parent-window `pnds:test-touch` message enables it. Mouse down /
move / up produce one untrusted DOM touch sequence; pointer capture, blur,
cancellation and disabling release the contact. Native text/form controls keep
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

The creation preview follows r6-final: the right pane retains the applied
runtime badge, saved audio-mode choices, real monitor with expand action and
independent performer list. Manual start/restart, close, refresh and live gain
move to the shared bottom bar. Packaging opens from the titlebar right button; handoff lives in the project menu;
Save and Compile remain in the compact file toolbar, with Finder/reload/rename
in its actions menu. The console starts closed and is creation-only, toggled by
the bottom control or Command + backtick. Opening it docks the console below the same mounted editor and does not discard drafts.
The right panel still scrolls inside its own bounds.

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

Issue #161 moves compilation from Settings to the SCD toolbar. The typed command
accepts only the active backend-issued creation identity. The source must be an
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
cannot erase its report. Workspace identities fence late reports and tree updates;
the global process lease lasts until the old request settles. Successful completion
clears only the captured compile revision, preserving later source edits. Published
artifacts refresh the tree; a running session remains unchanged with restart pending.
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

The Modules heading remains present for writable folders even before they have
module files. Its Add control opens five frozen choices: QR, client identity and
reconnect, monitor theme, monitor language and monitor view synchronization.
The catalog and add commands accept only a backend-issued workspace identity;
module IDs select embedded files, never frontend-supplied paths or content.

Sources are pinned to PNDS Template revision
`e3f4769537d6aeb2016b76610e80dea7b639384f` (package 0.5.1); delivery version
0.1.0 is separate from the App version. Each `modules/pnds-<id>/` contains the
actual sources, CommonJS package scope, bilingual wiring README and
`pnds-module.json` with provenance, per-file SHA-256, and pending wiring /
validation facts. The Template identity/seat/audio policy is an example for the
external agent to adapt, not an App-wide musical rule. No entry, manifest or
existing page is changed; dependencies, Skills and runtime stay untouched.

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
outside that lock and checks identity/root/source again on completion. Child
`fchdir` uses the held directory, so root replacement cannot redirect the process.
Git's repository-root paths are stripped through its exact project prefix; status
has a project pathspec and diff disables rename pairing, so a project nested in a
larger repository never returns other projects' paths or cross-boundary rename
headers. Existing and untracked files use the ordinary containment check;
untracked previews refuse symbolic links and nonregular files.

The reader probes installed Git binaries directly instead of the macOS
`/usr/bin/git` install shim. Missing Git and nonrepository folders remain normal
creation workspaces. Git children get a cleared environment, disabled system/global
configuration, prompts, optional locks, hooks and fsmonitor. Configured clean,
smudge and process filter drivers are discovered by a read-only config query and
neutralized for the inspection; diffs also disable external diff and textconv.
Every child disables lazy fetching and all transports. A read-only config probe
rejects repositories declaring `extensions.partialClone`, remote `promisor` or
`partialCloneFilter` before object inspection, returning an explicit unreadable
detail. This conservative boundary also works with older installed Git versions
that ignore `GIT_NO_LAZY_FETCH`; creators complete such repositories in their
external Git tool. Ordinary diff can otherwise download missing objects and
write the object database even without an explicit fetch action; see Git's
[partial-clone contract](https://git-scm.com/docs/partial-clone) and
[transport/lazy-fetch guards](https://git-scm.com/docs/git/2.56.0.html).
No Git initialization, login, network, commit, branch switch, merge or push command
is exposed. Each child has a five-second deadline, a separate process group and
1 MiB caps on stdout and stderr; status stops at 4,096 paths. Binary, non-UTF-8,
unreadable, oversize, timeout and no-longer-changed comparisons have explicit
results without silently truncating text.

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
Controlled child processes prove timeout and both output bounds. UI workflow tests
exercise the project-menu entry, stale/refresh and late-result behavior, and retain
drafts plus a running session. Native visual/focus and user-started App validation
remain separate acceptance evidence.
