import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import type { MouseEvent } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import {
  commands,
  type GithubSyncStatus,
  type GitVersionGraph,
} from '@/lib/tauri-bindings'
import { seedCreationDraft } from '@/test/creation-files'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useAssistantStore } from '@/store/assistant-store'
import { useSessionStore } from '@/store/session-store'
import i18n from '@/i18n/config'
import { CreationGitFiles } from './CreationGitFiles'
import { CreationGitPage } from './CreationGitPage'
import * as gitWorkflow from '@/lib/creation-git-workflow'
import { notifications } from '@/lib/notifications'
import { useGithubAuthStore } from './creation-github-data'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))
const savedReceipt = {
  commit: 'b',
  message: 'Larger numbers',
  paths: ['server.js'],
  warning: null,
}
let savedVersion: Awaited<ReturnType<typeof gitWorkflow.saveGitVersion>> = {
  receipt: savedReceipt,
  completion: new gitWorkflow.CompletedGitOperation(
    'page',
    'saved',
    savedReceipt.message,
    savedReceipt
  ),
  preview: {
    token: 'save',
    initial: false,
    head: 'a',
    branch: 'main',
    name: 'Creator',
    email: 'creator@pnds.local',
    files: [],
  },
}
function completedSwitch(outcome: 'switched' | 'restored' = 'switched') {
  return new gitWorkflow.CompletedGitOperation('page', outcome)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => vi.restoreAllMocks())
const graph: GitVersionGraph = {
  head: 'b',
  branches: [{ name: 'main', tip: 'b' }],
  versions: [
    {
      id: 'b',
      message: 'Larger numbers',
      author: 'Creator',
      timestamp: 2,
      parents: ['a'],
      files: ['server.js'],
    },
    {
      id: 'a',
      message: 'Starting point',
      author: 'Original author',
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
  vi.mocked(commands.previewCreationGitRecord)
    .mockReset()
    .mockResolvedValue({
      status: 'error',
      error: { code: 'io', detail: 'previewCreationGitRecord not mocked' },
    })
  vi.mocked(commands.getCreationGitRecordFiles)
    .mockReset()
    .mockResolvedValue({
      status: 'error',
      error: { code: 'io', detail: 'getCreationGitRecordFiles not mocked' },
    })
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
  savedVersion = {
    ...savedVersion,
    completion: new gitWorkflow.CompletedGitOperation(
      'page',
      'saved',
      savedReceipt.message,
      savedReceipt
    ),
  }
  useCreationFilesStore.getState().clear()
  vi.mocked(commands.renameCreationGitVersion)
    .mockReset()
    .mockImplementation(async (_identity, _commit, _expected, name) => ({
      status: 'ok',
      data: name,
    }))
  useCreationReadingStore.setState({
    view: 'git',
    gitIntent: 'history',
    gitIntentRevision: 0,
    gitComparison: null,
    gitComparisonMode: 'parent',
    gitComparisonWorking: false,
    gitPath: null,
    gitTarget: null,
  })
  useSessionStore.setState({
    sessionStatus: 'idle',
    commandPending: false,
    runId: 0,
    sessionProjectPath: null,
    latestSnapshot: null,
  })
  useAssistantStore.setState({
    phase: 'idle',
    paused: false,
    canContinue: false,
    resumeRestored: false,
    activeConversationId: null,
    activeQuestion: null,
    resourceApproval: null,
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
  vi.mocked(commands.previewCreationGitSwitch).mockImplementation(
    async (_identity, commit) => ({
      status: 'ok',
      data: {
        token: 'switch',
        commit,
        paths: ['server.js'],
        discardedPaths: [],
      },
    })
  )
  vi.mocked(commands.previewCreationGitBranchSwitch).mockImplementation(
    async (_identity, _branch, commit) => ({
      status: 'ok',
      data: {
        token: 'branch-switch',
        commit,
        paths: ['server.js'],
        discardedPaths: [],
      },
    })
  )
  vi.mocked(commands.confirmCreationGitSwitch).mockResolvedValue({
    status: 'ok',
    data: null,
  })
})
const pickStartingPoint = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Starting point/ }))
}
const openOperationDetails = async () => {
  const trigger = await screen.findByRole('button', {
    name: i18n.t('creation.versions.operationDetails'),
  })
  await waitFor(() => expect(trigger).toBeEnabled())
  fireEvent.click(trigger)
  return await screen.findByRole('dialog', {
    name: i18n.t('creation.versions.operationDetails'),
  })
}
it('opens the preselected official template in the browser from a saved Blank project before signing in', async () => {
  const auth = { configured: true, account: null, installationUrl: null }
  useGithubAuthStore.setState({ status: auth, error: null })
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: auth,
  })
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: {
      supported: true,
      templateBackupEligible: true,
      templateBackupPending: null,
      templateBackupPublished: false,
      templateBackupRecovered: false,
      branch: 'main',
      head: 'b',
      origin: null,
      repository: null,
      accountId: null,
      autoBackup: false,
      autoBackupPaused: false,
      firstBackupConfirmed: false,
      pending: false,
      relation: 'unchecked',
      remoteHead: null,
      stale: false,
      issue: null,
    },
  })
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  const manage = await screen.findByRole('button', {
    name: 'Manage GitHub repository',
  })
  await waitFor(() => expect(manage).toBeEnabled())
  fireEvent.click(manage)
  const firstBackup = within(await screen.findByRole('dialog')).getByRole(
    'button',
    {
      name: 'First template backup…',
    }
  )
  await waitFor(() => expect(firstBackup).toBeEnabled())
  fireEvent.click(firstBackup)
  const dialog = await screen.findByRole('dialog', {
    name: 'First backup from the official template',
  })
  expect(dialog).toHaveTextContent(/only the default branch/i)
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: 'Create from the official template on GitHub',
    })
  )
  expect(openUrl).toHaveBeenCalledWith(
    'https://github.com/xO-xN/PNDS-Template/generate'
  )
  expect(
    within(dialog).getByRole('button', { name: 'Sign in to GitHub' })
  ).toBeEnabled()
  expect(commands.githubVerifyTemplateBackup).not.toHaveBeenCalled()
})

