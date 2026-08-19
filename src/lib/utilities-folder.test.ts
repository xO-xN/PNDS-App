import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { ensureUtilitiesFolder } from './utilities-folder'

const RESOURCES = '/Applications/PNDS.app/Contents/Resources/utilities'
const TOOL_PATHS = [
  `${RESOURCES}/local-network-diagnostics`,
  `${RESOURCES}/multichannel-signal-generator`,
]

const TOOL_NAMES = [
  'Local Network Diagnostics',
  'Multichannel Signal Generator',
]

function mockTools(tools: { path: string; name?: string }[]) {
  vi.mocked(commands.builtinUtilities).mockResolvedValue({
    status: 'ok',
    data: tools.map((tool, index) => ({
      path: tool.path,
      name: tool.name ?? TOOL_NAMES[index] ?? tool.path,
    })),
  })
}

/**
 * v1.2.0 (issue #18): the Utilities folder — seeded once from the built-in
 * tools (unpacked into the app resources at stable paths and run in place),
 * protected from reseeding ever after.
 */
describe('ensureUtilitiesFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTools(TOOL_PATHS.map(path => ({ path })))
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      activeFolderId: null,
      manifestProjectNames: {},
    })
  })

  it('creates the folder with the staged tools and persists the index', async () => {
    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.projectFolders).toEqual([
      {
        id: UTILITIES_FOLDER_ID,
        name: 'Utilities',
        projectPaths: TOOL_PATHS,
      },
    ])
    expect(state.recentProjectPaths).toEqual(TOOL_PATHS)
    // The manifest names are learned up front, so the entries read by
    // name on a clean install before their first preflight.
    const [lnd, msg] = TOOL_PATHS
    if (!lnd || !msg) throw new Error('Expected two tool paths')
    expect(state.manifestProjectNames[lnd]).toBe(TOOL_NAMES[0])
    expect(state.manifestProjectNames[msg]).toBe(TOOL_NAMES[1])
    // saveProjectIndex runs through the serialized save queue — the store's
    // structural commits (history adds + the folder seed) each persist.
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: TOOL_PATHS,
          projectFolders: [
            {
              id: UTILITIES_FOLDER_ID,
              name: 'Utilities',
              projectPaths: TOOL_PATHS,
            },
          ],
        })
      )
    })
  })

  it('seeds below the user’s existing folders (bottom-pinned)', async () => {
    useProjectStore.setState({
      projectFolders: [{ id: 'f1', name: 'Set list', projectPaths: [] }],
    })

    await ensureUtilitiesFolder()

    const folders = useProjectStore.getState().projectFolders
    expect(folders).toHaveLength(2)
    expect(folders[0]?.id).toBe('f1')
    expect(folders[1]?.id).toBe(UTILITIES_FOLDER_ID)
  })

  it('moves an existing Utilities folder to the bottom (front-seeded installs migrate)', async () => {
    // Installs seeded before the pin have it first — the next launch
    // settles it last, persisting the migrated order.
    useProjectStore.setState({
      projectFolders: [
        { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
        { id: 'f1', name: 'Set list', projectPaths: [] },
      ],
    })
    vi.mocked(commands.savePreferences).mockClear()

    await ensureUtilitiesFolder()

    const folders = useProjectStore.getState().projectFolders
    expect(folders.map(folder => folder.id)).toEqual([
      'f1',
      UTILITIES_FOLDER_ID,
    ])
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalled()
    })
  })

  it('is a no-op once the folder exists — later edits stick across launches', async () => {
    await ensureUtilitiesFolder()
    // Let every queued seeding save land (the history adds and the folder
    // commit each persist) before clearing, so only a hypothetical
    // reseeding save could be observed below.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(commands.savePreferences).toHaveBeenCalled()

    // The user moved a tool out and removed it from history.
    const second = TOOL_PATHS[1]
    if (!second) throw new Error('Expected two tool paths')
    const store = useProjectStore.getState()
    store.removeProjectFromFolder(UTILITIES_FOLDER_ID, second)
    store.removeRecentProject(second)
    // Those removals persist through the store — let the queue settle
    // before clearing, so only a hypothetical reseeding save could be
    // observed below.
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.mocked(commands.savePreferences).mockClear()

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual([TOOL_PATHS[0]])
    expect(state.projectFolders[0]?.projectPaths).toEqual([TOOL_PATHS[0]])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('seeds nothing when no built-in tool is available', async () => {
    mockTools([])

    await ensureUtilitiesFolder()

    expect(useProjectStore.getState().projectFolders).toEqual([])
    expect(useProjectStore.getState().recentProjectPaths).toEqual([])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('seeds nothing when the backend lookup fails', async () => {
    vi.mocked(commands.builtinUtilities).mockResolvedValue({
      status: 'error',
      error: 'app resources unavailable',
    })

    await ensureUtilitiesFolder()

    expect(useProjectStore.getState().projectFolders).toEqual([])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
})
