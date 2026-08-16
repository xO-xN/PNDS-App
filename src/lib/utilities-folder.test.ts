import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { ensureUtilitiesFolder } from './utilities-folder'

const EXAMPLE_PATHS = [
  '/Applications/PNDS.app/Contents/Resources/examples/Local Network Diagnostics',
  '/Applications/PNDS.app/Contents/Resources/examples/Multichannel Signal Generator',
]

/**
 * v1.1.2 T7 (spec issue #11): the default Utilities folder — seeded from
 * the bundled examples once, protected from reseeding ever after.
 */
describe('ensureUtilitiesFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.bundledExampleProjects).mockResolvedValue({
      status: 'ok',
      data: EXAMPLE_PATHS,
    })
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: [],
      projectFolders: [],
      activeFolderId: null,
    })
  })

  it('creates the folder with the bundled examples and persists the index', async () => {
    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.projectFolders).toEqual([
      {
        id: UTILITIES_FOLDER_ID,
        name: 'Utilities',
        projectPaths: EXAMPLE_PATHS,
      },
    ])
    expect(state.trustedPaths).toEqual(EXAMPLE_PATHS)
    // saveProjectIndex runs through the serialized save queue.
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: EXAMPLE_PATHS,
          projectFolders: [
            {
              id: UTILITIES_FOLDER_ID,
              name: 'Utilities',
              projectPaths: EXAMPLE_PATHS,
            },
          ],
        })
      )
    })
  })

  it('seeds ahead of the user’s existing folders', async () => {
    useProjectStore.setState({
      projectFolders: [{ id: 'f1', name: 'Set list', projectPaths: [] }],
    })

    await ensureUtilitiesFolder()

    const folders = useProjectStore.getState().projectFolders
    expect(folders).toHaveLength(2)
    expect(folders[0]?.id).toBe(UTILITIES_FOLDER_ID)
    expect(folders[1]?.id).toBe('f1')
  })

  it('is a no-op once the folder exists — later edits stick across launches', async () => {
    await ensureUtilitiesFolder()
    // Let the seeding save flush before clearing, so only a hypothetical
    // reseeding save could be observed below.
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalled()
    })

    // The user moved an example out and removed it from history.
    const second = EXAMPLE_PATHS[1]
    if (!second) throw new Error('Expected two example paths')
    const store = useProjectStore.getState()
    store.removeProjectFromFolder(UTILITIES_FOLDER_ID, second)
    store.removeTrusted(second)
    vi.mocked(commands.savePreferences).mockClear()

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.trustedPaths).toEqual([EXAMPLE_PATHS[0]])
    expect(state.projectFolders[0]?.projectPaths).toEqual([EXAMPLE_PATHS[0]])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('seeds nothing when no bundled example is installed', async () => {
    vi.mocked(commands.bundledExampleProjects).mockResolvedValue({
      status: 'ok',
      data: [],
    })

    await ensureUtilitiesFolder()

    expect(useProjectStore.getState().projectFolders).toEqual([])
    expect(useProjectStore.getState().trustedPaths).toEqual([])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('seeds nothing when the backend lookup fails', async () => {
    vi.mocked(commands.bundledExampleProjects).mockResolvedValue({
      status: 'error',
      error: 'resource dir unavailable',
    })

    await ensureUtilitiesFolder()

    expect(useProjectStore.getState().projectFolders).toEqual([])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
})
