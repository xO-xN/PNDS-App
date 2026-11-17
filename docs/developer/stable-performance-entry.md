# Stable public performance entry (#297)

The public HTTP listener belongs to the online App. Node naming and LAN
preparation may bind it while the session is idle; this does not acquire a
runtime lease, start Node or scsynth, or claim the Host activity gate. A Client
can still inspect/join a remote Host. The App-level `useHostEntry` hook runs
across Creation and Client presentation, independently of mounted popovers.

`commands::host_entry::sync_host_entry` reads the saved node identity and uses
the selected LAN IPv4 for the first real bind. `SessionManager` retains that
`HostEntry` across starts, stops and role changes. Opening controls or editing
next-start preferences keeps the bound address while its interface remains
available. The LAN sync can recover a lost local address by rebinding an idle,
unshared listener on the newly selected interface. It retains the same node
identity and attempts the saved port. A saved node rename updates the metadata
and LAN announcement without replacing the listener.

`sync_client_lan` starts Bonjour browsing and, when the App has a named entry
on a usable interface, advertises it as `_pnds-score._tcp`. A Client can browse
even when its own listener cannot be advertised. A bounded TXT record carries
the stable node identity, name, role, applied address and current run status.
The local session updates the record on startup, readiness, failure and stop.
`get_client_lan_nodes` returns discovered peers and omits this App's own node.
Announcements are discovery hints. Native inspection verifies the selected
node and exact run against the participation endpoint before preview or entry.

`get_host_entry` is read-only. Its typed `PublicEntrySnapshot` distinguishes
`unbound`, `waiting`, `preparing`, `ready` and `error`, and includes only the URL
of the held native listener. Local readiness alone does not establish public
readiness: a participating run must install its confirmed route and verify
forwarding. An explicitly started Creation test uses the same native route.
Native metadata selects that view with `X-PNDS-Native-Client: 1`. The ordinary
browser landing and confirmation continue to advertise Host performances.
The fixed README and cover endpoints require the exact current Host, project
and performance context. They serve bounded snapshots of the saved project
introduction and its raster cover, taken from within the running project root.
Stop revokes routing and upgraded connections before internal score ports are
reused and keeps the listener online. Entering Creation or Client leaves the
entry waiting until a compatible run is started. Creation's bottom network
invitation uses the test's actual performer URL. Its QR encoding is read-only
and checks the ready run generation and exact URL before and after encoding.
See
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

The Host verifies the public route during startup before reporting the entry
ready. After startup, the watchdog treats transport failures and HTTP 408,
429, and 5xx responses as transient. It suspends forwarding after three
consecutive transient failures from scheduled probes and records the final
failure in the entry details. A successful scheduled probe clears the count.
Listener failure, invalid metadata or health data, and mismatched run identity
or health suspend forwarding immediately. The local project and audio have
their own supervision.

The probe uses the public listener and follows the same metadata and
context-gated health routes as before. The listener reserves bounded capacity
for connections from the Host's own address so that connections from remote
devices cannot consume every slot available to the probe.

Binding/name errors remain in `host_entry_error`, including failures with no
listener. Run verification/cleanup failures remain in `client_entry_error` for
the existing session snapshot and explicit recovery lifecycle. This does not
merge entry health with local project/audio health or change read-only polling.

## Verification boundaries

`session/stable_entry_tests.rs` exercises real HTTP metadata at the owned idle
listener, absence of local activity/processes, preference-edit stability, App
recreation, preferred-port reuse and a fixture-owned conflicting listener that
remains reachable. `session/runtime_ports_tests.rs` runs the actual managed Node
fixture through public start, Stop, native-only Creation and guarded Client
inspect. It checks the same URL and node identity, localized README, cover,
stale-run refusal and the waiting browser entry. The opt-in
`npm run rust:test -- --lib bonjour_local_only_observes_registration_update_and_removal -- --ignored`
exercises service registration, TXT updates and removal through the system
Bonjour daemon using a local-only service. The session test's
entry-fault path checks that later reads/settings preparation retain the fault
and actual address while the managed local process remains healthy. Existing
HTTP/polling/WebSocket and actual service-port tests continue to apply.
Regression tests exercise public-route probes under connection pressure and
verify that a transient forwarded-health failure preserves the running entry,
that a successful probe resets the failure count, and that sustained failure
still suspends the entry.
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
