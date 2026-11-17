# 浏览器参与与演奏入口

## 浏览器演奏接入协议 1

池主的公共 LAN 入口与工程实际 performer 端口分开。`GET /` 显示当前工程和演出，空闲时显示等待。`GET /__pnds/participation` 提供 `protocolVersion: 1`，兼容演出附带 `browserParticipation: 1`。未适配工程显示提示。

App 使用所选 LAN IPv4，排除已识别的 VPN 接口。只有一个可用地址时自动选择，有多个且无有效选择时由用户选择。公共入口优先使用上次端口，冲突时重新分配并公布完整地址。Host 核验 health 转发后开放接入。故障通过 `clientEntryError` 报告，关闭 HTTP／WS 转发，本地工程和音频继续运行。关闭后重新启动入口可恢复。停止工程撤销转发，仍在线的入口可报告 `performance: null`。

1. 用户确认后，入口发送 `POST /__pnds/enter/<hostId>/<projectId>/<performanceId>`。当前兼容演出返回 303 到 `/__pnds/run/<opaque-grant>/`，过期确认返回 409。grant 只用于该次演出，Stop 或换演出即撤销 grant 和活动隧道。
2. 工程先加载 `./__pnds/context.js`，从 `globalThis.PNDS_PARTICIPATION` 读取 `protocolVersion`、`hostId`、`projectId`、`performanceId`、`basePath`、`storagePrefix`、`resource(relative)`、`storageKey(key)` 和 `socketOptions`。用 `io(location.origin, {...context.socketOptions})` 连接。
3. 页面、资源、Worker 的加载与 fetch、Socket.IO polling 与 WebSocket 均使用确认前缀。工程用 `resource(relative)` 解析资源，Worker 按自身脚本 URL 解析。Host 核验后移除前缀再转发。已确认的原生页使用同一上下文，base 为 `/`。独立运行的 Blank 没有 Host 上下文。
4. 长期浏览器键使用 `pnds:<hostId>:<projectId>:`，跨演出复用。该命名空间仅区分工程数据。存储是否共享取决于 origin、浏览器配置和图标实例。

必需资源和初始化完成后调用 `reportPrepared()`。它保存 `preparation`，触发 `pnds:prepared` 并向同源 parent 发送 `{type:'pnds:prepared',protocolVersion:1,hostId,projectId,performanceId,resourceScope:'page'}`。Blank 在演奏者获接纳且 claim 保存后报告。

必需资源或初始化失败时调用 `reportPreparationFailed()`。它保存 `preparationFailure`，发送同样身份字段的 `pnds:preparation-failed`。准备前的缺失脚本、致命初始化错误和未处理的初始化拒绝会自动报告。Host 核验候选窗口、三项身份和最新演出后替换页面。失败或取消保留当前页，重试创建新候选。Stop、失联或发现新演出时保留已打开文档。

## 完整 performer URL 与可信 HTTPS

证书、域名与端口配置见 [HTTPS](./https.md)。普通 LAN 演奏用上面的浏览器接入协议。

### 变量与能力声明

`scoreServer.supportsPerformerUrl: true` 表示工程支持完整 performer URL 与同源连接。需要安全上下文的作品另声明 `scoreServer.needsHttps: true`。两项均声明、开关开启且配置有效时启用 HTTPS。声明需要但未适配时，开启开关后须明确选择「使用 HTTP 启动」。

有 `PNDS_PERFORMER_URL` 时，工程原样使用该根 URL。缺省为 `http://<PNDS_HOST_IP>:<performerPort>/`。脚本与 Socket.IO 使用 performer 页的当前 origin。

### 工程身份与入口接入上下文

入口绑定 `manifest.id` 和当前演出。页面角色由服务端确定。使用 `__config.js` 时由服务端提供 `role`，共享外部端口不可用于判断角色。monitor 使用工程内部监听器。工程管理演奏者[接纳与恢复](../modules/players.md)。

### claim token 与 origin

claim token 按浏览器 origin 存在 localStorage。协议、域名或端口变化时，设备按新 origin 的加入规则处理。

### 故障、重试与隔离

绑定、材料校验或网关创建失败时，本次启动失败。工程就绪后 10 秒内未探测成功，或入口在运行中失效时，入口报错并保留 URL，本地服务与音频继续运行。手动重启演出恢复，配置改动在下次启动生效。结束演出关闭其入口，旧邀请无法进入新演出。

## 演奏端连接名册

在 `GET /__pnds/health` 的可选 `performers` 字段中列出已接纳且在线的演奏端。断开时移除，重连时替换连接。缺少字段、无效名册或读取失败时，App 显示未知状态。

```json
{
  "performers": {
    "schemaVersion": 1,
    "clients": [
      {
        "id": "ephemeral-connection-id",
        "label": "Performer 3",
        "testClient": null
      },
      {
        "id": "test-connection-id",
        "label": "Performer 1",
        "testClient": "performer-00000000-0000-4000-8000-000000000001"
      }
    ]
  }
}
```

最多 128 项。`id` 是唯一临时连接 ID，最多 128 个 UTF-8 字节，`label` 为可读名称，最多 160 个 UTF-8 字节。两者均非空且不含控制字符。名册排除凭据、IP 和作品数据。

创作测试页携带 `pndsTestClient=<窗口 UUID label>`。工程可以回显为 `testClient`，仅供 App 匹配窗口。普通浏览器返回 `null` 或省略。名册读取上限 64 KiB。

### App 内置演奏端二维码

App 提供二维码。操作见[演奏端二维码](../modules/qr.md)。
