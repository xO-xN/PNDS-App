# Performance Networking: LAN and Internet

This page defines network responsibilities. Loading, inviting and joining are in the [App tutorial](../app-tutorial.md#5-loading-a-project-and-the-multi-device-performance-workflow).

## Local-network performance (LAN)

Connect the Host and participating devices to the same LAN; prefer a wired Host. The Host runs the project and required audio. Devices explicitly enter through the complete public URL or QR in the App's bottom network popover. This public entry is separate from per-run internal performer/monitor ports; see [participation](./browser-participation.md).

### Custom connection address (`performerAddress`)

This field affects the host address injected into the project. See [manifest](./manifest.md) for format and the [runtime environment](./runtime-contract.md#3-environment-variables-the-app-injects) for semantics. It is distinct from the Host's public entry and does not configure name resolution. Verify that `.local` or other names resolve to the correct Host on participating devices.

Browser secure-context requirements belong in [HTTPS](./https.md); App-native page media boundaries are in [native media](./native-media.md).

## Internet / remote performance

Each site runs its own Host, and projects exchange work data through a relay. External systems carry inter-site real-time audio; the App supplies neither network-audio transport nor NAT traversal.

### The star hub relay (the standard shape)

Projects make outbound connections to [pnds-hub](https://github.com/xO-xN/pnds-hub), authenticate with a token and isolate messages by room. For projects declaring `telematic`, the App injects node name, hub URL, token and a room derived from project/group. Tokens stay out of URLs. See the [runtime environment](./runtime-contract.md#3-environment-variables-the-app-injects) for fields and [hub](../modules/hub.md) for adoption and project wiring.

### Remote performers joining a site's pages (supplementary routes)

Remote devices must be able to reach the Host's complete public entry; deployment owns routing and access control. Reachability does not verify media permission, sound or timing. Confirmation, resource URLs and document continuity still follow the [participation protocol](./browser-participation.md).
