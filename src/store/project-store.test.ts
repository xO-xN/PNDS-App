import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useProjectStore,
  ungroupedProjectPaths,
  visibleProjectPaths,
  isProtectedFolder,
  UTILITIES_FOLDER_ID,
} from './project-store'
import { commands, type Manifest } from '@/lib/tauri-bindings'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

describe('project-store', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      manifestProjectNames: {},
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('starts with an empty history and idle preflight', () => {
    expect(useProjectStore.getState().recentProjectPaths).toEqual([])
    expect(useProjectStore.getState().preflightStatus).toBe('idle')
  })

  it('adds a project path to the history without duplication', () => {
    useProjectStore.getState().addRecentProject('/Users/test/Project')
    expect(useProjectStore.getState().recentProjectPaths).toContain(
      '/Users/test/Project'
    )

    // Adding again must not duplicate the entry
    useProjectStore.getState().addRecentProject('/Users/test/Project')
    expect(useProjectStore.getState().recentProjectPaths).toHaveLength(1)
  })

  it('tracks the preflight lifecycle', () => {
    useProjectStore.getState().startPreflight()
    expect(useProjectStore.getState().preflightStatus).toBe('checking')

    useProjectStore.getState().preflightSucceeded('/p', manifest)
    const state = useProjectStore.getState()
    expect(state.preflightStatus).toBe('ready')
    expect(state.currentProject?.manifest.name).toBe('Inarticulate III')
    expect(state.preflightError).toBeNull()
  })

  it('learns the manifest name on every successful preflight (issue #16)', () => {
    useProjectStore
      .getState()
      .preflightSucceeded('/bundles/inarticulate-iii-0.1.0', manifest)
    // A later preflight of another project keeps the first entry.
    useProjectStore.getState().preflightSucceeded('/other', {
      ...manifest,
      name: 'Other Score',
    })

    expect(useProjectStore.getState().manifestProjectNames).toEqual({
      '/bundles/inarticulate-iii-0.1.0': 'Inarticulate III',
      '/other': 'Other Score',
    })
  })

  it('restores the learned manifest names from preferences', () => {
    useProjectStore
      .getState()
      .setManifestProjectNames({ '/p': 'Inarticulate III' })

    expect(useProjectStore.getState().manifestProjectNames).toEqual({
      '/p': 'Inarticulate III',
    })
  })

  it('records a readable error and clears the project on failure', () => {
    useProjectStore.getState().preflightSucceeded('/p', manifest)
    useProjectStore
      .getState()
      .preflightFailed('manifest.json missing required field')
    const state = useProjectStore.getState()
    expect(state.preflightStatus).toBe('error')
    expect(state.preflightError).toContain('missing required field')
    expect(state.currentProject).toBeNull()
  })

  it('clearProject resets the session state but keeps the history', () => {
    useProjectStore.getState().addRecentProject('/p')
    useProjectStore.getState().preflightSucceeded('/p', manifest)
    useProjectStore.getState().clearProject()
    const state = useProjectStore.getState()
    expect(state.currentProject).toBeNull()
    expect(state.preflightStatus).toBe('idle')
    expect(state.recentProjectPaths).toEqual(['/p'])
  })

  it('removeRecentProject drops a path and clears it if it was current', () => {
    useProjectStore.getState().addRecentProject('/a')
    useProjectStore.getState().addRecentProject('/b')
    useProjectStore.getState().preflightSucceeded('/a', manifest)

    useProjectStore.getState().removeRecentProject('/a')
    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual(['/b'])
    expect(state.currentProject).toBeNull()
    expect(state.preflightStatus).toBe('idle')
  })

  it('clearRecentProjects empties the history, memberships and selection (v1.2.0)', () => {
    useProjectStore.getState().addRecentProject('/a')
    useProjectStore.getState().addRecentProject('/b')
    useProjectStore.getState().preflightSucceeded('/a', manifest)
    const folderId = useProjectStore.getState().createFolder('Set list')
    useProjectStore.getState().moveProjectToFolder(folderId, '/b')

    useProjectStore.getState().clearRecentProjects()
    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual([])
    // Folders survive as empty shells (the Utilities folder stays, too).
    expect(state.projectFolders).toHaveLength(1)
    expect(state.projectFolders[0]?.projectPaths).toEqual([])
    expect(state.currentProject).toBeNull()
    expect(state.preflightStatus).toBe('idle')
  })
})

