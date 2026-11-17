# Architecture Guide

PNDS hosts digital score projects and provides a workspace for creating them.
In Performance, Host runs a local project and Client joins a Host. Creation
works on a trusted project directory and can continue an existing local run.
[App behavior](./app-behavior.md) · [Performance roles](./performance-participation.md)

## Ownership

| Area         | App owns                                            | Project owns                                          |
| ------------ | --------------------------------------------------- | ----------------------------------------------------- |
| Runtime      | Processes, listeners, health and audio devices      | Server, monitor and performer pages, musical behavior |
| Presentation | Windows, page navigation and permissions            | Score layout, interaction and project media           |
| Recording    | Records and common time                             | Work data and replay effects                          |
| Creation     | Workspace access, task grants and resource adoption | Source files, module wiring and saved revisions       |

Browser admission and the loaded page have separate lifetimes. Managed project
WebViews bind permissions and messages to the current source, role and runtime.
Tauri capabilities belong to App shells. Assistant writes require a current
task grant and matching file versions.
[Runtime contract](../en/reference/runtime-contract.md) · [Native media](./native-project-media.md) · [Assistant](./creation-assistant.md)

## Code Map

- `src/components/` renders App views. `src/lib/` holds orchestration and adapters.
- `src/store/` holds shared UI state and mirrors native facts. Persist preferences through the serialized queue. [State management](./state-management.md)
- React calls typed Tauri commands. Rust publishes events for frontend mirrors. [Command bridge](./tauri-commands.md)
- `src-tauri/src/` owns native services and cleanup. [Rust architecture](./rust-architecture.md#module-structure)

The main shell, help, projection and performer test windows have independent
lifetimes. Layout changes preserve the loaded monitor.
[Window behavior](./app-behavior.md#window-与全屏)
