# Performance Recording and Replay

## Optional performance recording adapter (protocol 1)

The project's root `pnds.recording.json` declares `{"protocolVersion":1,"adapterId":"my-score-v1"}`. The local performer service implements `GET/POST /__pnds/recording`. GET returns the declaration. The route accepts loopback non-browser management requests only. External entry proxies must exclude it. Supply project callbacks to the bundled `recording/adapter.cjs`.

POST takes `operationId` and `action`. Each new operation uses a fresh ID.

| Action  | Fields and behavior                                                                                                                                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `begin` | `mode` is `record`, `playback` or `overdub`. Replay input includes `initialState` and `replayPerformers` (`id`, `label`, `selection`). Record and overdub send `livePassId` and require the same `passId` in the response. The response also contains `initialState`, `performers`, `events` and `elapsedMs`. |
| `poll`  | Pass `afterSequence`. Returns performers, elapsed time and all events after the cursor.                                                                                                                                                                                                                       |
| `drive` | Pass `elapsedMs` and due events. Deduplicate by sequence.                                                                                                                                                                                                                                                     |
| `end`   | Pass `afterSequence`, `elapsedMs` and `release`. Retry the same operation until cleanup is acknowledged, including when the begin response is lost.                                                                                                                                                           |

Events carry integer `atMs`, unique `sequence`, nullable `performerId`, and project-defined `kind` and `payload`. Sort by `(atMs, sequence)`. Null performer means common conducting. Retain effective repeated holds, releases and all START, pause and seek changes. Seeking does not move recording time backward. Execute management commands in order and reject stale operation IDs.

- Recording and live score start/stop are independent. Replay restores the initial state and actual score, rejects live musical input and manual conducting, and releases replay sources at end.
- Overdub captures all admitted live performers in the pass, including late joiners. Record separate source IDs and terminal releases. Keep the first-pass duration and exclude inherited replay from capture.
- Restore initial state only for `replayPerformers`. Rerecord or delete whole passes, retaining other passes and common conducting.

A project without the adapter still runs normally. Replay requires a compatible project, recording format and adapter protocols. Incomplete records cannot be played or resumed. Ordinary replay uses the current compatible project and preserves the original record and provenance. Overdub and rerecord after project content changes require confirmation. See [carrying and recovering performance recordings](../app-tutorial.md#carrying-and-recovering-performance-recordings).