describe('project-store folders (v1.1.2, spec issue #4)', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a', '/b', '/c'],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('creates folders at the top of the folder area, with unique ids, and renames them', () => {
    const store = useProjectStore.getState()
    const id1 = store.createFolder('Gig Friday')
    const id2 = store.createFolder('Gig Saturday')
    expect(id1).not.toBe(id2)
    // v1.2.0: a new folder opens at the top — newest first.
    expect(useProjectStore.getState().projectFolders.map(f => f.name)).toEqual([
      'Gig Saturday',
      'Gig Friday',
    ])

    store.renameFolder(id1, 'Renamed')
    expect(useProjectStore.getState().projectFolders.map(f => f.name)).toEqual([
      'Gig Saturday',
      'Renamed',
    ])
  })

  it('pins the Utilities folder last through folder reorder commits', () => {
    const store = useProjectStore.getState()
    const id1 = store.createFolder('One')
    const id2 = store.createFolder('Two')
    useProjectStore.setState({
      projectFolders: [
        ...useProjectStore.getState().projectFolders,
        { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [] },
      ],
    })

    // A drag that computes Utilities first still settles it last.
    useProjectStore
      .getState()
      .applyFolderReorder([UTILITIES_FOLDER_ID, id2, id1])
    expect(useProjectStore.getState().projectFolders.map(f => f.id)).toEqual([
      id2,
      id1,
      UTILITIES_FOLDER_ID,
    ])
  })

  it('deleting a folder returns its projects to ungrouped (never removed from history)', () => {
    const store = useProjectStore.getState()
    const id = store.createFolder('Set list')
    store.moveProjectToFolder(id, '/a')
    store.moveProjectToFolder(id, '/b')
    expect(
      ungroupedProjectPaths(
        useProjectStore.getState().recentProjectPaths,
        useProjectStore.getState().projectFolders
      )
    ).toEqual(['/c'])

    store.deleteFolder(id)
    const state = useProjectStore.getState()
    expect(state.projectFolders).toEqual([])
    expect(state.recentProjectPaths).toEqual(['/a', '/b', '/c'])
    expect(
      ungroupedProjectPaths(state.recentProjectPaths, state.projectFolders)
    ).toEqual(['/a', '/b', '/c'])
  })

  it('moving into a folder removes membership from any previous folder', () => {
    const store = useProjectStore.getState()
    const id1 = store.createFolder('One')
    const id2 = store.createFolder('Two')
    store.moveProjectToFolder(id1, '/a')
    store.moveProjectToFolder(id2, '/a')

    const folders = useProjectStore.getState().projectFolders
    expect(folders.find(f => f.id === id1)?.projectPaths).toEqual([])
    expect(folders.find(f => f.id === id2)?.projectPaths).toEqual(['/a'])
  })

  it('removeProjectFromFolder returns a single path to ungrouped', () => {
    const store = useProjectStore.getState()
    const id = store.createFolder('Set list')
    store.moveProjectToFolder(id, '/a')
    store.moveProjectToFolder(id, '/b')

    store.removeProjectFromFolder(id, '/a')
    const folders = useProjectStore.getState().projectFolders
    expect(folders.find(f => f.id === id)?.projectPaths).toEqual(['/b'])
    expect(
      ungroupedProjectPaths(
        useProjectStore.getState().recentProjectPaths,
        folders
      )
    ).toEqual(['/a', '/c'])
  })

  it('removeRecentProject drops folder membership too (index-only delete)', () => {
    const store = useProjectStore.getState()
    const id = store.createFolder('Set list')
    store.moveProjectToFolder(id, '/b')

    store.removeRecentProject('/b')
    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual(['/a', '/c'])
    expect(state.projectFolders[0]?.projectPaths).toEqual([])
    expect(state.projectFolders).toHaveLength(1) // empty folder survives
  })

  it('folder cards never take a number: ungrouped derives from the master list', () => {
    const store = useProjectStore.getState()
    const id = store.createFolder('Set list')
    store.moveProjectToFolder(id, '/b')
    // Master-list order is reflected in the ungrouped order.
    useProjectStore.setState({ recentProjectPaths: ['/c', '/a', '/b'] })
    expect(
      ungroupedProjectPaths(
        useProjectStore.getState().recentProjectPaths,
        useProjectStore.getState().projectFolders
      )
    ).toEqual(['/c', '/a'])
  })
})

