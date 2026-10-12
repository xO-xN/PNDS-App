# Creation reading workspace

Issues #150 and #151 provide file reading plus the confirmed mode handoff;
#154 adds manual save, rename and disk-version conflict handling; #155 adds
external disk tracking, and #156 adds manual testing, monitor and console.
The visual baseline is the A layout and eighth interaction review in
[the UI prototype](../prototypes/pnds-ui-prototype.html). Creation sidebars
share the existing App's 320px container, margins and window controls; file
categories, title switching and the bottom mode control follow that prototype.
The PNDS file badge identifies known contract configuration files, not module
provenance. Unimplemented new-project/module controls stay absent.

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
The focused mode control owns native Enter/Space activation even when a selected
project can Load; the global Enter session alias yields to `data-mode-switch`.
Confirmation exposes its target in the accessible name and links the actual
consequence with `aria-describedby`. A failed keyboard submission restores focus
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
draft in `creation-drafts-store.ts` keyed by project-relative path, holding the
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

`creation-changes-store.ts` owns disk revisions, per-file reader revisions and
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
selects directories only. Unimplemented new-file, editing, assistant, console
and module-add controls are absent.

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

The creation preview follows the finalized A layout and review eight in
[the prototype notes](../prototypes/README.md): a Live test heading with the
saved audio-mode choices, a separate bordered monitor with an address/mode
strip and expand action, then a compact performer list with a count and bottom
add button. Runtime start/restart, close, refresh and live gain stay in a compact
bar; saved-file/global-audio explanations use a keyboard-accessible disclosure.
The running badge always shows the applied audio mode, separately from the
selected next-start mode. Pending configuration and actionable errors remain visible. The right panel
scrolls inside its own bounds when the window or client list is small.

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

Committing an audio, LAN or room dropdown keeps a separate sidebar hold after
the portal closes. The operator can inspect the new setting and use Change.
Cancellation creates no hold. Physical leave after re-entry, window blur and
session command/lifecycle changes release it; portal mouse events cannot clear
or fake physical sidebar presence. See `HoverSidebar` and workflow regressions.

On 2026-10-12 the user confirmed in the restarted development App that hiding
retains/restores the same performer, X deletion frees the Inarticulate III player
number for a new device, and settings selections keep Change available. Sidebar
plain arrows switch projects correctly; the user reported a blue outline on its
noninteractive focus receiver, so that surface now suppresses the browser's
outline while controls retain their normal focus rings.
