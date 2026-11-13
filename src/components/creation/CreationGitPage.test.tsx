import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
import { notifications } from '@/lib/notifications'
import { useGithubAuthStore } from './creation-github-data'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))
const savedVersion: Awaited<ReturnType<typeof gitWorkflow.saveGitVersion>> = {
  receipt: {
    commit: 'b',
    message: 'Larger numbers',
    paths: ['server.js'],
    warning: null,
  },
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
  vi.mocked(commands.previewCreationGitRecord)
    .mockReset()
    .mockResolvedValue({
      status: 'error',
      error: { code: 'io', detail: 'previewCreationGitRecord not mocked' },
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
  useCreationFilesStore.getState().clear()
  useCreationReadingStore.setState({
    view: 'git',
    gitIntent: 'history',
    gitIntentRevision: 0,
    gitComparison: null,
    gitPath: null,
    gitTarget: null,
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
const openOperationDetails = async () => {
  const trigger = screen.getByRole('button', {
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
      pending: false,
      relation: 'unchecked',
      remoteHead: null,
      stale: false,
      issue: null,
    },
  })
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  const firstBackup = await screen.findByRole('button', {
    name: 'First template backup…',
  })
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

it('keeps the graph directly below the fixed toolbar after switching versions', async () => {
  vi.spyOn(gitWorkflow, 'switchGitVersion').mockResolvedValue({
    synchronized: true,
  })
  const succeeded = vi.spyOn(notifications.flow, 'succeed')
  const { container } = render(
    <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
  )
  await pickStartingPoint()
  const toolbar = container.querySelector('.creation-git-page-toolbar')
  const details = screen.getByRole('button', {
    name: i18n.t('creation.versions.operationDetails'),
  })
  expect(details).toBeDisabled()
  expect(toolbar?.nextElementSibling).toHaveClass('creation-git-page-body')
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.versions.switch'),
    })
  )
  await waitFor(() => expect(succeeded).toHaveBeenCalled())
  expect(toolbar?.nextElementSibling).toHaveClass('creation-git-page-body')
  expect(
    screen.getByRole('button', {
      name: i18n.t('creation.versions.operationDetails'),
    })
  ).toBe(details)
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
  ).toHaveClass('creation-git-page-body')
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

it('keeps save-then-switch warnings and excluded-file details available without adding page rows', async () => {
  vi.spyOn(gitWorkflow, 'saveGitVersion').mockResolvedValue({
    ...savedVersion,
    receipt: {
      commit: 'b',
      message: 'Larger numbers',
      paths: ['server.js'],
      warning: 'Version name metadata needs attention',
    },
    preview: {
      ...savedVersion.preview,
      files: [
        {
          path: '.env',
          status: 'added',
          size: 10,
          exclusion: 'sensitiveOrGenerated',
          defaultSelected: false,
          staged: false,
        },
      ],
    },
  })
  vi.spyOn(gitWorkflow, 'switchGitVersion').mockResolvedValue({
    synchronized: true,
  })
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      branch: 'main',
      head: 'b',
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
  const warned = vi.spyOn(notifications.flow, 'warn')
  const failed = vi.spyOn(notifications.flow, 'fail')
  const { container } = render(
    <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
  )
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.versions.saveSwitch'),
    })
  )
  await waitFor(() =>
    expect(warned).toHaveBeenCalledWith(
      expect.any(String),
      i18n.t('creation.versions.switched'),
      'Version name metadata needs attention',
      undefined
    )
  )
  expect(failed).not.toHaveBeenCalled()
  expect(
    container.querySelector('.creation-git-page-toolbar')?.nextElementSibling
  ).toHaveClass('creation-git-page-body')
  const details = await openOperationDetails()
  expect(
    within(details).getByText('Version name metadata needs attention')
  ).toBeVisible()
  expect(within(details).getByText('.env', { exact: false })).toBeVisible()
})

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
    const succeeded = vi.spyOn(notifications.flow, 'succeed')
    try {
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: i18n.t('creation.versions.discardRestore'),
        })
      )
      await waitFor(() =>
        expect(succeeded).toHaveBeenCalledWith(
          expect.any(String),
          i18n.t('creation.versions.restored'),
          undefined,
          undefined
        )
      )
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
it.each(['version', 'branch'] as const)(
  'rechecks current changes before offering save-first when an older status has become clean (%s)',
  async entry => {
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
    render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
    await pickStartingPoint()
    // The current saved tree is clean now; the page still holds an older read.
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
    if (entry === 'branch')
      act(() =>
        useCreationReadingStore.getState().switchBranch('a', 'old-branch')
      )
    else
      fireEvent.click(
        screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
      )
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).queryByRole('button', {
        name: i18n.t('creation.versions.saveSwitch'),
      })
    ).not.toBeInTheDocument()
    expect(
      within(dialog).getByRole('button', {
        name: i18n.t('creation.versions.switch'),
      })
    ).toBeVisible()
    expect(
      within(dialog).queryByText(i18n.t('creation.versions.saveSwitchHint'))
    ).not.toBeInTheDocument()
    expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
    expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  }
)

