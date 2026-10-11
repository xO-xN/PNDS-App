import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  openFolderContextMenu,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { Sidebar } from './Sidebar'
import { HoverSidebar } from './HoverSidebar'

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().resetSession()
  useCreationStore.setState({ active: false, modePhase: 'idle' })
  useProjectStore.setState({
    currentProject: null,
    recentProjectPaths: ['/one', '/two', '/tool'],
    utilityPaths: ['/tool'],
    activeFolderId: null,
    lastUserFolderId: null,
    renameTarget: null,
    pendingPreflightPath: null,
    projectFolders: [
      { id: 'a', name: 'Opening', projectPaths: ['/one'] },
      { id: 'b', name: 'Finale', projectPaths: ['/two'] },
      { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: ['/tool'] },
    ],
  })
})

describe('performance folders (#153)', () => {
  it('selects user folders from a dropdown and toggles tools back to the previous view', async () => {
    render(<Sidebar variant="static" />)
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    expect(
      screen.queryByRole('option', { name: 'Utilities' })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Opening' }))
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    expect(screen.getByTestId('project-entry')).toHaveAttribute(
      'data-project-path',
      '/one'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    expect(
      screen.queryByRole('combobox', { name: 'Performance folder' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Return to Opening' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('project-entry')).toHaveAttribute(
      'data-project-path',
      '/tool'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })
  it('the return entry restores Home and recovers when its previous folder is deleted', async () => {
    render(<Sidebar variant="static" />)
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Return to Home' })
    )
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    act(() => useProjectStore.getState().setActiveFolderId('a'))
    await userEvent.click(screen.getByRole('button', { name: 'Utilities' }))
    act(() => useProjectStore.getState().deleteFolder('a'))
    await userEvent.click(
      screen.getByRole('button', { name: 'Return to Home' })
    )
    expect(useProjectStore.getState().activeFolderId).toBeNull()
  })

  it('keeps a dropdown open after the pointer leaves and hides after selection', async () => {
    render(<HoverSidebar />)
    fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-100')
    await userEvent.click(screen.getByRole('option', { name: 'Finale' }))
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-0')
    )
  })

  it('creates beyond the old limit through the dropdown and names the new folder', async () => {
    render(<Sidebar variant="static" />)
    await userEvent.click(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    await userEvent.click(screen.getByRole('option', { name: 'New folder' }))
    const input = await screen.findByTestId('folder-name-input')
    expect(input).toHaveFocus()
    await userEvent.clear(input)
    await userEvent.type(input, 'Encore{Enter}')
    expect(useProjectStore.getState().projectFolders).toHaveLength(4)
    expect(
      screen.getByRole('combobox', { name: 'Performance folder' })
    ).toHaveTextContent('Encore')
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('canceling folder creation removes the empty draft and retains the previous browse view', async () => {
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    fireEvent.click(within(menu).getByTestId('menu-new-folder'))
    const input = await screen.findByTestId('folder-name-input')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useProjectStore.getState().projectFolders).toHaveLength(3)
    expect(useProjectStore.getState().activeFolderId).toBe('a')
  })

  it('renames the current folder but refuses another folder’s name', async () => {
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    fireEvent.click(within(menu).getByTestId('menu-rename-folder'))
    const input = await screen.findByTestId('folder-name-input')
    await userEvent.clear(input)
    await userEvent.type(input, 'Finale{Enter}')
    expect(
      screen.getByRole('combobox', { name: 'Performance folder' })
    ).toHaveTextContent('Opening')
  })

  it('deletion confirms and returns members to Home; cancel preserves them', async () => {
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    let menu = await openFolderContextMenu(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    fireEvent.click(within(menu).getByTestId('menu-delete-folder'))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    menu = await openFolderContextMenu(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    fireEvent.click(within(menu).getByTestId('menu-delete-folder'))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(screen.getByTestId('project-entry')).toHaveAttribute(
      'data-project-path',
      '/one'
    )
  })

  it('reorders user folders through the menu while Utilities remains last', async () => {
    useProjectStore.getState().setActiveFolderId('b')
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Move folder up' })
    )
    await waitFor(() =>
      expect(useProjectStore.getState().projectFolders.map(f => f.id)).toEqual([
        'b',
        'a',
        UTILITIES_FOLDER_ID,
      ])
    )
  })

  it('the tools grouping continues to refuse rename, delete and export', async () => {
    useProjectStore.getState().setActiveFolderId(UTILITIES_FOLDER_ID)
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(
      screen.getByRole('button', { name: 'Return to Home' })
    )
    for (const id of [
      'menu-rename-folder',
      'menu-delete-folder',
      'menu-export-setlist',
    ]) {
      expect(within(menu).getByTestId(id)).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
  })
})
