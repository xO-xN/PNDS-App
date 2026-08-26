# manifest.json

## Example

```json
{
  "schemaVersion": 1,
  "id": "inarticulate-iii",
  "name": "Inarticulate III",
  "version": "1.0.1",
  "description": "A networked digital score for three performers.",
  "scoreServer": {
    "entry": "server.js",
    "workingDirectory": ".",
    "performerPort": 6868,
    "monitorPort": 6869
  },
  "audio": {
    "defaultMode": "internal",
    "supportedModes": ["internal", "external", "none"],
    "outputChannels": 2,
    "synthdefs": ["supercollider/synthdefs/inarticulate-iii.scsyndef"],
    "scsynth": {
      "blockSize": 64,
      "audioBusChannels": 128
    },
    "standaloneTarget": "127.0.0.1:57110"
  }
}
```

## Required fields

```text
schemaVersion
id
name
version
scoreServer.entry
scoreServer.workingDirectory
scoreServer.performerPort
scoreServer.monitorPort
audio.defaultMode
audio.supportedModes
```

## Optional fields

```text
description
audio.outputChannels
audio.standaloneTarget
```

`audio.outputChannels`:

- must be an integer in `1..=64`;
- defaults to `2`;
- counts the discrete output signals the Project produces;
- says nothing about speaker layout, channel labels, spatial positions or live PA configuration;
- mono, stereo and multichannel Projects are all allowed;
- remains a backwards-compatible extension of `schemaVersion: 1`.

`audio.standaloneTarget` is for manual debugging outside the App only. The App must not read or use it.

## Conditionally required fields for Internal mode

When `audio.supportedModes` includes `internal`:

```text
audio.synthdefs                       non-empty array of paths
audio.scsynth.blockSize               positive integer
audio.scsynth.audioBusChannels        positive integer
```

`audio.scsynth.sampleRate` **has been removed from the schema's active surface**: internal mode no longer requires it and new Projects should not declare it. The App-hosted scsynth always runs at the App's global sample-rate setting (48000 when unset — see [runtime-contract.md](./runtime-contract.md) §7.2). A leftover field in an old manifest is read and ignored — it never takes part in startup, is never rewritten, and never fails validation. When debugging a Project standalone, outside the App, choose the scsynth sample rate yourself.

Additionally:

```text
audio.scsynth.audioBusChannels >= 2 × audio.outputChannels
```

This leaves room for the hardware buses and the Project's private buses. Preflight must fail on violation.

`audio.scsynth.blockSize` declares only scsynth's synthesis block size (the App passes it as `-z`; see [runtime-contract.md](./runtime-contract.md) §7.2) — it is not the audio device's IO buffer and implies no latency promise.

## Audio-mode fields

The only valid modes:

```text
internal | external | none
```

Rules:

- `audio.supportedModes` must be a non-empty array containing no unknown values;
- `audio.defaultMode` must be among `audio.supportedModes`;
- `internal` uses the App-hosted scsynth;
- `external` sends the Project's custom protocol to a user-chosen OSC target;
- `none` establishes no audio or OSC output.

## Ports

`performerPort` and `monitorPort`:

- must both be integers in `1..=65535`;
- must differ from each other;
- are declared per Project — there is no platform default port;
- both HTTP servers must be running throughout the session.

The platform convention is `6868` (performer) / `6869` (monitor) — the Template, official Projects and built-in tools all use this pair. Keep it unless you have a specific reason not to. The App confirms both ports are free before startup and **fails on conflict — it never picks another port**. Two Projects using the same port pair cannot run on the same machine at once — when switching works, close the current Project before opening the next.

When you must choose different ports, avoid:

| Range to avoid         | Reason                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- |
| 1–1023                 | Reserved well-known ports; used by macOS system services and permission-gated |
| 49152–65535            | macOS ephemeral port range; any outbound connection may claim one at random   |
| 5000, 7000             | AirPlay Receiver (listens when the Mac's AirPlay Receiver is enabled)         |
| 3000, 5173, 8000, 8080 | Common dev servers (Vite, React dev server, Flask, Django, proxies)           |
| 3306, 5432, 6379       | Common databases (MySQL, PostgreSQL, Redis)                                   |

Unsure whether a port is free? Open **Settings → Ports (设置 → 端口)**: with a Project selected, the App shows both manifest-declared ports' occupancy and who holds them, and can release them in one click.

## Paths and asset safety

The following fields must be relative paths inside the Project root:

```text
scoreServer.entry
scoreServer.workingDirectory
audio.synthdefs[*]
```

The App must:

- reject absolute paths;
- reject `../` path escapes;
- resolve symlinks and confirm the real path stays inside the Project root;
- validate that the entry is a file, the working directory is a directory, and every SynthDef is a file;
- return a readable error naming the field and path when a file is missing;
- fail on unsupported `schemaVersion` before any other validation.

## Fields that are not part of the schema

The App must neither require nor interpret:

```text
scoreServer.preferredHttpPort
scoreServer.routes
roles
audio.sampleDirectory
audio.pluginDirectory
audio.scsynth.controlBusChannels
audio.scsynth.bufferCount
audio.scsynth.memorySize
```

Creator, checksum, target platform, runtime-asset lists and bundle metadata belong to the `.pnds` bundle, not to the directory-Project schema.
