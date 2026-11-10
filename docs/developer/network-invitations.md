# Network invitations (#303)

The bottom network control displays the held public listener's complete URL in
Performance, Creation and Client presentation. Its status is readable without
opening the popover; an unbound or failed entry has explicit text and an alert
icon. LAN preferences and another selected project never supply an invitation.
Opening the popover reads the existing Host-entry store and does not allocate,
repair or stop a listener or acquire a performance role.

The narrow bottom popover stacks “Performer entry”, a small numeric address
with a separate copy button, then a full-width QR code, all centered. The LAN
interface/IP selector follows below. It has no Address label or divider below that selector.
Copying always uses the complete original URL, including its scheme. The QR's
existing encoded quiet zone remains intact; the surrounding panel padding and
image margins are reduced instead. It has no node-name input, section
heading, project name, running badge or port summary. The settings link opens
the Node section, which retains node/Hub configuration, project OSC/Room
controls, compatibility guidance and connection diagnostics. The quick selector
does not provide a second, legacy performer-address copy action.

`PublicEntryDetails` owns public-address copy and the QR view. Settings retains
the optional QR toggle; the compact bottom invitation shows it directly. Both use
the same `PublicEntrySnapshot.url`. `getHostEntryQr(expectedUrl)` verifies the
held, available address before and after using the existing shipped Node QR
encoder. It does not change session QR visibility or session/projection state.
Closing the QR view or popover, changing the URL, or receiving an entry fault
retires its pending UI request. Late results cannot reopen it. Encoding failure
has localized feedback and an explicit retry.

The snapshot includes the published project's name and optional browser protocol
version from the listener's current metadata. Absence of browser support in a
published project produces an adaptation explanation. A separately labeled
legacy performer address is available under connection details only for that
unadapted running project; it preserves the actual runtime HTTP/HTTPS selection,
never redirects, and explains that cross-project stability is not promised.
Copies recheck current runtime ownership. A failed HTTPS entry does not gain an
HTTP fallback.

Connection details in Settings disclose the public port and the running snapshot's actual
performer/monitor ports. Applied ports win over health metadata, and missing
values are omitted. Public-entry failure and a healthy local performance remain
separate facts. The Host sidebar retains role, node and project controls but no
longer renders a running information card. Performance mode has neither a
separate QR button nor a main/projection QR overlay. Creation's actual performer
QR controls and main test overlay remain available.

The UI uses native buttons, Radix popover focus restoration, localized status and
errors, logical CSS properties, and LTR address isolation. Tests exercise the
actual copy/QR controls, failures/retries/late replies, Client-mode network
access and Escape restoration, running-project facts while another card is
selected, the sidebar/popover composition, performance QR removal and Creation
QR retention. The native listener regression covers idle availability, exact
address validation and fault rejection without starting a project. GUI QR scan,
physical devices and signed-App LAN behavior remain separate acceptance work.
