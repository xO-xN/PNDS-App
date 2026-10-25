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
size is bounded before interpreting untrusted response data. Connection probes
have a 30-second total limit. Assistant sessions and established chat responses
have no total elapsed-time limit; Stop and lifecycle/configuration changes
cancel them explicitly. Connection establishment keeps its 10-second bound.

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
entered key is passed directly to a connection test; otherwise Rust resolves
the saved key. The settings form flushes its pending autosave before testing. A saved credential is never returned to
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

## DeepSeek Chat Completions compatibility (2026-10-18)

The native provider boundary recognizes the exact `api.deepseek.com` host,
including its `/v1` base, independently of model names. Other compatible endpoints
keep their existing wire format; a DeepSeek model alias on an unrelated host does
not inject provider-specific fields. No model capacity/tokenizer is inferred.

Connection probes explicitly use `thinking: {type: "disabled"}` for all three
requests. Their forced named tool, 128-token output and validated tool result
remain a fast capability check. Normal assistant requests enable thinking, use
`tool_choice: "auto"` and, when an output limit is explicitly configured, use
DeepSeek's `max_tokens` field, including the configured reasoning reserve. With
no output limit, omit both output-limit fields and use the provider default.
The probe never disables thinking for real tasks. `tool_choice` is omitted for
tool-free context summaries, as described below.

DeepSeek JSON and SSE responses keep `reasoning_content` as a separate bounded
protocol field (1 MiB per assistant message); only answer `content` is streamed
to the UI. Empty reasoning strings survive unchanged. Complete assistant turns
carry it through tool exchanges, automatic-check feedback, checkpoints and private
history. Only this provider receives the field on replay. Older transcripts without
reasoning use an empty protocol value, without inventing missing reasoning. Neither
the final answer, Work log, summaries, project/handoff files nor logs include it.
JSON fallback allows its 1 MiB reasoning allocation in addition to the existing
1 MiB response allocation; SSE keeps its separate event and answer bounds.
When retained reasoning makes old chat history exceed the existing working-packet
target, compaction omits whole oldest completed user/assistant rounds from that
packet and records the omission count. Saved history remains complete, current
input stays authoritative, and reasoning in any replayed exchange is never cut.

An HTTP 400/413/422 parameter rejection is `requestRejected`, unless a recognized
structured context/tool-support code establishes a more specific cause. Raw error
prose is never inspected or logged to guess tool support. JSON and SSE also classify
structured `invalid_request_error` as `requestRejected`. DeepSeek finish reasons
`aborted` and `insufficient_system_resource` map to `responseInterrupted` and
`serviceUnavailable`. Rejected parameters retain the latest completed tool-boundary checkpoint
for manual continuation. Existing authentication/rate/network categories remain.

