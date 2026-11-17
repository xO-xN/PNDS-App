import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@/test/test-utils'
import i18n from '@/i18n/config'
import type { CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationConsoleFromStores } from '@/test/creation-console'

const source = {
  path: 'supercollider/source/voice.scd',
  kind: 'text' as const,
  category: 'audio' as const,
  size: 20,
}
const workspace: CreationWorkspace = {
  project: {
    identity: 'pending-console',
    name: 'Score',
    root: '/score',
    source: 'folder',
  },
  files: [source],
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({ active: true, workspace })
  useCreationFilesStore.getState().clear()
  useCreationFilesStore.setState({
    pending: { compile: 1, refresh: 0, restart: 0 },
  })
  useCreationCompileStore.setState({ busy: false, error: null, report: null })
  useCreationTestStore.setState({
    log: [],
    error: null,
    runtimeError: null,
  })
  useSessionStore.setState({
    sessionStatus: 'idle',
    sessionProjectPath: null,
    commandPending: false,
  })
  vi.spyOn(useCreationCompileStore.getState(), 'run').mockResolvedValue(
    undefined
  )
})
afterEach(() => vi.restoreAllMocks())

it('shows a pending compilation before any report exists and compiles through the existing store action', () => {
  render(<CreationConsoleFromStores />)
  const compilation = screen.getByRole('region', {
    name: i18n.t('creation.compile.console'),
  })
  expect(
    within(compilation).getByText(i18n.t('creation.pendingCompile'))
  ).toBeVisible()
  const button = within(compilation).getByRole('button', {
    name: i18n.t('creation.compile.consoleAction'),
  })
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(useCreationCompileStore.getState().run).toHaveBeenCalledOnce()
})

it('keeps pending refresh and restart explanations in the console with the details initially open', () => {
  useCreationFilesStore.setState({
    pending: { compile: 1, refresh: 2, restart: 3 },
  })
  render(<CreationConsoleFromStores />)
  const summary = screen.getByText(i18n.t('creation.console.pendingChanges'))
  expect(summary.closest('details')).toHaveAttribute('open')
  expect(screen.getByText(i18n.t('creation.pendingRefresh'))).toBeVisible()
  expect(screen.getByText(i18n.t('creation.pendingRestart'))).toBeVisible()
  expect(screen.getByText(i18n.t('creation.runningDiskHint'))).toBeVisible()
  fireEvent.click(summary)
  expect(summary.closest('details')).not.toHaveAttribute('open')
})

it.each(['source', 'manifest', 'saving', 'renaming'] as const)(
  'disables compilation with its real reason for %s drafts',
  state => {
    const path = state === 'manifest' ? 'manifest.json' : source.path
    seedCreationDraft(path, '// saved', 'v1')
    if (state === 'source' || state === 'manifest')
      useCreationFilesStore.getState().edit(path, '// unsaved')
    else {
      const draft = useCreationFilesStore.getState().drafts[path]
      if (!draft) throw new Error('Expected the seeded draft')
      useCreationFilesStore.setState(current => ({
        drafts: {
          ...current.drafts,
          [path]: { ...draft, [state]: true },
        },
      }))
    }
    render(<CreationConsoleFromStores />)
    const button = screen.getByRole('button', {
      name: i18n.t('creation.compile.consoleAction'),
    })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      i18n.t('creation.compile.unsaved', { paths: path })
    )
    fireEvent.click(button)
    expect(useCreationCompileStore.getState().run).not.toHaveBeenCalled()
  }
)

it.each(['starting', 'stopping', 'pending'] as const)(
  'disables compilation during a %s runtime command and updates when the guard clears',
  state => {
    useSessionStore.setState(
      state === 'pending' ? { commandPending: true } : { sessionStatus: state }
    )
    render(<CreationConsoleFromStores />)
    const button = screen.getByRole('button', {
      name: i18n.t('creation.compile.consoleAction'),
    })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(
      i18n.t('creation.compile.runtimeBusy')
    )
    act(() =>
      useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
    )
    expect(button).toBeEnabled()
  }
)

it('disables duplicate compilation while the compiler is busy', () => {
  useCreationCompileStore.setState({ busy: true })
  render(<CreationConsoleFromStores />)
  const button = screen.getByRole('button', {
    name: i18n.t('creation.compile.busy'),
  })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(useCreationCompileStore.getState().run).not.toHaveBeenCalled()
})

it('does not offer a compiler action for a protected project', () => {
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, source: 'bundle' },
    },
  })
  render(<CreationConsoleFromStores />)
  expect(screen.getByText(i18n.t('creation.pendingCompile'))).toBeVisible()
  expect(
    screen.queryByRole('button', {
      name: i18n.t('creation.compile.consoleAction'),
    })
  ).not.toBeInTheDocument()
})

it('explains why compilation is unavailable when no standard source file exists', () => {
  useCreationStore.setState({ workspace: { ...workspace, files: [] } })
  render(<CreationConsoleFromStores />)
  const button = screen.getByRole('button', {
    name: i18n.t('creation.compile.consoleAction'),
  })
  expect(button).toBeDisabled()
  expect(button).toHaveAccessibleDescription(
    i18n.t('creation.compile.sourceMissing')
  )
})

it('retains the report and restart explanation when compilation is no longer pending', () => {
  useCreationFilesStore.setState({
    pending: { compile: 0, refresh: 0, restart: 2 },
  })
  useCreationCompileStore.setState({
    report: {
      sclangPath: '/sclang',
      produced: ['voice.scsyndef'],
      references: [],
      output: 'Compiler output',
      error: null,
    },
  })
  render(<CreationConsoleFromStores />)
  expect(screen.getByText('Compiler output')).toBeVisible()
  expect(screen.getByText(i18n.t('creation.compile.restart'))).toBeVisible()
  expect(screen.getByText(i18n.t('creation.pendingRestart'))).toBeVisible()
  expect(
    screen.queryByText(i18n.t('creation.pendingCompile'))
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: i18n.t('creation.copyTestDetails') })
  ).toBeEnabled()
})
