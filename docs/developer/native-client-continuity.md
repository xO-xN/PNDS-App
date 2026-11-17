# Native Client document continuity (#300)

A loaded score, its confirmed performance, network admission and the latest Host
candidate are separate facts. `ClientState.confirmed` pins the Host, project and
performance that authorized the existing source. `ClientSnapshot.activeHost`
exposes the confirmed Host and performance while its page is retained.
`ClientSnapshot.host` reports the latest valid discovery result, while `pageUrl`
identifies the loaded document. Network recovery compares discovery with the
confirmed performance.

## Discovery and admission

The native Client inspects the same complete public HTTP entry URL distributed to ordinary browsers. Public v1 metadata validates the candidate; the confirmed native source retains its private per-Host/project origin and headers.
The Client input accepts either that complete URL or `IP:port` and supplies
`http://` for the shorthand before calling the native command. The port is the
value advertised by the Host.
The coordinator polls retained-document states after network failures, rejected
metadata, Stop and project changes. An explicitly inspected address remains owned even if metadata is rejected
before any page opens, so polling can discover a later valid candidate; Leave
releases that intent. A valid candidate updates automatically but
never installs a page or joins a new performance. A different Host at the same
address remains a candidate; `expectedHostId` stays pinned to the explicitly joined
Host. Late poll replies still require the originating operation epoch.

The Client sidebar also browses the App's Bonjour directory. A LAN selection
or manual address starts a read-only inspection of that endpoint. Selecting a
directory entry pins the expected node identity. The empty, idle address field
is centered and sized like the Host sidebar's Import project button. Hovering,
focusing or entering an address expands it within the same reserved space.
The field uses the same background, shadow and text size in both states.
Inspection resolves the current project and performance from the endpoint and
reads its saved localized README and optional cover through the same identity
fence. The Client renders these assets locally for Creation test previews.
Embedded Markdown images and links are passive. Selecting another node keeps
the coordinator's current polling address.

An explicit entry from the directory carries the inspected address and exact
Host, project and performance identity. The existing staged native handoff
verifies the candidate at that address before and after preparation. Only a
successful commit transfers the polling address and active source. Failure or
cancellation preserves the old document, its address and its polling state.
Creation tests use the same native entry and retain their Creation role in the
directory and bottom bar. The ordinary browser entry continues to publish
Host performances. Creation's existing QR entry continues to point to its
current test performer page.

Unavailability or invalid/incompatible metadata suspends forwarding. The actual
private-source listener and its stable per-Host/project origin remain owned.
HTTP admission rejects new requests with 410, and cancellation reaches active
HTTP connections and upgraded tunnels. An exact confirmed-context recovery
resumes forwarding on the same listener; it does not navigate or call Refresh.
A verified Stop, another performance or another Host permanently retires the old
authorization, even if later metadata repeats it. Only a new explicit entry may
authorize another performance. Host-side identity fences remain in force.

## Native document and controls

The page URL and view epoch survive automatic discovery outcomes. Native view
ownership and role admission follow the retained document rather than only the
`open`/`disconnected` phase names. Ended, changed and metadata-error documents
therefore continue to own Client activity. Hiding the sidebar or window keeps the
same existing native ownership and storage rules.

Connection facts and the latest candidate live in the App sidebar. The flat
directory puts online Host, Creation and Client nodes in that order. It keeps
offline nodes last and shows their status on the second line. The list retains
nodes discovered or verified by address during the current App launch, across
role changes and leaving a performance. Node identity merges a returning node
with its prior row. The App tracks directly verified addresses while they are
absent from Bonjour and leaves the last directory intact if a read fails.
The App opens with an empty directory history and fills it from new observations.
When the directory is empty, a centered hint with vertical spacing separates
the list heading from the address field.
The compact address field follows the node cards in the same scroll area.
The bottom bar labels its sidebar button with the retained source name.
Its primary action joins, switches the performance,
switches the source, or leaves. For a retained Client page in the main window,
Cmd+W shows “Press again to exit” in that button. Press Cmd+W again or activate
the highlighted button to leave. Confirmation belongs to the retained page
and clears when the page or selection changes. When the retained source confirms its performance has ended,
the Client shows one notification for that performance and lights the rainbow
ring around Exit Performance. The performer page stays open until the user
leaves or switches. A compatible new performance from the same node opens the
sidebar and offers explicit entry. Closing the sidebar defers that candidate
and leaves it available through the source button. A new performance identity
can reopen the sidebar. A successful handoff clears the sidebar hold for the
old page.