Protocol sources: [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)
and [thinking-mode tool calls](https://api-docs.deepseek.com/guides/thinking_mode/).
Local DNS-isolated fixtures verify probe negotiation, JSON/SSE multi-tool replay,
empty reasoning and hidden progress; they do not contact DeepSeek or use a real key.

## Model context configuration (#232)

`modelService.context` is optional, so #165 preferences remain readable. Public
profiles are merged inside the existing preferences writer, keyed by URL
normalization (including default ports and trailing slashes) and exact trimmed
model ID. Switching an endpoint/model selects its own draft/profile. Keys remain
separate; invalid capacity/reserve input is retained and blocks configuration
publication before any credential mutation.

Context management defaults to automatic. `context.mode` is optional for backwards
compatibility: absent/`auto` ignores the legacy capacity/inputTarget as admission
limits, including existing per-model profiles. Saving automatic settings clears
`inputTarget` and preserves capacity for the usage display, plus output/reasoning
settings. Optional capacity is an ordinary settings field: it does not require an
output reserve and never limits input in automatic mode. Unknown capacity leaves
the usage ring visible without a percentage. Only explicit `manual` enables the
entered token budget. No capacity or tokenizer is inferred from a model name.
Advanced controls are collapsed by default; endpoint/model/key alone
remain sufficient. Reasoning reserve uses `max_completion_tokens` except for the
DeepSeek compatibility profile above; ordinary
output uses `max_tokens`. Server capacity still applies.

Output limits are optional too: absent/null `maxOutput` leaves the request at
the provider default, rather than silently injecting 4096 tokens. The settings
field is empty with a provider-default placeholder; entering a number preserves
that explicit limit in automatic and manual context modes, including old
profiles. A nonzero reasoning reserve or a manual context capacity requires an
explicit output amount so the input calculation never subtracts an invented
reserve. Measurements report `outputReserve: null` when the provider chooses it.
The UI and native validator enforce the same rule before credentials or HTTP.

The 2026-10-19 runes diagnosis found two edit attempts ending in `length` on
turn eight under default DeepSeek settings. An unconfigured request still sent
`max_tokens: 4096` while enabling thinking, leaving reasoning and code in that
small shared allowance. The loopback regression
`default_deepseek_edit_can_finish_a_tool_call_after_long_reasoning` drives actual
assembly, HTTP/SSE parsing and the completed code-call boundary; it failed with
`OutputTruncated` before removing the implicit limit. Separate matrix tests keep
configured output/reasoning and manual input budgets authoritative. These are
controlled protocol replays, not a claim that a live model completed the score.

`model::context::assemble` builds actual wire messages, schemas and output options
for local measurement and authenticated turns. Selected cl100k_base/o200k_base
uses bundled tiktoken-rs 0.7. Unknown encoding supplies a portable o200k reference
estimate; no estimate represents measured server usage. In automatic mode it is
informational, never a guessed token gate. In manual mode it is compared directly
with the explicitly configured budget, without a multiplier or byte substitution.
The flow organizes large working packets before the independent 512 KiB native
byte boundary. See [automatic working context](creation-assistant.md#automatic-working-context).
Config/key mutations revoke sessions. `measureAssistantContext` performs no
network, Keychain or project I/O.

Ordinary requests retain their mode-filtered tool definitions. Context-summary
requests use `summaryPolicy` and omit both `tools` and `tool_choice`; the same
assembly path measures the summary policy and source input without a tool
payload. Summary output still follows the JSON/source-attribution contract. This
routing change does not alter provider reasoning replay for current tool turns.

Only an explicit structured context-overflow code or
`model_context_window_exceeded` finish reason allows bounded automatic context
recovery. HTTP error bodies are read up to 16 KiB and discarded, never surfaced
or logged. Recognized codes include `context_length_exceeded` and GLM `1261`
([official Z.AI error reference](https://docs.z.ai/api-reference/api-code)).
HTTP, JSON and SSE classifications agree. Other errors still require manual
retry. Context rejection leaves the captured native session cancellable for the
smaller follow-up; owner/config generations and the cumulative turn cap still apply.

Output exhaustion likewise keeps that native session available. The frontend
edit loop may retry at most twice from completed tool evidence, after discarding
all partial code/tool arguments. Cancelling the native session on `length`
previously made this recovery immediately return `cancelled` before another
HTTP request, matching the missing ninth turn in the runes trace. The regression
`truncated_output_retains_the_native_session_for_bounded_task_continuation`
exercises the real service across both requests. Explicit cancellation and
owner/config revocation still end it; other protocol/auth/budget failures keep
their existing terminal behavior.

Assistant responses distinguish output exhaustion (`outputTruncated`), incomplete
responses (`responseInterrupted`), response/argument bounds (`responseTooLarge`)
and malformed protocol (`protocol`). Both SSE and JSON use these categories.
SSE bounds retained/incomplete events (1 MiB), actual answer text (64 KiB) and
per-call arguments (256 KiB), rather than cumulative network traffic. Repeated
metadata and reasoning discarded by other provider profiles do not make an otherwise small result oversized.
Network chunk boundaries never determine admission; unfinished events remain
bounded across chunks. JSON fallback keeps its bounded body reader.
Saved-project reads are enabled by default without a sending confirmation; native
path exclusions, snapshot freshness and explicit per-file apply still govern tools.

## Settings autosave

There is no Save configuration button. Public fields/context and newly entered
keys debounce for 600 ms after editing; leaving the form or unmounting flushes
the latest pending snapshot. Restoration alone does not publish a save. Invalid
or incomplete values remain local and retain actionable errors. Operations
serialize across dialog unmount/reopen, including autosave followed by test or
removal; a late key save cannot clear a newer key entry. Public configuration
still uses the preferences queue and credentials still use Keychain only.
Fields remain editable during a public autosave. The connection-test action
keeps an accessible label and uses an animated loading icon during its request;
success and errors retain their normal messages.
