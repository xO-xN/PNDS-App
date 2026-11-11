# Rust Architecture

## Module Structure

`lib.rs` wires services and cleanup. `commands/` delegates typed requests to
the owning service. [Tauri commands](./tauri-commands.md)

| Boundary               | Native owners                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Runtime and audio      | `project::session`, `project::children`, `project::audio`, `project::runtime_gate` |
| Creation and tools     | `project::creation`, `creation_data`, `synthdef`                                   |
| Assistant              | `model`, `assistant_history`, `project::creation::assistant_tasks`                 |
| Participation          | `participation_host`, `participation_client`, `project::session::stable_entry`     |
| Project pages          | `client_score_view`, `project_media_view`, `performer`, `window`                   |
| Recording              | `recording`                                                                        |
| Project resources      | `project::shared_libraries`, `project::bundle`                                     |
| Network infrastructure | `gateway`, `https`, `dns`                                                          |

## Type Patterns

- Keep records and validation with their domain owner. Use `types.rs` for shared App records and validate at the native boundary.
- Derive serde and specta types for IPC records. Use a tagged error enum when the frontend branches by error kind. [Error handling](./error-handling.md)
- Pass a record for related inputs that cross several layers, as in `StartRequest`. Keep the IPC arguments at the command boundary.

## Supervised Child Processes (children.rs)

Use `SupervisedChild` for owned long-running processes. It records ownership
and supervises bounded shutdown. Confirmed exit clears the record. Unconfirmed
exit keeps the record for targeted orphan cleanup.

Use `spawn_deferred` and `register()` for a scsynth child whose ownership record
must wait for boot to succeed. Use `terminate_pid_escalate_checked` for a
managed PID without a held child handle. A finite sclang compile uses
`Command` with output capture. [Runtime contract](../en/reference/runtime-contract.md)

## Session State Machine (session.rs)

`SessionManager::transition` checks the generation and legal transition,
applies the mutation and publishes the snapshot under one lock. Opening moves
into Starting, Stopping or Idle install the next generation. Steady moves use
the current generation. Tests can observe real synchronous snapshot delivery
through `app_with_snapshot_recorder`.

- Startup's health deadline applies through every `starting` response. Once ready, loss of the score server or App-owned scsynth uses the same generation-checked cleanup. [Runtime health](./runtime-health.md)
- Keep child handles until confirmed teardown. Unresolved ownership blocks new run admission even when known handles are clean or alternative ports are available. Preflight exempts live-session PIDs.
- Internal start enumerates current CoreAudio devices before resolving device and channel plan. Device capability caching serves preflight and inspection. Failed enumeration invalidates cached facts.
- Bundle installation stages and validates before final publication through `with_inactive_project`. Hold the session lock through the rename. Active aliases, unresolved active roots and incomplete cleanup block publication. Extract and remove old trees outside the lock.

## Platform-Specific Code

Keep AppKit code with its owning feature and guard platform entry points with
`#[cfg(target_os = "macos")]`. Register the single-instance plugin first.
Window-state restoration uses `window::persisted_state_flags`.
[Plugin setup](./tauri-plugins.md)