it('deduplicates identical passive read failures and keeps their details out of the graph layout', async () => {
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'unreadable',
      branch: null,
      head: null,
      changes: [],
      detail: 'Git metadata unavailable',
    },
  })
  const failed = vi.spyOn(notifications.flow, 'fail')
  const { container } = render(
    <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
  )
  await waitFor(() =>
    expect(failed).toHaveBeenCalledWith(
      'creation-git-reading:page',
      i18n.t('creation.versions.feedback.failed'),
      'Git metadata unavailable'
    )
  )
  act(() =>
    useCreationFilesStore.setState(state => ({ revision: state.revision + 1 }))
  )
  await waitFor(() =>
    expect(commands.getCreationGitStatus).toHaveBeenCalledTimes(2)
  )
  expect(failed).toHaveBeenCalledTimes(1)
  expect(
    container.querySelector('.creation-git-page-toolbar')?.nextElementSibling
  ).toHaveClass('creation-version-content')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(
    within(await openOperationDetails()).getByText('Git metadata unavailable')
  ).toBeVisible()
})

it('suppresses a late passive failure while Git is hidden and dismisses its read toast when leaving', async () => {
  const late =
    deferred<Awaited<ReturnType<typeof commands.getCreationGitStatus>>>()
  const failure = {
    status: 'error' as const,
    error: { code: 'io' as const, detail: 'Late read failure' },
  }
  vi.mocked(commands.getCreationGitStatus)
    .mockReturnValueOnce(late.promise)
    .mockResolvedValue(failure)
  const failed = vi.spyOn(notifications.flow, 'fail')
  const dismissed = vi.spyOn(notifications.flow, 'dismiss')
  const view = render(
    <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
  )
  await waitFor(() =>
    expect(commands.getCreationGitStatus).toHaveBeenCalledTimes(1)
  )
  view.rerender(
    <CreationGitPage identity="page" active={false} onBusyChange={vi.fn()} />
  )
  await act(async () => late.resolve(failure))
  expect(failed).not.toHaveBeenCalled()
  view.rerender(
    <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
  )
  await waitFor(() => expect(failed).toHaveBeenCalledTimes(1))
  expect(failed).toHaveBeenCalledWith(
    'creation-git-reading:page',
    i18n.t('creation.versions.feedback.failed'),
    'Late read failure'
  )
  dismissed.mockClear()
  view.rerender(
    <CreationGitPage identity="page" active={false} onBusyChange={vi.fn()} />
  )
  expect(dismissed).toHaveBeenCalledWith('creation-git-reading:page')
})

it('allows the same passive read error to notify again after a successful refresh', async () => {
  const unavailable = {
    status: 'ok' as const,
    data: {
      state: 'unreadable' as const,
      branch: null,
      head: null,
      changes: [],
      detail: 'Git metadata unavailable',
    },
  }
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue(unavailable)
  const failed = vi.spyOn(notifications.flow, 'fail')
  const { container } = render(
    <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
  )
  await waitFor(() => expect(failed).toHaveBeenCalledTimes(1))
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      head: 'b',
      branch: 'main',
      detail: null,
      changes: [],
    },
  })
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() =>
    expect(commands.getCreationGitVersions).toHaveBeenCalledTimes(1)
  )
  await waitFor(() =>
    expect(container.querySelector('.creation-git-page')).toHaveAttribute(
      'aria-busy',
      'false'
    )
  )
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue(unavailable)
  act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(failed).toHaveBeenCalledTimes(2))
  expect(failed.mock.calls.map(call => call[0])).toEqual([
    'creation-git-reading:page',
    'creation-git-reading:page',
  ])
})

async function confirmGithubUpdate() {
  const auth = {
    configured: true,
    account: { id: 'creator', login: 'creator', avatarUrl: null },
    installationUrl: null,
  }
  useGithubAuthStore.setState({ status: auth, error: null })
  vi.mocked(commands.githubAuthStatus).mockResolvedValue({
    status: 'ok',
    data: auth,
  })
  const status: GithubSyncStatus = {
    supported: true,
    templateBackupEligible: false,
    templateBackupPending: null,
    templateBackupPublished: false,
    templateBackupRecovered: false,
    branch: 'main',
    head: 'b',
    origin: null,
    repository: {
      id: 'repo',
      fullName: 'creator/score',
      defaultBranch: 'main',
      private: false,
      canPush: true,
    },
    accountId: auth.account.id,
    autoBackup: false,
    autoBackupPaused: false,
    firstBackupConfirmed: true,
    pending: false,
    relation: 'behind',
    remoteHead: 'c',
    stale: false,
    issue: null,
  }
  vi.mocked(commands.githubSyncStatus).mockResolvedValue({
    status: 'ok',
    data: status,
  })
  const native = deferred<Awaited<ReturnType<typeof commands.githubUpdate>>>()
  vi.mocked(commands.githubUpdate).mockReturnValueOnce(native.promise)
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  const manage = screen.getByRole('button', {
    name: 'Manage GitHub repository',
  })
  await waitFor(() => expect(manage).toBeEnabled())
  fireEvent.click(manage)
  const update = await screen.findByRole('button', {
    name: 'Update from GitHub',
  })
  await waitFor(() => expect(update).toBeEnabled())
  fireEvent.click(update)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Update from GitHub',
    })
  )
  await waitFor(() => expect(commands.githubUpdate).toHaveBeenCalledOnce())
  return () =>
    native.resolve({
      status: 'ok',
      data: {
        status: { ...status, head: 'c', relation: 'equal' },
        paths: ['server.js'],
      },
    })
}

