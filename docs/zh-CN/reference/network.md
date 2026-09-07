# 演出组网：本地网络与互联网

PNDS 演出建立在普通计算机网络之上。组网形态有两种：**本地网络演奏**（一台 Host 与同一局域网内的演奏者设备）与**互联网 / 远程演奏**（多个站点各自运行 PNDS，跨网络协作）。

页面的端口分配与角色（performer / monitor）不在本页——端口规则见 [manifest.md](./manifest.md)，地址注入与 LAN 地址选择见 [runtime-contract.md](./runtime-contract.md) §4，monitor 页面的要求见同文档 §10。

## 本地网络演奏（局域网）

演出现场只需要一台 Mac 和一个路由器：

1. **组网**：运行 PNDS App 的 Host 与所有演奏者设备接入同一本地网络。Host 建议有线接入路由器，演奏设备（手机 / 平板）连接同一 Wi-Fi。
2. **启动**：App 加载工程后，工程的 performer / monitor 两个 server 在 Host 上运行。App 枚举可用的 LAN 地址——多地址时由操作者显式选择，选定地址作为 `PNDS_HOST_IP` 注入工程（runtime-contract §4）。
3. **接入**：演奏者在自己的设备上打开 `http://<Host-LAN-IP>:<performerPort>/`——扫描工程 monitor 页上的二维码（若工程提供，如 PNDS Template），或在浏览器手动输入地址。monitor 页由 App 窗口显示，可投放到演出场地的大屏。

具体的加载与多端接入操作流程见[使用教程](../app-tutorial.md)。

### 自定义连接地址（`performerAddress`）

工程可以在 manifest 声明演奏者连接地址字符串（如 `mywork.local`）：注入给工程的连接地址、monitor 地址与二维码显示的就是它，而不是数字 IP（字段格式与容错见 [manifest.md](./manifest.md)，注入语义见 [runtime-contract.md](./runtime-contract.md) §3）。未声明的工程行为与今天完全一致——App 注入选定的 LAN IPv4。

使用自定义 `.local` 地址的操作纪律：

- `.local` 是 mDNS 本地主机名，它解析到谁取决于每台机器自己的主机名：声明 `mywork.local` 的工程，运行它的 Mac 的本地主机名（系统设置 → 通用 → 共享 → 本地主机名）必须就是 `mywork`。同一份工程在多台 Mac / 多个站点运行时，**各节点主机名同名**，`mywork.local` 才能在各自网段解析到运行它的那台机器；
- 主机名不符时该地址解析失败或解析到别的机器——monitor 打不开、手机连不上，通常就是这条纪律被破坏的信号。缺省的回落方式始终可用：不声明 `performerAddress`，App 注入选定的 LAN IPv4；
- Android 对 `.local` 的 mDNS 解析（浏览器内）实现不一，兼容性待真机验证——用自定义地址面向 Android 演奏者时，务必在演出用的真机上提前扫码验证，不通则回落 IP 注入。

工程侧的座位、断线重连与作品数据协议由工程自己实现——PNDS 不规定 Socket.IO 事件名、客户端 ID、角色数量或 UI 框架。

## 互联网 / 远程演奏

PNDS 池谱，寓意「多池相连」：每个池塘（本地演奏系统）聚集一群人的表达，PNDS 将这些池塘相连，构成一个独特的表达场域（跨互联网演奏系统）。

多个站点（多台 Mac）各自运行 PNDS、加载同一个支持互联网演奏的工程，即可跨网络协作演出。App 不做 NAT 穿透、不集成网络音频传输——组网由中继服务器承担，站点间实时音频由外部方案承载。

### 星型 hub 中继（标准方案）

标准组网是一台公网 VPS 上的中继服务器 [pnds-hub](https://github.com/xO-xN/pnds-hub)：各站点的工程进程以 Socket.IO 连接 hub，hub 按 token 鉴别、按房间隔离转发站点间的控制 / 数据消息。工程侧实现 hub 协议（连接、房间、事件语义），App 只负责把节点身份配置交给工程（注入四个环境变量，见 [runtime-contract.md](./runtime-contract.md) §3）。

从操作者视角看，这套方案给出三个保证：

- **出站连接**：每个站点只发起出站连接，演出场地无需开放任何入站端口；hub 侧由 TLS 反向代理承载加密。
- **房间隔离**：一场演出一个房间。房间不由人手填——App 按工程 id 与侧栏 Room 分组号（1–3，按工程记忆，默认 1）自动派生，同一作品同分组即同房，开错工程或别的作品闯入从机制上不可能同房；hub 还拒绝同房间同名节点，撞名即配置错误的信号。
- **token 不入 URL**：token 是 App 设置「节点」栏的独立字段（遮蔽显示），只在连接握手时出示，绝不拼进 hub 地址——地址可以安全地出现在日志、截图与排障对话里。

操作流程（逐步细节见[使用教程](../app-tutorial.md)「跨互联网演奏」）：

1. 在公网 VPS 上部署 pnds-hub（部署指南在其仓库：systemd 服务 + TLS 反向代理，安装时生成共享 token）；
2. 各站点在设置「节点」栏填节点名、hub 地址与 token——App 全局一份，manifest 声明 `telematic: true` 的工程启动时注入，未声明的工程完全不受影响（字段语义见 [manifest.md](./manifest.md)）；
3. 加载 App 内置的 **Telematic Diagnostics** 验证网络：各站点 monitor 呈现同一张星型「花视图」，绿 / 红横幅给出 go / no-go 判定并标注问题链路——即开即测，无需另装任何东西；
4. 加载正式工程演出（工程实现 hub 协议，Telematic Diagnostics 为参考实现）；演奏者照常扫码接入本站点，站点间实时音频由 JackTrip 等外部方案承载。

音频对齐：站点之间的实时音频由外部方案承载（如 JackTrip）。App 只负责各站点本地的工程音频总线（见 [audio-modes.md](./audio-modes.md)），不参与站点间传输。

### 远程演奏者接入站点页面（补充手段）

星型方案里演奏者只接入**本站点**（本地网络演奏）。当演奏者人在异地、需要接入某个站点的 performer / monitor 页面时，网络可达性有三条路——best-effort 指引，不由 App 保障：

- **虚拟局域网（推荐）**：演奏者设备安装 VPN 组网工具（如 Tailscale、ZeroTier），获得虚拟网 IP 后如同身处站点局域网——扫码或手动输入地址的接入流程照旧，工程无需改动。
- **端口转发**：站点有公网 IP 时，把工程的 `performerPort` / `monitorPort` 从路由器转发到 Host，远程演奏者用公网地址接入。server 将暴露在公网上，须自行评估风险。
- **封闭内网直连**：实验室、校园网等互通的私有大内网中，演奏者设备直接互访站点——与本地网络演奏相同。

工程视角：工程本身不区分本地与互联网——同一工程在两种网络下的运行方式相同；跨站点的时序、延迟与不同步是作品的创作命题，由工程自行处理。
