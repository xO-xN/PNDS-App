import { beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { commands, type GitVersionGraph } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useAssistantStore } from '@/store/assistant-store'
import { useSessionStore } from '@/store/session-store'
import i18n from '@/i18n/config'
import { CreationGitFiles } from './CreationGitFiles'
import { CreationGitPage } from './CreationGitPage'
import * as gitWorkflow from '@/lib/creation-git-workflow'
import { toast } from 'sonner'
const graph: GitVersionGraph = {
  head: 'b',
  branches: [{ name: 'main', tip: 'b' }],
  versions: [
    {
      id: 'b',
      message: 'Larger numbers',
      timestamp: 2,
      parents: ['a'],
      files: ['server.js'],
    },
    {
      id: 'a',
      message: 'Starting point',
      timestamp: 1,
      parents: [],
      files: ['server.js'],
    },
  ],
  nextOffset: null,
  limited: false,
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'page',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationReadingStore.setState({
    view: 'git',
    gitIntent: 'history',
    gitIntentRevision: 0,
    gitComparison: null,
    gitPath: null,
  })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useAssistantStore.setState({
    phase: 'idle',
    paused: false,
    canContinue: false,
    resumeRestored: false,
  })
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      head: 'b',
      branch: 'main',
      changes: [],
      detail: null,
    },
  })
  vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
    status: 'ok',
    data: graph,
  })
  vi.mocked(commands.getCreationGitVersionPaths).mockResolvedValue({
    status: 'ok',
    data: ['server.js'],
  })
  vi.mocked(commands.getCreationGitComparison).mockImplementation(
    async (_identity, request) => ({
      status: 'ok',
      data: {
        token: `comparison:${request.commit ?? 'working'}:${request.mode}`,
        before: {
          commit: request.mode === 'parent' ? 'a' : request.commit,
          message: 'Before version',
          saved: false,
        },
        after: {
          commit: request.mode === 'parent' ? request.commit : null,
          message: 'After version',
          saved: request.mode === 'saved',
        },
        files: [
          { path: 'server.js', status: 'modified' },
          { path: 'removed.js', status: 'deleted' },
          { path: 'README.zh-CN.md', status: 'unchanged' },
        ],
      },
    })
  )
  vi.mocked(commands.readCreationGitComparisonFile).mockImplementation(
    async (_identity, request) => ({
      status: 'ok',
      data: {
        token: request.token,
        path: request.path,
        hunks: [],
        added: 0,
        deleted: 0,
        reason: null,
      },
    })
  )
  vi.mocked(commands.getCreationGitTaskPending).mockResolvedValue({
    status: 'ok',
    data: false,
  })
  vi.mocked(commands.previewCreationGitSwitch).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'switch',
      commit: 'a',
      paths: ['server.js'],
      discardedPaths: [],
    },
  })
  vi.mocked(commands.confirmCreationGitSwitch).mockResolvedValue({
    status: 'ok',
    data: null,
  })
})
const pickStartingPoint = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Starting point/ }))
}
it.each(['saved', 'draft'])(
  'offers explicit restoration of the current version with %s changes',
  async kind => {
    if (kind === 'saved')
      vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
        status: 'ok',
        data: {
          state: 'available',
          head: 'b',
          branch: 'main',
          detail: null,
          changes: [
            {
              path: 'server.js',
              staged: false,
              unstaged: true,
              untracked: false,
              indexStatus: ' ',
              diskStatus: 'M',
            },
          ],
        },
      })
    else
      useCreationFilesStore.setState({
        drafts: {
          'server.js': {
            text: 'edited',
            diskText: 'saved',
            diskVersion: 'v1',
            conflict: null,
            saving: false,
            renaming: false,
            diskChanged: false,
            error: null,
          },
        },
      })
    render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
    fireEvent.click(
      await screen.findByRole('button', { name: /Larger numbers/ })
    )
    const action = screen.getByRole('button', {
      name: /Already at this version|Restore this version/,
    })
    expect(action).toBeEnabled()
    fireEvent.click(action)
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('button', {
        name: i18n.t('creation.versions.saveRestore'),
      })
    ).toBeVisible()
    expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
    expect(
      within(dialog).getByRole('button', { name: i18n.t('creation.cancel') })
    ).toBeVisible()
    expect(
      within(dialog).queryByText(i18n.t('creation.versions.otherOptions'))
    ).not.toBeInTheDocument()
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: i18n.t('creation.versions.discardRestoreOption'),
      })
    )
    expect(
      within(dialog).getByRole('button', {
        name: i18n.t('creation.versions.discardRestore'),
      })
    ).toBeVisible()
    expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
    const sync = vi
      .spyOn(useCreationFilesStore.getState(), 'synchronizeSaved')
      .mockResolvedValue(true)
    try {
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: i18n.t('creation.versions.discardRestore'),
        })
      )
      await screen.findByText(i18n.t('creation.versions.restored'))
      expect(commands.previewCreationGitSwitch).toHaveBeenCalledWith(
        'page',
        'b',
        true
      )
      expect(commands.confirmCreationGitSwitch).toHaveBeenCalledWith(
        'page',
        'switch'
      )
      expect(commands.previewCreationGitRecord).not.toHaveBeenCalled()
      expect(
        useCreationFilesStore.getState().drafts['server.js']
      ).toBeUndefined()
    } finally {
      sync.mockRestore()
    }
  }
)

