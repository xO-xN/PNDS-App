# Browser Participation and Performance Entry

## Browser participation protocol 1

The Host's public LAN entry is separate from the project's actual performer port. `GET /` shows the current project and performance, or waits when idle. `GET /__pnds/participation` provides `protocolVersion: 1`. Compatible performances add `browserParticipation: 1`. An unadapted project displays a notice.

The App uses the selected LAN IPv4 and excludes recognized VPN interfaces. It selects the sole available address automatically, or prompts when several are available and the current choice is invalid. The public entry reuses its last port, allocating and publishing an alternative on conflict. The Host verifies health forwarding before accepting joins. On fault, `clientEntryError` reports the issue and HTTP/WS forwarding closes. Local audio and the project continue. Restart the entry to recover. Stopping the project revokes forwarding. An online entry can report `performance: null`.

1. On confirmation the entry sends `POST /__pnds/enter/<hostId>/<projectId>/<performanceId>`. A current compatible performance returns 303 to `/__pnds/run/<opaque-grant>/`. Stale confirmation returns 409. Stop or replacement revokes the grant and active tunnels.
2. Load `./__pnds/context.js` first. Read `protocolVersion`, `hostId`, `projectId`, `performanceId`, `basePath`, `storagePrefix`, `resource(relative)`, `storageKey(key)` and `socketOptions` from `globalThis.PNDS_PARTICIPATION`. Connect with `io(location.origin, {...context.socketOptions})`.
3. Pages, assets, Worker loads and fetches, Socket.IO polling and WebSockets use the confirmed prefix. Resolve resources with `resource(relative)` and Worker requests relative to the Worker script URL. The Host validates and strips the prefix before forwarding. Confirmed native pages get the same context with a `/` base. Standalone Blank runs without Host context.
4. Long-lived browser keys use `pnds:<hostId>:<projectId>:` across performances. This namespace separates project data. Storage sharing depends on origin, browser profile and saved-app instance.

Once required resources and initialization are ready, call `reportPrepared()`. It saves `preparation`, emits `pnds:prepared` and posts `{type:'pnds:prepared',protocolVersion:1,hostId,projectId,performanceId,resourceScope:'page'}` to a same-origin parent. Blank reports after performer admission and claim persistence.

On required-resource or initialization failure, call `reportPreparationFailed()`. It saves `preparationFailure` and sends `pnds:preparation-failed` with the same identity fields. Missing scripts, fatal initialization errors and unhandled initialization rejections report automatically before preparation. The Host validates the candidate window, all three identities and current performance before replacing the page. Failure or cancellation keeps the existing page. Retry creates a new candidate. Stop, connection loss and discovery of another performance preserve open documents.

## Full performer URL and trusted HTTPS

See [HTTPS](./https.md) for certificate, domain and port setup. Ordinary LAN performances use the browser protocol above.

### The variable and the capability declaration

`scoreServer.supportsPerformerUrl: true` declares support for full performer URLs and same-origin connections. Works requiring a secure context also declare `scoreServer.needsHttps: true`. HTTPS uses both declarations, the enabled switch and valid configuration. If the work declares the need without support, the enabled switch requires an explicit “Start with HTTP” choice.

Use `PNDS_PERFORMER_URL` as supplied, falling back to `http://<PNDS_HOST_IP>:<performerPort>/` when absent. Scripts and Socket.IO use the performer's current origin.

### Project identity and the entry access context

The entry binds `manifest.id` and the current performance. The server determines the page role. When used, `__config.js` carries the server's `role`. A shared external port does not identify the role. Monitor uses the internal project listener. The project owns performer [admission and recovery](../modules/players.md).

### Claim tokens and origins

Claim tokens live in localStorage scoped to the browser origin. A protocol, domain or port change uses the join rules for the new origin.

### Faults, retries and isolation

Bind, material validation or gateway creation failures fail startup. The entry reports an error and retains its URL if its probe has not passed 10 seconds after project readiness or the entry fails during a run. Local service and audio continue. Restart the performance to recover. Configuration changes apply at the next start. Ending the performance closes its entry and revokes old invitations.

## Connected performer roster

In the optional `performers` field of `GET /__pnds/health`, list accepted and online performers. Remove disconnected entries and replace the connection on reconnect. A missing or invalid roster, or a failed read, displays unknown status.

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

At most 128 entries are accepted. `id` is a unique temporary connection ID of at most 128 UTF-8 bytes. `label` is a readable name of at most 160 UTF-8 bytes. Both are nonempty and contain no control characters. Keep credentials, IPs and work data out of the roster.

Creation test pages carry `pndsTestClient=<native window UUID label>`. Echoing it as `testClient` only matches the App window. Ordinary browsers return `null` or omit it. The roster read limit is 64 KiB.

### App-owned performer QR

The App provides QR codes. See [performer QR](../modules/qr.md) for usage.
