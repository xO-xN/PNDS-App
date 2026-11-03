import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { confirm } from '@tauri-apps/plugin-dialog'
import {
  commands,
  type CreationRuntime,
  type CreationWorkspace,
} from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useProjectStore, type CurrentProject } from './project-store'
import { useSessionStore } from './session-store'
import { registerCreationParticipant } from '@/lib/creation-lifecycle'
import { start } from '@/lib/session-flow'

const runtime: CreationRuntime = {
  generation: '7',
  projectRoot: '/A',
  snapshot: {
    status: 'ready',
    projectPath: '/A',
    projectName: 'Running A',
    audioMode: 'external',
    lanIp: '192.168.1.20',
    hostAddress: null,
    oscTarget: '192.168.1.30:50000',
    health: {
      status: 'ready',
      projectId: 'A',
      audioMode: 'external',
      audio: { status: 'ready', target: '192.168.1.30:50000', error: null },
      scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
    },
    error: null,
    outputTail: [],
    volume: 70,
    startupStage: 0,
    channelPlan: null,
    outputDevice: null,
    projectionStarted: false,
    httpsEntry: { status: 'off', url: null, error: null },
    dnsMapping: { status: 'off', domain: null, ip: null, error: null },
  },
}
const workspace: CreationWorkspace = {
  project: {
    identity: 'A-read',
    root: '/A',
    name: 'Running A',
    source: 'folder',
  },
  files: [],
}
const selectedProject: CurrentProject = {
  path: '/B',
  manifest: {
    schemaVersion: 1,
    id: 'B',
    name: 'Selected B',
    version: '1',
    description: null,
    scoreServer: {
      entry: 'server.js',
      workingDirectory: '.',
      performerPort: 6868,
      monitorPort: 6869,
    },
    audio: {
      defaultMode: 'none',
      supportedModes: ['none'],
      synthdefs: null,
      scsynth: null,
      standaloneTarget: null,
    },
  },
}
const selectedWorkspace: CreationWorkspace = {
  ...workspace,
  project: {
    ...workspace.project,
    identity: 'B-read',
    root: '/B',
    name: 'Selected B',
  },
}
const idleRuntime: CreationRuntime = {
  generation: '8',
  projectRoot: null,
  snapshot: {
    ...runtime.snapshot,
    status: 'idle',
    projectPath: null,
    health: null,
    audioMode: null,
    lanIp: null,
    oscTarget: null,
  },
}
let unregister: (() => void) | undefined

