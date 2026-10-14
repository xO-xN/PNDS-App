import { act, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@/test/test-utils'
import { buildAppMenu, setupMenuStateListener } from '@/lib/menu'
import {
  commands,
  type Manifest,
  type SessionSnapshot,
} from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { useCreationStore } from '@/store/creation-store'
import { useSettingsStore } from '@/store/settings-store'
import { useWindowStore } from '@/store/window-store'
import { AppShell } from './AppShell'

interface NativeMenuItem {
  id?: string
  text?: string
  accelerator?: string
  enabled?: boolean
  action?: () => void
}
const nativeMenu = vi.hoisted(() => new Map<string, NativeMenuItem>())
vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: vi.fn(async () => ({ setAsAppMenu: vi.fn() })) },
  Submenu: { new: vi.fn(async (options: unknown) => options) },
  PredefinedMenuItem: { new: vi.fn(async (options: unknown) => options) },
  MenuItem: {
    new: vi.fn(async (options: NativeMenuItem) => {
      if (options.id) nativeMenu.set(options.id, options)
      return options
    }),
  },
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    onFocusChanged: vi.fn().mockResolvedValue(() => undefined),
  })),
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'first',
  name: 'First',
  version: '1.0.0',
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
    synthdefs: [],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}
const runningSnapshot: SessionSnapshot = {
  status: 'ready',
  projectName: 'First',
  projectPath: '/first',
  audioMode: 'none',
  lanIp: '192.168.1.10',
  hostAddress: '192.168.1.10',
  oscTarget: null,
  health: {
    status: 'ready',
    projectId: 'first',
    audioMode: 'none',
    audio: { status: 'disabled', target: null, error: null },
    scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
  },
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 0,
  channelPlan: null,
  outputDevice: null,
  projectionStarted: false,
  httpsEntry: { status: 'off', url: null, error: null },
  dnsMapping: { status: 'off', domain: null, ip: null, error: null },
}
function menuItem(id: string): NativeMenuItem {
  const item = nativeMenu.get(id)
  if (!item) throw new Error(`Native menu item ${id} is missing`)
  return item
}
async function selectFromMenu(direction: 'previous' | 'next'): Promise<void> {
  await act(async () => menuItem(`select-${direction}-project`).action?.())
}

