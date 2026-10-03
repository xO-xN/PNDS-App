# 演出 DNS 后台服务（#174）

在 #139/#140 的 HTTPS 入口之上交付的第三块：**随 App 分发的后台 LAN DNS 守护进程**（普通转发 + 演出域名映射生命周期）。架构决策与选型依据在 [ADR-0009](../adr/0009-performance-dns-as-launchdaemon.md)；操作者视角在 [dns.md](../zh-CN/reference/dns.md)；契约在 [runtime-contract §16](../zh-CN/reference/runtime-contract.md)。本文记录工程结构与接线约定。

## 结构与所有权

- **`src-tauri/dnsd/`** —— 独立守护进程 crate（workspace 成员，二进制 `pnds-dnsd`），**不链接 App 代码**；以 root 监听 UDP/TCP 53：
  - `engine.rs` 查询管线（纯逻辑 + 真实 socket 测试）：hickory-proto 编解码；演出映射合成（A 短 TTL=10s、其余类型空 NOERROR——AAAA 空洞不拖垮 A；已知但未映射 → 本地 NXDOMAIN，绝不转发）；普通转发透传原始字节（保留 EDNS0），逐上游 2s 超时、整体 6s 预算、TC→TCP 回退；缓存硬上限（正 ≤300s、负 ≤10s、容量 512，超限先清过期再丢最旧一半）；租约 5–300s 可配（App 用 60s）；
  - `control.rs` 控制面（Unix socket line-JSON）：七动词 `status / mapping.set / mapping.refresh / mapping.clear / config.set / verify / stop`；写操作按对端 uid 鉴权（root 或 /dev/console 属主）；`verify` 在守护进程内走真实管线自证映射；
  - `state.rs` 持久化（固定监听地址 + 上游 + 已知演出域名；tmp+rename 原子写；**活跃映射不持久化**——属运行中 App；写入由 `run()` 的 200ms 巡检对比快照触发，`config.set` 的监听地址变更经持久化 + 自重启生效）；
  - `server.rs` UDP/TCP 监听循环 + 租约巡检（并发上限 128，超限丢弃）；
- **`src-tauri/src/dns/`** —— App 侧接缝：`service.rs` SMAppService 封装（objc2-service-management，register/unregister/status/openSystemSettings）；`client.rs` 控制 socket 客户端（每请求一连接，纯 JSON，无 shell）；`mod.rs` 编排（enable 轮询就绪、install_mapping 含守护进程内验证、refresh_mapping、remove_mapping 尽力而为）；
- **plist**：`src-tauri/launchd/com.xo-xn.pnds-app.dnsd.plist`，经 `bundle.macOS.files` 放进 `Contents/Library/LaunchDaemons/`；二进制经 `externalBin`（`binaries/pnds-dnsd`）进 `Contents/MacOS/`；plist 用 `BundleProgram`（bundle 相对路径）——App 移动不断链。

## 接线约定

- **生命周期**：安装点在 `session.rs` `start_generation` 的入口绑定之后（与 #140 入口同 seam，一次偏好读取同时决策两者——`resolve_dns_mapping` 纯函数，矩阵测试锁定）；撤销在 `teardown_children` 内紧跟入口关闭；租约监督线程 generation-guarded，20s 续期；
- **快照**：映射事实经既有 `pnds:session` 快照承载（`dnsMapping`：off/ready/error，**无 preparing**——安装+验证同步完成）；映射故障永不使 session 失败（与入口同纪律）；
- **偏好**：`dnsEnabled` 走既有序列化保存队列；上游为 App 内置默认（`dns::DEFAULT_UPSTREAMS`），启用与每次 App 启动推给守护进程，不再有编辑 UI（#174 打磨轮次收掉——控制面 `config.set` 缝隙仍接受 IP 列表）；活跃映射不持久化；
- **设置区**：`DnsSection` 挂载在「可信 HTTPS」之后；mount 拉一次守护进程真实状态（`dns_service_status` 裸返回——守护进程下线是状态事实不是命令错误）；开关失败自动回弹且不持久化；`requiresApproval` 提供打开系统设置的直达按钮。

## 发行与验证边界

- `npm run dnsd:build`（当前架构）/ `dnsd:build:all`（双架构）产出 `src-tauri/binaries/pnds-dnsd-<triple>`；
- **未完成、也不得用开发环境冒充**（#174 验收条）：真机签名后的 LaunchDaemon 注册流程、系统授权弹窗、升级/重启恢复、TL-WR800N 真机验收。开发环境（未打包 bundle）里 `plist_path()` 为 `None`，`dns_service_enable` 如实报错——这是设计行为，不是 bug。
