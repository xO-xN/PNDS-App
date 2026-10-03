# 0009: 演出 DNS 以 SMAppService LaunchDaemon + 独立 dnsd 二进制交付

状态：已接受（#174；父规格 #137）。

PNDS 的演出 DNS 需要一个以 root 监听 UDP/TCP 53 的后台服务：操作者一次性授权后随系统自启，普通域名转发独立上游，演出域名映射跟随 App 会话生命周期。App 主进程不以 root 运行，也不能保存管理员密码，因此监听 53 的代码必须活在独立的 root 守护进程里。我们把该守护进程（`dnsd`）作为 App bundle 内的第二个二进制随 App 分发，用 macOS 13 的 SMAppService LaunchDaemon 注册：plist 内嵌于 `Contents/Library/LaunchDaemons/`，通过 `BundleProgram`（bundle 相对路径）指向 `Contents/MacOS/pnds-dnsd`，App 移动/升级不断链；授权、撤销授权与开关状态全部由系统管理，App 只调用 register/unregister/status。App 与守护进程的通信走固定路径的 Unix socket（line-JSON 协议），按对端 uid（root 或 console 用户）鉴权，协议只有 mapping/config/verify/status/stop 五个受限动词——守护进程不执行工程脚本、不跑 shell、不持有凭据。

DNS 协议层不自研：报文编解码用 hickory-proto（原 Trust-DNS；MIT OR Apache-2.0），转发是"客户端原始字节透传 + 关键接缝解析"——EDNS0 与标志位逐字节保留，只在映射匹配、合成应答、缓存 TTL、TC 截断处理解报文。缓存有硬上限（512 条、正应答 300s、负应答 10s），映射 A 记录 TTL 10s，租约 60s 且 App 崩溃后 ≤ 租约期内过期——负向/正向缓存都不会阻塞下一次演出。

## Considered Options

- SMAppService LaunchDaemon + bundle 内 dnsd（采用）：系统管理授权与自启；App 移动不断链；无第三方安装器。
- SMJobBless / 传统 /Library/LaunchDaemons 安装（否决：macOS 13 起被 Apple 弃用，需自建提权与签名校验链，复杂度与风险显著更高）。
- App 内嵌 DNS 监听 + App 以 root 运行（否决：违反"主 App 不提权"；整个 App 暴露在 root 下）。
- 依赖 Homebrew dnsmasq 等外部服务（否决：现场机器不可假设已装 Homebrew；外部二进制升级与卸载流程失控）。
- 自研 DNS 报文编解码（否决：DNS 语义面大（EDNS0/压缩指针/TCP 分帧/各类 RDATA），手写必错；hickory-proto 成熟、双许可、纯 Rust 无运行时依赖）。
- Bind9/Unbound 等 C 系 DNS 服务器作为分发件（否决：发行体积、许可与配置面都失控，且无法按演出生命周期提供受限控制平面）。
