# Pending documents (#260)

The **Creation resources** group and main editor use stable document IDs rather
than ordinary project-relative paths. Native commands hold the current creation
identity and the actual open project directory. Saved versions are opaque
SHA-256 revision tokens, refreshed on save, rename or an observed external
change. Independent body fingerprints validate the exact UTF-8 bytes in the
index, publication journal and durable recovery record. Migration retains legacy
body-SHA versions and historical snapshots. Renaming preserves identity while
invalidating earlier save and rename authority, including with identical bytes.

## Private files and migration

Each body is `.pnds-creation/pending-documents/<id>/<display name>`. The identity
directory keeps an external rename separate from document identity, and allows
legacy same-name documents to migrate without overwriting one another. Every
directory is opened relative to the held project descriptor with `O_NOFOLLOW`;
private directories require mode 0700. Body reads reject nonregular files,
invalid UTF-8, binary controls and more than 1 MiB. The collection permits 64
documents and 8 MiB of body bytes, independent of JSON escaping overhead.

`pending-documents.json` schema 3 stores only metadata. A
`pending-documents.ready` marker distinguishes an interrupted migration from a
missing published index. Migration validates the old `materials.json` or older
App-data collection, publishes and checks every independent body, then publishes
the index and ready marker. Legacy records remain untouched as recovery evidence.
An empty current index is authoritative; old copies never repopulate it.

External saves refresh clean content and the catalog version. An external
basename change is discovered within its identity directory; an external body
deletion removes that document from the current index. A missing identity
directory, corrupt index, symlink, ambiguous rename or unsupported content raises
an error instead of becoming an empty collection. Dirty editor buffers retain
their own expected version and cannot overwrite a newer saved body.

## Recoverable publication

Save, rename and deletion first validate the current collection and expected
source version. `pending-publication.json` durably records the previous metadata
and intended complete collection before publishing body files and the index.
Each recovery step accepts only the expected previous or already-published
bytes. It completes the index before removing superseded names, and removes the
publication record only after directory synchronization. A later conflicting
external change blocks recovery and remains intact. Publication errors preserve
the UI draft; reopening reconciles durable facts rather than inventing success.
Publication temporaries use a control-byte prefix, which is excluded by the
existing document-name validation. Only their complete generated name grammar is
ignored during body enumeration. All valid `.pending-*` document basenames,
including extensionless numeric names and external renames, remain visible.
Ambiguous leftovers from the old temporary namespace raise an error rather than
silently dropping an indexed document.

The dedicated save/read/rename/delete/reveal commands never expose private paths
to ordinary assistant file tools. The **Inbox** picker and Finder drops on
**Creation resources** share one import command and report failures per file.
Text imports copy a regular text file and assign a numbered name if the original
name is taken. The sidebar lists successful imports and opens them when selected.
The external source is never modified.

## Pending images

The same Inbox accepts PNG, JPEG, GIF and WebP. Import opens a regular source
file without following its final symlink, checks the format signature, and
publishes its original bytes under `.pnds-creation/pending-media/<id>`. The
separate `pending-media.json` catalog stores name, type, byte count and version.
The body is published before the catalog entry becomes visible. Import permits
up to 16 MiB per image and 128 MiB total for images within the shared 64-media-entry catalog.

The sidebar lists metadata only. Selecting an image loads the matching saved
version through the current creation identity and checks the stored bytes before
rendering a local data URL in the image preview. The existing assistant text
catalog and tools do not expose the image body. Complete project copies carry
both catalogs and their bodies. Git, default performance bundles and controlled
checks continue to exclude the private directory.

## Audio audition (#336)

The same Inbox stages WAV and MP3. It copies and hashes original bytes in
bounded chunks, checks the format signature, and asks AVFAudio for the
duration before publication. Audio permits up to 512 MiB per file and 2 GiB
total, within the shared 64-media-entry catalog. The sidebar receives format,
size and duration, and the existing assistant document catalog is unchanged.

