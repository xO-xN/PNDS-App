# Open Sound Control (OSC) 协议

Open Sound Control（OSC） 是一种用于声音合成器、多媒体软件和交互硬件之间实时通信的网络协议，常被视作比传统 MIDI 更具扩展性与高精度的现代替代方案。它采用类 URL 的层级地址结构（如 /filter/cutoff），支持高精度浮点数、多维数据以及微秒级时间戳打包（Bundle），通常基于 UDP/IP 实现低延迟的跨设备与跨平台数据交互。

在 PNDS 中，OSC 协议可以用于与声音引擎（App 内置 scsynth 或外部可接受 OSC 的设备）的交互。PNDS 本身不设定 OSC 规则，全部由作品工程来定义。

在开发时，可以用 PNDS 进行乐谱调试，使用 External 模式，发送 OSC 到外部 SuperCollider，声音引擎设计完毕后，使用 App 设置中的开发者工具编译 scsyndef 文件，PNDS 会在运行时加载该文件，直接在 App 内部的 scsynth 发声。

OSC target 的注入（`PNDS_OSC_TARGET`，区分 Internal / External / None）见 [runtime-contract.md](./runtime-contract.md) §3。