it.each([
  'clean draft',
  'background poll',
  'later edit',
  'edit after background poll',
] as const)('reconciles a GitHub deletion with a %s', async observedBy => {
  const files = useCreationFilesStore.getState()
  seedCreationDraft('server.js', 'old saved text', 'v1')
  seedCreationDraft('other.js', 'unaffected text', 'v2')
  const otherFile = {
    path: 'other.js',
    kind: 'text',
    category: 'system',
    size: 15,
  } as const
  useCreationStore.setState(state => ({
    workspace: state.workspace && {
      ...state.workspace,
      files: [{ ...otherFile, path: 'server.js' }, otherFile],
    },
  }))
  useCreationFilesStore.setState({ activePath: 'server.js' })
  const unaffected = useCreationFilesStore.getState().drafts['other.js']
  const success = vi.spyOn(notifications.flow, 'succeed')
  const finish = await confirmGithubUpdate()
  if (observedBy === 'later edit') {
    act(() => files.edit('server.js', 'new user edit'))
  }
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: { files: [otherFile], changed: ['server.js'], revision: 1 },
  })
  if (observedBy !== 'clean draft') {
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'missing', detail: 'server.js' },
    })
  }
  if (
    observedBy === 'background poll' ||
    observedBy === 'edit after background poll'
  ) {
    await act(async () => {
      await files.poll()
    })
    expect(
      useCreationFilesStore.getState().drafts['server.js']?.diskChanged
    ).toBe(true)
  }
  if (observedBy === 'edit after background poll') {
    act(() => files.edit('server.js', 'new user edit'))
  }
  await act(async () => finish())
  await waitFor(() =>
    expect(
      success.mock.calls.some(
        ([, title]) => title === i18n.t('creation.github.updated')
      )
    ).toBe(true)
  )
  const drafts = useCreationFilesStore.getState().drafts
  expect(drafts['other.js']).toBe(unaffected)
  expect(useCreationStore.getState().workspace?.files).toEqual([otherFile])
  if (
    observedBy === 'later edit' ||
    observedBy === 'edit after background poll'
  ) {
    expect(drafts['server.js']).toMatchObject({
      text: 'new user edit',
      diskChanged: true,
    })
  } else {
    expect(drafts['server.js']).toBeUndefined()
  }
})

it('retries synchronization for an applied GitHub update without issuing another update', async () => {
  const files = useCreationFilesStore.getState()
  seedCreationDraft('server.js', 'old saved text', 'v1')
  const finish = await confirmGithubUpdate()
  const warn = vi.spyOn(notifications.flow, 'warn')
  const success = vi.spyOn(notifications.flow, 'succeed')
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'cannot refresh yet' },
  })
  await act(async () => finish())
  const retry = within(await openOperationDetails()).getByRole('button', {
    name: i18n.t('creation.files.retrySync'),
  })
  await waitFor(() => expect(retry).toBeEnabled())
  expect(warn).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('creation.github.updateRefreshFailed')
  )
  seedCreationDraft('server.js', 'recreated baseline', 'v2')
  act(() => files.edit('server.js', 'new editor content'))
  fireEvent.click(retry)
  await waitFor(() =>
    expect(success).toHaveBeenCalledWith(
      warn.mock.calls[0]?.[0],
      i18n.t('creation.github.updated'),
      undefined,
      undefined
    )
  )
  expect(commands.githubUpdate).toHaveBeenCalledOnce()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'new editor content'
  )
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

const modified = {
  path: 'server.js',
  staged: false,
  unstaged: true,
  untracked: false,
  indexStatus: ' ',
  diskStatus: 'M',
}
const nativeStatus = (
  changes = [modified],
  head = 'b',
  branch: string | null = 'main'
) => {
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: { state: 'available', head, branch, changes, detail: null },
  })
}
const renderPage = () =>
  render(
    <>
      <CreationGitFiles disabled={false} />
      <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
    </>
  )
const switchButton = () =>
  screen.getByRole('button', {
    name: i18n.t('creation.versions.switchToVersion'),
  })
const discardButton = () =>
  screen.getByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
async function armDiscard() {
  fireEvent.click(switchButton())
  const button = await screen.findByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
  await waitFor(() => expect(button).toBeEnabled())
  return button
}
async function saveDialog() {
  fireEvent.click(
    await screen.findByRole('button', { name: /Unrecorded changes/ })
  )
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.version.saveCurrent') })
  )
  return await screen.findByRole('dialog', {
    name: i18n.t('creation.version.saveCurrent'),
  })
}
function retryFeedback(spy: MockInstance<typeof notifications.flow.warn>) {
  const action = spy.mock.calls.at(-1)?.[3]?.action
  if (!action || typeof action !== 'object' || !('onClick' in action))
    throw new Error('Expected owner-checked read retry')
  act(() =>
    action.onClick({
      preventDefault: vi.fn(),
    } as unknown as MouseEvent<HTMLButtonElement>)
  )
}

it('implements the approved compact frame with one sidebar comparison and inline metadata', async () => {
  const { container } = renderPage()
  await pickStartingPoint()
  expect(
    container.querySelector('.creation-version-toolbar')?.nextElementSibling
  ).toHaveClass('creation-version-content')
  expect(
    container.querySelector(
      '.creation-version-overview > .creation-version-tree'
    )
  ).toBeInTheDocument()
  expect(
    container.querySelector(
      '.creation-version-overview > .creation-version-details'
    )
  ).toBeInTheDocument()
  expect(screen.getByText('Original author')).toBeVisible()
  expect(
    screen
      .getByRole('button', { name: i18n.t('creation.merge.intoCurrent') })
      .querySelector('svg')
  ).toBeNull()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: i18n.t('creation.git.refresh') })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: i18n.t('creation.comparison.split') })
  ).not.toBeInTheDocument()
  expect(
    container.querySelectorAll('.creation-version-comparison')
  ).toHaveLength(1)
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('switches a clean version in one click without a dialog or automatic save', async () => {
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  const save = vi.spyOn(gitWorkflow, 'saveGitVersion')
  renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  await waitFor(() =>
    expect(switched).toHaveBeenCalledWith(
      'page',
      'a',
      false,
      undefined,
      expect.any(Function),
      expect.objectContaining({ status: 'idle' }),
      expect.objectContaining({ preview: expect.any(Object) })
    )
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(save).not.toHaveBeenCalled()
})

it('keeps current HEAD disabled and omits the phantom working node when clean', async () => {
  renderPage()
  await screen.findByRole('button', { name: /Larger numbers/ })
  await waitFor(() => expect(switchButton()).toBeDisabled())
  expect(
    document.querySelector('[data-git-version="working"]')
  ).not.toBeInTheDocument()
})

it('keeps a clean older checkout free of a working node when only excluded untracked files remain', async () => {
  const excluded = [
    { ...modified, path: 'debug.log', untracked: true, diskStatus: '?' },
  ]
  nativeStatus(excluded)
  vi.mocked(commands.getCreationGitRecordFiles).mockResolvedValue({
    status: 'ok',
    data: [
      {
        path: 'debug.log',
        status: 'added',
        size: 14,
        defaultSelected: false,
        staged: false,
        exclusion: 'sensitiveOrGenerated',
      },
    ],
  })
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => {
      nativeStatus(excluded, 'a', null)
      vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
        status: 'ok',
        data: { ...graph, head: 'a' },
      })
      return completedSwitch()
    })
  const { container } = renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  await waitFor(() => expect(switched).toHaveBeenCalled())
  await waitFor(() =>
    expect(container.querySelector('[data-git-version="a"]')).toHaveAttribute(
      'aria-current',
      'true'
    )
  )
  expect(
    container.querySelector('[data-git-version="working"]')
  ).not.toBeInTheDocument()

  nativeStatus([...excluded, modified], 'a', null)
  fireEvent.focus(window)
  await waitFor(() =>
    expect(
      container.querySelector('[data-git-version="working"]')
    ).toBeInTheDocument()
  )
  expect(container.querySelector('path.pending')).toHaveAttribute(
    'data-git-parent',
    'a'
  )
  expect(commands.previewCreationGitRecord).not.toHaveBeenCalled()
})

