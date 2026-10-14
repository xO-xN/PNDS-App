# The Structure of a PNDS Template Project

## What a Project is

A PNDS Project is a local directory the user explicitly chooses to open. The Project owns and implements:

- the score server entry;
- the performer page and the monitor/conductor page;
- its own network interactions and Socket.IO protocol (when used);
- its own OSC addresses, parameters and sound-control logic;
- the compiled `.scsyndef` files Internal mode needs;
- the Project's own production dependencies and static assets.

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
├── node_modules/                 # required for production dependencies not covered by exact shared references
├── public/                       # performer / monitor static assets
├── audio/                        # the Project's audio and OSC control code
├── README.md                     # optional project self-description (next section)
├── cover.png                     # optional cover image (conventions below)
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
- a production dependency in `package.json` (`dependencies` or `optionalDependencies`) is covered by an App shared package only when its package name and exact version match a `manifest.sharedLibraries` reference. Ranges, different versions and unreferenced packages still require working local `node_modules/`. Self-contained Projects carry all production dependencies; with none, or with all covered by exact references, an empty `node_modules/` is not required;
- `.scd` belongs to authoring and debugging only and must not ship as an App-hosted runtime asset;
- a Project must not depend on the host machine having Node.js, SuperCollider, `sclang` or third-party UGens installed;
- official Projects should declare the Node major they were developed and verified against in `package.json` (e.g. `">=24 <25"`).

## Project README.md (optional)

The `README.md` at a Project's root is the self-description written for **people at the performance venue** — and it has two audiences: the **preparer at the sidebar** (the App renders it in the README panel whenever the Project's card is selected, since v1.5.0) and the **audience on the venue screen** (the projection window shows the very same file as its intro before the projection start). The audience side adds a writing constraint: the first section goes up on the big screen, so it must **not spoil the score's visuals, structure, or key interactions**; length and bilingual-section advice, with an example, lives in "Writing a Project README" in Help. A Project without one simply shows an empty state — **preflight never checks it**: it is documentation, not a compliance condition.

Conventions:

- plain markdown; GFM tables and fenced code blocks render, raw HTML never does;
- keep it small (an oversized README is refused rendering with a readable note);
- it travels inside the `.pnds` verbatim (the packing exclusion list never subtracts it) — what the receiving machine sees in the App is exactly this file.
- optional language variants: `README.<locale>.md` (e.g. `README.zh-CN.md`) — the App auto-selects the variant matching its UI language and falls back to the plain `README.md`;
- optional cover image `cover.png`: the README panel band's screenshot of the work (probed in order `.png` → `.jpg` → `.jpeg` → `.webp`, language-agnostic, 1:1 recommended); it travels inside the `.pnds` verbatim like README.md, and preflight never checks it;
- cover-page format: a README may carry a metadata block at the top (`title` / `composer` / `composer_url` / `github_url` / `website_url` / `color_palette`), from which the App renders its first `##` section as the designed cover page (the panel's content ends at the first `---`); a README without the metadata block renders as a plain document — legacy projects are unaffected. See "Writing a Project README" in Help;

Recommended outline (work title, author, intro, how to perform, optional technical needs):

```markdown
# <Work title>

**Author**: <name / ensemble>

## Intro

<What this work is, its instrumentation, its duration — a paragraph
for the performance operator>

## How to perform

<How to start and operate it: page assignments, interaction
gestures, things to watch for>

## Technical needs (optional)

<Audio mode, external equipment, networking — whatever the venue
must prepare>
```

For the full writing guide see "Writing a Project README" under the Help center's Creator Guide. Do not confuse this file with the **performance folder's 自述**: that one is the folder intro written through the App's in-app form (stored structurally and synthesized into the setlist export directory's `README.md` on export) — a different species from this file.

## Project compliance checklist

1. manifest required fields, modes, ports, outputChannels and bus-capacity validation;
2. containment and existence validation for every declared path;
3. App shared package references checked against the same package name and exact version, with complete local `node_modules` for all other production dependencies;
4. performer health returns ready per [runtime-contract.md](./runtime-contract.md) §5;
5. the monitor embeds and responds to resize correctly;
6. Internal output strictly honours the buses and channel count the App injects;
7. every resource the Project owns is released on SIGINT/SIGTERM;
8. an actual startup verification completed under the App's fixed Node runtime.

## App shared packages

Projects may explicitly reference fixed App libraries through
[manifest.json](./manifest.md) schema 2. Shared files remain in the App and are
never copied into the project. Author pages, standard module sources, models,
weights, score assets and audio stay project-owned. Self-contained projects
continue to use their own dependencies. References do not rewrite local
`require` calls or browser CDN URLs; authors or external agents must wire and
validate them using the [runtime contract](./runtime-contract.md) and
[p5 example](./p5js.md). A reference change also updates the project version;
missing exact resources never fall back to another version.

For precompiled Preact works such as ASBS, retain the built `dist/` pages,
fonts and every score asset. ASBS 2.1.0 uses only shared Express 5.3.0,
qrcode 1.5.4 and Socket.IO/server-client 4.8.4; it loads the client's browser
file through a same-origin score-server route before the compiled page entry.
Its audio mode remains `none`. Adding shared references does not introduce p5,
ml5, osc-min or a secure-context requirement. Validate real pages and controls
again after packaging and installation; health alone is insufficient.

## App-created project sources

Blank and PNDS Classic are fixed creation starting points. Both initialize an
independent manifest identity and version 0.1.0; Classic initializes its client
storage key too. `docs/template-source.json` records the starting source and
version separately from optional module addition records. This authoring record
is not a runtime manifest field and root docs are excluded from `.pnds`.
Opening an existing project preserves its identity and Git history. A Host
update never automatically updates a project's original template source.
See [the creator guide](../template-guide.md) for creation and offline requirements.
