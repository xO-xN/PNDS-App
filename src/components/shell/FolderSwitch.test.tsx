import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  createFolderOrFail,
  openFolderContextMenu,
  mockOffsets,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { exportSetlistFolder } from '@/lib/setlist-export'
import { notifications } from '@/lib/notifications'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { FolderSwitch } from './FolderSwitch'
import type { CardDragController } from '@/hooks/use-card-drag'
import type { DragSource } from './sidebar-drag-adapter'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/setlist-export', () => ({
  exportSetlistFolder: vi.fn().mockResolvedValue(undefined),
}))

const PROJECT_PATH = '/Users/test/Inarticulate III'
const OTHER_PATH = '/Users/test/PNDS Score 1'
const THIRD_PATH = '/Users/test/Another Score'

/** The drag machine's idle shape — the sidebar hands FolderSwitch its
 * controller; at rest every field is inert (drag-behavior coverage lives
 * with the whole sidebar, where the machine is real). */
function idleDragController(): CardDragController<DragSource> {
  return {
    drag: null,
    dropTarget: null,
    ghost: null,
    suppressTransition: false,
    cloneRef: { current: null },
    press: () => undefined,
    consumeClick: () => false,
    clearClickSuppression: () => undefined,
  }
}

/**
 * The folder switch as its own component (extracted from the sidebar):
 * the segment row's tab semantics and view switching, the context-menu
 * CRUD (create / rename / delete with the cap and protection gates) and
 * the two visibility reports the sidebar composes for the hover peek.
 * The sidebar-level integration (drags, pill fade mid-drag, ⌘←/⌘→) stays
 * in the Sidebar.* test files.
 */
