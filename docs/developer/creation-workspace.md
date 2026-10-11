# Creation reading workspace

Issues #150 and #151 provide file reading plus the confirmed mode handoff.
The visual baseline is the A layout and eighth interaction review in
[the UI prototype](../prototypes/pnds-ui-prototype.html). Creation sidebars
share the existing App's 320px container, margins and window controls; file
categories, title switching and the bottom mode control follow that prototype.
The PNDS file badge identifies known contract configuration files, not module
provenance. Unimplemented editing/new-project/module/console controls stay absent.

## Confirmed mode handoff

The first click prepares a target from the authoritative runtime. A running
project takes precedence over another selected card. Without a live runtime,
the selected folder is used without starting it. Backend-prepared workspace
identities leave the current identity valid until explicit commit; cancellation
releases only the preparation. Folder, bundle and utility origins still come
from backend protection, not frontend classification.

The mode control copies the prototype's fixed 56px slant and 300ms fill/name
transition. A shared phase prevents duplicate submissions; startup/shutdown
also disable it. Esc, an outside pointer press and window blur cancel preparation
or confirmation. The performance overlay remains visible during confirmation.
After completion, hover is paused until pointer exit/re-entry; keyboard focus
is restored to the new control. Brutal and reduced motion complete directly.

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

`project/creation.rs` owns one active identity and an open root-directory handle.
Only open and description accept raw roots. Listing, reading and Finder calls
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

## Frontend ownership

`creation-store.ts` owns mode, active workspace, opening errors and recent
creation paths. Modes and issued identities are transient. Folder history is
stored through the existing serialized preferences queue, independently of
performance selection. Recent paths are revalidated on every open; selector
descriptions use temporary backend access and do not revoke the active identity.

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
selects directories only. Unimplemented new-file, editing, assistant, console
and module-add controls are absent.

Tests use the approved workflow/typed-command boundary in the frontend and the
public creation access boundary over Rust temporary directories. See
[testing.md](./testing.md) for mock conventions and
[app-behavior.md](./app-behavior.md) for acceptance scope.
