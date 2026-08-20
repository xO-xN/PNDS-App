import {
  render,
  screen,
  fireEvent,
  waitFor,
  mockBoundingClientRect,
  createFolderOrFail,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
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
const THIRD_PATH = '/Users/test/Another Score'

/**
 * v1.1.2 T5 (issue #9), reworked for the v1.2.1 folder switch: folder
 * drag interactions — dropping a project on a folder segment files it in,
 * dropping a member on the unfiled segment returns it to ungrouped, and
 * the segments reorder within the switch row. jsdom lays out nothing, so
 * each test pins the rects the drag derives its geometry from (project
 * cards pitch 61px; segments pitch 74px horizontally); the drop decision
 * itself is the same pure math covered by the drag-reorder unit tests.
 */
describe('Sidebar folder drags (v1.1.2 T5, folder switch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [FIRST_PATH, SECOND_PATH, THIRD_PATH],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  /** Press a card anywhere, move past the click slack to arm the drag,
   * then drag it to (x, y). */
  async function dragCardTo(card: HTMLElement, x: number, y: number) {
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 40, clientY: 80 })
    // The drag activates only after the pointer leaves the slack radius.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 90 })
    await waitFor(() =>
      expect(screen.getByTestId('drag-clone')).toBeInTheDocument()
    )
    fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y })
  }

  it('dropping a project on a folder segment files it into that folder (end), persisted', async () => {
    const folderId = createFolderOrFail('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)
    render(<Sidebar variant="static" />)

    // Ungrouped FIRST/SECOND pitch 61px; the folder segment sits below
    // them in the (pinned) switch row geometry: x 100..170, y 200..232.
    const [first, second] = screen.getAllByTestId('project-entry')
    const segment = screen.getByTestId('folder-segment')
    if (!first || !second) throw new Error('Expected two ungrouped cards')
    mockBoundingClientRect(first, { top: 0 })
    mockBoundingClientRect(second, { top: 61 })
    mockBoundingClientRect(segment, {
      top: 200,
      left: 100,
      width: 70,
      height: 32,
    })

    await dragCardTo(second, 135, 216)

    // Hovering the segment highlights it as the drop zone.
    expect(segment).toHaveAttribute('data-drop-active', 'true')
    // Moving back over the list clears the highlight.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 30 })
    expect(segment).not.toHaveAttribute('data-drop-active')

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 135, clientY: 216 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    // SECOND joined the folder at its end; THIRD keeps its slot, the
    // master list is untouched.
    const state = useProjectStore.getState()
    expect(state.projectFolders[0]?.projectPaths).toEqual([
      THIRD_PATH,
      SECOND_PATH,
    ])
    expect(state.recentProjectPaths).toEqual([
      FIRST_PATH,
      SECOND_PATH,
      THIRD_PATH,
    ])
    // Only FIRST remains ungrouped in the default view.
    expect(screen.getAllByTestId('project-entry')).toHaveLength(1)
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: [FIRST_PATH, SECOND_PATH, THIRD_PATH],
          projectFolders: [
            expect.objectContaining({
              projectPaths: [THIRD_PATH, SECOND_PATH],
            }),
          ],
        })
      )
    })
  })

  it('dropping a member on the unfiled segment returns it to ungrouped, persisted', async () => {
    const user = userEvent.setup()
    const folderId = createFolderOrFail('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, SECOND_PATH)
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)
    render(<Sidebar variant="static" />)

    await fireEvent.click(screen.getByTestId('folder-segment'))

    // The unfiled segment spans x 100..160, y 0..32; the two members
    // pitch 61px from y 100.
    const unfiled = screen.getByTestId('unfiled-segment')
    mockBoundingClientRect(unfiled, {
      top: 0,
      left: 100,
      width: 60,
      height: 32,
    })
    const [first, second] = screen.getAllByTestId('project-entry')
    if (!first || !second) throw new Error('Expected two folder members')
    mockBoundingClientRect(first, { top: 100 })
    mockBoundingClientRect(second, { top: 161 })

    await dragCardTo(first, 130, 16)

    expect(unfiled).toHaveAttribute('data-drop-active', 'true')
    fireEvent.pointerUp(window, { pointerId: 1 })

    // SECOND left the folder; the master list keeps every project.
    const state = useProjectStore.getState()
    expect(state.projectFolders[0]?.projectPaths).toEqual([THIRD_PATH])
    expect(state.recentProjectPaths).toEqual([
      FIRST_PATH,
      SECOND_PATH,
      THIRD_PATH,
    ])
    // The folder view now lists a single member.
    expect(screen.getAllByTestId('project-entry')).toHaveLength(1)
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: [
            expect.objectContaining({ projectPaths: [THIRD_PATH] }),
          ],
        })
      )
    })

    // Back at the unfiled view the project is ungrouped again. (userEvent:
    // a real click starts with pointerdown, which re-arms the click
    // suppression the drop left behind.)
    await user.click(screen.getByTestId('unfiled-segment'))
    expect(screen.getAllByTestId('project-entry')).toHaveLength(2)
  })

  it('segments reorder within the switch row, persisted', async () => {
    const friday = createFolderOrFail('Friday')
    const saturday = createFolderOrFail('Saturday')
    const sunday = createFolderOrFail('Sunday')
    render(<Sidebar variant="static" />)

    const segments = screen.getAllByTestId('folder-segment')
    expect(segments).toHaveLength(3)
    // The three segments pitch 74px along the row at y 200.
    mockBoundingClientRect(segments[0] as HTMLElement, {
      top: 200,
      left: 20,
      width: 70,
      height: 32,
    })
    mockBoundingClientRect(segments[1] as HTMLElement, {
      top: 200,
      left: 94,
      width: 70,
      height: 32,
    })
    mockBoundingClientRect(segments[2] as HTMLElement, {
      top: 200,
      left: 168,
      width: 70,
      height: 32,
    })

    // Newest-created first (v1.2.0 top insertion): segments[0] is Sunday.
    // Drag Sunday over Saturday's right half → insert after it.
    await dragCardTo(segments[0] as HTMLElement, 150, 216)
    // Saturday yields one stride left, opening Sunday's landing slot.
    expect(segments[1]).toHaveStyle({ transform: 'translateX(-74px)' })

    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(
      useProjectStore.getState().projectFolders.map(folder => folder.id)
    ).toEqual([saturday, sunday, friday])
    // The DOM follows the new folder order.
    expect(
      screen
        .getAllByTestId('folder-segment')
        .map(segment => segment.getAttribute('data-folder-segment'))
    ).toEqual([saturday, sunday, friday])
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: [
            expect.objectContaining({ name: 'Saturday' }),
            expect.objectContaining({ name: 'Sunday' }),
            expect.objectContaining({ name: 'Friday' }),
          ],
        })
      )
    })
  })

  it('a project dragged back over the list neither joins a folder nor saves', async () => {
    const folderId = createFolderOrFail('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)
    // Those setup commits persist through the store — settle the queue and
    // clear it, so only a drag-triggered save could be observed below.
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.mocked(commands.savePreferences).mockClear()
    render(<Sidebar variant="static" />)

    const [first, second] = screen.getAllByTestId('project-entry')
    const segment = screen.getByTestId('folder-segment')
    if (!first || !second) throw new Error('Expected two ungrouped cards')
    mockBoundingClientRect(first, { top: 0 })
    mockBoundingClientRect(second, { top: 61 })
    mockBoundingClientRect(segment, {
      top: 200,
      left: 100,
      width: 70,
      height: 32,
    })

    // Hover the segment, then retreat to the list and drop on a no-move slot.
    await dragCardTo(second, 135, 216)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 100 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      THIRD_PATH,
    ])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
})
