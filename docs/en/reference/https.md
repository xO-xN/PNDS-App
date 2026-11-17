# Preparing the trusted HTTPS entry

Configure trusted HTTPS for performances that need a browser secure context.

## Why it exists

QR entry and ordinary touch use HTTP. Enable HTTPS through the [manifest declarations](./manifest.md) when the work uses browser sensors, camera, microphone or other secure-context APIs.

## Preparation checklist

Prepare a DNS name you control, a full chain from a public CA with its matching private key, and a performance network with local DNS configuration.

## Step 1: the domain

Enter a concrete hostname such as `show.example.org` in **Settings → Trusted HTTPS**. Omit the scheme, port and wildcard. Use a public DNS name.

## Step 2: obtain the public certificate

Obtain the valid PEM chain (leaf and intermediates) and matching private key. The certificate SAN must cover the configured name.

## Step 3: import in the App

Import the files in **Settings → Trusted HTTPS** and enable the entry. The App checks format, validity dates, key, trust chain and name coverage. A failed import preserves the existing files. The private key stays in protected local storage.

## Step 4: router local DNS

Use router-local DNS or [performance DNS](./dns.md) to resolve the name to the selected Mac LAN address. Join the performance Wi-Fi on a phone, scan the QR and check the page and required permissions.

## Expiry and replacement

The App shows expiration and warns 30 days in advance. Import renewed files. Changes to the certificate, name, port or switch take effect at the next project start.

## Common errors

| Problem                       | Action                                        |
| ----------------------------- | --------------------------------------------- |
| Expired or not yet valid      | Check device time, renew and import if needed |
| Name mismatch                 | Use a covered name or change certificates     |
| Incomplete or untrusted chain | Import the full public CA chain               |
| Key mismatch                  | Import the corresponding private key          |

## Entry lifecycle (since #140)

Start an adapted project. Entry status shows preparing, ready or failed. Ready indicates a successful local probe. Check phone access by scanning the QR.

## Fault recovery & switching isolation (since #141)

For a start failure, fix the indicated port or certificate setting and retry. An entry fault during a performance leaves local services and audio running. After fixing it, stop and restart the project.

## Relationship to projects

See [browser participation](./browser-participation.md#full-performer-url-and-trusted-https) for the full performer URL, entry selection and browser origin.