// Invokes the native-menu callback at the public user workflow seam.
// jsdom does not exercise macOS accelerator delivery or real iframe focus.
describe('performance selection from the native menu (#202)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nativeMenu.clear()
    useProjectStore.setState({
      currentProject: { path: '/first', manifest },
      recentProjectPaths: ['/first', '/second', '/third'],
      projectFolders: [],
      activeFolderId: null,
      pendingPreflightPath: null,
      preflightStatus: 'ready',
      preflightError: null,
      renameTarget: null,
      confirmCloseProjectOpen: false,
    })
    useSessionStore.getState().resetSession()
    useSessionStore.getState().applySnapshot(runningSnapshot)
    useSessionStore.setState({
      commandPending: false,
      lanIp: '192.168.1.10',
      audioMode: 'none',
      oscTargetInput: '127.0.0.1:57120',
    })
    useCreationStore.setState({
      active: false,
      opening: false,
      modePhase: 'idle',
    })
    useSettingsStore.setState({ settingsOpen: false })
    useWindowStore.setState({
      confirmCloseOpen: false,
      quitConfirmOpen: false,
      fullscreen: false,
    })
    useKeyboardStore.getState().setCommandKeyPressed(false)
    useKeyboardStore.getState().setProjectSelectionRevealed(false)
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: runningSnapshot,
    })
    vi.mocked(commands.focusedWindowLabel).mockResolvedValue({
      status: 'ok',
      data: 'main',
    })
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: manifest,
    })
  })

  it('reveals the sidebar and selects another card without navigating or replacing the running monitor', async () => {
    render(<AppShell />)
    await act(async () => {
      await buildAppMenu()
    })
    const monitor = screen.getByTitle('Project monitor')
    const address = monitor.getAttribute('src')
    act(() => monitor.focus())
    expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-0')
    expect(menuItem('select-next-project')).toMatchObject({
      text: 'Select Next Project',
      accelerator: 'Cmd+Alt+ArrowDown',
      enabled: true,
    })
    await selectFromMenu('next')
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/second')
    )
    expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-100')
    expect(screen.getByTitle('Project monitor')).toBe(monitor)
    expect(monitor.getAttribute('src')).toBe(address)
    expect(useSessionStore.getState().sessionProjectPath).toBe('/first')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })
  it.each(['release', 'pointer', 'blur'] as const)(
    'releases the native sidebar reveal after %s, including a swallowed monitor keyup',
    async release => {
      render(<AppShell />)
      await act(async () => {
        await buildAppMenu()
      })
      await selectFromMenu('next')
      await waitFor(() =>
        expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-100')
      )
      if (release === 'release') fireEvent.keyUp(window, { key: 'Meta' })
      if (release === 'pointer') fireEvent.mouseMove(window, { metaKey: false })
      if (release === 'blur') fireEvent.blur(window)
      expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-0')
    }
  )

  it('follows the active folder order, clamps both ends, and keeps the running project separate', async () => {
    useProjectStore.setState({
      projectFolders: [
        {
          id: 'set',
          name: 'Set',
          projectPaths: ['/third', '/first'],
          intro: null,
        },
      ],
      activeFolderId: 'set',
    })
    await buildAppMenu()
    expect(menuItem('select-previous-project').accelerator).toBe(
      'Cmd+Alt+ArrowUp'
    )
    await selectFromMenu('previous')
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/third')
    )
    await selectFromMenu('previous')
    expect(useProjectStore.getState().currentProject?.path).toBe('/third')
    await selectFromMenu('next')
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/first')
    )
    await selectFromMenu('next')
    expect(useProjectStore.getState().currentProject?.path).toBe('/first')
    expect(useProjectStore.getState().activeFolderId).toBe('set')
    expect(useSessionStore.getState().sessionProjectPath).toBe('/first')
    expect(commands.preflightProject).toHaveBeenCalledTimes(2)
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(
      [...nativeMenu.values()].filter(
        item =>
          item.accelerator?.includes('ArrowLeft') ||
          item.accelerator?.includes('ArrowRight')
      )
    ).toEqual([])
  })

  it.each([
    'help',
    'projection',
    'performer-00000000-0000-4000-8000-000000000001',
    'unknown',
  ])(
    'ignores the action while %s is focused and disables its native accelerator',
    async label => {
      await buildAppMenu()
      const staleAction = menuItem('select-next-project').action
      vi.mocked(commands.focusedWindowLabel).mockResolvedValue({
        status: 'ok',
        data: label,
      })
      await act(async () => staleAction?.())
      expect(useProjectStore.getState().currentProject?.path).toBe('/first')
      expect(commands.preflightProject).not.toHaveBeenCalled()
      await buildAppMenu()
      expect(menuItem('select-next-project').enabled).toBe(false)
      expect(menuItem('select-previous-project').enabled).toBe(false)
    }
  )

  it('Cmd+Opt+Return loads the newly selected card through the existing replacement confirmation', async () => {
    render(<AppShell />)
    await act(async () => {
      await buildAppMenu()
    })
    const monitor = screen.getByTitle('Project monitor')
    await selectFromMenu('next')
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/second')
    )
    await act(async () => {
      await buildAppMenu()
    })
    expect(menuItem('load-selected-project')).toMatchObject({
      text: 'Load Selected Project',
      accelerator: 'Cmd+Alt+Enter',
      enabled: true,
    })
    await act(async () => menuItem('load-selected-project').action?.())
    const confirm = await screen.findByRole('alertdialog')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessionProjectPath).toBe('/first')
    expect(screen.getByTitle('Project monitor')).toBe(monitor)
    fireEvent.click(within(confirm).getByRole('button', { name: 'Start' }))
    await waitFor(() =>
      expect(commands.startProject).toHaveBeenCalledWith(
        '/second',
        'none',
        '192.168.1.10',
        null
      )
    )
    expect(commands.stopProject).toHaveBeenCalledTimes(1)
    expect(commands.startProject).toHaveBeenCalledTimes(1)
  })

  it.each(['idle', 'error'] as const)(
    'native Load starts once from %s while an input is focused',
    async status => {
      const snapshot = {
        ...runningSnapshot,
        status,
        projectPath: null,
        health: null,
      }
      useSessionStore.getState().applySnapshot(snapshot)
      vi.mocked(commands.getSessionState).mockResolvedValue({
        status: 'ok',
        data: snapshot,
      })
      let finishStart!: (
        result: Awaited<ReturnType<typeof commands.startProject>>
      ) => void
      vi.mocked(commands.startProject).mockReturnValueOnce(
        new Promise(resolve => {
          finishStart = resolve
        })
      )
      render(
        <>
          <AppShell />
          <input aria-label="Native load input" />
        </>
      )
      const input = screen.getByRole('textbox', { name: 'Native load input' })
      act(() => input.focus())
      await act(async () => {
        await buildAppMenu()
      })
      await act(async () => menuItem('load-selected-project').action?.())
      await act(async () => menuItem('load-selected-project').action?.())
      try {
        expect(commands.startProject).toHaveBeenCalledExactlyOnceWith(
          '/first',
          'none',
          '192.168.1.10',
          null
        )
        expect(commands.stopProject).not.toHaveBeenCalled()
        expect(useSessionStore.getState().commandPending).toBe(true)
        expect(document.activeElement).toBe(input)
      } finally {
        await act(async () => finishStart({ status: 'ok', data: null }))
      }
    }
  )

  it('native Load never closes the unchanged running card and applies pending changes through restart', async () => {
    render(<AppShell />)
    await act(async () => {
      await buildAppMenu()
    })
    expect(menuItem('load-selected-project').enabled).toBe(false)
    await act(async () => menuItem('load-selected-project').action?.())
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    act(() => useSessionStore.setState({ pendingChanges: true }))
    await act(async () => {
      await buildAppMenu()
    })
    expect(menuItem('load-selected-project').enabled).toBe(true)
    await act(async () => menuItem('load-selected-project').action?.())
    await waitFor(() =>
      expect(commands.startProject).toHaveBeenCalledExactlyOnceWith(
        '/first',
        'none',
        '192.168.1.10',
        null
      )
    )
    expect(commands.stopProject).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('does not load the previous card while Down awaits native focus', async () => {
    const snapshot = {
      ...runningSnapshot,
      status: 'idle' as const,
      projectPath: null,
      health: null,
    }
    useSessionStore.getState().applySnapshot(snapshot)
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot,
    })
    render(<AppShell />)
    await act(async () => {
      await buildAppMenu()
    })
    let finishFocus!: (
      result: Awaited<ReturnType<typeof commands.focusedWindowLabel>>
    ) => void
    vi.mocked(commands.focusedWindowLabel).mockReturnValueOnce(
      new Promise(resolve => {
        finishFocus = resolve
      })
    )
    await selectFromMenu('next')
    await act(async () => menuItem('load-selected-project').action?.())
    expect(commands.startProject).not.toHaveBeenCalled()
    await act(async () => finishFocus({ status: 'ok', data: 'main' }))
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/second')
    )
    expect(commands.startProject).not.toHaveBeenCalled()
    await act(async () => menuItem('load-selected-project').action?.())
    await waitFor(() =>
      expect(commands.startProject).toHaveBeenCalledExactlyOnceWith(
        '/second',
        'none',
        '192.168.1.10',
        null
      )
    )
  })

  it('requires a new Load after selected-card preflight finishes instead of loading the previous running card', async () => {
    render(<AppShell />)
    await act(async () => {
      await buildAppMenu()
    })
    let finishPreflight!: (
      result: Awaited<ReturnType<typeof commands.preflightProject>>
    ) => void
    vi.mocked(commands.preflightProject).mockReturnValueOnce(
      new Promise(resolve => {
        finishPreflight = resolve
      })
    )
    await selectFromMenu('next')
    expect(useProjectStore.getState().pendingPreflightPath).toBe('/second')
    await act(async () => menuItem('load-selected-project').action?.())
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await act(async () => finishPreflight({ status: 'ok', data: manifest }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await act(async () => menuItem('load-selected-project').action?.())
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(useSessionStore.getState().sessionProjectPath).toBe('/first')
  })

  it.each([
    'preflight',
    'lan',
    'node',
    'target',
    'command',
    'mode',
    'settings',
    'quit',
    'secondary',
  ] as const)(
    'rebuilds native Load availability and ignores stale callbacks behind the %s gate',
    async gate => {
      const snapshot = {
        ...runningSnapshot,
        status: 'idle' as const,
        projectPath: null,
        health: null,
      }
      useSessionStore.getState().applySnapshot(snapshot)
      vi.mocked(commands.getSessionState).mockResolvedValue({
        status: 'ok',
        data: snapshot,
      })
      if (gate === 'node') {
        useProjectStore.setState({
          currentProject: {
            path: '/first',
            manifest: { ...manifest, telematic: true },
          },
        })
        useSettingsStore.setState({
          nodeNameSetting: 'load-fixture',
          hubUrlSetting: 'wss://hub.example.com',
          hubTokenSetting: 'fixture-token',
        })
      }
      render(<AppShell />)
      await act(async () => {
        await buildAppMenu()
      })
      expect(menuItem('load-selected-project').enabled).toBe(true)
      const action = menuItem('load-selected-project').action
      const off = setupMenuStateListener()
      try {
        act(() => {
          if (gate === 'preflight')
            useProjectStore.setState({
              preflightStatus: 'checking',
              pendingPreflightPath: '/second',
            })
          if (gate === 'lan') useSessionStore.setState({ lanIp: null })
          if (gate === 'node')
            useSettingsStore.setState({ nodeNameSetting: '' })
          if (gate === 'target')
            useSessionStore.setState({
              audioMode: 'external',
              oscTargetInput: 'bad-target',
            })
          if (gate === 'command')
            useSessionStore.setState({ commandPending: true })
          if (gate === 'mode') useCreationStore.setState({ modePhase: 'armed' })
          if (gate === 'settings')
            useSettingsStore.setState({ settingsOpen: true })
          if (gate === 'quit')
            useWindowStore.setState({ quitConfirmOpen: true })
          if (gate === 'secondary')
            vi.mocked(commands.focusedWindowLabel).mockResolvedValue({
              status: 'ok',
              data: 'projection',
            })
        })
        if (gate === 'secondary')
          await act(async () => {
            await buildAppMenu()
          })
        await waitFor(() =>
          expect(menuItem('load-selected-project').enabled).toBe(false)
        )
        await act(async () => action?.())
        expect(commands.startProject).not.toHaveBeenCalled()
        expect(commands.stopProject).not.toHaveBeenCalled()
      } finally {
        off()
      }
    }
  )

  it.each(['selection', 'mode', 'overlay'] as const)(
    'rejects native Load when %s changes before a late focus reply',
    async gate => {
      useProjectStore.setState({
        currentProject: { path: '/second', manifest },
      })
      render(<AppShell />)
      await act(async () => {
        await buildAppMenu()
      })
      let finishFocus!: (
        result: Awaited<ReturnType<typeof commands.focusedWindowLabel>>
      ) => void
      vi.mocked(commands.focusedWindowLabel).mockReturnValueOnce(
        new Promise(resolve => {
          finishFocus = resolve
        })
      )
      await act(async () => menuItem('load-selected-project').action?.())
      act(() => {
        if (gate === 'selection')
          useProjectStore.setState({
            currentProject: { path: '/third', manifest },
          })
        if (gate === 'mode')
          useCreationStore.setState({
            epoch: useCreationStore.getState().epoch + 1,
          })
        if (gate === 'overlay')
          useWindowStore.setState({ confirmCloseOpen: true })
      })
      await act(async () => finishFocus({ status: 'ok', data: 'main' }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(commands.startProject).not.toHaveBeenCalled()
      expect(commands.stopProject).not.toHaveBeenCalled()
    }
  )

  it('keeps plain input Enter and the existing projection accelerator separate from native Load', async () => {
    const snapshot = {
      ...runningSnapshot,
      status: 'idle' as const,
      projectPath: null,
      health: null,
    }
    useSessionStore.getState().applySnapshot(snapshot)
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: snapshot,
    })
    render(
      <>
        <AppShell />
        <input aria-label="Normal Enter input" />
      </>
    )
    await act(async () => {
      await buildAppMenu()
    })
    expect(menuItem('projection-start').accelerator).toBe('Cmd+Return')
    const input = screen.getByRole('textbox', { name: 'Normal Enter input' })
    act(() => input.focus())
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true)
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
  })

  it('keeps the replacement confirmation in control of selection and the running show', async () => {
    render(<AppShell />)
    await act(async () => {
      await buildAppMenu()
    })
    await selectFromMenu('next')
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/second')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    const confirm = await screen.findByRole('alertdialog')
    await selectFromMenu('next')
    expect(useProjectStore.getState().currentProject?.path).toBe('/second')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await selectFromMenu('next')
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/third')
    )
  })

  it.each(['starting', 'stopping', 'mode', 'close-project'] as const)(
    'disables the native menu when the %s gate opens after it was built',
    async gate => {
      await buildAppMenu()
      const off = setupMenuStateListener()
      try {
        if (gate === 'starting' || gate === 'stopping')
          useSessionStore.setState({ sessionStatus: gate })
        if (gate === 'mode') useCreationStore.setState({ modePhase: 'armed' })
        if (gate === 'close-project')
          useProjectStore.setState({ confirmCloseProjectOpen: true })
        await waitFor(() =>
          expect(menuItem('select-next-project').enabled).toBe(false)
        )
        await selectFromMenu('next')
        expect(useProjectStore.getState().currentProject?.path).toBe('/first')
        expect(commands.preflightProject).not.toHaveBeenCalled()
      } finally {
        off()
      }
    }
  )

  it('advances from the visibly pending card while preflight is slow and ignores its late result', async () => {
    let finishFirst!: (
      result: Awaited<ReturnType<typeof commands.preflightProject>>
    ) => void
    vi.mocked(commands.preflightProject).mockReturnValueOnce(
      new Promise(resolve => {
        finishFirst = resolve
      })
    )
    await buildAppMenu()
    await selectFromMenu('next')
    expect(useProjectStore.getState().pendingPreflightPath).toBe('/second')
    await selectFromMenu('next')
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/third')
    )
    await act(async () => finishFirst({ status: 'ok', data: manifest }))
    expect(useProjectStore.getState().currentProject?.path).toBe('/third')
    expect(useSessionStore.getState().sessionProjectPath).toBe('/first')
  })

  it('allows the native selection action while an editable control is focused without moving focus', async () => {
    render(
      <>
        <AppShell />
        <input aria-label="Editing text" />
      </>
    )
    await act(async () => {
      await buildAppMenu()
    })
    const input = screen.getByRole('textbox', { name: 'Editing text' })
    act(() => input.focus())
    await selectFromMenu('next')
    await waitFor(() =>
      expect(useProjectStore.getState().currentProject?.path).toBe('/second')
    )
    expect(document.activeElement).toBe(input)
    expect(useSessionStore.getState().sessionProjectPath).toBe('/first')
  })

  it('blocks native selection as soon as Close submits, before the backend changes the ready snapshot', async () => {
    let finishStop!: (
      result: Awaited<ReturnType<typeof commands.stopProject>>
    ) => void
    vi.mocked(commands.stopProject).mockReturnValueOnce(
      new Promise(resolve => {
        finishStop = resolve
      })
    )
    render(<AppShell />)
    await act(async () => {
      await buildAppMenu()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    try {
      expect(useSessionStore.getState().sessionStatus).toBe('ready')
      expect(useSessionStore.getState().commandPending).toBe(true)
      await selectFromMenu('next')
      expect(useProjectStore.getState().currentProject?.path).toBe('/first')
      expect(commands.preflightProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
    } finally {
      await act(async () => finishStop({ status: 'ok', data: null }))
    }
  })

  it('blocks native selection as soon as Load submits, before the backend changes the idle snapshot', async () => {
    const idleSnapshot: SessionSnapshot = {
      ...runningSnapshot,
      status: 'idle',
      projectPath: null,
      projectName: null,
      health: null,
    }
    useSessionStore.getState().applySnapshot(idleSnapshot)
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: idleSnapshot,
    })
    let finishStart!: (
      result: Awaited<ReturnType<typeof commands.startProject>>
    ) => void
    vi.mocked(commands.startProject).mockReturnValueOnce(
      new Promise(resolve => {
        finishStart = resolve
      })
    )
    render(<AppShell />)
    await act(async () => {
      await buildAppMenu()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    try {
      expect(useSessionStore.getState().sessionStatus).toBe('idle')
      expect(useSessionStore.getState().commandPending).toBe(true)
      await selectFromMenu('next')
      expect(useProjectStore.getState().currentProject?.path).toBe('/first')
      expect(commands.preflightProject).not.toHaveBeenCalled()
      expect(commands.stopProject).not.toHaveBeenCalled()
    } finally {
      await act(async () => finishStart({ status: 'ok', data: null }))
    }
  })

  it('rechecks confirmation state after a delayed native focus reply', async () => {
    await buildAppMenu()
    let finishFocus!: (
      result: Awaited<ReturnType<typeof commands.focusedWindowLabel>>
    ) => void
    vi.mocked(commands.focusedWindowLabel).mockReturnValueOnce(
      new Promise(resolve => {
        finishFocus = resolve
      })
    )
    await selectFromMenu('next')
    useWindowStore.getState().setQuitConfirmOpen(true)
    await act(async () => finishFocus({ status: 'ok', data: 'main' }))
    expect(useProjectStore.getState().currentProject?.path).toBe('/first')
    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useKeyboardStore.getState().projectSelectionRevealed).toBe(false)
  })

  it('keeps creation selection and the performance card unchanged', async () => {
    useCreationStore.setState({ active: true })
    await buildAppMenu()
    expect(menuItem('select-next-project').enabled).toBe(false)
    await selectFromMenu('next')
    expect(useProjectStore.getState().currentProject?.path).toBe('/first')
    expect(commands.openCreationProject).not.toHaveBeenCalled()
    expect(commands.preflightProject).not.toHaveBeenCalled()
  })

  it('ignores an unavailable native focus result', async () => {
    await buildAppMenu()
    vi.mocked(commands.focusedWindowLabel).mockResolvedValue({
      status: 'error',
      error: 'Window unavailable',
    })
    await selectFromMenu('next')
    expect(useProjectStore.getState().currentProject?.path).toBe('/first')
    expect(commands.preflightProject).not.toHaveBeenCalled()
  })

  it('keeps the app menu available with selection disabled when the focus query rejects', async () => {
    vi.mocked(commands.focusedWindowLabel).mockRejectedValueOnce(
      new Error('Focus query unavailable')
    )
    await buildAppMenu()
    expect(menuItem('select-next-project').enabled).toBe(false)
    expect(menuItem('mute-toggle').accelerator).toBe('Cmd+M')
  })
})
