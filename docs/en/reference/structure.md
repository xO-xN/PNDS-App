# PNDS Project Structure

## What a Project is

A digital score project is a local directory that owns its performer, monitor, score server, OSC control, production dependencies and assets. See the [runtime contract](./runtime-contract.md) for page and message ownership.

## Directory layout

The root must contain `manifest.json` and its declared server entry. Add these files as the work requires.

| File or directory                    | Purpose                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `public/`                            | Performer and monitor assets                                       |
| `package.json`, `node_modules/`      | Production dependencies                                            |
| `supercollider/synthdefs/*.scsyndef` | Internal audio artifacts                                           |
| `pnds.recording.json`, adapter       | [Performance recording](./performance-recording.md) runtime assets |
| `README.md`, `cover.png`             | Performance introduction and cover                                 |

Carry runtime dependencies in the project or declare exact App shared references. The App supplies Node and scsynth. Runtime performs no dependency installation.

## Private creation data

`.pnds-creation/` holds project conversations, pending documents, integration recovery and recordings. Copy the whole project including hidden directories to carry this data. File tools, Git, default `.pnds` bundles and temporary runtime checks exclude the private directory and its aliases. Machine-local keys and task execution grants stay local.

See the [tutorial](../app-tutorial.md#carrying-and-recovering-performance-recordings) for recording storage and recovery.

## Project README.md (optional)

The root `README.md` travels with the bundle. See the [README guide](../readme-guide.md) for cover format, language variants and editing.

## Project compliance checklist

See [manifest](./manifest.md) for static validation and the [runtime contract](./runtime-contract.md) for runtime checks.

## App shared packages

`manifest.sharedLibraries` covers production dependencies with the same package name and exact version. Carry the remaining dependencies in the project. See [manifest](./manifest.md) for field validation and [p5.js](./p5js.md) for browser resource wiring.

## App-created project sources

The App creates [Blank](../template-guide.md#create-a-blank-project) with a new project identity and an initial Git version. `docs/template-source.json` records its source. `docs/implementation.md` describes the project files.
