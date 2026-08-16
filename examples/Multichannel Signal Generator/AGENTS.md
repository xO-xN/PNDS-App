# AI Agent Instructions

## Development practices

- **npm only**: use `npm install` / `npm run` — never pnpm or yarn.
- **Removing files**: always use `rm -f`.
- **No unsolicited commits**: commit only when the user explicitly asks.
- **Quality gates**: after significant changes run `npm run check` (syntax) and `npm test` (node --test, 22 tests).
- **Local docs**: `docs/creator-guide.md` (creator guide) and `docs/handoff.md` (developer handoff notes) describe this project's conventions and decisions — read them before changing behavior.

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in `xO-xN/Multichannel-Signal-Generator` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with the default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by `/domain-modeling`). See `docs/agents/domain.md`.

## Domain notes

- **Internal audio only**: `defaultMode: "internal"`, `supportedModes: ["internal"]`, 16 output channels; the App-hosted scsynth runs at sampleRate 48000 / blockSize 64 / audioBusChannels 128 and loads `supercollider/synthdefs/multichannel-signal-generator.scsyndef`.
- **Private buses**: the project owns group 1000 with 16 mono `toneTest` instances (nodes 1001..1016); tone *i* writes only bus `PNDS_AUDIO_OUTPUT_BUS + i` and never downmixes.
- **Fader API**: the monitor page drives the engine via `POST /api/tone {channel, on}` (channel 1..16) and `POST /api/master {value 0..1}`; rules live in `lib/audio-engine.js`, validation in `server.js`.
- **QR endpoint**: `/qr` on the monitor port renders the monitor URL (`http://<LAN-IP>:6869/`) as PNG via `lib/qr.js` + `lib/network.js`; the performer port 404s it.
