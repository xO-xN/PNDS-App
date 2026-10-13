import {
  render,
  screen,
  fireEvent,
  waitFor,
  mockBoundingClientRect,
  createFolderOrFail,
  selectFolderInPicker,
  openFolderContextMenu,
  within,
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
    if (!first || !second) throw new Error('Expected two ungrouped cards')
    mockBoundingClientRect(first, { top: 0 })
    mockBoundingClientRect(second, { top: 61 })
    await dragCardTo(second, 60, 90)
    mockBoundingClientRect(screen.getByTestId('folder-drop-choices'), {
      top: 0,
      left: 340,
      width: 200,
      height: 360,
    })
    const segment = screen.getByText('Set list', {
      selector: '[data-folder-drop-id]',
    })
    mockBoundingClientRect(segment, {
      top: 200,
      left: 350,
      width: 180,
      height: 32,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 435, clientY: 216 })

    // Hovering the segment highlights it as the drop zone.
    expect(segment).toHaveAttribute('data-drop-active', 'true')
    // Moving back over the list clears the highlight.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 30 })
    expect(segment).not.toHaveAttribute('data-drop-active')

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 435, clientY: 216 })
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
    // Only FIRST remains ungrouped in the Home view.
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
    const folderId = createFolderOrFail('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, SECOND_PATH)
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)
    render(<Sidebar variant="static" />)

    await selectFolderInPicker('Set list')

    // The unfiled segment spans x 100..160, y 0..32; the two members
    // pitch 61px from y 100.
    const [first, second] = screen.getAllByTestId('project-entry')
    if (!first || !second) throw new Error('Expected two folder members')
    mockBoundingClientRect(first, { top: 100 })
    mockBoundingClientRect(second, { top: 161 })

    await dragCardTo(first, 60, 90)
    mockBoundingClientRect(screen.getByTestId('folder-drop-choices'), {
      top: 0,
      left: 20,
      width: 280,
      height: 256,
    })
    const unfiled = screen.getByText('Home', {
      selector: '[data-unfiled-drop]',
    })
    mockBoundingClientRect(unfiled, {
      top: 0,
      left: 100,
      width: 60,
      height: 32,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 130, clientY: 16 })

    expect(unfiled).toHaveAttribute('data-drop-active', 'true')
    expect(screen.getByTestId('drag-project-order-number')).toHaveTextContent(
      '02'
    )
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
    await selectFolderInPicker('Home')
    expect(screen.getAllByTestId('project-entry')).toHaveLength(2)
    const returnedCard = screen.getAllByTestId('project-entry')[1]
    if (!returnedCard) throw new Error('Expected the returned project card')
    expect(
      within(returnedCard).getByTestId('project-order-number')
    ).toHaveTextContent('02')
  })

  it('previews the destination folder ordinal before committing membership', async () => {
    const folderId = createFolderOrFail('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)
    render(<Sidebar variant="static" />)
    const [source, second] = screen.getAllByTestId('project-entry')
    if (!source || !second) throw new Error('Expected two cards')
    mockBoundingClientRect(source, { top: 0 })
    mockBoundingClientRect(second, { top: 61 })
    await dragCardTo(source, 60, 20)
    expect(screen.getByTestId('drag-project-order-number')).toHaveTextContent(
      '01'
    )
    mockBoundingClientRect(screen.getByTestId('folder-drop-choices'), {
      top: 0,
      left: 340,
      width: 200,
      height: 360,
    })
    mockBoundingClientRect(
      screen.getByText('Set list', { selector: '[data-folder-drop-id]' }),
      { top: 200, left: 350, width: 180, height: 32 }
    )
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 435, clientY: 216 })
    expect(screen.getByTestId('drag-project-order-number')).toHaveTextContent(
      '02'
    )
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      THIRD_PATH,
    ])
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      THIRD_PATH,
      FIRST_PATH,
    ])
  })

  it('folder menu ordering persists without changing membership', async () => {
    const first = createFolderOrFail('Friday')
    const second = createFolderOrFail('Saturday')
    useProjectStore.getState().setActiveFolderId(first)
    render(<Sidebar variant="static" />)
    const menu = await openFolderContextMenu(
      screen.getByRole('combobox', { name: 'Performance folder' })
    )
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Move folder up' })
    )
    await waitFor(() =>
      expect(
        useProjectStore.getState().projectFolders.map(folder => folder.id)
      ).toEqual([first, second])
    )
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: [
            expect.objectContaining({ id: first }),
            expect.objectContaining({ id: second }),
          ],
        })
      )
    )
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
    if (!first || !second) throw new Error('Expected two ungrouped cards')
    mockBoundingClientRect(first, { top: 0 })
    mockBoundingClientRect(second, { top: 61 })

    // Hover the segment, then retreat to the list and drop on a no-move slot.
    await dragCardTo(second, 135, 216)
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 100 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      THIRD_PATH,
    ])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
  it('a clipped folder row cannot intercept a drop on the visible project list', async () => {
    useProjectStore.setState({
      projectFolders: Array.from({ length: 10 }, (_, i) => ({
        id: `f${i}`,
        name: `Folder ${i}`,
        projectPaths: [],
      })),
    })
    render(<Sidebar variant="static" />)
    const [first, second, third] = screen.getAllByTestId('project-entry')
    if (!first || !second || !third) throw new Error('Expected three cards')
    mockBoundingClientRect(first, { top: 80 })
    mockBoundingClientRect(second, { top: 141 })
    mockBoundingClientRect(third, { top: 202 })
    await dragCardTo(second, 60, 90)
    mockBoundingClientRect(screen.getByTestId('folder-drop-choices'), {
      top: 0,
      left: 20,
      width: 280,
      height: 64,
    })
    // This row exists but has scrolled/clipped out below the popup.
    mockBoundingClientRect(
      screen.getByText('Folder 9', { selector: '[data-folder-drop-id]' }),
      { top: 80, left: 20, width: 280, height: 32 }
    )
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 135, clientY: 90 })
    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(useProjectStore.getState().projectFolders[9]?.projectPaths).toEqual(
      []
    )
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      SECOND_PATH,
      FIRST_PATH,
      THIRD_PATH,
    ])
  })
})