The Client uses the Host welcome layout with the heading “Join a performance.”
The idle view suggests selecting a node or entering its address. Selecting a
Host shows the node name below the heading. A waiting message appears until the
Host opens a project, then the view names the verified project and points to the
bottom-left action. Creation test nodes use the README preview. Inspection feedback
appears in the reading pane after a short delay. The pane keeps its last
complete view during inspection. A failed poll disables joining, and a saved
Creation preview stays readable for that selection. An identical result
preserves the existing page and scroll position. The
directory uses the Host project selection surface, including the theme's fill,
edge, shadow and motion. Activating the same card again clears its pending
inspection or preview. With a score already open, clearing an alternate choice
restores the active source selection and keeps the score open. An offline node
cannot supply a join candidate. A selected offline card can still be deselected.

The native score uses the same composition as the Host monitor. When the
sidebar opens, the performer page keeps its full layout viewport and shows
around the card's rounded corners. Only the rounded card reserves pointer
input for the App. Automatic discovery leaves keyboard focus on the score.
A Cmd peek can transfer it to the App, and focused sidebar controls
keep the sidebar open after Cmd is released. Escape in the sidebar defers the
candidate or cancels its preparation. App menus, dialogs and settings retain
their own focus and use the modal presentation path. Preparation keeps the
staged view hidden and preserves the old score's presentation.

When the connection error toast overlaps an open score, the App passes its
visible bounds to the native view so the App receives clicks on the toast.

Window → Refresh Score Pages (`⌘⇧R`) deliberately retires the current document,
then rechecks its confirmed context. A newly discovered candidate still requires
explicit entry. Leave closes and flushes the native
view and shuts down the proxy through the existing cleanup barrier; cleanup
failure retains ownership for retry. Participation creates no local Host audio.

## Verification boundary

Public coordinator tests exercise real loopback HTTP and upgraded transport,
malformed/incompatible metadata, Stop followed by later candidates, same-context
recovery, old-source rejection and explicit cleanup. Component tests exercise
sidebar candidate facts, unchanged score mounting, role admission and deliberate
refresh; those tests alone are not native document evidence.

Run the opt-in real native continuity seam explicitly:

```sh
cargo test --manifest-path src-tauri/Cargo.toml native_document_survives_public_client_discovery -- --ignored --nocapture
```

It compiles the existing Cocoa/WebKit fixture and opens a disposable visible
WKWebView through the real `ClientCoordinator` and `ClientProxy`. The source is
first-party, with the same durable-origin/PAC arrangement. Every probe checks the
same unsaved random memory token and `performance.timeOrigin`, advancing local
ticks and localStorage through a silent-socket metadata timeout, HTTP 503,
malformed JSON, incompatible metadata, same-context recovery, Stop, a new project
and another Host at the same address. After revocation its HTTP probes return 410.
Explicit Leave waits for the actual fixture document to close. All listeners,
processes and temporary storage belong to the fixture. The initial hidden-window
attempt observed WebKit timer throttling; the check uses a visible window because
background/lock-screen execution is outside this contract.

`npm run native:client:verify` separately checks localStorage, IndexedDB and cookie
recovery across native process recreation, same-process view/store recreation,
changed transport ports and another isolated Host/project. Both native checks
verify media API exposure without requesting device capture. They prove the
mechanisms on the executing macOS; signed App media capture, supported baseline
macOS and dual-machine LAN behavior remain the existing native acceptance scope.

## Explicit native candidate handoff (#301)

Discovery never calls Inspect or Refresh on a retained document. The sidebar
renders the latest Host/project/performance candidate and passes that exact
identity to `joinClientPerformance(expectedHost)`. The button is keyed by all
three identities: replacing B with C must replace the DOM button, so a pointer
press or keyboard activation begun on B cannot activate C after a render.
A fresh click is required for each new performance, including restarting the
same project. A different Host is visibly identified and needs its own explicit
entry. Candidate metadata is checked before creating its source and again after
preparation; neither a stale click nor a late result may confirm another candidate.

