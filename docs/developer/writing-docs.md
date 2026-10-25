# Writing Developer Documentation

Guide for creating and maintaining docs in this directory.

## Purpose

These docs are primarily for AI coding agents, secondarily for humans. They should:

- Explain patterns that aren't obvious from reading the code
- Guide AI agents away from common mistakes (old patterns, anti-patterns)
- Be "evergreen" - updated as the app evolves

They should **not** teach libraries (AI knows Zustand, React, etc.) or duplicate code.

## When to Write a New Doc

| Situation                           | Action                            |
| ----------------------------------- | --------------------------------- |
| New architectural pattern or system | Create new doc                    |
| Enhancement to existing system      | Update existing doc               |
| One-off implementation detail       | Don't document - it's in the code |

New docs should be added to `README.md` in this directory.

## Content Guidelines

### Include

- The "why" behind non-obvious decisions
- "How to add X" sections for patterns not obvious from code
- Common mistakes (especially from outdated AI training data)
- Cross-links to related docs: `See [state-management.md](./state-management.md)`

### Exclude

- Implementation details that don't affect usage
- Library tutorials
- Checklists (AI generates these compulsively - resist)
- "Future Enhancements" or speculative sections
- Large code blocks duplicating the codebase

## Code Examples

Keep examples minimal. Use ✅/❌ format:

```typescript
// ❌ BAD: Subscribes to entire store
const { settingsOpen } = useSettingsStore()

// ✅ GOOD: Selector for specific value
const settingsOpen = useSettingsStore(state => state.settingsOpen)
```

Reference actual files when helpful: "See `src/lib/menu.ts` for the full implementation."

## Formatting

| Element        | Use For                              |
| -------------- | ------------------------------------ |
| Tables         | Comparing options, quick reference   |
| ✅/❌ examples | Correct vs incorrect patterns        |
| `inline code`  | File paths, commands, function names |
| Headings       | Scannable structure                  |

Keep prose brief. Get to the point.

## Token Efficiency

Not the primary goal, but good practice:

- Tables over prose for comparisons
- Don't explain what AI already knows
- Link to other docs instead of repeating content
- Never sacrifice clarity for brevity

## Maintaining Docs

Update docs when you change the pattern they describe. If you're unsure whether a doc needs updating after code changes, read it - you'll know.

## Authority and updates

Each normative fact has one owning section. App operations belong in the bilingual App tutorial; the creator guide connects milestones; reference pages define Host/project contracts; module pages explain project-owned integration. Developer topics own implementation constraints. Link to an owner rather than copying its rules.

Update current rules in place. Put superseded design and verification evidence in plans, ADRs or acceptance records with explicit status. An issue number or later appendix does not override contradictory earlier prose. Keep definitions, conditions and recovery together under a task-sized heading. Preserve shipped paths, document IDs and existing heading anchors when editing the help corpus.

For a changed feature, check the accessible production entry, native behavior and tests before updating both language trees. A retained component or isolated test is not proof of an accessible action. Review semantic parity (defaults, limits, failures and permissions), not only matching filenames. Long repeated prose is a review signal; contract examples and necessary short prerequisites may remain.
