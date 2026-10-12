# Ports inspection and release (#163)

Settings uses `selectSelectedPath` and reads the saved performance project's
ports through `getProjectPorts(path)`, including pending and failed-preflight
selections. This schema-only read performs no runtime preflight or cleanup. In creation
mode it reads the saved manifest through `getCreationManifest(identity)`; drafts
never affect diagnostic targets. With no target, use 6868/6869. Queries run on entry,
target change and manual refresh, with stale results discarded after target
changes or unmount. There is no timer or background polling. A release refreshes
both rows, including when the command fails or cancels.

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
