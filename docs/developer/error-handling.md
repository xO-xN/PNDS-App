# Error Handling

Patterns for consistent error handling across Rust and TypeScript.

## Error Propagation Flow

```
Rust Command (Result<T, E>) → tauri-specta → TypeScript discriminated union → UI
```

Rust `Result<T, E>` types become TypeScript discriminated unions — every command that can fail returns `{ status: 'ok', data }` or `{ status: 'error', error }`. The exact `Result` type definition (and the `unwrapResult` helper) is documented in [tauri-commands.md](./tauri-commands.md).

## Rust Error Types

### Simple Commands

For commands with one failure mode, use `String` errors:

```rust
#[tauri::command]
#[specta::specta]
pub async fn simple_operation() -> Result<Data, String> {
    do_work().map_err(|e| format!("Operation failed: {e}"))
}
```

### Production Commands

For commands with multiple failure modes, use structured error enums:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type")]  // Creates TypeScript discriminated union
pub enum MyError {
    NotFound,
    ValidationError { message: String },
    IoError { message: String },
}

impl std::fmt::Display for MyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MyError::NotFound => write!(f, "Not found"),
            MyError::ValidationError { message } => write!(f, "{message}"),
            MyError::IoError { message } => write!(f, "IO error: {message}"),
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn production_operation() -> Result<Data, MyError> {
    // ...
}
```

TypeScript receives:

```typescript
type MyError =
  | { type: 'NotFound' }
  | { type: 'ValidationError'; message: string }
  | { type: 'IoError'; message: string }
```

## TypeScript Error Handling

### Pattern 1: Explicit Handling (Event Handlers)

```typescript
// ✅ GOOD: Handle errors inline with user feedback
const handleSave = async () => {
  const result = await commands.saveData(data)
  if (result.status === 'error') {
    toast.error('Save failed', { description: result.error })
    return
  }
  toast.success('Saved!')
}
```

### Pattern 2: unwrapResult (throwing boundaries)

`unwrapResult` throws on the error variant, for callers that prefer
exceptions (e.g. a promise chain that ends in a toast). Prefer Pattern 1
in most code — explicit branches read better in this codebase.

```typescript
// ✅ GOOD: Propagate to the caller's catch
void unwrapResult(await commands.loadData())
```

### Pattern 3: Graceful Degradation

```typescript
// ✅ GOOD: Fall back to defaults on error
const result = await commands.loadPreferences()
const prefs = result.status === 'error' ? defaultPreferences : result.data
```

## User-Facing vs Technical Errors

### Rust: Log Technical Details, Return User Messages

```rust
// ✅ GOOD: Log technical details, return user-friendly message
pub async fn load_file(path: &str) -> Result<String, String> {
    log::debug!("Loading file: {path}");

    std::fs::read_to_string(path).map_err(|e| {
        log::error!("Failed to read file {path}: {e}");  // Technical log
        format!("Could not read file")                   // User message
    })
}
```

### TypeScript: Toast for Users, Logger for Debugging

```typescript
// ✅ GOOD: Separate user feedback from technical logging
const result = await commands.saveData(data)
if (result.status === 'error') {
  logger.error('Save failed', { error: result.error, data }) // Technical
  toast.error('Failed to save') // User-facing
}
```

## Retries

Retries live where the operation lives — no frontend query layer retries
for you:

- **Rust**: retry transient failures inside the command (e.g. the
  transient-crash scsynth boot retries via `boot_with_transient_retries`
  in `src-tauri/src/project/audio.rs`, issue #92), so the
  policy is testable next to the operation.
- **Frontend**: a plain loop for the rare case (keep it in the flow
  module, not the component); log and surface a user message when the
  budget runs out.

```typescript
// ✅ GOOD: Explicit budget in the flow module
for (let attempt = 1; ; attempt++) {
  const result = await commands.loadData()
  if (result.status === 'ok') return result.data
  if (attempt >= 3 || isPermanent(result.error)) {
    logger.warn('loadData failed', { attempt, error: result.error })
    return null
  }
}
```

## Global Error Toasts

Prefer toasts at the action site (the user knows what failed) —
`notifications.error` from `@/lib/notifications` with an i18n string.
Avoid firing the same toast from multiple code paths for one failure.

## React Error Boundaries

Error boundaries catch render errors, not async errors:

| Caught by Error Boundary    | NOT Caught                          |
| --------------------------- | ----------------------------------- |
| Errors during render        | Errors in event handlers            |
| Errors in lifecycle methods | Async code (promises)               |
| Errors in constructors      | Errors in the error boundary itself |

For async Tauri command errors, use explicit `status` handling (or
`unwrapResult` when a throwing boundary fits).

## Rollback Pattern

For multi-step operations, rollback on failure:

```typescript
// ✅ GOOD: Rollback on failure — direct awaits, manual restore
const handleChange = async (newValue: string) => {
  const oldValue = currentValue

  // Step 1: Update backend via the typed command
  const result = await commands.updateValue(newValue)
  if (result.status === 'error') {
    toast.error('Update failed')
    return
  }

  // Step 2: Persist via a direct await; restore the previous value on failure
  const save = await commands.savePreferences({ ...prefs, value: newValue })
  if (save.status === 'error') {
    await commands.updateValue(oldValue) // Rollback step 1
    toast.error('Save failed, changes reverted')
  }
}
```

(Preference writes normally go through `updatePreferences` in `@/lib/preferences`, which serializes saves — reach for this two-step pattern only when an operation spans a backend change and a persistence change.)

## Quick Reference

| Scenario               | Rust Error Type | TypeScript Pattern       | User Feedback    |
| ---------------------- | --------------- | ------------------------ | ---------------- |
| Simple command         | `String`        | if/else + toast          | Toast on error   |
| Multiple failure modes | Structured enum | Match on `.type`         | Context-specific |
| Data loading           | Either          | On-mount effect + status | Inline error UI  |
| Optional feature       | Either          | Graceful degradation     | Silent fallback  |
| Critical operation     | Structured enum | Explicit + rollback      | Toast + recovery |

See also: [tauri-commands.md](./tauri-commands.md) for Result type patterns, [logging.md](./logging.md) for logging best practices.
