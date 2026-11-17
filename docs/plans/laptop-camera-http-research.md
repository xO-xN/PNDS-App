# 笔记本演奏端通过 HTTP 使用摄像头的评估

状态：研究笔记，未采纳、未实施；不改变现有 HTTPS 或工程运行契约。检索日期：2026-10-31。范围是浏览器采集演奏者笔记本的摄像头，以及 Sensor Meter 的手势数据回传。

## 结论

**更换成笔记本不会使远程局域网 HTTP 页面获得摄像头权限；在笔记本自己的 `localhost` 提供页面，则可以利用本机来源的例外，省去公有证书与路由器 DNS 配置。** 后一种路径要求该笔记本运行本地服务或代理，仍须确认摄像头权限和网络连通性。

依据是 [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/#navigator-interface-extensions) 将 `navigator.mediaDevices` 限定为 `SecureContext`；[Secure Contexts §3.1](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy) 将回环地址和符合本地解析要求的 `localhost` 视为潜在可信来源。普通局域网私有地址不因连接同一个 Wi-Fi 而获得这一待遇。

| 使用方式                                                | 浏览器来源                     | 摄像头判断                                                       |
| ------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| 笔记本打开另一台 PNDS 主机的 HTTP 页面                  | `http://192.168.1.10:6868/`    | 不满足安全上下文要求，不能作为正常摄像头入口。                   |
| 笔记本本身运行 Sensor Meter，使用外部浏览器打开本机页面 | `http://127.0.0.1:6868/`       | 符合回环来源规则，可进入摄像头授权流程；本次未做实体摄像头验收。 |
| 每位演奏者运行本地代理，再打开本机页面                  | `http://127.0.0.1:<本地端口>/` | 原理可行，需要新增演奏端代理与接入流程。                         |
| 笔记本直接打开现有可信 HTTPS 入口                       | `https://演出域名:端口/`       | 沿用现有入口准备，笔记本无需本地代理。                           |

`localhost` 指浏览器所在设备自身，不能把主机地址简单替换为 `localhost` 就连接另一台电脑；本机必须有服务接收连接。[RFC 6761 §6.3](https://www.rfc-editor.org/rfc/rfc6761.html#section-6.3) 规定该名称应解析为回环地址。浏览器对摄像头的授权仍是独立步骤，安全上下文只是前置条件。[Media Capture 权限流程](https://www.w3.org/TR/mediacapture-streams/#dom-mediadevices-getusermedia)

## 当前 PNDS 与 Sensor Meter 的边界

当前正式使用路径由 [HTTPS 准备指南](../zh-CN/reference/https.md) 定义：Host 提供可信 HTTPS 网关，并由场地 DNS 把演出域名解析至 Host 的局域网地址。当前工具通过 `needsHttps: true` 声明其安全上下文需求。

检查源码来源 `../PNDS-1.6.2-projects/Mobile-Sensor-Meter` 可见：`server.js` 在 performer 端口监听 `0.0.0.0`，当前 manifest 的 performer 端口为 `6868`；`public/performer.js` 通过同源 `io()` 连接服务，把 `navigator.mediaDevices.getUserMedia` 交给手势控制器，并通过 Socket.IO 发送归一化手势样本。摄像头画面和模型推理在演奏者设备上处理，此路径没有把视频作为手势样本发送给 Host。线程与设备验收边界见 [sensor-meter.md](../developer/sensor-meter.md)。

据此推断，外部浏览器在运行该工具的同一台笔记本上访问回环 HTTP 地址，能够满足浏览器来源要求。但不能据此宣称当前 App 的内嵌演奏窗口已经支持摄像头；内嵌 WebView 的系统权限、应用配置和行为需要单独验证。

## 可评估的简化方案

对“Host 是一台电脑，演奏者各用自己的笔记本”的情况，建议先验证本地完整代理：

```text
演奏者浏览器 → 本机 HTTP 代理 → 局域网 HTTP → PNDS Host
摄像头与手势推理在演奏者笔记本完成，样本沿同一连接回传。
```

浏览器应从同一个本机来源获取 HTML、脚本、Worker、模型和 Socket.IO；代理同时处理 HTTP polling 与 WebSocket 升级。这样更接近工具现有的同源实现，避免让页面另行直连远程 Host。代理只绑定回环接口，并让演奏者明确选择要加入的 Host。这是架构建议，本次没有实现或验证。

本机来源的例外不会给代理上游的局域网 HTTP 增加加密或完整性保护。若页面脚本经明文网络获取，仍须评估网络中的篡改风险；正式设计可考虑将可信采集代码随接入器分发，并限定连接目标。[Secure Contexts 威胁模型](https://www.w3.org/TR/secure-contexts/#threat-models)

不要把“本机 HTTP 页面直接连接任意远程 HTTP/WS 地址”当作所有浏览器的保证：安全上下文、混合内容、跨源限制与本地网络权限是不同检查。Chrome 的 [LNA 说明](https://developer.chrome.com/blog/local-network-access) 描述了局域网访问授权；[Chrome 147 发布说明](https://developer.chrome.com/release-notes/147#local-network-access-restrictions-for-websockets) 已将限制扩展到 WebSocket。旧说明中 WebSocket 尚未纳入的文字不应继续作为现状依据，具体来源与目标组合仍需按目标浏览器实测。

## 演奏端 App 是否能把配置收敛为安装与加入

**可以开发一个通用的 PNDS Performer 客户端，分发给每位笔记本演奏者；无需为每台电脑或每部作品分别开发 App。** 按支持的操作系统与架构提供构建，运行时选择 Host、加载该次演出的页面和资源即可。这是基于现有同源页面与数据协议的可行性判断，不代表当前已经交付该客户端。

适合先验证的版本是“本地代理接入器 + 外部浏览器”：接入器接收 Host 的局域网 HTTP 地址，启动仅绑定回环接口的完整代理，再打开本机地址。Host 可保留现有 performer HTTP 服务，演奏者无需配置证书、域名或路由器 DNS。摄像头权限由浏览器处理，当前手势采集、Worker 推理和样本协议可以优先复用。不同作品仍须满足共同的网页与连接契约，不能把兼容当前 Sensor Meter 推广为兼容任意工程。

现有 `src-tauri/src/project/session.rs` 的 `resolve_entry_launch` 在 HTTPS 开关未启用时返回普通 HTTP 路径，原型可沿用这一入口。客户端本机模式不能作为删除 `needsHttps: true` 声明的理由：直接使用手机或远程浏览器加入的路径仍需要可信安全上下文。

后续若将浏览器合入 App 内嵌窗口，仍要提供安全的本机页面来源，并实现、验证 WebView 和系统的权限流程；给远程 HTTP 页面套一个 App 外壳不会自动解决摄像头限制。[Tauri v2 的 macOS 打包文档](https://v2.tauri.app/distribute/macos-application-bundle/#native-configuration) 给出了 WebRTC 摄像头用途说明的配置入口；[Apple 的授权要求](https://developer.apple.com/documentation/avfoundation/requesting-authorization-to-capture-and-save-media) 要求 App 提供 `NSCameraUsageDescription` 并取得用户授权。Windows 同样受[摄像头隐私设置](https://learn.microsoft.com/en-us/windows/apps/develop/camera/camera-privacy-setting)控制。若改用原生摄像头采集后桥接给乐谱，还需另行设计视频帧、推理和生命周期接口，工作范围大于代理方案。

最小加入体验可以是“安装客户端 → 连接演出网络 → 输入或粘贴 Host 地址 → 授权摄像头 → 演奏”。自动列出演出主机需要 Host 公告服务或其他发现机制，不能仅由客户端凭空获得，也不是当前已实现的能力。首次摄像头授权、适用的局域网访问授权、Host 防火墙放行和 Wi-Fi 设备互访仍须满足；目标是减少配置，不能承诺零配置。

代理还必须保留座位与身份的隔离。当前 Sensor Meter 在 `public/shared.js` 使用固定 `tokenKey`，`public/performer.js` 从 `localStorage` 恢复 token，而浏览器存储按来源隔离；若让所有 Host 和工程复用同一回环端口，就会合并原本分离的存储与缓存范围。[Web Storage 规范](https://html.spec.whatwg.org/multipage/webstorage.html#the-localstorage-attribute) 定义了这一来源边界。客户端需要为目标 Host 与工程建立稳定隔离；演出切换按工程身份合同处理，同一工程断线重连应继续恢复原身份，不能每次重连都轮换来源或清除 token。具体映射方式待原型选择。

下一步若做原型，应验证两台真实笔记本上的摄像头授权、首次推理、连续样本、polling/WS、断线重连、前后台切换与退出释放。普通 Wi-Fi 仍须允许设备互访；省去证书和 DNS 配置不等于能够绕过访客网络隔离。本次仅完成文档与源码评估，没有启动开发服务或调用实体摄像头。
