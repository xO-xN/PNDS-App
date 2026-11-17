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
import { notifications } from '@/lib/notifications'
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

function mockFolderMenuLayout(viewportHeight: number, selectorTop: number) {
  const naturalMenuHeight = 360
  const menuWidth = 260
  const isMenu = (element: HTMLElement) =>
    element.matches('[data-testid="folder-context-menu"]') ||
    element.hasAttribute('data-radix-popper-content-wrapper')
  const menuHeight = (element: HTMLElement) => {
    const wrapper = element.hasAttribute('data-radix-popper-content-wrapper')
      ? element
      : element.parentElement
    const availableHeight = Number.parseFloat(
      wrapper?.style.getPropertyValue('--radix-popper-available-height') ?? ''
    )
    // jsdom supplies no CSS layout: apply the existing available-height cap
    // while letting the actual Radix/Floating UI middleware compute placement.
    return Number.isFinite(availableHeight)
      ? Math.min(naturalMenuHeight, availableHeight)
      : naturalMenuHeight
  }
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewportHeight)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this === document.documentElement ? viewportHeight : 0
    }
  )
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this === document.documentElement ? 1280 : 0
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function (this: HTMLElement) {
      return isMenu(this) ? menuHeight(this) : 0
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return isMenu(this) ? menuWidth : 0
    }
  )
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (this.classList.contains('folder-stepper-viewport'))
        return new DOMRect(100, selectorTop, 100, 28)
      if (isMenu(this)) return new DOMRect(0, 0, menuWidth, menuHeight(this))
      if (this === document.documentElement)
        return new DOMRect(0, 0, 1280, viewportHeight)
      return originalRect.call(this)
    }
  )
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
    expect(
      within(menu).queryByTestId('menu-rename-folder')
    ).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Rename folder' })
    ).not.toBeInTheDocument()
    expect(within(menu).getByTestId('menu-export-setlist')).not.toHaveAttribute(
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

  it.each(['static', 'overlay'] as const)(
    'renames the current folder in its %s heading on double-click',
    async variant => {
      const user = userEvent.setup()
      useProjectStore.getState().setActiveFolderId('a')
      render(<Sidebar variant={variant} />)
      const heading = screen.getByRole('heading', { name: 'Opening' })
      await user.dblClick(
        within(heading).getByRole('button', { name: 'Opening' })
      )
      const input = screen.getByTestId('folder-name-input')
      expect(input).toHaveFocus()
      expect(input).toHaveValue('Opening')
      expect(input).toHaveProperty('selectionStart', 0)
      expect(input).toHaveProperty('selectionEnd', 'Opening'.length)
      expect(heading).toContainElement(input)
      expect(
        screen.getByTestId('sidebar-browser-controls')
      ).not.toContainElement(input)
      expect(screen.getByRole('tablist')).toBeVisible()
      await user.clear(input)
      await user.type(input, 'Encore{Enter}')
      expect(screen.queryByTestId('folder-name-input')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Encore' })).toBeVisible()
      expect(tab('Encore')).toHaveAttribute('aria-selected', 'true')
      expect(useProjectStore.getState().activeFolderId).toBe('a')
      expect(useProjectStore.getState().renameTarget).toBeNull()
      await waitFor(() =>
        expect(commands.savePreferences).toHaveBeenCalledWith(
          expect.objectContaining({
            projectFolders: expect.arrayContaining([
              expect.objectContaining({ id: 'a', name: 'Encore' }),
            ]),
          })
        )
      )
      expectBrowseOnly()
    }
  )

  it('commits a folder heading rename on blur without changing the browse view', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().setActiveFolderId('a')
    render(
      <>
        <Sidebar variant="static" />
        <button type="button">Score surface</button>
      </>
    )
    await user.dblClick(screen.getByRole('button', { name: 'Opening' }))
    const input = screen.getByTestId('folder-name-input')
    await user.clear(input)
    await user.type(input, '  Encore  ')
    const outside = screen.getByRole('button', { name: 'Score surface' })
    await user.click(outside)
    expect(screen.getByRole('heading', { name: 'Encore' })).toBeVisible()
    expect(tab('Encore')).toHaveAttribute('aria-selected', 'true')
    expect(outside).toHaveFocus()
    expect(useProjectStore.getState().activeFolderId).toBe('a')
    expectBrowseOnly()
  })

  it('cancels a folder heading rename with Escape', async () => {
    const user = userEvent.setup()
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    await user.dblClick(screen.getByRole('button', { name: 'Opening' }))
    const input = screen.getByTestId('folder-name-input')
    await user.clear(input)
    await user.type(input, 'Encore{Escape}')
    expect(screen.queryByTestId('folder-name-input')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Opening' })).toBeVisible()
    expect(tab('Opening')).toHaveAttribute('aria-selected', 'true')
    expect(useProjectStore.getState().renameTarget).toBeNull()
    expect(commands.savePreferences).not.toHaveBeenCalled()
    expectBrowseOnly()
  })

  it('refuses duplicate or empty names when renaming the folder heading', async () => {
    const warning = vi.spyOn(notifications, 'warning')
    const user = userEvent.setup()
    useProjectStore.getState().setActiveFolderId('a')
    render(<Sidebar variant="static" />)
    await user.dblClick(screen.getByRole('button', { name: 'Opening' }))
    let input = screen.getByTestId('folder-name-input')
    await user.clear(input)
    await user.type(input, 'Finale{Enter}')
    expect(screen.getByRole('heading', { name: 'Opening' })).toBeVisible()
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      i18n.t('sidebar.folderNameTaken', { name: 'Finale' })
    )
    await user.dblClick(screen.getByRole('button', { name: 'Opening' }))
    input = screen.getByTestId('folder-name-input')
    await user.clear(input)
    await user.type(input, '  {Enter}')
    expect(screen.getByRole('heading', { name: 'Opening' })).toBeVisible()
    expect(tab('Opening')).toHaveAttribute('aria-selected', 'true')
    expect(useProjectStore.getState().renameTarget).toBeNull()
    expect(commands.savePreferences).not.toHaveBeenCalled()
    expectBrowseOnly()
  })

  it.each([
    { folderId: null, name: 'Home', status: 'idle' as const },
    {
      folderId: UTILITIES_FOLDER_ID,
      name: 'Utilities',
      status: 'idle' as const,
    },
    { folderId: 'a', name: 'Opening', status: 'ready' as const },
    { folderId: 'a', name: 'Opening', status: 'stopping' as const },
  ])(
    'keeps $name read-only while $status',
    async ({ folderId, name, status }) => {
      const user = userEvent.setup()
      useProjectStore.setState({ activeFolderId: folderId })
      useSessionStore.setState({ sessionStatus: status })
      render(<Sidebar variant="static" />)
      const heading = screen.getByRole('heading', { name })
      await user.dblClick(within(heading).queryByRole('button') ?? heading)
      expect(screen.queryByTestId('folder-name-input')).not.toBeInTheDocument()
      expect(useProjectStore.getState().renameTarget).toBeNull()
      expect(useProjectStore.getState().activeFolderId).toBe(folderId)
      expect(commands.savePreferences).not.toHaveBeenCalled()
      expectBrowseOnly()
    }
  )

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

  it.each([
    { direction: 'ltr' as const, folder: 'Finale', move: 'left' },
    { direction: 'ltr' as const, folder: 'Opening', move: 'right' },
    { direction: 'rtl' as const, folder: 'Opening', move: 'left' },
    { direction: 'rtl' as const, folder: 'Finale', move: 'right' },
  ])(
    'moves $folder physically $move in $direction without switching views',
    async ({ direction, folder, move }) => {
      vi.spyOn(i18n, 'dir').mockReturnValue(direction)
      render(<Sidebar variant="static" />)
      const menu = await openFolderContextMenu(tab(folder))
      const action = within(menu).getByRole('menuitem', {
        name: `Move folder ${move}`,
      })
      expect(action.querySelector(`.lucide-arrow-${move}`)).toBeInTheDocument()
      expect(
        within(menu).queryByRole('menuitem', { name: /Move folder (up|down)/ })
      ).not.toBeInTheDocument()
      fireEvent.click(action)
      await waitFor(() =>
        expect(
          screen
            .getAllByRole('tab')
            .map(item => item.getAttribute('aria-label'))
        ).toEqual(['Home', 'Finale', 'Opening', 'Utilities'])
      )
      expect(useProjectStore.getState().activeFolderId).toBeNull()
      expectBrowseOnly()
    }
  )

  it.each(['ltr', 'rtl'] as const)(
    'disables physical left and right movement at the %s boundaries',
    async direction => {
      vi.spyOn(i18n, 'dir').mockReturnValue(direction)
      const user = userEvent.setup()
      render(<Sidebar variant="static" />)
      const firstBoundary = direction === 'ltr' ? 'left' : 'right'
      const lastBoundary = direction === 'ltr' ? 'right' : 'left'
      let menu = await openFolderContextMenu(tab('Opening'))
      expect(
        within(menu).getByRole('menuitem', {
          name: `Move folder ${firstBoundary}`,
        })
      ).toHaveAttribute('aria-disabled', 'true')
      expect(
        within(menu).getByRole('menuitem', {
          name: `Move folder ${lastBoundary}`,
        })
      ).not.toHaveAttribute('aria-disabled')
      await user.keyboard('{Escape}')
      menu = await openFolderContextMenu(tab('Finale'))
      expect(
        within(menu).getByRole('menuitem', {
          name: `Move folder ${lastBoundary}`,
        })
      ).toHaveAttribute('aria-disabled', 'true')
      expect(
        within(menu).getByRole('menuitem', {
          name: `Move folder ${firstBoundary}`,
        })
      ).not.toHaveAttribute('aria-disabled')
      expectBrowseOnly()
    }
  )

  it.each([
    { viewportHeight: 720, selectorTop: 620 },
    { viewportHeight: 300, selectorTop: 200 },
  ])(
    'keeps the actual menu above the bottom selector in a $viewportHeight px viewport',
    async ({ viewportHeight, selectorTop }) => {
      mockFolderMenuLayout(viewportHeight, selectorTop)
      render(<Sidebar variant="static" />)
      fireEvent.contextMenu(tab('Finale'), {
        clientX: 150,
        clientY: selectorTop + 14,
      })
      const menu = await screen.findByTestId('folder-context-menu')
      const wrapper = menu.closest<HTMLElement>(
        '[data-radix-popper-content-wrapper]'
      )
      if (!wrapper) throw new Error('Expected a positioned Radix menu wrapper')
      await waitFor(() => {
        const position = wrapper.style.transform.match(
          /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/
        )
        expect(position).not.toBeNull()
        const top = Number(position?.[2])
        expect(top).toBeGreaterThanOrEqual(8)
        expect(top + menu.offsetHeight).toBeLessThanOrEqual(selectorTop - 8)
      })
      const availableHeight = Number.parseFloat(
        wrapper.style.getPropertyValue('--radix-popper-available-height')
      )
      expect(availableHeight).toBeGreaterThan(0)
      if (viewportHeight === 300) {
        expect(availableHeight).toBeLessThan(360)
        expect(menu.offsetHeight).toBe(availableHeight)
      }
      expect(within(menu).getByTestId('menu-delete-folder')).toBeInTheDocument()
      expectBrowseOnly()
    }
  )

  it('continues to protect Utilities from rename, deletion and export', async () => {
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(tab('Utilities'))
    for (const id of ['menu-delete-folder', 'menu-export-setlist']) {
      expect(within(menu).getByTestId(id)).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    }
    expect(
      within(menu).queryByTestId('menu-rename-folder')
    ).not.toBeInTheDocument()
    expect(within(menu).queryByText('Folder order')).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', { name: /Move folder (left|right)/ })
    ).not.toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Export setlist folder…' })
    ).toHaveAccessibleDescription(
      i18n.t('sidebar.setlistExportProtectedReason')
    )
  })
})
