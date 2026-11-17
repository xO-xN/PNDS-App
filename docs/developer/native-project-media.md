# Native Host and creation performer media (#322 / #323)

The Host monitor, projection and creation performer shell retain their App
controls while a managed first-party WKWebView owns each project document.
The Client remains a separate coordinator and keeps its existing retained-page,
single-role and successful-candidate handoff rules. See
[native-client-continuity.md](./native-client-continuity.md) and
[ADR-0006](../adr/0006-projection-window.md).

## Source and authority

`project_media_view` binds a page to its actual shell label, role, current runtime
and navigation. A source must belong to the running project's appropriate
listener; frontend URL strings cannot grant access to arbitrary network targets.
The trusted `.localhost` origin uses the Client's managed proxy and WebKit storage
configuration. Project resources, module Workers and connection paths remain
within that source. A project WKWebView has no Tauri IPC or App command authority.

The macOS bundle declares `localhost` as its App Transport Security HTTP
exception domain, including its subdomains. This lets packaged WKWebViews load
the generated `pnds-*.localhost` origins through their loopback proxies. Check
the built `.app`'s `Info.plist` and load a project from an installed copy when
verifying changes here. The standalone native runners lack the bundle's ATS
policy.

Compare URL-canonical origins, including the actual role listener port, when a
declared DNS host contains uppercase letters. Keep raw declared addresses for
display only. Theme/locale transport and parameter-preview binding use the same
canonical origin; they never accept a wildcard or a different source as an alias.

`SessionSnapshot.runtimeGeneration` carries the App's actual runtime generation,
including legacy projects without runtime-port reports. Every native target pins
that generation before dispatch, at main-thread execution and in later permission
and message callbacks. Matching a reused address/port alone cannot authorize an
old request after restart. Do not fetch a new generation to reauthorize old intent.

Existing Classic and utility monitors load scripts and Socket.IO through
`location.hostname` plus the declared performer port. Local proxy routing retains
only the current project's two explicit listener aliases and includes those exact
HTTP/WS sources in its script/connection policy. Another hostname or undeclared
port is rejected. Durable document and listener-alias ports must be distinct;
local allocation excludes the current listeners and replaces an old local port
mapping if a newly configured listener now uses it. The remote Client path keeps
its original source durability and same-origin policy. These aliases do not grant
recording management or access to another process.

Only App shells call `syncProjectMediaView`, `postProjectMediaMessage` and
`closeProjectMediaView` through generated bindings. Layout and close requests
carry monotonically increasing request numbers. Messages and load outcomes
carry the actual window label and navigation; stale outcomes cannot reveal or
release a newer document. The optional theme, locale and parameter-preview
messages retain their existing payloads and origin checks through a narrow
bridge. Do not expose a general-purpose eval command to project content.

## Media ownership

WebKit/macOS ask the user about the current page and matching source. The native
delegate prompts or denies; it never silently grants a permission. The project
provides its own manual enable, input selection, denial and retry interaction.
Showing a hidden window, restoring an App role or reconnecting a transport must
not be implemented as automatic capture authorization.

`globalThis.PNDS_MEDIA_SURFACE` identifies `monitor`, `projection` or `performer`
and exposes `captureAllowed`. It is an App-owned, read-only page hint. The main
monitor owns monitor capture, analysis and model initialization. Projection
receives `captureAllowed: false` and retains `surface=venue`; native media
permission is denied there. The project must also skip its inference/analysis
setup in that branch and subscribe to its own result distribution. A permission
denial alone does not prevent arbitrary project code from loading a model.
The App does not introduce a musical or media-result transport.

Each performer has its own identity, isolated browser storage, stream and
analysis ownership. Two windows may select one physical device when macOS and
the device permit it. A busy/unsupported device produces a recoverable page
error; never close or disable another page to force acquisition. A logical
claim takeover is separate from hardware sharing. Stopping media does not imply
leaving the project or releasing its claim.

## Lifetime and presentation

The project NSView remains above the shell for input routing, while its CALayer
paints below the transparent shell WK layer. Sidebar, popover, menu and dialog
pixels therefore composite over the same live score, including their rounded
edges, shadows, translucency and fade. Never cut visual holes in the project
layer: such holes expose the shell's empty stage background as a rectangular
black patch. `bounds.occlusions` only routes App-owned input to the shell.
Menus and dialogs own the full stage's outside-dismiss input and return a
guest-owned native first responder to the shell without hiding the document.
Sidebar and notice regions otherwise preserve native input outside their bounds.

The production macOS window includes an `NSVisualEffectView` at z=0. Keep the
project layer at z=0, the shell at z=1 and its content-owned AppKit controls at
z=2. A negative project z would put the loaded score behind the system backdrop
and paint the Host monitor white. Preserve the actual window effects and corner
mask. Capture the shell's original layer position and restore it as soon as a
confirmed closed project is removed, before storage flush; later Client pages
must inherit their original shell ordering.

`native-project-compositor` paints shell ancestor backgrounds around the actual
native rectangle, retaining creation margins and performer device surrounds in
their current theme, with matching corner fill for rounded native surfaces.
Root theme/direction changes refresh this paint without requiring a resize.
The first transparent opening waits for a successful owned native sync; hidden,
failed, retiring and unmounted pages restore the original background. Layout
updates or opening settings do not briefly close that opening. Reveal, stop and
projection covers remain normal shell descendants and fade once above an opaque
native underlay, rather than fading both layers.

