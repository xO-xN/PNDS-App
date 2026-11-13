import { isValidElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { act, cleanup, fireEvent, render, screen } from '@/test/test-utils'
import { seedCreationDraft } from '@/test/creation-files'
import i18n from '@/i18n/config'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { AppToaster } from '@/components/shell/AppToaster'
import { CreationCompileNotice } from './CreationCompileNotice'

const source = {
  path: 'supercollider/source/voice.scd',
  kind: 'text' as const,
  category: 'audio' as const,
  size: 20,
}
const workspace: CreationWorkspace = {
  project: {
    identity: 'compile-notice',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [source],
}
const report = {
  sclangPath: '/Applications/SuperCollider.app/Contents/MacOS/sclang',
  produced: ['demo.scsyndef'],
  references: [],
  output: 'wrote demo.scsyndef',
  error: null,
}
function markPending() {
  useCreationFilesStore.getState().changed([source.path])
}
function firstAction() {
  const action = vi.mocked(toast.info).mock.calls[0]?.[1]?.action
  if (!isValidElement(action)) throw new Error('Expected a live Compile action')
  return action
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  useCreationStore.setState({ workspace: null })
  useCreationFilesStore.getState().clear()
  useCreationCompileStore.setState({
    busy: false,
    report: null,
    error: null,
    pendingNoticeShown: false,
  })
  useCreationStore.setState({ active: true, workspace })
  useCreationReadingStore.getState().syncWorkspace(workspace.project.identity)
  useCreationTestStore.setState({ tab: 'file' })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    commandPending: false,
  })
  vi.mocked(commands.pollCreationChanges).mockResolvedValue({
    status: 'ok',
    data: { files: [source], changed: [], revision: 0 },
  })
  vi.mocked(commands.compileCreationSynthdefs)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: report })
  vi.spyOn(toast, 'info')
  vi.spyOn(toast, 'dismiss')
})

afterEach(() => {
  cleanup()
  toast.dismiss()
  vi.restoreAllMocks()
})

it('announces the first saved-source pending cycle for eight seconds with the existing Compile action', () => {
  render(<CreationCompileNotice />)
  expect(toast.info).not.toHaveBeenCalled()
  act(markPending)
  expect(toast.info).toHaveBeenCalledTimes(1)
  expect(toast.info).toHaveBeenCalledWith(
    i18n.t('creation.pendingCompile'),
    expect.objectContaining({
      id: 'creation-compile-pending:compile-notice',
      duration: 8000,
    })
  )
  render(firstAction())
  expect(screen.getByRole('button', { name: 'Compile' })).toBeEnabled()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
})

it('lets an active compilation own feedback when a source change is first observed during it', () => {
  useCreationCompileStore.setState({ busy: true })
  render(<CreationCompileNotice />)
  act(markPending)
  expect(toast.info).not.toHaveBeenCalled()
  act(() => useCreationCompileStore.setState({ busy: false }))
  expect(toast.info).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().pending.compile).toBeGreaterThan(0)
})

it('does not repeat for further saves, watcher observations, Discussion/Git navigation or remounting', () => {
  const view = render(<CreationCompileNotice />)
  act(markPending)
  act(() => {
    markPending()
    useCreationFilesStore.setState(state => ({
      diskRevision: state.diskRevision + 1,
    }))
    useCreationReadingStore.getState().showGit()
  })
  view.rerender(<CreationCompileNotice />)
  act(() => useCreationReadingStore.getState().showDiscussion())
  view.rerender(<CreationCompileNotice />)
  expect(toast.info).toHaveBeenCalledTimes(1)
  vi.mocked(toast.dismiss).mockClear()
  view.unmount()
  render(<CreationCompileNotice />)
  expect(toast.info).toHaveBeenCalledTimes(1)
  expect(toast.dismiss).not.toHaveBeenCalledWith(
    'creation-compile-pending:compile-notice'
  )
  expect(useCreationFilesStore.getState().pending.compile).toBeGreaterThan(0)
})

