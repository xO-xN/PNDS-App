# Stable public performance entry (#297)

The public HTTP listener belongs to the online App. Node naming and LAN
preparation may bind it while the session is idle; this does not acquire a
runtime lease, start Node or scsynth, or claim the Host activity gate. A Client
can still inspect/join a remote Host. The App-level `useHostEntry` hook runs
across Creation and Client presentation, independently of mounted popovers.

`commands::host_entry::sync_host_entry` reads the saved node identity and uses
the selected LAN IPv4 for the first real bind. `SessionManager` retains that
`HostEntry` for the App lifetime. After publication, opening controls, selecting
another project, changing roles or editing next-start preferences never replace
it. The first bound address remains authoritative; recovery after changing the
network/IP is outside this version's stable-address promise and requires an
explicit App restart. A node rename applies to metadata at an explicit public
project start, without changing the listener or stable Host identity.

`get_host_entry` is read-only. Its typed `PublicEntrySnapshot` distinguishes
`unbound`, `waiting`, `preparing`, `ready` and `error`, and includes only the URL
of the held native listener. Local readiness alone does not establish public
readiness: a public run must install its confirmed route and verify forwarding.
A Creation `StartRequest::private()` still runs the ordinary local runtime and
its separate performer test address, but never calls public `begin` or the
public forwarding probe. Stop revokes public routing and upgraded connections
before internal score ports are reused; it keeps the listener online with no
public performance. Entering Creation or Client does not publish a test run.
Creation's bottom network invitation uses that test's actual performer URL
instead of this waiting public entry. Its QR encoding is read-only and checks
the ready run generation and exact URL before and after encoding; it neither
calls public `begin` nor changes Monitor presentation. See
[network invitations](./network-invitations.md).

The existing port allocator remains the only authority. A fresh App reads
`participation-host-port.json`, attempts that number, and retains the successful
listener before publishing the URL or durably saving its actual port. An
address-in-use conflict may choose an OS port; `portChanged` records an actual
change from a nonzero saved preference, so the network panel and Node settings
show the full new URL and explain that saved entries need updating. Tests never
signal an unknown occupant. Runtime faults keep the held address and ownership,
remain visible and do not hot-migrate, repeatedly rebind or stop a healthy local
project/audio session. Existing explicit Stop/restart owns run-entry recovery.

The frontend polls the read-only snapshot every two seconds. Starting setup is
separate from these polls; an error poll cannot trigger allocation or repair.
The network popover and full Node settings render the same facts. The broader
QR/sidebar consolidation belongs to #303.

## Run verification ownership

`session/stable_entry.rs` owns public-entry verification for both startup and
the running watchdog. Callers select the phase and whether a periodic probe is
due; they do not assemble forwarding-health comparisons or fault cleanup.
Verification captures the run and expected health under the session lock,
performs read-only HTTP outside it, then rechecks generation, status and the
held entry before suspending forwarding and recording the failure. The entry
Arc survives Stop/restart, so matching that Arc alone cannot authorize a late
result to revoke the replacement performance. Revocation remains inside the
final session lock; unlocking after validation would reopen the same race.

Binding/name errors remain in `host_entry_error`, including failures with no
listener. Run verification/cleanup failures remain in `client_entry_error` for
the existing session snapshot and explicit recovery lifecycle. This does not
merge entry health with local project/audio health or change read-only polling.

## Verification boundaries

`session/stable_entry_tests.rs` exercises real HTTP metadata at the owned idle
listener, absence of local activity/processes, preference-edit stability, App
recreation, preferred-port reuse and a fixture-owned conflicting listener that
remains reachable. `session/runtime_ports_tests.rs` runs the actual managed Node
fixture through public start, Stop, private Creation and guarded Client inspect,
checking the same URL/Host identity and no public Creation performance. Its
entry-fault path checks that later reads/settings preparation retain the fault
and actual address while the managed local process remains healthy. Existing
HTTP/polling/WebSocket and actual service-port tests continue to apply.
The same fixture also checks that HTTP 200 with foreign forwarded health is
rejected at startup and while running. A real failed forwarding observation is
held across Stop and optional restart before application, proving that its late
failure cannot fault the waiting entry or replacement performance using the
same listener; public metadata, current health and child ownership remain intact.

`PublicEntryDetails.test.tsx` checks the App setup/typed-command boundary,
conflict feedback, no guessed URL, no project/audio/join start and read-only
fault polling. DesktopBar, NodeSection and App regressions cover existing
controls. These automated boundaries do not certify signed-App LAN reachability,
physical device media permissions, sound or cross-machine acceptance. The
browser protocol and ordinary waiting page are specified by #295, separately
from this listener lifecycle.
