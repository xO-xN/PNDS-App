# Notifications

Simple notification system supporting both in-app toasts (Sonner) and native system notifications (Tauri).

## Quick Start

### Basic Usage

```typescript
import { notify, notifications } from '@/lib/notifications'

// Simple info toast
notify('File saved', 'Successfully saved to disk')

// Specific notification types
notifications.success('Success!', 'Operation completed')
notifications.error('Error', 'Something went wrong')
notifications.warning('Warning', 'Please check your input')
notifications.info('Info', 'Here is some information')

// Native system notification
notify('Update Available', 'Click to install', { native: true })
```

### Available Functions

| Function                            | Description                          |
| ----------------------------------- | ------------------------------------ |
| `notify(title, message?, options?)` | Send notification (toast or native)  |
| `notifications.success()`           | Success toast or native notification |
| `notifications.error()`             | Error toast or native notification   |
| `notifications.info()`              | Info toast or native notification    |
| `notifications.warning()`           | Warning toast or native notification |

## Project check windows

`notification_plugin.rs` keeps the upstream Rust lifecycle and command handling,
but does not initialize its Web Notification shim in generated `check-page-*`
webviews. They are isolated project pages without Host notification permission;
the plugin's automatic permission query otherwise becomes an unrelated
unhandled rejection in the script checker. Main/Host pages retain the upstream
shim and permissions. Do not grant notification permissions to check windows or
filter score Promise errors to hide bootstrap errors.

## Configuration

### Toast Notifications (Sonner)

- **In-app**: Appear in bottom-right corner
- **Themed**: `AppToaster` and `App.css` consume the Pond / Sand / Stage / Brutal tokens; OS light/dark appearance does not choose the palette
- **Auto-dismiss**: Default behavior (can be customized)
- **Positioned**: Always visible within app window

### Native System Notifications

- **macOS**: Appear in Notification Center
- **Platform-aware**: Handled by OS notification system
- **Permissions**: Automatically request permission when needed
- **Fallback**: Falls back to toast if native notification fails

## Options

```typescript
interface NotificationOptions {
  type?: 'message' | 'success' | 'error' | 'info' | 'warning'
  native?: boolean // Use native notification
  duration?: number // Toast duration (ms, 0 maps to Sonner Infinity)
  action?: ExternalToast['action'] // Sonner action, in-app only
}
```

## Examples

### React Component Usage

```typescript
import { notifications } from '@/lib/notifications'

function SaveButton() {
  const handleSave = async () => {
    try {
      await saveFile()
      notifications.success('Saved', 'File saved successfully')
    } catch (error) {
      notifications.error('Save Failed', error.message)
    }
  }

  return <button onClick={handleSave}>Save</button>
}
```

### Testing Notifications

To exercise both paths from code (e.g. temporarily in a component or effect):

```typescript
import { notify, notifications } from '@/lib/notifications'

notifications.success('Test', 'Toast works')
await notify('Native test', 'Sent as a native notification', { native: true })
```

If the native call fails, the toast fallback fires — a native notification that never appears while the fallback toast does points at macOS notification permissions.

## Actionable toasts

`notify(title, message, options)` keeps the title and `description` separate and
accepts Sonner's `action` through `options`. The convenience methods keep their
existing `(title, message?, native?)` signature. Native notifications remain
OS-owned title/body messages; a native failure falls back to a structured toast.
`notifications.message` is neutral feedback; `info` uses the accent role.

Callers that need stable IDs, owner cleanup or tailored actions may continue to
use `toast` directly. Both paths share `AppToaster`. See `src/lib/updater.ts` for
the manual update check's Releases action and 10-second duration. Labels must
perform the named action, not just dismiss the toast. Project actions recheck
the current owner and availability on click. Do not offer a fake Undo action.

## Flow toasts (progress → outcome in one place)

