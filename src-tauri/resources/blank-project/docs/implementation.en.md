# Blank {{templateVersion}} implementation guide

The App has initialized this project, including its first local Git version.
Implement the current user request. When assigned the creator handoff, follow
the AGENTS entry point for all current tasks. Maintain this guide as the project changes.

## Where to edit

| File                                           | Purpose                                                    |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `public/monitor.html`                          | Monitor markup and script entry                            |
| `public/monitor.js`                            | Score drawing, monitor interaction and parameter callbacks |
| `public/performer.html`, `public/performer.js` | Performer markup and interaction                           |
| `public/style.css`                             | Initial shared styles; split by page when needed           |
| `pnds.preview.json`                            | Exact tunable literal declarations; initially empty        |
| `public/pnds-preview.mjs`                      | Shipped local preview protocol adapter                     |
| `server.js`                                    | HTTP resources, health, script snapshots and lifecycle     |
| `audio/controller.js`, `supercollider/`        | Audio and OSC implementation; initially silent             |

Keep HTML, JavaScript and CSS in their respective files. Add shared code and
assets when needed. The server serves public files and the local Socket.IO client, with MIME and
`Cache-Control: no-store`. Save public files and refresh the monitor to load
them. Changes to the Node server or its imported audio code require restarting
the project. The App performs those actions only when the creator requests them.

Socket.IO 4.8.4 is the only initial production dependency, supplied by the App's
exact shared reference. The server loads its injected absolute entry. Both pages
load `/socket.io/socket.io.js` locally and connect with `io()` to their own origin.
The server owns one Socket.IO instance per HTTP port, available through
`realtime.get('performer')` and `realtime.get('monitor')`. A connection receives
`pnds:connected` with the project ID and server-assigned role. Add piece handlers
in the server's connection callback and use the page's `socket` for events.
For example, a monitor handler can call `realtime.get('performer').emit(...)`.
Socket IDs identify connections; adopt the players module when persistent
performer identity or seats are needed. No piece messages or sound mapping exist yet.

Internal is the default: the audio controller and compiled SynthDef produce
silence on the injected private buses. External and None remain available.
Keep these three audio files together when replacing the placeholder.

Adopt other fixed shared packages only when the task needs them, then wire local
routes/imports. App playback stays offline and needs no npm installation.
Standalone development can install the exact package.json dependency locally;
Internal still requires the Host's audio environment.

README.md starts in the creation-time language and contains the creator's actual
introduction, initially empty if omitted. Add language variants when requested.
The App creates docs/creator-handoff.md when a handoff is recorded; a new Blank
has no pending tasks. Keep implementation notes here and audience-facing text
in README. The project .gitignore also applies to external Git tools; runtime
assets, SCD sources and compiled SynthDefs remain versioned.

## Adding an adjustable parameter

The monitor's preview plumbing is ready but starts with no parameters or controls.
In Work mode, the assistant completes all three steps, then publishes the saved
controls. For a title-size task, for example:

1. Define the actual mutable value in `public/monitor.js`, apply it to the page,
   and replace `previewParameters` with real callbacks:

   ```js
   let titleSize = 48 // px
   const renderTitleSize = () => {
     document.querySelector('h1').style.fontSize = `${titleSize}px`
   }
   renderTitleSize()
   const previewParameters = {
     titleSize: {
       kind: 'number',
       limits: { min: 12, max: 120, step: 1 },
       get: () => titleSize,
       set: value => {
         titleSize = value
         renderTitleSize()
       },
     },
   }
   ```

2. Register the same ID, kind, limits and exact whole-line anchors in
   `pnds.preview.json`, preserving other entries:

   ```json
   {
     "schemaVersion": 1,
     "parameters": [
       {
         "id": "titleSize",
         "path": "public/monitor.js",
         "prefix": "let titleSize = ",
         "suffix": " // px",
         "kind": "number",
         "limits": { "min": 12, "max": 120, "step": 1 },
         "preview": "live"
       }
     ]
   }
   ```

3. Save, run available checks, and expose the native-bound saved parameter.
   Refresh the saved monitor once before previewing newly saved code. Dragging
   is temporary; Save parameters persists adjustments with task undo. Ending
   preview restores the runtime baseline, not elapsed musical time.

Keep the monitor's script reference: the server pins `public/monitor.js` bytes
for each page and embeds their digest with the exact declaration digest. An
old page remains bound to its loaded version after another save. If parameters
move into additional files, extend their actual load snapshots and callbacks
too. Hashing later disk bytes cannot prove they were loaded. Callbacks should
apply declared values to real state and redraw paused scores when necessary;
audio callbacks use only the project's already enabled audio.

Static checks remain available during a performance. An occupied runtime blocks
the independent runtime check without stopping the project. Verify actual visual
and audio behavior separately. Platform contracts are linked from `AGENTS.md`.
