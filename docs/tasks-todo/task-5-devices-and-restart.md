# Task 5: 输出设备、External target、LAN IP 与 session 重启

对应 Phase 5。需求引用：§6.5（输出设备）、§6.6（External target）、§7（网络）、§8.3（切换与重启）。

## 目标

音频设备、OSC target、网络地址的选择与变更全部通过完整 session 重启生效，无热切换。

## 工作内容

- CoreAudio 输出设备（§6.5）：枚举设备；默认系统输出；选择存为本机 App 偏好（复用模板偏好持久化层）；启动恢复，设备不存在时回退默认并提示；**不得**写入工程 manifest
- External OSC target（§6.6）：侧栏输入框默认预填 `127.0.0.1:3333`；校验 `host:port`，无效禁止启动；生效时注入 `PNDS_OSC_TARGET`；按工程保存上次有效 target（已确认实现此项可选功能）
- LAN IP（§7）：检测可用 LAN IPv4；多个时**必须用户显式选择**（不得自动取第一个）；注入 `PNDS_HOST_IP`（工程已消费，见 Inarticulate III `server.js:635`）；不用 127.0.0.1 作演出地址
- session 重启（§8.3）：切换工程 / 音频模式 / OSC target / 输出设备 → 完整重启；已有工程运行时先确认"将关闭当前服务器"

## 验收

- 四类变更均通过 session 重启生效，重启后状态正确（§15-6）
- 设备偏好与 per-project target 偏好跨启动恢复；失效设备回退有提示
- 多 LAN 地址时未经选择不启动
