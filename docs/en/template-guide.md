# PNDS Template Creator's Guide

This guide walks you through creating, developing and publishing a PNDS Project from scratch, based on the PNDS Template.

---

## Creating from Blank or PNDS Classic in the App

Creation home and Switch to another project offer **New project**. Select a
starting template, enter the work name, folder name and optional creator and
description, then choose an existing parent folder. The App creates one new
editable folder and never replaces an existing file or directory.

- **Blank** — the original PNDS App v1.6.0 minimal runnable structure, with no
  artistic preset or production dependencies. Internal writes zeros to the
  injected private buses; External sends no piece messages. SCD source and its
  matching compiled SynthDef are included.
- **PNDS Classic** — a fixed verified PNDS Template 0.7.0 source snapshot. It
  keeps the full two-fader reference: networking, seats/reconnection, monitor,
  theme/language following and one sine voice per client with 16-channel output.
  Source, implementation manual and regression tests are included. It uses the
  App's exact shared versions of Express 5.3.0, Socket.IO 4.8.4, osc-min 2.1.2,
  qrcode 1.5.4 and p5 2.3.4. This starting point is separate from Add module.

Both create offline with no npm installation or local sclang required. If
Classic's exact shared resources are missing or fail verification, creation
fails explicitly; the App does not choose another version. Test Internal,
External or None **manually after creation**. Real sound and phone behavior
still need your own device verification.

Each creation receives an independent project ID, even for equal folder names
under different parents. Classic also receives its own client storage key.
Manifest, package/lock, both Classic READMEs and agent guidance describe the new
project at version 0.1.0; Git history, seats and device caches are not inherited.
The source is recorded in `docs/template-source.json`. Opening an existing
project preserves its identity/history, and a template update does not rewrite
projects already created. **App-created projects are already initialized**;
external agents should continue through AGENTS and the creator handoff, without
rerunning `docs/start.md` initialization.

Blank's initial README uses the creation-time App language; its other language
is a pending task in `docs/creator-handoff.md`. AGENTS points to that handoff
and the installed App's contracts. Handoffs and provenance stay in source;
root docs are excluded from `.pnds`. After editing SCD, compile it in the App
with the required local SuperCollider setup.

Cancelling the picker, form or draft-discard confirmation preserves the old
workspace and running test. Directory conflicts, permissions and partial
creation failures publish no incomplete project. If the complete folder was
created but workspace adoption failed, the error names its location so you can
open it later. Success enters the workbench **without starting** and places the
project first in performance Home. Returning to performance requires manual
selection and load; the entry is remembered across App restarts.

## Prerequisites

Before you start, make sure your machine has:

- **The latest PNDS App**: installed and running
- **Node.js 24**: the development baseline (no need on the performance machine — the App ships its own Node runtime)
- **SuperCollider** (only for Internal mode): for compiling SynthDefs, installed at the standard `/Applications/SuperCollider.app`
- **Git and an editor**: Git configured, plus your usual IDE (VS Code, Zed, …)
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

PNDS recommends a twin-track iteration loop: **AI-assisted generation and editing, plus manual test updates in PNDS App**:

- **AI-driven development**
  Import the Project directory into your AI coding agent. Guide the AI through conversation to understand the score's interaction logic, audio and visual rendering rules, and communication protocols, and let it write or refactor code quickly. The Project's built-in `AGENTS.md` routes the agent to the platform contracts and module manuals — no manual doc feeding needed. For an uninitialized template cloned outside the App, just tell the agent the canonical trigger — **"start a new piece"** in English, **「开始新作品」** in Chinese; whichever you say sets the working language — and it follows the Project's built-in `docs/start.md` to initialise (work name / author / description in place, version reset, install and tests green).
- **Live loading and preview**
  While authoring, load the local Project directory in PNDS App at any time to test interaction response, audio-visual behaviour and multi-device sync on the spot; the **Open in default browser** and **Refresh the monitor view** buttons at the top right of the sidebar help during development.
- **Continuous verification and fine-tuning**
  Iterate in small steps: verify the effect in the App immediately after each change, and keep every module behaving as intended.

### Selecting the work's connection protocol

When adding or changing phone interaction, QR or browser connections, the authoring agent first reads the two declarations in [manifest.md](./reference/manifest.md) and [runtime-contract.md](./reference/runtime-contract.md) §15, then inspects the browser APIs actually used:

1. Ordinary touch, phone participation and QR joining use HTTP. `supportsPerformerUrl: true` preserves the ability to consume the Host's full URL only.
2. Declare `scoreServer.needsHttps: true` only when the work actually needs secure-context APIs such as motion sensors, camera or microphone; record the API and reason. The Host selects HTTPS when adaptation is declared, the global switch is on and material validates.
3. QR, copied address and browser config consume one Host-selected URL, with injected `PNDS_PERFORMER_URL` taking priority. Page scripts and Socket.IO use the current performer origin.
4. Record the requirement assessment, declarations, actual URL and QR/connection evidence in the creator handoff. Verify HTTP for ordinary projects. For secure-context works, the author also verifies trusted HTTPS, browser permissions and actual device capabilities. Keep unfinished device checks explicitly pending.