it.each(['.pnds-seats.json', 'debug.log', 'new.wav'])(
  'does not offer save-first for excluded untracked %s',
  async path => {
    vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
      status: 'ok',
      data: {
        state: 'available',
        head: 'b',
        branch: 'main',
        detail: null,
        changes: [
          {
            path,
            staged: false,
            unstaged: false,
            untracked: true,
            indexStatus: '?',
            diskStatus: '?',
          },
        ],
      },
    })
    vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
      status: 'ok',
      data: {
        ...savedVersion.preview,
        files: [
          {
            path,
            size: path.endsWith('.wav') ? 10485760 : 12,
            status: 'added',
            defaultSelected: false,
            exclusion: path.endsWith('.wav')
              ? 'largeMedia'
              : 'sensitiveOrGenerated',
            staged: false,
          },
        ],
      },
    })
    render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
    await pickStartingPoint()
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
    )
    const dialog = await screen.findByRole('dialog')
    expect(commands.previewCreationGitRecord).toHaveBeenCalledWith('page')
    expect(
      within(dialog).queryByRole('button', {
        name: i18n.t('creation.versions.saveSwitch'),
      })
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', {
        name: i18n.t('creation.versions.discardOption'),
      })
    ).not.toBeInTheDocument()
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: i18n.t('creation.versions.switch'),
      })
    )
    await waitFor(() =>
      expect(commands.confirmCreationGitSwitch).toHaveBeenCalledWith(
        'page',
        'switch'
      )
    )
    expect(commands.previewCreationGitRecord).toHaveBeenCalledTimes(1)
    expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  }
)

it('keeps save-first for a newly observed eligible untracked file and names the reason', async () => {
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      head: 'b',
      branch: 'main',
      detail: null,
      changes: [
        {
          path: 'new-score.js',
          staged: false,
          unstaged: false,
          untracked: true,
          indexStatus: '?',
          diskStatus: '?',
        },
      ],
    },
  })
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...savedVersion.preview,
      files: [
        {
          path: 'new-score.js',
          size: 32,
          status: 'added',
          defaultSelected: true,
          exclusion: null,
          staged: false,
        },
      ],
    },
  })
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.versions.saveSwitch'),
    })
  ).toBeVisible()
  expect(
    within(dialog).getByText(i18n.t('creation.versions.savedSwitchHint'))
  ).toBeVisible()
  expect(
    within(dialog).queryByText(i18n.t('creation.versions.saveSwitchHint'))
  ).not.toBeInTheDocument()
  expect(within(dialog).getByText('new-score.js')).toBeInTheDocument()
  expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
})

