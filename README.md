# PNDS

## Platform for Networked Digital Score

[中文](README.zh-CN.md) | **English**

![PNDS App - welcome screen](./assets/readme_img/pndsapp_starting.png)

PNDS is an open platform for networked digital music performance, used to create, run, and organize digital score works for multiple participants.

A creator packages a digital score, a sound engine, and a set of networked interaction rules into one self-contained score project.

On site you only need a Mac and a router: PNDS App opens that project and builds a local multi-player digital music performance system on the spot. Performers join by scanning a QR code with their own phone or tablet, their real-time interactions flow into the digital score, and the score drives the sound engine.

PNDS is made up of three parts that together form this chain.

### The PNDS Score Project Framework

A PNDS score project is a work directory that PNDS App can open and run.
One example of a PNDS project is _Inarticulate III_: https://github.com/xO-xN/inarticulate-iii

A project usually contains:

- A Node.js digital score server that serves the performer page and the monitor/conductor page, and handles real-time network interaction over Socket.IO
- One or more compiled SuperCollider `.scsyndef` sound definition files
- A `manifest.json` configuration file declaring the server entry point, page ports, audio modes, and sound assets

The project itself decides the score's visuals, performance rules, interaction design, and OSC parameters. PNDS App does not prescribe any of this.

Creators can also use an external sound engine (SuperCollider, Max/MSP, Pure Data, Ableton Live, and so on), in which case PNDS App only converts performer interaction into OSC messages and sends them to that engine.

### PNDS App

PNDS App is a macOS desktop application that runs PNDS projects on site:

- Opens a local PNDS project and validates its runtime assets
- Starts the project's digital score server and deploys it onto the local network
- In Internal mode, starts the built-in SuperCollider sound server (`scsynth`) and loads the project's `.scsyndef` files
- Manages the audio mode, audio output device, and master output volume
- Displays the project's own monitor/conductor interface
- Switches between projects, and cleans up all child processes on exit

### PNDS AI Skills

PNDS AI Skills is a set of AI-assisted tools for creators working within the PNDS framework, covering digital score interface and interaction design, SuperCollider sound engine design, and the generation and maintenance of project configuration and documentation.

> **Status: in development.** Not yet publicly released.

## V1 Scope

The first version (V1), now complete, deliberately focuses on:

- A **macOS Apple Silicon** desktop host
- Performances **within a single local network**: the host Mac plus phone/tablet performers
- **Local project directories** that the user explicitly selects and trusts
- **Discrete multichannel output** (1–64 channels) through the built-in SuperCollider sound server, plus External (OSC to a sound engine you specify) and None (score only) modes
- A bundled **Node.js 24** runtime, so projects run without requiring Node on the host machine
- **Automatic updates** with in-app notifications

The following are **later goals** and are not part of V1:

- Distributed performance across the internet
- Intel Mac, Windows, Linux
- Project archives (`.pnds`), an online project library, and project downloads

## Download & Install

