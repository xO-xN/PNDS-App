# Runtime Ports and Listener Handoff

## Runtime ports v1

With `scoreServer.runtimePorts: 1`, the App binds two listeners using the manifest's preferred ports. On conflict it uses available ports assigned by the OS. Actual ports stay fixed for the run. A failed allocation fails startup.

The child reads UTF-8 JSON from `PNDS_RUNTIME_PORTS`.

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

Match each HTTP server by `role`, adopt the listener with `server.listen({ fd })` and use `service.port` in configuration. After both callbacks complete, write a temporary file in the `reportPath` directory and atomically rename it to the report path.

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

A failure report keeps `version` and `runId`, with `status: "error"`, `services: []` and a readable `error`. Reports are limited to 4096 bytes and used for this start only. A missing, late, mismatched or explicit failure report, or an early exit, fails startup. The App checks the report and listener ownership before health.

The [health](./runtime-contract.md#5-health-contract) `scoreServer` object must return actual `performerPort`, `monitorPort` and `runtimeRunId: runId`. Standalone runs without the variable use fixed ports. The [public entry](./browser-participation.md) has a separate port.
