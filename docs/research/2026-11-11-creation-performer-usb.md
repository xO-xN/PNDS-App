# 无路由器环境下的创作测试与手机演奏端

调查日期 2026-11-11。范围为创作模式中让真实设备的浏览器打开作品的 performer 页面，操作作品并让 Mac 接收输入。

## iPhone 真机结果

在 macOS 27.2 上，使用数据线连接并信任 iPhone。Finder 能打开设备详情。尝试开启 macOS「互联网共享」并选择 `iPhone USB` 作为输出后，检查未发现有 IPv4 的共享网桥，`com.apple.NetworkSharing` 当时显示未运行。系统设备树确认 iPhone 下的 `en14` 已激活，Mac 端获得 `169.254.171.27/16` 链路本地地址。将此地址选为创作测试的演奏者入口后，用户确认手机 Safari 可以正常使用作品。接口名和地址是这次连接的观测值。 [IPv4 链路本地地址](https://www.rfc-editor.org/rfc/rfc3927.html)

实测时 Mac 仍有其他局域网接口。Mac 完全断开上游后从冷启动建立连接、能否省略互联网共享设置、其他 iOS 版本及 iPad 的同类行为均待验。

## 可行路径

| 路径                             | 所需条件                                                                   | 适用范围                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android USB 反向转发             | 数据线、Mac 上的 Android SDK Platform-Tools、手机开启 USB 调试并授权 Mac   | 预装工具和作品依赖后，无需 Wi-Fi、SIM 或外网。手机 Chrome 打开 `http://localhost:<手机端口>/`。适合作为创作者真机测试工具。 [Android 开发文档](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server) · [Chrome 真机浏览器](https://developer.chrome.com/docs/devtools/remote-debugging/local-server#case-2)                                                                    |
| iPhone USB 个人热点              | 数据线、信任 Mac、运营商和套餐支持个人热点                                 | Mac 获取 `iPhone USB` 网络服务，无需现场路由器。需实测同一台 iPhone 的 Safari 能否访问该接口上的 PNDS 服务，以及无蜂窝信号时的表现。 [Apple USB 热点](https://support.apple.com/en-ca/guide/mac-help/-mchl7594e36f/mac) · [Apple 个人热点要求](https://support.apple.com/en-gb/111785)                                                                                                                      |
| iPhone USB 上的 IP 连接          | 数据线、信任 Mac、Mac 上有手机可访问的 USB 接口地址                        | PNDS 已验证一次链路本地地址。另有开发示例演示开启 Mac 互联网共享后通过共享网桥访问 Mac，示例使用 Mac 的 Wi-Fi 上游。 [Apple 互联网共享](https://support.apple.com/en-sg/guide/mac-help/mchlp1540/27/mac/27) · [Bandwidth 开发示例](https://github.com/Bandwidth-Samples/swift-brtc-sample-application#option-a-internet-sharing-over-usb-recommended-for-local-development)                                 |
| Mac 内容缓存的「共享互联网连接」 | Apple 部署指南要求 Mac 经以太网接入外网，MacBook 接电，iPhone 首次信任 Mac | 手机可关闭 Wi-Fi 和蜂窝数据并通过 USB 使用 Mac 的网络。Apple 将此作为有线内容缓存功能记录。无上游及任意作品端口的行为待验。此功能与普通互联网共享互斥。 [Mac 用户指南](https://support.apple.com/en-ge/guide/mac-help/mchl3b6c3720/mac) · [Apple 部署指南](https://support.apple.com/en-ca/guide/deployment/-dep38ff24bed/web)                                                                              |
| 以太网点对点                     | 手机兼容的 USB-C 转以太网适配器、网线、Mac 的以太网口或第二个适配器        | 两端使用同子网的 IPv4 地址，具备离线运行条件。Apple 明确支持 USB-C iPhone 连接兼容适配器。Android 须按手机和适配器型号验证。 [Apple iPhone 适配器](https://support.apple.com/en-gb/105099) · [Mac 以太网直连](https://support.apple.com/en-ie/guide/mac-help/mchlp1413/27/mac/27) · [Android 兼容性定义](https://source.android.com/docs/compatibility/16/android-16-cdd#745_networking_protocols_and_apis) |

如果现场允许 Wi-Fi，手机开个人热点、Mac 加入、手机浏览器再访问 Mac 热点网段的 IP，是少配置的试验路径。需实测同一手机访问 Mac 以及断网时热点能否维持，普通热点受设备与运营商设置影响。Google 的通用 Android USB 网络共享说明明确排除了 Mac，Android 有线测试用反向端口转发。 [Apple 个人热点](https://support.apple.com/guide/iphone/share-your-internet-connection-iph45447ca6/ios) · [Google 热点与 USB 共享](https://support.google.com/android/answer/9059108?hl=en)

Android 的系统 USB 网络共享随厂商和型号实现而异。AOSP 的共享服务可使用 NCM 或 RNDIS。即使 Mac 上出现了网络接口，也要确认手机浏览器能访问 Mac 的实际接口地址，才能复用 PNDS 的 LAN 入口。Android 手机和平板的单线测试均可先用 Google 文档支持的 ADB 反向转发。 [AOSP 共享实现](https://android.googlesource.com/platform/packages/modules/Connectivity/+/refs/heads/main/Tethering/src/com/android/networkstack/tethering/Tethering.java) · [ADB 反向转发](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server)

Apple 为 iPad 记录了有线上游共享和兼容的 USB-C 以太网配件。iPad 可用前述 iPhone 流程验证实际 USB 地址，也可用兼容适配器接网线。另一台 Mac、Windows 或 Linux 电脑只需能通过有线 IP 网络访问 Host Mac，就可以用浏览器加入创作测试。有兼容雷雳端口的两台 Mac 可用雷雳线和 Thunderbolt Bridge 组网。Linux 的 `thunderbolt-net` 也记录了与 macOS 对端的兼容性。 [iPad USB-C 配件](https://support.apple.com/en-ie/108894) · [Mac 与 Windows 以太网直连](https://support.apple.com/en-euro/guide/mac-help/mchlp1660/27/mac/27) · [Mac 雷雳 IP 连接](https://support.apple.com/en-au/guide/mac-help/mchld53dd2f5/27/mac/27) · [Linux 雷雳网络](https://docs.kernel.org/admin-guide/thunderbolt.html#networking-over-thunderbolt-cable)

如果 iPhone 端允许安装配套 App，Apple 的 Logic Remote 已实现通过数据线连接 Mac，无需共享 Wi-Fi。把此类连接用于完整 PNDS 作品仍需要手机端容器和承载 HTTP 与 WebSocket 的双向传输。Apple 的 External Accessory 文档描述的是与兼容 MFi 外设通信。TouchOSC Bridge 的 USB 连接适合采用 MIDI 的控制界面，其文档所定义的传输内容为 MIDI 消息。 [Logic Remote](https://support.apple.com/en-ie/101885) · [External Accessory](https://developer.apple.com/documentation/externalaccessory) · [TouchOSC Bridge](https://hexler.net/touchosc/manual/connections-bridge)

## PNDS 的接入边界

- 创作底部的网络入口已提供当前工程测试的实际地址、复制和二维码，按工作区和运行世代校验。普通 USB 网络或以太网若产生可达的 Mac IPv4，先用现有 LAN 地址选择器选中该地址，随后启动创作测试并从手机打开 performer URL。初测使用无自定义演奏者地址、无需可信 HTTPS 的作品。 [网络邀请](../developer/network-invitations.md) · [接口筛选](../../src-tauri/src/project/session.rs#L612) · [创作入口](../../src/hooks/use-creation-test-entry.ts)
- Android 反向转发把手机 loopback 的 TCP 端口映射到 Mac 上当前生效的 performer 端口，可以承载 HTTP 与同源 WebSocket。当前前端创作启动要求 `session.lanIp`，Rust 启动校验拒绝 `127.*`。要支持彻底离线，需在两层允许创作测试以 loopback 启动，并在底部网络入口显示与本次测试绑定的手机地址。若内建转发，Stop、换工程、拔线后要处理映射的清理与重建，手机端口稳定有利于保留相同 origin 下的座位认领。 [前端启动门槛](../../src/lib/session-flow.ts#L587) · [Rust 地址校验](../../src-tauri/src/project/session.rs#L1456) · [入口与座位认领契约](../zh-CN/reference/browser-participation.md) · [ADB 命令文档](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/docs/user/adb.1.md#networking)
- 触摸类作品先验证普通 HTTP。摄像头、麦克风、动作等能力需要按浏览器和 API 验收。Android Chrome 的 localhost 可作为安全上下文测试候选，仍需验证实际权限。iPhone Safari 通过普通局域网 IP 访问时，PNDS 可信 HTTPS 方案还需要证书、域名和手机可用的 DNS。作品如果依赖 CDN、远程音频或外部服务，离线测试需要先准备本地资源。 [Chromium 安全上下文](https://new.chromium.org/Home/chromium-security/deprecating-powerful-features-on-insecure-origins/) · [PNDS 可信 HTTPS](../zh-CN/reference/https.md)

## 验证顺序

1. 用已跑通的 iPhone 复测。分别验证省略互联网共享，以及 Mac 断开 Wi-Fi 和以太网上游后重新插线并重新启动创作测试。记录 iOS 版本、实际接口和地址。用拔线后触摸反馈中断确认流量走向。按同样方法测试 iPad。
2. 用 Android 数据线验证 `adb reverse` 到实际生效的 performer 端口。现有 App 可先在有可选 LAN 地址时启动验证转发，再复现完全无 LAN 时的启动门槛。验证离线启动需要覆盖创作启动本身。
3. 每条可达链路分别确认首屏与资源加载、Socket.IO 接纳、触摸触发 Mac 音频或 Monitor 反馈、断线及重连。选用实现了健康名册的作品可额外确认手机在线。对于启用媒体和传感器的作品，单独确认权限与实际输入。 [演奏端连接名册](../zh-CN/reference/browser-participation.md#演奏端连接名册)

## 创作者文档草稿

建议放在[使用教程的「实时测试与 performer 窗口」之后](../zh-CN/app-tutorial.md#实时测试与-performer-窗口)。

### 无路由器时，用有线设备加入创作测试

在 Mac 上运行 PNDS，在手机、平板或另一台电脑的浏览器打开作品的演奏者页。第一次连接可先用 Blank 工程测试触摸。

**iPhone USB 已在一组设备上实测。**

1. 用支持数据传输的线连接 iPhone 和 Mac。解锁 iPhone 并信任 Mac，确认 Finder 侧栏能打开 iPhone 详情。为验证走的是数据线，在 iPhone「设置」里关闭 Wi-Fi、蜂窝数据和个人热点。
2. 在 Mac 的「系统设置 → 网络」查看 `iPhone USB` 的 IPv4 地址。如果暂未出现 USB 地址，可在「通用 → 共享 → 互联网共享」配置 Mac 当前的上游接口，输出选 `iPhone USB` 后重试。有些连接会显示 Mac 自行分配的 `169.254.x.x` 地址。也可以在终端用 `networksetup -listnetworkserviceorder` 查 `iPhone USB` 对应的接口名，再用 `ifconfig <接口名>` 看 `inet` 一行。把占位符换成实际接口名，例如 `ifconfig en14`。
3. 打开 PNDS 创作模式底栏网络菜单，选择这个 **Mac 端的 USB 地址**，再启动测试。如果测试已运行，停止后重新启动。用 iPhone 的 Safari 打开底栏显示的完整 HTTP 地址，保留端口号。
4. 在手机上触摸作品，确认 Mac 上有声音或监看反馈。拔线后再触摸，确认反馈中断。计划在 Mac 也完全离线的环境使用时，在现场条件下重新插线并启动一次，确认还能加入。

**Android 手机或平板可用 USB 调试试接。** 在 Android 开启 USB 调试并授权 Mac。Mac 安装 Android SDK Platform-Tools，启动 PNDS 创作测试后，把实际演奏者端口映射到手机端。例如 PNDS 显示端口 `6868` 时，在 Mac 运行 `adb -d reverse tcp:8080 tcp:6868`，然后在手机 Chrome 打开 `http://localhost:8080/`。如果 PNDS 显示其他端口，替换命令中的 `6868`。当前 PNDS 启动创作测试仍需要 Mac 有一个可选 IPv4，USB 转发本身可以在手机关闭 Wi-Fi 和蜂窝数据时工作。 [Android 反向转发](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server) · [Chrome USB 端口转发](https://developer.chrome.com/docs/devtools/remote-debugging/local-server#case-2)

**支持以太网的设备可用网线直连。** 用网线连接两端的以太网口，或为需要的一端加兼容的 USB 转以太网适配器。为两端设置同网段的不同 IPv4 地址。例如在未被其他接口使用的网段上，将 Mac 设为 `192.168.50.1`，另一端设为 `192.168.50.2`，两边子网掩码都设为 `255.255.255.0`。在 PNDS 选择 Mac 的以太网地址，再从另一端的浏览器加入。支持雷雳的两台 Mac 也可用雷雳线和 Thunderbolt Bridge 建立 IP 连接。 [Apple 网线直连](https://support.apple.com/en-ie/guide/mac-help/mchlp1413/27/mac/27) · [Apple 雷雳直连](https://support.apple.com/en-au/guide/mac-help/mchld53dd2f5/27/mac/27)

摄像头、麦克风和动作传感器按作品要求验证浏览器权限。需要安全上下文的作品见[可信 HTTPS](../zh-CN/reference/https.md)。
