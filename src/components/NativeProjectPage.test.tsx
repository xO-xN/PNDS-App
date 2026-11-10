import { beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { listen } from '@tauri-apps/api/event'
import { NativeProjectPage } from './NativeProjectPage'
import { MonitorView } from './shell/MonitorView'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { useSettingsStore } from '@/store/settings-store'
import { previewMonitor } from '@/lib/parameter-preview'
import { ProjectionApp } from './projection/ProjectionApp'
import type { NativeProjectTransport } from '@/lib/native-project-page'
import { useKeyboardStore } from '@/store/keyboard-store'
import type * as TauriCore from '@tauri-apps/api/core'
import type * as TauriBindings from '@/lib/tauri-bindings'

vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...(await importOriginal<typeof TauriCore>()),
  isTauri: () => true,
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/lib/tauri-bindings', async importOriginal => {
  const original = await importOriginal<typeof TauriBindings>()
  const { listen } = await import('@tauri-apps/api/event')
  return {
    ...original,
    commands: {
      ...original.commands,
      syncProjectMediaView: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      closeProjectMediaView: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      postProjectMediaMessage: vi
        .fn()
        .mockResolvedValue({ status: 'ok', data: null }),
      getSessionState: vi.fn(),
      fadeInWindow: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    },
    events: new Proxy(original.events, {
      get: (events, name) =>
        name === 'projectMediaViewEvent'
          ? {
              listen: (callback: never) =>
                listen('project-media-view-event', callback),
            }
          : Reflect.get(events, name),
    }),
  }
})

const readySnapshot: TauriBindings.SessionSnapshot = {
  status: 'ready',
  projectName: 'Media fixture',
  projectPath: '/fixture',
  audioMode: 'internal',
  lanIp: '192.168.1.10',
  runtimeGeneration: '1',
  hostAddress: null,
  oscTarget: null,
  health: {
    status: 'ready',
    scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
  },
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 5,
  channelPlan: null,
  outputDevice: 'System default',
  projectionStarted: true,
  httpsEntry: { status: 'off', url: null, error: null },
  dnsMapping: { status: 'off', domain: null, ip: null, error: null },
}

it('opens the projection as a result consumer and keeps its page zoom declaration', async () => {
  vi.mocked(commands.getSessionState).mockResolvedValue({
    status: 'ok',
    data: readySnapshot,
  })
  render(<ProjectionApp initialZoom={150} />)
  await waitFor(() =>
    expect(screen.getByTitle('Project monitor')).toBeInTheDocument()
  )
  expect(document.querySelector('iframe')).toBeNull()
  await waitFor(() => expect(commands.syncProjectMediaView).toHaveBeenCalled())
  const opened = vi.mocked(commands.syncProjectMediaView).mock.calls.at(-1)?.[0]
  expect(opened).toEqual(
    expect.objectContaining({
      role: 'projection',
      url: expect.stringContaining('surface=venue'),
    })
  )
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'project-media-view-event')?.[1]
  act(() =>
    callback?.({
      payload: {
        label: 'projection',
        navigation: opened?.navigation,
        kind: 'message',
        data: { type: 'pnds-projection', zoom: 'page' },
      },
    } as never)
  )
  expect(screen.getByTestId('monitor-scale-frame')).toHaveStyle({
    transform: 'scale(1)',
  })
  const publish = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'session-snapshot-event')?.[1]
  act(() =>
    publish?.({
      payload: { snapshot: { ...readySnapshot, runtimeGeneration: '2' } },
    } as never)
  )
  await waitFor(() =>
    expect(
      vi.mocked(commands.syncProjectMediaView).mock.calls.at(-1)?.[0].generation
    ).toBe('2')
  )
  const replacement = vi
    .mocked(commands.syncProjectMediaView)
    .mock.calls.at(-1)?.[0]
  expect(replacement?.navigation).not.toBe(opened?.navigation)
  expect(screen.getByTestId('monitor-scale-frame')).toHaveStyle({
    transform: 'scale(1.5)',
  })
})

