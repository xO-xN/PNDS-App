# AI Agent Instructions

## Overview

PNDS App 是在演出现场运行 PNDS 数字乐谱工程的 macOS（Apple Silicon）桌面 Host 应用，基于 Tauri v2 + React + TypeScript。平台与工程的介绍见 `README.md`。

**当前工程格式、运行契约与 App 验收标准分别以 `docs/PNDS_SCORE_PROJECT_SPECIFICATION.md`、`docs/PNDS_RUNTIME_CONTRACT.md` 和 `docs/PNDS_APP_REQUIREMENTS.md` 为准**——开始任何功能开发前必须先读与任务相关的规范。参考 score project 是父目录中的 `Inarticulate III`。

## Core Rules

### New Sessions

- Read @docs/tasks.md for task management
- Read `docs/PNDS_SCORE_PROJECT_SPECIFICATION.md` for the score-project directory and manifest contract
- Read `docs/PNDS_RUNTIME_CONTRACT.md` for process, health, audio-bus, and shutdown behavior
- Read `docs/PNDS_APP_REQUIREMENTS.md` for App product scope and Definition of Done
- Review `docs/developer/architecture-guide.md` for high-level patterns
- Check `docs/developer/README.md` for the full documentation index
- Check git status and project structure

### Development Practices

**CRITICAL:** Follow these strictly:

0. **Use npm only**: This project uses `npm`, NOT `pnpm`. Always use `npm install`, `npm run`, etc.
1. **Follow Established Patterns**: Use patterns from this file and `docs/developer`
2. **Test Coverage**: Write comprehensive tests for business logic
3. **Quality Gates**: Run `npm run check:all` after significant changes
4. **No Dev Server**: Ask user to run and report back
5. **No Unsolicited Commits**: Only when explicitly requested
6. **Documentation**: Update relevant `docs/developer/` files for new patterns
7. **Removing files**: Always use `rm -f`

**CRITICAL:** Use Tauri v2 docs only. Always use modern Rust formatting: `format!("{variable}")`

## Architecture Patterns (CRITICAL)

### State Management Onion

```
useState (component) → Zustand (global UI)
```

**Decision**: Is data needed across components? → Zustand. Persisted data (preferences, project index) goes through `src/lib/preferences.ts` (serialized update queue); `project-store` structural actions persist as part of their commit — callers never pair mutations with saves. The TanStack Query layer was removed in v1.2.0 (scaffolded, never adopted).

### Performance Pattern (CRITICAL)

```typescript
// ✅ GOOD: Selector syntax - only re-renders when specific value changes
const leftSidebarVisible = useUIStore(state => state.leftSidebarVisible)

// ❌ BAD: Destructuring causes render cascades (caught by ast-grep)
const { leftSidebarVisible } = useUIStore()

// ✅ GOOD: Use getState() in callbacks for current state
const handleAction = () => {
  const { data, setData } = useStore.getState()
  setData(newData)
}
```

### Static Analysis

- **React Compiler**: Handles memoization automatically - no manual `useMemo`/`useCallback` needed
- **ast-grep**: Enforces architecture patterns (e.g., no Zustand destructuring). See `docs/developer/static-analysis.md`
- **Knip/jscpd**: Periodic cleanup tools. Use `/cleanup` command (Claude Code)

### Event-Driven Bridge

- **Rust → React**: `app.emit("event-name", data)` → `listen("event-name", handler)`
- **React → Rust**: Use typed commands from `@/lib/tauri-bindings` (tauri-specta)
- **Commands**: All actions flow through centralized command system

### Tauri Command Pattern (tauri-specta)

```typescript
// ✅ GOOD: Type-safe commands with Result handling
import { commands } from '@/lib/tauri-bindings'

const result = await commands.loadPreferences()
if (result.status === 'ok') {
  console.log(result.data.theme)
}

// ❌ BAD: String-based invoke (no type safety)
const prefs = await invoke('load_preferences')
```

**Adding commands**: See `docs/developer/tauri-commands.md`

### Internationalization (i18n)

```typescript
// ✅ GOOD: Use useTranslation hook in React components
import { useTranslation } from 'react-i18next'

function MyComponent() {
  const { t } = useTranslation()
  return <h1>{t('myFeature.title')}</h1>
}

// ✅ GOOD: Non-React contexts - bind for many calls, or use directly
import i18n from '@/i18n/config'
const t = i18n.t.bind(i18n)  // Bind once for many translations
i18n.t('key')                 // Or call directly for occasional use
```

- **Translations**: All strings in `/locales/*.json`
- **RTL Support**: Use CSS logical properties (`text-start` not `text-left`)
- **Adding strings**: See `docs/developer/i18n-patterns.md`

### Documentation & Versions

- **Context7 First**: Always use Context7 for framework docs before WebSearch

## Developer Documentation

For complete patterns and detailed guidance, see `docs/developer/README.md`.

Key documents:

- `architecture-guide.md` - Mental models, security, anti-patterns
- `state-management.md` - State onion, getState() pattern details
- `tauri-commands.md` - Adding new Rust commands
- `static-analysis.md` - All linting tools and quality gates
