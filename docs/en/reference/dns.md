# Performance DNS: zero-config phones

For the performance Host operator: PNDS's background DNS service lets performers **join with Wi-Fi plus a QR scan only**, while **everyday internet keeps working for everyone else on the venue network**. The runtime contract counterpart lives in [runtime-contract.md](runtime-contract.md) §16.

## Why it exists

Without it, phones reach the performance domain only by: hand-editing each phone's DNS (re-taught every gig), writing per-domain records on the router (beyond most venue routers), or dropping the domain for a bare IP (breaking HTTPS validation). Performance DNS removes all three: the router points DNS at this Mac **once**, and the performance domain's resolution follows the App's session lifecycle — installed and revoked automatically.

## Before you enable

| Check                           | Why                                                                         |
| ------------------------------- | --------------------------------------------------------------------------- |
| macOS 13.5+                     | SMAppService is a system requirement                                        |
| A stable LAN address            | If this Mac's LAN IP drifts, make it a DHCP reservation in the router first |
| A LAN address picked in「Node」 | The DNS mapping uses the same selected address as the HTTPS entry           |
| Certificate imported            | The mapped domain is the one configured in「Trusted HTTPS」                 |

## Step 1: Enable in the App

Settings →「Performance DNS」→ turn on「Enable background DNS service」. First enable raises macOS's one-time approval dialog (the LaunchDaemon registration); once approved the service runs immediately and is restored on login and reboot. If the approval was dismissed, the status row shows「Awaiting system approval」with a direct button into System Settings.

While enabled, ordinary domains forward to the App's built-in default upstreams (public resolvers, with automatic dual-upstream failover) — nothing to configure. The status block shows the upstreams the daemon actually uses.

## Step 2: Point the router's DNS at this Mac

In the performance router's admin page (TP-Link TL-WR800N and similar DHCP-only DNS routers):

1. Open「DHCP Server → DHCP Settings」;
2. Set「Primary DNS Server」to this Mac's LAN IP (e.g. `192.168.11.31`); leave the secondary blank or the same address;
3. Save and let the router re-serve leases (phones reconnect to Wi-Fi to pick it up).

⚠️ When the Mac sleeps, shuts down or leaves the network, DNS for the whole venue stops — that is the physical boundary of "this Mac as the DNS". After the show, point the router's DNS back to the original value (usually the upstream gateway) if the venue needs internet without you, or use an always-on DNS appliance.

## Step 3: Start the performance

Starting a project that declares `supportsPerformerUrl` with the HTTPS switch on installs the mapping from the HTTPS domain to the selected LAN address, verifies the resolution inside the daemon, and only then publishes the entry. Performer side:

1. Join the show Wi-Fi;
2. Scan the code (or type the performance address);
3. Open the page and play.

On the phone: **no** certificate install, **no** VPN, **no** DNS settings.

## Stopping and cleanup

- **Stop / switch project / quit the App**: the mapping is revoked with the session — the domain stops resolving immediately (no stale address, no forwarding to the public one); ordinary forwarding continues.
- **App crash**: the mapping holds a 60-second lease; the daemon revokes it when the lease lapses — nothing lingers.
- **Disable**: switch the toggle off — the daemon unregisters and stops, port 53 is freed. The router may still point DNS at this Mac with nobody answering, so **restore the router's DNS** (undo step 2) right after.
- **Uninstall**: deleting the App removes the daemon; restore the router's DNS first.

## Troubleshooting

| Symptom                                             | Fix                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phones can't open the page; everyday browsing works | Settings → Performance DNS: is the「Performance mapping」row present? If not, check the project declares the capability, the HTTPS switch is on and the entry reads ready |
| Everyday browsing broken                            | Upstream unreachable: check the Mac's own connectivity (the default upstreams are public resolvers and need internet access)                                              |
| Status shows「Awaiting system approval」            | Click「Open System Settings」and approve PNDS under Login Items & Extensions                                                                                              |
| Port 53 busy                                        | Another DNS service is running (e.g. a dnsmasq from other tooling); stop it before enabling — PNDS never preempts or kills existing services                              |
| Some pages fail intermittently                      | Network jitter; forwarding has dual-upstream timeout failover — investigate only if it persists                                                                           |