const target = {
  generation: '1',
  role: 'monitor' as const,
  url: 'http://192.168.1.10:6869/?_r=1',
  navigation: 'monitor-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({ active: false })
  useSettingsStore.setState({ settingsOpen: false })
  useKeyboardStore.setState({ commandKeyPressed: false })
})

it('acknowledges an explicit retirement only after its document close succeeds, with a retry on failure', async () => {
  let finish: (value: { status: 'error'; error: string }) => void = () =>
    undefined
  const closed = vi.fn()
  const ready = vi.fn()
  const { rerender } = render(
    <NativeProjectPage
      target={target}
      title="Project monitor"
      onClosed={closed}
      onReady={ready}
    />
  )
  await waitFor(() => expect(commands.syncProjectMediaView).toHaveBeenCalled())
  vi.mocked(commands.closeProjectMediaView).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  rerender(
    <NativeProjectPage
      target={target}
      title="Project monitor"
      retired
      onClosed={closed}
      onReady={ready}
    />
  )
  await waitFor(() => expect(commands.closeProjectMediaView).toHaveBeenCalled())
  expect(closed).not.toHaveBeenCalled()
  await act(async () => finish({ status: 'error', error: 'close failed' }))
  expect(closed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(closed).toHaveBeenCalledOnce())
  expect(ready).toHaveBeenLastCalledWith(null)
})

it('retries a failed navigation by closing its document before creating a distinct attempt', async () => {
  const loaded = vi.fn()
  render(
    <NativeProjectPage
      target={target}
      title="Project monitor"
      onLoad={loaded}
    />
  )
  await waitFor(() => expect(commands.syncProjectMediaView).toHaveBeenCalled())
  const outcome = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'project-media-view-event')?.[1]
  act(() =>
    outcome?.({
      payload: {
        label: 'main',
        navigation: target.navigation,
        kind: 'error',
        data: 'navigation failed',
      },
    } as never)
  )
  let finish!: (value: { status: 'ok'; data: null }) => void
  vi.mocked(commands.closeProjectMediaView).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(commands.closeProjectMediaView).toHaveBeenCalledWith(
      target.navigation,
      expect.any(Number)
    )
  )
  expect(
    vi
      .mocked(commands.syncProjectMediaView)
      .mock.calls.some(([next]) => next.navigation !== target.navigation)
  ).toBe(false)
  await act(async () => finish({ status: 'ok', data: null }))
  await waitFor(() =>
    expect(
      vi
        .mocked(commands.syncProjectMediaView)
        .mock.calls.some(([next]) => next.navigation !== target.navigation)
    ).toBe(true)
  )
  const next = vi.mocked(commands.syncProjectMediaView).mock.calls.at(-1)?.[0]
  act(() =>
    outcome?.({
      payload: {
        label: 'main',
        navigation: target.navigation,
        kind: 'loaded',
        data: null,
      },
    } as never)
  )
  expect(loaded).not.toHaveBeenCalled()
  const current = vi
    .mocked(listen)
    .mock.calls.filter(([name]) => name === 'project-media-view-event')
    .at(-1)?.[1]
  act(() =>
    current?.({
      payload: {
        label: 'main',
        navigation: next?.navigation,
        kind: 'loaded',
        data: null,
      },
    } as never)
  )
  expect(loaded).toHaveBeenCalledOnce()
})

