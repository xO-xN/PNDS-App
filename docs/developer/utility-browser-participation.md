# Utility participation and delivery (#308–#311)

The four tools are separate repositories. Edit the maintenance trees in
`../PNDS-1.6.2-projects/`, never the older same-named siblings or generated
`src-tauri/resources/utilities/` output. The current Telematic source is the
v0.8.0 feature commit `e3a1b1355`; its internet-only diagnostics, local geography,
optional location metadata and HUB behavior supersede the spec's v0.7.1 input.

## Runtime and document ownership

Each adapted tool declares both `runtimePorts: 1` and
`browserParticipation: 1`. It adopts the Host's actual inherited listeners,
atomically reports binding and includes the actual ports/run identity in health.
The monitor role comes from the serving endpoint, never from the public port.
Without a Host assignment, standalone fixed-port behavior is retained.

Load `./__pnds/context.js` before application scripts. Project scripts, API calls,
Socket.IO paths and Sensor Meter's actual Worker/shared runtime/models remain
beneath the immutable confirmed prefix. Direct tool servers provide an empty
context script. Preparation follows the tool's usable control state or real
join/diagnostic snapshot; it does not establish capture permission, collected
samples, physical sound or a working internet HUB.

Shared-origin browser claims/configuration use the Host/project storage key.
Native contexts with `basePath: '/'` keep their existing legacy keys because their
private origins already isolate the Host and project; changing these keys would
discard existing native recovery. Admission, rejection and resets remain owned
by the tool. See [the common protocol](./browser-participation.md).

Multichannel's local monitor and phone use the same authoritative state and audio
engine. Server mutation order and versioned client snapshots prevent late replies
from restoring stale UI state. Channel trims default to unity, preserving the
previous sound until explicitly changed. Local Diagnostics retains real
probe/ack measurements. Telematic retains public HUB requirements and reports
offline conditions without inventing local internet measurements.

Sensor Meter keeps `needsHttps: true`, its trusted HTTPS path and explicit capture
gestures. Explicitly insecure pages cannot report granted capture merely because
a browser exposes API objects. Worker execution and model loading stay off the
page thread; models are local and their URL scope is checked against the Worker's
confirmed directory. The HTTP page explains its restriction without claiming
that an installed icon makes it secure.

## Published tools and fixed resource boundary

The existing per-tool `.github/workflows/package.yml` runtime allowlists define
package contents. Following explicit user authorization, the four maintained
repositories committed their adaptations and published tagged prereleases:
Multichannel 1.4.0, Local Diagnostics 0.7.2, Telematic 0.8.1 and Sensor Meter 0.4.5.
Each CI-produced artifact was compared with its committed runtime files, published
with `latest: false` and anonymously downloaded. `utilities.json` fixes the hashes
of these actual public bytes; a fresh-cache `utilities:fetch` stages those same
versions in `src-tauri/resources/utilities/`.

The initial local `.pnds` files and proposed registry under
`.cache/browser-utility-candidates/` remain historical unpublished candidates.
Their ZIP hashes differ from CI output and are not formal release pins. The
current released-package acceptance registry is
`.cache/browser-utility-published/candidates.json`, with `published: true`.

Future commits, tags, pushes and publication still require explicit authorization.
A local ZIP or tag name cannot establish an obtainable fixed release. Always
verify the public download, identity, source content and hash before changing
formal pins. Existing installed App binaries do not change when development
staging changes. Physical device acceptance is separate from public prerelease
availability.

Sensor Meter's model fetch verifies SHA256 and shard names before packaging.
When the pinned files and inventory already match, verification preserves
`PINNED.json` and its original `fetchedAt`; actual downloads or changed provenance
regenerate it. The copied real CLI regression prevents CI from changing committed
model metadata merely by verifying its cache.

## Verification

Each maintenance source runs `npm run check` and `npm test`; Sensor Meter also
verifies its pinned local models with `npm run fetch:handpose`. App checks remain
`npm run check:all`. Explicit installed-package and ordinary WebKit acceptance
tests read `PNDS_UTILITIES_CANDIDATES` and write evidence under
`PNDS_UTILITY_EVIDENCE_DIR`; they install the actual candidate bundles through the
production installer and start the production session manager.

The tests verify source/package/installed bytes, owned-port conflicts, public
confirmation, queried resources, native private sources, actual page readiness
and retired authorization. WebKit executes actual tool scripts and Sensor
Meter's Worker; controlled inputs do not certify real sensor capture. Multichannel
uses its declared Internal engine with output muted in the test. Physical sound,
real phone permissions/capture, WAN-disconnected venue operation and signed
arm64/Intel installations retain separate acceptance results.
