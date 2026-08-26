import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands, type AppPreferences } from '@/lib/tauri-bindings'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { ensureUtilitiesFolder } from './utilities-folder'

const RESOURCES = '/Applications/PNDS.app/Contents/Resources/utilities'
const TOOL_PATHS = [
  `${RESOURCES}/local-network-diagnostics`,
  `${RESOURCES}/multichannel-signal-generator`,
  `${RESOURCES}/telematic-network-diagnostics`,
]

/** Registry ids — the basenames of the staged `<root>/utilities/<id>` paths. */
const TOOL_IDS = TOOL_PATHS.map(path => path.split('/').pop() ?? path)

const TOOL_NAMES = [
  'Local Network Diagnostics',
  'Multichannel Signal Generator',
  'Telematic Network Diagnostics',
]

function mockTools(tools: { path: string; name?: string }[]) {
  vi.mocked(commands.builtinUtilities).mockResolvedValue({
    status: 'ok',
    data: tools.map((tool, index) => ({
      id: tool.path.split('/').pop() ?? tool.path,
      path: tool.path,
      name: tool.name ?? TOOL_NAMES[index] ?? tool.path,
    })),
  })
}

/** The minimal readable disk state; tests add the offer record etc. */
function mockPrefs(preferences: Partial<AppPreferences> = {}) {
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: null, ...preferences },
  })
}

/**
 * v1.2.0 (issue #18): the Utilities folder — seeded once from the built-in
 * tools (unpacked into the app resources at stable paths and run in place),
 * protected from reseeding ever after.
 * v1.3.1 (user report): tool identity is the registry id, not the path —
 * dev and release builds stage the same tool at different roots while
 * sharing the preference domain, and the path-keyed index double-listed
 * every tool once both builds had run.
 */
