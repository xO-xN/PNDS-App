# Creation reading workspace

Issue #150 adds the idle creation entry and a file reader. Runtime mode handoff,
editing, new projects, console logs and module addition remain separate tasks.
Opening here never calls performance preflight, starts a process or installs a
bundle. The idle mode button confirms with two clicks; Esc, an outside pointer
press and window blur cancel its confirmation.

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

Only one open is accepted at a time. A queue also orders old open calls across
leave/re-entry, and request ownership discards stale results. Native selection
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