it.each([false, true])(
  'retains tracked and staged change protection (staged=%s)',
  async staged => {
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
            staged,
            unstaged: !staged,
            untracked: false,
            indexStatus: staged ? 'M' : ' ',
            diskStatus: staged ? ' ' : 'M',
          },
        ],
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
    expect(within(dialog).getByText('server.js')).toBeInTheDocument()
    expect(
      within(dialog).getByText(i18n.t('creation.versions.savedSwitchHint'))
    ).toBeVisible()
    expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  }
)

it('does not assume the tree is clean when refreshing switch status fails', async () => {
  const failed = vi.spyOn(notifications.flow, 'fail')
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  vi.mocked(commands.getCreationGitStatus).mockRejectedValueOnce(
    new Error('Disk unavailable')
  )
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  await waitFor(() =>
    expect(failed).toHaveBeenCalledWith(
      expect.any(String),
      i18n.t('creation.versions.feedback.failed'),
      'Disk unavailable',
      undefined
    )
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(
    within(await openOperationDetails()).getByText('Disk unavailable')
  ).toBeVisible()
})

it('does not treat an unreadable untracked-file preview as a clean project', async () => {
  const failed = vi.spyOn(notifications.flow, 'fail')
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      head: 'b',
      branch: 'main',
      detail: null,
      changes: [
        {
          path: 'new-score.js',
          staged: false,
          unstaged: false,
          untracked: true,
          indexStatus: '?',
          diskStatus: '?',
        },
      ],
    },
  })
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'Cannot inspect saved files' },
  })
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  await waitFor(() =>
    expect(failed).toHaveBeenCalledWith(
      expect.any(String),
      i18n.t('creation.versions.feedback.failed'),
      'Cannot inspect saved files',
      undefined
    )
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  expect(
    within(await openOperationDetails()).getByText('Cannot inspect saved files')
  ).toBeVisible()
})

it('does not open a late switch confirmation after its project was replaced', async () => {
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  const fresh =
    deferred<Awaited<ReturnType<typeof commands.getCreationGitStatus>>>()
  vi.mocked(commands.getCreationGitStatus).mockReturnValueOnce(fresh.promise)
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  act(() => useCreationStore.setState({ workspace: null }))
  await act(async () =>
    fresh.resolve({
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
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})

it.each(['resolved', 'excluded'] as const)(
  'does not offer restoration when the current version is clean after checking (%s)',
  async kind => {
    const changes = [
      {
        path: kind === 'excluded' ? 'debug.log' : 'server.js',
        staged: false,
        unstaged: kind === 'resolved',
        untracked: kind === 'excluded',
        indexStatus: kind === 'excluded' ? '?' : ' ',
        diskStatus: kind === 'excluded' ? '?' : 'M',
      },
    ]
    vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
      status: 'ok',
      data: {
        state: 'available',
        head: 'b',
        branch: 'main',
        changes,
        detail: null,
      },
    })
    render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
    fireEvent.click(
      await screen.findByRole('button', { name: /Larger numbers/ })
    )
    const restore = screen.getByRole('button', {
      name: i18n.t('creation.versions.restore'),
    })
    if (kind === 'resolved')
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
    else
      vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
        status: 'ok',
        data: {
          ...savedVersion.preview,
          files: [
            {
              path: 'debug.log',
              size: 4,
              status: 'added',
              defaultSelected: false,
              exclusion: 'sensitiveOrGenerated',
              staged: false,
            },
          ],
        },
      })
    fireEvent.click(restore)
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: i18n.t('creation.versions.alreadyCurrent'),
        })
      ).toBeDisabled()
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(commands.previewCreationGitSwitch).not.toHaveBeenCalled()
    expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
  }
)
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
  const warned = vi.spyOn(notifications.flow, 'warn')
  const success = vi.spyOn(notifications.flow, 'succeed')
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
    await waitFor(() =>
      expect(warned).toHaveBeenCalledWith(
        expect.any(String),
        i18n.t('creation.versions.feedback.switchedRefreshFailed'),
        i18n.t('creation.files.syncPending'),
        expect.objectContaining({ action: expect.any(Object) })
      )
    )
    const id = warned.mock.calls[0]?.[0]
    expect(commands.confirmCreationGitSwitch).toHaveBeenCalledTimes(1)
    fireEvent.click(retry)
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: i18n.t('creation.files.retrySync'),
        })
      ).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        id,
        i18n.t('creation.versions.switched'),
        undefined,
        undefined
      )
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

