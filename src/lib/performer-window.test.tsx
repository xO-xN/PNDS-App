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
  configurePerformerWindow,
  closePerformerWindow,
  closeAllPerformerWindows,
  focusPerformerWindow,
  openPerformerWindow,
  setupPerformerWindowBridge,
  setPerformerWindowVisible,
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
  vi.mocked(emitTo).mockImplementation(async (_target, name, payload) => {
    const config = payload as PerformerConfig
    if (name === PERFORMER_CONFIG && config.disposing)
      queueMicrotask(() => deliver('pnds:performer-released', config))
  })
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

  it('focuses clients by number, follows shell device choices and rejects stale options without navigating', async () => {
    render(<CreationPerformers />)
    fireEvent.click(screen.getByRole('button', { name: 'Add performer' }))
    const focus = await screen.findByRole('button', {
      name: 'Focus performer #1',
    })
    expect(
      screen.queryByRole('checkbox', { name: 'Mouse simulates one touch' })
    ).not.toBeInTheDocument()
    const label = labelAt(0)
    act(() => deliver(PERFORMER_READY, { label }))
    fireEvent.click(focus)
    await waitFor(() =>
      expect(
        vi.mocked(WebviewWindow).mock.results[0]?.value.setFocus
      ).toHaveBeenCalled()
    )
    expect(configFor(label)).toMatchObject({
      device: 'phone',
      orientation: 'portrait',
    })
    expect(screen.getByText(/Connection unknown/)).toBeInTheDocument()
    const original = configFor(label)
    const options = {
      label,
      identity: original.identity,
      runId: original.runId,
      navigation: original.navigation,
      revision: original.revision,
      options: { device: 'tablet', orientation: 'landscape' },
    }
    act(() => deliver('pnds:performer-options', options))
    expect(configFor(label)).toMatchObject({
      device: 'tablet',
      orientation: 'landscape',
      navigation: original.navigation,
      url: original.url,
    })
    expect(screen.getByText('Tablet · Landscape')).toBeInTheDocument()
    vi.mocked(emitTo).mockClear()
    act(() =>
      deliver('pnds:performer-options', {
        ...options,
        options: { orientation: 'portrait' },
      })
    )
    expect(configFor(label).orientation).toBe('landscape')
    expect(emitTo).toHaveBeenCalledWith(
      label,
      PERFORMER_CONFIG,
      expect.objectContaining({ orientation: 'landscape' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add performer' }))
    await screen.findByRole('button', { name: 'Focus performer #2' })
    const second = labelAt(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete performer #1' }))
    await waitFor(() =>
      expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith([
        label,
      ])
    )
    act(() => deliver('performer-destroyed-event', { label }))
    expect(
      useCreationPerformersStore.getState().windows.map(client => client.label)
    ).toEqual([second])
    await act(async () => {
      await stopAndReset()
    })
    expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith(null)
    expect(useCreationPerformersStore.getState().windows).toHaveLength(0)
    expect(useCreationStore.getState().workspace?.project.identity).toBe('test')
  })

  it('keeps a hidden device in the list, reopens the same client and deletes it only with X', async () => {
    render(<CreationPerformers />)
    fireEvent.click(screen.getByRole('button', { name: 'Add performer' }))
    await screen.findByRole('button', { name: 'Focus performer #1' })
    const label = labelAt()
    act(() => deliver(PERFORMER_READY, { label }))
    act(() => deliver('performer-visibility-event', { label, visible: true }))
    const before = configFor(label)
    fireEvent.click(screen.getByRole('button', { name: 'Hide performer #1' }))
    await screen.findByRole('button', { name: 'Show performer #1' })
    expect(labelAt()).toBe(label)
    expect(configFor(label)).toMatchObject({
      identity: before.identity,
      navigation: before.navigation,
      url: before.url,
    })
    expect(commands.closeCreationPerformerWindows).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show performer #1' }))
    await screen.findByRole('button', { name: 'Hide performer #1' })
    expect(labelAt()).toBe(label)
    fireEvent.click(screen.getByRole('button', { name: 'Delete performer #1' }))
    await waitFor(() =>
      expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith([
        label,
      ])
    )
    expect(useCreationPerformersStore.getState().windows).toHaveLength(0)
  })

  it('waits for the matching real-page release before deleting one device and leaves the other alive', async () => {
    await openPerformerWindow('phone', 'portrait')
    await openPerformerWindow('tablet', 'landscape')
    const label = labelAt(0)
    const second = labelAt(1)
    deliver(PERFORMER_READY, { label })
    const old = configFor(label)
    vi.mocked(emitTo).mockResolvedValue(undefined)
    const closing = closePerformerWindow(label)
    await waitFor(() => expect(configFor(label).disposing).toBe(true))
    expect(commands.closeCreationPerformerWindows).not.toHaveBeenCalled()
    deliver('pnds:performer-released', old)
    await Promise.resolve()
    expect(commands.closeCreationPerformerWindows).not.toHaveBeenCalled()
    deliver('pnds:performer-released', configFor(label))
    await closing
    expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith([label])
    expect(
      useCreationPerformersStore.getState().windows.map(client => client.label)
    ).toEqual([second])
  })

  it('can still delete an unresponsive shell after the bounded release wait', async () => {
    await openPerformerWindow('phone', 'portrait')
    const label = labelAt()
    deliver(PERFORMER_READY, { label })
    vi.mocked(emitTo).mockResolvedValue(undefined)
    vi.useFakeTimers()
    try {
      const closing = closePerformerWindow(label)
      await vi.advanceTimersByTimeAsync(1500)
      await closing
      expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith([
        label,
      ])
      expect(useCreationPerformersStore.getState().windows).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a red-close visibility event wins over a late show response', async () => {
    await openPerformerWindow('phone', 'portrait')
    const label = labelAt()
    deliver(PERFORMER_READY, { label })
    let finish!: (value: { status: 'ok'; data: null }) => void
    vi.mocked(commands.setCreationPerformerVisibility).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    const showing = setPerformerWindowVisible(label, true)
    await waitFor(() =>
      expect(commands.setCreationPerformerVisibility).toHaveBeenCalledWith(
        label,
        true
      )
    )
    deliver('performer-visibility-event', { label, visible: false })
    finish({ status: 'ok', data: null })
    await showing
    expect(useCreationPerformersStore.getState().windows[0]?.visible).toBe(
      false
    )
    expect(
      vi.mocked(WebviewWindow).mock.results[0]?.value.setFocus
    ).not.toHaveBeenCalled()
  })

  it('a hung config send cannot strand deletion beyond the release deadline', async () => {
    await openPerformerWindow('phone', 'portrait')
    const label = labelAt()
    deliver(PERFORMER_READY, { label })
    vi.mocked(emitTo).mockImplementation(
      () => new Promise<void>(() => undefined)
    )
    vi.useFakeTimers()
    try {
      const closing = closePerformerWindow(label)
      await vi.advanceTimersByTimeAsync(1500)
      expect(commands.closeCreationPerformerWindows).toHaveBeenCalledWith([
        label,
      ])
      await closing
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps viewport options usable while the test is in standby without starting music', async () => {
    await openPerformerWindow('phone', 'portrait')
    const label = labelAt()
    deliver(PERFORMER_READY, { label })
    useSessionStore.setState({ sessionStatus: 'error' })
    const standby = configFor(label)
    expect(standby.url).toBeNull()
    await configurePerformerWindow(label, 'tablet', 'landscape', false)
    expect(configFor(label)).toMatchObject({
      device: 'tablet',
      orientation: 'landscape',
      mouseTouch: false,
      navigation: standby.navigation,
      url: null,
    })
    expect(commands.startProject).not.toHaveBeenCalled()
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
