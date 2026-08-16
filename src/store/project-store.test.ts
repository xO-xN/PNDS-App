import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore, ungroupedProjectPaths } from './project-store'
import type { Manifest } from '@/lib/tauri-bindings'

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
      trustedPaths: [],
      projectFolders: [],
      pendingTrustPath: null,
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('starts untrusted and idle', () => {
    expect(useProjectStore.getState().isTrusted('/any/path')).toBe(false)
    expect(useProjectStore.getState().preflightStatus).toBe('idle')
  })

  it('trusts a project path once confirmed (§4)', () => {
    useProjectStore.getState().trustProject('/Users/test/Project')
    expect(useProjectStore.getState().isTrusted('/Users/test/Project')).toBe(
      true
    )

    // Trusting again must not duplicate the entry
    useProjectStore.getState().trustProject('/Users/test/Project')
    expect(useProjectStore.getState().trustedPaths).toHaveLength(1)
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

  it('clearProject resets the session state but keeps trust', () => {
    useProjectStore.getState().trustProject('/p')
    useProjectStore.getState().preflightSucceeded('/p', manifest)
    useProjectStore.getState().clearProject()
    const state = useProjectStore.getState()
    expect(state.currentProject).toBeNull()
    expect(state.preflightStatus).toBe('idle')
    expect(state.isTrusted('/p')).toBe(true)
  })

  it('removeTrusted drops a path and clears it if it was current', () => {
    useProjectStore.getState().trustProject('/a')
    useProjectStore.getState().trustProject('/b')
    useProjectStore.getState().preflightSucceeded('/a', manifest)

    useProjectStore.getState().removeTrusted('/a')
    const state = useProjectStore.getState()
    expect(state.trustedPaths).toEqual(['/b'])
    expect(state.currentProject).toBeNull()
    expect(state.preflightStatus).toBe('idle')
  })

  it('moveTrusted reorders the history list', () => {
    useProjectStore.getState().trustProject('/a')
    useProjectStore.getState().trustProject('/b')
    useProjectStore.getState().trustProject('/c')

    useProjectStore.getState().moveTrusted('/c', '/a')
    expect(useProjectStore.getState().trustedPaths).toEqual(['/c', '/a', '/b'])

    // Moving to itself or unknown paths is a no-op
    useProjectStore.getState().moveTrusted('/c', '/c')
    useProjectStore.getState().moveTrusted('/x', '/a')
    expect(useProjectStore.getState().trustedPaths).toEqual(['/c', '/a', '/b'])
  })
})

describe('project-store folders (v1.1.2, spec issue #4)', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      trustedPaths: ['/a', '/b', '/c'],
      projectFolders: [],
      pendingTrustPath: null,
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('creates folders with unique ids and renames them', () => {
    const store = useProjectStore.getState()
    const id1 = store.createFolder('Gig Friday')
    const id2 = store.createFolder('Gig Saturday')
    expect(id1).not.toBe(id2)

    store.renameFolder(id1, 'Renamed')
    expect(useProjectStore.getState().projectFolders.map(f => f.name)).toEqual([
      'Renamed',
      'Gig Saturday',
    ])
  })

  it('deleting a folder returns its projects to ungrouped (never untrusted)', () => {
    const store = useProjectStore.getState()
    const id = store.createFolder('Set list')
    store.moveProjectToFolder(id, '/a')
    store.moveProjectToFolder(id, '/b')
    expect(
      ungroupedProjectPaths(
        useProjectStore.getState().trustedPaths,
        useProjectStore.getState().projectFolders
      )
    ).toEqual(['/c'])

    store.deleteFolder(id)
    const state = useProjectStore.getState()
    expect(state.projectFolders).toEqual([])
    expect(state.trustedPaths).toEqual(['/a', '/b', '/c'])
    expect(
      ungroupedProjectPaths(state.trustedPaths, state.projectFolders)
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
      ungroupedProjectPaths(useProjectStore.getState().trustedPaths, folders)
    ).toEqual(['/a', '/c'])
  })

  it('removeTrusted drops folder membership too (index-only delete)', () => {
    const store = useProjectStore.getState()
    const id = store.createFolder('Set list')
    store.moveProjectToFolder(id, '/b')

    store.removeTrusted('/b')
    const state = useProjectStore.getState()
    expect(state.trustedPaths).toEqual(['/a', '/c'])
    expect(state.projectFolders[0]?.projectPaths).toEqual([])
    expect(state.projectFolders).toHaveLength(1) // empty folder survives
  })

  it('moveWithinFolder reorders the in-folder order and persists it', () => {
    const store = useProjectStore.getState()
    const id = store.createFolder('Set list')
    store.moveProjectToFolder(id, '/a')
    store.moveProjectToFolder(id, '/b')
    store.moveProjectToFolder(id, '/c')

    store.moveWithinFolder(id, '/c', '/a')
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      '/c',
      '/a',
      '/b',
    ])

    // Unknown paths or same path are no-ops
    store.moveWithinFolder(id, '/x', '/a')
    store.moveWithinFolder(id, '/a', '/a')
    expect(useProjectStore.getState().projectFolders[0]?.projectPaths).toEqual([
      '/c',
      '/a',
      '/b',
    ])
  })

  it('folder cards never take a number: ungrouped derives from the master list', () => {
    const store = useProjectStore.getState()
    const id = store.createFolder('Set list')
    store.moveProjectToFolder(id, '/b')
    // Master-list reorder is reflected in the ungrouped order.
    store.moveTrusted('/c', '/a')
    expect(
      ungroupedProjectPaths(
        useProjectStore.getState().trustedPaths,
        useProjectStore.getState().projectFolders
      )
    ).toEqual(['/c', '/a'])
  })
})