it.each(['included', 'staged'] as const)(
  'shows a working node for %s untracked changes after reading their inclusion policy',
  async kind => {
    const staged = kind === 'staged'
    nativeStatus([
      {
        ...modified,
        path: 'new.js',
        untracked: true,
        staged,
        diskStatus: '?',
      },
    ])
    vi.mocked(commands.getCreationGitRecordFiles).mockResolvedValue({
      status: 'ok',
      data: [
        {
          path: 'new.js',
          status: 'added',
          size: 20,
          defaultSelected: !staged,
          staged,
          exclusion: staged ? 'sensitiveOrGenerated' : null,
        },
      ],
    })
    const { container } = renderPage()
    await waitFor(() =>
      expect(
        container.querySelector('[data-git-version="working"]')
      ).toBeInTheDocument()
    )
    expect(container.querySelector('path.pending')).toHaveAttribute(
      'data-git-parent',
      'b'
    )
    expect(commands.previewCreationGitRecord).not.toHaveBeenCalled()
  }
)

it('uses two explicit inline clicks to discard changes and never saves on this path', async () => {
  nativeStatus()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  const save = vi.spyOn(gitWorkflow, 'saveGitVersion')
  renderPage()
  await pickStartingPoint()
  await armDiscard()
  expect(switched).not.toHaveBeenCalled()
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledExactlyOnceWith(
    'page',
    'a',
    true
  )
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(discardButton())
  await waitFor(() =>
    expect(switched).toHaveBeenCalledWith(
      'page',
      'a',
      true,
      undefined,
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({ preview: expect.any(Object) })
    )
  )
  expect(switched).toHaveBeenCalledTimes(1)
  expect(save).not.toHaveBeenCalled()
})

it.each([
  'escape',
  'blur',
  'selection',
  'outside',
  'draft',
  'runtime',
  'mode',
] as const)('revokes inline discard authorization after %s', async reason => {
  nativeStatus()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  await armDiscard()
  act(() => {
    if (reason === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
    if (reason === 'blur') window.dispatchEvent(new Event('blur'))
    if (reason === 'selection')
      fireEvent.click(screen.getByRole('button', { name: /Larger numbers/ }))
    if (reason === 'outside')
      fireEvent.pointerDown(
        screen.getByRole('searchbox', {
          name: i18n.t('creation.comparison.search'),
        })
      )
    if (reason === 'draft') {
      seedCreationDraft('server.js', 'saved', 'v1')
      useCreationFilesStore.getState().edit('server.js', 'new edit')
    }
    if (reason === 'runtime') useSessionStore.setState({ runId: 99 })
    if (reason === 'mode')
      useCreationReadingStore.getState().setGitComparisonMode('saved')
  })
  await waitFor(() =>
    expect(
      screen.queryByRole('button', {
        name: i18n.t('creation.versions.discardAndSwitch'),
      })
    ).not.toBeInTheDocument()
  )
  expect(switched).not.toHaveBeenCalled()
})

it('does not accept key repeat as a second discard confirmation', async () => {
  nativeStatus()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  await armDiscard()
  expect(
    fireEvent.keyDown(discardButton(), { key: 'Enter', repeat: true })
  ).toBe(false)
  expect(switched).not.toHaveBeenCalled()
})

it('rereads changed files on every click and requests review again when they change', async () => {
  nativeStatus()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  await armDiscard()
  nativeStatus([{ ...modified, path: 'new.js' }])
  fireEvent.click(discardButton())
  await screen.findByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
  await waitFor(() => expect(discardButton()).toBeEnabled())
  expect(switched).not.toHaveBeenCalled()
  fireEvent.click(discardButton())
  await waitFor(() => expect(switched).toHaveBeenCalledOnce())
})

it('switches without discard if the freshly read project has become clean', async () => {
  nativeStatus()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  nativeStatus([])
  fireEvent.click(switchButton())
  await waitFor(() =>
    expect(switched).toHaveBeenCalledWith(
      'page',
      'a',
      false,
      undefined,
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({ preview: expect.any(Object) })
    )
  )
})

it.each(['version', 'branch'] as const)(
  'uses native untracked inclusion policy before switching (%s)',
  async entry => {
    nativeStatus([
      { ...modified, path: '.env', untracked: true, diskStatus: '?' },
    ])
    vi.mocked(commands.getCreationGitRecordFiles).mockResolvedValue({
      status: 'ok',
      data: [
        {
          path: '.env',
          status: 'added',
          size: 5,
          defaultSelected: false,
          staged: false,
          exclusion: 'sensitiveOrGenerated',
        },
      ],
    })
    const switched = vi
      .spyOn(gitWorkflow, 'switchGitVersion')
      .mockImplementation(async () => completedSwitch())
    renderPage()
    await pickStartingPoint()
    if (entry === 'branch')
      act(() =>
        useCreationReadingStore.getState().switchBranch('a', 'other-route')
      )
    else fireEvent.click(switchButton())
    await waitFor(() =>
      expect(switched).toHaveBeenCalledWith(
        'page',
        'a',
        false,
        entry === 'branch' ? 'other-route' : undefined,
        expect.any(Function),
        expect.any(Object),
        expect.objectContaining({ preview: expect.any(Object) })
      )
    )
  }
)

it.each(['status', 'untracked-preview'] as const)(
  'does not mistake an unreadable %s for clean state',
  async failure => {
    const switched = vi
      .spyOn(gitWorkflow, 'switchGitVersion')
      .mockImplementation(async () => completedSwitch())
    renderPage()
    await pickStartingPoint()
    if (failure === 'status')
      vi.mocked(commands.getCreationGitStatus).mockResolvedValueOnce({
        status: 'error',
        error: { code: 'io', detail: 'Fresh status unavailable' },
      })
    else {
      nativeStatus([{ ...modified, untracked: true }])
      vi.mocked(commands.getCreationGitRecordFiles).mockResolvedValueOnce({
        status: 'error',
        error: { code: 'io', detail: 'Inclusion policy unavailable' },
      })
    }
    fireEvent.click(switchButton())
    await openOperationDetails()
    expect(switched).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('button', {
        name: i18n.t('creation.versions.discardAndSwitch'),
      })
    ).not.toBeInTheDocument()
  }
)

