# Telematic internet diagnostics

## Source and delivery

[TND v0.8.1](https://github.com/xO-xN/Telematic-Network-Diagnostics/releases/tag/v0.8.1)
is the public participation prerelease. Its feature baseline is v0.8.0, implemented
from v0.7.1 in the existing
worktree `../PNDS-1.6.2-projects/Telematic-Network-Diagnostics`. The older
`../Telematic-Network-Diagnostics` checkout is v0.6.1. The independent
`../pnds-hub` repository provides
[HUB v0.2.0](https://github.com/xO-xN/pnds-hub/releases/tag/v0.2.0) and operator
upgrade instructions. Publishing that source does not update a third-party
relay; only its administrator can deploy it.

`src-tauri/resources/utilities/` is generated staging output. Do not implement
features there or substitute unpublished source for the pinned release.
`utilities.json` now fixes v0.8.1 with its actual anonymously verified public artifact SHA256. The
unauthenticated download, fresh-cache fetch, bundle identity and unpacked
version must all agree before changing a registry pin. Building the App stages
that release; changing the source pin or local staging does not replace an
already installed App binary.

An existing v0.1.0 relay still supports measurements, topology and manual node
coordinates. Automatic IP metadata needs the administrator to upgrade to
v0.2.0, configure the actual trusted proxy addresses and optionally provide the
HUB's deployment coordinates. Keep the existing token/configuration and use
the HUB repository's upgrade instructions; lack of SSH access cannot be solved
from its public health or Socket.IO endpoint.

## Confirmed behavior

The tool measures only each node's public connection to the HUB. Local phone
joining, probing, device quality, performer-pair estimates and QR instructions
are removed. Keep the Host's existing two-port HTTP/health/shared-library
contract; removing local measurements does not remove the required performer
health endpoint. No audio or new App preference is introduced.

The default geographic view fits known nodes and the HUB with a modest margin.
Use locally bundled Natural Earth land geometry, without province/district
borders or online map tiles. Small groups do not require a full-world view.
Marks and edge endpoints use the original projected coordinates, including
coincident nodes. Do not apply repulsion, clustering offsets or position leader
lines. Unknown positions remain in the table and an accessible unknown-location
list, and the topology view remains available. An unknown HUB is not placed at
the map center or a sample city.

Stable node colors identify the node in the map, connecting path and table.
Measured quality retains its independent text and green/yellow/red/gray status.
Only the self-node label is permanently visible beside map points. Hover/focus
previews the matching table row and detail; leaving restores the pinned
selection and prior detail disclosure. Click, keyboard activation or table
selection pins a node. Nearest-circle picking handles adjacent marks without
moving them. Exactly coincident nodes remain independently selectable through
the table. Telemetry does not recreate focused controls or reset disclosures.

## Location is optional metadata

The HUB observes the connection's public exit IP and looks up an approximate
city location asynchronously. An IP estimate does not establish a performance
machine's real district or street: VPNs, proxies, mobile networks and same-city
addresses can share an estimate. Never infer location from a node's display
name. Manual correction is available for the self node, clearly identified as
manual, and lasts for the current diagnostic configuration/session. Reconnecting
the same node resends it; switching node, HUB URL or room clears it.

The configured HUB location is authoritative operator metadata. Missing or
invalid deployment coordinates mean unknown location. Nanjing was a prototype
example and is never a production fallback. A public hostname may terminate at
a proxy or CDN and is not evidence of the actual relay's location.

The relay's optional extension adds `network` to `welcome` and emits a `network`
event when an asynchronous lookup or correction finishes:

```json
{
  "ip": null,
  "location": null,
  "hubLocation": null,
  "manualLocationSupported": true
}
```

A location contains `label`, numeric `latitude`/`longitude`, and `source`
(`ip`, `manual` or `configured`), with an optional provider name for IP estimates.
Zero coordinates are valid. Missing, nonfinite, out-of-range and malformed
coordinates are unknown rather than mapped to zero. The client's `location`
event sets its own correction, or `null` clears it. For the existing
`type: "tnd-stats"` relay, the HUB overwrites `network` with its own observed
metadata; unrelated relay payloads keep their existing opaque behavior.

Older HUBs keep working: missing extensions mean unknown automatic locations,
while node quality and the topology view continue. Manual self-location can
still travel through the old opaque stats relay. Neither unavailable location
data nor a failed provider request affects probe cadence or link quality.

The HUB uses built-in HTTPS fetch against ipapi.is with bounded caching,
timeouts, concurrent requests and a daily request budget. The optional API key
stays on the HUB; it never enters the tool, App preferences, URLs or logs.
Private/loopback/bogon addresses are not submitted. Forwarded addresses are
accepted only from explicitly configured exact trusted proxy addresses. See
the HUB README for environment variables and its documented provider limits.
The provider's [API documentation](https://ipapi.is/developers.html) and
[anonymous-tier limits](https://ipapi.is/free-tier.html) are the integration
sources; deployment must use the appropriate current quota.

## Measurement and verification

Keep the existing 15-second window, sample warmup, IQR/loss/reconnection
thresholds and automatic burst/calm cycle. RTT magnitude is displayed as data
and never determines quality. Do not infer audio feasibility or label a whole
performance suitable/unsuitable from these measurements.

If the self node loses its HUB connection, its own link is disconnected and
remote nodes become unconfirmed. Do not claim every remote node failed; retain
their last known location and hide current numerical readings. A remote node
that stops updating while the self connection remains alive is stale, with its
old readings hidden. Probe storage is pruned to the rolling diagnostic window.

Run TND's `npm run check` and `npm test`, and the independent HUB's checks/tests.
The App's `npm run check:all` does not run sibling-repository tests and must
also pass for App-side edits. Tests use injected provider responses and local
fixtures rather than sending real users' IP addresses to a provider. No dev
server, real VPS deployment or public release is part of automated verification.
Native App and two-network acceptance remain separate from these checks.

## Unified entry release (#310)

The maintained v0.8.0 feature tree is the input to the public v0.8.1
participation prerelease. It retains the internet-only diagnostics above; the
older v0.7.1 specification input and v0.6.1 sibling are not replacement sources.
After explicit authorization, the source was committed and tagged; the existing
CI produced the actual `.pnds`, verified against committed runtime bytes and an
anonymous public download before updating the App pin. See
[utility participation and delivery](./utility-browser-participation.md) for
installed-package checks, storage recovery and truthful WAN boundaries.