Download the latest `.dmg` from the [Releases](https://github.com/xO-xN/PNDS-App/releases/latest) page, open it, and drag PNDS into your Applications folder.

Requirements: a Mac with Apple Silicon (M-series chip).

**First launch:** V1 builds are ad-hoc signed and not notarized by Apple, so macOS will block the app and report that the developer cannot be verified. Open it once using either method below and the warning will not appear again:

- Right-click PNDS in Applications, choose **Open**, then click **Open** again in the dialog
- Or go to **System Settings → Privacy & Security** and click **Open Anyway** near the bottom of the page

Once installed, PNDS checks for updates automatically and notifies you in-app when a new version is available.

## Using PNDS App

### 1. Prepare a PNDS Project

Prepare a complete project directory that can run offline, for example:

```text
Inarticulate III/
├── manifest.json
├── server.js
├── node_modules/                 # only when the project has production dependencies
├── public/
└── supercollider/
    └── synthdefs/
        └── inarticulate-iii.scsyndef
```

The project must ship with its Node.js production dependencies already installed. PNDS App never runs an install step during a performance, and never depends on network access.

### 2. Set Up the Local Performance Network

Connect the host Mac running PNDS App to the local network; a wired connection is recommended. Connect the performers' devices (phones or tablets) to the same network.

### 3. Open a Project

![PNDS App - opening and running a PNDS project](./assets/readme_img/demo30.gif)

Select a local PNDS project directory in PNDS App.

The app then:

- Reads and validates `manifest.json`
- Checks the entry file, dependencies, and sound assets
- Lets you choose the audio mode and output device
- Starts the sound engine / OSC send port as required by the project
- Starts the digital score server

### 4. Performers Join the Digital Score

Performers reach the performer page by scanning the QR code on the monitor page with a phone or tablet, or by opening the host's local network address directly.

Their interactions are sent to the digital score server over Socket.IO.

### 5. The Digital Score Drives the Sound Engine

Following the rules of the work, the digital score server turns performer interaction into OSC messages that make the sound engine sound.

You choose the audio mode in the app:

| Mode           | Description                                                          |
| -------------- | -------------------------------------------------------------------- |
| Internal Synth | Uses the app's built-in `scsynth` with the project's own `.scsyndef` |
| External Synth | Sends OSC to an external synthesizer or device that you specify      |
| None           | No audio at all; runs only the score and its network interaction     |

### 6. Monitor Page and Performer Page

The PNDS App window shows the project's monitor/conductor page, while performers on the local network use the performer page.

During a performance the window shows nothing but the monitor/conductor interface. Move the pointer to the left edge of the window and the PNDS sidebar slides out, where you can switch projects, change the audio mode, select the output device, and adjust the master volume.

The two kinds of page are separated by port:

- Performer page: `performerPort` in the project's `manifest.json`, for phones and tablets
- Monitor/conductor page: `monitorPort`, displayed by PNDS App

The actual port numbers are declared by the project; _Inarticulate III_, for instance, uses `6868` and `6869`.

## Development

This repository is the implementation of PNDS App (Tauri v2 + React + TypeScript).

```bash
npm install        # install dependencies
npm run tauri:dev  # run the app in development mode
npm run check:all  # full quality gate (typecheck / lint / ast-grep / prettier / clippy / tests)
```

For development conventions and agent working rules see [`AGENTS.md`](AGENTS.md); for architecture patterns and detailed developer documentation see [`docs/developer/`](docs/developer/README.md).

## Further Documentation

- [`docs/PNDS_SCORE_PROJECT_SPECIFICATION.md`](docs/PNDS_SCORE_PROJECT_SPECIFICATION.md): score-project directory, manifest, assets, and web-page requirements.
- [`docs/PNDS_RUNTIME_CONTRACT.md`](docs/PNDS_RUNTIME_CONTRACT.md): App/project process, health, audio-bus, and shutdown contract.
- [`docs/PNDS_APP_REQUIREMENTS.md`](docs/PNDS_APP_REQUIREMENTS.md): evergreen PNDS App product requirements and Definition of Done.
- [`docs/README.md`](docs/README.md): complete documentation index.

## Licenses

PNDS App itself is MIT licensed (see [`LICENSE.md`](LICENSE.md)). Bundled third-party components carry their own licenses, included in the app bundle under `licenses/`:

| Component | License | License text in bundle |
| --------- | ------- | ---------------------- |
| SuperCollider sound server (`scsynth`) and UGen plugins | GPL-3.0 | `licenses/SC-GPL-3.0.txt` + `SC-SOURCE.txt` (extracted unmodified from the official SuperCollider 3.14.1 macOS dmg) |
| Node.js 24 runtime | MIT | `licenses/NODE-LICENSE.txt` |
| Comfortaa and Manrope fonts | SIL OFL-1.1 | `public/fonts/OFL-*.txt` |

SuperCollider runs as a separate process and is not linked into the application.