describe('ensureUtilitiesFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTools(TOOL_PATHS.map(path => ({ path })))
    // The default disk shape: preferences readable, the offer record as
    // a previous launch persisted it (tests that need another shape
    // override this).
    mockPrefs()
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
    const [lnd, msg, tnd] = TOOL_PATHS
    if (!lnd || !msg || !tnd) throw new Error('Expected three tool paths')
    expect(state.manifestProjectNames[lnd]).toBe(TOOL_NAMES[0])
    expect(state.manifestProjectNames[msg]).toBe(TOOL_NAMES[1])
    expect(state.manifestProjectNames[tnd]).toBe(TOOL_NAMES[2])
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
    // The seed also records every admitted tool id as offered — the
    // one-time offer record later removals rely on (ids since v1.3.1;
    // legacy path records still read as their tool).
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ offeredUtilities: TOOL_IDS })
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
    // Let every queued seeding save land (the history adds, the folder
    // commit and the offer record each persist) before clearing, so only
    // a hypothetical reseeding save could be observed below.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(commands.savePreferences).toHaveBeenCalled()

    // The user moved a tool out and removed it from history.
    const second = TOOL_PATHS[1]
    if (!second) throw new Error('Expected a second tool path')
    const store = useProjectStore.getState()
    store.removeProjectFromFolder(UTILITIES_FOLDER_ID, second)
    store.removeRecentProject(second)
    // Those removals persist through the store — let the queue settle
    // before clearing, so only a hypothetical reseeding save could be
    // observed below.
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.mocked(commands.savePreferences).mockClear()
    // Disk state for the next launch: the offer record the seed wrote
    // survives the removals (that is exactly what keeps them sticking).
    mockPrefs({ offeredUtilities: TOOL_PATHS })

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual([TOOL_PATHS[0], TOOL_PATHS[2]])
    expect(state.projectFolders[0]?.projectPaths).toEqual([
      TOOL_PATHS[0],
      TOOL_PATHS[2],
    ])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('offers a newly shipped tool to an upgrade install (issue #55)', async () => {
    // A v1.2.x install: the folder seeded with the first two tools, years
    // before TND shipped and before offeredUtilities was recorded. The
    // bundle now ships three tools — TND must join without touching the
    // existing pair.
    const [lnd, msg, tnd] = TOOL_PATHS
    if (!lnd || !msg || !tnd) throw new Error('Expected three tool paths')
    useProjectStore.setState({
      recentProjectPaths: [lnd, msg],
      projectFolders: [
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: [lnd, msg],
        },
      ],
    })

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual([lnd, msg, tnd])
    expect(state.projectFolders[0]?.projectPaths).toEqual([lnd, msg, tnd])
    // The offer is recorded with the pre-record pair backfilled, so the
    // next launch treats all three tools as already offered.
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ offeredUtilities: TOOL_IDS })
      )
    })
  })

  it('retries a cap-refused offer on a later launch', async () => {
    // The upgrade install arrives with the ungrouped top level at the
    // 30-project cap: TND's history add is refused, so it is neither
    // admitted nor recorded as offered — a later launch with room tries
    // again. The pre-record pair still backfills into the record.
    const [lnd, msg, tnd] = TOOL_PATHS
    if (!lnd || !msg || !tnd) throw new Error('Expected three tool paths')
    useProjectStore.setState({
      recentProjectPaths: [
        ...Array.from({ length: 30 }, (_, i) => `/legacy-${i}`),
        lnd,
        msg,
      ],
      projectFolders: [
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: [lnd, msg],
        },
      ],
    })

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).not.toContain(tnd)
    expect(state.projectFolders[0]?.projectPaths).toEqual([lnd, msg])
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          offeredUtilities: [TOOL_IDS[0], TOOL_IDS[1]],
        })
      )
    })
  })

  it('skips the offer merge when preferences cannot be read', async () => {
    // Without the offer record the merge cannot distinguish a new tool
    // from a removed one — it must do nothing rather than re-offer
    // blindly and wait for the next launch instead.
    const [lnd, msg] = TOOL_PATHS
    if (!lnd || !msg) throw new Error('Expected two tool paths')
    useProjectStore.setState({
      recentProjectPaths: [lnd, msg],
      projectFolders: [
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: [lnd, msg],
        },
      ],
    })
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'error',
      error: 'preferences unavailable',
    })

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual([lnd, msg])
    expect(state.projectFolders[0]?.projectPaths).toEqual([lnd, msg])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('seeds nothing when no built-in tool is available', async () => {
    mockTools([])

    await ensureUtilitiesFolder()

    expect(useProjectStore.getState().projectFolders).toEqual([])
    expect(useProjectStore.getState().recentProjectPaths).toEqual([])
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('seeds only the tools the cap admits (issue #26 upgrade edge)', async () => {
    // An upgrade from before Utilities existed can arrive with the
    // ungrouped top level already at the 30-project cap — every history
    // add is refused, so the folder seeds empty rather than listing
    // entries the sidebar cannot show.
    useProjectStore.setState({
      recentProjectPaths: Array.from({ length: 30 }, (_, i) => `/legacy-${i}`),
    })

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toHaveLength(30)
    expect(state.projectFolders).toEqual([
      { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
    ])
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

  it('refreshes stale-root copies away — one entry per tool, and back again (v1.3.1 report)', async () => {
    // The installed app seeded its three paths; the dev build then
    // offered its own — six members for three tools. Records written by
    // both launches hold their path spellings.
    const DEV = '/Users/dev/PNDS-App/src-tauri/target/debug/utilities'
    const DEV_PATHS = TOOL_IDS.map(id => `${DEV}/${id}`)
    const MY_SCORE = '/Users/x/My Score'
    useProjectStore.setState({
      recentProjectPaths: [...TOOL_PATHS, MY_SCORE, ...DEV_PATHS],
      projectFolders: [
        { id: 'perform', name: 'Perform', projectPaths: [MY_SCORE] },
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: [...TOOL_PATHS, ...DEV_PATHS],
        },
      ],
    })
    mockTools(DEV_PATHS.map(path => ({ path })))
    mockPrefs({ offeredUtilities: [...TOOL_PATHS, ...DEV_PATHS] })

    await ensureUtilitiesFolder()

    // The dev launch settles on the dev root: the installed copies leave
    // the index (history and every folder), the kept tools re-materialize
    // at the current root, and unrelated projects are untouched.
    let state = useProjectStore.getState()
    expect(
      state.projectFolders.find(folder => folder.id === UTILITIES_FOLDER_ID)
        ?.projectPaths
    ).toEqual(DEV_PATHS)
    expect(state.recentProjectPaths).toEqual([MY_SCORE, ...DEV_PATHS])
    expect(
      state.projectFolders.find(folder => folder.id === 'perform')?.projectPaths
    ).toEqual([MY_SCORE])

    // Ping-pong: the installed app's next launch settles on ITS root —
    // no third copy, no re-offer (the ids are recorded by then).
    mockTools(TOOL_PATHS.map(path => ({ path })))
    mockPrefs({ offeredUtilities: TOOL_IDS })

    await ensureUtilitiesFolder()

    state = useProjectStore.getState()
    expect(
      state.projectFolders.find(folder => folder.id === UTILITIES_FOLDER_ID)
        ?.projectPaths
    ).toEqual(TOOL_PATHS)
    expect(state.recentProjectPaths).toEqual([MY_SCORE, ...TOOL_PATHS])
  })

  it('a legacy path record counts as its tool — only genuinely new ids are offered', async () => {
    const [lnd, tnd] = [TOOL_PATHS[0], TOOL_PATHS[2]]
    if (!lnd || !tnd) throw new Error('Expected two tool paths')
    useProjectStore.setState({
      recentProjectPaths: [lnd],
      projectFolders: [
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: [lnd],
        },
      ],
    })
    // The record predates id-keying and holds a path of LND from another
    // staging root — it must still cover LND's one-time offer, while TND
    // is genuinely new.
    mockTools([lnd, tnd].map(path => ({ path })))
    mockPrefs({ offeredUtilities: [lnd] })

    await ensureUtilitiesFolder()

    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual([lnd, tnd])
    expect(
      state.projectFolders.find(folder => folder.id === UTILITIES_FOLDER_ID)
        ?.projectPaths
    ).toEqual([lnd, tnd])
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ offeredUtilities: [lnd, TOOL_IDS[2]] })
      )
    })
  })
})