it('settles the save flow with its native warning and retains warning details without a permanent receipt', async () => {
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
  const success = vi.spyOn(notifications.flow, 'warn')
  try {
    render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
    await screen.findByRole('button', { name: /Larger numbers/ })
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('creation.version.saveCurrent'),
      })
    )
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        expect.any(String),
        i18n.t('creation.version.success'),
        'Index needs attention',
        undefined
      )
    )
    expect(
      screen.queryByText(i18n.t('creation.version.success'))
    ).not.toBeInTheDocument()
    const details = await openOperationDetails()
    expect(within(details).getByText('Index needs attention')).toBeVisible()
    fireEvent.click(within(details).getByRole('button', { name: 'Close' }))
    expect(
      screen.getByRole('button', { name: /Larger numbers/ })
    ).toHaveAttribute('aria-pressed', 'true')
  } finally {
    saved.mockRestore()
    success.mockRestore()
  }
})

it('keeps the save notification pending through a delayed write and history refresh without duplicate submission', async () => {
  const write = deferred<typeof savedVersion>()
  const refresh =
    deferred<Awaited<ReturnType<typeof commands.getCreationGitStatus>>>()
  const save = vi
    .spyOn(gitWorkflow, 'saveGitVersion')
    .mockReturnValue(write.promise)
  const progress = vi.spyOn(notifications.flow, 'step')
  const success = vi.spyOn(notifications.flow, 'succeed')
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await screen.findByRole('button', { name: /Larger numbers/ })
  const button = screen.getByRole('button', {
    name: i18n.t('creation.version.saveCurrent'),
  })
  fireEvent.click(button)
  const id = progress.mock.calls[0]?.[0]
  expect(progress).toHaveBeenCalledWith(
    id,
    i18n.t('creation.versions.progress.saving')
  )
  expect(button).toBeDisabled()
  fireEvent.click(button)
  expect(save).toHaveBeenCalledOnce()
  expect(success).not.toHaveBeenCalled()
  vi.mocked(commands.getCreationGitStatus).mockReturnValueOnce(refresh.promise)
  await act(async () => write.resolve(savedVersion))
  await waitFor(() =>
    expect(progress).toHaveBeenLastCalledWith(
      id,
      i18n.t('creation.versions.progress.refreshing')
    )
  )
  expect(success).not.toHaveBeenCalled()
  refresh.resolve({
    status: 'ok',
    data: {
      state: 'available',
      head: 'b',
      branch: 'main',
      changes: [],
      detail: null,
    },
  })
  await waitFor(() =>
    expect(success).toHaveBeenCalledWith(
      id,
      i18n.t('creation.version.success'),
      'Larger numbers',
      undefined
    )
  )
})

