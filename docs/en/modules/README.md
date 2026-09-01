# Module Manual

What each PNDS Template built-in module is for and how to use it, written for creators basing works on the Template. The manual ships offline with the App — reachable on the rehearsal and performance machines, no dev environment needed.

The wording follows the App's shared vocabulary: seat (the code says `seat`), claim token (never translated), and performer / monitor (the two page roles, kept in English everywhere).

## Chapters

| Chapter                                             | Files covered                                                                 | In one line                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| [QR Code](./qr.md)                                  | `lib/qr.js`                                                                   | the scan-to-join entry on the monitor page     |
| [Player Identity and Seats](./players.md)           | `lib/players.js`, `lib/seats-store.js`, `lib/protocol.js`, `public/client.js` | claim tokens, seats, the Socket.IO protocol    |
| [Theme Following](./theme-follow.md)                | `lib/theme-follow.js`                                                         | the monitor page follows the App's theme       |
| [Language Following](./locale-follow.md)            | `lib/locale-follow.js`                                                        | the monitor page follows the App's UI language |
| [Audio: Three Modes and the Work Layer](./audio.md) | `audio/controller.js`                                                         | the file creators edit most                    |

## Division of labour with the other documentation

- **[The Template repository's implementation manual](https://github.com/xO-xN/PNDS-Template/blob/main/docs/implementation.md)** (genre division): that one is about the template's example Project itself — the example's behaviour spec, directory responsibilities, and what to change where; this manual is a per-module usage reference for rehearsal and performance — answering questions like "how do seats persist?" or "which CSS variables does theming drive?" when you need the answer now. The follow-along create-to-publish workflow guide for the dev machine is the help center's [Creator's Guide](../template-guide.md), which shares the same division with this manual.
- **[The Reference Manual](../reference/README.md)** (contract division): the reference manual is about the Project as a contract layer — manifest, runtime behaviour, `.pnds` bundling, OSC: the interfaces between the App and a Project. This manual is about the Template's own module implementations — how those files work inside a Project. Contract details are always the reference manual's to state; this manual links, never restates.

## Modules deliberately not covered

- `lib/config.js`, `lib/network.js`, `lib/health.js`, `lib/lifecycle.js`, `lib/osc-transport.js` — infrastructure a creator almost never touches; the contracts live in the reference manual's [runtime-contract.md](../reference/runtime-contract.md) and [osc.md](../reference/osc.md).
- `public/performer.js`, `public/monitor.js` — the example work layer: real works replace them wholesale; the workflow is the Creator's Guide's subject.

## Currency

This manual is written against the Template's implementation; whenever the Template cuts a release, re-check this manual so implementation and manual do not drift apart.
