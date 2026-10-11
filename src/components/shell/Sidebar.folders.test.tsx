import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { Sidebar } from './Sidebar'

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().resetSession()
  useProjectStore.setState({
    currentProject: null,
    recentProjectPaths: ['/one', '/tool'],
    utilityPaths: ['/tool'],
    activeFolderId: null,
    lastUserFolderId: null,
    renameTarget: null,
    projectFolders: [
      { id: 'set', name: 'Set', projectPaths: ['/one'] },
      { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: ['/tool'] },
    ],
  })
})

describe('independent Utilities browser (#153)', () => {
  it('shows registered tool cards with no remove or drag affordance', async () => {
    render(<Sidebar variant="static" />)
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    const card = screen.getByTestId('project-entry')
    expect(card).toHaveAttribute('data-project-path', '/tool')
    expect(
      within(card).queryByRole('button', { name: /remove from history/i })
    ).not.toBeInTheDocument()
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 40, clientY: 80 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 120, clientY: 90 })
    expect(screen.queryByTestId('drag-clone')).not.toBeInTheDocument()
  })

  it('deleting a user grouping leaves the tools and their registry order intact', async () => {
    render(<Sidebar variant="static" />)
    act(() => useProjectStore.getState().deleteFolder('set'))
    expect(useProjectStore.getState().projectFolders).toEqual([
      { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: ['/tool'] },
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    expect(screen.getByTestId('project-entry')).toHaveAttribute(
      'data-project-path',
      '/tool'
    )
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: [
            {
              id: UTILITIES_FOLDER_ID,
              name: 'Utilities',
              projectPaths: ['/tool'],
            },
          ],
        })
      )
    )
  })

  it('removing a user project persists membership without removing tools', async () => {
    useProjectStore.getState().setActiveFolderId('set')
    render(<Sidebar variant="static" />)
    await userEvent.click(
      screen.getByRole('button', { name: /remove from history/i })
    )
    expect(useProjectStore.getState().recentProjectPaths).toEqual(['/tool'])
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual(
      []
    )
    expect(useProjectStore.getState().projectFolders[1]?.projectPaths).toEqual([
      '/tool',
    ])
  })
})
