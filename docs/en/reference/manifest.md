# manifest.json

## App shared package capability and schemaVersion 2

The App supports `schemaVersion` 1 and 2. Self-contained projects can use 1. A non-empty `sharedLibraries` array requires 2.

`sharedLibraries` is an array of `{ "id": "...", "version": "x.y.z" }` references. Allowed IDs are `p5`, `ml5`, `express`, `qrcode`, `socket.io`, `socket.io-client` and `osc-min`. Each ID can appear once. Omit the field or use an empty array when no shared resources are needed. Validation rejects `null`, unknown IDs and version ranges.

Preflight and startup check for the exact App resources and fail if they are missing or mismatched. See [project structure](./structure.md#directory-layout) for dependency matching and the [runtime contract](./runtime-contract.md#3-environment-variables-the-app-injects) for wiring.

## Example

```json
{
  "schemaVersion": 1,
  "id": "my-score",
  "name": "My Score",
  "version": "0.1.0",
  "scoreServer": {
    "entry": "server.js",
    "workingDirectory": ".",
    "performerPort": 6868,
    "monitorPort": 6869
  },
  "audio": {
    "defaultMode": "none",
    "supportedModes": ["none"]
  }
}
```

## Required fields

| Field                                                  | Value                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `schemaVersion`                                        | Integer 1 or 2.                                               |
| `id`, `name`, `version`                                | Project ID, name and version as strings.                      |
| `scoreServer.entry`, `scoreServer.workingDirectory`    | The entry file and working directory within the project root. |
| `scoreServer.performerPort`, `scoreServer.monitorPort` | Two distinct port integers.                                   |
| `audio.defaultMode`, `audio.supportedModes`            | Default mode and allowed modes.                               |

## Optional fields

| Field                                                          | Meaning                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `description`                                                  | Project description string.                                                                        |
| `sharedLibraries`                                              | Exact shared package references.                                                                   |
| `telematic`                                                    | The project supports cross-internet performance. The App manages the node, hub, token and room.    |
| `scoreServer.supportsPerformerUrl`                             | The project accepts the full `PNDS_PERFORMER_URL` and uses its origin for resources and Socket.IO. |
| `scoreServer.needsHttps`                                       | The project uses browser APIs that require a secure context.                                       |
| `scoreServer.runtimePorts`, `scoreServer.browserParticipation` | Independent listener handoff and browser participation capabilities.                               |
| `audio.outputChannels`                                         | Number of discrete output signals, an integer from 1 to 64. Defaults to 2.                         |
| `audio.standaloneTarget`                                       | Target string for debugging the project outside the App.                                           |

`telematic`, `supportsPerformerUrl` and `needsHttps` take effect only with Boolean `true`. See [runtime environment](./runtime-contract.md#3-environment-variables-the-app-injects) for node settings and [browser participation](./browser-participation.md#full-performer-url-and-trusted-https) for HTTPS entry selection.

`performerAddress` accepts a bare host name or IPv4 address. An omitted, `null` or blank value uses the selected LAN IPv4 address. Host names use dot-separated labels of ASCII letters, digits and hyphens, with no hyphen at either end of a label. The name is limited to 253 characters and each label to 63. Schemes, ports and paths are invalid. This value supplies `PNDS_HOST_IP` and the monitor source address. The App manages the Host's stable public entry. See [performance networking](./network.md).

## Conditionally required fields for Internal mode

When `audio.supportedModes` includes `internal`, `audio.synthdefs` must be a non-empty array of paths. `audio.scsynth.blockSize` and `audio.scsynth.audioBusChannels` must be positive integers.

`audio.scsynth.audioBusChannels` must be at least `2 × audio.outputChannels`. Block size is the scsynth synthesis block size. The runtime sample rate comes from the App's audio settings. See [multichannel audio](./runtime-contract.md#7-internal-multichannel-audio).

## Audio-mode fields

`audio.supportedModes` is a non-empty array containing only `internal`, `external` or `none`. It must include `audio.defaultMode`. See [audio modes](./audio-modes.md).

## Ports

Declare two distinct port integers from 1 to 65535. A fixed port conflict prevents startup. With runtime ports v1, the declared values are preferred ports.

### Runtime ports v1

`scoreServer.runtimePorts` accepts only integer `1`. Omit it to use fixed ports. A project declaring v1 adopts the two App-allocated listeners, publishes a binding report, and echoes the actual ports and run identity in health. See [runtime ports](./runtime-ports.md).

## Paths and asset safety

`scoreServer.entry`, `scoreServer.workingDirectory` and `audio.synthdefs` resolve from the project root. Use relative paths without `..`. Resolved symlinks must stay inside the project.

Preflight checks the entry file, working directory and SynthDef files required by Internal mode. Packaging checks every declared SynthDef. Validation fails on missing paths or incorrect file types.

## Fields that are not part of the schema

Bundle checksums, target platform and runtime asset inventory belong to the [.pnds bundle](./pnds-bundle.md).

## Browser participation version 1 (#295)

`scoreServer.browserParticipation` accepts only integer `1`. A project declaring v1 loads pages, resources and connections under a confirmed URL prefix. Omit the field when the project has not adopted this capability. See the [browser participation protocol](./browser-participation.md#browser-participation-protocol-1).
