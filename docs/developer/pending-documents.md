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
**Creation resources** call the import command once per selected file. Each
successful import copies a regular text file and assigns a numbered name if the
original name is taken. The copy appears in the sidebar list and opens when
selected. The external source is never modified.

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
