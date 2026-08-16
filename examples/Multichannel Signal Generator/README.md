# Multichannel Signal Generator

[English](#english) | [中文](#中文)

---

## English

A PNDS utility score project: a **16-ch sine wave test** (16 independent mono sine tones, `toneTest` SynthDef) for checking Internal multichannel routing. Audio-only: the server always runs in `internal` mode (`defaultMode: "internal"`, `supportedModes: ["internal"]`, 16 output channels) — no external audio modes. Stack: Node.js (raw `http`, no Express, no Socket.IO, no p5) plus a minimal OSC UDP encoder to the App-hosted scsynth.

### Features

- **16 independent test tones**: one mono `toneTest` sine per channel, tuned `440 Hz × 2^((n−1)/12)` (channel 1 = concert A, channel 13 = one octave up)
- **Per-channel private buses**: tone *i* writes only its own bus `PNDS_AUDIO_OUTPUT_BUS + i` — never hardware bus 0, never downmixed
- **All muted by default**: every tone starts silent; toggle any of the 16 buttons to hear it
- **Master fader**: 0..1 volume (0 = Mute, 1 = 0 dBFS unity, default −6 dBFS) with ~20 ms smoothing, so toggles don't click
- **JSON API**: `POST /api/tone {channel, on}` (channel 1..16) and `POST /api/master {value 0..1}` on the monitor port
- **Monitor QR code**: the fader page shows a QR for the monitor page (`:6869`) so phones can open it
- **Graceful shutdown**: SIGINT/SIGTERM release the scsynth group, the UDP socket and both HTTP servers

### Getting Started

```sh
npm install
npm start    # http://<Host-LAN-IP>:6868/ performer · :6869/ monitor
```

The performer port has no UI (it serves the App health endpoint and a no-UI stub); all controls live on the monitor page at `http://<lan-ip>:6869/`. To run inside the PNDS App, click **Open** and select this folder (Internal audio only — the App hosts scsynth and loads the bundled `.scsyndef`). Scan the QR at the bottom of the monitor page to open the monitor URL on a phone.

Source repository: https://github.com/xO-xN/Multichannel-Signal-Generator

Full documentation: [`docs/creator-guide.md`](docs/creator-guide.md) (creator guide) and
[`docs/handoff.md`](docs/handoff.md) (developer handoff notes).

### Structure

```
lib/            Reusable core (shared across all PNDS projects)
public/         Browser side (16-fader monitor page)
test/           Regression tests
docs/           Creator guide and handoff notes
supercollider/  Compiled .scsyndef artifact + build-time source
```

### License

MIT — see [LICENSE](LICENSE).

---

## 中文

一个 PNDS 实用工具工程：**16-ch sine wave test**（16 路独立单声道正弦测试音，`toneTest` SynthDef），用于检查 Internal 多声道路由。纯音频工具：server 恒以 `internal` 模式运行（`defaultMode: "internal"`、`supportedModes: ["internal"]`、16 路输出），无外部音频模式。技术栈：Node.js（原生 `http`，无 Express / Socket.IO / p5）+ 极简 OSC UDP 编码器，直连 App 托管的 scsynth。

### 功能

- **16 路独立测试音**：每通道一个单声道 `toneTest` 正弦，`440 Hz × 2^((n−1)/12)` 半音阶梯（通道 1 = 440 Hz 音乐会 A，通道 13 = 880 Hz 高八度）
- **每路私有总线**：第 i 路只写自己的总线 `PNDS_AUDIO_OUTPUT_BUS + i`——绝不写硬件总线 0，绝不下混
- **默认全部静音**：所有音初始为 Mute，点任意开关才发声
- **主音量推子**：0..1 音量（0 = Mute，1 = 0 dBFS unity，默认 −6 dBFS），~20 ms 平滑，无咔嗒声
- **JSON API**：monitor 端口提供 `POST /api/tone {channel, on}`（channel 1..16）与 `POST /api/master {value 0..1}`
- **Monitor QR 码**：fader 页底部展示 monitor 页（:6869）QR，手机扫码即开
- **优雅关闭**：SIGINT/SIGTERM 释放 scsynth 组、UDP socket 与两个 HTTP server

### 开始

```sh
npm install
npm start    # http://<Host-LAN-IP>:6868/ performer · :6869/ monitor
```

performer 端口无 UI（只服务 App 健康检查与无 UI stub 页），全部控制都在 monitor 页 `http://<lan-ip>:6869/`。在 PNDS App 中：点击 **Open** 选择本文件夹即可（仅 Internal 音频——App 托管 scsynth 并加载随附的 `.scsyndef`）。扫描 monitor 页底部的 QR 可在手机上打开 monitor 地址。

仓库：https://github.com/xO-xN/Multichannel-Signal-Generator

完整说明见 [`docs/creator-guide.md`](docs/creator-guide.md)（创作指南）与
[`docs/handoff.md`](docs/handoff.md)（开发交接笔记）。

### 结构

```
lib/            可复用核心（PNDS 工程通用）
public/         浏览器端（16 路测试音 monitor 页）
test/           回归测试
docs/           指南与交接文档
supercollider/  编译产物 .scsyndef + 构建源码
```

### 许可证

MIT — 详见 [LICENSE](LICENSE)。
