# #302／#303／#304／#312：保存入口、网络邀请与完整工程试点

本轮仅处理这四张子票；父 #294 和其余维护源、#313／#314 跨平台安装验收不据此完成。
集成分支为 `codex/issues-302-303-304-312`。保留此前 staged／unstaged／untracked
输入，开始前逐文件快照为 `/private/tmp/pnds-302-303-304-312-baseline/tree`，两轴审查
仅比较本轮增量。隔离实现 worktree 持有相同未提交基线，经精确增量回填；本轮没有
commit、push、tag、正式发行或启动 dev server。

## 已实现行为

- **#302**：池主根页在空闲时即提供本地 manifest、PNDS 图标和双语保存说明。
  保存身份、启动地址和 scope 均为 `/`，名称属于池主，不包含临时工程、演出或加入凭据。
  安装可选；平台提供主屏幕、Dock 或书签／快捷方式。重开需明确进入新演出，地址变化、
  独立数据、安全上下文、离线冷启动和后台／锁屏的边界在页内及双语帮助说明。
- **#303**：完整实际公开 URL、复制、QR、故障、兼容提示与实际端口统一归入底栏网络
  弹层，跨角色／模式可发现。编码复用 App 资源，前后核对 held URL，取消、失败、重试
  和迟到结果有归属。移除 Host 侧栏运行卡、演出独立 QR 和投影覆盖，保留创作真机扫码。
  未适配工程的旧 performer 地址仅作有明确限制的人工回退。
- **#304**：适配指定维护 Template 0.7.2，保留既有音乐、身份与 HTTPS 路径；采用实际
  注入监听器、运行报告、health、相对资源及 scoped Socket.IO。浏览器凭据按池主／工程
  命名，原生私有来源继续使用旧键。Classic 由该维护源冻结，内容清单、哈希与来源一起
  更新；App 新建产物通过公开 Host 和独立 Client 接入。
- **#312**：指定 ASBS 2.1.1 的真实页面、构建资源、实时连接和身份适配统一入口；必需
  分谱完整准备后才交接，缺页／失败保留旧文档。已有身份只准备本人分谱；首次隐藏候选
  无法选择身份，因此先准备全部压缩分谱再开放原有选择界面，不预设身份，不全量解码。
  保留原有自主时钟、滑动解码、暂停／结束及重对齐规则。

## 自动化证据与修复过程

保存入口实际 HTTP 测试覆盖空闲、manifest 固定目标、本地图标字节和双语说明。
显式普通 WKWebView 另保存真实临时 macOS `.webloc`，经系统 plist 解析后在新浏览器
上下文重开，验证本地图标解码、所有资源同源，且新演出未被自动确认。

Template 源检查及完整业务测试通过，Classic 冻结的逐文件哈希与维护源一致。
App 新建 Classic 的正常回归实际占用测试自有端口以触发避让，验证确认、查询、静态
资源和独立 Client 私有来源；显式 WK 另验证实际页面、身份恢复和准备报告。

首次真实 WebKit 检查发现 Template 等待隐藏候选页的绘制帧，导致准备无法完成。
将准备条件绑定到实际 canvas 初始化与 Socket.IO 连接；可见页面动画不再是隐藏候选
的前提。夹具中未显示窗口导致的绘制等待另按真实绘制边界修正。ASBS 首次公开启动
发现 `none` 模式 health 不符合运行契约，修正为 `disabled`／空错误并补 HTTP 回归。
首次完整检查还暴露新增 setup mock 格式问题，格式化后重跑；另一次检查与审查修复同时进行，读到旧组件与新测试的组合，稳定文件后完整重跑。不跳过失败或弱化断言。

## 验证边界

上述 `.webloc`／WK 结果证明保存目标及本机普通浏览器行为，不代表 Safari「添加到
程序坞」或手机「添加到主屏幕」UI 已逐设备验收。真实 iPhone／iPad、Android、Linux／
Windows、最低 macOS、双架构、签名安装、声音／媒体及双机 LAN／WAN 断开现场结果
仍需 #313／#314 记录。ASBS 只承诺已打开且完整准备的分谱断 Host 后继续，不承诺图标
离线冷启动。自动化虚拟时钟只加速工程真实引擎的时间边界，不另建滚谱引擎。

## 结果与复现

Template `npm run check` 与 158／158 业务测试通过，90 文件冻结清单 SHA-256 为
`98ad0e4b0d3803958bc02f3d786ba0c177bfbcde093cdec3f699bb622f44b766`。
ASBS `npm test` 125／125、`npm run check`、构建及预算检查通过，gzip 为
22,984／102,400 字节。维护源基线、精确增量和构建内容哈希见[本轮证据](./evidence/302-303-304-312-pilot-2026-11-09.json)。

实际普通 WK 和原生两条 ASBS 链路均验证缺页失败保留旧文档、B→C 候选竞态、成功后
交接、工程接纳独立于页面准备、主连接失联后的自主与同场重连。完整准备后，停止测试
Host 并撤销原生来源，原文档保持，A1 从未解码的中间页推进到结束页，共绘制 29 页；
资源请求数保持 684→684，峰值 13 位图，无页面错误。两条链路另验证已加载实际 ASBS 时
出现新候选，旧页继续、旧来源返回 409／410，然后停演仍完整滚谱。

全部准备保留压缩字节而非位图。首次 684 张 PNG 共 15,649,302 字节（约 14.9 MiB）；
验证器保留 PNG CRC、几何、deflate 完整字节／滤波检查，仅遍历行首滤波位置，避免逐
像素字节扫描。生产候选准备时限保持 20 秒。真实可见的 ASBS 浏览器夹具显式确认前台
状态；较长的全谱滚动只延长测试完成时限，不修改工程准备或演奏规则。

Standards／Spec 两轴审查均为 0 项未解决发现；审查指出的 QR／复制技术错误丢失及
入口原始故障原因丢失已修复，定向交互回归通过。

可复现命令（GUI 用例依次运行，避免前台窗口争用）：

```sh
npm run check:all
cargo test --manifest-path src-tauri/Cargo.toml plain_browser_saved_root -- --ignored --nocapture
PNDS_TEMPLATE_SOURCE='<维护清单的 PNDS Template>' cargo test --manifest-path src-tauri/Cargo.toml plain_browser_maintained_template -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml plain_browser_created_classic -- --ignored --nocapture
PNDS_ASBS_SOURCE='<维护清单的 All-Sentient-Being-Sounds>' cargo test --manifest-path src-tauri/Cargo.toml plain_browser_actual_asbs -- --ignored --nocapture
PNDS_ASBS_SOURCE='<同一已构建 ASBS 维护源>' npm run native:client:entry:verify
```

本轮完整 `npm run check:all` 已通过：前端 313 文件通过／1 跳过、3,666 测试通过／2
跳过，主 Rust 970 通过／21 项显式夹具忽略，其余工作区及所有静态检查通过。显式 GUI
检查另按上述命令执行，不把默认忽略当作实机证据。最终夹具扩展与证据归档后完整重跑退出码为 0。

## 工作区收尾

App、Template 和 ASBS 的 staging 均与各自开始快照逐字节一致。业务成果保留在原始
App 集成工作区及指定维护源，没有创建业务提交。尝试通过 managed worktree API
归档三个隔离实现工作区时，App 分别以“另一个活跃任务仍使用”和“当前任务主工作区
不可移除”拒绝归档；三者因此保留，没有绕过保护强删。权威集成目录仍为原始
`PNDS-App-main`，分支 `codex/issues-302-303-304-312`。