it('delivers messages only to the current document endpoint and routes native Command and sidebar entry', async () => {
  const endpoint: { current: NativeProjectTransport | null } = { current: null }
  const received = vi.fn()
  const enter = vi.fn()
  render(
    <>
      <div data-sidebar-hover-zone="" onMouseEnter={enter} />
      <NativeProjectPage
        target={target}
        title="Project monitor"
        onReady={value => {
          endpoint.current = value
          value?.subscribe(received)
        }}
      />
    </>
  )
  await waitFor(() => expect(endpoint.current).not.toBeNull())
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'project-media-view-event')?.[1]
  act(() =>
    callback?.({
      payload: {
        label: 'projection',
        navigation: target.navigation,
        kind: 'message',
        data: { type: 'pnds-projection', zoom: 'page' },
      },
    } as never)
  )
  expect(received).not.toHaveBeenCalled()
  act(() =>
    callback?.({
      payload: {
        label: 'main',
        navigation: target.navigation,
        kind: 'message',
        data: { type: 'pnds:guest-focus', interacting: true },
      },
    } as never)
  )
  expect(received).toHaveBeenCalledWith({
    source: endpoint.current,
    origin: 'http://192.168.1.10:6869',
    data: { type: 'pnds:guest-focus', interacting: true },
  })
  endpoint.current?.postMessage(
    { type: 'pnds:locale', locale: 'en', version: 1 },
    'http://other'
  )
  endpoint.current?.postMessage(
    { type: 'pnds:locale', locale: 'en', version: 1 },
    '*'
  )
  expect(commands.postProjectMediaMessage).not.toHaveBeenCalled()
  endpoint.current?.postMessage(
    { type: 'pnds:locale', locale: 'en', version: 1 },
    'http://192.168.1.10:6869'
  )
  await waitFor(() =>
    expect(commands.postProjectMediaMessage).toHaveBeenCalledWith(
      target.navigation,
      { type: 'pnds:locale', locale: 'en', version: 1 }
    )
  )
  act(() =>
    callback?.({
      payload: {
        label: 'main',
        navigation: target.navigation,
        kind: 'input',
        data: { command: true, edge: 'left' },
      },
    } as never)
  )
  expect(useKeyboardStore.getState().commandKeyPressed).toBe(false)
  expect(enter).toHaveBeenCalledOnce()
  act(() =>
    callback?.({
      payload: {
        label: 'main',
        navigation: target.navigation,
        kind: 'message',
        data: { type: 'pnds:guest-focus', interacting: false },
      },
    } as never)
  )
  expect(useKeyboardStore.getState().commandKeyPressed).toBe(true)
})

it('keeps Command editing with a meaningful guest input and only reclaims after its idle pointer leaves', async () => {
  render(<NativeProjectPage target={target} title="Project monitor" />)
  await waitFor(() => expect(commands.syncProjectMediaView).toHaveBeenCalled())
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'project-media-view-event')?.[1]
  const report = (kind: string, data: unknown) =>
    callback?.({
      payload: { label: 'main', navigation: target.navigation, kind, data },
    } as never)
  act(() => report('message', { type: 'pnds:guest-focus', interacting: true }))
  act(() =>
    report('input', { command: true, pointerInside: true, interacting: true })
  )
  expect(useKeyboardStore.getState().commandKeyPressed).toBe(false)
  expect(commands.postProjectMediaMessage).not.toHaveBeenCalledWith(
    target.navigation,
    { type: 'pnds:host-focus', version: 1 }
  )
  act(() => report('message', { type: 'pnds:guest-focus', interacting: false }))
  expect(useKeyboardStore.getState().commandKeyPressed).toBe(false)
  act(() =>
    report('input', {
      command: false,
      pointerInside: false,
      interacting: false,
    })
  )
  await waitFor(() =>
    expect(commands.postProjectMediaMessage).toHaveBeenCalledWith(
      target.navigation,
      { type: 'pnds:host-focus', version: 1 }
    )
  )
})

