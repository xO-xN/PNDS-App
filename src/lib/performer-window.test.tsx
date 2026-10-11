import { PERFORMER_CONFIG, PERFORMER_PAGE, PERFORMER_READY } from '@/lib/events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { emitTo, listen } from '@tauri-apps/api/event'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/store/settings-store'
import { refreshMonitorFromDisk } from './creation-runtime-updates'
import type { PerformerConfig } from './performer-protocol'
import { act, render, screen, fireEvent, waitFor } from '@/test/test-utils'
import { CreationPerformers } from '@/components/creation/CreationPerformers'
import { stopAndReset } from './open-project'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { commands, type CreationRuntime } from '@/lib/tauri-bindings'
import {
  closePerformerWindow,
  closeAllPerformerWindows,
  focusPerformerWindow,
  openPerformerWindow,
  setupPerformerWindowBridge,
} from './performer-window'
import { useCreationPerformersStore } from '@/store/creation-performers-store'

const nativeCreation = vi.hoisted(() => ({ deferred: false }))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: vi.fn().mockImplementation(function (
    this: {
      label: string
      once: unknown
      setFocus: unknown
      setTitle: unknown
    },
    label: string
  ) {
    this.label = label
    this.once = vi.fn((event: string, callback: () => void) => {
      if (event === 'tauri://created' && !nativeCreation.deferred)
        queueMicrotask(callback)
      return Promise.resolve(() => undefined)
    })
    this.setFocus = vi.fn().mockResolvedValue(undefined)
    this.setTitle = vi.fn().mockResolvedValue(undefined)
  }),
}))

let dispose: () => void
const handlers = new Map<string, (event: { payload: unknown }) => void>()
function deliver(name: string, payload: unknown): void {
  handlers.get(name)?.({ payload })
}
function labelAt(index = 0): string {
  const label = useCreationPerformersStore.getState().windows[index]?.label
  if (!label) throw new Error('Missing native test client')
  return label
}
function configFor(label: string): PerformerConfig {
  const call = vi
    .mocked(emitTo)
    .mock.calls.filter(
      ([target, name]) => target === label && name === PERFORMER_CONFIG
    )
    .at(-1)
  if (!call) throw new Error('No configuration delivered')
  return call[2] as PerformerConfig
}
beforeEach(() => {
  dispose?.()
  vi.clearAllMocks()
  nativeCreation.deferred = false
  vi.mocked(commands.stopProject).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  handlers.clear()
  vi.mocked(listen).mockImplementation(async (name, callback) => {
    handlers.set(
      String(name),
      callback as (event: { payload: unknown }) => void
    )
    return () => {
      if (handlers.get(String(name)) === callback) handlers.delete(String(name))
    }
  })
  useCreationPerformersStore.setState({ windows: [], error: null })
  useSessionStore.getState().resetSession()
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/test',
    lanIp: '127.0.0.1',
    health: {
      status: 'ready',
      projectId: 'test',
      audioMode: 'none',
      audio: { status: 'disabled', target: null, error: null },
      scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
    },
  })
  useCreationStore.setState({
    active: true,
    opening: false,
    modePhase: 'idle',
    workspace: {
      project: {
        identity: 'test',
        root: '/test',
        source: 'folder',
        name: 'Test',
      },
      files: [],
    },
  })
  vi.mocked(commands.closeCreationPerformerWindows).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  dispose = setupPerformerWindowBridge()
})

