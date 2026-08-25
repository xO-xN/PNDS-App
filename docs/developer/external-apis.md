# External APIs

Patterns for calling external HTTP APIs from Tauri applications.

> **Note:** No HTTP client is installed in this app — not on the Rust side and not as a frontend wrapper. When a feature needs external HTTP, add a Rust-side command with `reqwest` (below), or consider `tauri-plugin-http` (see [tauri-plugins.md](./tauri-plugins.md)). For token storage, use the `keyring` crate (OS keychain) rather than plain files.

## Rust vs Frontend: When to Use Which

**Default recommendation: Use Rust backend (reqwest)**

| Approach         | Pros                                           | Cons                                  |
| ---------------- | ---------------------------------------------- | ------------------------------------- |
| Rust (reqwest)   | CORS bypass, secure token storage, type safety | More code per endpoint                |
| Frontend (fetch) | No extra dependencies, familiar API            | CSP must allow the host, exposed keys |

### Use Rust Backend For

- All authenticated API calls (keeps tokens out of WebView)
- APIs with CORS restrictions (desktop apps bypass CORS from Rust)
- Calls requiring response caching to local storage
- Production applications

### Use Frontend Fetch For

- Public APIs with no authentication
- Rapid prototyping before moving to Rust
- Third-party SDKs requiring browser context

The webview's `fetch` is subject to the app CSP: `connect-src` in `src-tauri/tauri.conf.json` currently allows only `'self'`, `tauri:`, `ipc:`, and `http://ipc.localhost` — a plain `fetch` to an external host fails until that host is added to `connect-src`.

## Setup

```bash
# Rust HTTP client
cd src-tauri && cargo add reqwest --features json,rustls-tls
```

For simple cases, `tauri-plugin-http` (the `http` row in tauri-plugins.md's "Plugins to Consider Adding") is the lighter alternative.

For secure token storage, see the Authentication section below.

## Architecture Pattern

Follow the same pattern as local data: Tauri commands wrap API calls; the frontend calls the typed commands directly (introduce a query-cache layer only if a feature needs it).

```
React Component → Tauri Command (reqwest) → External API
```

### Rust Command

```rust
use reqwest;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct User {
    pub id: u32,
    pub name: String,
    pub email: String,
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_user(user_id: u32) -> Result<User, String> {
    let client = reqwest::Client::new();

    let response = client
        .get(format!("https://api.example.com/users/{user_id}"))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    response.json::<User>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}
```

### Frontend: call the typed command directly

There is no query-cache layer (no TanStack Query, no service hooks). Load on mount or in an event handler, with explicit status handling:

```typescript
import { commands, type User } from '@/lib/tauri-bindings'

const [user, setUser] = useState<User | null>(null)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
  let stale = false
  commands.fetchUser(userId).then(result => {
    if (stale) return
    if (result.status === 'error') {
      setError(result.error)
      return
    }
    setUser(result.data)
  })
  return () => {
    stale = true
  }
}, [userId])
```

## Authentication

### Token Storage Options

| Option                    | Security            | Use When                          |
| ------------------------- | ------------------- | --------------------------------- |
| `keyring` crate           | High (OS keychain)  | API tokens, credentials           |
| `tauri-plugin-stronghold` | High (encrypted DB) | Multiple secrets, encryption keys |
| `tauri-plugin-store`      | Low (plain JSON)    | Non-sensitive data only           |

For OS keychain access, use the `keyring` crate directly:

```bash
cd src-tauri && cargo add keyring
```

```rust
use keyring::Entry;

#[tauri::command]
#[specta::specta]
pub fn save_auth_token(token: String) -> Result<(), String> {
    let entry = Entry::new("myapp", "auth_token")
        .map_err(|e| format!("Keyring error: {e}"))?;
    entry.set_password(&token)
        .map_err(|e| format!("Failed to save token: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn get_auth_token() -> Result<Option<String>, String> {
    let entry = Entry::new("myapp", "auth_token")
        .map_err(|e| format!("Keyring error: {e}"))?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get token: {e}")),
    }
}
```

### Authenticated Requests

```rust
#[tauri::command]
#[specta::specta]
pub async fn fetch_protected_data() -> Result<Data, String> {
    let entry = Entry::new("myapp", "auth_token")
        .map_err(|e| format!("Keyring error: {e}"))?;
    let token = entry.get_password()
        .map_err(|_| "Not authenticated")?;

    let client = reqwest::Client::new();
    client
        .get("https://api.example.com/protected")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?
        .json::<Data>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}
```

## Error Handling

See [error-handling.md](./error-handling.md) for complete patterns. Key points for API calls — no query layer retries for you, so retry with an explicit budget and only for transient (network) failures:

```typescript
// Retry transient network errors, not validation errors
for (let attempt = 1; ; attempt++) {
  const result = await commands.fetchUser(userId)
  if (result.status === 'ok') return result.data
  if (attempt >= 3 || isPermanent(result.error)) {
    logger.warn('fetchUser failed', { attempt, error: result.error })
    return null
  }
}
```

## Offline Handling

For apps that need to work offline, cache API responses to SQLite:

```rust
#[tauri::command]
#[specta::specta]
pub async fn fetch_with_cache(app: tauri::AppHandle, id: u32) -> Result<Data, String> {
    // Try network first
    match fetch_from_api(id).await {
        Ok(data) => {
            cache_to_db(&app, &data)?;  // Cache for offline
            Ok(data)
        }
        Err(_) => {
            // Fallback to cache on network error
            load_from_cache(&app, id)
        }
    }
}
```

See [data-persistence.md](./data-persistence.md) for SQLite setup.

## Quick Reference

| Task            | Pattern                                    |
| --------------- | ------------------------------------------ |
| Basic API call  | Rust command with reqwest                  |
| Caching         | SQLite (frontend has no query-cache layer) |
| Token storage   | `keyring` crate (OS keychain)              |
| Type safety     | tauri-specta (same as local commands)      |
| Error handling  | Result types, see error-handling.md        |
| Offline support | Cache to SQLite, fallback on network err   |
