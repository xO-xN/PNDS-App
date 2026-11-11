# 运行端口与监听器交接

## Runtime ports v1

工程声明 `scoreServer.runtimePorts: 1` 后，App 按 manifest 首选端口绑定两个监听器。端口冲突时改用系统分配的可用端口。实际端口在本次运行中固定，绑定失败时启动失败。

子进程从 `PNDS_RUNTIME_PORTS` 读取 UTF-8 JSON。

```json
{
  "version": 1,
  "runId": "fresh-opaque-run-identity",
  "reportPath": "/opaque-private-startup-path/bound.json",
  "services": [
    { "role": "performer", "port": 51001, "fd": 12 },
    { "role": "monitor", "port": 51002, "fd": 13 }
  ]
}
```

工程按 `role` 对应 HTTP 服务，用 `server.listen({ fd })` 接管监听器，并用 `service.port` 配置实际端口。两个回调完成后，在 `reportPath` 同目录写临时文件，再原子重命名为该报告。

```json
{
  "version": 1,
  "runId": "fresh-opaque-run-identity",
  "status": "bound",
  "services": [
    { "role": "performer", "port": 51001 },
    { "role": "monitor", "port": 51002 }
  ]
}
```

失败报告使用同一 `version` 和 `runId`，返回 `status: "error"`、`services: []` 及可读的 `error`。报告上限 4096 字节，仅供本次启动使用。报告缺失、超时、不匹配、明确失败或提前退出都会使启动失败。App 在检查 health 前核验报告与监听器归属。

[Health](./runtime-contract.md#5-health-contract) 的 `scoreServer` 须返回实际 `performerPort`、`monitorPort` 及 `runtimeRunId: runId`。没有环境变量的独立运行沿用固定端口。[公共入口](./browser-participation.md)使用独立端口。
