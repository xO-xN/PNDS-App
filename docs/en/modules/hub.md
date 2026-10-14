# Hub connection and remote nodes

v1.6.1 provides the optional `hub` module. Creation mode's “Add PNDS module” copies frozen sources, `compatibility.json`, a bilingual wiring README and provenance into `modules/pnds-hub/`, then records a pending wiring handoff. Offline addition does not require a Skill; an external agent handles dependencies, configuration and wiring against the actual project.

## Configuration and objects

For a project declaring telematic capability, the Host's existing configuration gate injects `PNDS_NODE_ID`, `PNDS_HUB_URL`, `PNDS_HUB_TOKEN` and `PNDS_HUB_ROOM`. The room derives from the project id and group number. Never hardcode an example room or expose tokens in pages, logs or handoffs. See the [runtime contract](../reference/runtime-contract.md) and [network reference](../reference/network.md).

A remote node is a running project instance at another site, usually a site's Mac. Local phones still connect to their site's performer service. Node counts have a different meaning from project-defined role or performer summary counts.

## Wiring and lifecycle

Use the added README and the public interfaces of the same source version. The project provides event callbacks, a local summary, remote summary presentation and optional work snapshot adapters. Authors choose event names, payloads, roles and sound allocation. The technical module handles connection, reconnect, heartbeat, summary expiry and echo filtering, exposes observable status, and releases connections and timers on stop.

Configure heartbeat and expiry for the project. Show unreachable hubs, authentication rejection, disconnection and recovery accurately in the monitor. Remote failure must not block local performer joining or controls, and expired summaries must not stay online indefinitely. The module does not arbitrate work progress, cross-site sound synchronization or how a work continues after disconnection.

## Verification and maintenance

Check same-room events between two nodes, room isolation, authentication rejection, fresh remote summaries, reconnect and stop cleanup. Also check local controls with an unreachable hub. Connection success does not establish sound or performance acceptance; record real-device checks separately.

`pnds-module.json` records the actual added version and source hashes; copied sources belong to the project. App updates preserve existing content. An external agent reviews references, dependencies and behavior when dealing with customization, unknown provenance, upgrades, merges or removal. Record file addition, wiring, runtime, sound and distribution separately.
