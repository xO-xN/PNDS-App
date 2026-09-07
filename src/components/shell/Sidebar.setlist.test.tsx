import {
  render,
  screen,
  fireEvent,
  within,
  openFolderContextMenu,
} from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { exportSetlistFolder } from '@/lib/setlist-export'
import { Sidebar } from './Sidebar'

vi.mock('@/lib/setlist-export', () => ({
  exportSetlistFolder: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

const PROJECT_PATH = '/Users/test/Inarticulate III'
const OTHER_PATH = '/Users/test/PNDS Score 1'

/**
 * v1.4.0 (issue #59): the setlist export entry lives in the folder
 * segment's context menu. The menu gates it for folders with nothing to
 * export and for the protected Utilities folder, spelling out the reason
 * like every disabled item — and the unfiled segment never offers it.
 */
describe('Sidebar setlist export entry (issue #59)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [PROJECT_PATH, OTHER_PATH],
      projectFolders: [],
      pendingPreflightPath: null,
      activeFolderId: null,
      renameTarget: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  function createFolder(name: string, members: string[]): string {
    const id = useProjectStore.getState().createFolder(name)
    if (id === null) throw new Error('Expected the folder to be created')
    for (const path of members) {
      useProjectStore.getState().moveProjectToFolder(id, path)
    }
    return id
  }

  it('a folder segment offers export and selecting it starts the flow', async () => {
    const folderId = createFolder('Gig Friday', [OTHER_PATH])
    render(<Sidebar variant="static" />)

    const menu = await openFolderContextMenu(
      screen.getByTestId('folder-segment')
    )
    const item = within(menu).getByTestId('menu-export-setlist')
    expect(item).toHaveTextContent(/export setlist folder/i)
    expect(item).not.toBeDisabled()

    fireEvent.click(item)
    // The action runs once the menu has fully closed (the FocusScope
    // workaround) — the pendingMenuAction lands a macrotask later.
    await vi.waitFor(() => {
      expect(exportSetlistFolder).toHaveBeenCalledWith(folderId)
    })
  })

  it('an empty folder disables export with the reason spelled out', async () => {
    createFolder('Empty', [])
    render(<Sidebar variant="static" />)

    const menu = await openFolderContextMenu(
      screen.getByTestId('folder-segment')
    )
    const item = within(menu).getByTestId('menu-export-setlist')
    // Radix menu items gate via aria-disabled, not the native attribute.
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent(/this folder is empty/i)

    fireEvent.click(item)
    expect(exportSetlistFolder).not.toHaveBeenCalled()
  })

  it('the protected Utilities folder disables export with its reason', async () => {
    useProjectStore.setState({
      projectFolders: [
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: [PROJECT_PATH],
        },
      ],
    })
    render(<Sidebar variant="static" />)

    const menu = await openFolderContextMenu(
      screen.getByTestId('folder-segment')
    )
    const item = within(menu).getByTestId('menu-export-setlist')
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveTextContent(/built into the app/i)
  })

  it('the unfiled segment and the bare track never offer export', async () => {
    createFolder('Gig Friday', [OTHER_PATH])
    render(<Sidebar variant="static" />)

    const menu = await openFolderContextMenu(
      screen.getByTestId('unfiled-segment')
    )
    expect(
      within(menu).queryByTestId('menu-export-setlist')
    ).not.toBeInTheDocument()
  })
})
