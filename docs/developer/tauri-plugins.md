# Tauri Plugins

Guide to all Tauri plugins installed in this app, plus built-in features and guidance on when to add more.

## Installed Plugins

### Core Functionality

| Plugin              | Purpose                                 | Frontend Package                  |
| ------------------- | --------------------------------------- | --------------------------------- |
| **single-instance** | Prevents multiple app instances         | None (Rust-only)                  |
| **window-state**    | Saves/restores window position and size | `@tauri-apps/plugin-window-state` |

### File System & Storage

| Plugin              | Purpose                            | Frontend Package            |
| ------------------- | ---------------------------------- | --------------------------- |
| **fs**              | File system access                 | `@tauri-apps/plugin-fs`     |
| **persisted-scope** | Persistent file access permissions | None (Rust-only)            |
| **dialog**          | Native open/save/message dialogs   | `@tauri-apps/plugin-dialog` |

### System Integration

| Plugin                | Purpose                           | Frontend Package                       |
| --------------------- | --------------------------------- | -------------------------------------- |
| **opener**            | Open files/URLs with default apps | `@tauri-apps/plugin-opener`            |
| **clipboard-manager** | Clipboard read/write              | `@tauri-apps/plugin-clipboard-manager` |
| **notification**      | System notifications              | `@tauri-apps/plugin-notification`      |
| **process**           | Exit/restart app                  | `@tauri-apps/plugin-process`           |
| **os**                | OS information                    | `@tauri-apps/plugin-os`                |
| **updater**           | In-app updates                    | `@tauri-apps/plugin-updater`           |

### Logging

| Plugin  | Purpose                     | Frontend Package         |
| ------- | --------------------------- | ------------------------ |
| **log** | Structured app-wide logging | `@tauri-apps/plugin-log` |

## Plugin Usage Patterns

### Single Instance

Prevents multiple instances of your app from running. When a user tries to open a second instance, the existing window is focused instead.

**Configuration** (`src-tauri/src/lib.rs`):

```rust
#[cfg(desktop)]
{
    app_builder = app_builder.plugin(tauri_plugin_single_instance::init(
        |app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
        },
    ));
}
```

**Important**: This plugin must be registered FIRST in the plugin chain.

### Window State

Automatically saves and restores window position, size, and state (maximized, etc.).

**How it works**:

- Window state is saved when the app closes
- State is restored when the app opens
- Only applies to windows listed in capabilities (main window only)

**No frontend code needed** - works automatically.

### Context Menus

Right-click menus are React components, not a plugin: the designed menus use the shadcn/Radix context-menu primitive (`src/components/ui/context-menu.tsx`; see `Sidebar.tsx` for usage). The WebView's default right-click menu is suppressed app-wide from Rust (`window::suppress_default_context_menu`, called in `lib.rs` setup), so right-click belongs to the designed menus only.

### Dialog

Native file open/save dialogs and message boxes. The app uses `open` (the developer-tools pickers in `src/components/settings/DeveloperSection.tsx`); the project/bundle ⌘O picker is a custom NSOpenPanel command instead (`pickProjectOrBundle`).

```typescript
import { open } from '@tauri-apps/plugin-dialog'

// Open file dialog
const file = await open({
  multiple: false,
  filters: [{ name: 'Text', extensions: ['txt', 'md'] }],
})
```

### Notifications

System notifications go through the typed command (which wraps the Rust plugin):

```typescript
import { commands } from '@/lib/tauri-bindings'
await commands.sendNativeNotification('Title', 'Body text')
```

`src/lib/notifications.ts` layers this behind one `notify()` helper that picks between an in-app toast and a native notification.

### Clipboard

Read/write system clipboard.

```typescript
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager'

await writeText('Hello, clipboard!')
const text = await readText()
```

### Opener

Open files/URLs with the default system application.

```typescript
import { openUrl, openPath } from '@tauri-apps/plugin-opener'

// Open URL in default browser
await openUrl('https://example.com')

// Open file with default app
await openPath('/path/to/document.pdf')
```

## Built-in Features (No Plugin Needed)

### System Tray

Built into Tauri v2 via the `tray-icon` feature. See [Tauri docs](https://v2.tauri.app/learn/system-tray/).

### App Menus

The Menu API is built into `@tauri-apps/api/menu`. This app uses it for the application menu (app / File / Edit / View / Window submenus), built from JavaScript for i18n — see `src/lib/menu.ts` and [menus.md](./menus.md).

## Plugins to Consider Adding

These plugins aren't included by default but are commonly needed:

| Plugin         | When to Add                                                 |
| -------------- | ----------------------------------------------------------- |
| **shell**      | Need to spawn child processes or run terminal commands      |
| **http**       | Making API calls that need to bypass CORS                   |
| **autostart**  | Utility apps that should launch at system startup           |
| **deep-link**  | Custom URL schemes (myapp://path)                           |
| **sql**        | Local SQLite database for structured data                   |
| **positioner** | Tray apps or floating windows that need precise positioning |

## Adding a New Plugin

1. **Install via CLI**:

   ```bash
   npm run tauri add PLUGIN_NAME
   ```

2. **Check placement** in `lib.rs`:
   - `single-instance` must be FIRST
   - Desktop-only plugins should be wrapped in `#[cfg(desktop)]`

3. **Add capability permissions** if needed (check plugin docs)

4. **Create frontend utilities** in `src/lib/` if the plugin needs a wrapper

## Plugin Registration Order

The order plugins are registered matters:

1. **single-instance** - Must be first
2. **window-state** - Before other windowing plugins
3. **updater** - Desktop only
4. All other plugins in any order

## References

- [Tauri v2 Plugin Documentation](https://v2.tauri.app/plugin/)
- [Official Plugins Repository](https://github.com/tauri-apps/plugins-workspace)
- [Window State Plugin](https://v2.tauri.app/plugin/window-state/)
- [Single Instance Plugin](https://v2.tauri.app/plugin/single-instance/)