describe('folder-aware view derivation (v1.1.2 T3, spec issue #7)', () => {
  let folderId: string

  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a', '/b', '/c', '/d'],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    folderId = useProjectStore.getState().createFolder('Set list')
    const store = useProjectStore.getState()
    store.moveProjectToFolder(folderId, '/b')
    store.moveProjectToFolder(folderId, '/d')
  })

  /** The derivation under the store's current view state. */
  const visible = () => {
    const state = useProjectStore.getState()
    return visibleProjectPaths(
      state.recentProjectPaths,
      state.projectFolders,
      state.activeFolderId
    )
  }

  it('top level shows only ungrouped projects, in master-list order', () => {
    expect(visible()).toEqual(['/a', '/c'])
  })

  it('folder view shows only members, in set order (not master order)', () => {
    useProjectStore.getState().setActiveFolderId(folderId)
    expect(visible()).toEqual(['/b', '/d'])
  })

  it('reordering inside the folder re-derives immediately (badge source)', () => {
    useProjectStore.getState().setActiveFolderId(folderId)
    useProjectStore.getState().applyVisibleReorder(['/d', '/b'])
    expect(visible()).toEqual(['/d', '/b'])

    // Leaving the folder restores the flat top-level numbering source.
    useProjectStore.getState().setActiveFolderId(null)
    expect(visible()).toEqual(['/a', '/c'])
  })

  it('deleting the drilled-in folder exits back to the top level', () => {
    useProjectStore.getState().setActiveFolderId(folderId)
    useProjectStore.getState().deleteFolder(folderId)
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(visible()).toEqual(['/a', '/b', '/c', '/d'])
  })

  it('a folder with more than nine members still derives the full list', () => {
    const store = useProjectStore.getState()
    for (let i = 0; i < 8; i++) {
      store.addRecentProject(`/extra-${i}`)
      store.moveProjectToFolder(folderId, `/extra-${i}`)
    }
    store.setActiveFolderId(folderId)
    expect(visible()).toHaveLength(10) // the 1..9 cap is presentation
  })

  it('an unknown folder id derives an empty view, never the top level', () => {
    useProjectStore.getState().setActiveFolderId('does-not-exist')
    expect(visible()).toEqual([])
  })
})

