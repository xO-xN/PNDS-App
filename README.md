# PNDS

[中文](README.zh-CN.md) | **English**

🌐 Website: https://xo-xn.github.io/PNDS-App/

An electronic-music creation and performance platform for the AI-coding era.

PNDS (Platform for Networked Digital Score) is a platform for creating and performing networked digital-score electronic music, with two parts: **PNDS App** and **PNDS Template**.

- **PNDS App** — the Host that runs projects at the performance site: it stands Node.js and the sound engines up on a local network, forming a digital-score performance environment on the spot.
- **PNDS Template** — a PNDS project starting point prepared for AI coding: the framework ships ready-made utilities for realizing works, and your own work lives in just a few specific files — a clear, simple boundary.

A performance needs just one Mac and a router: the App opens a project and sets up a local multi-player performance system on the spot; performers join from their own phones, tablets, or other devices. PNDS also extends to network music performance: multiple Macs at different sites each run PNDS with the same internet-capable project, and with an audio transport such as JackTrip, the dispersed sites perform as one telematic ensemble.

![PNDS App - Welcome](./assets/readme_img/pndsapp_starting.png)

## Download

- **PNDS App**: the `.dmg` from [Releases](https://github.com/xO-xN/PNDS-App/releases/latest) — requires an Apple Silicon (M-series) Mac.
- **PNDS Template**: [Releases](https://github.com/xO-xN/PNDS-Template/releases/latest).

## Documentation

The documentation is currently Chinese-only:

- [PNDS App Tutorial](docs/zh-CN/app-tutorial.md)
- [PNDS Template Guide](docs/zh-CN/template-guide.md)
- [Reference Manual](docs/zh-CN/reference/README.md)

Looking for a score project to run? See [_Inarticulate III_](https://github.com/xO-xN/inarticulate-iii).

## Related Repositories

- [PNDS-Template](https://github.com/xO-xN/PNDS-Template) | the PNDS creation template
- [Local-Network-Diagnostics](https://github.com/xO-xN/Local-Network-Diagnostics) | bundled local-network diagnostics tool
- [Telematic-Network-Diagnostics](https://github.com/xO-xN/Telematic-Network-Diagnostics) | remote-network diagnostics tool
- [Multichannel-Signal-Generator](https://github.com/xO-xN/Multichannel-Signal-Generator) | bundled 16-channel validation tool
- [Inarticulate III](https://github.com/xO-xN/inarticulate-iii) | an example work created with PNDS

## License

MIT — see [LICENSE.md](LICENSE.md). The bundled SuperCollider (`scsynth`) is GPL-3.0 and runs as a separate process.
