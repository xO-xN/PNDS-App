# PNDS Template Creator's Guide

This guide walks you through creating, developing and publishing a PNDS Project from scratch, based on the PNDS Template.

---

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

---

## 2. The authoring and iteration workflow

PNDS recommends a twin-track iteration loop: **AI-assisted generation and editing, plus live hot-reload preview in PNDS App**:

- **AI-driven development**
  Import the Project directory into your AI coding agent. Guide the AI through conversation to understand the score's interaction logic, audio and visual rendering rules, and communication protocols, and let it write or refactor code quickly. The Project's built-in `AGENTS.md` routes the agent to the platform contracts and module manuals — no manual doc feeding needed. For a freshly created Project, just tell the agent the canonical trigger — **"start a new piece"** in English, **「开始新作品」** in Chinese; whichever you say sets the working language — and it follows the Project's built-in `docs/start.md` to initialise (work name / author / description in place, version reset, install and tests green).
- **Live loading and preview**
  While authoring, load the local Project directory in PNDS App at any time to test interaction response, audio-visual behaviour and multi-device sync on the spot; the **Open in default browser** and **Refresh the monitor view** buttons at the top right of the sidebar help during development.
- **Continuous verification and fine-tuning**
  Iterate in small steps: verify the effect in the App immediately after each change, and keep every module behaving as intended.

---

## 3. Dress rehearsal self-check

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