describe('visible reorder from drags (v1.1.2 T4, spec issue #8)', () => {
  let folderId: string

  beforeEach(() => {
    // Master [a, b, c, d, e] with b and d filed away; ungrouped [a, c, e].
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a', '/b', '/c', '/d', '/e'],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    folderId = useProjectStore.getState().createFolder('Set list')
    const store = useProjectStore.getState()
    store.moveProjectToFolder(folderId, '/b')
    store.moveProjectToFolder(folderId, '/d')
  })

  it('a top-level drop remaps the master list, folder members keep their slots', () => {
    useProjectStore.getState().applyVisibleReorder(['/c', '/e', '/a'])
    const state = useProjectStore.getState()
    expect(state.recentProjectPaths).toEqual(['/c', '/b', '/e', '/d', '/a'])
    expect(
      state.projectFolders.find(f => f.id === folderId)?.projectPaths
    ).toEqual(['/b', '/d'])
    // The ungrouped view now derives the dragged order.
    expect(
      visibleProjectPaths(state.recentProjectPaths, state.projectFolders, null)
    ).toEqual(['/c', '/e', '/a'])
  })

  it('a folder-view drop replaces the member order only', () => {
    useProjectStore.getState().setActiveFolderId(folderId)
    useProjectStore.getState().applyVisibleReorder(['/d', '/b'])
    const state = useProjectStore.getState()
    expect(
      state.projectFolders.find(f => f.id === folderId)?.projectPaths
    ).toEqual(['/d', '/b'])
    // The master list is untouched at the top level.
    expect(state.recentProjectPaths).toEqual(['/a', '/b', '/c', '/d', '/e'])
  })

  it('ignores a set that is not the current visible list', () => {
    useProjectStore.getState().applyVisibleReorder(['/a', '/c'])
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      '/a',
      '/b',
      '/c',
      '/d',
      '/e',
    ])

    useProjectStore.getState().setActiveFolderId(folderId)
    useProjectStore.getState().applyVisibleReorder(['/b', '/x'])
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      '/b',
      '/d',
    ])
  })
})

describe('folder reorder from drags (v1.1.2 T5, spec issue #9)', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a'],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('reorders the folder cards by id, memberships untouched', () => {
    const store = useProjectStore.getState()
    const first = store.createFolder('Friday')
    const second = store.createFolder('Saturday')
    const third = store.createFolder('Sunday')

    useProjectStore.getState().applyFolderReorder([third, first, second])

    expect(
      useProjectStore.getState().projectFolders.map(folder => folder.id)
    ).toEqual([third, first, second])
    expect(
      useProjectStore.getState().projectFolders.map(folder => folder.name)
    ).toEqual(['Sunday', 'Friday', 'Saturday'])
  })

  it('ignores an id set that is not the current folder set', () => {
    const store = useProjectStore.getState()
    const first = store.createFolder('Friday')
    const second = store.createFolder('Saturday')
    const before = useProjectStore.getState().projectFolders

    // Missing, foreign and duplicated ids are all rejected.
    useProjectStore.getState().applyFolderReorder([first])
    useProjectStore.getState().applyFolderReorder([first, 'nope'])
    useProjectStore.getState().applyFolderReorder([first, first])
    expect(useProjectStore.getState().projectFolders).toBe(before)
    // Newest-created first (v1.2.0 top insertion).
    expect(
      useProjectStore.getState().projectFolders.map(folder => folder.id)
    ).toEqual([second, first])
  })
})

describe('protected folders (v1.1.2 T7, spec issue #11)', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a', '/b'],
      projectFolders: [
        {
          id: UTILITIES_FOLDER_ID,
          name: 'Utilities',
          projectPaths: ['/a', '/b'],
        },
      ],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('never renames the Utilities folder', () => {
    useProjectStore.getState().renameFolder(UTILITIES_FOLDER_ID, 'Renamed')
    expect(useProjectStore.getState().projectFolders[0]?.name).toBe('Utilities')
  })

  it('never deletes the Utilities folder', () => {
    useProjectStore.getState().deleteFolder(UTILITIES_FOLDER_ID)
    expect(useProjectStore.getState().projectFolders).toHaveLength(1)
  })

  it('still allows editing the Utilities membership (files like any folder)', () => {
    useProjectStore
      .getState()
      .removeProjectFromFolder(UTILITIES_FOLDER_ID, '/b')
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      '/a',
    ])

    useProjectStore.getState().moveProjectToFolder(UTILITIES_FOLDER_ID, '/b')
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      '/a',
      '/b',
    ])
  })

  it('flags only the reserved id as protected', () => {
    expect(isProtectedFolder(UTILITIES_FOLDER_ID)).toBe(true)
    expect(isProtectedFolder('utilities-2')).toBe(false)
    expect(isProtectedFolder(crypto.randomUUID())).toBe(false)
  })
})

