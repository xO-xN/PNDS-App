import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  createFolderOrFail,
  mockOffsets,
  mockBoundingClientRect,
  openFolderContextMenu,
} from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

const FIRST_PATH = '/Users/test/Inarticulate III'
const SECOND_PATH = '/Users/test/PNDS Score 1'

/** Seeds one custom folder plus the pinned Utilities segment. */
function seedFolders() {
  const gigId = createFolderOrFail('Gig')
  useProjectStore.setState({
    projectFolders: [
      { id: gigId, name: 'Gig', projectPaths: [] },
      {
        id: UTILITIES_FOLDER_ID,
        name: 'Utilities',
        projectPaths: [],
      },
    ],
  })
  return gigId
}

/**
 * v1.2.2 (issue #28): the folder switch grows up — a sliding pill under
 * the active segment, a right-click menu owning folder management (the
 * inline "+" and the hover ✕ are gone), and real tab semantics (role,
 * aria-selected, roving tabindex, ←/→ view switching).
 */
describe('Sidebar folder switch (v1.2.2, issue #28)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [FIRST_PATH, SECOND_PATH],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      renameTarget: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  describe('inline affordances are gone', () => {
    it('renders no new-folder "+" and no hover ✕ on the segments', () => {
      seedFolders()
      render(<Sidebar variant="static" />)

      expect(screen.queryByTestId('new-folder-button')).not.toBeInTheDocument()
      for (const segment of screen.getAllByTestId('folder-segment')) {
        expect(within(segment).queryByRole('button')).not.toBeInTheDocument()
      }
      // The import "+" stays (its move to the list end is ticket #29).
      expect(screen.getByTestId('add-project-button')).toBeInTheDocument()
    })

    it('the track carries the native right-click hint tooltip', () => {
      seedFolders()
      render(<Sidebar variant="static" />)

      const tablist = screen.getByRole('tablist')
      expect(tablist).toHaveAttribute('title', 'Right-click to manage folders')
    })
  })

  describe('tab semantics and ←/→ switching', () => {
    it('segments are tabs with a roving tabindex on the active view', () => {
      const gigId = seedFolders()
      render(<Sidebar variant="static" />)

      const unfiled = screen.getByTestId('unfiled-segment')
      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')
      expect(unfiled).toHaveAttribute('role', 'tab')
      expect(unfiled).toHaveAttribute('aria-selected', 'true')
      expect(unfiled).toHaveAttribute('tabIndex', '0')
      for (const segment of screen.getAllByTestId('folder-segment')) {
        expect(segment).toHaveAttribute('role', 'tab')
        expect(segment).toHaveAttribute('aria-selected', 'false')
        expect(segment).toHaveAttribute('tabIndex', '-1')
      }

      fireEvent.click(gig)
      expect(useProjectStore.getState().activeFolderId).toBe(gigId)
      expect(unfiled).toHaveAttribute('aria-selected', 'false')
      expect(unfiled).toHaveAttribute('tabIndex', '-1')
      expect(gig).toHaveAttribute('aria-selected', 'true')
      expect(gig).toHaveAttribute('tabIndex', '0')
    })

    it('→ walks unfiled → folders → Utilities → wraps to unfiled, focus follows', () => {
      const gigId = seedFolders()
      render(<Sidebar variant="static" />)

      const unfiled = screen.getByTestId('unfiled-segment')
      const [gig, utilities] = screen.getAllByTestId('folder-segment')
      if (!gig || !utilities) throw new Error('Expected both segments')
      unfiled.focus()

      fireEvent.keyDown(unfiled, { key: 'ArrowRight' })
      expect(useProjectStore.getState().activeFolderId).toBe(gigId)
      expect(document.activeElement).toBe(gig)

      fireEvent.keyDown(gig, { key: 'ArrowRight' })
      expect(useProjectStore.getState().activeFolderId).toBe(
        UTILITIES_FOLDER_ID
      )
      expect(document.activeElement).toBe(utilities)

      // The row wraps: past Utilities lands back on the unfiled view.
      fireEvent.keyDown(utilities, { key: 'ArrowRight' })
      expect(useProjectStore.getState().activeFolderId).toBeNull()
      expect(document.activeElement).toBe(unfiled)

      // And ← from unfiled wraps around to Utilities.
      fireEvent.keyDown(unfiled, { key: 'ArrowLeft' })
      expect(useProjectStore.getState().activeFolderId).toBe(
        UTILITIES_FOLDER_ID
      )
    })

    it('arrow keys inside the inline rename do not switch views', async () => {
      seedFolders()
      render(<Sidebar variant="static" />)

      // Enter creation through the menu, then move the caret with arrows.
      const menu = await openFolderContextMenu(
        screen.getByTestId('unfiled-segment')
      )
      fireEvent.click(within(menu).getByTestId('menu-new-folder'))
      // The edit opens a macrotask after the menu closes (FocusScope).
      const input = await screen.findByTestId('folder-name-input')
      fireEvent.keyDown(input, { key: 'ArrowLeft' })
      expect(useProjectStore.getState().activeFolderId).toBeNull()
      expect(input).toBeInTheDocument()
    })
  })

  describe('sliding pill', () => {
    it('positions itself from the active segment offsets and follows switches', async () => {
      seedFolders()
      render(<Sidebar variant="static" />)

      // Pin the segment boxes jsdom cannot lay out; each commit re-measures
      // in its layout effect, so a real view switch moves the pill.
      mockOffsets(screen.getByTestId('unfiled-segment'), {
        left: 2,
        width: 100,
      })
      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')
      mockOffsets(gig, { left: 104, width: 80 })

      fireEvent.click(gig)
      await waitFor(() => {
        expect(screen.getByTestId('folder-pill').style.transform).toBe(
          'translateX(104px)'
        )
        expect(screen.getByTestId('folder-pill').style.width).toBe('80px')
      })

      fireEvent.click(screen.getByTestId('unfiled-segment'))
      await waitFor(() => {
        expect(screen.getByTestId('folder-pill').style.transform).toBe(
          'translateX(2px)'
        )
        expect(screen.getByTestId('folder-pill').style.width).toBe('100px')
      })
    })

    it('fades out while a folder drag is live and fades back in after the drop', async () => {
      const gigId = seedFolders()
      render(<Sidebar variant="static" />)

      // Two segments pitch 74px: x 100..174, y 200..232 (axis-swapped
      // row hit space), same pinning as the folder-drag tests.
      const [gig, utilities] = screen.getAllByTestId('folder-segment')
      if (!gig || !utilities) throw new Error('Expected both segments')
      mockBoundingClientRect(gig, {
        top: 200,
        left: 100,
        width: 74,
        height: 32,
      })
      mockBoundingClientRect(utilities, {
        top: 200,
        left: 174,
        width: 74,
        height: 32,
      })

      expect(screen.getByTestId('folder-pill').className).toContain(
        'opacity-100'
      )

      fireEvent.pointerDown(gig, { pointerId: 1, clientX: 120, clientY: 216 })
      fireEvent.pointerMove(window, {
        pointerId: 1,
        clientX: 140,
        clientY: 220,
      })
      await waitFor(() =>
        expect(screen.getByTestId('drag-clone')).toBeInTheDocument()
      )
      expect(screen.getByTestId('folder-pill').className).toContain('opacity-0')

      // Drop past the Utilities midpoint reorders (the store re-pins
      // Utilities last); after the snap frame the pill is visible again.
      fireEvent.pointerMove(window, {
        pointerId: 1,
        clientX: 220,
        clientY: 216,
      })
      fireEvent.pointerUp(window, { pointerId: 1 })
      await waitFor(
        () =>
          expect(screen.getByTestId('folder-pill').className).toContain(
            'opacity-100'
          ),
        { timeout: 3000 }
      )
      expect(useProjectStore.getState().projectFolders.map(f => f.id)).toEqual([
        gigId,
        UTILITIES_FOLDER_ID,
      ])
    })
  })

  describe('context menu', () => {
    it('track / unfiled offers only folder creation', async () => {
      render(<Sidebar variant="static" />)
      const menu = await openFolderContextMenu(
        screen.getByTestId('unfiled-segment')
      )
      expect(within(menu).getByTestId('menu-new-folder')).toBeEnabled()
      expect(
        within(menu).queryByTestId('menu-rename-folder')
      ).not.toBeInTheDocument()
      expect(
        within(menu).queryByTestId('menu-delete-folder')
      ).not.toBeInTheDocument()
    })

    it('a folder segment offers new / rename / delete', async () => {
      seedFolders()
      render(<Sidebar variant="static" />)

      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')
      const menu = await openFolderContextMenu(gig)

      expect(within(menu).getByTestId('menu-new-folder')).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(
        within(menu).getByTestId('menu-rename-folder')
      ).not.toHaveAttribute('aria-disabled', 'true')
      expect(
        within(menu).getByTestId('menu-delete-folder')
      ).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('create enters the same inline naming as before', async () => {
      render(<Sidebar variant="static" />)
      const menu = await openFolderContextMenu(
        screen.getByTestId('unfiled-segment')
      )
      fireEvent.click(within(menu).getByTestId('menu-new-folder'))

      const input = await screen.findByTestId('folder-name-input')
      expect(input).toHaveValue('New Folder')
      expect(input).toHaveFocus()
      fireEvent.change(input, { target: { value: 'Gig Friday' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(screen.getByTestId('folder-name')).toHaveTextContent('Gig Friday')
    })

    it('rename enters the ⌘R InlineNameInput on the right-clicked folder', async () => {
      seedFolders()
      render(<Sidebar variant="static" />)

      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')
      const menu = await openFolderContextMenu(gig)
      fireEvent.click(within(menu).getByTestId('menu-rename-folder'))

      const input = await screen.findByTestId('folder-name-input')
      expect(input).toHaveValue('Gig')
      expect(useProjectStore.getState().renameTarget).toEqual({
        kind: 'folder',
        id: useProjectStore.getState().projectFolders[0]?.id,
      })
    })

    it('delete opens the existing confirmation dialog', async () => {
      seedFolders()
      render(<Sidebar variant="static" />)

      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')
      const menu = await openFolderContextMenu(gig)
      fireEvent.click(within(menu).getByTestId('menu-delete-folder'))

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent(/Gig/)
      expect(useProjectStore.getState().projectFolders).toHaveLength(2)
    })

    it('disables the Utilities rename and delete with the reason', async () => {
      seedFolders()
      render(<Sidebar variant="static" />)

      const [, utilities] = screen.getAllByTestId('folder-segment')
      if (!utilities) throw new Error('Expected the Utilities segment')
      const menu = await openFolderContextMenu(utilities)

      const rename = within(menu).getByTestId('menu-rename-folder')
      const del = within(menu).getByTestId('menu-delete-folder')
      expect(rename).toHaveAttribute('aria-disabled', 'true')
      expect(del).toHaveAttribute('aria-disabled', 'true')
      expect(menu).toHaveTextContent(/Utilities is protected/)
      // Clicking a disabled item is a no-op — Radix blocks the select.
      expect(useProjectStore.getState().renameTarget).toBeNull()
    })

    it('disables creation at the folder cap (Utilities counts) with the reason', async () => {
      useProjectStore.setState({
        projectFolders: [
          { id: 'f1', name: 'One', projectPaths: [] },
          { id: 'f2', name: 'Two', projectPaths: [] },
          { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
        ],
      })
      render(<Sidebar variant="static" />)

      const menu = await openFolderContextMenu(
        screen.getByTestId('unfiled-segment')
      )
      const create = within(menu).getByTestId('menu-new-folder')
      expect(create).toHaveAttribute('aria-disabled', 'true')
      expect(menu).toHaveTextContent(/Folder limit reached \(3/)
      expect(screen.queryByTestId('folder-name-input')).not.toBeInTheDocument()
    })

    it('reports open state so the hover sidebar must not retract', async () => {
      const onPopupOpenChange = vi.fn()
      seedFolders()
      render(<Sidebar variant="static" onPopupOpenChange={onPopupOpenChange} />)

      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')
      await openFolderContextMenu(gig)
      expect(onPopupOpenChange).toHaveBeenCalledWith(true)

      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(onPopupOpenChange).toHaveBeenCalledWith(false))
    })
  })
})
