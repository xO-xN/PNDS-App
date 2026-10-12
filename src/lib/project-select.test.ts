import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { moveProjectSelection, selectProject } from './project-select'
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
    expect(commands.preflightProject).not.toHaveBeenCalled()
  })

  /** v1.2.3 (#39): selection is free while a session runs — selecting B
   * preflights it and never stops or resets A's session. */
  it('selects and preflights another project while a session runs', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })

    selectProject('/b')

    expect(commands.preflightProject).toHaveBeenCalledWith('/b')
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
  })

  /** v1.2.3 (#39): busy (starting/stopping) no longer blocks selection —
   * the backend preflight is session-safe (issue #37). */
  it('selects while the session is busy (starting)', () => {
    useSessionStore.setState({ sessionStatus: 'starting' })

    selectProject('/b')

    expect(commands.preflightProject).toHaveBeenCalledWith('/b')
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

  it("stays in the current view — never auto-drills into the selection's folder (#39 feedback)", () => {
    useProjectStore.setState({
      projectFolders: [
        { id: 'f1', name: 'Set list', projectPaths: ['/a', '/b'] },
      ],
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })

    moveProjectSelection(1)

    // Top level shows only /c now — the move stays HERE instead of
    // bouncing back into the selected project's folder.
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(commands.preflightProject).toHaveBeenCalledWith('/c')
    expect(commands.preflightProject).not.toHaveBeenCalledWith('/b')
  })

  it('keeps the session running and moves the selection underneath it (#39)', () => {
    useProjectStore.setState({
      projectFolders: [
        { id: 'f1', name: 'Set list', projectPaths: ['/a', '/b'] },
      ],
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })

    moveProjectSelection(1)

    // The move stays in the top-level view (its only member is /c) and
    // freely selects + preflights it (v1.2.3 #39) — no switch
    // confirmation, nothing stopped.
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    expect(commands.preflightProject).toHaveBeenCalledWith('/c')
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
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

  it('moves freely while the session is busy (starting)', () => {
    useSessionStore.setState({ sessionStatus: 'starting' })

    moveProjectSelection(1)

    expect(commands.preflightProject).toHaveBeenCalledWith('/a')
  })

  it('does nothing when the current view shows no projects', () => {
    useProjectStore.setState({ recentProjectPaths: [] })

    moveProjectSelection(1)
    moveProjectSelection(-1)

    expect(commands.preflightProject).not.toHaveBeenCalled()
  })
})
