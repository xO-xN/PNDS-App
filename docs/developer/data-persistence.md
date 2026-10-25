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
├── preferences.json    # App preferences (the app identifier comes from src-tauri/tauri.conf.json)
├── assistant-history/  # Legacy path-keyed chat records retained as migration backups
├── assistant-materials/ # Legacy path-keyed text copies retained as migration backups
├── assistant-tasks/    # Short-lived before/after/pending bytes for unfinished task recovery
├── assistant-resume/   # Private schema-1 execution checkpoints, canonical root + inode
└── controlled-check-reports/ # Completed native check evidence, revalidated on resume
```

```text
<project>/.pnds-creation/
├── history.json        # Versioned chat snapshots, carried with the project folder
└── materials.json      # Immutable creator-selected UTF-8 copies
```

`assistant_history` stores schema 7 JSON (reading schemas 1–6 additively) in
`<project>/.pnds-creation/history.json`. This reserved directory also contains
creation materials. Moving or copying the complete folder carries these records;
subsequent saves and clears affect only that physical copy. Symlink aliases of
one actual project share its records. The live project key remains SHA-256 of
the canonical actual source directory, not the manifest ID. Loading a carried
history validates its stored owner and attachment/proposal keys, rebinds those
keys to the current directory and rotates the write epoch. Copies never select
a shared external record merely because their manifest or stored key matches.
Commands resolve the current editable workspace and hold its native access lock
through blocking I/O. The directory is excluded from the source tree, ordinary
assistant file tools, Git versions and performance `.pnds` bundles; history is
not copied into handoff documents.

When the local record is absent, the current directory's legacy
`assistant-history/<projectKey>.json` in App data is validated and atomically
migrated. The legacy bytes remain as a backup. An existing local record, even
an explicitly cleared one, takes precedence; corrupt or unsupported local data
fails visibly instead of falling back or merging. Reopen an older project once
at its original location before moving it. If it was already moved before this
migration, restore the original path once: a path hash cannot safely identify
the old record from an unrelated destination. Task journals, undo and execution
checkpoints remain in App data with their existing root/inode ownership; carrying
chat history does not migrate task execution or revive authority.

Logs are not stored here — `tauri-plugin-log` writes to the OS log directory (see [logging.md](./logging.md)).

Chat history uses its own bounded schema and atomic publication, rather than the
preferences queue. Canonical directory identity, captured write epochs, corruption
recovery and authority-free restoration are documented in
[Creation assistant](./creation-assistant.md#private-project-history-167).

Creation materials use a separate schema-2 project-local collection. A held
no-follow directory descriptor covers record reads
and atomic staging/publication; add/remove keep existing valid bytes on failure.
The collection is independent of chats and artwork source files, capped at 64 items,
1 MiB per text and 8 MiB serialized storage. Unknown/corrupt collections are
refused rather than recreated. See
[private text materials](./creation-workspace.md#private-text-creation-materials-241--248).

Private chat schema 4 adds bounded assistant-only display activity, separate
from final reply text and runtime checkpoints. Schemas 1–3 still load without
inventing missing activity or splitting old concatenated prose. Activity never
restores execution authority or enters model-history text.

Schema 5 adds optional assistant-only `reasoningContent` for DeepSeek protocol
replay. Schemas 1–4 still load without inventing missing reasoning. It is separate
from visible text/activity and is never rendered or used as summary prose. Each
reasoning field is bounded at 1 MiB and private chat files at 8 MiB/400 messages.
Execution checkpoints permit this field only on assistant entries in the exact
`history` and `continuation.messages` lists; credentials remain forbidden at every
depth. Atomic publication, owner checks and fresh native authorization still apply.

Execution checkpoints remain App-local and do not travel with portable chat or
materials. They are separate from chat history and preferences. Native
atomic publication, owner/inode validation, task-journal reconciliation and an
8 MiB payload bound protect resumption. The frontend save/clear queue waits at
completed tool boundaries; live grants and in-flight responses are not persisted.
Opening a record displays a continuation opportunity, while explicit Continue
revalidates saved bytes and acquires a fresh task grant. See
[durable task continuation](./creation-assistant.md#shared-tool-contracts-and-durable-task-continuation-2026-10-18).

The version-1 frontend checkpoint has an explicit persisted-field allowlist;
runtime continuation additions are never serialized implicitly. The task
lifecycle module coordinates boundary publication, pause/teardown retention and
final-chat-before-checkpoint-clear ordering. Chat snapshots, execution recovery
and native task journals remain separate records with separate authority.

Task journals are recovery data, not a second version history. Revoking the
current native grant does not end the logical task: pause, resource/question
waits, recoverable errors and workspace teardown retain their recovery records.
An explicit task retirement first durably marks its journal retired, then clears
only its matching execution checkpoint and removes the journal. Finished chat
and question receipts must be saved before retirement. Ordinary reads, resume and
checkpoint publication reject retired or missing journals. Cleanup retries at
recovery/admission boundaries after a crash or deletion failure; it cannot touch
a newer task, another directory identity, project source, private chat/materials,
or Git. Old journals without an explicit terminal marker are not classified as
finished merely by age or the absence of a checkpoint. See
[task snapshot retention](./creation-assistant.md#task-snapshot-retention-2026-10-23).

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

Every preference read and write goes through `src/lib/preferences.ts`. Loads degrade to `null` on error; saves are load-modify-write cycles serialized through one queue so overlapping patches cannot clobber each other. The queue owns the complete read/merge/save operation for both field patches and OSC targets:

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
): Promise<boolean> {
  return enqueueSave(prefs => ({ ...prefs, ...patch }))
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

### Save Outcomes

`updatePreferences` and `updateOscTarget` resolve `true` only when Rust returns a
successful save. They resolve `false` on a failed load, a returned save error,
or a rejected IPC promise. Operation failures never escape as an unhandled
rejection from a `void` call. A failed load does not write fallback defaults.

The module logs each failure once: load failures through `loadPreferences`,
save failures through the shared queue. Save logs include the error message,
never the patch, full preferences or OSC target; preferences carry the hub token.
The next queued operation reloads the persisted state and continues normally,
without implicitly replaying the failed patch. There is no automatic retry or
rollback of the in-memory setting.

Callers that need to distinguish saved from merely applied must inspect the
boolean; awaiting completion alone does not prove persistence. Theme and language
remain immediately applied, but their completion logs run only after a successful
save. Structural store commits may continue to fire-and-forget: failure is
reported centrally and does not undo their live state.

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

App-local records belong inside Tauri's `app_data_dir()`. Portable creation records
use the current validated workspace's held directory descriptor and reserved
`.pnds-creation` directory; never accept an arbitrary frontend storage path.
If a command accepts a user-supplied filename, validate it to prevent path traversal:

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

## New-project parent directory

`AppPreferences.lastCreationParent` is a nullable, serde-defaulted absolute path.
Old files load with no remembered directory. The creation store mirrors the most
recent owned native selection, and saves only through `updatePreferences` so the
parent choice cannot clobber other preference fields. Startup restoration adopts
a loaded parent only before any current-run choice; open forms observe the mirror
through a selector. Cancellation and stale picker results do not replace it.

Save-boundary validation rejects relative paths and NUL, without checking whether
the directory currently exists or is writable. The creation command owns those
filesystem failures and retry. Preference save failures follow the shared queue's
existing logging and no automatic rollback contract.

### Automatic context migration

Legacy `ModelContextConfig` without `mode` decodes as automatic. Old input targets
and capacities remain loadable but are inactive; both active configuration and
stored per-model profiles use the same native interpretation. The next settings
save writes explicit `auto` and clears capacity/inputTarget while preserving
output/reasoning options. Only explicit `manual` restores token admission limits.
No credentials or unrelated preferences are rewritten by migration.
