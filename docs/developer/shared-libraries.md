# App shared packages

App shared packages are an explicit project runtime requirement. App-owned browser
files and a complete production npm lock tree stay in the App; the project owns
its routes, source wiring, model files, audio and score assets. Each public
library ID has one exact selected version. The App 1.6.2 inputs are fixed in the
manifest reference and the [#199 build evidence](../acceptance/199-v1.6.2-release.md);
the final native installer acceptance passed on both Macs as recorded there.

## Project requirements and adoption

The creation sidebar's Modules heading offers an "Add shared package" entry
beside PNDS module addition. Both use the same two-column card browser and
detail layout, with a single column in narrow windows. Package cards show
purpose, exact shipped version, runtime kind and the saved reference state.
"Referenced" only describes the manifest; it does not certify source wiring
or project compatibility. A differing reference remains visible, and the
detail explicitly explains replacement before adoption.

Read the catalog before opening the dialog and show waiting on the trigger.
The title and actions stay outside the scrolling body. Entering details focuses
the title, returning restores the selected card, and closing restores the entry
button. Source URL and integrity live in a disclosure. The new project version
is entered in details and cleared when selecting another package; an already
adopted exact reference cannot be added again. Read failures keep a reload action,
and replies from a previous project cannot open or update the current dialog.

Self-contained projects keep manifest schema 1. Projects with `sharedLibraries`
use schema 2 so an older Host rejects the unsupported contract rather than
ignoring a new optional field. Each reference is an `{id, version}` pair; ranges,
unknown IDs and duplicates are invalid. A Host update never edits these pairs.

The "Add shared package" creation action adds or adopts a reference and a new
project version in the same atomic manifest write. It requires the active writable folder identity and
the displayed disk version, and blocks manifest drafts. It does not copy a
library, install dependencies, wire author source or change a running session.
Repeat adoption of the same reference is idempotent. See
[creation-workspace.md](./creation-workspace.md) for the shared identity,
descriptor-relative filesystem and late-result rules.

Browser entries (`p5`, `ml5`) are browser distributions, not Node modules. Node
entries (`express`, `qrcode`, `socket.io`, `socket.io-client`, `osc-min`) include
their actual production closure. `socket.io` and `socket.io-client` also expose
their matching browser distributions. The project may mix shared entries and its own dependencies;
shared resources are never materialized into the project by the App.

`package.json` can retain production declarations for standalone development.
The dependency gate exempts a package from local `node_modules` only when its
declaration is the same exact version as the manifest's shared reference.
Ranges, different versions and unshared packages still require local dependencies.
Browser-only `p5`/`ml5` declarations are covered for their browser distributions;
this does not make their entries valid server-side modules.

## Fixed creation templates

PNDS Classic creation uses the same exact shared-resource gate as packing and
installation. Its embedded Template 0.7.0 source declares Express 5.3.0,
Socket.IO 4.8.4, osc-min 2.1.2, qrcode 1.5.4 and p5 2.3.4. Generation publishes
only after those bytes pass verification; a missing resource leaves no new
project directory and never requests npm or a network fallback. Blank has no
production dependencies. See [creation-workspace.md](./creation-workspace.md)
for fixed-source provenance and independent project/client initialization.

## Runtime boundary

The resolver checks the exact reference against the shipped catalog and checks
each listed resource's containment, byte length and SHA-256. Missing versions or
damaged files fail explicitly; there is no version substitution or network
repair. A project without references does not need the shared resource directory.

Selection and startup use a process-local `SharedLibraryResolver`. Overlapping
Node inventories are verified once per unique path, byte length and expected
hash within a request. The first resolution checks every required byte with
SHA-256; later resolutions reuse only successful checks whose canonical path,
device/inode, length, nanosecond mtime and ctime still match. Every request still
opens and checks each unique file, its containment and exact expected hash.
Restoring mtime after a same-size edit does not preserve ctime; atomic replacement
changes file identity. Missing, redirected, unreadable or changed files fail or
are hashed again. Failed resolutions invalidate the cached resource set.

The cache holds one resource root and catalog and at most one record per
declared resource path, including when an internal link changes target. It is never persisted and is
invalidated when the catalog identity or change timestamps differ. Files and
the catalog are checked again after reading to reject changes during verification.
The verification mutex serializes competing scans without holding a session
lock. `LibraryCatalog::resolve` used by pack/install keeps a fresh complete
SHA-256 scan for each validation, with overlapping inventories deduplicated.

`PNDS_SHARED_LIBRARIES` contains only the resolved references for that launch.
Each entry supplies `version`, `kind` and an absolute server-side `path`; an
optional `browserPath` names the matching browser distribution. A project server
mounts individual browser files on its own HTTP routes. Phones and monitor pages
use those relative same-origin URLs through the Host-selected HTTP or HTTPS entry.
Ordinary projects retain HTTP. Full-URL support is compatibility only; HTTPS
requires an explicit `scoreServer.needsHttps: true` for secure-context APIs,
declared adaptation, the enabled global switch and valid settings. The shared
library declaration never requests HTTPS. See [manifest.md](../en/reference/manifest.md)
and [runtime-contract.md](../en/reference/runtime-contract.md) §15.
Never expose the entire resource directory or hand a phone a filesystem path.
Serve HTML and JavaScript as UTF-8; incorrect response encoding can corrupt
p5's Unicode expressions even when the resource bytes and SHA-256 are correct.

Node CommonJS source can require the supplied Node entry. Import-only ESM uses a
`file:` URL; `NODE_PATH` is not an ESM resolution mechanism. The selected osc-min
returns a `DataView`, so UDP transport must use the view's actual `byteOffset` and
`byteLength`. Wiring examples must preserve the project's own OSC and musical
policy rather than copying a generic sound mapping.

## Build and validation evidence

On a fresh checkout, run `npm run libraries:fetch` before checks that need the
shipped resources or before the user starts the App development server. This
build-time command stages the fixed browser artifacts and complete production
Node lock tree. `npm run libraries:check` verifies the staged bytes and exact
pins without downloading or running npm. `tauri:build` already runs the fetch
step before bundling; project opening and startup never fetch resources.
The existing Node, SuperCollider and utility resource preparation still applies;
see [releases.md](./releases.md) for those build prerequisites.

Build inputs pin official npm artifact URLs and integrity values. Browser-only
artifacts retain their source/licence records. The production lock tree retains
the transitive versions npm actually resolves, including nested packages; it is
not manually flattened. Build-time preparation and checksum verification are
separate from runtime, which never invokes npm or downloads a missing library.

Test resource preparation through its public command, and project behavior
through adoption, preflight, launch and bundle workflows. Real Node/HTTP/Socket.IO
and controlled UDP checks demonstrate their own boundaries. Actual browser
execution and drawing are stronger evidence than HTTP 200 or a mocked browser
global. Neither proves native WKWebView, sensor permissions, inference, audio or
performance acceptance. Record those results separately, tied to the actual App,
project and library versions.

The ignored `local_shared_project_candidates_install_and_repack` test accepts
`PNDS_CANDIDATES_DIR` pointing to local artifacts and their hash inventory. To
also exercise an actual installed work in Chromium, explicitly provide
`PNDS_CANDIDATE_BROWSER_SCRIPT`, `PNDS_PLAYWRIGHT_MODULE` and
`PNDS_BROWSER_EXECUTABLE`. The project-owned Node script receives the installed
directory and exact App resource root; it must isolate its ports/processes and
keep installed bytes unchanged. It runs before App repacking and the second
installation verify every source/asset hash. This remains controlled browser
evidence, separate from native App, physical audio and trusted-phone HTTPS.

Template, utility and work source changes are reviewed in their own repositories. Tool artifacts
must be produced and pinned by their existing release pipeline before changing
the App's utility registry; a local source checkout is not a fixed published
artifact. See [pnds-bundle.md](../zh-CN/reference/pnds-bundle.md) for the stable
Utilities resource paths and transport rules.

## Precompiled Preact works (ASBS #220)

ASBS 2.1.0 references only Express 5.3.0, qrcode 1.5.4, Socket.IO and its client
4.8.4. Its type-only client import does not embed another runtime in the Vite
bundle: each precompiled page loads the individual Host browser file through
the score server's same-origin route before its module entry. The complete
`dist/`, fonts and 684 score PNGs remain work-owned. It keeps audio mode `none`
and does not request HTTPS or add p5, ml5 or osc-min.

The controlled project tests cover startup without local dependencies, explicit
version failures without fallback, both listen-error paths and shutdown with
active clients. Chromium evidence exercises the actual precompiled pages and
all score assets, including the installed `.pnds` via the existing candidate
roundtrip test. These results do not replace native App and phone acceptance;
inputs, operations and remaining checks are recorded in
[the #220 acceptance record](../acceptance/220-asbs-shared-libraries.md).