it('rejects late preparations after project replacement or a new runtime', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.getCreationGitStatus>>>()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  vi.mocked(commands.getCreationGitStatus).mockReturnValueOnce(pending.promise)
  fireEvent.click(switchButton())
  act(() => useSessionStore.setState({ runId: 1 }))
  await act(async () =>
    pending.resolve({
      status: 'ok',
      data: {
        state: 'available',
        head: 'b',
        branch: 'main',
        changes: [],
        detail: null,
      },
    })
  )
  expect(switched).not.toHaveBeenCalled()
  const later =
    deferred<Awaited<ReturnType<typeof commands.getCreationGitStatus>>>()
  vi.mocked(commands.getCreationGitStatus).mockReturnValueOnce(later.promise)
  await waitFor(() => expect(switchButton()).toBeEnabled())
  fireEvent.click(switchButton())
  act(() => useCreationStore.setState({ workspace: null }))
  await act(async () =>
    later.resolve({
      status: 'ok',
      data: {
        state: 'available',
        head: 'b',
        branch: 'main',
        changes: [],
        detail: null,
      },
    })
  )
  expect(switched).not.toHaveBeenCalled()
})

it('rejects replacement of a known assistant task while switch preparation is pending', async () => {
  useAssistantStore.setState({
    phase: 'continuing',
    activeConversationId: 'task-a',
  })
  const pending =
    deferred<Awaited<ReturnType<typeof commands.getCreationGitTaskPending>>>()
  const ended = vi.spyOn(gitWorkflow, 'endGitTask').mockResolvedValue()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  vi.mocked(commands.getCreationGitTaskPending).mockReturnValueOnce(
    pending.promise
  )
  fireEvent.click(switchButton())
  act(() => useAssistantStore.setState({ activeConversationId: 'task-b' }))
  await act(async () => pending.resolve({ status: 'ok', data: true }))
  expect(ended).not.toHaveBeenCalled()
  expect(switched).not.toHaveBeenCalled()
})

it('discloses an unknown recovered task before ending it and switching', async () => {
  vi.mocked(commands.getCreationGitTaskPending).mockResolvedValue({
    status: 'ok',
    data: true,
  })
  const ended = vi.spyOn(gitWorkflow, 'endGitTask').mockResolvedValue()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  await screen.findByText(i18n.t('creation.versions.switchEndsTask'))
  await waitFor(() => expect(switchButton()).toBeEnabled())
  expect(ended).not.toHaveBeenCalled()
  expect(switched).not.toHaveBeenCalled()
  fireEvent.click(switchButton())
  await waitFor(() => expect(switched).toHaveBeenCalledOnce())
  expect(ended).toHaveBeenCalledWith('page')
  expect(ended.mock.invocationCallOrder[0]).toBeLessThan(
    switched.mock.invocationCallOrder[0] ?? 0
  )
})

it('ends a visible task and stops the reviewed runtime through the existing switch workflow', async () => {
  useAssistantStore.setState({
    phase: 'continuing',
    activeConversationId: 'task-a',
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
    runId: 7,
  })
  const ended = vi
    .spyOn(gitWorkflow, 'endGitTask')
    .mockImplementation(async () => {
      useAssistantStore.setState({ phase: 'idle' })
    })
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  expect(
    screen.queryByText(/Switching stops the live test/)
  ).not.toBeInTheDocument()
  fireEvent.click(switchButton())
  await waitFor(() => expect(ended).toHaveBeenCalledOnce())
  await waitFor(() =>
    expect(switched).toHaveBeenCalledWith(
      'page',
      'a',
      false,
      undefined,
      expect.any(Function),
      expect.objectContaining({ status: 'ready', runId: 7, path: '/score' }),
      expect.objectContaining({ preview: expect.any(Object) })
    )
  )
})

it('retains drafts if ending the task or switching fails', async () => {
  nativeStatus()
  seedCreationDraft('server.js', 'base', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'retained user draft')
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockRejectedValue(new Error('Native boundary refused'))
  renderPage()
  await pickStartingPoint()
  await armDiscard()
  fireEvent.click(discardButton())
  await openOperationDetails()
  expect(switched).toHaveBeenCalledOnce()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'retained user draft'
  )
})