describe('confirmed mode handoff', () => {
  afterEach(() => {
    unregister?.()
    unregister = undefined
  })
  beforeEach(() => {
    vi.clearAllMocks()
    useCreationStore.setState({
      active: false,
      workspace: null,
      modePhase: 'idle',
      modePlan: null,
      modeError: null,
      opening: false,
      request: null,
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/A',
      audioMode: 'none',
      lanIp: '192.168.1.99',
      oscTargetInput: 'wrong',
      runId: 12,
    })
    useProjectStore.setState({ currentProject: null })
    vi.mocked(commands.getCreationRuntime).mockResolvedValue({
      status: 'ok',
      data: runtime,
    })
    vi.mocked(commands.prepareCreationProject).mockResolvedValue({
      status: 'ok',
      data: workspace,
    })
    vi.mocked(commands.commitCreationProject).mockResolvedValue({
      status: 'ok',
      data: runtime,
    })
  })

  it('prepares the running project and preserves its generation and applied config without stop/start', async () => {
    useProjectStore.setState({ currentProject: selectedProject })
    await useCreationStore.getState().prepareModeSwitch()
    expect(useCreationStore.getState().active).toBe(false)
    expect(commands.prepareCreationProject).toHaveBeenCalledWith('/A')
    expect(commands.stopProject).not.toHaveBeenCalled()
    await useCreationStore.getState().commitModeSwitch()
    expect(useCreationStore.getState().workspace?.project.identity).toBe(
      'A-read'
    )
    expect(useCreationStore.getState().active).toBe(true)
    expect(useSessionStore.getState().audioMode).toBe('external')
    expect(useSessionStore.getState().lanIp).toBe('192.168.1.20')
    expect(useSessionStore.getState().oscTargetInput).toBe('192.168.1.30:50000')
    expect(useSessionStore.getState().runId).toBe(12)
    expect(commands.hidePerformerQr).toHaveBeenCalledOnce()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('prepares the explicit card despite a running project and later selection, and cancellation keeps the run', async () => {
    useProjectStore.setState({ currentProject: selectedProject })
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: selectedWorkspace,
    })
    const preparing = useCreationStore.getState().prepareModeSwitch('/B')
    const nextSelection = { ...selectedProject, path: '/C' }
    useProjectStore.setState({ currentProject: nextSelection })
    await preparing
    expect(commands.prepareCreationProject).toHaveBeenCalledExactlyOnceWith(
      '/B'
    )
    expect(useCreationStore.getState().modePlan).toMatchObject({
      targetCreation: true,
      workspace: selectedWorkspace,
      preservesRun: false,
    })
    expect(useCreationStore.getState().modePhase).toBe('armed')
    expect(useCreationStore.getState().active).toBe(false)
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
    useCreationStore.getState().cancelModeSwitch()
    expect(useCreationStore.getState().modePhase).toBe('idle')
    expect(useCreationStore.getState().modePlan).toBeNull()
    expect(commands.closeCreationProject).toHaveBeenCalledExactlyOnceWith(
      'B-read'
    )
    expect(useProjectStore.getState().currentProject).toBe(nextSelection)
    expect(useSessionStore.getState().sessionProjectPath).toBe('/A')
    expect(useSessionStore.getState().runId).toBe(12)
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('stops the old run only when the explicit folder switch is confirmed', async () => {
    useProjectStore.setState({ currentProject: selectedProject })
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: selectedWorkspace,
    })
    vi.mocked(commands.stopProject).mockImplementationOnce(async () => {
      vi.mocked(commands.getCreationRuntime).mockResolvedValue({
        status: 'ok',
        data: idleRuntime,
      })
      vi.mocked(commands.commitCreationProject).mockResolvedValue({
        status: 'ok',
        data: idleRuntime,
      })
      return { status: 'ok', data: null }
    })
    await useCreationStore.getState().prepareModeSwitch('/B')
    expect(commands.stopProject).not.toHaveBeenCalled()
    vi.mocked(confirm).mockImplementationOnce(async () => {
      expect(useCreationStore.getState().modePhase).toBe('settling')
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.closeCreationProjection).not.toHaveBeenCalled()
      useCreationStore.getState().cancelModeSwitch()
      return true
    })
    expect(
      await useCreationStore
        .getState()
        .commitModeSwitch(0, false, { confirmRuntimeStop: true })
    ).toBe(true)
    expect(confirm).toHaveBeenCalledOnce()
    expect(commands.stopProject).toHaveBeenCalledOnce()
    expect(commands.commitCreationProject).toHaveBeenCalledWith('B-read', '8')
    expect(useCreationStore.getState().workspace).toEqual(selectedWorkspace)
    expect(useCreationStore.getState().active).toBe(true)
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('keeps the running performance and projection when direct creation entry is cancelled', async () => {
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: selectedWorkspace,
    })
    vi.mocked(confirm).mockResolvedValueOnce(false)
    await useCreationStore.getState().prepareModeSwitch('/B')
    expect(
      await useCreationStore
        .getState()
        .commitModeSwitch(0, false, { confirmRuntimeStop: true })
    ).toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    expect(useCreationStore.getState().active).toBe(false)
    expect(useCreationStore.getState().modePhase).toBe('idle')
    expect(useSessionStore.getState().sessionProjectPath).toBe('/A')
    expect(commands.closeCreationProject).toHaveBeenCalledExactlyOnceWith(
      'B-read'
    )
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.closeCreationProjection).not.toHaveBeenCalled()
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
    expect(commands.setMainPerformanceKeyOwner).not.toHaveBeenCalled()
  })

  it('refuses to stop a different runtime that arrived while direct creation entry was being confirmed', async () => {
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: selectedWorkspace,
    })
    await useCreationStore.getState().prepareModeSwitch('/B')
    vi.mocked(confirm).mockImplementationOnce(async () => {
      vi.mocked(commands.getCreationRuntime).mockResolvedValueOnce({
        status: 'ok',
        data: { ...runtime, generation: '9' },
      })
      return true
    })
    expect(
      await useCreationStore
        .getState()
        .commitModeSwitch(0, false, { confirmRuntimeStop: true })
    ).toBe(false)
    expect(useCreationStore.getState().active).toBe(false)
    expect(useCreationStore.getState().modeError?.detail).toMatch(
      /runtime changed/i
    )
    expect(commands.closeCreationProject).toHaveBeenCalledExactlyOnceWith(
      'B-read'
    )
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.closeCreationProjection).not.toHaveBeenCalled()
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
  })

  it('keeps the running generation when an explicit alias resolves to the same canonical folder', async () => {
    useProjectStore.setState({ currentProject: selectedProject })
    await useCreationStore.getState().prepareModeSwitch('/alias-to-A')
    expect(commands.prepareCreationProject).toHaveBeenCalledWith('/alias-to-A')
    expect(useCreationStore.getState().modePlan?.preservesRun).toBe(true)
    expect(
      await useCreationStore
        .getState()
        .commitModeSwitch(0, false, { confirmRuntimeStop: true })
    ).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    expect(commands.commitCreationProject).toHaveBeenCalledWith('A-read', '7')
    expect(useCreationStore.getState().workspace).toEqual(workspace)
    expect(useSessionStore.getState().sessionProjectPath).toBe('/A')
    expect(useSessionStore.getState().runId).toBe(12)
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('keeps the running project when preparation of the explicit card fails', async () => {
    useProjectStore.setState({ currentProject: selectedProject })
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'missing', detail: '/B disappeared' },
    })
    await useCreationStore.getState().prepareModeSwitch('/B')
    expect(useCreationStore.getState().modeError).toEqual({
      code: 'missing',
      detail: '/B disappeared',
    })
    expect(useCreationStore.getState().modePhase).toBe('idle')
    expect(useCreationStore.getState().modePlan).toBeNull()
    expect(useCreationStore.getState().active).toBe(false)
    expect(useProjectStore.getState().currentProject).toBe(selectedProject)
    expect(useSessionStore.getState().sessionProjectPath).toBe('/A')
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
    expect(commands.setMainPerformanceKeyOwner).not.toHaveBeenCalled()
  })

  it.each(['bundle', 'utility', 'readOnlyFolder'] as const)(
    'rejects an explicit %s target without ending the running project',
    async source => {
      useProjectStore.setState({ currentProject: selectedProject })
      vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
        status: 'ok',
        data: {
          ...selectedWorkspace,
          project: { ...selectedWorkspace.project, source },
        },
      })
      await useCreationStore.getState().prepareModeSwitch('/B')
      expect(useCreationStore.getState().modeError).toMatchObject({
        code: 'permission',
        detail: expect.stringMatching(/read-only/i),
      })
      expect(useCreationStore.getState().modePhase).toBe('idle')
      expect(useCreationStore.getState().modePlan).toBeNull()
      expect(await useCreationStore.getState().commitModeSwitch()).toBe(false)
      expect(useCreationStore.getState().active).toBe(false)
      expect(useProjectStore.getState().currentProject).toBe(selectedProject)
      expect(useSessionStore.getState().sessionProjectPath).toBe('/A')
      expect(commands.closeCreationProject).toHaveBeenCalledExactlyOnceWith(
        'B-read'
      )
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.commitCreationProject).not.toHaveBeenCalled()
      expect(commands.setMainPerformanceKeyOwner).not.toHaveBeenCalled()
    }
  )

  it('ignores a stale explicit performance-card request after creation has become active', async () => {
    useCreationStore.setState({ active: true, workspace })
    await useCreationStore.getState().prepareModeSwitch('/B')
    expect(useCreationStore.getState().active).toBe(true)
    expect(useCreationStore.getState().workspace).toBe(workspace)
    expect(useCreationStore.getState().modePhase).toBe('idle')
    expect(commands.getCreationRuntime).not.toHaveBeenCalled()
    expect(commands.prepareCreationProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('retains the backend canonical runtime identity when adopting a running folder alias', async () => {
    const aliased = {
      ...runtime,
      snapshot: { ...runtime.snapshot, projectPath: '/alias' },
    }
    vi.mocked(commands.getCreationRuntime).mockResolvedValue({
      status: 'ok',
      data: aliased,
    })
    vi.mocked(commands.commitCreationProject).mockResolvedValue({
      status: 'ok',
      data: aliased,
    })
    await useCreationStore.getState().prepareModeSwitch()
    await useCreationStore.getState().commitModeSwitch()
    expect(useCreationStore.getState().runtimeProject).toEqual({
      path: '/alias',
      root: '/A',
    })
    expect(useSessionStore.getState().sessionProjectPath).toBe('/alias')
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('cancels a prepared switch without stopping the runtime or cleaning up windows', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    unregister = registerCreationParticipant({ cleanup })
    await useCreationStore.getState().prepareModeSwitch()
    useCreationStore.getState().cancelModeSwitch()
    expect(useCreationStore.getState().active).toBe(false)
    expect(commands.closeCreationProject).toHaveBeenCalledWith('A-read')
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
    expect(commands.hidePerformerQr).not.toHaveBeenCalled()
  })

  it.each(['bundle', 'utility', 'readOnlyFolder'] as const)(
    'ends a %s runtime only after confirmation and enters the creation home',
    async source => {
      vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
        status: 'ok',
        data: {
          ...workspace,
          project: { ...workspace.project, source },
        },
      })
      vi.mocked(commands.stopProject).mockImplementationOnce(async () => {
        vi.mocked(commands.getCreationRuntime).mockResolvedValue({
          status: 'ok',
          data: idleRuntime,
        })
        vi.mocked(commands.commitCreationProject).mockResolvedValue({
          status: 'ok',
          data: idleRuntime,
        })
        return { status: 'ok', data: null }
      })
      await useCreationStore.getState().prepareModeSwitch()
      expect(commands.stopProject).not.toHaveBeenCalled()
      await useCreationStore.getState().commitModeSwitch()
      expect(commands.stopProject).toHaveBeenCalledOnce()
      expect(useCreationStore.getState().active).toBe(true)
      expect(useCreationStore.getState().workspace).toBeNull()
      expect(commands.startProject).not.toHaveBeenCalled()
    }
  )

  it('keeps creation drafts and runtime when the registered discard confirmation is cancelled', async () => {
    useCreationStore.setState({ active: true, workspace })
    const cleanup = vi.fn().mockResolvedValue(undefined)
    unregister = registerCreationParticipant({
      hasUnsavedChanges: () => true,
      confirmDiscard: async () => false,
      cleanup,
    })
    await useCreationStore.getState().prepareModeSwitch()
    expect(await useCreationStore.getState().commitModeSwitch()).toBe(false)
    expect(useCreationStore.getState().workspace).toBe(workspace)
    expect(useCreationStore.getState().active).toBe(true)
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('rejects startup and changed runtime generations before committing the mode', async () => {
    useSessionStore.setState({ sessionStatus: 'starting' })
    await useCreationStore.getState().prepareModeSwitch()
    expect(commands.getCreationRuntime).not.toHaveBeenCalled()
    useSessionStore.setState({ sessionStatus: 'ready' })
    await useCreationStore.getState().prepareModeSwitch()
    vi.mocked(commands.getCreationRuntime).mockResolvedValueOnce({
      status: 'ok',
      data: { ...runtime, generation: '9' },
    })
    expect(await useCreationStore.getState().commitModeSwitch()).toBe(false)
    expect(useCreationStore.getState().active).toBe(false)
    expect(useCreationStore.getState().modeError?.detail).toMatch(
      /runtime changed/i
    )
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
    expect(commands.setMainPerformanceKeyOwner).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('stops testing and runs registered cleanup when returning to the empty performance home', async () => {
    useCreationStore.setState({ active: true, workspace })
    const cleanup = vi.fn().mockResolvedValue(undefined)
    unregister = registerCreationParticipant({ cleanup })
    vi.mocked(commands.stopProject).mockImplementationOnce(async () => {
      vi.mocked(commands.getCreationRuntime).mockResolvedValue({
        status: 'ok',
        data: idleRuntime,
      })
      vi.mocked(commands.commitCreationProject).mockResolvedValue({
        status: 'ok',
        data: idleRuntime,
      })
      return { status: 'ok', data: null }
    })
    await useCreationStore.getState().leave()
    expect(commands.stopProject).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(useCreationStore.getState().active).toBe(false)
    expect(useProjectStore.getState().currentProject).toBeNull()
    expect(useSessionStore.getState().sessionStatus).toBe('idle')
    expect(commands.hidePerformerQr).toHaveBeenCalledOnce()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('does not submit a Load while mode confirmation is active', async () => {
    useProjectStore.setState({
      preflightStatus: 'ready',
      currentProject: {
        path: '/A',
        manifest: {
          schemaVersion: 1,
          id: 'A',
          name: 'A',
          version: '1',
          description: null,
          scoreServer: {
            entry: 'server.js',
            workingDirectory: '.',
            performerPort: 6868,
            monitorPort: 6869,
          },
          audio: {
            defaultMode: 'none',
            supportedModes: ['none'],
            synthdefs: null,
            scsynth: null,
            standaloneTarget: null,
          },
        },
      },
    })
    useSessionStore.setState({
      sessionStatus: 'idle',
      lanIp: '192.168.1.20',
      audioMode: 'none',
    })
    await useCreationStore.getState().prepareModeSwitch()
    await start()
    expect(commands.startProject).not.toHaveBeenCalled()
    useCreationStore.getState().cancelModeSwitch()
  })

  it('blocks a mode attempt while Load is submitted but its starting snapshot has not arrived', async () => {
    useProjectStore.setState({
      preflightStatus: 'ready',
      currentProject: {
        path: '/A',
        manifest: {
          schemaVersion: 1,
          id: 'A',
          name: 'A',
          version: '1',
          description: null,
          scoreServer: {
            entry: 'server.js',
            workingDirectory: '.',
            performerPort: 6868,
            monitorPort: 6869,
          },
          audio: {
            defaultMode: 'none',
            supportedModes: ['none'],
            synthdefs: null,
            scsynth: null,
            standaloneTarget: null,
          },
        },
      },
    })
    useSessionStore.setState({
      sessionStatus: 'idle',
      lanIp: '192.168.1.20',
      audioMode: 'none',
    })
    let resolveStart!: () => void
    vi.mocked(commands.startProject).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveStart = () => resolve({ status: 'ok', data: null })
        })
    )
    const loading = start()
    expect(commands.startProject).toHaveBeenCalledOnce()
    await useCreationStore.getState().prepareModeSwitch()
    expect(commands.getCreationRuntime).not.toHaveBeenCalled()
    expect(useCreationStore.getState().modePhase).toBe('idle')
    resolveStart()
    await loading
    expect(useSessionStore.getState().commandPending).toBe(false)
  })

  it('does not overwrite a newer runtime error with the mode commit response', async () => {
    let resolveCommit!: (result: {
      status: 'ok'
      data: CreationRuntime
    }) => void
    vi.mocked(commands.commitCreationProject).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveCommit = resolve
        })
    )
    await useCreationStore.getState().prepareModeSwitch()
    const switching = useCreationStore.getState().commitModeSwitch()
    await vi.waitFor(() =>
      expect(commands.commitCreationProject).toHaveBeenCalled()
    )
    useSessionStore.getState().applySnapshot({
      ...runtime.snapshot,
      status: 'error',
      error: 'A newer runtime failure',
      health: null,
    })
    resolveCommit({ status: 'ok', data: runtime })
    await switching
    expect(useSessionStore.getState().sessionStatus).toBe('error')
    expect(useSessionStore.getState().sessionError).toBe(
      'A newer runtime failure'
    )
  })

  it('rechecks runtime facts after native key ownership settles without binding another project to the old root', async () => {
    let resolveOwner!: () => void
    vi.mocked(commands.setMainPerformanceKeyOwner).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOwner = () => resolve({ status: 'ok', data: null })
        })
    )
    useCreationStore.setState({ runtimeProject: null })
    await useCreationStore.getState().prepareModeSwitch()
    const switching = useCreationStore.getState().commitModeSwitch()
    await vi.waitFor(() =>
      expect(commands.setMainPerformanceKeyOwner).toHaveBeenCalled()
    )
    useSessionStore.getState().applySnapshot({
      ...runtime.snapshot,
      projectPath: '/B',
      projectName: 'New running B',
    })
    resolveOwner()

    expect(await switching).toBe(false)
    expect(useCreationStore.getState().active).toBe(false)
    expect(useCreationStore.getState().workspace).toBeNull()
    expect(useCreationStore.getState().runtimeProject).toBeNull()
    expect(useCreationStore.getState().modeError?.detail).toMatch(
      /runtime changed/i
    )
    expect(useSessionStore.getState().sessionProjectPath).toBe('/B')
    expect(commands.closeCreationProject).toHaveBeenCalledWith('A-read')
    expect(commands.setMainPerformanceKeyOwner).toHaveBeenLastCalledWith(
      useCreationStore.getState().epoch,
      true
    )
  })

  it('rechecks runtime facts after identity release before resetting the performance home', async () => {
    useCreationStore.setState({
      active: true,
      workspace,
      runtimeProject: { path: '/A', root: '/A' },
    })
    vi.mocked(commands.stopProject).mockImplementationOnce(async () => {
      vi.mocked(commands.getCreationRuntime).mockResolvedValue({
        status: 'ok',
        data: idleRuntime,
      })
      vi.mocked(commands.commitCreationProject).mockResolvedValue({
        status: 'ok',
        data: idleRuntime,
      })
      return { status: 'ok', data: null }
    })
    let resolveRelease!: () => void
    vi.mocked(commands.closeCreationProject).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRelease = () => resolve({ status: 'ok', data: null })
        })
    )
    await useCreationStore.getState().prepareModeSwitch()
    const switching = useCreationStore.getState().commitModeSwitch()
    await vi.waitFor(() =>
      expect(commands.closeCreationProject).toHaveBeenCalledWith('A-read')
    )
    useSessionStore.getState().applySnapshot({
      ...runtime.snapshot,
      projectPath: '/B',
      projectName: 'New running B',
    })
    resolveRelease()

    expect(await switching).toBe(false)
    expect(useCreationStore.getState().active).toBe(true)
    expect(useCreationStore.getState().workspace).toBeNull()
    expect(useCreationStore.getState().runtimeProject).toBeNull()
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
    expect(useSessionStore.getState().sessionProjectPath).toBe('/B')
    expect(useCreationStore.getState().modeError?.detail).toMatch(
      /runtime changed/i
    )
  })

  it('keeps a runtime error received during native ownership transfer without republishing its facts', async () => {
    let resolveOwner!: () => void
    vi.mocked(commands.setMainPerformanceKeyOwner).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOwner = () => resolve({ status: 'ok', data: null })
        })
    )
    await useCreationStore.getState().prepareModeSwitch()
    const switching = useCreationStore.getState().commitModeSwitch()
    await vi.waitFor(() =>
      expect(commands.setMainPerformanceKeyOwner).toHaveBeenCalled()
    )
    useSessionStore.getState().applySnapshot({
      ...runtime.snapshot,
      status: 'error',
      error: 'Runtime failed during native ownership transfer',
      health: null,
    })
    const { snapshotRevision, runId } = useSessionStore.getState()
    resolveOwner()

    expect(await switching).toBe(true)
    expect(useCreationStore.getState().active).toBe(true)
    expect(useCreationStore.getState().workspace?.project.identity).toBe(
      'A-read'
    )
    expect(useSessionStore.getState()).toMatchObject({
      sessionStatus: 'error',
      sessionError: 'Runtime failed during native ownership transfer',
      snapshotRevision,
      runId,
    })
  })
})
