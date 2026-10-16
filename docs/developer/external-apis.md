# External APIs

Authenticated model requests run in Rust and reach React through the generated
commands in `@/lib/tauri-bindings`. The WebView never reads a saved API key or
makes authenticated model requests itself. See [tauri-commands.md](./tauri-commands.md)
for command registration and binding generation.

## HTTP and proxy conventions

The app already depends on `reqwest` 0.13. Its `system-proxy` feature preserves the
macOS System Settings proxy convention introduced for the updater; model requests
reuse that dependency and enable JSON and TLS support. Do not add a frontend HTTP
plugin or disable the production proxy to make a test pass. Local HTTP fixtures
can use an explicitly isolated test client.

The model service accepts an HTTPS API base URL, or HTTP for a loopback service.
URL credentials, query strings and fragments are rejected. Requests append the
Chat Completions route to the base URL, so a service whose base is `/v1` is entered
with `/v1`. The caller chooses the model; no model-list lookup substitutes for a
request to that model. Redirects and automatic retries are disabled. Response
size and elapsed time are bounded before interpreting untrusted response data.

## Model configuration and credentials (#165)

`AppPreferences.modelService` contains the API base URL, model name and optional non-sensitive context budget.
React saves it through the serialized `updatePreferences` queue; no independent
preferences writer is introduced. A missing configuration remains a normal state
and does not block local editing, saving or manual testing.

The model credential store uses macOS Security.framework generic passwords via
`security-framework`. Its replace operation updates the existing keychain item;
it never deletes the old key first. The credential seam is replaceable in tests,
while production failures stay failures: there is no plain-file fallback.

The typed command surface exposes credential presence, save, remove and a
connection test. Presence is a boolean, not a masked or partial key. A newly
entered key can be passed directly to a connection test without saving it;
otherwise Rust resolves the saved key. A saved credential is never returned to
React for refilling a password input. Do not derive `Debug` for secret-bearing
requests, log command arguments or return provider response bodies in errors.

Presence checks use a separate `CredentialStore::contains` operation. On macOS
it requests generic-password attributes, never password data. Opening settings
must not decrypt a saved key merely to show whether it exists. Public URL/model
restoration completes independently of the credential check. A saved-key input
stays empty with an explicit Keychain placeholder; status failures have an inline
retry action, rather than requiring another close/reopen cycle. Presence does not
prove that a later authenticated read will be allowed by macOS.

Saving public configuration and saving a key are separate operations. The UI
reports their actual results, including partial success, and retains entered
values needed for a manual retry. A test uses the currently entered configuration
and key, rather than silently substituting the last saved configuration.

The App manages one credential service. Its asynchronous FIFO gate serializes
status reads and mutations; the native worker retains the gate even if its
caller is cancelled while a Keychain prompt is open. The settings panel also
tracks the entire configuration-then-key operation across unmounts. Reopening
waits for that operation before restoring state or enabling another action, so
an older save cannot recreate a key after a newer removal.

## Connection verification

A successful connection test requires both text generation and an actual
controlled tool round trip. The tool name, arguments and result are validated;
HTTP success, a model list or an ordinary text response in place of the tool call
is insufficient. The probe contains no project identity, file content, chat
history or other project data.

Errors are stable typed categories with localized, actionable UI messages:
configuration, absent credentials, keychain failure, authentication, network,
timeout, protocol, unsupported tools, rate limiting and service availability.
Never expose a raw HTTP body, a credential-store error containing sensitive data,
or an authenticated URL as the user-facing diagnostic. Paid requests are retried
only by an explicit user action.

Safe connection diagnostics use `[model-connection]`, `[model-transport]` and
`[model-keychain]` in the normal native log. They contain only input-versus-Keychain
source, fixed failure phases/reasons, HTTP status, whitelisted finish categories,
and numeric OSStatus. Never add key values, key hashes/lengths, URL/model fields,
messages, tool arguments or raw provider strings. These diagnostics distinguish
credential access from an incomplete or incompatible response without exposing
request content. A generic protocol error alone cannot establish key corruption.

For a development build, distinguish the item ACL from the running process's
signature validity. Read-only item metadata can confirm presence, an unlocked
login keychain and trusted application requirements without requesting password
data. A static requirement match only describes the executable on disk. If that
executable was replaced after launch, `SecCodeCheckValidity` on the running PID
can return `errSecCSStaticCodeChanged` (-67034) while password reads fail with
`errSecAuthFailed` (-25293). Fully stop and relaunch the development App before
replacing credentials or changing permissions. Re-saving a key does not repair
an invalidated running process. Keep the user's App/dev-server launch manual;
never weaken access to all applications or reset the system keychain.

Tests exercise the public service boundary against a local HTTP server and a
credential-store substitute, checking actual request payloads, selected model,
tool messages, bounded failures and secret-free returned state. These tests do
not contact a paid service or change the user's keychain. Native keychain prompts,
real provider compatibility and macOS proxy behavior remain separate manual
acceptance evidence.

## Model context configuration (#232)

`modelService.context` is optional, so #165 preferences remain readable. Public
profiles are merged inside the existing preferences writer, keyed by URL
normalization (including default ports and trailing slashes) and exact trimmed
model ID. Switching an endpoint/model selects its own draft/profile. Keys remain
separate; invalid capacity/reserve input is retained and blocks configuration
publication before any credential mutation.

All capacity values are manual and explicitly unverified. No capacity is inferred
from a model name. The App target can only reduce available input: capacity minus
visible output, reasoning reserve and safety margin. Reasoning reserve uses
`max_completion_tokens`; ordinary output uses `max_tokens`. Server capabilities
still apply. No capability-filling probe or automatic retry is introduced.

`model::context::assemble` builds the actual wire messages, installed-document
tool schemas and output options for both local measurement and authenticated
turns. Explicit cl100k_base/o200k_base selection uses bundled tiktoken-rs 0.7;
JSON framing remains an estimate rather than provider usage. Unknown encoding
keeps the selected-encoder token count unknown and adds an o200k_base reference
estimate for display across providers. Its conservative byte-sized admission
estimate still enforces a configured target independently of that display value. Characters, UTF-8 bytes and token estimates
stay distinct. The whole serialized request retains its independent 128 KiB cap;
tool/result/session limits remain in force. Config/key mutations revoke captured
sessions. `measureAssistantContext` performs no network, Keychain or project I/O.