it('keeps the current-version action disabled when saved files and drafts are unchanged', async () => {
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: /Larger numbers/ }))
  expect(
    screen.getByRole('button', {
      name: i18n.t('creation.versions.alreadyCurrent'),
    })
  ).toBeDisabled()
})

it('selects a historical version for inspection without changing any files or runtime', async () => {
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  expect(screen.getByRole('heading', { name: 'Starting point' })).toBeVisible()
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})
it('preserves selected comparison, names and graph height when the middle page is hidden and shown', async () => {
  const onBusyChange = vi.fn()
  const { rerender } = render(
    <CreationGitPage identity="page" active onBusyChange={onBusyChange} />
  )
  await pickStartingPoint()
  fireEvent.change(
    screen.getByRole('textbox', { name: i18n.t('creation.versions.name') }),
    { target: { value: 'Keep this name' } }
  )
  const divider = screen.getByRole('separator', {
    name: i18n.t('creation.versions.resizeGraph'),
  })
  fireEvent.keyDown(divider, { key: 'ArrowDown' })
  const graphHeight = divider.getAttribute('aria-valuenow')
  await waitFor(() =>
    expect(useCreationReadingStore.getState().gitComparison?.token).toContain(
      'comparison:a'
    )
  )
  await waitFor(() =>
    expect(commands.readCreationGitComparisonFile).toHaveBeenCalledWith(
      'page',
      { token: 'comparison:a:parent', path: 'server.js', fullContext: false }
    )
  )
  const reads = vi.mocked(commands.readCreationGitComparisonFile).mock.calls
    .length
  rerender(
    <CreationGitPage
      identity="page"
      active={false}
      onBusyChange={onBusyChange}
    />
  )
  rerender(
    <CreationGitPage identity="page" active onBusyChange={onBusyChange} />
  )
  expect(
    screen.getByRole('heading', { name: 'Starting point' })
  ).toBeInTheDocument()
  expect(screen.getByDisplayValue('Keep this name')).toBeInTheDocument()
  expect(
    screen.getByRole('separator', {
      name: i18n.t('creation.versions.resizeGraph'),
    })
  ).toHaveAttribute('aria-valuenow', graphHeight)
  expect(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.unified'),
    })
  ).toHaveAttribute('aria-pressed', 'true')
  expect(
    vi.mocked(commands.readCreationGitComparisonFile).mock.calls.length
  ).toBe(reads)
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})
it('uses an explicit switch confirmation and cancels without native writes', async () => {
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(/Starting point/)).toBeVisible()
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
  fireEvent.click(
    within(dialog).getByRole('button', { name: i18n.t('creation.cancel') })
  )
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})
it('requires explicit task ending before offering the actual version switch', async () => {
  useAssistantStore.setState({ canContinue: true })
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByRole('heading', {
      name: i18n.t('creation.versions.endTaskTitle'),
    })
  ).toBeVisible()
  expect(commands.endCreationGitAssistantTask).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})
