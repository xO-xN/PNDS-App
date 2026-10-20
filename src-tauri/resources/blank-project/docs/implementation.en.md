# Blank {{templateVersion}} implementation guide

The App has initialized this project, including its first local Git version.
Implement the current user request. Read the creator handoff for context;
its pending items require an explicit assignment before implementation.

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
assets when needed. The server serves only the public directory, with MIME and
`Cache-Control: no-store`. Save public files and refresh the monitor to load
them. Changes to the Node server or its imported audio code require restarting
the project. The App performs those actions only when the creator requests them.

There are no production dependencies. Use existing local assets or explicitly
adopt the App's fixed shared packages when required, then wire their local
routes/imports. Keep creation and performance offline. README is the work's
audience-facing introduction; keep implementation notes here.

## Adding an adjustable parameter

The monitor's preview plumbing is ready but starts with no parameters or controls.
In edit mode, the assistant completes all three steps, then publishes the saved
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
