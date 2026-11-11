# Performer Identity

## Default identity

New Blank projects already wire `modules/pnds-players/`. `players/policy.js` uses random claims and independent performer UUIDs, separate from channels, voices and score-selection numbers. Browser claims use the Host/project storage scope; each test window has a separate suffix. Storage failures are explicit.

## Connections and events

Server `attachPlayers` accepts project-owned admission, control, action, release and snapshot policies. Browser `PNDSPlayers.connectPlayer` supplies the performer connection; `connectObserver` only observes. Read `modules/pnds-players/README.md` in the project for complete arguments.

Blank pages already expose `PNDS_PLAYER`: `identity.id` is the current identity, `sendControls` sends continuous input, `sendAction` sends discrete actions, and `onChange` observes connection/admission state. `continuousFilter` is opt-in; discrete actions preserve repeated payloads.

The server verifies current connection ownership before delegating to the common live/replay application. Work state and effect edit locations are in the project's `docs/implementation.md` and [Audio Work Layer](./audio.md). Monitor does not assign performer identities.

## Recovery and release

`.pnds-creation/players.json` persists only claim→UUID mappings; controls and work state reset each run. A new connection with the same project and claim takes over the old one. Old controls, actions or disconnects cannot alter its successor. Closing a page clears only its own input and connection.

Identity recovery does not replace explicit entry into each performance or transfer camera/microphone ownership. Storage, copying and distribution follow [private creation data](../reference/structure.md#private-creation-data); entry authorization follows the [runtime contract](../reference/runtime-contract.md).
