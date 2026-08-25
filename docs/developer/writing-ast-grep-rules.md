# Writing ast-grep Rules

Reference for creating custom ast-grep rules. Intended for AI agents but readable by humans.

## When to Add Rules

Add ast-grep rules when:

- You identify a repeated architectural violation
- ESLint can't express the rule (pattern-based matching needed)
- The pattern has caused bugs or performance issues

## Rule Structure

```yaml
id: rule-name
message: |
  Brief description with examples.

  BAD: example
  GOOD: example
severity: error # or warning
language: Tsx # or TypeScript
files: # Optional: restrict to paths
  - 'src/lib/**/*.ts'
rule:
  pattern: $PATTERN
note: |
  Additional context for developers.
```

## Pattern Syntax

| Syntax    | Meaning            | Example                    |
| --------- | ------------------ | -------------------------- |
| `$VAR`    | Single AST node    | `const $NAME = useStore()` |
| `$$$ARGS` | Zero or more nodes | `function($$$ARGS)`        |
| `$$`      | Anonymous wildcard | `{ $$, field: $VALUE }`    |

## Testing Patterns

Test a pattern against the codebase:

```bash
npx ast-grep run --pattern 'const { $$$PROPS } = useUIStore($$$ARGS)' src/
```

Test a rule file:

```bash
npx ast-grep scan -r .ast-grep/rules/zustand/no-destructure.yml
```

## Example: No Zustand Destructuring

**File:** `.ast-grep/rules/zustand/no-destructure.yml` (canonical — keep this doc in sync with it)

```yaml
id: no-destructure-zustand
message: |
  Never destructure from Zustand stores. Use selector syntax instead.

  BAD: const { leftSidebarVisible } = useUIStore()
  GOOD: const leftSidebarVisible = useUIStore(state => state.leftSidebarVisible)

  For multiple values, use multiple selectors or useShallow.
severity: error
language: Tsx
rule:
  any:
    - pattern: const { $$$PROPS } = useUIStore($$$ARGS)
    - pattern: const { $$$PROPS } = useKeyboardStore($$$ARGS)
    - pattern: const { $$$PROPS } = useSettingsStore($$$ARGS)
note: |
  Destructuring causes render cascades - every store update triggers re-renders
  even if destructured values haven't changed.

  See: docs/developer/architecture-guide.md (Performance Patterns)
```

The rule matches by store hook name, so every store must be listed.

## Adding New Stores to Existing Rules

When you add a new Zustand store, extend the `any` list in
`.ast-grep/rules/zustand/no-destructure.yml` with its hook name:

```yaml
rule:
  any:
    # ... existing store patterns ...
    - pattern: const { $$$PROPS } = useNewStore($$$ARGS) # Add new store
```

## Common Patterns

### Catching hook calls outside hooks directory

```yaml
id: hooks-in-hooks-dir
language: TypeScript
files:
  - 'src/lib/**/*.ts'
rule:
  pattern: export function use$NAME($$$ARGS)
```

### Catching store subscriptions in lib/

```yaml
id: no-store-in-lib
language: TypeScript
files:
  - 'src/lib/**/*.ts'
rule:
  pattern: const $VAR = $STORE(state => $$$SELECTOR)
```

## Debugging

**Rules not matching:**

1. Check `language` matches file type (`Tsx` for `.tsx`, `TypeScript` for `.ts`)
2. Test pattern directly with `npx ast-grep run`
3. Verify `files` globs if using path restrictions

**False positives:**

- Add exceptions using `ignores` in rules
- Update `sgconfig.yml` to exclude paths

## Resources

- [Pattern Syntax](https://ast-grep.github.io/guide/pattern-syntax.html)
- [Rule Configuration](https://ast-grep.github.io/reference/yaml.html)
- [Rule Catalog](https://ast-grep.github.io/catalog/)
