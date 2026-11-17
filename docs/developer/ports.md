# Ports inspection and release (#163)

Settings reads the selected saved declaration through `getProjectPorts(path)`
(using `selectSelectedPath`, including pending/failed selections), or through
`getCreationManifest(identity)` in Creation. This schema-only read performs no
runtime preflight or cleanup; drafts never retarget it. During a live run,
`SessionSnapshot.appliedPorts` owns the diagnostic rows and the selected saved
values appear separately as next-start preferences. Without a run or target,
use 6868/6869. Queries run on entry, target/run changes and manual refresh;
unrelated snapshots do not poll. Stale results are discarded after target changes
or unmount. A release refreshes both rows even on failure or cancellation.

`checkPortStatus(port)` returns the listener's PID, executable name and untruncated
command line, plus a birth-time identity token. macOS obtains that token through
`proc_pidinfo(PROC_PIDTBSDINFO)` using the kernel's second and microsecond fields
([Apple's process information structure](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h)).
Inspection failures surface as query errors, never as availability.

`managedByApp` comes from actual `SupervisedChild` handles and the Host's own PID.
The in-memory handle registry spans deferred boot, supervision and teardown,
including when a child is outside `SessionInner`. The spawn/ownership lock also
covers each foreign-process identity check and signal; the grace wait holds
neither that lock nor the session lock. This registry is separate from the
persisted orphan registry and does not change orphan cleanup.

The session retains the performer/monitor ports applied at start.
`runningProject` is attached only when a real managed listener holds one of those
applied ports. A later selection or saved manifest edit cannot relabel another
port as running. Managed rows show their identity and ask the operator to close
the project; they offer no direct Release action.

Both Settings and the startup error page use `PortReleaseConfirmation` to repeat
the PID, name and full command line. `releasePort(port, confirmed)` requires that
identity, including its birth token. Before SIGTERM and before SIGKILL it checks
the current listener, full identity and actual managed ownership. A disappeared
listener, changed identity or managed process cancels without signalling that
target. The existing bounded two-second foreign-process grace/escalation policy
remains shared in `children.rs`.

The typed result is `{ outcome: released | cancelled | failed, status }`.
Cancellation refreshes the visible truth and reports why another confirmation
is required. The error page retries only after `released` with no remaining
occupant and the initiating project/error/run still current; cancellation or a
selection/runtime change never starts another project. Rust commands stay thin and the
Rust change ships with regenerated TypeScript bindings.

Tests use the established App/typed-command seam and real controlled listener
processes on ephemeral loopback ports. The fixture owns and reaps every process
it signals. Coverage includes replacement and disappeared occupancy, birth-time
and command changes, graceful and forced exit, cancellation before escalation,
direct command protection, applied runtime A versus selected B, and handles
moved out during teardown. No unrelated live process is a test target.

## Managed runtime listeners (#259)

`scoreServer.runtimePorts: 1` selects explicit App-owned listener handoff; all
other valid legacy manifests retain fixed-port conflict failure. Unknown declared
versions fail schema validation. `project/runtime_ports.rs` owns the two real
listeners, independent role/port/fd assignment, fresh run nonce and bounded private
startup report. Only the fork child clears CLOEXEC. SessionInner owns listeners
before spawn; its lifecycle lock covers child installation and transfer. The
report must precede health and match the child’s actual listener ownership. Health
then verifies the nonce, project/audio identity, actual ports and audio readiness.
The manifest bytes never change. Controlled checks use the same handoff on their
owned temporary project copy.

`SessionSnapshot.appliedPorts` publishes actual bound service ports. It is a
run fact, distinct from a selected manifest or later edit. Ready consumers use
that assignment and verified health; the HTTPS gateway retains its explicitly
configured external port and uses the actual performer upstream. New Host entry
instances try the durable last bound port in `participation-host-port.json`, then
bind an OS alternative only on address-in-use; the complete actual entry URL is
published. Existing entry/run identity fences and revocation still apply.

The public-start Node fixture exercises occupied preferred ports, listener
handoff, report rejection, foreign health identities, cancellation before report,
HTTP resources/query strings, real Socket.IO polling and WebSocket echo, stop,
retry and old-confirmation rejection. It owns all children/listeners; unrelated
processes are never test targets. The native Client origin/storage PoC is a
separate requirement; passing these core tests does not certify macOS WebView
storage migration, two-machine reachability, permissions or sound.

The Client-facing Host entry verifies the complete confirmed-context HTTP health
path before being offered. `SessionSnapshot.clientEntryError` is independent from
local `ready`: startup admission or forwarding failure suspends and revokes the
entry, retaining ownership and its actual address while local Node/audio continue.
The running watchdog checks listener failure and verifies forwarding every two
seconds. A fault closes HTTP/WS connections and remains visible; it neither picks
a new port nor hot-recovers. Explicit stop/restart owns recovery. A late probe
cannot suspend a newer run on the same entry because suspension shares the
session generation lock. Host chrome retains the bound address for diagnosis,
disables inviting/copying it, and explains that local performance continues.

Darwin permits a wildcard SO_REUSEADDR listener alongside an earlier specific
loopback/IPv6 listener. Allocation therefore diagnoses occupied preferred numbers
across interfaces, holds each real bind, and checks its actual owner before
handoff. If a foreign explicit bind wins that gap, the App drops only its own
listener and performs a bounded reallocation. Inspection errors fail visibly.
The child report rechecks ownership after handoff. These diagnostics are never
claimed to reserve a port. An independently owned Node occupant regression proves
that both original services keep their PID and remain ready after App start/stop;
IPv6-only numeric occupancy is also covered.

## OSC source sockets and audio UDP targets

Internal scsynth receives a dynamic loopback UDP target. The temporary
`allocate_udp_port` probe releases its socket before the audio process binds;
that probe does not reserve the target. `OscClient::connect` also needs its own
UDP source socket, and the OS can otherwise assign it that same released target
before scsynth starts listening.

After connecting, the OSC client compares the complete local and peer addresses.
For an exact self-target, it keeps the original socket bound while allocating and
connecting one replacement source socket, then releases the original. Holding
that socket until replacement allocation is complete prevents the client's own
allocator from choosing the audio target again. Equal port numbers on different
IPv4 hosts are preserved. There is no retry loop or change to audio-process
ownership, startup/cleanup order, External target handling or None behavior.

The deterministic regression creates a real UDP self-loop, observes its echo,
asserts the target remains bound inside replacement allocation, then binds a real
audio-target listener and receives the client's actual OSC bytes. This prevents
self-competition only; it does not reserve the released target against unrelated
processes or claim that all external bind races have been eliminated.
