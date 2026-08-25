# Open Sound Control (OSC) 协议

数字乐谱服务器根据作品规则，将演奏者交互转换为 OSC 消息，控制声音引擎发声。

工程自定义 OSC 地址不是 PNDS 平台协议——平台不得要求 `/p1`、`/p1xy` 等作品专属地址。

OSC target 的注入（`PNDS_OSC_TARGET`，区分 Internal / External / None）见 [runtime-contract.md](./runtime-contract.md) §3。
