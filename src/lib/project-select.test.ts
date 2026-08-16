import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { selectProject } from './project-select'
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
      trustedPaths: ['/a', '/b'],
      projectFolders: [],
      pendingTrustPath: null,
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

    selectProject('/a', 'click')

    expect(commands.preflightProject).toHaveBeenCalledWith('/a')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingPreflightPath).toBe('/a')
  })

  it('a click clears the current idle project; the keyboard never does', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'idle' })

    selectProject('/a', 'keyboard')
    expect(useProjectStore.getState().currentProject).not.toBeNull()

    selectProject('/a', 'click')
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useProjectStore.getState().preflightStatus).toBe('idle')
  })

  it('the current project stays a no-op while a session runs', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })

    selectProject('/a', 'click')
    selectProject('/a', 'keyboard')
    expect(useProjectStore.getState().currentProject).not.toBeNull()
    expect(useProjectStore.getState().pendingSwitchPath).toBeNull()
  })

  it('requests the §8.3 switch confirmation while a session runs', () => {
    useProjectStore.setState({
      currentProject: { path: '/a', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })

    selectProject('/b', 'keyboard')

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingSwitchPath).toBe('/b')
  })

  it('ignores everything while the session is busy', () => {
    useSessionStore.setState({ sessionStatus: 'starting' })

    selectProject('/b', 'click')

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingSwitchPath).toBeNull()
  })

  it('guards against a duplicate in-flight preflight of the same path', () => {
    useProjectStore.setState({ pendingPreflightPath: '/b' })
    vi.mocked(commands.preflightProject).mockReturnValue(
      new Promise(() => undefined)
    )

    selectProject('/b', 'click')

    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().pendingPreflightPath).toBe('/b')
  })
})