Only genuinely hidden panes or unavailable/retired documents hide the native
surface. Hiding is not closing: the document, its clock, Workers, connection and
already enabled inputs retain their ownership. Temporary network failure likewise
does not destroy a retained document.

Explicit close, refresh, successful replacement and App exit close the owning
WKWebView and its managed source. The page should also stop its tracks, analysis
timers, AudioContexts and Workers on its explicit release path. Capture promises
and Worker results must verify their own generation after an asynchronous wait;
stop a stream obtained for an ended generation immediately. Native document
close remains the final release boundary even for a page that omits cleanup.
One performer's release cannot close another performer's stream or source.

Native storage flush can pump the AppKit run loop. `ProjectMediaViews` therefore
holds a separate per-label cleanup guard across native close and proxy shutdown;
reentrant sync/close requests fail before advancing their request sequence. A
retiring owner remains retryable after failure, while final removal checks the
captured target and generation. Never treat a temporarily missing native view as
permission to replace a source whose cleanup is still running.

Page Retry explicitly closes the failed document before creating a new,
distinct navigation attempt. Pending/failed cleanup suspends layout recreation
and invalidates the old message endpoint. Ordinary hide/show retains the page.

The native monitor focus gate combines meaningful page-element focus with its
pointer area and a 500 ms leave debounce. Command editing inside a page input
must not publish the App's Command peek or hide the surface. The narrow
`pnds:host-focus` message hands an idle guest back to its own App shell only when
that window is currently key; delayed events cannot activate another window.
Native page subscriptions use `onProjectMediaView` in `events.ts` and await its
registration promise before opening a document.

Viewport dimensions, orientation and zoom stay shell-owned. Keyboard, pointer,
native form controls, JavaScript dialogs, focus and single-touch simulation keep
the [page interaction contract](../zh-CN/reference/page-interaction.md). App
shortcuts retain their window scopes. Monitor reveal/cache busting and projection
standby/README gates continue to apply to each native navigation.

Map DOM bounds through the actual shell WKWebView's CSS content rectangle and its
converted frame inside `NSWindow.contentView`. Compare the reported CSS viewport
aspect with the shell's public bounds/safe-area rectangle: normal titlebars and
the main window's overlay chrome can select different content rectangles. Do not
scale against the whole content view or hard-code a titlebar height. Persistent
health warnings and visible toasts use local native hit-test passthrough regions;
their controls remain in the App shell while the score continues rendering.
Overlapping regions retain normal union semantics and never change paint. A real
native mouse click on the underlying DOM control is the verification boundary.

## Evidence

The runnable [native media project](../../src-tauri/tests/fixtures/native-project-media/README.md)
uses a real camera frame Worker for brightness and one microphone analysis chain
for RMS. Only these derived values reach its HTTP server. Projection reads the
same results without creating a stream, AudioContext or Worker. This is a manual
acceptance project, separate from optional gesture/model modules in later tickets.

Automated HTTP, ownership and shell tests prove their observed boundaries only.
Record camera/microphone capture, native allow/deny/retry, input choices,
multiwindow sharing success or denial, and physical privacy-indicator release
separately. Model inference, signed arm64/Intel installation and the final joint
scenarios remain within #313/#314 unless separately observed. Never treat API
visibility, controlled arrays, resource copies or synthetic images as capture.

The native permission callback follows Apple's
[WKUIDelegate media permission API](<https://developer.apple.com/documentation/webkit/wkuidelegate/webview(_:requestmediacapturepermissionfor:initiatedbyframe:type:decisionhandler:)>)
and the [WebKit decision enum](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/API/Cocoa/WKUIDelegate.h).
These describe permission handling, not proof that a physical device captured.

Run the opt-in production fixture with `npm run native:project:media:verify`.
The Node launcher checks the completed `result.json` in the runner's reported
temporary directory. A macOS AppKit exit code of zero alone is insufficient:
missing or failed reports make this command fail. The fixture does not request
physical camera or microphone capture.

The compositor probe captures only its own native window, comparing rendered
pixels beside and beneath a rounded translucent control, during a fade and a
controlled live score color change, and beneath a dialog dimming layer. Real
AppKit mouse events verify App chrome and uncovered score input separately; a
real native key event types into the overlay after focus transfers to the shell.
The same document token, time origin, Worker and local clock survive throughout.
These native paint/input checks complement the shell tests; non-null layout
bounds alone are not evidence that the score stayed visible.

Both native runners build their main window from the merged production macOS
`WindowConfig`, including vibrancy, titlebar and corner initialization. Run
`npm run native:app-shell:verify` for the full React path: it statically builds
the actual AppShell and App CSS, presses its Load action through the real command
bridge, starts the fixture's real Node project and waits for MonitorView's actual
loaded/reveal lifecycle. It uses a separate App identifier and preferences, with
no dev server or changes to the user's project. Own-window pixels verify the
loaded score beside real sidebars/popovers, with real native control pixels and
hit targets in Pond, Sand and Brutal. Native clicks minimize and restore Pond and
Sand; on the executing macOS, Brutal reaches the real `_NSThemeWidget` but did
not minimize. This remains an observed limitation of that borderless path, not a
passed minimize check or an established root cause. It also checks the Root animation
clock, reveal state, runtime errors and shell layer restoration after Stop. The
completed report is mandatory even when AppKit returns exit status zero.
