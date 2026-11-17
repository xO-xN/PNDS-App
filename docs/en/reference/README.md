# PNDS Reference Manual

This manual defines Project/App interfaces. Use the [App tutorial](../app-tutorial.md) for operations, the [Creator's Guide](../template-guide.md) for the creation workflow, and the [Module Manual](../modules/README.md) for default foundations and optional capabilities.

## Projects and resources

- **What is a digital score?** → [The digital score](./digital-score.md)
- **How are project files, README and private creation data organized?** → [Project structure](./structure.md)
- **Which manifest fields, capabilities and path restrictions apply?** → [manifest.json](./manifest.md)
- **How do App shared packages coexist with project dependencies?** → [Shared packages](./structure.md#app-shared-packages)
- **What does a .pnds bundle contain, and how is it packed and installed?** → [Bundles](./pnds-bundle.md)

## Runtime, sound and pages

- **What do monitor, performer and the App own?** → [Roles and ownership](./runtime-contract.md#1-participants-and-ownership)
- **What are the startup environment, health and shutdown requirements?** → [Runtime contract](./runtime-contract.md)
- **How are managed ports and listeners handed over?** → [Runtime ports v1](./runtime-ports.md)
- **How do Internal, External and None differ?** → [Audio modes](./audio-modes.md)
- **How do private buses map to hardware outputs?** → [Multichannel audio](./runtime-contract.md#7-internal-multichannel-audio)
- **How are SynthDefs compiled, and where does OSC go?** → [Compilation](./supercollider.md), [OSC](./osc.md)
- **Which keyboard, pointer and touch events can pages use?** → [Page interaction](./page-interaction.md)
- **How are projection and parameter preview wired?** → [Projection surface](../modules/projection-surface.md), [Preview protocol](./parameter-preview.md)
- **How is the optional p5 visual route loaded offline?** → [p5.js](./p5js.md)

## Participation, media and recording

- **Which protocol covers browser confirmation, resource URLs and document continuity?** → [Browser participation](./browser-participation.md)
- **How are admitted performers reported?** → [Connected performer roster](./browser-participation.md#connected-performer-roster)
- **How does a project support recording, replay and overdub?** → [Performance recording protocol](./performance-recording.md)
- **Who owns native-page camera, microphone and projection input?** → [Native media](./native-media.md)
- **How are LAN, internet, trusted HTTPS and DNS prepared?** → [Networking](./network.md), [HTTPS](./https.md), [DNS](./dns.md)