it('preserves a saved receipt when refresh fails and retries only history reads on the same notification', async () => {
  const save = vi
    .spyOn(gitWorkflow, 'saveGitVersion')
    .mockResolvedValue(savedVersion)
  const warned = vi.spyOn(notifications.flow, 'warn')
  const success = vi.spyOn(notifications.flow, 'succeed')
  const progress = vi.spyOn(notifications.flow, 'step')
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await screen.findByRole('button', { name: /Larger numbers/ })
  vi.mocked(commands.getCreationGitStatus).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'History unavailable' },
  })
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.version.saveCurrent') })
  )
  await waitFor(() => expect(warned).toHaveBeenCalled())
  const [id, title, , options] = warned.mock.calls[0] ?? []
  expect(title).toBe(i18n.t('creation.versions.feedback.savedRefreshFailed'))
  expect(success).not.toHaveBeenCalled()
  expect(warned.mock.calls[0]?.[2]).toContain('History unavailable')
  const details = await openOperationDetails()
  expect(within(details).getByRole('alert')).toHaveTextContent(
    'History unavailable'
  )
  fireEvent.click(within(details).getByRole('button', { name: 'Close' }))
  const action = options?.action
  if (!action || typeof action !== 'object' || !('onClick' in action))
    throw new Error('Expected a real refresh action')
  const event = {
    preventDefault: vi.fn(),
  } as unknown as MouseEvent<HTMLButtonElement>
  act(() => action.onClick(event))
  expect(event.preventDefault).toHaveBeenCalledOnce()
  await waitFor(() =>
    expect(success).toHaveBeenCalledWith(
      id,
      i18n.t('creation.version.success'),
      'Larger numbers',
      undefined
    )
  )
  expect(progress.mock.calls.every(call => call[0] === id)).toBe(true)
  expect(save).toHaveBeenCalledOnce()
  expect(commands.confirmCreationGitVersion).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})

it.each(['unmount', 'project change'] as const)(
  'dismisses pending Git feedback on %s and ignores a late save result',
  async reason => {
    const write = deferred<typeof savedVersion>()
    vi.spyOn(gitWorkflow, 'saveGitVersion').mockReturnValue(write.promise)
    const progress = vi.spyOn(notifications.flow, 'step')
    const dismissed = vi.spyOn(notifications.flow, 'dismiss')
    const success = vi.spyOn(notifications.flow, 'succeed')
    const warned = vi.spyOn(notifications.flow, 'warn')
    const view = render(
      <CreationGitPage identity="page" active onBusyChange={vi.fn()} />
    )
    await screen.findByRole('button', { name: /Larger numbers/ })
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('creation.version.saveCurrent'),
      })
    )
    const id = progress.mock.calls[0]?.[0]
    if (reason === 'unmount') view.unmount()
    else act(() => useCreationStore.setState({ workspace: null }))
    expect(dismissed).toHaveBeenCalledWith(id)
    await act(async () => write.resolve(savedVersion))
    expect(success).not.toHaveBeenCalled()
    expect(warned).not.toHaveBeenCalled()
  }
)

it('ends a failed save flow without claiming success and retains the local error', async () => {
  vi.spyOn(gitWorkflow, 'saveGitVersion').mockRejectedValue({
    code: 'io',
    detail: 'Disk is full',
  })
  const failed = vi.spyOn(notifications.flow, 'fail')
  const success = vi.spyOn(notifications.flow, 'succeed')
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await screen.findByRole('button', { name: /Larger numbers/ })
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.version.saveCurrent') })
  )
  await waitFor(() =>
    expect(failed).toHaveBeenCalledWith(
      expect.any(String),
      i18n.t('creation.versions.feedback.failed'),
      'Disk is full',
      undefined
    )
  )
  expect(
    within(await openOperationDetails()).getByRole('alert')
  ).toHaveTextContent('Disk is full')
  expect(success).not.toHaveBeenCalled()
})

it('shares one notification for save-then-switch and reports only the final outcome', async () => {
  vi.spyOn(gitWorkflow, 'saveGitVersion').mockResolvedValue(savedVersion)
  const switching =
    deferred<Awaited<ReturnType<typeof gitWorkflow.switchGitVersion>>>()
  const switchVersion = vi
    .spyOn(gitWorkflow, 'switchGitVersion')
    .mockReturnValue(switching.promise)
  const progress = vi.spyOn(notifications.flow, 'step')
  const success = vi.spyOn(notifications.flow, 'succeed')
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
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  const dialog = await screen.findByRole('dialog')
  // Preparing the confirmation is a separate read-only flow; the actual
  // save-and-switch transaction must still share one notification.
  progress.mockClear()
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.versions.saveSwitch'),
    })
  )
  await waitFor(() => expect(switchVersion).toHaveBeenCalled())
  const id = progress.mock.calls[0]?.[0]
  expect(success).not.toHaveBeenCalled()
  switching.resolve({ synchronized: true })
  await waitFor(() =>
    expect(success).toHaveBeenCalledWith(
      id,
      i18n.t('creation.versions.switched'),
      undefined,
      undefined
    )
  )
  expect(progress.mock.calls.every(call => call[0] === id)).toBe(true)
  expect(success).toHaveBeenCalledOnce()
})