/**
 * Structural actions persist the index (and the name maps) as part of
 * their commit — the v1.2.0 architecture refactor removed the callers'
 * save pairing, so persistence is now assertable through the store's own
 * interface. No-op guards and the bulk launch restore must write nothing.
 */
describe('project-store persistence (structural actions commit + save)', () => {
  /** Lets the serialized save queue settle before a not-called assert. */
  async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      projectDisplayNames: {},
      manifestProjectNames: {},
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('addRecentProject persists history and folders together', async () => {
    useProjectStore.getState().addRecentProject('/a')

    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: ['/a'],
          projectFolders: [],
        })
      )
    })
  })

  it('removeRecentProject persists the shrunk index in one commit', async () => {
    useProjectStore.getState().restoreProjectIndex(['/a', '/b'], [])

    useProjectStore.getState().removeRecentProject('/a')

    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: ['/b'],
        })
      )
    })
  })

  it('re-adding a known path writes nothing', async () => {
    useProjectStore.getState().restoreProjectIndex(['/a'], [])
    await settle()
    vi.mocked(commands.savePreferences).mockClear()

    useProjectStore.getState().addRecentProject('/a')
    await settle()

    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('protected-folder no-ops and ignored drag sets write nothing', async () => {
    useProjectStore
      .getState()
      .restoreProjectIndex(
        ['/a', '/b'],
        [{ id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: ['/a'] }]
      )
    await settle()
    vi.mocked(commands.savePreferences).mockClear()

    useProjectStore.getState().renameFolder(UTILITIES_FOLDER_ID, 'X')
    useProjectStore.getState().deleteFolder(UTILITIES_FOLDER_ID)
    // Not the current visible list — the reorder is ignored.
    useProjectStore.getState().applyVisibleReorder(['/unrelated'])
    await settle()

    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('restoreProjectIndex (launch restore) never writes back', async () => {
    useProjectStore
      .getState()
      .restoreProjectIndex(
        ['/a', '/b'],
        [{ id: 'f1', name: 'Set list', projectPaths: ['/a'] }]
      )
    await settle()

    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('setProjectDisplayName persists the override map', async () => {
    useProjectStore.getState().setProjectDisplayName('/a', 'My Score')

    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ projectDisplayNames: { '/a': 'My Score' } })
      )
    })

    // Committing the same name again writes nothing.
    vi.mocked(commands.savePreferences).mockClear()
    useProjectStore.getState().setProjectDisplayName('/a', 'My Score')
    await settle()
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('preflightSucceeded persists the manifest name only when it is new', async () => {
    useProjectStore.getState().preflightSucceeded('/a', manifest)
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectManifestNames: { '/a': 'Inarticulate III' },
        })
      )
    })

    vi.mocked(commands.savePreferences).mockClear()
    useProjectStore.getState().preflightSucceeded('/a', manifest)
    await settle()
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('upsertManifestProjectNames merges and persists only real changes', async () => {
    useProjectStore.getState().upsertManifestProjectNames({ '/a': 'Tool A' })
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectManifestNames: { '/a': 'Tool A' },
        })
      )
    })

    useProjectStore
      .getState()
      .upsertManifestProjectNames({ '/a': 'Tool A', '/b': 'Tool B' })
    await vi.waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          projectManifestNames: { '/a': 'Tool A', '/b': 'Tool B' },
        })
      )
    })

    vi.mocked(commands.savePreferences).mockClear()
    useProjectStore
      .getState()
      .upsertManifestProjectNames({ '/a': 'Tool A', '/b': 'Tool B' })
    await settle()
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
})
