import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { CreationGitLocation } from './CreationGitLocation'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'location',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      branch: 'main',
      head: 'current',
      detail: null,
      changes: [],
    },
  })
  vi.mocked(commands.getCreationGitVersions).mockResolvedValue({
    status: 'ok',
    data: {
      head: 'current',
      versions: [
        {
          id: 'current',
          message: 'Current version',
          author: 'Creator',
          parents: [],
          timestamp: 0,
          files: [],
        },
      ],
      branches: [
        { name: 'main', tip: 'current', message: 'Current version' },
        { name: 'experiment', tip: 'older', message: 'Another route' },
      ],
      nextOffset: null,
      limited: false,
    },
  })
})
it('shows branch and version and routes a named branch to the protected switching workflow', async () => {
  render(<CreationGitLocation identity="location" disabled={false} />)
  const trigger = screen.getByRole('button', {
    name: 'Current version and local branches',
  })
  await waitFor(() => expect(trigger).toHaveTextContent('mainCurrent version'))
  await userEvent.click(trigger)
  expect(
    screen.queryByRole('menuitem', { name: 'Save current version' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('menuitem', { name: 'main Current version' })
  ).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'experiment Another route' })
  )
  expect(useCreationReadingStore.getState()).toMatchObject({
    view: 'git',
    gitTarget: { branch: 'experiment', commit: 'older' },
  })
  expect(commands.confirmCreationGitSwitch).not.toHaveBeenCalled()
})
it('refreshes a historical location after a completed Git operation', async () => {
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      branch: null,
      head: 'current',
      detail: null,
      changes: [],
    },
  })
  render(<CreationGitLocation identity="location" disabled={false} />)
  const trigger = screen.getByRole('button', {
    name: 'Current version and local branches',
  })
  await waitFor(() => expect(trigger).toHaveTextContent('Historical position'))
  vi.mocked(commands.getCreationGitStatus).mockResolvedValue({
    status: 'ok',
    data: {
      state: 'available',
      branch: 'new-route',
      head: 'current',
      detail: null,
      changes: [],
    },
  })
  act(() => useCreationReadingStore.getState().gitChanged())
  await waitFor(() => expect(trigger).toHaveTextContent('new-route'))
})
