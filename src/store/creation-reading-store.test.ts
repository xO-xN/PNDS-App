import { expect, it } from 'vitest'
import { useCreationReadingStore } from './creation-reading-store'
import type { GitComparison } from '@/lib/tauri-bindings'

it('keeps comparison selection while navigating and resets historical paths on workspace changes', () => {
  const store = useCreationReadingStore
  store.getState().syncWorkspace('one')
  const comparison: GitComparison = {
    token: 'one',
    before: { commit: 'a', message: 'Before', saved: false },
    after: { commit: 'b', message: 'After', saved: false },
    files: [
      { path: 'README.md', status: 'unchanged' },
      { path: 'removed.js', status: 'deleted' },
    ],
  }
  store.getState().setGitComparison(comparison)
  expect(store.getState().gitPath).toBe('removed.js')
  store.getState().selectGitPath('../outside.js')
  expect(store.getState().gitPath).toBe('removed.js')
  store.getState().showFile()
  store.getState().showGit()
  expect(store.getState().gitComparison).toBe(comparison)
  store.getState().syncWorkspace('two')
  expect(store.getState().gitComparison).toBeNull()
  expect(store.getState().gitPath).toBeNull()
  expect(store.getState().gitComparisonPhase).toBe('idle')
})