it('announces a later cycle only after the previous compile obligation has cleared', () => {
  render(<CreationCompileNotice />)
  act(markPending)
  act(() =>
    useCreationFilesStore.getState().complete(
      {
        identity: workspace.project.identity,
        revision: useCreationFilesStore.getState().revision,
      },
      'compile'
    )
  )
  expect(useCreationFilesStore.getState().pending.compile).toBe(0)
  expect(toast.dismiss).toHaveBeenCalledWith(
    'creation-compile-pending:compile-notice'
  )
  act(markPending)
  expect(toast.info).toHaveBeenCalledTimes(2)
})

it('announces a new pending cycle when completion and a fresh saved edit share a render', () => {
  render(<CreationCompileNotice />)
  act(markPending)
  act(() => {
    useCreationFilesStore.getState().complete(
      {
        identity: workspace.project.identity,
        revision: useCreationFilesStore.getState().revision,
      },
      'compile'
    )
    markPending()
  })
  expect(toast.info).toHaveBeenCalledTimes(2)
  expect(useCreationFilesStore.getState().pending.compile).toBeGreaterThan(0)
})

it('dismisses the old owner notification and prevents its stale action from compiling a replacement project', async () => {
  render(<CreationCompileNotice />)
  act(markPending)
  render(firstAction())
  const oldAction = screen.getByRole('button', { name: 'Compile' })
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: {
          ...workspace.project,
          identity: 'replacement',
          root: '/replacement',
        },
      },
    })
  )
  expect(toast.dismiss).toHaveBeenCalledWith(
    'creation-compile-pending:compile-notice'
  )
  await act(async () => fireEvent.click(oldAction))
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
})

it('keeps the real toast action disabled for dirty drafts and runtime submissions, then invokes the existing compile flow', async () => {
  vi.useFakeTimers()
  try {
    seedCreationDraft(source.path, '// saved source', 'v1')
    useCreationFilesStore.getState().edit(source.path, '// unsaved source')
    let finish!: (
      value: Awaited<ReturnType<typeof commands.compileCreationSynthdefs>>
    ) => void
    vi.mocked(commands.compileCreationSynthdefs).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    render(
      <>
        <AppToaster />
        <CreationCompileNotice />
      </>
    )
    act(markPending)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    const compile = screen.getByRole('button', { name: 'Compile' })
    expect(compile).toBeDisabled()
    expect(compile).toHaveAccessibleDescription(
      i18n.t('creation.compile.unsaved', { paths: source.path })
    )
    fireEvent.click(compile)
    expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
    act(() =>
      useCreationFilesStore.getState().edit(source.path, '// saved source')
    )
    expect(compile).toBeEnabled()
    act(() => useSessionStore.setState({ commandPending: true }))
    expect(compile).toBeDisabled()
    expect(compile).toHaveAccessibleDescription(
      i18n.t('creation.compile.runtimeBusy')
    )
    act(() => useSessionStore.setState({ commandPending: false }))
    expect(compile).toBeEnabled()
    expect(toast.info).toHaveBeenCalledTimes(1)

    await act(async () => fireEvent.click(compile))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(commands.compileCreationSynthdefs).toHaveBeenCalledWith(
      workspace.project.identity
    )
    const pending = screen
      .getByText(i18n.t('creation.compile.busy'), { selector: '[data-title]' })
      .closest('[data-sonner-toast]')
    expect(pending).toHaveAttribute('data-type', 'loading')
    expect(pending?.querySelector('[data-action]')).not.toBeInTheDocument()
    expect(
      pending?.querySelector('[data-close-button]')
    ).not.toBeInTheDocument()
    await act(async () => finish({ status: 'ok', data: report }))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    const result = screen
      .getByText(i18n.t('creation.compile.succeeded'))
      .closest('[data-sonner-toast]')
    expect(result).toBe(pending)
    expect(result).toHaveAttribute('data-type', 'success')
    expect(useCreationFilesStore.getState().pending.compile).toBe(0)
    expect(useCreationFilesStore.getState().pending.restart).toBeGreaterThan(0)
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
    expect(commands.startCreationProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  } finally {
    // Sonner schedules removal after the exit animation. Dispose of those
    // callbacks while this test still owns the timer queue.
    cleanup()
    vi.useRealTimers()
  }
})
