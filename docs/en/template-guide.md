# PNDS Template Creator's Guide

This guide walks you through creating, developing and publishing a PNDS Project from scratch, based on the PNDS Template.

---

## Creating from Blank or PNDS Classic in the App

Creation home and Switch to another project offer **New project**. Enter the work name, folder name and optional creator and
description, then choose an existing parent folder. The App creates one new
editable folder and never replaces an existing file or directory.

Uppercase English letters in the folder name become lowercase automatically;
the preview shows the directory that will be created. The work name keeps its
own spelling. Empty names, unsupported characters and leading/trailing hyphens
show an inline explanation; fix the folder to enable creation. Folder names are
limited to 64 characters.

The next new-project form remembers your last selected parent, including after
an App restart. Cancelling the form or native picker keeps that choice. If the
remembered folder was removed or is no longer accessible, creation reports the
actual error; choose a new parent to retry.

**Blank** is the only new-project starting point. It supplies a minimal runnable
structure without an artistic preset. Express 5.3.0 handles restricted HTTP
routes, Socket.IO 4.8.4 provides realtime connections, and osc-min 2.1.2 encodes
and decodes OSC. All three use the App's exact verified shared resources offline;
creation never installs npm packages or downloads missing runtime resources.
Pages, scripts and styles are separate. The local parameter preview adapter,
empty parameter declarations and actual loaded-source snapshot remain available.
Internal writes silence to the injected private buses; External sends no
piece-specific messages until you define a protocol. SCD source and its matching
compiled SynthDef are included. Test Internal, External or None manually after
creation; phone behavior and real sound require your own device verification.

Existing Classic, Template-derived and self-contained projects remain supported:
open their folders or install their `.pnds` bundles as before. Their source,
identity, version history and artistic choices are not migrated or overwritten.
The independent PNDS Template maintenance source remains available.

New Blank projects support the unified browser / PNDS Client entry. Performers
explicitly enter each performance; resources and realtime connections use that
confirmed entry. Preparation remains separate from project admission. HTTP gains
no secure-context APIs, and existing HTTPS access remains available.

Each creation receives an independent project ID and initial Git version,
even for equal folder names under different parents. The project starts at
version 0.1.0 without inherited history or device caches. Provenance is recorded
in `docs/template-source.json`. App-created projects are already initialized;
external agents continue through AGENTS and the creator handoff without rerunning
`docs/start.md` initialization. Opening an existing project preserves its identity
and history. Updating the App never rewrites a previously created project.

Blank's initial README.md uses the creation-time App language and contains only
the supplied introduction, empty when omitted. Other UI languages fall back to
it. Add language variants when needed; creation adds no translation task or
handoff file. The App creates docs/creator-handoff.md when a handoff is recorded.
AGENTS points to the implementation guide and installed App contracts. Handoffs and provenance stay in source;
root docs are excluded from `.pnds`. Generated `docs/implementation.md` explains
which files to edit, how to register actual preview callbacks, and when to refresh
or restart. Public HTML/JS/CSS changes need save and refresh; Node server changes
need a project restart. Dependencies such as p5 are added locally when a task
needs them. Existing projects keep their layout and recorded template version.
After editing SCD, compile it in the App
with the required local SuperCollider setup.

Cancelling the picker, form or draft-discard confirmation preserves the old
workspace and running test. Directory conflicts, permissions and partial
creation failures publish no incomplete project. If the complete folder was
created but workspace adoption failed, the error names its location so you can
open it later. Success enters the workbench **without starting** and places the
project first in performance Home. Returning to performance requires manual
selection and load; the entry is remembered across App restarts.

## App local versions and history

