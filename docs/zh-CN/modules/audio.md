# 音频：三模式与作品层

`audio/controller.js` 是创作者改得最多的文件——作品的**语义**都住在这里：推子控制什么、voice 怎么变成声音、输出怎么路由。传输与引擎原语在 `lib/`，不用动。

## 三模式，一个类

工程的声音由谁发出，由音频模式决定（internal / external / none 三种）。**契约细节——模式如何解析、scsynth 启动、OSC target、App master stage——见参考手册的 [audio-modes.md](../reference/audio-modes.md) 与 [runtime-contract.md](../reference/runtime-contract.md)，本篇不重述。**对 controller 代码而言，模式只体现为 `engine.mode` 分支：

- **internal**：`engine.createGroup` / `createSynth` / `setControls` / `freeNode` 驱动内置 scsynth，工程自带 `.scsyndef`（编译契约见 [supercollider.md](../reference/supercollider.md)）。
- **external**：`engine.send` 把 voice 状态打成 OSC 地址发出——`/c1/amp`、`/c1/freq`、`/c1/out` ……（协议见 [osc.md](../reference/osc.md)）。
- **none**：引擎无音频，controller 的 voice 管理照常运转（页面与网络交互仍在）。

engine 只需满足接口（`mode` / `outputChannels` / `outputBus` 与各命令方法）——没有类检查，测试与替代引擎从这道缝插进来。

## Template 作品层的示例语义

controller 开头的约定就是一整个作品的设计，换成你的作品时照着改：

- 每个加入的乐手一个 voice（internal 模式下是一个正弦 synth）；
- 奇数 id 默认输出通道 1，偶数 id 默认通道 2；monitor 可改任何 voice 的通道；
- 音量在 SynthDef 里封顶 −6 dB（`amp * 0.5`）。

## control 载荷：这条缝上唯一的形状所有者

`lib/protocol.js` 把 `control` 载荷**原样转发**——它的形状完全是作品层的词汇（事件表见[乐手身份与座位](./players.md)）。`applyControls` 是 wire→voice 的唯一入口，同时服务三条路径（首次入座、带状态重生、在线控制），保证它们不漂移：

- 字段逐个读取：`range`（1|2|3，默认 3）、`amp` / `freq`（0..1 原始值）；
- **非有限数字一律忽略**——畸形消息绝不能在演出中把谁的推子归零；未知字段不读。

映射函数也在这层：`mapFreq`（register 区间内线性映射到 Hz；区间来自 `public/shared.js` 的 registers——改区间去那儿改，别在 controller 里抄数字）、`mapAmp`（平方，模拟调音台的音频锥度）。

## 恢复与路由的形状

- `voiceState(id)` / `restoreVoice(id, state)` 是重连恢复形状的唯一所有者：存**原始值**（0..1 加 register 加 out），恢复时重新映射——喂映射后的值进来等于二次映射。
- `addVoice(id, state)` 支持**带状态出生**：一次 `/s_new`（或一轮消息）直接带上正确值，绕开「先默认后恢复」的可听中间态。internal 模式下还会读回一个控制（`verifySynthControl`）证明节点真的建出来了——失败的 join 被拒绝，不留「服务端信着、实际不响」的幻影 voice。
- `setOutChannel(id, channel)` 校验 `1..outputChannels`；`busFor(channel)` 把 1 基的工作通道翻译成物理 bus（`outputBus + channel − 1`）。
- 带状态出生时遇到当前工程路由不了的持久通道（两次运行之间通道数变了），不拒绝设备：落回默认通道，座位记录在下次持久化时自愈。
- `snapshot()` 是 `state` 广播的数据源。

## 改这个文件时

问自己：推子映射改了吗（`mapFreq` / `mapAmp` / registers）？control 字段增删了吗（`applyControls` 是唯一入口，页面侧跟着改）？默认路由变了吗（`defaultOutChannel`）？音量上限还在吗（SynthDef）？这些就是作品语义的全部落点；传输、身份、座位、持久化一概不在这一层。