it('keeps one visible native document behind App overlays and closes its navigation on release', async () => {
  const loaded = vi.fn()
  const { unmount } = render(
    <NativeProjectPage
      target={target}
      title="Project monitor"
      onLoad={loaded}
    />
  )
  const surface = screen.getByTitle('Project monitor')
  mockBoundingClientRect(surface, {
    left: 10,
    top: 20,
    width: 900,
    height: 600,
  })
  fireEvent.resize(window)
  await waitFor(() =>
    expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
      target,
      expect.any(Number),
      expect.objectContaining({ width: 900, height: 600 })
    )
  )
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'project-media-view-event')?.[1]
  expect(callback).toBeDefined()
  act(() =>
    callback?.({
      payload: {
        label: 'main',
        navigation: 'old-page',
        kind: 'loaded',
        data: null,
      },
    } as never)
  )
  expect(loaded).not.toHaveBeenCalled()
  act(() =>
    callback?.({
      payload: {
        label: 'main',
        navigation: target.navigation,
        kind: 'loaded',
        data: null,
      },
    } as never)
  )
  expect(loaded).toHaveBeenCalledOnce()
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  act(() => document.body.append(dialog))
  await waitFor(() =>
    expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
      target,
      expect.any(Number),
      expect.objectContaining({
        width: 900,
        height: 600,
        occlusions: [{ x: 0, y: 0, width: 900, height: 600 }],
      })
    )
  )
  expect(commands.closeProjectMediaView).not.toHaveBeenCalled()
  act(() => dialog.remove())
  await waitFor(() =>
    expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
      target,
      expect.any(Number),
      expect.objectContaining({ width: 900 })
    )
  )
  unmount()
  expect(document.body).not.toHaveAttribute('data-native-project-compositor')
  await waitFor(() =>
    expect(commands.closeProjectMediaView).toHaveBeenCalledWith(
      target.navigation,
      expect.any(Number)
    )
  )
})

it('refreshes shell colors for a root theme attribute change without a resize', async () => {
  const style = document.createElement('style')
  style.textContent =
    '[data-color-theme="compositor-light"] body { background-color: rgb(20, 40, 60) } [data-color-theme="compositor-dark"] body { background-color: rgb(80, 100, 120) }'
  document.head.append(style)
  const originalTheme =
    document.documentElement.getAttribute('data-color-theme')
  document.documentElement.setAttribute('data-color-theme', 'compositor-light')
  try {
    const { unmount } = render(
      <NativeProjectPage target={target} title="Project monitor" />
    )
    mockBoundingClientRect(screen.getByTitle('Project monitor'), {
      left: 0,
      top: 0,
      width: 900,
      height: 600,
    })
    fireEvent.resize(window)
    await waitFor(() =>
      expect(
        document.body.style.getPropertyValue('--native-project-background')
      ).toBe('rgb(20, 40, 60)')
    )
    act(() =>
      document.documentElement.setAttribute(
        'data-color-theme',
        'compositor-dark'
      )
    )
    await waitFor(() =>
      expect(
        document.body.style.getPropertyValue('--native-project-background')
      ).toBe('rgb(80, 100, 120)')
    )
    act(() => useSettingsStore.setState({ settingsOpen: true }))
    expect(document.body).toHaveAttribute('data-native-project-compositor')
    unmount()
    expect(document.body).not.toHaveAttribute('data-native-project-compositor')
  } finally {
    style.remove()
    if (originalTheme === null)
      document.documentElement.removeAttribute('data-color-theme')
    else
      document.documentElement.setAttribute('data-color-theme', originalTheme)
  }
})

it.each(['dialog', 'menu', 'listbox'])(
  'keeps painting while an App %s owns keyboard and outside-dismiss input',
  async role => {
    render(
      <>
        <NativeProjectPage target={target} title="Project monitor" />
        <div
          role={role}
          data-slot={role === 'dialog' ? 'popover-content' : undefined}
        >
          <input aria-label="Overlay input" />
        </div>
      </>
    )
    mockBoundingClientRect(screen.getByTitle('Project monitor'), {
      left: 0,
      top: 0,
      width: 900,
      height: 600,
    })
    fireEvent.resize(window)
    await waitFor(() =>
      expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
        target,
        expect.any(Number),
        expect.objectContaining({
          width: 900,
          height: 600,
          opacity: 1,
          occlusions: [{ x: 0, y: 0, width: 900, height: 600 }],
        })
      )
    )
    expect(commands.closeProjectMediaView).not.toHaveBeenCalled()
  }
)

