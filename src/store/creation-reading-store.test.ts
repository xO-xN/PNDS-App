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
  store.getState().selectGitPath('README.md')
  expect(store.getState().gitPath).toBe('removed.js')
  store.getState().showFile()
  store.getState().showGit()
  expect(store.getState().gitComparison).toBe(comparison)
  store.getState().syncWorkspace('two')
  expect(store.getState().gitComparison).toBeNull()
  expect(store.getState().gitPath).toBeNull()
  expect(store.getState().gitComparisonPhase).toBe('idle')
})

it('selects only changed paths when a new comparison replaces the current scope', () => {
  const store = useCreationReadingStore
  store.getState().syncWorkspace('changed-only')
  const comparison: GitComparison = {
    token: 'changed',
    before: { commit: 'a', message: 'Before', saved: false },
    after: { commit: 'b', message: 'After', saved: false },
    files: [
      { path: 'first.js', status: 'modified' },
      { path: 'second.js', status: 'modified' },
    ],
  }
  store.getState().setGitComparison(comparison)
  store.getState().selectGitPath('second.js')
  store.getState().setGitComparison(null)
  expect(store.getState().gitPath).toBe('second.js')
  store.getState().setGitComparison({
    ...comparison,
    token: 'replacement',
    files: [
      { path: 'second.js', status: 'unchanged' },
      { path: 'first.js', status: 'deleted' },
    ],
  })
  expect(store.getState().gitPath).toBe('first.js')
  store.getState().setGitComparison({
    ...comparison,
    token: 'identical',
    files: [{ path: 'first.js', status: 'unchanged' }],
  })
  expect(store.getState().gitPath).toBeNull()
})

it('shares comparison choices through navigation and resets them with workspace ownership', () => {
  const store = useCreationReadingStore
  store.getState().syncWorkspace('mode-owner')
  store.getState().setGitComparisonMode('saved')
  store.getState().setGitComparisonWorking(true)
  store.getState().showFile()
  store.getState().showGit()
  store.getState().syncWorkspace('mode-owner')
  expect(store.getState().gitComparisonMode).toBe('saved')
  expect(store.getState().gitComparisonWorking).toBe(true)
  store.getState().syncWorkspace('new-owner')
  expect(store.getState().gitComparisonMode).toBe('parent')
  expect(store.getState().gitComparisonWorking).toBe(false)
})