Long-running flows (the setlist export, v1.4.0 after #59) use `notifications.flow` instead of firing a stack of toasts: `step(id, title, description?)` puts up a loading toast; later `step` calls with the SAME `id` refresh its description (per-project progress), and `succeed(id, …)` / `fail(id, …)` morph that same toast into the outcome — progress and completion read as one indicator, never two. The id is flow-scoped (e.g. `setlist-export:<folderId>`); there is no native variant and no extra logging (the owning flow logs its own milestones).

### Approved B operation feedback (2026-11-04)

The user selected the [B prototype](../prototypes/operation-feedback-review.md).
Git version writes, bundle installation, setlist import/export, recording
commands, DNS actions, manual update checks and handoff operations use the
existing `AppToaster` presentation. Its four-theme palette, placement, icon
tile, typography and stacking remain unchanged; there is no second notification
provider, simulated progress or new progress-bar style.

- Start `step` before awaiting the operation. Update the same id at real frontend
  command boundaries, project counts or native current-file byte reports.
- Use `succeed` only for the actual completed operation. `warn` preserves partial
  success, such as a saved version whose history could not refresh. `message`
  ends the pending state as information (no changes, review ready or cancellation).
  These methods accept optional `{ action, duration }` as a fourth argument.
- Every failure, cancellation and invalidated owner must settle or `dismiss`
  its pending notification. Stale progress must not recreate it. Existing local
  conflicts, copyable error detail and genuine cancellation controls remain.
- The user's later 2026-11-04 decision removes the blue **Close notification**
  action from pending flows. Sonner's loading type retains its existing
  no-close-button behavior; the same notification updates in place until the
  outcome. Lifecycle `dismiss` still handles cancellation and owner cleanup.
  Outcomes retain Sonner's existing close button and finite lifetime;
  informational outcomes use `info` so Sonner does not retain the old loading
  type when merging an id. Genuine Refresh, Retry and Releases actions remain.
- A retry that updates the same toast from its action calls
  `event.preventDefault()` before starting, preventing Sonner's default action
  dismissal from hiding the new pending state. Recheck ownership on click.

Bundle installation success means installed, not preflight passed or running.
Recording duration is not save progress. DNS authorization pending is a warning,
not successful enablement. Manual update checks retain the Releases action and
failure dialog; boot checks remain silent. Handoff byte counts refer to the
current file, while its existing in-panel progress and cancellation stay available.
Ordinary file saves and automatic preferences do not produce extra flow toasts.

Installation and setlist import coalesce concurrent requests for the same source
and serialize different sources. Setlist export is single-flight from its native
directory picker through completion because its native progress event has no
request id. This keeps one operation's progress and outcome from overwriting
another's notification. A failed catalog refresh after a successful baseline
retry preserves the receipt; retrying that completed baseline only reloads the
catalog.

### Workspace feedback placement

An unavailable Client connection uses the main App's error toast. The sidebar
retains address inspection and any applicable retry. Repeated polls within the
same outage share one toast, and recovery clears it.

Controllers mounted above the Discussion/Git navigation do not render in-flow
loading, result, receipt or warning rows. `CreationHandoff` in `menuOnly` mode
hosts its explicit review dialog only; hiding its buttons must not leave a
receipt summary, Copy action or baseline error above the workspace tabs.
Project-opening waits use the existing loading toast instead of a shell status
paragraph. Navigation does not replay an operation's result.

Transient progress and outcomes belong to the flow toast. Durable facts retain
their normal owner: handoff receipts, prompt copying and baseline failures live
with the [handoff document](./handoff-baselines.md#read-only-comparison-and-reading-navigation);
Git warnings, excluded-file explanations, repository state and retained errors
live behind a fixed [Git toolbar details entry](./local-git.md#middle-workspace-version-page-2026-10-19).
The Git toolbar's existing Refresh action also handles pending synchronization;
no additional recovery row is inserted above the graph/difference split.
Opening these details is explicit. Modal validation and confirmation errors
remain beside their own controls, and dismissing a toast does not clear stored
errors or a successful native receipt.

### Pending compilation reminder

The first transition from zero to nonzero `pending.compile` in a pending-work
cycle shows one 8-second bottom-right reminder. The Compile action appears when
saved sources exist directly inside `supercollider/source`; relevant unsaved drafts
or a busy runtime disable it with an accessible reason.
Further saves, watcher polls and switching between Discussion and Git do not
renew or repeat it. Expiry or dismissal leaves the pending work intact; project
replacement invalidates the old reminder. The action rechecks the editable-folder,
saved-draft and runtime gates before dispatching the existing compilation flow.

This reminder reports work awaiting an explicit action. It does not start a
loading notification or a compiler by itself. Persistent compile, refresh and
restart state remains in the bottom-bar console control and console details;
`CreationView` has no pending-work banner above Discussion or Git. The console
can open while Git stays selected, preserving the mounted editor and its drafts.
See [running-version state](./creation-workspace.md#external-changes-and-running-versions-155).

An actual compile uses the existing flow notification from dispatch through its
real result, without a Close notification action. Success confirms compilation
only: it does not update a running project or clear changes made after the
captured revision. The native boundaries and verification scope remain under
[SynthDef compilation](./creation-workspace.md#synthdef-compilation).
If compilation succeeds but the file-list poll fails, preserve the compilation
report and show a synchronization warning rather than reporting compilation failure.

### Advanced Usage

```typescript
// Custom duration (5 seconds)
notify('Long message', 'This will stay visible for 5 seconds', {
  duration: 5000,
})

// Persistent toast (no auto-dismiss)
notify('Important', 'This requires manual dismissal', {
  duration: 0,
})

// Native notification with fallback
await notify('System Alert', 'Check this out', { native: true })
// Native failures are logged and handled by the toast fallback.
```

## Implementation Details

### Frontend (TypeScript)

- **Location**: `src/lib/notifications.ts`
- **Dependencies**: Sonner for toasts, Tauri API for native notifications
- **Error handling**: Automatic fallback from native to toast
- **Logging**: All notification actions are logged via logger utility

### Backend (Rust)

- **Command**: `send_native_notification`
- **Plugin**: `tauri-plugin-notification`
- **Platform support**: Desktop only (mobile shows error)
- **Logging**: Comprehensive logging of notification attempts

### Permissions

Native notifications require the `notification:default` permission in `src-tauri/capabilities/default.json`:

```json
{
  "permissions": ["notification:default"]
}
```

## Best Practices

1. **Choose the right type**: Use toast for in-app feedback, native for system-level alerts
2. **Keep messages concise**: Short titles and clear messages work best
3. **Use appropriate types**: Match notification type to the action result
4. **Handle errors**: The system includes automatic fallback handling
5. **Test both modes**: Trigger a toast and a native notification from code before relying on them

## Troubleshooting

### Native Notifications Not Working

1. **Check permissions**: Ensure notification permissions are granted in macOS System Preferences
2. **Check console**: Look for permission request dialogs or error messages
3. **Test fallback**: Native notifications automatically fall back to toasts on failure
4. **Development mode**: Notifications work in both dev and production builds

### Toast Notifications Not Appearing

1. **Check Toaster component**: Ensure `<AppToaster />` is rendered in AppShell
2. **Check theme**: Toasts should adapt to current theme automatically
3. **Check positioning**: Default position is bottom-right

## Creation shell failures (2026-10-19)

`CreationErrorToast` uses one stable Sonner id per workspace/error source with a
4-second lifetime. Dependencies are the error code/detail strings, so repeated
polling of the same failure does not stack or continually renew the notification.
Clearing the error or leaving its owner dismisses it. Runtime details can open the
console explicitly after checking the project identity; errors do not open or
resize the console by themselves. Error records and conflict protections are not
cleared when a toast expires. Validation/confirmation errors remain local to the
form. The main Toaster is offset above the bottom transport.

## Shared transient feedback (2026-10-24)

Six existing families use the same presentation: clipboard results, Git version
save/rename, setlist import/export and bundle installation failures, background
project/operation failures, limits/degraded operation, and manual update checks.
No dependency on HeroUI or a second notification provider is needed.

- Cards use the theme surface, border and shadow. Lucide indicators use neutral,
  accent, success, warning or danger ink on a lightly tinted tile. Sonner's
  loading indicator inherits the same ink, including Stage. Brutal retains its
  square geometry and hard shadow.
- Titles give the result; descriptions carry version names, URLs or reasons.
  Copy success stays compact. Text wraps without ellipsis; multiline reasons
  remain readable. Creation's existing long-error height/scroll limit remains.
- Actions share the theme accent button and visible keyboard focus. Narrow
  windows move the action below the explanation. Dismiss buttons and the
  notification region have localized accessible names; Sonner retains its
  keyboard access, focus restoration, hover pause, stacking and reduced-motion
  handling. The toast offset stays above transport controls.
- Cancellation after port identity/ownership changes is neutral `message`.
  An unavailable saved output device falling back to system default is
  `warning`; ongoing runtime channel loss remains the persistent indicator.
- Git success descriptions use the actual saved/renamed version returned by the
  backend. Background materials failures include an owner-checked Open materials
  action; an already open panel stays in place.

Blocking confirmations, persistent runtime/assistant errors, field validation,
file conflicts, native permissions/dialogs and boot-time silent update checks
keep their existing interaction. Toast dismissal never resolves a stored error.
Do not emit extra toasts for ordinary saves, parameter drags or every assistant
step. A new completion notification is a separate product decision.
