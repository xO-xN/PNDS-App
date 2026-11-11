# PNDS 参考手册

本册定义工程与 App 的接口。操作步骤见[使用教程](../app-tutorial.md)，创作路线见[创作指南](../template-guide.md)，默认基础与可选能力见[模块手册](../modules/README.md)。

## 工程与资源

- **数字乐谱是什么？** → [数字乐谱](./digital-score.md)
- **工程目录、README 与私有创作数据如何组织？** → [工程结构](./structure.md)
- **manifest 字段、能力声明和路径限制？** → [manifest.json](./manifest.md)
- **App 共享包与工程自带依赖如何共存？** → [共享包](./structure.md#app-共享包)
- **.pnds 包含什么，如何打包、安装和分发？** → [工程包](./pnds-bundle.md)

## 运行、声音与页面

- **monitor、performer 与 App 分别负责什么？** → [角色与所有权](./runtime-contract.md#1-参与者与所有权)
- **启动环境、health 与关停要求？** → [运行契约](./runtime-contract.md)
- **受管端口和监听器如何交接？** → [Runtime ports v1](./runtime-ports.md)
- **Internal、External、None 有什么区别？** → [音频模式](./audio-modes.md)
- **私有 bus 与硬件输出如何对应？** → [多通道音频](./runtime-contract.md#7-internal-多通道音频)
- **SynthDef 如何编译，OSC 发给谁？** → [编译契约](./supercollider.md)、[OSC](./osc.md)
- **页面能依赖哪些键盘、指针和触摸事件？** → [页面交互](./page-interaction.md)
- **投影与参数预演如何接线？** → [投影面](../modules/projection-surface.md)、[预演协议](./parameter-preview.md)
- **可选的 p5 视觉路线如何离线加载？** → [p5.js](./p5js.md)

## 参与、媒体与录制

- **浏览器确认、资源地址和断线保页遵守什么协议？** → [浏览器演奏接入](./browser-participation.md)
- **如何上报已接纳的演奏端？** → [连接名册](./browser-participation.md#演奏端连接名册)
- **工程如何接入录制、回放与叠加？** → [演奏记录协议](./performance-recording.md)
- **原生页面的摄像头、麦克风和投影归谁管理？** → [原生媒体](./native-media.md)
- **LAN、互联网、可信 HTTPS 与 DNS 如何准备？** → [网络](./network.md)、[HTTPS](./https.md)、[DNS](./dns.md)
