import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useSessionStore } from './session-store'
import { open } from '@tauri-apps/plugin-dialog'

const workspace: CreationWorkspace = {
  project: {
    identity: 'first',
    root: '/draft',
    name: 'Draft',
    source: 'folder',
  },
  files: [{ path: 'server.js', kind: 'text', category: 'system', size: 5 }],
}

describe('creation workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.setState({ sessionStatus: 'idle' })
    useCreationStore.setState({
      active: false,
      workspace: null,
      request: null,
      opening: false,
      error: null,
      recentPaths: [],
    })
  })

  it('discards a native selection returned after leaving and entering creation again', async () => {
    let resolvePicker!: (path: string) => void
    vi.mocked(open).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolvePicker = resolve
        })
    )
    useCreationStore.getState().enter()
    const picking = useCreationStore.getState().pick()
    useCreationStore.getState().leave()
    useCreationStore.getState().enter()
    resolvePicker('/old-selection')
    await picking
    expect(commands.openCreationProject).not.toHaveBeenCalled()
    expect(useCreationStore.getState().workspace).toBeNull()
  })

  it('opens through the creation boundary and preserves the current project on cancel or failure', async () => {
    useCreationStore.getState().enter()
    vi.mocked(commands.openCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: workspace,
    })
    await useCreationStore.getState().open('/draft')
    expect(useCreationStore.getState().workspace).toEqual(workspace)
    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    await useCreationStore.getState().pick()
    expect(useCreationStore.getState().workspace).toEqual(workspace)
    vi.mocked(commands.openCreationProject).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'missing', detail: 'gone' },
    })
    await useCreationStore.getState().open('/gone')
    expect(useCreationStore.getState().workspace).toEqual(workspace)
    expect(useCreationStore.getState().error?.code).toBe('missing')
  })

  it('persists creation recents without changing the performance index', async () => {
    useCreationStore.getState().enter()
    useCreationStore.setState({ recentPaths: ['/older'] })
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        language: null,
        recentProjects: ['/performance'],
        sampleRate: 48000,
      },
    })
    vi.mocked(commands.openCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: workspace,
    })
    await useCreationStore.getState().open('/draft')
    await vi.waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: ['/performance'],
          recentCreationProjects: ['/draft', '/older'],
          sampleRate: 48000,
        })
      )
    )
  })

  it('discards an open response after leaving and keeps the next visit usable', async () => {
    let resolveOpen!: (result: {
      status: 'ok'
      data: CreationWorkspace
    }) => void
    vi.mocked(commands.openCreationProject).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveOpen = resolve
        })
    )
    useCreationStore.getState().enter()
    const opening = useCreationStore.getState().open('/old')
    await vi.waitFor(() =>
      expect(commands.openCreationProject).toHaveBeenCalled()
    )
    useCreationStore.getState().leave()
    useCreationStore.getState().enter()
    vi.mocked(commands.openCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: {
        ...workspace,
        project: { ...workspace.project, identity: 'next' },
      },
    })
    const next = useCreationStore.getState().open('/next')
    resolveOpen({ status: 'ok', data: workspace })
    await opening
    await next
    expect(commands.closeCreationProject).toHaveBeenCalledWith('first')
    expect(useCreationStore.getState().workspace?.project.identity).toBe('next')
    expect(useCreationStore.getState().opening).toBe(false)
  })
})
