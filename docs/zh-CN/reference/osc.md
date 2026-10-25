# Open Sound Control (OSC) 协议

Open Sound Control（OSC）是用于声音合成器、多媒体软件和交互设备的实时消息协议，通常通过 UDP 发送带类型参数的地址消息，例如 `/filter/cutoff`。它传输控制与事件，不直接传输音频流。

## PNDS 中的 OSC 路由

| 音频模式 | 接收方                     | 消息与目标归属                                                            |
| -------- | -------------------------- | ------------------------------------------------------------------------- |
| Internal | App 管理的 scsynth         | 工程按标准 scsynth OSC 协议控制 SynthDef、节点和 buffer；目标由 Host 注入 |
| External | 用户配置的外部合成器或设备 | 作品定义音乐消息语义；Host 注入本次应用的外部 OSC target                  |
| None     | 不启用音频目标             | 乐谱页面和网络交互可运行，不因此产生声音                                  |

作品自行定义触控、参数与声音的映射；这些艺术语义与 Host 负责的目标配置不同。`PNDS_OSC_TARGET` 的值和模式区别见[运行环境变量](./runtime-contract.md#3-app-注入的环境变量)，三模式比较见[音频模式](./audio-modes.md)。更改外部目标在下次启动／手动重启应用。

编写 SCD 后，在创作模式的文件工具栏编译，再重启采用 `.scsyndef`；源码、产物和编译要求见[SynthDef 编译契约](./supercollider.md#synthdef-编译契约)。