it('preserves the full test viewport and rounded corners beneath a single App reveal cover', async () => {
  render(
    <>
      <div data-native-page-cover="" style={{ opacity: 0.4 }} />
      <NativeProjectPage
        target={target}
        title="Project monitor"
        style={{ borderRadius: '28px' }}
      />
    </>
  )
  const surface = screen.getByTitle('Project monitor')
  Object.defineProperties(surface, {
    clientWidth: { value: 390, configurable: true },
    clientHeight: { value: 844, configurable: true },
  })
  mockBoundingClientRect(surface, { left: 0, top: 0, width: 195, height: 422 })
  fireEvent.resize(window)
  await waitFor(() =>
    expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
      target,
      expect.any(Number),
      expect.objectContaining({
        pageWidth: 390,
        pageHeight: 844,
        width: 195,
        height: 422,
        cornerRadius: 14,
        opacity: 1,
      })
    )
  )
})

it('routes only intersecting App notice input regions while the score keeps its full viewport', async () => {
  const copy = vi.fn()
  const { rerender } = render(
    <>
      <NativeProjectPage target={target} title="Project monitor" />
      <div data-native-overlay="" role="status" aria-label="Runtime warning">
        <button onClick={copy}>Copy warning</button>
      </div>
      <div role="status">Unrelated live region</div>
    </>
  )
  mockBoundingClientRect(screen.getByTitle('Project monitor'), {
    left: 0,
    top: 0,
    width: 900,
    height: 600,
  })
  mockBoundingClientRect(
    screen.getByRole('status', { name: 'Runtime warning' }),
    {
      left: 650,
      top: 450,
      width: 200,
      height: 100,
    }
  )
  fireEvent.resize(window)
  await waitFor(() =>
    expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
      target,
      expect.any(Number),
      expect.objectContaining({
        width: 900,
        height: 600,
        occlusions: [{ x: 650, y: 450, width: 200, height: 100 }],
      })
    )
  )
  fireEvent.click(screen.getByRole('button', { name: 'Copy warning' }))
  expect(copy).toHaveBeenCalledOnce()
  expect(commands.closeProjectMediaView).not.toHaveBeenCalled()
  rerender(
    <>
      <NativeProjectPage target={target} title="Project monitor" />
      <div role="status">Unrelated live region</div>
    </>
  )
  fireEvent.resize(window)
  await waitFor(() =>
    expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
      target,
      expect.any(Number),
      expect.objectContaining({ width: 900, occlusions: [] })
    )
  )
})

it.each([
  { direction: 'ltr', left: 12, command: false },
  { direction: 'ltr', left: 12, command: true },
  { direction: 'rtl', left: 628, command: false },
])(
  'keeps the monitor visible beside a $direction sidebar with Command held: $command',
  async ({ direction, left, command }) => {
    document.documentElement.style.direction = direction
    try {
      render(
        <>
          <NativeProjectPage target={target} title="Project monitor" />
          <div
            data-testid="monitor-test-sidebar"
            data-sidebar-motion=""
            style={{ opacity: 1 }}
          />
        </>
      )
      mockBoundingClientRect(screen.getByTitle('Project monitor'), {
        left: 0,
        top: 0,
        width: 900,
        height: 600,
      })
      const sidebar = screen.getByTestId('monitor-test-sidebar')
      mockBoundingClientRect(sidebar, {
        left,
        top: 12,
        width: 260,
        height: 500,
      })
      act(() => useKeyboardStore.setState({ commandKeyPressed: command }))
      fireEvent.resize(window)
      const visibleBounds = expect.objectContaining({
        width: 900,
        height: 600,
        occlusions: [{ x: left, y: 12, width: 260, height: 500 }],
      })
      await waitFor(() =>
        expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
          target,
          expect.any(Number),
          visibleBounds
        )
      )
      // The exiting sidebar is already inert while its last frames still
      // cover the page. Keep its local hole until the fade has finished.
      act(() => {
        sidebar.setAttribute('inert', '')
        sidebar.style.opacity = '0.5'
        fireEvent.transitionEnd(sidebar)
      })
      await waitFor(() =>
        expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
          target,
          expect.any(Number),
          visibleBounds
        )
      )
      act(() => {
        sidebar.style.opacity = '0'
        useKeyboardStore.setState({ commandKeyPressed: false })
        fireEvent.transitionEnd(sidebar)
      })
      await waitFor(() =>
        expect(commands.syncProjectMediaView).toHaveBeenLastCalledWith(
          target,
          expect.any(Number),
          expect.objectContaining({ width: 900, occlusions: [] })
        )
      )
      expect(commands.closeProjectMediaView).not.toHaveBeenCalled()
      expect(
        vi
          .mocked(commands.syncProjectMediaView)
          .mock.calls.every(([page]) => page.navigation === target.navigation)
      ).toBe(true)
    } finally {
      document.documentElement.style.removeProperty('direction')
    }
  }
)

