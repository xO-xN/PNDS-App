import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { ensureUtilitiesFolder } from './utilities-folder'

const BUNDLES = '~/Library/Application Support/com.xo-xn.pnds-app/bundles'
const TOOL_PATHS = [
  `${BUNDLES}/local-network-diagnostics-0.1.0`,
  `${BUNDLES}/multichannel-signal-generator-1.0.0`,
]

const TOOL_NAMES = [
  'Local Network Diagnostics',
  'Multichannel Signal Generator',
]

function mockTools(
  tools: {
    path: string
    name?: string
    supersededPaths?: string[]
  }[]
) {
  vi.mocked(commands.syncBuiltinTools).mockResolvedValue({
    status: 'ok',
    data: tools.map((tool, index) => ({
      path: tool.path,
      name: tool.name ?? TOOL_NAMES[index] ?? tool.path,
      supersededPaths: tool.supersededPaths ?? [],
    })),
  })
}

/**
 * v1.2.0 (issue #18): the Utilities folder — seeded once from the installed
 * built-in tools, protected from reseeding ever after, with version bumps
 * swapping a member tool's slot instead of re-adding removed ones.
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
    })
  })

  it('creates the folder with the installed tools and persists the index', async () => {
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
    const [lndPath, msgPath] = TOOL_PATHS
    const [lndName, msgName] = TOOL_NAMES
    if (!lndPath || !msgPath || !lndName || !msgName) {
      throw new Error('Expected two tools')
    }
    expect(state.manifestProjectNames[lndPath]).toBe(lndName)
    expect(state.manifestProjectNames[msgPath]).toBe(msgName)
    // saveProjectIndex runs through the serialized save queue.
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
    // Let the seeding save flush before clearing, so only a hypothetical
    // reseeding save could be observed below.
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalled()
    })

    // The user moved a tool out and removed it from history.
    const second = TOOL_PATHS[1]
    if (!second) throw new Error('Expected two tool paths')
    const store = useProjectStore.getState()
    store.removeProjectFromFolder(UTILITIES_FOLDER_ID, second)
    store.removeRecentProject(second)
    vi.mocked(commands.savePreferences).mockClear()

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual([TOOL_PATHS[0]])
    expect(state.projectFolders[0]?.projectPaths).toEqual([TOOL_PATHS[0]])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('swaps the slot and prunes history on a registry version bump', async () => {
    await ensureUtilitiesFolder()
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalled()
    })

    // The next sync reports 1.1.0 installed and the 0.1.0 dir reclaimed.
    const [lnd, msg] = TOOL_PATHS
    if (!lnd || !msg) throw new Error('Expected two tool paths')
    const bumped = `${BUNDLES}/local-network-diagnostics-1.1.0`
    mockTools([{ path: bumped, supersededPaths: [lnd] }, { path: msg }])
    vi.mocked(commands.savePreferences).mockClear()

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    const utilities = state.projectFolders.find(
      folder => folder.id === UTILITIES_FOLDER_ID
    )
    // The new path takes over the old slot — order survives the bump, and
    // the reclaimed path is gone from both membership and history.
    expect(utilities?.projectPaths).toEqual([bumped, msg])
    expect(state.recentProjectPaths).toContain(bumped)
    expect(state.recentProjectPaths).not.toContain(lnd)
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectFolders: expect.arrayContaining([
            expect.objectContaining({
              id: UTILITIES_FOLDER_ID,
              projectPaths: [bumped, msg],
            }),
          ]),
        })
      )
    })
  })

  it('does not re-add a tool the user removed just because it bumped versions', async () => {
    await ensureUtilitiesFolder()
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalled()
    })

    // The user removed the first tool entirely.
    const [first, second] = TOOL_PATHS
    if (!first || !second) throw new Error('Expected two tool paths')
    const store = useProjectStore.getState()
    store.removeProjectFromFolder(UTILITIES_FOLDER_ID, first)
    store.removeRecentProject(first)

    // Later the registry bumps it — no member of that tool remains, so the
    // new version must NOT be re-added.
    const bumped = `${BUNDLES}/local-network-diagnostics-1.1.0`
    mockTools([{ path: bumped, supersededPaths: [first] }, { path: second }])
    vi.mocked(commands.savePreferences).mockClear()

    await ensureUtilitiesFolder()

    const utilities = useProjectStore
      .getState()
      .projectFolders.find(folder => folder.id === UTILITIES_FOLDER_ID)
    expect(utilities?.projectPaths).toEqual([TOOL_PATHS[1]])
    expect(useProjectStore.getState().recentProjectPaths).not.toContain(bumped)
  })

  it('seeds nothing when no built-in tool is available', async () => {
    mockTools([])

    await ensureUtilitiesFolder()

    expect(useProjectStore.getState().projectFolders).toEqual([])
    expect(useProjectStore.getState().recentProjectPaths).toEqual([])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('seeds nothing when the backend sync fails', async () => {
    vi.mocked(commands.syncBuiltinTools).mockResolvedValue({
      status: 'error',
      error: 'app data dir unavailable',
    })

    await ensureUtilitiesFolder()

    expect(useProjectStore.getState().projectFolders).toEqual([])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
})
