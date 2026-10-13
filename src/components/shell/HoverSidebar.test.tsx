import {
  render,
  screen,
  fireEvent,
  waitFor,
  mockBoundingClientRect,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useSessionStore } from '@/store/session-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import { useWindowStore } from '@/store/window-store'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { HoverSidebarHarness as HoverSidebar } from '@/test/desktop-harness'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'performance',
  name: 'Performance',
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
    supportedModes: ['none', 'external'],
    synthdefs: [],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

/**
 * The ⌘-peek contract (spec issue #4, module doc): while a session runs,
 * holding ⌘ reveals the sidebar, and releasing ⌘ keeps it open while the
 * pointer is inside it — including an entry straight into the popover,
 * which never touches the left-edge hover strip.
 */
describe('HoverSidebar ⌘-peek pointer latch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.getState().resetSession()
    useSessionStore.setState({ sessionStatus: 'ready' })
    useKeyboardStore.setState({ commandKeyPressed: false })
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      renameTarget: null,
      pendingPreflightPath: null,
      confirmCloseProjectOpen: false,
    })
    useSettingsStore.setState({ settingsOpen: false })
    useCreationStore.setState({ active: false, modePhase: 'idle' })
    useWindowStore.setState({ confirmCloseOpen: false, quitConfirmOpen: false })
  })

  it('releases the pointer latch after a drop to the right of the physical sidebar', () => {
    render(<HoverSidebar />)
    const panel = screen.getByTestId('sidebar-popover')
    mockBoundingClientRect(panel, {
      left: 12,
      top: 12,
      width: 320,
      height: 600,
    })
    fireEvent.mouseEnter(panel)
    fireEvent.pointerDown(panel, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 400, clientY: 100 })
    expectHidden()
  })

  const releaseCommandKey = () =>
    act(() => {
      useKeyboardStore.setState({ commandKeyPressed: false })
    })

  const expectVisible = () =>
    expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-100')
  const expectHidden = () =>
    expect(screen.getByTestId('sidebar-popover')).toHaveClass('opacity-0')

  it('releasing ⌘ while the pointer is inside keeps the sidebar open', () => {
    useKeyboardStore.setState({ commandKeyPressed: true })
    render(<HoverSidebar />)
    expectVisible()

    // The ⌘-summoned entry path: the pointer crosses straight into the
    // popover from the monitor side, never through the left-edge strip.
    fireEvent.mouseEnter(screen.getByTestId('sidebar-popover'))

    releaseCommandKey()
    expectVisible() // the regression: this retracted under the pointer

    // Leaving afterwards hides it as usual.
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectHidden()
  })

  it('releasing ⌘ without the pointer inside retracts the sidebar', () => {
    useKeyboardStore.setState({ commandKeyPressed: true })
    render(<HoverSidebar />)
    expectVisible()
    releaseCommandKey()
    expectHidden()
  })

  it('the left-edge strip still reveals on hover and hides on leave', () => {
    render(<HoverSidebar />)
    fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
    expectVisible()
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectHidden()
  })

  it('keeps bottom audio settings visible after leaving the sidebar, then hides the sidebar when closed', async () => {
    useProjectStore.setState({ currentProject: { path: '/p', manifest } })
    render(<HoverSidebar />)
    fireEvent.mouseEnter(screen.getByTestId('sidebar-popover'))
    await userEvent.click(screen.getByRole('button', { name: 'Audio' }))
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectVisible()
    expect(await screen.findByLabelText('Sample rate')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(expectHidden)
  })

  it('defers audio settings until explicit restart and keeps the bottom panel operable', async () => {
    useProjectStore.setState({
      currentProject: { path: '/p', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      audioMode: 'internal',
    })
    useSettingsStore.setState({ sampleRateSetting: 48000 })
    render(<HoverSidebar />)
    await userEvent.click(screen.getByRole('button', { name: 'Audio' }))
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    await userEvent.click(await screen.findByLabelText('Sample rate'))
    await userEvent.click(screen.getByRole('option', { name: '44.1 kHz' }))
    expect(
      await screen.findByRole('button', { name: 'Change' })
    ).toBeInTheDocument()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expectVisible()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(expectHidden)
  })

  it('holds the sidebar through replacement confirmation and hides on cancel', async () => {
    useProjectStore.setState({
      currentProject: { path: '/b', manifest },
      recentProjectPaths: ['/a', '/b'],
      preflightStatus: 'ready',
    })
    useSessionStore.setState({
      sessionProjectPath: '/a',
      audioMode: 'none',
      lanIp: '192.168.1.10',
    })
    render(<HoverSidebar />)
    fireEvent.mouseEnter(screen.getByTestId('sidebar-popover'))
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    await screen.findByRole('alertdialog')
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectVisible()
    expect(commands.stopProject).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(expectHidden)
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('holds the Close action until its command completes and prevents resubmission', async () => {
    useProjectStore.setState({
      currentProject: { path: '/p', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionProjectPath: '/p' })
    let finishStop!: () => void
    vi.mocked(commands.stopProject).mockReturnValueOnce(
      new Promise(resolve => {
        finishStop = () => resolve({ status: 'ok', data: null })
      })
    )
    render(<HoverSidebar />)
    fireEvent.mouseEnter(screen.getByTestId('sidebar-popover'))
    const close = screen.getByRole('button', { name: 'Close' })
    fireEvent.click(close)
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))

    try {
      expectVisible()
      expect(close).toBeDisabled()
      fireEvent.click(close)
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => finishStop())
    }
    await waitFor(expectVisible)
  })

  it('keeps bottom gain controls usable while the sidebar retracts during a gesture', () => {
    useProjectStore.setState({ currentProject: { path: '/p', manifest } })
    useSessionStore.setState({
      sessionProjectPath: '/p',
      audioMode: 'internal',
    })
    render(<HoverSidebar />)
    fireEvent.mouseEnter(screen.getByTestId('sidebar-popover'))
    fireEvent.pointerDown(screen.getByRole('slider'), { pointerId: 1 })
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectHidden()
    expect(screen.getByRole('slider')).toBeEnabled()

    fireEvent.pointerUp(window, { pointerId: 1 })
    expectHidden()
  })

  it('keeps node setup visible until the settings dialog closes', async () => {
    useProjectStore.setState({
      currentProject: {
        path: '/b',
        manifest: { ...manifest, telematic: true },
      },
      preflightStatus: 'ready',
    })
    useSettingsStore.setState({
      nodeNameSetting: '',
      hubUrlSetting: '',
      hubTokenSetting: '',
    })
    useSessionStore.setState({ sessionProjectPath: '/a' })
    render(<HoverSidebar />)
    fireEvent.mouseEnter(screen.getByTestId('sidebar-popover'))
    fireEvent.click(screen.getByRole('button', { name: 'Set Up Node' }))
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectVisible()

    act(() => useSettingsStore.getState().closeSettings())
    await waitFor(expectHidden)
  })

  it.each(['close', 'quit'] as const)(
    'keeps the sidebar visible during %s confirmation',
    kind => {
      render(<HoverSidebar />)
      const setOpen =
        useWindowStore.getState()[
          kind === 'close' ? 'setConfirmCloseOpen' : 'setQuitConfirmOpen'
        ]
      act(() => setOpen(true))
      expectVisible()
      act(() => setOpen(false))
      expectHidden()
    }
  )
})