it('opens the public Host monitor through its native page and reveals only its matching load', async () => {
  useSessionStore.getState().applySnapshot(readySnapshot)
  useSessionStore.setState({
    sessionStatus: 'ready',
    lanIp: '192.168.1.10',
    monitorReloadNonce: 0,
    monitorLoaded: false,
    monitorLoadTimedOut: false,
    health: {
      status: 'ready',
      projectId: 'native-media',
      audioMode: 'internal',
      audio: { status: 'running', target: null, error: null },
      scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
    },
  })
  render(<MonitorView />)
  expect(document.querySelector('iframe')).toBeNull()
  await waitFor(() => expect(commands.syncProjectMediaView).toHaveBeenCalled())
  const opened = vi.mocked(commands.syncProjectMediaView).mock.calls.at(-1)?.[0]
  expect(opened).toEqual(
    expect.objectContaining({
      role: 'monitor',
      url: expect.stringContaining('http://192.168.1.10:6869/'),
    })
  )
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'project-media-view-event')?.[1]
  act(() =>
    callback?.({
      payload: { label: 'main', navigation: 'old', kind: 'loaded', data: null },
    } as never)
  )
  expect(useSessionStore.getState().monitorLoaded).toBe(false)
  act(() =>
    callback?.({
      payload: {
        label: 'main',
        navigation: opened?.navigation,
        kind: 'loaded',
        data: null,
      },
    } as never)
  )
  expect(useSessionStore.getState().monitorLoaded).toBe(true)
  expect(previewMonitor()?.target).toBeDefined()
})

it.each(['monitor', 'projection'] as const)(
  'preserves canonical native bridges for a mixed-case declared host on %s',
  async role => {
    const snapshot = { ...readySnapshot, hostAddress: 'Stage.Local' }
    if (role === 'monitor') {
      useSessionStore.getState().applySnapshot(snapshot)
      render(<MonitorView />)
    } else {
      vi.mocked(commands.getSessionState).mockResolvedValue({
        status: 'ok',
        data: snapshot,
      })
      render(<ProjectionApp initialZoom={100} />)
    }
    await waitFor(() =>
      expect(commands.syncProjectMediaView).toHaveBeenCalled()
    )
    const opened = vi
      .mocked(commands.syncProjectMediaView)
      .mock.calls.at(-1)?.[0]
    expect(opened?.url).toContain('Stage.Local:6869')
    const outcome = vi
      .mocked(listen)
      .mock.calls.find(([name]) => name === 'project-media-view-event')?.[1]
    act(() =>
      outcome?.({
        payload: {
          label: role === 'monitor' ? 'main' : 'projection',
          navigation: opened?.navigation,
          kind: 'loaded',
          data: null,
        },
      } as never)
    )
    await waitFor(() =>
      expect(commands.postProjectMediaMessage).toHaveBeenCalledWith(
        opened?.navigation,
        expect.objectContaining({ type: 'pnds:locale' })
      )
    )
    expect(commands.postProjectMediaMessage).toHaveBeenCalledWith(
      opened?.navigation,
      expect.objectContaining({ type: 'pnds:theme' })
    )
    if (role === 'monitor')
      expect(previewMonitor()?.origin).toBe('http://stage.local:6869')
  }
)
