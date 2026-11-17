# Module Manual

Look up project wiring by capability. Use the README of the actual module version in the project.

## Default foundation and optional capabilities

| Capability                                             | New Blank                                     | Conditions                                                                 |
| ------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------- |
| Performer identity                                     | Wired by default                              | UUIDs are separate from channels and score selection                       |
| Monitor view                                           | Wired by default, initially empty declaration | Declare actual low-frequency view fields to enable it                      |
| Common input, performance recording, parameter preview | Default foundation                            | Implement work effects and tunable parameters as needed                    |
| Theme, language, hub                                   | Optional adoption                             | hub also adopts its required Node client                                   |
| Device motion, device microphone                       | Optional adoption and manual enable           | No p5/ml5 required                                                         |
| Camera HandPose                                        | Optional adoption and manual enable           | Compatible p5 first; then adopt ml5, the module and offline model together |

## Adoption and maintenance

Manual **Add PNDS Module** copies sources and provenance, then records an unwired handoff. Already wired Blank defaults are not added again. Confirmed Work chat adopts required resources and completes actual work wiring and checks in the same task; Discussion only proposes. Adoption does not automatically upgrade author sources or start the project.

`pnds-module.json` records provenance; `compatibility.json` separates module version, Host protocol and adaptation requirements. File presence does not establish verification.

## Chapters

- Identity and recovery → [Performer Identity](./players.md); multiple monitor views → [Monitor View State](./monitor-state.md).
- Sound and replay wiring → [Audio Work Layer](./audio.md); remote nodes → [hub](./hub.md).
- Page style and language → [Theme Following](./theme-follow.md), [Language Following](./locale-follow.md); venue visuals → [Projection Surface](./projection-surface.md).
- Device input → [Motion](./device-motion.md), [Microphone](./device-microphone.md), [HandPose](./camera-handpose.md).
- Phone invitations → [QR](./qr.md).

## Division of labour with the other documentation

The project's `docs/implementation.md` owns actual work rules and edit locations. The [Creator's Guide](../template-guide.md) covers workflow; the [Reference Manual](../reference/README.md) defines Host/project contracts; this manual covers capability wiring.

## Device motion input

See [Device Motion Input](./device-motion.md) for interfaces and limits.

## Device microphone input

See [Device Microphone Input](./device-microphone.md) for interfaces and limits.

## Camera HandPose sensor

See [Camera HandPose](./camera-handpose.md) for prerequisites, interfaces and limits.
