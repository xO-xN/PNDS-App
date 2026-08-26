# 音频模式

音频模式决定工程的声音由谁发出，可在 App 左侧栏中查看与切换：

| 模式           | 说明                                               |
| -------------- | -------------------------------------------------- |
| Internal Synth | 使用 App 内置的 `scsynth` 与工程自带的 `.scsyndef` |
| External Synth | 将 OSC 发送到用户指定的外部合成器或设备            |
| None           | 不使用音频，仅运行乐谱与网络交互                   |

运行时行为（scsynth 启动、OSC target、App master stage）见 [runtime-contract.md](./runtime-contract.md) §6；模式、设备或 External target 的变更通过完整 session restart 生效，不做运行时热切换。