it('retains the successful save when the following switch fails without claiming a rollback', async () => {
  const save = vi
    .spyOn(gitWorkflow, 'saveGitVersion')
    .mockResolvedValue(savedVersion)
  vi.spyOn(gitWorkflow, 'switchGitVersion').mockRejectedValue({
    code: 'io',
    detail: 'Checkout did not finish; inspect saved files',
  })
  vi.spyOn(
    useCreationFilesStore.getState(),
    'synchronizeSaved'
  ).mockResolvedValue(true)
  const warned = vi.spyOn(notifications.flow, 'warn')
  const failed = vi.spyOn(notifications.flow, 'fail')
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
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.switch') })
  )
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(
    within(dialog).getByRole('button', {
      name: i18n.t('creation.versions.saveSwitch'),
    })
  )
  await waitFor(() =>
    expect(warned).toHaveBeenCalledWith(
      expect.any(String),
      i18n.t('creation.versions.feedback.savedActionFailed'),
      'Checkout did not finish; inspect saved files',
      expect.objectContaining({ action: expect.any(Object) })
    )
  )
  expect(save).toHaveBeenCalledOnce()
  expect(failed).not.toHaveBeenCalled()
  expect(within(dialog).getByRole('alert')).toHaveTextContent(
    'Checkout did not finish'
  )
})

it('warns when a saved version name cannot be refreshed and retries only reads', async () => {
  const renamed =
    deferred<Awaited<ReturnType<typeof commands.renameCreationGitVersion>>>()
  vi.mocked(commands.renameCreationGitVersion).mockReturnValueOnce(
    renamed.promise
  )
  const warned = vi.spyOn(notifications.flow, 'warn')
  const success = vi.spyOn(notifications.flow, 'succeed')
  render(<CreationGitPage identity="page" active onBusyChange={vi.fn()} />)
  await pickStartingPoint()
  fireEvent.click(
    screen.getByRole('button', { name: i18n.t('creation.versions.rename') })
  )
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox'), {
    target: { value: 'Saved name' },
  })
  fireEvent.click(
    within(dialog).getByRole('button', { name: i18n.t('creation.save') })
  )
  expect(
    within(dialog).getByRole('button', { name: i18n.t('creation.save') })
  ).toBeDisabled()
  vi.mocked(commands.getCreationGitStatus).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'Cannot refresh names' },
  })
  renamed.resolve({ status: 'ok', data: 'Saved name' })
  await waitFor(() => expect(warned).toHaveBeenCalled())
  const [id, title, , options] = warned.mock.calls[0] ?? []
  expect(title).toBe(i18n.t('creation.versions.feedback.renamedRefreshFailed'))
  expect(success).not.toHaveBeenCalled()
  const action = options?.action
  if (!action || typeof action !== 'object' || !('onClick' in action))
    throw new Error('Expected a refresh action')
  const event = {
    preventDefault: vi.fn(),
  } as unknown as MouseEvent<HTMLButtonElement>
  act(() => action.onClick(event))
  await waitFor(() =>
    expect(success).toHaveBeenCalledWith(
      id,
      i18n.t('creation.versions.renamed'),
      'Saved name',
      undefined
    )
  )
  expect(event.preventDefault).toHaveBeenCalled()
  expect(commands.renameCreationGitVersion).toHaveBeenCalledOnce()
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
  const success = vi.spyOn(notifications.flow, 'succeed')
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
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        expect.any(String),
        i18n.t('creation.versions.renamed'),
        'Earlier experiment',
        undefined
      )
    )
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
