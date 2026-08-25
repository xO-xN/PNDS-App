# Data Persistence

Patterns for saving and loading data to disk.

## Choosing a Storage Method

| Need              | Solution           | When to Use                                              |
| ----------------- | ------------------ | -------------------------------------------------------- |
| App preferences   | Preferences System | Strongly-typed settings (language, audio, project index) |
| Relational data   | SQLite             | User data requiring queries, relationships               |
| External API data | External APIs      | Remote data (see [external-apis.md](./external-apis.md)) |

```
Need to persist data?
├─ App settings? → Preferences (Rust struct + src/lib/preferences.ts)
├─ User data with queries/relationships? → SQLite (see below)
└─ Remote API data? → external-apis.md
```

All data goes through Rust for type safety and security. The frontend reads via typed commands from `@/lib/tauri-bindings` — there is no query-cache layer; components load in on-mount effects and await commands directly. Every preference read and write flows through `src/lib/preferences.ts`.

## File Locations

```
~/Library/Application Support/com.xo-xn.pnds-app/  (macOS)
└── preferences.json    # App preferences (the app identifier comes from src-tauri/tauri.conf.json)
```

Logs are not stored here — `tauri-plugin-log` writes to the OS log directory (see [logging.md](./logging.md)).

## Atomic Write Pattern (Critical)

All file writes use atomic operations to prevent corruption. The reference implementation is `save_preferences` in `src-tauri/src/commands/preferences.rs`:

```rust
// Write to a temporary file first, then rename (atomic operation)
let temp_path = prefs_path.with_extension("tmp");
std::fs::write(&temp_path, json_content)?;

if let Err(rename_err) = std::fs::rename(&temp_path, &prefs_path) {
    // Clean up the temp file to avoid leaving orphaned files on disk
    let _ = std::fs::remove_file(&temp_path);
    return Err(format!("Failed to finalize preferences file: {rename_err}"));
}
```

**Why**: If the app crashes during write, you either have the old file or the new file - never a corrupted partial file.

## Preferences System

### Rust Side

The struct lives in `src-tauri/src/types.rs` with a `Default` implementation (used when no file exists yet):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AppPreferences {
    pub theme: String,          // Legacy field, load-only
    pub color_theme: String,
    pub language: Option<String>,
    pub output_device: Option<String>,
    pub sample_rate: Option<u32>,
    pub osc_targets: HashMap<String, String>,
    pub recent_projects: Vec<String>,
    pub project_folders: Vec<ProjectFolder>,
    pub project_display_names: HashMap<String, String>,
    pub project_manifest_names: HashMap<String, String>,
    pub offered_utilities: Vec<String>, // Utilities once-offer record (v1.3.0, issue #55)
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            // ... every remaining field gets a neutral default
        }
    }
}
```

`save_preferences` (in `src-tauri/src/commands/preferences.rs`) validates values at the save boundary (`validate_theme`, `validate_color_theme`, `validate_sample_rate`), writes atomically, and updates an in-memory `PreferencesCache` so repeated loads skip the disk.

### React Side

Every preference read and write goes through `src/lib/preferences.ts`. Loads degrade to `null` on error; saves are load-modify-write cycles serialized through one queue so overlapping patches cannot clobber each other:

```typescript
// src/lib/preferences.ts (excerpt)
export async function loadPreferences(): Promise<AppPreferences | null> {
  const result = await commands.loadPreferences()
  if (result.status === 'error') {
    logger.warn('Failed to load preferences', { error: result.error })
    return null
  }
  return result.data
}

export async function updatePreferences(
  patch: PreferencesPatch
): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadPreferences()
    if (!prefs) return
    await commands.savePreferences({ ...prefs, ...patch })
  })
}
```

Components consume it in an on-mount effect (see `AppShell.tsx`):

```typescript
useEffect(() => {
  void loadPreferences().then(prefs => {
    if (!prefs) return
    // seed stores from the loaded values
  })
}, [])
```

## Adding New Persistent Data

### 1. Define Rust struct

In `src-tauri/src/types.rs`, with derives and a `Default`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct MyData {
    pub field: String,
}

impl Default for MyData {
    fn default() -> Self {
        Self { field: "default".to_string() }
    }
}
```

### 2. Add Tauri commands

Follow the pattern in `src-tauri/src/commands/preferences.rs`:

- `load_*` command with Default fallback
- `save_*` command with atomic write

Write inside Tauri's `app_data_dir()` — never to arbitrary paths. If a command accepts a user-supplied filename, validate it to prevent path traversal:

```rust
if filename.contains("..") || filename.contains("/") || filename.contains("\\") {
    return Err("Invalid filename".to_string());
}
```

### 3. Register commands

Add to `src-tauri/src/bindings.rs` and regenerate bindings:

```bash
npm run rust:bindings
```

### 4. Load on the frontend

There is no data-fetching hook layer. Load in the consuming component's on-mount effect (or a flow module in `src/lib/`) with explicit status handling:

```typescript
useEffect(() => {
  let stale = false
  commands.loadMyData().then(result => {
    if (stale) return
    if (result.status === 'error') {
      setError(result.error)
      return
    }
    setData(result.data)
  })
  return () => {
    stale = true
  }
}, [])
```

## SQLite Database (When Needed)

> **Note:** SQLite is not installed in this app. Add it when your app needs relational data with queries.

### When to Use SQLite

| Use Case                         | Recommendation     |
| -------------------------------- | ------------------ |
| Simple key-value settings        | Preferences System |
| User data with relationships     | SQLite             |
| Data requiring complex queries   | SQLite             |
| Large datasets (1000+ records)   | SQLite             |
| Data needing atomic transactions | SQLite             |

### Approach Options

| Approach   | Use When                                              |
| ---------- | ----------------------------------------------------- |
| `rusqlite` | Simpler setup, synchronous queries, smaller apps      |
| `sqlx`     | Async queries, compile-time SQL checking, larger apps |

Both integrate with Tauri commands and tauri-specta for type safety.

### Setup (rusqlite)

```bash
cd src-tauri && cargo add rusqlite --features bundled
```

### Architecture Pattern

Tauri commands wrap database operations; the frontend calls the typed commands directly (there is no query-cache layer — if one becomes necessary, introduce it with the feature that needs it).

```
React Component → Tauri Command (rusqlite) → SQLite
```

```rust
use rusqlite::{Connection, params};
use std::sync::Mutex;
use tauri::State;

// Database connection managed as Tauri state
pub struct DbConnection(pub Mutex<Connection>);

#[tauri::command]
#[specta::specta]
pub fn get_items(db: State<DbConnection>) -> Result<Vec<Item>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM items ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let items = stmt
        .query_map([], |row| {
            Ok(Item {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(items)
}
```

Initialize in `src-tauri/src/lib.rs`:

```rust
let db_path = app.path().app_data_dir()?.join("app.db");
let conn = Connection::open(&db_path)?;

// Run migrations
conn.execute(
    "CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )",
    [],
)?;

app.manage(DbConnection(Mutex::new(conn)));
```

```typescript
// Frontend: typed commands from @/lib/tauri-bindings, with explicit
// loading/error state in the consuming component
useEffect(() => {
  let stale = false
  commands.getItems().then(result => {
    if (stale || result.status === 'error') return
    setItems(result.data)
  })
  return () => {
    stale = true
  }
}, [])
```

### Migration Rules

- Run migrations at app startup before managing database state
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotent migrations
- For complex apps, consider a version table to track applied migrations