it('shows discard beside cancel and save, requiring a second explicit choice', async () => {
  const drafts = {
    'server.js': {
      text: 'edited',
      diskText: 'saved',
      diskVersion: 'v1',
      conflict: null,
      saving: false,
      renaming: false,
      diskChanged: false,
      error: null,
    },
  }
  useCreationFilesStore.setState({ drafts })
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      head: 'b',
      branch: 'main',
      changes: [
        {
          path: 'server.js',
          staged: false,
          unstaged: true,
          untracked: false,
          indexStatus: ' ',
          diskStatus: 'M',
        },
      ],
      detail: null,
    },
  })
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.versions.saveSwitch'),
    })
  ).toBeVisible()
  const cancel = within(dialog).getByRole('button', {
    name: i18n.t('creation.cancel'),
  })
  const discard = within(dialog).getByRole('button', {
    name: i18n.t('creation.versions.discardOption'),
  })
  expect(discard).toBeVisible()
  expect(discard.parentElement).toBe(cancel.parentElement)
  expect(
    within(dialog).queryByText(i18n.t('creation.versions.otherOptions'))
  ).not.toBeInTheDocument()
  expect(
    within(dialog).queryByRole('button', {
      name: i18n.t('creation.versions.discardSwitch'),
    })
  ).not.toBeInTheDocument()
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.versions.discardOption'),
    })
  )
  expect(
    within(dialog).getByRole('heading', {
      name: i18n.t('creation.versions.discardTitle'),
    })
  ).toBeVisible()
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
  fireEvent.click(
    within(dialog).getByRole('button', { name: i18n.t('creation.cancel') })
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(useCreationFilesStore.getState().drafts).toBe(drafts)
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})
it('switches the middle reading view without altering draft or chat ownership', () => {
  const drafts = useCreationFilesStore.getState().drafts
  const messages = useAssistantStore.getState().messages
  act(() => useCreationReadingStore.getState().showGit())
  expect(useCreationReadingStore.getState().view).toBe('git')
  act(() => useCreationReadingStore.getState().showDiscussion())
  act(() => useCreationReadingStore.getState().showGit())
  expect(useCreationFilesStore.getState().drafts).toBe(drafts)
  expect(useAssistantStore.getState().messages).toBe(messages)
})

it('retries only synchronization after a completed switch without checking out twice', async () => {
  const sync = vi
    .spyOn(useCreationFilesStore.getState(), 'synchronizeSaved')
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true)
  try {
    render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
    await pickStartingPoint()
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: i18n.t('creation.versions.switch'),
      })
    )
    const retry = await screen.findByRole('button', {
      name: i18n.t('creation.files.retrySync'),
    })
    expect(commands.confirmCreationGitSwitch).toHaveBeenCalledTimes(1)
    fireEvent.click(retry)
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: i18n.t('creation.files.retrySync'),
        })
      ).not.toBeInTheDocument()
    )
    expect(commands.confirmCreationGitSwitch).toHaveBeenCalledTimes(1)
  } finally {
    sync.mockRestore()
  }
})

it('does not display a difference that arrives after a newer saved revision', async () => {
  let resolve:
    | ((
        value: Awaited<
          ReturnType<typeof commands.readCreationGitComparisonFile>
        >
      ) => void)
    | undefined
  vi.mocked(commands.readCreationGitComparisonFile).mockReturnValueOnce(
    new Promise(complete => {
      resolve = complete
    })
  )
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await waitFor(() =>
    expect(commands.readCreationGitComparisonFile).toHaveBeenCalled()
  )
  act(() => useCreationFilesStore.getState().changed(['server.js']))
  await act(async () =>
    resolve?.({
      status: 'ok',
      data: {
        token: 'comparison:b:parent',
        path: 'server.js',
        added: 1,
        deleted: 0,
        reason: null,
        hunks: [
          {
            oldStart: 1,
            oldLines: 0,
            newStart: 1,
            newLines: 1,
            lines: [
              {
                oldLine: null,
                newLine: 1,
                kind: 'addition',
                content: 'obsolete disk difference',
                noNewline: false,
              },
            ],
          },
        ],
      },
    })
  )
  expect(screen.queryByText('obsolete disk difference')).not.toBeInTheDocument()
})