it('keeps newer drafts created while a task is retiring', async () => {
  nativeStatus()
  seedCreationDraft('server.js', 'base', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'reviewed')
  useAssistantStore.setState({ phase: 'continuing' })
  vi.spyOn(gitWorkflow, 'endGitTask').mockImplementation(async () => {
    useCreationFilesStore.getState().edit('server.js', 'newer user draft')
    useAssistantStore.setState({ phase: 'idle' })
  })
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  await armDiscard()
  fireEvent.click(discardButton())
  await openOperationDetails()
  expect(switched).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'newer user draft'
  )
})

it('shows and retains the actual named-route target across discard review', async () => {
  nativeStatus()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  act(() => useCreationReadingStore.getState().switchBranch('a', 'other-route'))
  const discard = await screen.findByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
  await waitFor(() => expect(discard).toBeEnabled())
  const target = screen.getByRole('complementary', {
    name: i18n.t('creation.versions.inspector'),
  })
  expect(within(target).getByText('other-route')).toBeVisible()
  expect(within(target).queryByText('main')).not.toBeInTheDocument()
  fireEvent.click(discard)
  await waitFor(() =>
    expect(switched).toHaveBeenCalledWith(
      'page',
      'a',
      true,
      'other-route',
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({ preview: expect.any(Object) })
    )
  )
})

it('restores current HEAD with discard without selecting a new route', async () => {
  nativeStatus()
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch('restored'))
  renderPage()
  fireEvent.click(await screen.findByRole('button', { name: /Larger numbers/ }))
  await armDiscard()
  fireEvent.click(discardButton())
  await waitFor(() =>
    expect(switched).toHaveBeenCalledWith(
      'page',
      'b',
      true,
      undefined,
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({ preview: expect.any(Object) })
    )
  )
})

it.each(['incomplete', 'throws'] as const)(
  'retains completed checkout and retries synchronization when it %s',
  async failure => {
    const warned = vi.spyOn(notifications.flow, 'warn')
    const failed = vi.spyOn(notifications.flow, 'fail')
    const switched = vi.spyOn(gitWorkflow, 'switchGitVersion')
    const discarded = vi.spyOn(
      useCreationFilesStore.getState(),
      'discardCheckoutCopies'
    )
    const sync = vi
      .spyOn(useCreationFilesStore.getState(), 'synchronizeSaved')
      .mockResolvedValue(true)
    if (failure === 'throws')
      sync.mockRejectedValueOnce(new Error('File synchronization unavailable'))
    else sync.mockResolvedValueOnce(false)
    renderPage()
    await pickStartingPoint()
    fireEvent.click(switchButton())
    await waitFor(() => expect(warned).toHaveBeenCalled())
    expect(sync).toHaveBeenCalledOnce()
    expect(failed).not.toHaveBeenCalled()
    const details = await openOperationDetails()
    fireEvent.click(
      within(details).getByRole('button', {
        name: i18n.t('creation.files.retrySync'),
      })
    )
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(2))
    expect(switched).toHaveBeenCalledOnce()
    expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
    expect(discarded).toHaveBeenCalledOnce()
  }
)

it('retains unfinished checkout synchronization after a successful rename', async () => {
  const warned = vi.spyOn(notifications.flow, 'warn')
  const discarded = vi.spyOn(
    useCreationFilesStore.getState(),
    'discardCheckoutCopies'
  )
  const sync = vi
    .spyOn(useCreationFilesStore.getState(), 'synchronizeSaved')
    .mockResolvedValue(false)
  vi.mocked(commands.confirmCreationGitSwitch).mockImplementationOnce(
    async () => {
      nativeStatus([], 'a', null)
      vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
        status: 'ok',
        data: { ...graph, head: 'a' },
      })
      return { status: 'ok', data: null }
    }
  )
  renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  await waitFor(() => expect(warned).toHaveBeenCalledOnce())
  expect(sync).toHaveBeenCalledOnce()
  const rename = screen.getByRole('button', {
    name: i18n.t('creation.versions.rename'),
  })
  await waitFor(() => expect(rename).toBeEnabled())
  fireEvent.click(rename)
  const input = screen.getByRole('textbox', {
    name: i18n.t('creation.versions.versionName'),
  })
  fireEvent.change(input, { target: { value: 'Renamed after checkout' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(warned).toHaveBeenCalledTimes(2))
  expect(sync).toHaveBeenCalledTimes(2)
  expect(commands.renameCreationGitVersion).toHaveBeenCalledExactlyOnceWith(
    'page',
    'a',
    'Starting point',
    'Renamed after checkout'
  )
  const details = await openOperationDetails()
  const retry = within(details).getByRole('button', {
    name: i18n.t('creation.files.retrySync'),
  })
  await waitFor(() => expect(retry).toBeEnabled())
  sync.mockResolvedValue(true)
  fireEvent.click(retry)
  await waitFor(() => expect(sync).toHaveBeenCalledTimes(3))
  await waitFor(() =>
    expect(
      within(details).queryByRole('button', {
        name: i18n.t('creation.files.retrySync'),
      })
    ).not.toBeInTheDocument()
  )
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledOnce()
  expect(commands.renameCreationGitVersion).toHaveBeenCalledOnce()
  expect(discarded).toHaveBeenCalledOnce()
})

it('starts saving only after the dedicated name form is submitted', async () => {
  nativeStatus()
  const saved = vi
    .spyOn(gitWorkflow, 'saveGitVersion')
    .mockImplementation(async () => {
      nativeStatus([])
      return savedVersion
    })
  renderPage()
  const dialog = await saveDialog()
  expect(saved).not.toHaveBeenCalled()
  fireEvent.change(
    within(dialog).getByRole('textbox', {
      name: i18n.t('creation.versions.name'),
    }),
    { target: { value: 'My version' } }
  )
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.version.saveCurrent'),
    })
  )
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith(
      'page',
      'My version',
      '',
      expect.any(Function)
    )
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(
    document.querySelector('[data-git-version="working"]')
  ).not.toBeInTheDocument()
})

