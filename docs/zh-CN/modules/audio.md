# 音频：三模式与作品层

## 应用与状态

Blank 的现场与回放共用 `performance/recording.js` 的应用入口。实际状态和 `applyWork`、`restoreWork`、`releaseWork` 等作品回调放在 `performance/state.js`，再调用 `audio/controller.js` 发声；仅在 server 的现场回调加声音会绕过回放。完整回调和修改位置见工程 `docs/implementation.md`。

## 音频模式

- **internal**：加载工程 `.scsyndef`，写入 Host 注入的私有 bus；Blank 初始输出静音。
- **external**：发送作品定义的 OSC；Blank 初始没有作品消息。
- **none**：不建立音频资源，页面与网络仍运行。

模式和 Host 责任见[音频模式](../reference/audio-modes.md)及[运行契约](../reference/runtime-contract.md)，消息与目标规则见 [OSC](../reference/osc.md)。

## 改这个文件时

按工程实际结构同步维护参数含义、单位、范围、现场／回放应用和快照恢复；只释放作品自有声音资源。修改 SynthDef 时编译并核对产物，纯 JavaScript 映射调整不要求重新编译。步骤见[编译契约](../reference/supercollider.md)。源码、编译、实际加载和听音分别验证。