The creation workspace automatically updates files added, removed or edited by an external agent. Clean text can adopt new disk content; unsaved drafts remain intact and show a disk conflict. A draft remains accessible even when its file is removed externally. Saving and external edits do not automatically refresh pages, restart the Project, compile, or change the running health state.

Page changes prompt a refresh; source, audio declarations and artifact changes prompt a restart. SuperCollider source also prompts compilation. Manual refresh, restart and compilation use saved disk files; unsaved drafts are excluded from the test version. A successful monitor refresh clears its captured page prompt. A failed restart retains prompts, and successful compilation still requires a manual restart to adopt the artifacts. Edits arriving during an operation remain pending.

---

## 3. Dress rehearsal self-check

In the creation workspace's **Live test** area, choose an audio mode allowed by the saved declarations, then start or restart explicitly. External uses the App's test OSC target; choose the device and sample rate in global Settings. Changed choices stay pending until the runtime reaches ready. Closing a test retains the Project and drafts; hiding the main window does not end testing. A failed preflight leaves an existing test running, and a failed startup can be reviewed and retried.

The monitor title shows its real address. Expand it, then restore with its button or Escape in the main window; the page and runtime keep their instance. The Console tab shows recent Node/scsynth output and errors from the existing log service, with copyable test details. Returning to the file tab retains drafts. Refreshing saved test pages reloads pages without restarting processes. Use **Add performer** to open independent native test windows, choosing phone/tablet and portrait/landscape for each. The list offers focus and individual close. These presets simulate viewport dimensions only; actual touch, sensors and mobile-browser capabilities still need real devices. Page navigation status is separate from the explicitly unknown connection status. Each window has isolated temporary browser storage and communicates directly with the Project server. Refresh covers all open test pages; same-Project restart keeps their shells and reconnects them to the current address. Closing the test, changing Projects or leaving creation closes old test windows; cancelling those operations or hiding the main window preserves them.

Before packaging you must run the Project for real once — the App's packaging checks are static (structure, artifacts, dependencies present) and cannot prove the Project behaves correctly:

1. Open the Project directory in the App (`⌘ O`, the sidebar `+`, or drag the directory onto the window);
2. Confirm preflight passes, the session starts, and health reaches ready;
3. Join the performer page from a phone on the same LAN via the QR code and confirm interaction and sound; confirm the monitor page embeds correctly in the App window and resizes with it;
4. Run through the shutdown flow and confirm the Project releases everything it created.

If any step fails, fix the Project first and come back to packaging.

## 4. Packaging and publishing

When a milestone version is ready, deliver the work as follows:

1. **Export a `.pnds` bundle**
   Open the App's **Settings** → **Developer Tools** and package the current Project as a `.pnds` distribution file.
2. **Automated release**
   Commit and push your local changes to the GitHub repository (or create a release tag); the Template's built-in **GitHub Actions** workflow then builds and distributes the work online.

Pre-release checklist:

1. `manifest.json` passes the App's full validation (id / name / version in place; ports, modes and bus capacities legal);
2. SynthDefs recompiled with the Developer Tools and every manifest reference verified;
3. The Project has just completed a full run in the App (health ready, performer playable, monitor correct, clean shutdown);
4. `npm install` has run and `node_modules/` is fully present;
5. `version` is incremented over the last distributed bundle (any content change must bump the version — see [the Reference Manual · .pnds bundles](../reference/pnds-bundle.md));
6. Packaging succeeded — note the artifact path and sha256 and distribute them alongside the file.

Performer test windows support the Project's normal JavaScript dialogs, including player-number prompts. **Mouse simulates one touch** is visibly enabled for new test clients; drag with the left button to simulate one contact, or turn it off for the page's original mouse behavior. Switching this option does not reload the page. These are untrusted synthetic touch events; native text/form controls remain usable, and real multitouch, pressure, sensors and mobile-browser behavior still require a device.

## External PNDS Skills

Skills are optional creation aids. Resources: [pnds-agent-skills](https://github.com/xO-xN/pnds-agent-skills). Follow the resource directory instructions to choose the unified creation entry or an independent capability, and install the complete directory in your external coding agent environment with its declared supporting resources. The App does not perform installation. The general entry supports creation, modification and assessment of arbitrary source projects; the author confirms a porting plan before implementation. CM1 remains an explicitly selected course entry. Prefer the installed App's local reference corpus; remote latest documents do not establish local capabilities.

Ordinary tasks deliver editable source with decisions, verification and creator handoff records; package only when distribution is requested. Course tasks deliver both. Record structure readiness, wiring, runtime, sound and device checks, and distribution readiness separately. Reading, editing, module addition and manual testing in the App do not require installed Skills.
