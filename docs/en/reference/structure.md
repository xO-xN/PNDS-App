# The Structure of a PNDS Template Project

## What a Project is

A PNDS Project is a local directory the user explicitly chooses to open. The Project owns and implements:

- the score server entry;
- the performer page and the monitor/conductor page;
- its own network interactions and Socket.IO protocol (when used);
- its own OSC addresses, parameters and sound-control logic;
- the compiled `.scsyndef` files Internal mode needs;
- the local dependencies and static assets the production runtime requires.

A Project is not a PNDS App plugin and receives no Tauri API. High-rate performance messages must flow directly between the client pages, the Project's Node server and the audio target — never through the App's Rust/React layers.

## Directory layout

A Project root must contain:

```text
project/
├── manifest.json
└── <scoreServer.entry>
```

Depending on the Project's implementation, it may also contain:

```text
project/
├── package.json
├── node_modules/                 # required only when production dependencies exist
├── public/                       # performer / monitor static assets
├── audio/                        # the Project's audio and OSC control code
└── supercollider/
    └── synthdefs/*.scsyndef      # runtime artifacts for Internal mode
```

Take _Inarticulate III_ as an example:

```text
Inarticulate III/
├── manifest.json
├── server.js
├── node_modules/
├── public/
└── supercollider/
    └── synthdefs/
        └── inarticulate-iii.scsyndef
```

Rules:

- the App never runs `npm install`, and the runtime must not depend on network installs;
- when `package.json` declares non-empty `dependencies` or `optionalDependencies`, the Project must carry a working `node_modules/`; with no production dependencies, an empty `node_modules/` is not required;
- `.scd` belongs to authoring and debugging only and must not ship as an App-hosted runtime asset;
- a Project must not depend on the host machine having Node.js, SuperCollider, `sclang` or third-party UGens installed;
- official Projects should declare the Node major they were developed and verified against in `package.json` (e.g. `">=24 <25"`).

## Project compliance checklist

1. manifest required fields, modes, ports, outputChannels and bus-capacity validation;
2. containment and existence validation for every declared path;
3. a complete `node_modules` carried whenever production dependencies exist;
4. performer health returns ready per [runtime-contract.md](./runtime-contract.md) §5;
5. the monitor embeds and responds to resize correctly;
6. Internal output strictly honours the buses and channel count the App injects;
7. every resource the Project owns is released on SIGINT/SIGTERM;
8. an actual startup verification completed under the App's fixed Node runtime.
