import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { seedCreationDraft } from '@/test/creation-files'
import { creationProjectAction } from '@/test/desktop-actions'
import { CreationView } from './CreationView'

const workspace: CreationWorkspace = {
  project: {
    identity: 'git-score',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [{ path: 'server.js', size: 12, kind: 'text', category: 'system' }],
}
const report = {
  state: 'available' as const,
  branch: 'main',
  head: '1234567890123456789012345678901234567890',
  detail: null,
  changes: [
    {
      path: 'server.js',
      staged: true,
      unstaged: true,
      untracked: false,
      indexStatus: 'M',
      diskStatus: 'M',
    },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: null,
    modePhase: 'idle',
    opening: false,
    request: null,
    error: null,
  })
  useCreationFilesStore.getState().clear()
  useCreationStore.setState({ workspace })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
  })
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: report,
  })
})
it('reviews saved-disk Git differences through the project menu while retaining the draft and run', async () => {
  seedCreationDraft('server.js', 'disk text', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'unsaved draft')
  vi.mocked(commands.readCreationGitDiff).mockResolvedValueOnce({
    status: 'ok',
    data: { state: 'text', text: '-HEAD text\n+index text', detail: null },
  })
  render(<CreationView />)
  await creationProjectAction('Git status and differences')
  await screen.findByRole('dialog', { name: 'Git status and differences' })
  await screen.findByText('main')
  expect(screen.getByText('1 unsaved draft')).toBeInTheDocument()
  expect(screen.getByText(/Running content can predate/)).toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'server.js — Staged: HEAD → index' })
  )
  await screen.findByText('-HEAD text +index text', { exact: false })
  expect(commands.readCreationGitDiff).toHaveBeenCalledWith(
    'git-score',
    'server.js',
    'staged'
  )
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'unsaved draft'
  )
  expect(useSessionStore.getState().sessionStatus).toBe('ready')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(commands.getCreationGitStatus).toHaveBeenCalledWith('git-score')
  )
})

it('marks disk and external-tool snapshots stale, refreshes Git facts, and invalidates an older diff', async () => {
  let complete:
    | ((
        result: Awaited<ReturnType<typeof commands.readCreationGitDiff>>
      ) => void)
    | undefined
  vi.mocked(commands.readCreationGitDiff).mockReturnValueOnce(
    new Promise(resolve => {
      complete = resolve
    })
  )
  render(<CreationView />)
  await creationProjectAction('Git status and differences')
  await screen.findByText('main')
  fireEvent.click(
    screen.getByRole('button', { name: 'server.js — Unstaged: index → disk' })
  )
  act(() => useCreationFilesStore.getState().changed(['server.js']))
  expect(
    screen.getByText(/This snapshot may be out of date/)
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'server.js — Staged: HEAD → index' })
  ).toBeDisabled()
  vi.mocked(commands.getCreationGitStatus).mockResolvedValueOnce({
    status: 'ok',
    data: { ...report, branch: 'new-branch', changes: [] },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Git' }))
  await screen.findByText('new-branch')
  await act(async () =>
    complete?.({
      status: 'ok',
      data: { state: 'text', text: 'old difference', detail: null },
    })
  )
  expect(screen.queryByText('old difference')).not.toBeInTheDocument()
  expect(
    screen.queryByText(/This snapshot may be out of date/)
  ).not.toBeInTheDocument()
  fireEvent(window, new Event('focus'))
  expect(
    screen.getByText(/This snapshot may be out of date/)
  ).toBeInTheDocument()
})

it('ignores late status responses when the user opens another project', async () => {
  let complete:
    | ((
        result: Awaited<ReturnType<typeof commands.getCreationGitStatus>>
      ) => void)
    | undefined
  vi.mocked(commands.getCreationGitStatus).mockReturnValueOnce(
    new Promise(resolve => {
      complete = resolve
    })
  )
  render(<CreationView />)
  await creationProjectAction('Git status and differences')
  await screen.findByText('Reading Git status…')
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'next', root: '/next' },
      },
    })
  )
  await act(async () =>
    complete?.({ status: 'ok', data: { ...report, branch: 'old-project' } })
  )
  expect(
    screen.queryByRole('dialog', { name: 'Git status and differences' })
  ).not.toBeInTheDocument()
  await creationProjectAction('Git status and differences')
  await screen.findByText('main')
  expect(screen.queryByText('old-project')).not.toBeInTheDocument()
  expect(commands.getCreationGitStatus).toHaveBeenLastCalledWith('next')
})

it('explains missing Git and binary files without disabling the editor', async () => {
  vi.mocked(commands.getCreationGitStatus).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...report,
      state: 'gitUnavailable',
      branch: null,
      head: null,
      changes: [],
    },
  })
  render(<CreationView />)
  await creationProjectAction('Git status and differences')
  await screen.findByText(
    'Git is unavailable. You can continue creating without Git.'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'server.js' })).toBeEnabled()
  await creationProjectAction('Git status and differences')
  await screen.findByText('main')
  vi.mocked(commands.readCreationGitDiff).mockResolvedValueOnce({
    status: 'ok',
    data: { state: 'binary', text: null, detail: null },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'server.js — Unstaged: index → disk' })
  )
  await screen.findByText('Binary file: no text difference is available.')
})

it('discards a pending old-project difference after a successful workspace change', async () => {
  let complete:
    | ((
        result: Awaited<ReturnType<typeof commands.readCreationGitDiff>>
      ) => void)
    | undefined
  vi.mocked(commands.readCreationGitDiff).mockReturnValueOnce(
    new Promise(resolve => {
      complete = resolve
    })
  )
  render(<CreationView />)
  await creationProjectAction('Git status and differences')
  await screen.findByText('main')
  fireEvent.click(
    screen.getByRole('button', { name: 'server.js — Unstaged: index → disk' })
  )
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'next', root: '/next' },
      },
    })
  )
  await creationProjectAction('Git status and differences')
  await screen.findByText('main')
  await act(async () =>
    complete?.({
      status: 'ok',
      data: { state: 'text', text: 'old-project text', detail: null },
    })
  )
  expect(screen.queryByText('old-project text')).not.toBeInTheDocument()
  expect(commands.getCreationGitStatus).toHaveBeenLastCalledWith('next')
})