For saving, inspecting and restoring project versions, see [Project versions and history](./app-tutorial.md#project-versions-and-history). Record a version at a creative milestone. Inspecting history leaves current files unchanged; switching versions changes project content. A Git version is distinct from a handoff comparison baseline and does not certify runtime or sound.

## Prerequisites

Before you start, make sure your machine has:

- **The latest PNDS App**: installed and running
- **Node.js 24**: needed for development tools outside the App or installing project-owned dependencies; the App includes its runtime.
- **SuperCollider**: needed when changing SCD and compiling SynthDefs; precompiled App-created starting points can be tested directly.
- **Git and an editor**: the App supplies local Git and a text editor; use external tools for remote collaboration or more advanced development.
- **An AI coding agent**: recommended alongside — DeepSeek Harness, ZCode (GLM) and similar agents work well

---

## 1. Creating and initialising a Project

1. **Create a repository from the template**
   Visit the [PNDS Template](https://github.com/xO-xN/PNDS-Template) repository on GitHub, click **Use this template** → **Create a new repository** at the top right, and generate your own project repository.

2. **Clone the Project locally**
   Copy the Git URL from the new repository and clone it via your terminal or IDE:

   ```bash
   git clone <your-repo-url>
   ```

3. **Read the Project documentation**  
   Open the Project in your editor: the root `README.md` is the overview; `docs/implementation.md` (the implementation manual) covers what the template's example work does and where to change things; `AGENTS.md` is the entry point for AI coding agents — agents read it automatically and use it to look up the platform contract docs (reading the local help corpus shipped with the installed App first). Ports are declared in `manifest.json`; see the port section of [the Reference Manual · manifest](../reference/manifest.md) for conventions and advice.

**A second path: porting an existing work**  
Starting from the template is not the only way: if you already have a work in OpenProcessing (p5.js) + SuperCollider + TouchOSC form, hand it to an AI agent with the **pnds-port** skill from [pnds-agent-skills](https://github.com/xO-xN/pnds-agent-skills) — it ports the whole thing into a PNDS Project in one shot (a complete Project directory plus its `.pnds` bundle), and you continue with the workflow above.

---

## 2. The authoring and iteration workflow

PNDS recommends discussing the idea and implementation in **PNDS creation assistant → Discussion**, then choosing an external coding agent or built-in Work and returning to the App to check sound, visuals and performer interaction:

- **AI-driven development**
  Import the Project directory into your AI coding agent; for an App-recorded handoff, paste Copy prompt from its chat reply to carry the exact task and revision. Guide the AI through conversation to understand the score's interaction logic, audio and visual rendering rules, and communication protocols, and let it write or refactor code quickly. The Project's built-in `AGENTS.md` routes the agent to the platform contracts and module manuals — no manual doc feeding needed. For an uninitialized template cloned outside the App, just tell the agent the canonical trigger — **"start a new piece"** in English, **「开始新作品」** in Chinese; whichever you say sets the working language — and it follows the Project's built-in `docs/start.md` to initialise (work name / author / description in place, version reset, install and tests green).
- **Live loading and preview**
  While authoring, load the local Project directory in PNDS App at any time to test interaction response, audio-visual behaviour and multi-device sync on the spot; the **Open in default browser** and **Refresh the monitor view** buttons at the top right of the sidebar help during development.
- **Continuous verification and fine-tuning**
  Iterate in small steps: verify the effect in the App immediately after each change, and keep every module behaving as intended.

### Adding an optional hub through chat

In Work, describe the existing hub and the project events to connect. The assistant groups the hub capability and necessary dependencies. One “Add and continue” decision resumes the original task to complete adoption, configuration, event and shutdown wiring, then check the saved result. Existing exact resources are reused. Version conflicts and unsaved drafts are preserved and reported without silently changing versions or replacing customized source. See the [hub module manual](./modules/hub.md) for boundaries and integration requirements.

Ordinary additions no longer offer `socket.io-client` or `qrcode` independently. Existing references remain visible, and the resource rule automatically groups hub's required client. The App continues to provide QR codes. Hub is not added to Blank by default and creates no central relay. Actual public-network, device and sound behavior still needs real-world verification.

### Selecting the work's connection protocol

When adding or changing phone interaction, QR or browser connections, the authoring agent first reads the two declarations in [manifest.md](./reference/manifest.md) and [runtime-contract.md](./reference/runtime-contract.md) §15, then inspects the browser APIs actually used:

1. Ordinary touch, phone participation and QR joining use HTTP. `supportsPerformerUrl: true` preserves the ability to consume the Host's full URL only.
2. Declare `scoreServer.needsHttps: true` only when the work's ordinary browser participants actually need secure-context APIs such as motion sensors, camera or microphone; record the API and reason. The Host selects HTTPS when adaptation is declared, the global switch is on and material validates. Native Host monitor, Client and creation performer pages use trusted first-party media sources without requiring the whole HTTP venue to switch to HTTPS.
3. QR, copied address and browser config consume one Host-selected URL, with injected `PNDS_PERFORMER_URL` taking priority. Page scripts and Socket.IO use the current performer origin.
4. Record the requirement assessment, declarations, actual URL and QR/connection evidence in the creator handoff. Verify HTTP for ordinary projects. For secure-context works, the author also verifies trusted HTTPS, browser permissions and actual device capabilities. Keep unfinished device checks explicitly pending.

When wiring native media, retain manual enablement, retry after denial, current
input selection and page cleanup. Only the main monitor initializes monitor
capture and models; projection subscribes to project results when `surface=venue`
or `PNDS_MEDIA_SURFACE.captureAllowed === false`. Performers may enable their
own inputs. A device-sharing failure must not take another window's device;
network suspension does not end its document. See the
[native media runtime contract](./reference/runtime-contract.md#native-host-monitor-and-creation-performer-media).

The creation workspace automatically updates files added, removed or edited by an external agent. Clean text can adopt new disk content; unsaved drafts remain intact and show a disk conflict. A draft remains accessible even when its file is removed externally. Saving and external edits do not automatically refresh pages, restart the Project, compile, or change the running health state.

Page changes prompt a refresh; source, audio declarations and artifact changes prompt a restart. SuperCollider source also prompts compilation. Manual refresh, restart and compilation use saved disk files; unsaved drafts are excluded from the test version. A successful monitor refresh clears its captured page prompt. A failed restart retains prompts, and successful compilation still requires a manual restart to adopt the artifacts. Edits arriving during an operation remain pending.

---

## 3. Dress rehearsal self-check

Start saved files and test clients with [Real-time testing and performer windows](./app-tutorial.md#real-time-testing-and-performer-windows), then verify the venue chain below.

Before packaging you must run the Project for real once — the App's packaging checks are static (structure, artifacts, dependencies present) and cannot prove the Project behaves correctly:

1. Open the Project directory in the App (`⌘ O`, the sidebar `+`, or drag the directory onto the window);
2. Confirm preflight passes, the session starts, and health reaches ready;
3. Join the performer page from a phone on the same LAN via the QR code and confirm interaction and sound; confirm the monitor page embeds correctly in the App window and resizes with it;
4. Run through the shutdown flow and confirm the Project releases everything it created.

If any step fails, fix the Project first and come back to packaging.

## 4. Packaging and publishing

When a milestone version is ready, deliver the work as follows:

1. **Export a `.pnds` bundle**
   Choose **Generate .pnds** at the creation titlebar right, review saved-file/test prompts and select an output location.
2. **Automated release**
   Commit and push your local changes to the GitHub repository (or create a release tag); the Template's built-in **GitHub Actions** workflow then builds and distributes the work online.

Pre-release checklist:

1. `manifest.json` passes the App's full validation (id / name / version in place; ports, modes and bus capacities legal);
2. Changed SCD recompiled from its file toolbar, with every declared SynthDef artifact present;
3. The Project has just completed a full run in the App (health ready, performer playable, monitor correct, clean shutdown);
4. Production dependencies are local or covered by same-name exact App shared versions; prepare local copies of uncovered dependencies, as specified by [packing validation](./reference/pnds-bundle.md#packing);
5. `version` is incremented over the last distributed bundle (any content change must bump the version — see [the Reference Manual · .pnds bundles](../reference/pnds-bundle.md));
6. Packaging succeeded — note the artifact path and sha256 and distribute them alongside the file.

## External PNDS Skills

Skills are optional creation aids. Resources: [pnds-agent-skills](https://github.com/xO-xN/pnds-agent-skills). Follow the resource directory instructions to choose the unified creation entry or an independent capability, and install the complete directory in your external coding agent environment with its declared supporting resources. The App does not perform installation. The general entry supports creation, modification and assessment of arbitrary source projects; the author confirms a porting plan before implementation. CM1 remains an explicitly selected course entry. Prefer the installed App's local reference corpus; remote latest documents do not establish local capabilities.

Ordinary tasks deliver editable source with decisions, verification and creator handoff records; package only when distribution is requested. Course tasks deliver both. Record structure readiness, wiring, runtime, sound and device checks, and distribution readiness separately. Reading, editing, module addition and manual testing in the App do not require installed Skills.

## Discuss, edit and check independently

Use Discussion to settle the goal, consequential choices and acceptance, then explicitly choose built-in Work or record a handoff for an external agent. After implementation, preview where supported, test real sound and visuals and save a project version at a suitable milestone.

The [App tutorial](./app-tutorial.md#asking-about-installed-pnds-documentation) owns detailed actions, permissions and interruption behavior. See [Pending documents](./app-tutorial.md#pending-documents), [Record a handoff](./app-tutorial.md#record-a-handoff-and-continue-externally) and [Change proposals and temporary preview](./app-tutorial.md#change-proposals-and-temporary-preview) for those tasks. The [runtime contract](./reference/runtime-contract.md#optional-temporary-parameter-preview-protocol-1) defines adaptation. Work checks and repairs within its task; manual testing and CLI paths are described under [Controlled saved-copy checks](./app-tutorial.md#controlled-saved-copy-checks).

## Default performer input

Blank already wires `public/pnds-input.js` to the admitted `PNDS_PLAYER` on
`<main>`. Edit this surface and the piece's feedback; do not add p5/ml5 or an
optional input module. Mouse means one contact; touch hardware can provide
several independent contacts. Pointer-capable pages consume only pointer events,
including the App's mouse test path; native simulated/compatibility touch cannot
enter the work twice. Older touch-only pages use changedTouches with a normal
single-mouse fallback, suppressing compatibility mouse after touch. Native form
controls retain their own behavior.

Each gesture has an opaque ID and start/move/end/cancel phases. Coordinates are
relative x/y and normalized nx/ny with width/height measured at each event, so
resize, orientation, zoom and fullscreen do not keep stale bounds. The technical
limit is 64 concurrent contacts per performer. Blur, hidden documents, capture
loss, disconnect and explicit close cancel only owned gestures; a terminal event
can reuse its last valid geometry after a surface collapses. Old terminals do
not cancel a successor. `PNDS_INPUT.close()` releases input without closing the
player; page release closes both. No held input is queued for reconnection.

`server.js` calls `performance.prepareInput(identity.id, payload)` after current
claim-owner validation, then `performance.applyEvent(identity.id, event)` from
`performance/state.js`. This is the common work application entry. Keep new
visual or audio mappings here and update their state/release semantics together.
Accepted contacts live in the actual per-run state, separate from durable
identities, score selection, recording time and audio channels. `release(id)`
clears that source. `snapshot()` returns detached
`{ performers: [{ id, contacts: [{ id, pointerType, x, y, width, height, nx, ny }] }] }`.
The existing performer/monitor Socket.IO connections publish full snapshots on
`pnds:performance`, including on initial connection; monitor-view is exclusively
for low-frequency view settings. For an explicit author feedback task, a monitor
can render these accepted contacts with `socket.on('pnds:performance', render)`.
Blank ships the input/state wiring without an example artwork or sound preset.

Validate the edited real project and its observable feedback. Controlled DOM
pointer/TouchEvent cases prove the data path, not physical multi-finger hardware,
phone behavior or heard sound; record those acceptance results separately.