describe('FolderSwitch (v1.2.1 folder switch, extracted)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [PROJECT_PATH, OTHER_PATH, THIRD_PATH],
      projectFolders: [],
      pendingPreflightPath: null,
      activeFolderId: null,
      renameTarget: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  describe('segments and view switching', () => {
    it('renders the unfiled segment first, then one tab per folder', () => {
      const gigId = createFolderOrFail('Gig')
      render(<FolderSwitch dragController={idleDragController()} />)

      const unfiled = screen.getByTestId('unfiled-segment')
      expect(unfiled).toHaveAttribute('role', 'tab')
      expect(unfiled).toHaveAttribute('aria-selected', 'true')
      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')
      // The drag adapter and the context-menu targeting both key off
      // this attribute — the DOM contract is the component's public face.
      expect(gig).toHaveAttribute('data-folder-segment', gigId)
      expect(within(gig).getByTestId('folder-name')).toHaveTextContent('Gig')
    })

    it('a segment click switches the active view and the roving tab stop', () => {
      const gigId = createFolderOrFail('Gig')
      render(<FolderSwitch dragController={idleDragController()} />)

      const unfiled = screen.getByTestId('unfiled-segment')
      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')

      fireEvent.click(gig)
      expect(useProjectStore.getState().activeFolderId).toBe(gigId)
      expect(gig).toHaveAttribute('aria-selected', 'true')
      expect(gig).toHaveAttribute('tabIndex', '0')
      expect(unfiled).toHaveAttribute('aria-selected', 'false')
      expect(unfiled).toHaveAttribute('tabIndex', '-1')

      fireEvent.click(unfiled)
      expect(useProjectStore.getState().activeFolderId).toBeNull()
      expect(unfiled).toHaveAttribute('tabIndex', '0')
    })

    it('shows the in-use dot on the folder holding the session project', () => {
      const gigId = createFolderOrFail('Gig')
      useProjectStore.getState().moveProjectToFolder(gigId, PROJECT_PATH)
      // The dot shows from the moment the session starts, not only once
      // ready (spec issue #4) — seed a starting session on that project.
      useSessionStore.setState({
        sessionStatus: 'starting',
        sessionProjectPath: PROJECT_PATH,
      })
      render(<FolderSwitch dragController={idleDragController()} />)

      const [gig] = screen.getAllByTestId('folder-segment')
      if (!gig) throw new Error('Expected the Gig segment')
      expect(within(gig).getByTestId('folder-in-use-dot')).toBeInTheDocument()
    })
  })

  describe('sliding pill', () => {
    it('positions itself from the active segment offsets and follows switches', async () => {
      createFolderOrFail('Gig')
      render(<FolderSwitch dragController={idleDragController()} />)

      // jsdom lays nothing out — pin the boxes the pill measures.
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
      })
    })
  })

  describe('context menu CRUD', () => {
    it('creates a folder from the menu and names it inline (Enter), focused', async () => {
      const user = userEvent.setup()
      render(<FolderSwitch dragController={idleDragController()} />)

      const menu = await openFolderContextMenu(
        screen.getByTestId('unfiled-segment')
      )
      fireEvent.click(within(menu).getByTestId('menu-new-folder'))

      // Creation runs once the menu's FocusScope is gone (the Radix
      // focus-reclaim workaround): the input owns the focus right after.
      const input = await screen.findByTestId('folder-name-input')
      expect(input).toHaveValue('New Folder')
      expect(input).toHaveFocus()

      await user.clear(input)
      await user.type(input, 'Gig Friday{Enter}')

      expect(screen.getByTestId('folder-name')).toHaveTextContent('Gig Friday')
      await waitFor(() => {
        expect(commands.savePreferences).toHaveBeenCalledWith(
          expect.objectContaining({
            projectFolders: [
              expect.objectContaining({ name: 'Gig Friday', projectPaths: [] }),
            ],
          })
        )
      })
    })

    it('Escape during creation discards the empty folder', async () => {
      const user = userEvent.setup()
      render(<FolderSwitch dragController={idleDragController()} />)

      const menu = await openFolderContextMenu(
        screen.getByTestId('unfiled-segment')
      )
      fireEvent.click(within(menu).getByTestId('menu-new-folder'))
      await user.type(
        await screen.findByTestId('folder-name-input'),
        'Nope{Escape}'
      )

      expect(screen.queryByTestId('folder-segment')).not.toBeInTheDocument()
      expect(useProjectStore.getState().projectFolders).toEqual([])
    })

    it('repeat creations pick fresh names; renaming onto an existing name is refused', async () => {
      render(<FolderSwitch dragController={idleDragController()} />)

      let menu = await openFolderContextMenu(
        screen.getByTestId('unfiled-segment')
      )
      fireEvent.click(within(menu).getByTestId('menu-new-folder'))
      fireEvent.keyDown(await screen.findByTestId('folder-name-input'), {
        key: 'Enter',
      })
      expect(screen.getByTestId('folder-name')).toHaveTextContent('New Folder')

      menu = await openFolderContextMenu(screen.getByTestId('unfiled-segment'))
      fireEvent.click(within(menu).getByTestId('menu-new-folder'))
      fireEvent.keyDown(await screen.findByTestId('folder-name-input'), {
        key: 'Enter',
      })
      // New folders prepend, so the second creation is the first segment.
      const [newest] = screen.getAllByTestId('folder-segment')
      if (!newest) throw new Error('Expected the newest segment')
      expect(within(newest).getByTestId('folder-name')).toHaveTextContent(
        'New Folder 2'
      )

      menu = await openFolderContextMenu(newest)
      fireEvent.click(within(menu).getByTestId('menu-rename-folder'))
      const input = await screen.findByTestId('folder-name-input')
      await fireEvent.change(input, { target: { value: 'New Folder' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      expect(notifications.warning).toHaveBeenCalledWith(
        'A folder named “New Folder” already exists.'
      )
      expect(within(newest).getByTestId('folder-name')).toHaveTextContent(
        'New Folder 2'
      )
    })

    it('deleting from the menu confirms, then returns its projects to ungrouped', async () => {
      const user = userEvent.setup()
      const folderId = createFolderOrFail('Set list')
      useProjectStore.getState().moveProjectToFolder(folderId, OTHER_PATH)

      render(<FolderSwitch dragController={idleDragController()} />)

      const menu = await openFolderContextMenu(
        screen.getByTestId('folder-segment')
      )
      fireEvent.click(within(menu).getByTestId('menu-delete-folder'))

      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent(/Set list/)

      await user.click(
        within(dialog).getByRole('button', { name: /^delete$/i })
      )

      expect(useProjectStore.getState().projectFolders).toEqual([])
      await waitFor(() => {
        expect(commands.savePreferences).toHaveBeenCalledWith(
          expect.objectContaining({ projectFolders: [] })
        )
      })
    })

    it('cancel keeps the folder and reports the dialog closed', async () => {
      const user = userEvent.setup()
      const onDialogOpenChange = vi.fn()
      createFolderOrFail('Set list')
      render(
        <FolderSwitch
          dragController={idleDragController()}
          onDialogOpenChange={onDialogOpenChange}
        />
      )

      const menu = await openFolderContextMenu(
        screen.getByTestId('folder-segment')
      )
      fireEvent.click(within(menu).getByTestId('menu-delete-folder'))
      const dialog = await screen.findByRole('alertdialog')
      await waitFor(() => expect(onDialogOpenChange).toHaveBeenCalledWith(true))

      await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

      expect(useProjectStore.getState().projectFolders).toHaveLength(1)
      await waitFor(() =>
        expect(onDialogOpenChange).toHaveBeenCalledWith(false)
      )
    })
  })

  describe('context menu gating', () => {
    it('the track and the unfiled segment offer creation only', async () => {
      render(<FolderSwitch dragController={idleDragController()} />)

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

    it('a folder segment offers rename, export and delete', async () => {
      const folderId = createFolderOrFail('Gig')
      useProjectStore.getState().moveProjectToFolder(folderId, OTHER_PATH)
      render(<FolderSwitch dragController={idleDragController()} />)

      const menu = await openFolderContextMenu(
        screen.getByTestId('folder-segment')
      )
      expect(
        within(menu).getByTestId('menu-rename-folder')
      ).not.toHaveAttribute('aria-disabled', 'true')
      expect(
        within(menu).getByTestId('menu-export-setlist')
      ).not.toHaveAttribute('aria-disabled', 'true')
      expect(
        within(menu).getByTestId('menu-delete-folder')
      ).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('the protected Utilities folder disables rename and delete with the reason', async () => {
      useProjectStore.setState({
        projectFolders: [
          { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
        ],
      })
      render(<FolderSwitch dragController={idleDragController()} />)

      const menu = await openFolderContextMenu(
        screen.getByTestId('folder-segment')
      )
      expect(within(menu).getByTestId('menu-rename-folder')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(within(menu).getByTestId('menu-delete-folder')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(menu).toHaveTextContent(/Utilities is protected/)
      expect(useProjectStore.getState().renameTarget).toBeNull()
    })

    it('creation disables at the folder cap (Utilities counts) with the reason', async () => {
      useProjectStore.setState({
        projectFolders: [
          { id: 'f1', name: 'One', projectPaths: [] },
          { id: 'f2', name: 'Two', projectPaths: [] },
          { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
        ],
      })
      render(<FolderSwitch dragController={idleDragController()} />)

      const menu = await openFolderContextMenu(
        screen.getByTestId('unfiled-segment')
      )
      expect(within(menu).getByTestId('menu-new-folder')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
      expect(menu).toHaveTextContent(/Folder limit reached \(3/)
    })

    it('export on a folder segment starts the setlist export flow', async () => {
      const folderId = createFolderOrFail('Gig Friday')
      useProjectStore.getState().moveProjectToFolder(folderId, OTHER_PATH)
      render(<FolderSwitch dragController={idleDragController()} />)

      const menu = await openFolderContextMenu(
        screen.getByTestId('folder-segment')
      )
      fireEvent.click(within(menu).getByTestId('menu-export-setlist'))

      await waitFor(() =>
        expect(exportSetlistFolder).toHaveBeenCalledWith(folderId)
      )
    })
  })

  describe('visibility reports (the hover sidebar peek)', () => {
    it('reports the context menu open state through onPopupOpenChange', async () => {
      const onPopupOpenChange = vi.fn()
      render(
        <FolderSwitch
          dragController={idleDragController()}
          onPopupOpenChange={onPopupOpenChange}
        />
      )

      await openFolderContextMenu(screen.getByTestId('unfiled-segment'))
      expect(onPopupOpenChange).toHaveBeenCalledWith(true)

      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(onPopupOpenChange).toHaveBeenCalledWith(false))
    })
  })
})
