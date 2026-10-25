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
