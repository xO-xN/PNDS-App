# #295／#296／#297／#300：浏览器契约、分谱准备与文档连续性

本轮仅交付 v1.7.0-beta.3 的四个无前置任务。父规格 #294 的其余工程适配、浏览器
候选／成功后切换、原生统一单击切换、保存入口及网络 QR 整合仍由其余子票承接，
不能据本记录宣称整个 beta.3 已完成。已有未提交工作区基线被保留，本轮没有 commit。

## 实现与证据

- **#295**：运行中的公开 Host 提供普通浏览器等待／候选页和精确 POST 确认，签发仅属于
  当前演出的不可变资源前缀。页面、查询、Worker、polling 和 WS 均据此转发到实际工程
  端口；旧确认和旧路径不采用新 cookie。App Blank 创建来源已适配，缺声明的工程明确
  说明需要迁移。协议、页面准备结果和池主／工程长期数据键见
  [browser-participation.md](../developer/browser-participation.md) 与中英参考契约。
- **#296**：改动位于维护源 `PNDS-1.6.2-projects/All-Sentient-Being-Sounds`，源分支
  `codex/issue-296-prepare`。完整取得本人分谱压缩字节、几何和结束页，并按实际内容修订
  核验；保留原页面、窗口解码和跟随引擎。失败不虚报就绪，且仍可显示在线谱面、重试。
  真实 Chromium 同 Document 测试先制造失败并重试，再停止测试自有 Host 且令浏览器
  全部网络 offline；从此前未解码的 A1P15 滚至实际 A1end。A1 共 29 页、664,957
  压缩字节，峰值 13 个活动位图，离线阶段无新增谱图请求。源说明和可复现脚本分别为
  `docs/developer/part-preparation.md`、`scripts/verify-offline-part.mjs`。
- **#297**：节点／LAN 准备就持有实际监听器，空闲可等待；跨 Stop、Creation 和 Client
  保留公开地址。创作测试保持私有，重开优先原端口，受控冲突时显示实际新地址并提醒
  更新保存入口。故障不热迁移或停止健康本地工程。真实绑定／公开启动及只读 UI 事实
  见 [stable-performance-entry.md](../developer/stable-performance-entry.md)。
- **#300**：已加载文档、确认演出、网络接纳和最新候选分开持有。真实超时、503、无效／
  不兼容元数据、Stop、换工程和同地址另一池主均保留原生 Document；旧网络被撤销，
  继续发现候选，不自动加入。同场恢复不调用手动刷新。真实 WKWebView 检查同一内存
  token、`performance.timeOrigin`、持续时钟和 localStorage；显式离开才关闭。
  既有跨原生进程／代理端口的存储恢复测试也通过，见
  [native-client-continuity.md](../developer/native-client-continuity.md)。

首次原生检查／加入另在两个独立 Tauri mock App 上下文验证：Host 持有实际公开运行，
Client 使用自己的 SessionManager 门禁和 ClientCoordinator，经同一公开 URL 加入、
加载实际私有页面及身份脚本，核对三项身份和 `/` base，且 Client 不启动本机工程或音频。

普通 WebKit 公开启动测试使用独立的浏览器进程，没有注入原生身份头、PAC、扩展或
替代 Host 的测试代理。新建 Blank 页面确实报告完成准备；受管集成工程实际运行查询
资源、Worker 及其 fetch、Socket.IO polling 和 WS。A→Stop→B→Stop→A 中原页面
内存、时钟和 Worker 保留，新工程实际请求日志没有旧 HTTP／Worker／polling／WS
探测；受控占用使内部端口变化，公开地址保持，A 长期身份在新演出中恢复。

可复现命令：

```sh
npm run check:all
cargo test --manifest-path src-tauri/Cargo.toml plain_browser_ -- --ignored --nocapture --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml native_document_survives_public_client_discovery -- --ignored --nocapture
npm run native:client:verify
```

ASBS 维护源另执行 `npm test`（119／119）、`npm run check` 和 `npm run check:budget`
（22,519／102,400 gzip bytes），并执行其真实浏览器离线脚本。本轮两轴审查按启动时
工作区快照比较，只审本轮增量，避免把先前未提交工作归入本轮。

## 证据边界

真实浏览器和原生机制证据来自执行机器当前 macOS／浏览器。签名 App、最低 macOS、
arm64／x86_64 实机、真实媒体采集、声音和双机 LAN 仍沿用已有验收清单，不能由
headless／WebKit 接缝代替。没有启动开发服务器，没有发布、打标签或构建远端发行物；
ASBS 证明的是已打开且准备完成的本人分谱，不承诺 Host 离线后的图标冷启动。

## 检查过程

首次普通 WebKit Blank 检查发现 Socket.IO 会修改传入配置；直接传冻结的
`socketOptions` 导致页面未完成准备。改为传副本后，真实 Blank 和完整 Worker／
polling／WS 浏览器场景均通过。审查补齐独立 Host／Client App 首次检查／加入的
证据，并提前注册 Worker 消息处理，避免夹具丢失首条消息。

完整检查依次暴露并修复了测试 fixture 缺少 Node `URL` 声明、新增中文参考链接的
实际 heading slug 不匹配，以及两条旧 Blank 测试仍固定根绝对路径的问题。保留相对
路径业务实现，更新对应契约断言和格式化脚本夹具后，Blank 定向回归为 12 通过、
1 项显式 GUI 测试忽略。没有通过跳过这些失败或放宽行为要求取得检查结果。

最终 `npm run check:all` 退出码为 0：前端 313 文件通过／1 跳过，3,657 测试通过／2 跳过；
App Rust 960 通过／13 忽略，其余 workspace 测试、clippy 和所有静态／格式检查通过。
显式普通 WebKit 两项、原生连续 Document 与跨进程存储机制另按上述命令通过。
Standards／Spec 两轴复审最终均为 0 项未解决发现。
