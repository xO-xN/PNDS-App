# Open Sound Control (OSC) Protocol

Open Sound Control (OSC) is a network protocol for real-time communication between sound synthesizers, multimedia software and interactive hardware — widely seen as a more extensible, higher-resolution modern alternative to MIDI. It uses a URL-like hierarchical address space (e.g. /filter/cutoff), carries high-resolution floats and multidimensional data, packs messages into bundles with microsecond timestamps, and usually rides on UDP/IP for low-latency exchange across devices and platforms.

In PNDS, OSC is how a Project talks to its sound engine (the App's built-in scsynth, or any external device that accepts OSC). PNDS itself dictates no OSC rules — the work's Project defines all of them.

During development you can debug the score in PNDS using External mode, sending OSC to an external SuperCollider; once the sound engine is designed, compile the scsyndef files with the Developer Tools in the App's settings — PNDS loads them at runtime and voices the sound directly on the App's internal scsynth.

Injection of the OSC target (`PNDS_OSC_TARGET`, distinguishing Internal / External / None) is covered in [runtime-contract.md](./runtime-contract.md) §3.
