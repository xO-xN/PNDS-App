# 演出组网：本地网络与互联网

本页说明网络分工；加载、邀请和加入操作见[使用教程](../app-tutorial.md#5-加载工程与多端联演流程)。

## 本地网络演奏（局域网）

Host 与参与设备接入同一 LAN，Host 宜使用有线连接。Host 运行工程和所需音频，设备通过 App 底栏网络弹层的完整公开入口或二维码明确进入演出。公共入口与每次运行的内部 performer／monitor 端口分开，见[参与协议](./browser-participation.md)。

### 自定义连接地址（`performerAddress`）

该字段影响工程收到的主机地址；格式见[manifest](./manifest.md)，注入语义见[运行环境](./runtime-contract.md#3-app-注入的环境变量)。它不等同于池主公共入口，也不自动配置域名解析。使用 `.local` 或其他域名时，须在参与设备上确认其解析到正确 Host。

普通浏览器的安全上下文需求见[HTTPS](./https.md)，App 原生页面的媒体边界见[原生媒体](./native-media.md)。

## 互联网 / 远程演奏

各站点运行自己的 Host，工程经中继交换作品数据。站点间实时音频由外部系统承担，App 不提供网络音频传输或 NAT 穿透。

### 星型 hub 中继（标准方案）

工程向 [pnds-hub](https://github.com/xO-xN/pnds-hub) 发起出站连接，以 token 鉴别、房间隔离消息。App 为声明 `telematic` 的工程注入节点名、hub 地址、token 与按工程／分组派生的房间；token 不拼入 URL。字段见[运行环境](./runtime-contract.md#3-app-注入的环境变量)，采用和工程接线见[hub](../modules/hub.md)。

### 远程演奏者接入站点页面（补充手段）

远程设备须能访问 Host 的完整公开入口；网络路由和访问控制由部署方准备。网络可达不代表媒体授权、声音或时序效果已验证。接入后的确认、资源路径和断线页面保留仍按[参与协议](./browser-participation.md)。