it('preserves save warnings and excluded-file details after the name dialog closes', async () => {
  nativeStatus()
  vi.spyOn(gitWorkflow, 'saveGitVersion').mockImplementation(async () => {
    nativeStatus([])
    return {
      ...savedVersion,
      receipt: { ...savedReceipt, warning: 'Version metadata warning' },
      completion: new gitWorkflow.CompletedGitOperation(
        'page',
        'saved',
        savedReceipt.message,
        { ...savedReceipt, warning: 'Version metadata warning' }
      ),
      preview: {
        ...savedVersion.preview,
        files: [
          {
            path: '.env',
            status: 'added',
            size: 8,
            staged: false,
            defaultSelected: false,
            exclusion: 'sensitiveOrGenerated',
          },
        ],
      },
    }
  })
  const warned = vi.spyOn(notifications.flow, 'warn')
  renderPage()
  const dialog = await saveDialog()
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.version.saveCurrent'),
    })
  )
  await waitFor(() =>
    expect(warned).toHaveBeenCalledWith(
      expect.any(String),
      i18n.t('creation.version.success'),
      'Version metadata warning',
      undefined
    )
  )
  const details = await openOperationDetails()
  expect(details).toHaveTextContent('Version metadata warning')
  expect(details).toHaveTextContent('.env')
})

it('preserves a saved receipt and retries only reads when refreshing history fails', async () => {
  nativeStatus()
  const warned = vi.spyOn(notifications.flow, 'warn')
  const saved = vi
    .spyOn(gitWorkflow, 'saveGitVersion')
    .mockImplementation(async () => {
      vi.mocked(commands.getCreationGitStatus).mockResolvedValueOnce({
        status: 'error',
        error: { code: 'io', detail: 'Cannot refresh history' },
      })
      return savedVersion
    })
  renderPage()
  const dialog = await saveDialog()
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.version.saveCurrent'),
    })
  )
  await waitFor(() => expect(warned).toHaveBeenCalled())
  retryFeedback(warned)
  await waitFor(() =>
    expect(commands.getCreationGitVersions).toHaveBeenCalledTimes(2)
  )
  expect(saved).toHaveBeenCalledOnce()
})

it('reports save failure without claiming success and keeps the name form open', async () => {
  nativeStatus()
  vi.spyOn(gitWorkflow, 'saveGitVersion').mockRejectedValue(
    new Error('Disk save conflict')
  )
  const succeeded = vi.spyOn(notifications.flow, 'succeed')
  renderPage()
  const dialog = await saveDialog()
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.version.saveCurrent'),
    })
  )
  await waitFor(() =>
    expect(within(dialog).getByText('Disk save conflict')).toBeInTheDocument()
  )
  expect(succeeded).not.toHaveBeenCalled()
})

it('renames inline with expected-message guards and updates the exact version', async () => {
  renderPage()
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.rename') })
  )
  const input = screen.getByRole('textbox', {
    name: i18n.t('creation.versions.versionName'),
  })
  fireEvent.change(input, { target: { value: 'Named locally' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() =>
    expect(commands.renameCreationGitVersion).toHaveBeenCalledWith(
      'page',
      'a',
      'Starting point',
      'Named locally'
    )
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await waitFor(() =>
    expect(
      screen.queryByRole('textbox', {
        name: i18n.t('creation.versions.versionName'),
      })
    ).not.toBeInTheDocument()
  )
})

it('does not execute an old queued switch after selection changes during rename', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.renameCreationGitVersion>>>()
  vi.mocked(commands.renameCreationGitVersion).mockReturnValueOnce(
    pending.promise
  )
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.rename') })
  )
  const input = screen.getByRole('textbox', {
    name: i18n.t('creation.versions.versionName'),
  })
  fireEvent.change(input, { target: { value: 'Renaming A' } })
  fireEvent.blur(input)
  fireEvent.click(switchButton())
  fireEvent.click(screen.getByRole('button', { name: /Larger numbers/ }))
  await act(async () => pending.resolve({ status: 'ok', data: 'Renaming A' }))
  expect(switched).not.toHaveBeenCalled()
})

it('continues the first switch click after blur has saved the same version name', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.renameCreationGitVersion>>>()
  vi.mocked(commands.renameCreationGitVersion).mockReturnValueOnce(
    pending.promise
  )
  const switched = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockImplementation(async () => completedSwitch())
  renderPage()
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.rename') })
  )
  const input = screen.getByRole('textbox', {
    name: i18n.t('creation.versions.versionName'),
  })
  fireEvent.change(input, { target: { value: 'Renaming A' } })
  fireEvent.blur(input)
  fireEvent.click(switchButton())
  await act(async () => pending.resolve({ status: 'ok', data: 'Renaming A' }))
  await waitFor(() =>
    expect(switched).toHaveBeenCalledWith(
      'page',
      'a',
      false,
      undefined,
      expect.any(Function),
      expect.any(Object),
      expect.objectContaining({ preview: expect.any(Object) })
    )
  )
})

it('retains a native rename conflict inline and warns honestly if only refresh fails', async () => {
  const warned = vi.spyOn(notifications.flow, 'warn')
  renderPage()
  await pickStartingPoint()
  vi.mocked(commands.renameCreationGitVersion).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'Name changed externally' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.rename') })
  )
  const input = screen.getByRole('textbox', {
    name: i18n.t('creation.versions.versionName'),
  })
  fireEvent.change(input, { target: { value: 'New name' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByRole('alert')
  expect(input).toHaveValue('New name')
  vi.mocked(commands.renameCreationGitVersion).mockImplementationOnce(
    async () => {
      vi.mocked(commands.getCreationGitStatus).mockResolvedValueOnce({
        status: 'error',
        error: { code: 'io', detail: 'Cannot refresh names' },
      })
      return { status: 'ok', data: 'New name' }
    }
  )
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => expect(warned).toHaveBeenCalled())
  retryFeedback(warned)
  await waitFor(() =>
    expect(commands.getCreationGitVersions).toHaveBeenCalledTimes(2)
  )
  expect(commands.renameCreationGitVersion).toHaveBeenCalledTimes(2)
})

it('keeps sidebar mode shared without checkout and excludes unchanged inventory entries', async () => {
  renderPage()
  await pickStartingPoint()
  expect(
    screen.queryByRole('button', { name: /^README/ })
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', {
      name: i18n.t('creation.comparison.withLocal'),
    })
  )
  await waitFor(() =>
    expect(commands.getCreationGitComparison).toHaveBeenCalledWith('page', {
      commit: 'a',
      mode: 'saved',
      parent: null,
    })
  )
  expect(useCreationReadingStore.getState().gitComparisonMode).toBe('saved')
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(
    screen.queryByLabelText(i18n.t('creation.comparison.direction'))
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^All/ })).not.toBeInTheDocument()
})

