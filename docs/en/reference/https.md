# Preparing the trusted HTTPS entry

For operators: how to prepare a trusted HTTPS entry where phones join by scanning a code — no certificate installs. This page covers the Host-side configuration, import, validation and venue preparation only; the running contract between the entry and projects is [runtime-contract.md](./runtime-contract.md) §15.

## Why it exists

iOS Safari exposes motion, camera and microphone capabilities only in a trusted **secure context**. The existing LAN HTTP entry cannot reliably satisfy that, while asking every performer to install a root certificate, flip a trust switch in system settings, or run a VPN makes joining a performance needlessly hard.

The goal: connect to the performance Wi-Fi → scan the code → confirm the browser permissions the work asks for. **No certificate installs, no VPN, no phone-side DNS edits — and no accepting certificate warnings as a normal joining step.**

## Preparation checklist

| Item                    | Notes                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A real DNS domain       | A domain you own and control (e.g. `show.example.org`). IP addresses, `.local` names and internal hostnames do not qualify — public CAs will not issue for them.                                                           |
| A public-CA certificate | A certificate and its matching private key issued by a public CA (one phones trust by default, e.g. Let's Encrypt). Self-signed certificates and private root CAs are **not** a success path — phones will not trust them. |
| A router with local DNS | The controllable performance router, resolving the domain to the chosen Mac's LAN address.                                                                                                                                 |

## Step 1: the domain

Fill it in under Settings → Trusted HTTPS. It must be a real DNS name: lowercase letters, digits and hyphens — not an IP address, not `.local`, not a full URL with scheme or port. Wildcards belong to the certificate, not to this setting — the entry address needs a concrete host name.

## Step 2: obtain the public certificate

Use your existing domain / ACME process. The essentials:

- **DNS-01 validation** keeps issuance from needing any public server (see [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/)); first issuance and renewal may be done online — the performance itself never depends on the internet.
- The deliverable is two files: the **certificate chain** (leaf + intermediates, i.e. `fullchain.pem`) and the **matching private key** (`privkey.pem`). Exporting just the leaf without intermediates is the most common mistake — the App rejects it as an incomplete chain.
- Renewal follows your existing process; the App does not manage ACME for you and never holds domain-wide DNS credentials.

## Step 3: import in the App

Import the chain and the key under Settings → Trusted HTTPS. On import the App checks, in order:

1. the files parse as PEM certificate material and a private key;
2. the certificate is **not expired** and **already valid** (by this Mac's clock);
3. the **private key matches** the certificate;
4. the chain is complete and roots in a **publicly trusted root** (the Mozilla root set);
5. the certificate's **SANs cover the configured domain** (single-label wildcard matching included).

Any failure produces a clear error with specifics (the names the certificate actually covers, the actual expiry, …), and **nothing is written** — previously imported material stays untouched. Only a fully passing import replaces the stored material atomically.

Two distinctions that matter:

- **"The files are valid" ≠ "phones can actually use it"**: the App's checks prove the material is well-formed, chain- and domain-matching and publicly trusted. Whether a phone ultimately trusts and reaches the entry also depends on step 4 below (local DNS) and on real-device testing — offline acceptance requires the controllable router as a precondition.
- **Protected storage**: the chain and private key are kept by the App backend in a restricted-permission file inside this Mac's app-data directory (readable by the current user only). They never ride the preferences round-trip, the project folder, the manifest, the `.pnds` bundle or the logs. Performers never receive or install any certificate.

## Step 4: router local DNS

In the performance router's **local DNS**, resolve the domain (an A record) to the chosen Mac's LAN address (the network address selected in Settings → Node — the HTTPS section shows its current value). Performers get resolution from ordinary Wi-Fi configuration and **change nothing on their phones**.

Notes:

- The App provides the domain, the target address and these instructions, but **never modifies the router or phones itself** — the venue network must be under the operator's control.
- Public DNS pointing at a private IP can be a valid existing deployment choice, but it cannot promise usability on arbitrary Wi-Fi or offline cold starts.
- A valid certificate, a complete chain, correct device clocks and local DNS are the four offline preparation conditions.

## Expiry and replacement

- The section shows the certificate's **actual expiry date** and warns within a 30-day window (within 30 days of expiry the status becomes "expiring soon" with the remaining days). The reminder reads the real expiry — it assumes nothing about certificate lifetime.
- **Replacement**: a new certificate goes through the same validate-then-commit path; a failure keeps the old material. A running performance keeps the material it started with — **domain, port or certificate changes made during a performance take effect at the next project start**.
- **Seats and origins**: any change of protocol, domain or port is a different browser origin, and performers on the new origin join as new participants (seat tokens are origin-scoped and never migrate across origins). Switching from HTTP to HTTPS changes the origin too — that is expected behavior, not a fault.

## Common errors

| Status / error                                       | Meaning and fix                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The certificate does not cover the configured domain | The SANs do not match the domain (the error lists the names the certificate actually covers). Change the domain or the certificate. |
| The certificate expired                              | The validity window has passed. Renew and re-import.                                                                                |
| The certificate is not valid yet                     | The issuing machine's clock is off, or the validity window has not started.                                                         |
| The certificate chain is incomplete                  | An intermediate is missing. Import the fullchain (leaf + intermediates), not the bare leaf.                                         |
| The certificate is not publicly trusted              | Self-signed or issued by a private CA. Phones will not trust it; use a public-CA certificate.                                       |
| The private key does not match                       | The key was not issued with this certificate. Check that you picked the right files.                                                |

## Relationship to projects

A project declares via `scoreServer.supportsPerformerUrl: true` that it reads the Host-provided full performer URL and connects same-origin ([manifest.md](./manifest.md)); undeclared legacy projects are unaffected and keep the HTTP flow. This version delivers the Host-side configuration, import, validation and protected storage; the TLS entry that serves traffic arrives in a later version — once the material is ready, no further preparation is needed for the entry itself.