describe('independent performer windows', () => {
  it('does not publish late send/focus errors from a replaced project', async () => {
    await openPerformerWindow('phone', 'portrait')
    const label = labelAt()
    let failSend!: (error: Error) => void
    let failFocus!: (error: Error) => void
    vi.mocked(emitTo).mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        failSend = reject
      })
    )
    const native = vi.mocked(WebviewWindow).mock.results[0]?.value
    native.setFocus.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        failFocus = reject
      })
    )
    deliver(PERFORMER_READY, { label })
    const focusing = focusPerformerWindow(label)
    await Promise.resolve()
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'new-project',
          root: '/new',
          name: 'New',
          source: 'folder',
        },
        files: [],
      },
    })
    failSend(new Error('Old configuration failed'))
    failFocus(new Error('Old focus failed'))
    await focusing
    await Promise.resolve()
    expect(useCreationPerformersStore.getState().error).toBeNull()
  })

  it('creates independent native clients, focuses one and closes only that window', async () => {
    await openPerformerWindow('phone', 'portrait')
    await openPerformerWindow('tablet', 'landscape')
    const clients = useCreationPerformersStore.getState().windows
    expect(clients).toHaveLength(2)
    expect(clients.map(client => client.number)).toEqual([1, 2])
    expect(clients[0]?.label).not.toBe(clients[1]?.label)
    expect(WebviewWindow).toHaveBeenNthCalledWith(
      1,
      clients[0]?.label,
      expect.objectContaining({
        url: 'performer.html',
        incognito: true,
        visible: false,
      })
    )
    expect(clients[0]?.pageStatus).toBe('loading')
    await focusPerformerWindow(labelAt(0))
    expect(
      vi.mocked(WebviewWindow).mock.results[0]?.value.setFocus
    ).toHaveBeenCalledOnce()
    await closePerformerWindow(labelAt(0))
    expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith([
      clients[0]?.label,
    ])
    expect(
      useCreationPerformersStore.getState().windows.map(client => client.label)
    ).toEqual([clients[1]?.label])
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('refreshes all pages, preserves shells on restart and ignores old navigation results', async () => {
    await openPerformerWindow('phone', 'portrait')
    await openPerformerWindow('tablet', 'landscape')
    const labels = useCreationPerformersStore
      .getState()
      .windows.map(client => client.label)
    labels.forEach(label => deliver(PERFORMER_READY, { label }))
    const previous = configFor(labelAt(0))
    expect(previous.url).toContain('http://127.0.0.1:6868/')
    const refreshed = refreshMonitorFromDisk()
    await waitFor(() =>
      expect(configFor(labelAt(0)).navigation).toBeGreaterThan(
        previous.navigation
      )
    )
    labels.forEach(label =>
      deliver(PERFORMER_PAGE, { ...configFor(label), loaded: true })
    )
    await refreshed
    expect(
      useCreationPerformersStore
        .getState()
        .windows.every(client => client.pageStatus === 'loaded')
    ).toBe(true)
    const old = configFor(labelAt(0))
    useSessionStore.setState({
      sessionStatus: 'starting',
      runId: old.runId + 1,
    })
    expect(configFor(labelAt(0)).url).toBeNull()
    const health = useSessionStore.getState().health
    if (!health?.scoreServer) throw new Error('Missing performer health')
    useSessionStore.setState({
      sessionStatus: 'ready',
      health: {
        ...health,
        scoreServer: { ...health.scoreServer, performerPort: 6968 },
      },
    })
    expect(configFor(labelAt(0)).url).toContain(':6968/')
    deliver(PERFORMER_PAGE, { ...old, loaded: true })
    expect(useCreationPerformersStore.getState().windows[0]?.pageStatus).toBe(
      'loading'
    )
    expect(WebviewWindow).toHaveBeenCalledTimes(2)
    expect(commands.closeCreationPerformerWindows).not.toHaveBeenCalled()
  })

  it('follows theme and language without navigating and observes native single-window destruction', async () => {
    await openPerformerWindow('phone', 'portrait')
    const label = labelAt(0)
    deliver(PERFORMER_READY, { label })
    const before = configFor(label)
    useSettingsStore.getState().setColorThemeSetting('brutal')
    await i18n.changeLanguage('zh-CN')
    expect(configFor(label)).toMatchObject({
      theme: 'brutal',
      locale: 'zh-CN',
      url: before.url,
      navigation: before.navigation,
    })
    deliver('performer-destroyed-event', { label })
    expect(useCreationPerformersStore.getState().windows).toHaveLength(0)
    await i18n.changeLanguage('en')
  })

  it('offers device choices and unknown connection facts, and closing the project cleans up all clients', async () => {
    render(<CreationPerformers />)
    fireEvent.change(screen.getByLabelText('New test device'), {
      target: { value: 'tablet' },
    })
    fireEvent.change(screen.getByLabelText('New test orientation'), {
      target: { value: 'landscape' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add performer' }))
    await screen.findByRole('button', { name: 'Focus performer #1' })
    const label = labelAt(0)
    act(() => deliver(PERFORMER_READY, { label }))
    expect(configFor(label)).toMatchObject({
      device: 'tablet',
      orientation: 'landscape',
    })
    expect(screen.getByText(/Connection unknown/)).toBeInTheDocument()
    const original = configFor(label)
    fireEvent.change(screen.getByLabelText('Orientation for performer #1'), {
      target: { value: 'portrait' },
    })
    expect(configFor(label)).toMatchObject({
      orientation: 'portrait',
      navigation: original.navigation,
      url: original.url,
    })
    await act(async () => {
      await stopAndReset()
    })
    expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith(null)
    expect(useCreationPerformersStore.getState().windows).toHaveLength(0)
    expect(useCreationStore.getState().workspace?.project.identity).toBe('test')
  })

  it('preserves clients on cancelled mode confirmation or main-window hiding, and closes them on mode exit', async () => {
    await openPerformerWindow('phone', 'portrait')
    const result = await commands.getSessionState()
    if (result.status !== 'ok') throw new Error('Missing test snapshot')
    let runtime: CreationRuntime = {
      generation: 'run-1',
      projectRoot: '/test',
      snapshot: { ...result.data, status: 'ready', projectPath: '/test' },
    }
    vi.mocked(commands.getCreationRuntime).mockImplementation(async () => ({
      status: 'ok',
      data: runtime,
    }))
    await useCreationStore.getState().prepareModeSwitch()
    useCreationStore.getState().cancelModeSwitch()
    window.dispatchEvent(new Event('blur'))
    expect(useCreationPerformersStore.getState().windows).toHaveLength(1)
    expect(commands.closeCreationPerformerWindows).not.toHaveBeenCalled()
    vi.mocked(commands.stopProject).mockImplementation(async () => {
      runtime = {
        ...runtime,
        generation: 'run-2',
        projectRoot: null,
        snapshot: { ...runtime.snapshot, status: 'idle', projectPath: null },
      }
      return { status: 'ok', data: null }
    })
    vi.mocked(commands.commitCreationProject).mockImplementation(async () => ({
      status: 'ok',
      data: runtime,
    }))
    await useCreationStore.getState().leave()
    expect(useCreationStore.getState().active).toBe(false)
    expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith(null)
    expect(useCreationPerformersStore.getState().windows).toHaveLength(0)
  })

  it('waits for pending native creation before cleanup and retires native creation errors', async () => {
    nativeCreation.deferred = true
    const opening = openPerformerWindow('phone', 'portrait')
    await waitFor(() => expect(WebviewWindow).toHaveBeenCalledOnce())
    const native = vi.mocked(WebviewWindow).mock.results[0]?.value as {
      once: ReturnType<typeof vi.fn>
    }
    const closing = closeAllPerformerWindows()
    expect(commands.closeCreationPerformerWindows).not.toHaveBeenCalled()
    const created = native.once.mock.calls.find(
      ([name]) => name === 'tauri://created'
    )?.[1] as () => void
    created()
    await Promise.all([opening, closing])
    expect(useCreationPerformersStore.getState().windows).toHaveLength(0)
    expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith(null)
    const failing = openPerformerWindow('phone', 'portrait')
    await waitFor(() => expect(WebviewWindow).toHaveBeenCalledTimes(2))
    const second = vi.mocked(WebviewWindow).mock.results[1]?.value as {
      once: ReturnType<typeof vi.fn>
    }
    const failed = second.once.mock.calls.find(
      ([name]) => name === 'tauri://error'
    )?.[1] as (event: { payload: string }) => void
    failed({ payload: 'Native create failed' })
    await failing
    expect(useCreationPerformersStore.getState().windows).toHaveLength(0)
    expect(useCreationPerformersStore.getState().error).toContain(
      'Native create failed'
    )
  })
})
