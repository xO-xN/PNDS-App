import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import {
  moveFolderSelection,
  moveProjectSelection,
  nextFolderView,
  selectProject,
} from './project-select'
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

/**
 * v1.1.2 选中语义统一 (spec issue #4): the card click and the Cmd+number
 * keyboard layer share this entry, so the semantics are asserted once here.
 */
describe('selectProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a', '/b'],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('selects and preflights an idle project without starting it (§8)', () => {
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })

    selectProject('/a')

    expect(commands.preflightProject).toHaveBeenCalledWith('/a')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingPreflightPath).toBe('/a')
  })

  it('deselects the current idle project — click and Cmd+N alike (v1.2.0)', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'idle' })

    selectProject('/a')
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useProjectStore.getState().preflightStatus).toBe('idle')
  })

  it('the current project stays a no-op while a session runs', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })

    selectProject('/a')
    expect(useProjectStore.getState().currentProject).not.toBeNull()
    expect(useProjectStore.getState().pendingSwitchPath).toBeNull()
  })

  it('requests the §8.3 switch confirmation while a session runs', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })

    selectProject('/b')

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingSwitchPath).toBe('/b')
  })

  it('ignores everything while the session is busy', () => {
    useSessionStore.setState({ sessionStatus: 'starting' })

    selectProject('/b')

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingSwitchPath).toBeNull()
  })

  it('guards against a duplicate in-flight preflight of the same path', () => {
    useProjectStore.setState({ pendingPreflightPath: '/b' })
    vi.mocked(commands.preflightProject).mockReturnValue(
      new Promise(() => undefined)
    )

    selectProject('/b')

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingPreflightPath).toBe('/b')
  })
})

/**
 * v1.1.2 T7 (spec issue #4/#11): ⌘↓/⌘↑ move the selection along the
 * visible order — clamped at both ends, folder-aware, with the click
 * semantics of selectProject.
 */
describe('moveProjectSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a', '/b', '/c'],
      projectFolders: [],
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      renameTarget: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('moves down and up along the visible order (idle → preflight)', () => {
    moveProjectSelection(1)
    expect(commands.preflightProject).toHaveBeenCalledWith('/a')

    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      pendingPreflightPath: null,
      preflightStatus: 'ready',
    })
    moveProjectSelection(1)
    expect(commands.preflightProject).toHaveBeenCalledWith('/b')
  })

  it('clamps at both ends — never wraps', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    moveProjectSelection(-1)
    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().currentProject?.path).toBe('/a')

    useProjectStore.setState({
      currentProject: { path: '/c', manifest },
    })
    moveProjectSelection(1)
    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().currentProject?.path).toBe('/c')
  })

  it('enters from the matching end when nothing is selected', () => {
    moveProjectSelection(1)
    expect(commands.preflightProject).toHaveBeenCalledWith('/a')

    moveProjectSelection(-1)
    expect(commands.preflightProject).toHaveBeenCalledWith('/c')
  })

  it('drills into the current project\'s folder before moving ("next song")', () => {
    useProjectStore.setState({
      projectFolders: [
        { id: 'f1', name: 'Set list', projectPaths: ['/a', '/b'] },
      ],
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })

    moveProjectSelection(1)

    // The view followed the current project into the folder, and the move
    // landed on the folder's own next member (not the ungrouped list).
    expect(useProjectStore.getState().activeFolderId).toBe('f1')
    expect(commands.preflightProject).toHaveBeenCalledWith('/b')
    expect(commands.preflightProject).not.toHaveBeenCalledWith('/c')
  })

  it('restores the selection when the drill clamps at the folder start', () => {
    // Idle current project, first member of its folder, top-level view:
    // ↑ clamps, but the drill reset the idle selection — it is restored.
    useProjectStore.setState({
      projectFolders: [
        { id: 'f1', name: 'Set list', projectPaths: ['/a', '/b'] },
      ],
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })

    moveProjectSelection(-1)

    expect(useProjectStore.getState().activeFolderId).toBe('f1')
    expect(commands.preflightProject).toHaveBeenCalledWith('/a')
  })

  it('keeps a live session and routes the move through the switch confirmation', () => {
    useProjectStore.setState({
      projectFolders: [
        { id: 'f1', name: 'Set list', projectPaths: ['/a', '/b'] },
      ],
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })

    moveProjectSelection(1)

    // The drill keeps a live session's project (T6 rule); the move then
    // requests the §8.3 switch instead of preflighting underneath it.
    expect(useProjectStore.getState().activeFolderId).toBe('f1')
    expect(useProjectStore.getState().currentProject?.path).toBe('/a')
    expect(useProjectStore.getState().pendingSwitchPath).toBe('/b')
    expect(commands.preflightProject).not.toHaveBeenCalled()
  })

  it('moves within the folder order while drilled in', () => {
    useProjectStore.setState({
      projectFolders: [
        { id: 'f1', name: 'Set list', projectPaths: ['/b', '/a'] },
      ],
      currentProject: { path: '/b', manifest },
      activeFolderId: 'f1',
      preflightStatus: 'ready',
    })

    moveProjectSelection(1)

    expect(commands.preflightProject).toHaveBeenCalledWith('/a')
    expect(commands.preflightProject).not.toHaveBeenCalledWith('/c')
  })

  it('is inert while the session is busy', () => {
    useSessionStore.setState({ sessionStatus: 'starting' })

    moveProjectSelection(1)

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingSwitchPath).toBeNull()
  })

  it('does nothing when the current view shows no projects', () => {
    useProjectStore.setState({ recentProjectPaths: [] })

    moveProjectSelection(1)
    moveProjectSelection(-1)

    expect(commands.preflightProject).not.toHaveBeenCalled()
  })
})

