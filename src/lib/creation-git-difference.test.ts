import { expect, it } from 'vitest'
import type { GitComparisonLine } from './tauri-bindings'
import { splitGitLines } from './creation-git-difference'

const line = (
  kind: GitComparisonLine['kind'],
  content: string
): GitComparisonLine => ({
  kind,
  content,
  oldLine: kind === 'addition' ? null : 1,
  newLine: kind === 'deletion' ? null : 2,
  noNewline: false,
})
it('pairs replacements without shifting context or losing unpaired additions and deletions', () => {
  const old = line('deletion', 'old'),
    removed = line('deletion', ''),
    added = line('addition', 'new'),
    context = line('context', 'keep'),
    trailing = { ...line('addition', ''), noNewline: true }
  expect(splitGitLines([old, removed, added, context, trailing])).toEqual([
    { before: old, after: added },
    { before: removed, after: null },
    { before: context, after: context },
    { before: null, after: trailing },
  ])
})
it('keeps deletion-only files and empty inputs intact', () => {
  const deleted = line('deletion', 'delete')
  expect(splitGitLines([deleted])).toEqual([{ before: deleted, after: null }])
  expect(splitGitLines([])).toEqual([])
})
