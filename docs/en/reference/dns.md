# Performance DNS: zero-config phones

Performance DNS resolves [trusted HTTPS](./https.md) entries on the venue network.

## Why it exists

The background service maps the active performance name to the Host Mac and forwards other names.

## Before you enable

Use macOS 13.5 or later. Reserve a LAN address for the Mac, select it in the App and configure trusted HTTPS.

## Step 1: Enable in the App

Enable the background service under **Settings → Performance DNS**. Approve it in macOS when prompted.

## Step 2: Point the router's DNS at this Mac

Set the router DHCP DNS server to the Host Mac LAN address. Reconnect devices to Wi-Fi to obtain the setting. Keep the Mac online while serving DNS.

## Step 3: Start the performance

When the trusted HTTPS entry starts, the App installs and verifies the performance mapping. Join the performance Wi-Fi and scan the QR.

## Stopping and cleanup

Stopping or switching a performance removes its mapping. Ordinary DNS forwarding continues. After an unexpected exit, the mapping expires with its lease. Restore router DNS before disabling the service or removing the Mac.

## Troubleshooting

| Symptom                         | Action                                        |
| ------------------------------- | --------------------------------------------- |
| Performance address unavailable | Check the HTTPS entry and performance mapping |
| Ordinary sites unavailable      | Check the Mac and its upstream connection     |
| Waiting for system approval     | Approve the PNDS service in System Settings   |
| Port 53 occupied                | Free the port and re-enable the service       |
