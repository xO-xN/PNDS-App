# PNDS Template

[中文](README.zh-CN.md) | **English**

title: PNDS Template
composer: PNDS
github_url: https://github.com/xO-xN/PNDS-Template

## Description:

The starting point for every PNDS digital score work: a ready-to-run skeleton where each performer plays a two-fader touch page, the conductor follows a monitor page, and the score server in between keeps seats, reconnection, theme and audio in step. Say "start a new piece" and the template becomes the work.

---

## About the Work

This work is a PNDS project. PNDS (Platform for Networked Digital Score) is an open platform for networked digital music performance, used to create, run, and organize multi-performer digital score works: a creator organizes a digital score, a sound engine, and a set of network interaction rules into a self-contained performance project, and [PNDS App](https://github.com/xO-xN/PNDS-App) (a macOS desktop application) turns it, at the performance venue, into a running local multi-performer digital music performance system.

## Using This Template

A ready-to-run PNDS digital score project skeleton with minimal working features. Use this template to start a new PNDS score project. Projects created from this template run in [PNDS App](https://github.com/xO-xN/PNDS-App), the macOS host for PNDS digital scores.

> **AI coding agents:** this project is a fresh PNDS Template (`manifest.json` `id` is still `pnds-template`). When the creator says the canonical trigger **"start a new piece"** (or a bare trigger such as "start" / 「开始」), read [`AGENTS.md`](AGENTS.md) and follow [`docs/start.md`](docs/start.md) to initialise the new work — the phrase you hear sets the working language. For every other task, read [`AGENTS.md`](AGENTS.md) first as well.

### Features

- **Performer UI**: landscape touch interface with two curved faders (AMP / FREQ); the FREQ fader carries a semitone pitch scale with highlighted ticks and letter names on the center note and its fifth above/below, and a 3-position register switch (1 low / 2 mid / 3 high) changes the frequency band
- **Audio**: one sine voice per client, 16-channel output (odd/even ids default to channels 1/2)
- **Monitor**: real-time client amp/freq display, per-client output channel reassignment
- **Monitor view state**: view adjustments are held by the score server as the single source of truth — every copy of the monitor page (App main window, projection window, a reload, a browser tab) receives the snapshot on connect and follows the same broadcasts; the QR show/hide toggle is the worked example
- **Reconnect recovery**: clients recover their id and fader state after a disconnect
- **Theme following**: inside PNDS App (≥ v1.2.3) the monitor page follows the App color theme (all four themes) — the spec §5.3 optional bridge, consumed here through the p5 `onTheme` callback (`lib/theme-follow.js`, served at `/__pnds/theme-follow.js`)
- **Locale following**: inside PNDS App (≥ v1.3.0) the monitor page follows the App interface language (`en` / `zh-CN`) — the optional language bridge (same push mechanism as themes), consumed here through the `onLocale` callback swapping monitor.js string tables (`lib/locale-follow.js`, served at `/__pnds/locale-follow.js`)
- **Three audio modes**: `internal` (scsynth), `external` (custom OSC), `none` (UI/network only)

### Getting Started

```sh
npm install
npm run dev:none    # run without audio
```

### Start a New Piece with an AI Agent

Import the Project into your AI coding agent and say the canonical trigger **"start a new piece"**. The agent then initialises the new work: work name / author / description in place, version reset, install and tests green. From then on the Project's [`AGENTS.md`](AGENTS.md) routes the agent to the platform contract docs — no manual doc feeding.

Full documentation: [`docs/implementation.md`](docs/implementation.md) (implementation manual —
what the example does and where to change things). The create-to-publish workflow lives in
[PNDS App's creator guide](https://github.com/xO-xN/PNDS-App/blob/main/docs/en/template-guide.md);
[`AGENTS.md`](AGENTS.md) is the entry point for AI coding agents.

### Structure

```
lib/            Reusable core (shared across all PNDS projects — skeleton)
audio/          Work audio layer (fader → synth parameter mapping)
public/         Browser side (performer + monitor dual-role single page)
supercollider/  SynthDef sources, debug bridge, compiled artifacts
test/           Regression tests
docs/           Implementation manual
```

### License

MIT — see [LICENSE](LICENSE).
