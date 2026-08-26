# Player Identity and Seats

How does a performer's phone end up back in the same seat, on the same output channel, after a screen lock, a dropped connection, even a Project restart? The answer is spread across four files; this chapter tells it as one story:

| File                 | Role                                                             |
| -------------------- | ---------------------------------------------------------------- |
| `lib/players.js`     | the identity registry: id allocation, claim-token claiming       |
| `lib/seats-store.js` | the seat ledger: token → `{ id, out }`, persisted to disk        |
| `lib/protocol.js`    | the Socket.IO protocol: join / control / seat operations / state |
| `public/client.js`   | the browser-side connector: each page uses half of it            |

## The claim token: a device's persistent identity

When a performer first joins, the server generates a claim token (a 48-hex-character random string) and hands it to the page in the `joined` event; the page stores it in localStorage (under the `tokenKey` from `public/shared.js` — `pnds-template-token` in the Template; rename it when you base a new work on it, see the Creator's Guide).

Every connection after that — reconnects included — the page re-joins carrying this token, and the server recognises the seat from it. The token is "this device, in this Project":

- ids get released and reused after a disconnect; tokens never do — every piece of persistent state is indexed by token, not id.
- The valid shape is a string of 24–128 characters (`isClaimToken` in `lib/players.js`).

## The id: 1..maxClients

The id is the numeric seat number, allocated within `1..maxClients`, and `maxClients = outputChannels` (at the server.js composition) — a Project has as many seats as it has output channels. The allocation rules (`lib/players.js`):

- A seat recorded for this token is reclaimed first;
- otherwise the smallest free id wins, **skipping seats recorded for other tokens** — a device's seat is never handed to another device while its record exists;
- when nothing is left, the join is rejected (`rejected` event, `Server is full (max N clients).`).

A page **never hardcodes an id**: its own id comes from the `joined` event (`public/client.js` keeps it as `myId`), its output channel is tracked from the `state` broadcasts (`myOut`) — after a monitor seat move the page follows along on its own.

## Two kinds of recovery: reconnects and restarts

|                | Reconnect (phone lock)                                | Project restart (next show)   |
| -------------- | ----------------------------------------------------- | ----------------------------- |
| What returns   | the voice's control state (raw values, register, out) | the seat `{ id, out }`        |
| Where it lives | memory (`lib/protocol.js`, keyed by token)            | disk (`lib/seats-store.js`)   |
| Why            | it only has to outlive a screen lock                  | it has to outlive the process |

- The seat file defaults to `.pnds-seats.json` at the Project's root; the `PNDS_SEATS_FILE` environment variable points it elsewhere (the App and the tests both do). Writes go through "temp file + atomic rename" — a crash never leaves torn state.
- The control state stores **raw values** (faders 0..1) and re-maps on restore — persisting mapped frequencies or levels would mean mapping twice (mapping belongs to `audio/controller.js`; see [Audio: Three Modes and the Work Layer](./audio.md)).
- After a restart the in-memory state is gone, but the seat record still carries the output channel. Seat records also heal themselves: if the channel count changed between runs and a persisted channel can no longer be routed, the voice falls back to the default channel and the record is corrected at the next persist.

## The monitor's seat operations

- **Seat move, `set-seat` (payload `{ id, to }`)**: moves a live device to another seat number. The target must be free of live devices (a stale record parked there is evicted). The assignment, the voice (reborn in place from its current control state — no audible intermediate) and the seat record all move together; the device's page learns its new id through a re-issued `joined` event — pages track it with zero changes.
- **Reset, `reset-ids`**: wipes every seat record and in-memory state and bounces all performer sockets. The pages reconnect and re-join on their own; the tokens no longer have seats, so ids are handed out fresh in rejoin order. A phone that never returns keeps occupying its seat number — that is what the reset button is for.

## The Socket.IO event table

Event names come from `events` in `public/shared.js` (a work may keep its own wire vocabulary; these are the Template defaults):

| Direction     | Event       | Payload                                               | Meaning                                                                              |
| ------------- | ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| page → server | `join`      | `{ token? }`                                          | join / reclaim a seat on reconnect                                                   |
| page → server | `control`   | Project-defined                                       | faders and friends; `lib/protocol.js` forwards it opaquely, the work layer validates |
| page → server | `set-out`   | `{ out }` (performer page) or `{ id, out }` (monitor) | change the output channel                                                            |
| page → server | `set-seat`  | `{ id, to }` (monitor)                                | move a seat                                                                          |
| page → server | `reset-ids` | none (monitor)                                        | reset all seats                                                                      |
| server → page | `joined`    | `{ id, token, recovered }`                            | seated; also the channel that reports a new id after a seat move                     |
| server → page | `rejected`  | `{ reason }`                                          | refused (full house, …)                                                              |
| server → page | `state`     | `{ clients: […] }`                                    | full state broadcast (id / amp / freq / register / out)                              |

## The page side: public/client.js

`PNDSClient` absorbs the connection plumbing so pages can stick to drawing and input:

- `connectPerformer({ io, port, events, tokenKey, storage, hostname })` — for the performer page: joins with the persisted token, tracks `myId` / `myOut`, and `sendControls(payload)` carries its own deadband (default threshold 0.002 — a change below it is not sent).
- `connectMonitor({ io, port, events, hostname })` — for the monitor page: a pure observer that never joins; `onClients(listener)` receives state, `setOut` / `setSeat` / `resetIds` send the operations.

io, storage, hostname and the other ambient dependencies are all injected — tests need no browser.
