# 原生页面与媒体

## 原生 Host monitor 与创作 performer 媒体

macOS App 的主 monitor、投影与创作 performer 测试页使用当前工程的原生页面。资源、Worker 和连接限于受管来源及工程声明的服务。页面无 Tauri 管理权限，原生采集可用于 HTTP 场地。普通浏览器遵守其[安全上下文和权限](./https.md)。

App 在文档启动时提供只读提示。

```js
globalThis.PNDS_MEDIA_SURFACE
// { role: 'monitor' | 'projection' | 'performer', captureAllowed: boolean }
```

主 monitor 负责采集和分析。投影带 `surface=venue` 与 `captureAllowed: false`，原生层拒绝采集。工程须跳过采集和推理，通过自己的通信订阅主 monitor 结果。performer 和池客可手动启用各自的输入。

每页提供手动启用、选择输入和重试。WebKit／macOS 权限绑定当前页面及其来源。设备能否共享由系统决定，失败时保留其他页面的采集。

关闭、刷新、成功替换或退出时释放本页媒体、分析、Worker 与连接。页面结束后收到的迟到流立即停止。隐藏或暂时断网保留页面。
