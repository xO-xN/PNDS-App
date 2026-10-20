import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { useAssistantStore } from '@/store/assistant-store'
import { CreationGitRestore } from './CreationGitRestore'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'restore',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useAssistantStore.setState({ phase: 'idle' })
  vi.mocked(commands.previewCreationGitRestore).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'reviewed',
      commit: 'old-version',
      paths: ['server.js', 'cover.png'],
    },
  })
  vi.mocked(commands.confirmCreationGitRestore).mockResolvedValue({
    status: 'ok',
    data: null,
  })
})
it('reviews all changed paths before returning to a version', async () => {
  const user = userEvent.setup()
  const restored = vi.fn()
  render(
    <CreationGitRestore
      identity="restore"
      commit="old-version"
      onRestored={restored}
    />
  )
  await user.click(
    screen.getByRole('button', { name: 'Return to this version' })
  )
  expect(await screen.findByText('cover.png')).toBeVisible()
  expect(commands.confirmCreationGitRestore).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Restore saved files' }))
  await waitFor(() => expect(restored).toHaveBeenCalledOnce())
  expect(commands.confirmCreationGitRestore).toHaveBeenCalledExactlyOnceWith(
    'restore',
    'reviewed'
  )
})
it('blocks runtime ownership and invalidates the review after disk changes', async () => {
  const user = userEvent.setup()
  useSessionStore.setState({ sessionStatus: 'ready' })
  render(
    <CreationGitRestore
      identity="restore"
      commit="old-version"
      onRestored={vi.fn()}
    />
  )
  expect(
    screen.getByRole('button', { name: 'Return to this version' })
  ).toBeDisabled()
  act(() => useSessionStore.setState({ sessionStatus: 'idle' }))
  await user.click(
    screen.getByRole('button', { name: 'Return to this version' })
  )
  await screen.findByRole('button', { name: 'Restore saved files' })
  act(() =>
    useCreationFilesStore.setState(state => ({ revision: state.revision + 1 }))
  )
  expect(
    screen.getByRole('button', { name: 'Restore saved files' })
  ).toBeDisabled()
  expect(commands.confirmCreationGitRestore).not.toHaveBeenCalled()
})

it('retries only file synchronization after Git restored files successfully', async () => {
  const user = userEvent.setup()
  const restored = vi.fn()
  render(
    <CreationGitRestore
      identity="restore"
      commit="old-version"
      onRestored={restored}
    />
  )
  await user.click(
    screen.getByRole('button', { name: 'Return to this version' })
  )
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'io', detail: 'watch unavailable after restore' },
  })
  await user.click(
    await screen.findByRole('button', { name: 'Restore saved files' })
  )
  expect(
    await screen.findByRole('button', { name: 'Retry file synchronization' })
  ).toBeEnabled()
  expect(restored).not.toHaveBeenCalled()
  expect(commands.confirmCreationGitRestore).toHaveBeenCalledOnce()
  await user.click(
    screen.getByRole('button', { name: 'Retry file synchronization' })
  )
  await waitFor(() => expect(restored).toHaveBeenCalledOnce())
  expect(commands.confirmCreationGitRestore).toHaveBeenCalledOnce()
  expect(
    screen.queryByRole('button', { name: 'Retry file synchronization' })
  ).not.toBeInTheDocument()
  expect(commands.undoCreationAssistantTask).not.toHaveBeenCalled()
})
