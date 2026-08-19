# State Management

Two-layer "onion" architecture for state management.

## The Two Layers

```
┌─────────────────────────────────────┐
│           useState                  │  ← Component UI State
│  ┌─────────────────────────────────┐│
│  │          Zustand                ││  ← Global UI State
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

> v1.2.0: the TanStack Query layer was removed. It was scaffolded but
> never adopted — every real fetch went through on-mount effects calling
> typed commands directly. If a future feature genuinely needs query
> caching and automatic refetching, reintroduce a query layer then, sized
> to that feature.

### Layer 1: Zustand (Global UI State)

Use for transient global state:

- Panel visibility, layout state
- Command palette open/closed
- UI modes and navigation

Persisted state (preferences, project index) does not need a query layer:
`src/lib/preferences.ts` owns the preference file (load + serialized
update queue), and `project-store`'s structural actions persist as part of
their commit (see [Persisting Store State](#persisting-store-state-v120-pattern)).

```typescript
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface UIState {
  sidebarVisible: boolean
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>()(
  devtools(
    set => ({
      sidebarVisible: true,
      toggleSidebar: () =>
        set(state => ({ sidebarVisible: !state.sidebarVisible })),
    }),
    { name: 'ui-store' }
  )
)
```

### Layer 2: useState (Component State)

Use for state that:

- Only affects UI presentation
- Is derived from props or global state
- Is tightly coupled to component lifecycle

```typescript
const [isDropdownOpen, setIsDropdownOpen] = useState(false)
const [windowWidth, setWindowWidth] = useState(window.innerWidth)
```

## Performance Patterns (Critical)

### The `getState()` Pattern

**Problem**: Subscribing to store data in callbacks causes render cascades.

**Solution**: Use `getState()` for callbacks that need current state.

```typescript
// ❌ BAD: Causes render cascade on every store change
const { currentFile, isDirty, saveFile } = useEditorStore()

const handleSave = useCallback(() => {
  if (currentFile && isDirty) {
    void saveFile()
  }
}, [currentFile, isDirty, saveFile]) // Re-creates on every change!

// ✅ GOOD: No cascade, stable callback
const handleSave = useCallback(() => {
  const { currentFile, isDirty, saveFile } = useEditorStore.getState()
  if (currentFile && isDirty) {
    void saveFile()
  }
}, []) // Stable dependency array
```

**When to use `getState()`:**

- In `useCallback` dependencies when you need current state but don't want re-renders
- In event handlers for accessing latest state without subscriptions
- In `useEffect` with empty deps when you need current state on mount only
- In async operations when state might change during execution

### Store Subscription Optimization

```typescript
// ❌ BAD: Object destructuring subscribes to entire store
const { currentFile } = useEditorStore()

// ✅ GOOD: Selector only re-renders when this specific value changes
const currentFile = useEditorStore(state => state.currentFile)

// ✅ GOOD: Derived selector for minimal re-renders
const hasCurrentFile = useEditorStore(state => !!state.currentFile)
const currentFileName = useEditorStore(state => state.currentFile?.name)
```

### CSS Visibility vs Conditional Rendering

For stateful UI components (like `react-resizable-panels`), use CSS visibility:

```typescript
// ❌ BAD: Conditional rendering breaks stateful components
{sidebarVisible ? <ResizablePanel /> : null}

// ✅ GOOD: CSS visibility preserves component tree
<ResizablePanel className={sidebarVisible ? '' : 'hidden'} />
```

### React Compiler (Automatic Memoization)

This app uses React Compiler which automatically handles memoization. You do **not** need to manually add:

- `useMemo` for computed values
- `useCallback` for function references
- `React.memo` for components

**Note:** The `getState()` pattern is still critical - it avoids store subscriptions, not memoization.

## Store Boundaries

**UIStore** - Use for:

- Panel visibility
- Layout state
- Command palette state
- UI modes and navigation

**Feature-specific stores** - Use for:

- Domain-specific state (e.g., `useDocumentStore`)
- Feature flags and configuration
- Temporary workflow state

## Persisting Store State (v1.2.0 pattern)

`src/lib/preferences.ts` is the only preferences writer: every field save
goes through `updatePreferences(patch)` (or `updateOscTarget` for the
per-project map), each a load-modify-write cycle inside one serialized
queue so overlapping updates never clobber each other.

In `project-store.ts`, persistence is part of the commit — **structural
actions save the project index themselves** (`addRecentProject`,
`removeRecentProject`, folder lifecycle, membership moves, drag reorder
commits, `setProjectFolders`, `setProjectDisplayName`,
`preflightSucceeded`/`upsertManifestProjectNames` for the name maps).
Callers never pair a mutation with a save; a missed save is no longer
possible. No-op guards (protected folders, ignored drag sets) and repeat
commits write nothing.

Launch restore must never write back: it goes through the non-persisting
bulk setters (`restoreProjectIndex`, `setProjectDisplayNames`,
`setManifestProjectNames`) instead of the structural actions.

## Adding a New Store

1. Create store file in `src/store/`, following the plain `create` pattern
   of the existing stores (`project-store.ts`, `session-store.ts`,
   `window-store.ts`, `keyboard-store.ts`)
2. Add a no-destructure rule entry to
   `.ast-grep/rules/zustand/no-destructure.yml`

```yaml
rule:
  any:
    - pattern: const { $$$PROPS } = useUIStore($$$ARGS)
    - pattern: const { $$$PROPS } = useNewStore($$$ARGS) # Add new store
```
