import { render, screen, fireEvent, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

const PROJECT_PATH = '/Users/test/Inarticulate III'
const OTHER_PATH = '/Users/test/PNDS Score 1'
const THIRD_PATH = '/Users/test/Another Score'

/**
 * v1.1.2 T1 (issue #5): folder basics — creation with inline naming,
 * the two-segment top-level layout, deletion semantics and persistence.
 */
describe('Sidebar folders (v1.1.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: [PROJECT_PATH, OTHER_PATH, THIRD_PATH],
      projectFolders: [],
      pendingTrustPath: null,
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('creates a folder from the title button and names it inline (Enter)', async () => {
    const user = userEvent.setup()
    render(<Sidebar variant="static" />)

    await user.click(screen.getByTestId('new-folder-button'))

    // Creation immediately enters inline naming with the default name.
    const input = screen.getByTestId('folder-name-input')
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
    render(<Sidebar variant="static" />)

    await user.click(screen.getByTestId('new-folder-button'))
    await user.type(screen.getByTestId('folder-name-input'), 'Nope{Escape}')

    expect(screen.queryByTestId('folder-card')).not.toBeInTheDocument()
    expect(useProjectStore.getState().projectFolders).toEqual([])
  })

  it('renders ungrouped projects above the folder section (two-segment)', () => {
    useProjectStore.getState().createFolder('Set list')
    const [folder] = useProjectStore.getState().projectFolders
    if (!folder) throw new Error('Expected the created folder')
    useProjectStore.getState().moveProjectToFolder(folder.id, OTHER_PATH)

    render(<Sidebar variant="static" />)

    // OTHER_PATH lives in the folder: only the two ungrouped cards render.
    const entries = screen.getAllByTestId('project-entry')
    expect(entries).toHaveLength(2)

    // Order in the DOM: ungrouped projects first, folders after.
    const firstEntry = entries[0]
    if (!firstEntry) throw new Error('Expected an ungrouped project entry')
    const folderCard = screen.getByTestId('folder-card')
    expect(
      firstEntry.compareDocumentPosition(folderCard) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('deleting a folder confirms, then returns its projects to ungrouped', async () => {
    const user = userEvent.setup()
    const folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, OTHER_PATH)
    useProjectStore.getState().moveProjectToFolder(folderId, THIRD_PATH)

    render(<Sidebar variant="static" />)

    // Members are hidden from the top segment while grouped.
    expect(screen.getAllByTestId('project-entry')).toHaveLength(1)

    fireEvent.click(
      within(screen.getByTestId('folder-card')).getByRole('button', {
        name: /delete folder/i,
      })
    )

    // Confirmation copy spells out the ungrouped fallback.
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/return to the ungrouped list/i)
    expect(dialog).toHaveTextContent(/Set list/)

    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    expect(useProjectStore.getState().projectFolders).toEqual([])
    // All three projects are back as ungrouped entries; trust is untouched.
    expect(screen.getAllByTestId('project-entry')).toHaveLength(3)
    expect(useProjectStore.getState().trustedPaths).toEqual([
      PROJECT_PATH,
      OTHER_PATH,
      THIRD_PATH,
    ])
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ projectFolders: [] })
      )
    })
  })

  it('removing a project keeps folder membership of the others intact', async () => {
    const user = userEvent.setup()
    const folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, OTHER_PATH)

    render(<Sidebar variant="static" />)

    // The first ungrouped card (Inarticulate III) offers remove-from-history.
    const firstEntry = screen.getAllByTestId('project-entry')[0]
    if (!firstEntry) throw new Error('Expected an ungrouped project entry')
    await user.click(
      within(firstEntry).getByRole('button', { name: /remove from history/i })
    )

    const state = useProjectStore.getState()
    expect(state.trustedPaths).toEqual([OTHER_PATH, THIRD_PATH])
    // The folder and its member are untouched — removing one index never
    // regroups anything else.
    expect(state.projectFolders[0]?.projectPaths).toEqual([OTHER_PATH])
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: [OTHER_PATH, THIRD_PATH],
          projectFolders: [
            expect.objectContaining({ projectPaths: [OTHER_PATH] }),
          ],
        })
      )
    })
  })
})