Selecting an audio entry does not acquire a device. On Play, native code
opens the selected saved version through the held project directory,
verifies its bytes into a private, seekable temporary file, and opens the
file with AVAudioPlayer. The WebView sends transport and gain changes and
receives time and playback state. It never receives audio bytes. Preview gain
has no relationship to project gain or mute. Leaving the preview or changing
its effective output stops playback and releases the temporary file.

The bottom bar and the audition panel share the same creation output
selection. A ready Internal runtime owned by this project uses its applied
device. Otherwise the preview uses the current choice. CoreAudio resolves
an explicit name to one available UID. The player checks that route before
playing or resuming. A CoreAudio device-change listener and periodic native
check stop the player when the route disappears. A lost device
stops the preview with a visible error. The next Play is always explicit.

### macOS acceptance

Record the macOS version, both device names and connection type, each audio
format and byte size, and the observed result.

1. Choose built-in speakers as the macOS output and a different USB output
   in the App. Import a WAV and MP3 together with an image and a text file.
   Check the file list and duration after closing and reopening the project.
   Verify selection stays silent and Play is heard through the USB output.
2. While playing a long recording, seek near the end, pause, adjust audition
   gain, and resume. Check the playback position and compare to the same point
   in the source. Change the resource, close the project and exit creation mode
   during separate plays. Each action must stop the preview.
3. With an Internal test running on the USB device, select built-in speakers
   for the next run. Verify the bar and audition stay on USB until the test
   restarts. Repeat in External and None and with project audio muted. The
   audition should play using the device shown by the bar.
4. Disconnect the USB device during playback. Confirm the stopped state and
   error and listen for any audio from the built-in speakers. Reconnect and
   press Play explicitly. Select System default and verify that it follows
   the macOS output.

## Explicit integration and recovery

**Last integration recovery** is available from the title bar's project menu.

`adopt_creation_material` retains its compatibility name and exact current-read
requirements. Successful adoption records its source/version/destination in the
current Work journal; a mere catalog entry or read does not record adoption.
`complete_creation_pending_integration` requires all adopted sources, the entire
saved text-task target set and required reference versions. Pending questions,
changed sources/targets, failed static checks and failed/cancelled runtime checks
leave every original pending.

The project domain derives verification from actual static diagnostics and a
native controlled-check receipt with current input evidence and confirmed
cleanup. The command adapter supplies only App resource and live-performance
availability facts; callers cannot inject a claimed verification result. A real
unavailable report, an active performance or a documentation-only task is recorded
as unverified with its reason. Model-provided verification text
is not accepted as evidence of runtime success.

`pending-integration-next.json` first saves original bytes, the complete task
journal and completion result independently of App-data task retirement. Only
then are all selected sources removed together. The new successful recovery
record replaces `pending-integration.json` after removal has been published;
an interrupted completion continues from the next record on reopening recovery.
An unsuccessful later task does not replace the last successful record.

Full restore uses a private durable copy of the whole task journal at
`pending-recovery/assistant-tasks/<restore-task-id>.json`. This project-relative
location follows a complete folder move or copy. Legacy journals below the old
root's digest are opened only through the current held project directory and
migrated without reopening the former absolute path. Before rebinding the root
and task-created directory identities, recovery checks that the entire immutable
task still matches the successful completion snapshot. Durable file and directory
undo progress is retained across relocation and interrupted pointer publication.
Existing task undo validates all owned targets before any
change and records an `undoing` path before each file mutation, so an interrupted
restore recognizes exact before/after bytes and continues. Later user edits
block full restore. Originals-only restoration checks IDs, names and saved bytes,
then restores source identities without modifying current project files. No
execution grant is restored from either recovery record.

The entire `.pnds-creation/` boundary stays excluded from Git, performance bundles,
ordinary assistant tools and runtime-check inputs. Copy the complete project
folder, including hidden files, to carry pending documents and their recovery.
Changing a project version does not restore private pending state.

Native tests exercise real temporary projects, independent files, exact CRLF and
Unicode bytes, legacy migration, full body budgets, external edits, interrupted
publication, original task retirement, fresh App-data recovery, interrupted undo
followed by complete project move/copy, legacy recovery relocation, later-edit
protection and a real Node entry/reference load. Physical editor input, Finder,
real model decisions and sound/visual results remain native acceptance.
