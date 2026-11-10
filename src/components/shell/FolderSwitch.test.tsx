import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  openFolderContextMenu,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { Sidebar } from './Sidebar'
import { HoverSidebarHarness as HoverSidebar } from '@/test/desktop-harness'

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
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

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await new Promise(resolve => setTimeout(resolve, 0))
})

const tab = (name: string) => screen.getByRole('tab', { name })
const tabStops = () =>
  screen.getAllByRole('tab').filter(item => item.tabIndex === 0)

function expectBrowseOnly() {
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.preflightProject).not.toHaveBeenCalled()
}

describe('manual performance folder stepper', () => {
  it('browses Home, user folders and Utilities without a separate tools or return control', async () => {
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)
    expect(
      screen.getByRole('tablist', { name: 'Performance folder' })
    ).toBeVisible()
    expect(
      screen.getAllByRole('tab').map(item => item.getAttribute('aria-label'))
    ).toEqual(['Home', 'Opening', 'Finale', 'Utilities'])
    const home = tab('Home')
    expect(home).toHaveAttribute('aria-selected', 'true')
    expect(tabStops()).toEqual([home])
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Utilities' })
    ).not.toBeInTheDocument()

    await user.click(tab('Opening'))
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    expect(screen.getByTestId('project-entry')).toHaveAttribute(
      'data-project-path',
      '/one'
    )
    await user.click(tab('Utilities'))
    expect(screen.getByTestId('project-entry')).toHaveAttribute(
      'data-project-path',
      '/tool'
    )
    await user.click(tab('Utilities'))
    expect(useProjectStore.getState().activeFolderId).toBe(UTILITIES_FOLDER_ID)
    expect(
      screen.queryByRole('button', { name: /Return to/ })
    ).not.toBeInTheDocument()
    await user.click(home)
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(tab('Home')).toBe(home)
    expectBrowseOnly()
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('keeps ordinary navigation keys idle and retains explicit Enter or Space activation', async () => {
    const user = userEvent.setup()
    const view = render(<Sidebar variant="static" />)
    tab('Home').focus()
    await user.keyboard('{ArrowRight}{ArrowLeft}{Home}{End}')
    expect(tab('Home')).toHaveFocus()
    expect(tabStops()).toEqual([tab('Home')])
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    view.rerender(<Sidebar variant="static" />)
    expect(tabStops()).toEqual([tab('Home')])
    tab('Opening').focus()
    await user.keyboard('{Enter}')
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    tab('Finale').focus()
    await user.keyboard(' ')
    expect(useProjectStore.getState().activeFolderId).toBe('b')
    expect(tabStops()).toEqual([tab('Finale')])
    expectBrowseOnly()
  })

  it('keeps ordinary horizontal keys idle under RTL as well', async () => {
    vi.spyOn(i18n, 'dir').mockReturnValue('rtl')
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)
    expect(screen.getByRole('tablist')).toHaveAttribute('dir', 'rtl')
    tab('Home').focus()
    await user.keyboard('{ArrowLeft}')
    expect(tab('Home')).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(tab('Home')).toHaveFocus()
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expectBrowseOnly()
  })

  it('lets Command arrows reach the window keyboard layer without changing selection locally', () => {
    const keydown = vi.fn()
    render(<Sidebar variant="static" />)
    window.addEventListener('keydown', keydown)
    try {
      const current = tab('Home')
      current.focus()
      fireEvent.keyDown(current, { key: 'ArrowRight' })
      expect(keydown).not.toHaveBeenCalled()
      fireEvent.keyDown(current, { key: 'ArrowRight', metaKey: true })
      expect(keydown).toHaveBeenCalledOnce()
      expect(keydown.mock.calls[0]?.[0].defaultPrevented).toBe(false)
      expect(useProjectStore.getState().activeFolderId).toBeNull()
      expectBrowseOnly()
    } finally {
      window.removeEventListener('keydown', keydown)
    }
  })

  it('keeps stable tabs and animates only the old and new selection, including external changes', async () => {
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)
    const home = tab('Home')
    const opening = tab('Opening')
    const finale = tab('Finale')
    expect(
      screen
        .getAllByRole('tab')
        .every(item => !item.hasAttribute('data-liquid'))
    ).toBe(true)
    await user.click(opening)
    expect(home).toHaveAttribute('data-liquid', 'exit')
    expect(opening).toHaveAttribute('data-liquid', 'enter')
    act(() => useProjectStore.getState().setActiveFolderId('b'))
    expect(tab('Home')).toBe(home)
    expect(tab('Finale')).toBe(finale)
    expect(home).not.toHaveAttribute('data-liquid')
    expect(opening).toHaveAttribute('data-liquid', 'exit')
    expect(finale).toHaveAttribute('data-liquid', 'enter')
    expect(finale).toHaveFocus()
    expect(tabStops()).toEqual([finale])
    act(() => useSettingsStore.setState({ nodeNameSetting: 'Updated Host' }))
    expect(tabStops()).toEqual([finale])
    await user.click(finale)
    expect(finale).toHaveAttribute('data-liquid', 'enter')
    expectBrowseOnly()
  })

  it('keeps every custom folder reachable and reveals an initially selected last tab without an entrance animation', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    useProjectStore.setState({
      projectFolders: Array.from({ length: 40 }, (_, index) => ({
        id: `folder-${index}`,
        name: `Set ${index}`,
        projectPaths: [],
      })),
      activeFolderId: 'folder-39',
    })
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)
    expect(screen.getAllByRole('tab')).toHaveLength(42)
    const selected = tab('Set 39')
    expect(selected).toHaveAttribute('aria-selected', 'true')
    expect(selected).not.toHaveAttribute('data-liquid')
    expect(scrollIntoView.mock.contexts).toContain(selected)
    await user.click(tab('Utilities'))
    expect(tab('Utilities')).toHaveFocus()
    expect(scrollIntoView.mock.contexts).toContain(tab('Utilities'))
    expect(useProjectStore.getState().activeFolderId).toBe(UTILITIES_FOLDER_ID)
  })

  it('does not steal outside focus when a shortcut changes the current folder', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Sidebar variant="static" />
        <button type="button">Score surface</button>
      </>
    )
    await user.click(tab('Opening'))
    const outside = screen.getByRole('button', { name: 'Score surface' })
    await user.click(outside)
    act(() => useProjectStore.getState().setActiveFolderId('b'))
    expect(outside).toHaveFocus()
    expect(tabStops()).toEqual([tab('Finale')])
    expectBrowseOnly()
  })

  it('opens management for the clicked inactive tab and restores its focus on Escape', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    const target = tab('Finale')
    const menu = await openFolderContextMenu(target)
    expect(within(menu).getByTestId('menu-rename-folder')).not.toHaveAttribute(
      'aria-disabled'
    )
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(target).toHaveFocus())
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    expect(tabStops()).toEqual([tab('Opening')])
  })

  it('keeps the hover sidebar visible while folder management owns its Portal', async () => {
    const user = userEvent.setup()
    useSessionStore.setState({ sessionStatus: 'ready' })
    render(
      <>
        <HoverSidebar />
        <button type="button">Score surface</button>
      </>
    )
    fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
    await openFolderContextMenu(tab('Finale'))
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-100')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Score surface' }))
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-0')
    )
  })

  it('creates and names a folder from a keyboard-opened management menu', async () => {
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)
    tab('Home').focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    const menu = await screen.findByTestId('folder-context-menu')
    fireEvent.click(within(menu).getByTestId('menu-new-folder'))
    const input = await screen.findByTestId('folder-name-input')
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, 'Encore{Enter}')
    expect(useProjectStore.getState().projectFolders).toHaveLength(4)
    expect(tab('Encore')).toHaveAttribute('aria-selected', 'true')
    expectBrowseOnly()
  })

  it('canceling creation removes its empty draft and retains the previous browse view', async () => {
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(tab('Opening'))
    fireEvent.click(within(menu).getByTestId('menu-new-folder'))
    const input = await screen.findByTestId('folder-name-input')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(useProjectStore.getState().projectFolders).toHaveLength(3)
    expect(useProjectStore.getState().activeFolderId).toBe('a')
  })

  it('renames an inactive target while preserving the selected folder and refusing duplicate names', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    let menu = await openFolderContextMenu(tab('Finale'))
    fireEvent.click(within(menu).getByTestId('menu-rename-folder'))
    let input = await screen.findByTestId('folder-name-input')
    await user.clear(input)
    await user.type(input, 'Encore{Enter}')
    expect(tab('Encore')).toHaveAttribute('aria-selected', 'false')
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    menu = await openFolderContextMenu(tab('Opening'))
    fireEvent.click(within(menu).getByTestId('menu-rename-folder'))
    input = await screen.findByTestId('folder-name-input')
    await user.clear(input)
    await user.type(input, 'Encore{Enter}')
    expect(tab('Opening')).toHaveAttribute('aria-selected', 'true')
  })

  it('deletion confirms and returns members to Home; cancel preserves them', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    let menu = await openFolderContextMenu(tab('Opening'))
    expect(
      within(menu).getByRole('menuitem', { name: 'Delete folder' })
    ).toHaveAccessibleDescription(
      i18n.t('sidebar.menu.deleteFolderDescription')
    )
    fireEvent.click(within(menu).getByTestId('menu-delete-folder'))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    menu = await openFolderContextMenu(tab('Opening'))
    fireEvent.click(within(menu).getByTestId('menu-delete-folder'))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(screen.getByTestId('project-entry')).toHaveAttribute(
      'data-project-path',
      '/one'
    )
  })

  it('reorders a managed inactive folder while Utilities remains last', async () => {
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(tab('Finale'))
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Move folder up' })
    )
    await waitFor(() =>
      expect(
        screen.getAllByRole('tab').map(item => item.getAttribute('aria-label'))
      ).toEqual(['Home', 'Finale', 'Opening', 'Utilities'])
    )
    expect(useProjectStore.getState().activeFolderId).toBeNull()
  })

  it('continues to protect Utilities from rename, deletion and export', async () => {
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(tab('Utilities'))
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
    expect(
      within(menu).getByRole('menuitem', { name: 'Rename folder' })
    ).toHaveAccessibleDescription(i18n.t('sidebar.utilitiesProtected'))
    expect(
      within(menu).getByRole('menuitem', { name: 'Export setlist folder…' })
    ).toHaveAccessibleDescription(
      i18n.t('sidebar.setlistExportProtectedReason')
    )
  })
})
