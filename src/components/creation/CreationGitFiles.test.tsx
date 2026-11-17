import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { commands, type GitComparison } from '@/lib/tauri-bindings'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { CreationGitFiles } from './CreationGitFiles'

const comparison: GitComparison = {
  token: 'files',
  before: { commit: 'a', message: 'Before', saved: false },
  after: { commit: 'b', message: 'After', saved: false },
  files: [
    { path: 'public/sketch.js', status: 'modified' },
    { path: 'removed.js', status: 'deleted' },
    { path: 'README.md', status: 'unchanged' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationReadingStore.setState({
    gitComparison: null,
    gitComparisonPhase: 'idle',
    gitPath: null,
    gitComparisonMode: 'parent',
    gitComparisonWorking: false,
  })
  useCreationReadingStore.getState().setGitComparison(comparison)
})

it('shows only changed files and filters their real paths without opening an editor', () => {
  render(<CreationGitFiles disabled={false} />)
  expect(screen.getByRole('button', { name: 'public/sketch.js' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'README.md' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(i18n.t('creation.comparison.sidebarHint'))
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', {
      name: i18n.t('creation.comparison.all', { count: 3 }),
    })
  ).not.toBeInTheDocument()
  fireEvent.change(
    screen.getByRole('searchbox', {
      name: i18n.t('creation.comparison.search'),
    }),
    { target: { value: 'removed' } }
  )
  expect(
    screen.queryByRole('button', { name: 'public/sketch.js' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'removed.js' }))
  expect(useCreationReadingStore.getState().gitPath).toBe('removed.js')
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('shares the comparison choice without dispatching a checkout and hides it for working changes', () => {
  const { rerender } = render(<CreationGitFiles disabled={false} />)
  fireEvent.click(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.withLocal'),
    })
  )
  expect(useCreationReadingStore.getState().gitComparisonMode).toBe('saved')
  expect(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.withLocal'),
    })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  useCreationReadingStore.setState({ gitComparisonWorking: true })
  rerender(<CreationGitFiles disabled={false} />)
  expect(
    screen.queryByRole('group', { name: i18n.t('creation.comparison.compare') })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('searchbox')).toBeVisible()
})

it('keeps unchanged files out of an identical comparison and gates choices while busy', () => {
  useCreationReadingStore.getState().setGitComparison({
    ...comparison,
    files: [{ path: 'README.md', status: 'unchanged' }],
  })
  render(<CreationGitFiles disabled />)
  expect(screen.getByText(i18n.t('creation.comparison.noFiles'))).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'README.md' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.withLocal'),
    })
  ).toBeDisabled()
  expect(useCreationReadingStore.getState().gitPath).toBeNull()
})