it('shows a clean comparison as empty rather than displaying an unchanged file', async () => {
  vi.mocked(commands.getCreationGitComparison).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'equal',
      before: { commit: 'b', message: 'Before', saved: false },
      after: { commit: null, message: null, saved: true },
      files: [{ path: 'README.md', status: 'unchanged' }],
    },
  })
  renderPage()
  await screen.findByText(i18n.t('creation.comparison.noTextChanges'))
  expect(useCreationReadingStore.getState().gitPath).toBeNull()
  expect(commands.readCreationGitComparisonFile).not.toHaveBeenCalled()
})

it('retains a concrete native blocking path and reason in failure feedback and operation details', async () => {
  const detail =
    'Cannot restore symbolic link public/performer-alias.js; symbolic links require an external Git tool.'
  const failed = vi.spyOn(notifications.flow, 'fail')
  vi.spyOn(gitWorkflow, 'switchGitVersion').mockRejectedValue({
    code: 'testValidation',
    detail,
  })
  renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  await waitFor(() => expect(failed).toHaveBeenCalled())
  expect(failed.mock.calls.at(-1)?.[2]).toBe(detail)
  const dialog = await openOperationDetails()
  expect(within(dialog).getByRole('alert')).toHaveTextContent(detail)
  vi.mocked(commands.revealCreationPath).mockResolvedValueOnce({
    status: 'ok',
    data: null,
  })
  fireEvent.click(
    within(dialog).getByRole('button', { name: i18n.t('creation.openFinder') })
  )
  await waitFor(() =>
    expect(commands.revealCreationPath).toHaveBeenCalledExactlyOnceWith(
      'page',
      null
    )
  )
  expect(within(dialog).getByRole('alert')).toHaveTextContent(detail)
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})

it('shows excluded local replacements before consuming the exact native preview token', async () => {
  const path = 'docs/handoff-history/validation.log'
  vi.mocked(commands.previewCreationGitSwitch).mockResolvedValueOnce({
    status: 'ok',
    data: {
      token: 'reviewed-archive',
      commit: 'a',
      paths: [path],
      discardedPaths: [],
      overwrittenPaths: [path],
    },
  })
  renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  const confirm = await screen.findByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
  const files = screen.getByRole('region', {
    name: i18n.t('creation.versions.switchFiles'),
  })
  expect(within(files).getByText(path)).toBeVisible()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  fireEvent.pointerDown(files)
  fireEvent.focusIn(files)
  expect(discardButton()).toBeEnabled()
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(commands.confirmCreationGitSwitch).toHaveBeenCalledExactlyOnceWith(
      'page',
      'reviewed-archive'
    )
  )
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledExactlyOnceWith(
    'page',
    'a',
    true
  )
})

it('discloses native discard paths missed by the status inventory before confirming', async () => {
  vi.mocked(commands.previewCreationGitSwitch).mockResolvedValueOnce({
    status: 'ok',
    data: {
      token: 'reviewed-new-file',
      commit: 'a',
      paths: ['new-source.js'],
      discardedPaths: ['new-source.js'],
    },
  })
  renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  const confirm = await screen.findByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
  const files = screen.getByRole('region', {
    name: i18n.t('creation.versions.switchFiles'),
  })
  expect(within(files).getByText('new-source.js')).toBeVisible()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  await waitFor(() =>
    expect(commands.confirmCreationGitSwitch).toHaveBeenCalledExactlyOnceWith(
      'page',
      'reviewed-new-file'
    )
  )
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledOnce()
})

it('does not replace a reviewed preview or retry a write after a native freshness refusal', async () => {
  vi.mocked(commands.previewCreationGitSwitch).mockResolvedValueOnce({
    status: 'ok',
    data: {
      token: 'stale-reviewed',
      commit: 'a',
      paths: ['archive.log'],
      discardedPaths: [],
      overwrittenPaths: ['archive.log'],
    },
  })
  vi.mocked(commands.confirmCreationGitSwitch).mockResolvedValueOnce({
    status: 'error',
    error: {
      code: 'versionConflict',
      detail: 'archive.log changed after review',
    },
  })
  renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  await screen.findByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
  fireEvent.click(discardButton())
  const dialog = await openOperationDetails()
  expect(dialog).toHaveTextContent('archive.log changed after review')
  expect(commands.confirmCreationGitSwitch).toHaveBeenCalledExactlyOnceWith(
    'page',
    'stale-reviewed'
  )
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledOnce()
})

it('cancels a prepared replacement review on Escape and confirms only a newly reviewed token', async () => {
  const preview = (token: string) => ({
    status: 'ok' as const,
    data: {
      token,
      commit: 'a',
      paths: ['archive.log'],
      discardedPaths: [],
      overwrittenPaths: ['archive.log'],
    },
  })
  vi.mocked(commands.previewCreationGitSwitch)
    .mockResolvedValueOnce(preview('cancelled-preview'))
    .mockResolvedValueOnce(preview('new-review'))
  renderPage()
  await pickStartingPoint()
  fireEvent.click(switchButton())
  await screen.findByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(
    screen.queryByRole('button', {
      name: i18n.t('creation.versions.discardAndSwitch'),
    })
  ).not.toBeInTheDocument()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  fireEvent.click(switchButton())
  await screen.findByRole('button', {
    name: i18n.t('creation.versions.discardAndSwitch'),
  })
  fireEvent.click(discardButton())
  await waitFor(() =>
    expect(commands.confirmCreationGitSwitch).toHaveBeenCalledExactlyOnceWith(
      'page',
      'new-review'
    )
  )
  expect(commands.previewCreationGitSwitch).toHaveBeenCalledTimes(2)
})