`ClientState.epoch` owns discovery/entry operations; `page_epoch` owns the real
loaded document. Starting or cancelling preparation must not change the latter.
A pending candidate owns a separate private proxy and hidden first-party WK
page. Scripts run only after explicit entry. Navigation completion alone is not
readiness: the actual document must finish loading and its project must report
`PNDS_PARTICIPATION.reportPrepared()` with the exact Host/project/performance
and page scope. A matching `preparationFailure` report or the bounded preparation
deadline fails that attempt. Required-resource guarantees are the reporting
project's responsibility; no report is treated as unknown, never as prepared.
Neither readiness nor page opening claims that the project admitted a performer.

During preparation the old WK document, memory, clock, storage, input and source
stay owned. A failed or cancelled attempt closes only its matching staged page,
flushes its store and releases its proxy. Its operation error stays in the
sidebar, and retry prepares a new candidate without rebuilding the old page.
A staged page cannot own native keyboard/pointer routing, file pickers or capture
permission; media playback is suspended until handoff. Refresh is disabled while
preparation or cleanup is pending.

Commit and cancellation are single owned transitions. Every queued native action
matches the staged page's epoch and URL. On successful preparation and a final
metadata check, the old document is closed with `_close`/`_isClosed`, its storage
is flushed, then the staged document is promoted. Only the active owner receives
native input. The old source is suspended and shut down; the immutable Host
identity fence still prevents revoked traffic from entering a replacement.
A cleanup failure retains the page/store/source owner for retry. An uncertain
handoff blocks late view synchronization from recreating an already retired old
document. Leave drains staged, current and retained network cleanup before
releasing ownership.

Run the production-view transaction fixture separately:

```sh
npm run native:client:entry:verify
```

This opt-in macOS executable starts a real `SessionManager` Host in an independent
MockRuntime App and a Wry Client App. It opens no development server and starts
no local Client audio engine. Blank projects use actual local scripts and live
project admission; preparation failure requests an actually missing required
resource. The Client executes production WK creation, candidate preparation,
rollback, promotion, `_close` verification and storage flush. Assertions compare
unsaved memory tokens, `performance.timeOrigin` and advancing clocks across
failure/cancellation, send AppKit key events to verify active input ownership,
and verify A → B → A storage restoration plus explicit Leave. Its JSON output and retained `pnds-native-entry-*` temporary evidence directory
record what ran. The fixture verifies native window occlusion and real document
visibility before clock assertions; AppKit synthetic event delivery alone does
not prove a foreground document. The `native-client-fixture` feature adds only opt-in fixture
entry/probes; it is not enabled in release builds. This is single-machine native
mechanism evidence on the executing macOS. Physical capture cleanup, a signed
installed App, minimum macOS and dual-machine LAN remain separate acceptance.

The foreground fixture explicitly activates only its own App/window, waits for
native active/key/visible/occlusion facts and `document.hidden === false`, then
begins clock and input assertions. CLI window visibility or synthetic AppKit
input alone is insufficient evidence of a foreground page. A failed business
assertion is not retried. This barrier is fixture setup; production WebKit
scheduling policy is unchanged, including the macOS 13.5 path. The successful
2026-11-09 production-view run retained one old token/time origin while its ticks
advanced across required-resource failure, preparation and cancellation; entered
B only after preparation, closed A's private source, restored A's stored claim
on a later explicit entry and removed the active WK page on Leave. Captured
native visibility accompanies each memory/clock probe. The retained JSON report
is copied into the group acceptance evidence by the integrator.

## Leave admission and native picker ownership

Leave acquires the coordinator's transition gate and captures pending, current
and retired source owners under one state lock. It publishes `leaving` before
native cleanup, keeps entry/commit admission closed throughout cleanup, and
returns to `idle` only after every captured owner is released. A duplicate Leave
cannot advance that transaction's epoch. A Refresh already retiring its own
source remains responsible for that resource after cancellation. Completed
native commit/cancel replies require their own epoch before changing state, so a
late result cannot clear another operation's gate or replace its outcome.
Failed independent owners remain available for the next explicit cleanup retry.

A native file picker belongs to its exact WK document and panel instance. Closing
a failed staged candidate must not cancel a picker opened by the still-active
page. Retirement cancels only its own view's picker; a late completion clears the
registered owner only when it still refers to that same panel. The production
native fixture opens an actual file-input sheet from A through an AppKit key
event, fails B's required-resource preparation, and verifies A's sheet remains
attached until explicit cancellation. This is native resource ownership evidence,
without selecting a user file or mocking the panel registry.
