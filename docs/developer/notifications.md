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
- **Themed**: Automatically adapt to light/dark theme
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
  type?: 'success' | 'error' | 'info' | 'warning' // Notification type
  native?: boolean // Use native notification
  duration?: number // Toast duration (ms, 0 = no auto-dismiss)
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

`@/lib/notifications` flattens to `title: message` and cannot carry action buttons. Flows that need a toast with an action (e.g. the updater's Install / Restart buttons, v1.3.2 issue #74) call sonner's `toast` directly inside their own module — see `src/lib/updater.ts` for the pattern (locale copy via `i18n.t`, longer `duration` so the buttons stay reachable).

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
try {
  await notify('System Alert', 'Check this out', { native: true })
} catch (error) {
  // Automatically falls back to toast notification
  console.log('Native notification failed, showed toast instead')
}
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

1. **Check Toaster component**: Ensure `<Toaster />` is rendered in AppShell
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