it('links historical and all-file entries to the comparison without opening an editor', async () => {
  const drafts = useCreationFilesStore.getState().drafts
  render(
    <>
      <CreationGitFiles disabled={false} />
      <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
    </>
  )
  fireEvent.click(await screen.findByRole('button', { name: 'removed.js' }))
  await waitFor(() =>
    expect(commands.readCreationGitComparisonFile).toHaveBeenCalledWith(
      'page',
      expect.objectContaining({ path: 'removed.js' })
    )
  )
  expect(useCreationReadingStore.getState().view).toBe('git')
  expect(useCreationFilesStore.getState().activePath).toBeNull()
  expect(useCreationFilesStore.getState().drafts).toBe(drafts)
  expect(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.openCurrent'),
    })
  ).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'README.zh-CN.md' })
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.all', { count: 3 }),
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'README.zh-CN.md' }))
  expect(useCreationReadingStore.getState().gitPath).toBe('README.zh-CN.md')
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('explicitly changes the comparison direction and opens only the current file', async () => {
  useCreationStore.setState(state => ({
    workspace: state.workspace && {
      ...state.workspace,
      files: [{ path: 'server.js', kind: 'text', category: 'system', size: 2 }],
    },
  }))
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await waitFor(() =>
    expect(commands.getCreationGitComparison).toHaveBeenCalledWith('page', {
      commit: 'b',
      mode: 'parent',
      parent: null,
    })
  )
  fireEvent.keyDown(
    screen.getByRole('combobox', {
      name: i18n.t('creation.comparison.compare'),
    }),
    { key: 'ArrowDown' }
  )
  fireEvent.click(
    await screen.findByRole('option', {
      name: i18n.t('creation.comparison.selectedToSaved'),
    })
  )
  await waitFor(() =>
    expect(commands.getCreationGitComparison).toHaveBeenLastCalledWith('page', {
      commit: 'b',
      mode: 'saved',
      parent: null,
    })
  )
  expect(
    await screen.findByText(i18n.t('creation.comparison.diskHint'))
  ).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.openCurrent'),
    })
  )
  expect(useCreationReadingStore.getState().view).toBe('file')
  expect(useCreationFilesStore.getState().activePath).toBe('server.js')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})

it('reloads the original comparison after another selection failed', async () => {
  render(
    <>
      <CreationGitFiles disabled={false} />
      <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
    </>
  )
  await waitFor(() =>
    expect(useCreationReadingStore.getState().gitComparison?.token).toBe(
      'comparison:b:parent'
    )
  )
  vi.mocked(commands.getCreationGitComparison).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'Read failed' },
  })
  await pickStartingPoint()
  await screen.findByText(i18n.t('creation.comparison.unavailable'))
  fireEvent.click(screen.getByRole('button', { name: /Larger numbers/ }))
  await waitFor(() =>
    expect(useCreationReadingStore.getState().gitComparison?.token).toBe(
      'comparison:b:parent'
    )
  )
  expect(screen.getByRole('button', { name: 'server.js' })).toBeVisible()
})

it('uses a brief save toast and retains native warnings without a permanent receipt', async () => {
  const saved = vi.spyOn(gitWorkflow, 'saveGitVersion').mockResolvedValue({
    receipt: {
      commit: 'b',
      message: 'Larger numbers',
      paths: ['server.js'],
      warning: 'Index needs attention',
    },
    preview: {
      token: 'p',
      initial: false,
      head: 'a',
      branch: 'main',
      name: 'Creator',
      email: 'creator@pnds.local',
      files: [],
    },
  })
  const success = vi.spyOn(toast, 'success')
  try {
    render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
    await screen.findByRole('button', { name: /Larger numbers/ })
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('creation.version.saveCurrent'),
      })
    )
    expect(await screen.findByText('Index needs attention')).toBeVisible()
    expect(success).toHaveBeenCalledWith(i18n.t('creation.version.success'), {
      description: 'Larger numbers',
      duration: 3000,
    })
    expect(
      screen.queryByText(i18n.t('creation.version.success'))
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Larger numbers/ })
    ).toHaveAttribute('aria-pressed', 'true')
  } finally {
    saved.mockRestore()
    success.mockRestore()
  }
})