describe('nextFolderView (v1.2.2, issue #28)', () => {
  const folders = [
    { id: 'f1', name: 'Gig', projectPaths: [] },
    { id: 'utilities', name: 'Utilities', projectPaths: [] },
  ]

  it('walks right from unfiled through the folders in display order', () => {
    expect(nextFolderView(folders, null, 1)).toBe('f1')
    expect(nextFolderView(folders, 'f1', 1)).toBe('utilities')
  })

  it('wraps at both ends — the row is a ring', () => {
    expect(nextFolderView(folders, 'utilities', 1)).toBeNull()
    expect(nextFolderView(folders, null, -1)).toBe('utilities')
  })

  it('treats an unknown active id as the unfiled stop', () => {
    expect(nextFolderView(folders, 'gone', 1)).toBe('f1')
    expect(nextFolderView(folders, 'gone', -1)).toBe('utilities')
  })

  it('an empty folder area only ever resolves to unfiled', () => {
    expect(nextFolderView([], null, 1)).toBeNull()
    expect(nextFolderView([], null, -1)).toBeNull()
  })
})

/**
 * ⌘←/⌘→ — one folder view along the row, through the same entry as a
 * segment click. The ends clamp (the ⌘↓/⌘↑ rule — the Cmd arrows navigate
 * a grid, never a ring), and a clamped press must be a full no-op.
 */
describe('moveFolderSelection', () => {
  const folders = [
    { id: 'f1', name: 'Gig', projectPaths: ['/a'] },
    { id: 'utilities', name: 'Utilities', projectPaths: [] },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: ['/a', '/b', '/c'],
      projectFolders: folders,
      pendingPreflightPath: null,
      pendingSwitchPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('moves through the row in display order and back', () => {
    moveFolderSelection(1)
    expect(useProjectStore.getState().activeFolderId).toBe('f1')

    moveFolderSelection(1)
    expect(useProjectStore.getState().activeFolderId).toBe('utilities')

    moveFolderSelection(-1)
    moveFolderSelection(-1)
    expect(useProjectStore.getState().activeFolderId).toBeNull()
  })

  it('clamps at both ends — never wraps', () => {
    moveFolderSelection(-1)
    expect(useProjectStore.getState().activeFolderId).toBeNull()

    useProjectStore.setState({ activeFolderId: 'utilities' })
    moveFolderSelection(1)
    expect(useProjectStore.getState().activeFolderId).toBe('utilities')
  })

  it('a clamped press is a full no-op — an idle selection survives', () => {
    // The view must not re-run the click entry when it does not move:
    // that would reset an idle selection for nothing.
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    moveFolderSelection(-1)

    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(useProjectStore.getState().currentProject?.path).toBe('/a')
  })

  it('goes through the segment-click entry: an idle selection resets, a live session keeps its project', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    moveFolderSelection(1)

    expect(useProjectStore.getState().activeFolderId).toBe('f1')
    expect(useProjectStore.getState().currentProject).toBeNull()

    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })
    moveFolderSelection(-1)

    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(useProjectStore.getState().currentProject?.path).toBe('/a')
  })

  it('treats an unknown active id as the unfiled stop', () => {
    useProjectStore.setState({ activeFolderId: 'gone' })
    moveFolderSelection(1)
    expect(useProjectStore.getState().activeFolderId).toBe('f1')

    useProjectStore.setState({ activeFolderId: 'gone' })
    moveFolderSelection(-1)
    expect(useProjectStore.getState().activeFolderId).toBeNull()
  })

  it('an empty folder area is a no-op in both directions', () => {
    useProjectStore.setState({ projectFolders: [] })
    moveFolderSelection(1)
    moveFolderSelection(-1)
    expect(useProjectStore.getState().activeFolderId).toBeNull()
  })
})
