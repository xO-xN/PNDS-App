# Performance Networking: LAN and Internet

PNDS performances run on ordinary computer networks. There are two shapes: **local-network performance** (one Host and the performers' devices on one LAN) and **internet / remote performance** (several sites each running PNDS, collaborating across networks).

Port allocation and the page roles (performer / monitor) are not this page's subject — the port rules live in [manifest.md](./manifest.md), address injection and LAN selection in [runtime-contract.md](./runtime-contract.md) §4, and the monitor page requirements in §10 of the same document.

## Local-network performance (LAN)

A performance needs just one Mac and a router:

1. **Network**: the Host running PNDS App and every performer device join the same local network. The Host is best wired to the router; performer devices (phones / tablets) join the same Wi-Fi.
2. **Start**: once the App loads the Project, its performer and monitor servers run on the Host. The App enumerates the usable LAN addresses — where there are several, the operator picks one explicitly, and the chosen address is injected as `PNDS_HOST_IP` (runtime contract §4).
3. **Join**: performers open `http://<Host-LAN-IP>:<performerPort>/` on their own devices — by scanning the QR code on the Project's monitor page (where the Project provides one, as the PNDS Template does), or by typing the address into a browser. The monitor page is shown by the App window and can be mirrored to a venue's large screen.

For the concrete loading and multi-device joining steps, see the [tutorial](../app-tutorial.md).

Seats, reconnection and the work's data protocol are the Project's own implementation — PNDS prescribes no Socket.IO event names, client IDs, role counts or UI framework.

## Internet / remote performance

Several sites (several Macs) each run PNDS with the same internet-capable Project and perform together across networks. **The App currently has no internet-specific features**: it does not show the public IP, does no NAT traversal, and integrates no network audio transport. Remote performance means making the sites' networks reach each other, then adding an external audio solution. What follows is best-effort guidance, not an App guarantee.

There are three routes to reachability:

- **Virtual LAN (recommended)**: install a mesh-VPN tool (e.g. Tailscale, ZeroTier) on each site's devices; once they hold virtual-network IPs they behave as if on one LAN — the QR / manual-address joining flow is unchanged and Projects need no modification.
- **Port forwarding**: where a site has a public IP, forward the Project's `performerPort` / `monitorPort` from the router to the Host, and remote performers join via the public address. The servers are then exposed to the internet — weigh the risks yourself.
- **Closed intranet**: on interconnected private networks (labs, campuses) the sites simply reach each other — identical to local-network performance.

Audio alignment: real-time audio between sites is carried by an external solution (e.g. JackTrip). The App only manages each site's local project audio bus (see [audio-modes.md](./audio-modes.md)) and takes no part in inter-site transport.

From the Project's point of view nothing distinguishes local from internet: the same Project runs the same way on both. Timing, latency and dis-synchronisation across sites are the work's creative material, handled by the Project itself.
