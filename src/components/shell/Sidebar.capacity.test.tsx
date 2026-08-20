import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  mockBoundingClientRect,
  openFolderContextMenu,
} from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useProjectStore,
  UTILITIES_FOLDER_ID,
  PROJECT_LIMIT_PER_DIRECTORY,
} from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { notifications } from '@/lib/notifications'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

const LOOSE_PATH = '/Users/test/Loose Score'

/**
 * v1.2.1 (issue #26), v1.2.2 (issue #28): the sidebar's capacity UX
 * derives entirely from the store — the context menu's "New folder"
 * disables with an explaining reason when the folder area reaches its
 * cap, and a project blocked by a full directory surfaces the store's
 * refusal as a warning. The cap arithmetic itself is covered by the
 * project-store capacity tests.
 */
describe('Sidebar capacity caps (v1.2.1 #26, menu since v1.2.2 #28)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [LOOSE_PATH],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('disables the menu "New folder" at 3 folders (Utilities counts) and explains why', async () => {
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
    // The reason rides along under the label, not behind a tooltip.
    expect(menu).toHaveTextContent(
      'Folder limit reached (3, including Utilities) — delete a folder to create another.'
    )
    expect(screen.queryByTestId('folder-name-input')).not.toBeInTheDocument()
  })

  it('keeps the menu "New folder" enabled below the cap and creating works', async () => {
    useProjectStore.setState({
      projectFolders: [
        { id: 'f1', name: 'One', projectPaths: [] },
        { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
      ],
    })
    render(<Sidebar variant="static" />)

    const menu = await openFolderContextMenu(
      screen.getByTestId('unfiled-segment')
    )

    const create = within(menu).getByTestId('menu-new-folder')
    expect(create).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(create)

    const input = await screen.findByTestId('folder-name-input')
    expect(input).toHaveValue('New Folder')
  })

  it('dropping a project on a full folder warns and leaves the folder unchanged', async () => {
    const members = Array.from({ length: 30 }, (_, i) => `/in-${i}`)
    useProjectStore.setState({
      recentProjectPaths: [LOOSE_PATH, ...members],
      projectFolders: [{ id: 'f-full', name: 'Full', projectPaths: members }],
    })
    render(<Sidebar variant="static" />)

    // One ungrouped card, the full folder as a switch segment — the drop
    // geometry follows the folder-drag tests' pinned rects (jsdom lays
    // out nothing): the segment spans x 100..170, y 200..232.
    const [loose] = screen.getAllByTestId('project-entry')
    const segment = screen.getByTestId('folder-segment')
    if (!loose) throw new Error('Expected the ungrouped project card')
    mockBoundingClientRect(loose, { top: 0 })
    mockBoundingClientRect(segment, {
      top: 200,
      left: 100,
      width: 70,
      height: 32,
    })

    fireEvent.pointerDown(loose, { pointerId: 1, clientX: 40, clientY: 20 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 30 })
    await waitFor(() =>
      expect(screen.getByTestId('drag-clone')).toBeInTheDocument()
    )
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 135, clientY: 216 })
    expect(segment).toHaveAttribute('data-drop-active', 'true')
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(notifications.warning).toHaveBeenCalledWith(
      `This list already holds the maximum of ${PROJECT_LIMIT_PER_DIRECTORY} projects — remove one before adding another.`
    )
    // The refusal changed nothing: the folder stayed at 30, the dragged
    // project is still ungrouped and in the history (the flat view lists
    // all 31 cards, members included).
    const state = useProjectStore.getState()
    expect(state.projectFolders[0]?.projectPaths).toEqual(members)
    expect(state.recentProjectPaths).toEqual([LOOSE_PATH, ...members])
    expect(screen.getAllByTestId('project-entry')).toHaveLength(31)
  })
})
