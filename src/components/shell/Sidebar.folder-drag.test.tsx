import {
  render,
  screen,
  fireEvent,
  waitFor,
  mockBoundingClientRect,
} from '@/test/test-utils'
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
 * v1.1.2 T5 (issue #9): folder drag interactions — dropping a project on
 * a folder card files it in, dropping a member on the breadcrumb bar
 * returns it to ungrouped, and folder cards reorder within their section.
 * jsdom lays out nothing, so each test pins the rects the drag derives
 * its geometry from (cards pitch 61px); the drop decision itself is the
 * same pure math covered by the drag-reorder unit tests.
 */
describe('Sidebar folder drags (v1.1.2 T5)', () => {
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

  it('dropping a project on a folder card files it into that folder (end), persisted', async () => {
    const folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)
    render(<Sidebar variant="static" />)

    // Ungrouped FIRST/SECOND pitch 61px; the folder card sits below them.
    const [first, second] = screen.getAllByTestId('project-entry')
    const folderCard = screen.getByTestId('folder-card')
    if (!first || !second) throw new Error('Expected two ungrouped cards')
    mockBoundingClientRect(first, { top: 0 })
    mockBoundingClientRect(second, { top: 61 })
    mockBoundingClientRect(folderCard, { top: 200 })

    await dragCardTo(second, 150, 220)

    // Hovering the folder card highlights it as the drop zone.
    expect(folderCard).toHaveAttribute('data-drop-active', 'true')
    // Moving back over the list clears the highlight.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 30 })
    expect(folderCard).not.toHaveAttribute('data-drop-active')

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 220 })
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
    // Only FIRST remains ungrouped at the top level.
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

  it('dropping a member on the breadcrumb returns it to ungrouped, persisted', async () => {
    const folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, SECOND_PATH)
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)
    render(<Sidebar variant="static" />)

    await fireEvent.click(screen.getByTestId('folder-card'))

    const breadcrumb = screen.getByTestId('breadcrumb-bar')
    mockBoundingClientRect(breadcrumb, { top: 0, height: 24 })
    const [first, second] = screen.getAllByTestId('project-entry')
    if (!first || !second) throw new Error('Expected two folder members')
    mockBoundingClientRect(first, { top: 100 })
    mockBoundingClientRect(second, { top: 161 })

    await dragCardTo(first, 150, 10)

    expect(breadcrumb).toHaveAttribute('data-drop-active', 'true')
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

    // Back at the top level the project is ungrouped again.
    fireEvent.click(screen.getByTestId('breadcrumb-back'))
    expect(screen.getAllByTestId('project-entry')).toHaveLength(2)
  })

  it('folder cards reorder within the folder area, persisted', async () => {
    const store = useProjectStore.getState()
    const friday = store.createFolder('Friday')
    const saturday = store.createFolder('Saturday')
    const sunday = store.createFolder('Sunday')
    render(<Sidebar variant="static" />)

    const cards = screen.getAllByTestId('folder-card')
    expect(cards).toHaveLength(3)
    // The three folder cards pitch 61px below the ungrouped project.
    mockBoundingClientRect(cards[0] as HTMLElement, { top: 300 })
    mockBoundingClientRect(cards[1] as HTMLElement, { top: 361 })
    mockBoundingClientRect(cards[2] as HTMLElement, { top: 422 })

    // Newest-created first (v1.2.0 top insertion): cards[0] is Sunday.
    // Drag Sunday over Saturday's bottom half → insert after it.
    await dragCardTo(cards[0] as HTMLElement, 150, 400)
    // Saturday yields one stride up, opening Sunday's landing slot.
    expect(cards[1]).toHaveStyle({ transform: 'translateY(-61px)' })

    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(
      useProjectStore.getState().projectFolders.map(folder => folder.id)
    ).toEqual([saturday, sunday, friday])
    // The DOM follows the new folder order.
    expect(
      screen
        .getAllByTestId('folder-card')
        .map(card => card.getAttribute('data-folder-id'))
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
    const folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)
    // Those setup commits persist through the store — settle the queue and
    // clear it, so only a drag-triggered save could be observed below.
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.mocked(commands.savePreferences).mockClear()
    render(<Sidebar variant="static" />)

    const [first, second] = screen.getAllByTestId('project-entry')
    const folderCard = screen.getByTestId('folder-card')
    if (!first || !second) throw new Error('Expected two ungrouped cards')
    mockBoundingClientRect(first, { top: 0 })
    mockBoundingClientRect(second, { top: 61 })
    mockBoundingClientRect(folderCard, { top: 200 })

    // Hover the folder, then retreat to the list and drop on a no-move slot.
    await dragCardTo(second, 150, 220)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 100 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      THIRD_PATH,
    ])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
})