it('serializes comparison scopes and skips superseded selections before dispatch', async () => {
  let complete:
    | ((
        value: Awaited<ReturnType<typeof commands.getCreationGitComparison>>
      ) => void)
    | undefined
  vi.mocked(commands.getCreationGitComparison).mockReturnValueOnce(
    new Promise(resolve => {
      complete = resolve
    })
  )
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await waitFor(() =>
    expect(commands.getCreationGitComparison).toHaveBeenCalledTimes(1)
  )
  await pickStartingPoint()
  fireEvent.click(screen.getByRole('button', { name: /Larger numbers/ }))
  expect(commands.getCreationGitComparison).toHaveBeenCalledTimes(1)
  await act(async () =>
    complete?.({
      status: 'ok',
      data: {
        token: 'obsolete',
        before: { commit: 'a', message: 'Before', saved: false },
        after: { commit: 'b', message: 'After', saved: false },
        files: [],
      },
    })
  )
  await waitFor(() =>
    expect(useCreationReadingStore.getState().gitComparison?.token).toBe(
      'comparison:b:parent'
    )
  )
  expect(commands.getCreationGitComparison).toHaveBeenCalledTimes(2)
  expect(commands.getCreationGitComparison).not.toHaveBeenCalledWith(
    'page',
    expect.objectContaining({ commit: 'a' })
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('uses the current version suggestion while inspecting history and renames the selected version only', async () => {
  vi.mocked(commands.renameCreationGitVersion).mockResolvedValueOnce({
    status: 'ok',
    data: 'Earlier experiment',
  })
  const success = vi.spyOn(toast, 'success')
  try {
    vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
      status: 'ok',
      data: { ...graph, nextName: 'Larger numbers 1' },
    })
    render(
      <CreationGitPage identity="page" active onBusyChange={() => undefined} />
    )
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: i18n.t('creation.versions.name') })
      ).toHaveValue('Larger numbers 1')
    )
    fireEvent.click(screen.getByRole('button', { name: /Starting point/ }))
    expect(
      screen.getByRole('textbox', { name: i18n.t('creation.versions.name') })
    ).toHaveValue('Larger numbers 1')
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('creation.versions.rename') })
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: '  Earlier experiment  ' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: i18n.t('creation.save') })
    )
    await waitFor(() =>
      expect(commands.renameCreationGitVersion).toHaveBeenCalledWith(
        'page',
        'a',
        'Starting point',
        'Earlier experiment'
      )
    )
    expect(success).toHaveBeenCalledWith(i18n.t('creation.versions.renamed'), {
      description: 'Earlier experiment',
    })
    expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
    expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  } finally {
    success.mockRestore()
  }
})

it('cancels renaming without native writes and retains a manually entered next name across refresh', async () => {
  vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
    status: 'ok',
    data: { ...graph, nextName: 'Larger numbers 1' },
  })
  render(
    <CreationGitPage identity="page" active onBusyChange={() => undefined} />
  )
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: i18n.t('creation.versions.name') })
    ).toHaveValue('Larger numbers 1')
  )
  fireEvent.change(
    screen.getByRole('textbox', { name: i18n.t('creation.versions.name') }),
    { target: { value: 'My next idea' } }
  )
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.rename') })
  )
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: i18n.t('creation.cancel'),
    })
  )
  expect(commands.renameCreationGitVersion).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.git.refresh') })
  )
  await waitFor(() =>
    expect(commands.getCreationGitVersions).toHaveBeenCalledTimes(2)
  )
  expect(
    screen.getByRole('textbox', { name: i18n.t('creation.versions.name') })
  ).toHaveValue('My next idea')
})
