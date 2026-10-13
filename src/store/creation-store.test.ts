import { seedCreationDraft } from '@/test/creation-files'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useSessionStore } from './session-store'
import { useCreationFilesStore } from './creation-files-store'
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
      modePhase: 'idle',
      modePlan: null,
      modeError: null,
      hoverPaused: false,
      modePointerInside: false,
      restoreModeFocus: false,
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
    await useCreationStore.getState().enter()
    const picking = useCreationStore.getState().pick()
    await useCreationStore.getState().leave()
    await useCreationStore.getState().enter()
    resolvePicker('/old-selection')
    await picking
    expect(commands.prepareCreationProject).not.toHaveBeenCalled()
    expect(useCreationStore.getState().workspace).toBeNull()
  })

  it('opens through the creation boundary and preserves the current project on cancel or failure', async () => {
    await useCreationStore.getState().enter()
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: workspace,
    })
    await useCreationStore.getState().open('/draft')
    expect(useCreationStore.getState().workspace).toEqual(workspace)
    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    await useCreationStore.getState().pick()
    expect(useCreationStore.getState().workspace).toEqual(workspace)
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'missing', detail: 'gone' },
    })
    await useCreationStore.getState().open('/gone')
    expect(useCreationStore.getState().workspace).toEqual(workspace)
    expect(useCreationStore.getState().error?.code).toBe('missing')
  })

  it('persists creation recents without changing the performance index', async () => {
    await useCreationStore.getState().enter()
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
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
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

  it('removes only creation history while retaining the open workspace, draft and run', async () => {
    useCreationStore.setState({
      active: true,
      workspace,
      recentPaths: ['/draft', '/older'],
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/draft',
    })
    seedCreationDraft('README.md', 'saved', 'v1')
    useCreationFilesStore.getState().edit('README.md', 'unsaved')
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        language: null,
        recentProjects: ['/performance'],
        recentCreationProjects: ['/draft', '/older'],
      },
    })
    useCreationStore.getState().removeRecent('/draft')
    expect(useCreationStore.getState().recentPaths).toEqual(['/older'])
    expect(useCreationStore.getState().workspace).toBe(workspace)
    expect(useSessionStore.getState().sessionProjectPath).toBe('/draft')
    expect(useCreationFilesStore.getState().drafts['README.md']?.text).toBe(
      'unsaved'
    )
    await vi.waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          recentProjects: ['/performance'],
          recentCreationProjects: ['/older'],
        })
      )
    )
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.closeCreationProject).not.toHaveBeenCalled()
  })

  it('keeps a submitted file switch owned until it completes before allowing a mode switch', async () => {
    await useCreationStore.getState().enter()
    useCreationStore.setState({ workspace })
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: {
        ...workspace,
        project: { ...workspace.project, identity: 'next' },
      },
    })
    const idle = await commands.getCreationRuntime()
    let resolveCommit!: (result: typeof idle) => void
    vi.mocked(commands.commitCreationProject).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveCommit = resolve
        })
    )
    const opening = useCreationStore.getState().open('/next')
    await vi.waitFor(() => expect(resolveCommit).toBeDefined())
    await useCreationStore.getState().prepareModeSwitch()
    expect(useCreationStore.getState().modePhase).toBe('idle')
    expect(useCreationStore.getState().opening).toBe(true)
    resolveCommit(idle)
    expect(await opening).toBe(true)
    expect(useCreationStore.getState().workspace?.project.identity).toBe('next')
    expect(commands.closeCreationProject).not.toHaveBeenCalledWith('next')
    expect(useCreationStore.getState().opening).toBe(false)
  })
})
