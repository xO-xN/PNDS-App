import { beforeEach as beforeHostTest } from 'vitest'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
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
import { useProjectStore, type PreflightRequest } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import { useWindowStore } from '@/store/window-store'
import { useClientParticipationStore } from '@/store/client-participation-store'
import { useClientSidebarStore } from '@/store/client-sidebar-store'
import {
  commands,
  type ClientHostInfo,
  type Manifest,
} from '@/lib/tauri-bindings'
import { HoverSidebarHarness as HoverSidebar } from '@/test/desktop-harness'
// Existing workflows run after an explicit Host choice and node naming.
beforeHostTest(() => {
  usePerformanceRoleStore.getState().resetRole()
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
})

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

const confirmedPerformance = {
  projectId: 'a',
  performanceId: 'a-1',
  projectName: 'Tidal Study',
  performerUrl: 'http://192.168.1.24:8800/performer',
  supportsPerformerUrl: true,
}

const confirmedHost: ClientHostInfo = {
  protocolVersion: 1,
  hostId: 'confirmed-host',
  nodeName: 'Studio Mac',
  performance: confirmedPerformance,
}

it('reveals a same-Host candidate, remembers deferral, and reveals a later performance', async () => {
  const previous = useClientParticipationStore.getState().snapshot
  useClientSidebarStore.setState({ choice: null, visible: false })
  usePerformanceRoleStore.setState({ role: 'client' })
  useSessionStore.getState().resetSession()
  useKeyboardStore.setState({
    commandKeyPressed: false,
    projectSelectionRevealed: false,
  })
  useSettingsStore.setState({ settingsOpen: false })
  useCreationStore.setState({ active: false, modePhase: 'idle' })
  useWindowStore.setState({ confirmCloseOpen: false, quitConfirmOpen: false })
  const open = {
    revision: 1,
    phase: 'open' as const,
    address: 'http://192.168.1.24:8800/',
    host: confirmedHost,
    activeHost: confirmedHost,
    expectedHostId: confirmedHost.hostId,
    pageUrl: 'http://pnds-a.localhost/?pndsClientPass=1',
    error: null,
  }
  useClientParticipationStore.setState({ snapshot: open })
  const user = userEvent.setup()
  try {
    render(<HoverSidebar />)
    const panel = screen.getByTestId('sidebar-popover')
    const toggle = screen.getByRole('button', { name: 'Host: Studio Mac' })
    expect(toggle).toHaveAttribute('aria-controls', panel.id)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.closest('footer')?.firstElementChild).toContainElement(
      screen.getByRole('button', { name: 'Exit performance' })
    )
    expect(panel).toHaveAttribute('inert')

    const host = {
      ...confirmedHost,
      performance: {
        ...confirmedPerformance,
        projectId: 'b',
        performanceId: 'b-1',
        projectName: 'Underwater',
      },
    }
    const changed = { ...open, phase: 'changed' as const, host, revision: 2 }
    act(() =>
      useClientParticipationStore.setState({
        snapshot: {
          ...changed,
          host: { ...host, hostId: 'other-host', nodeName: 'Other Mac' },
        },
      })
    )
    expect(toggle).toHaveAccessibleName('Host: Studio Mac')
    expect(panel).toHaveAttribute('inert')
    act(() => useClientParticipationStore.setState({ snapshot: changed }))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(panel).not.toHaveAttribute('inert')
    await user.click(screen.getByRole('button', { name: 'Later' }))
    expect(toggle).toHaveFocus()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveAttribute('inert')

    act(() =>
      useClientParticipationStore.setState({
        snapshot: {
          ...changed,
          host: null,
          phase: 'disconnected',
          revision: 3,
        },
      })
    )
    act(() =>
      useClientParticipationStore.setState({
        snapshot: { ...changed, revision: 4 },
      })
    )
    expect(panel).toHaveAttribute('inert')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    act(() => useKeyboardStore.getState().setCommandKeyPressed(true))
    const candidateCard = screen.getByRole('button', {
      name: /Studio Mac.*Underwater/,
    })
    act(() => candidateCard.focus())
    act(() => useKeyboardStore.getState().setCommandKeyPressed(false))
    expect(panel).not.toHaveAttribute('inert')
    await user.keyboard('{Escape}')
    expect(toggle).toHaveFocus()
    expect(panel).toHaveAttribute('inert')

    const restarted = {
      ...host,
      performance: { ...host.performance, performanceId: 'b-2' },
    }
    act(() =>
      useClientParticipationStore.setState({
        snapshot: { ...changed, host: restarted, revision: 5 },
      })
    )
    act(() => useClientSidebarStore.getState().setOpen(false, host))
    expect(panel).not.toHaveAttribute('inert')
    fireEvent.mouseEnter(panel)
    act(() =>
      useClientParticipationStore.setState({
        snapshot: {
          ...open,
          revision: 6,
          host: restarted,
          activeHost: restarted,
          pageUrl: 'http://pnds-b.localhost/?pndsClientPass=2',
        },
      })
    )
    expect(panel).toHaveAttribute('inert')
  } finally {
    useClientParticipationStore.setState({ snapshot: previous })
    useClientSidebarStore.setState({ choice: null, visible: false })
  }
})

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
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
    })
    useKeyboardStore.setState({
      commandKeyPressed: false,
      projectSelectionRevealed: false,
    })
    useProjectStore.setState({
      currentProject: { path: '/p', manifest },
      recentProjectPaths: ['/p'],
      projectFolders: [],
      activeFolderId: null,
      lastUserFolderId: null,
      renameTarget: null,
      pendingPreflightPath: null,
      activePreflight: null,
      failedPreflightPath: null,
      preflightStatus: 'ready',
      preflightError: null,
      preflightErrors: {},
    })
    useSettingsStore.setState({ settingsOpen: false })
    useCreationStore.setState({ active: false, modePhase: 'idle' })
    useWindowStore.setState({
      confirmCloseOpen: false,
      quitConfirmOpen: false,
      fullscreen: false,
    })
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

  it.each(['ready', 'error'] as const)(
    'keeps a different card visible during preflight and after it becomes %s, until the running card is reselected',
    outcome => {
      useProjectStore.setState({ recentProjectPaths: ['/p', '/other'] })
      render(<HoverSidebar />)
      const panel = screen.getByTestId('sidebar-popover')
      expectHidden()
      expect(panel).toHaveAttribute('inert')

      let request!: PreflightRequest
      act(() => {
        request = useProjectStore.getState().startPreflight('/other')
      })
      expectVisible()
      expect(panel).not.toHaveAttribute('inert')

      act(() => useKeyboardStore.getState().setCommandKeyPressed(true))
      fireEvent.mouseEnter(panel)
      fireEvent.mouseLeave(panel)
      releaseCommandKey()
      fireEvent.blur(window)
      expectVisible()

      act(() => {
        const store = useProjectStore.getState()
        if (outcome === 'ready') store.preflightSucceeded(request, manifest)
        else store.preflightFailed(request, 'Invalid project')
        store.finishPreflight(request)
      })
      expectVisible()
      act(() => useWindowStore.setState({ fullscreen: true }))
      expectVisible()
      expect(panel).not.toHaveAttribute('inert')

      act(() => {
        const store = useProjectStore.getState()
        const runningCard = store.startPreflight('/p')
        store.preflightSucceeded(runningCard, manifest)
        store.finishPreflight(runningCard)
      })
      expectHidden()
      expect(panel).toHaveAttribute('inert')
      expect(commands.startProject).not.toHaveBeenCalled()
      expect(commands.stopProject).not.toHaveBeenCalled()
    }
  )

  it('restores auto-hide when the selected card becomes the running project', () => {
    useProjectStore.setState({ currentProject: { path: '/other', manifest } })
    render(<HoverSidebar />)
    expectVisible()
    act(() => useSessionStore.setState({ sessionProjectPath: '/other' }))
    expectHidden()
  })

  it('keeps the sidebar visible when selection is cleared during a running session', () => {
    render(<HoverSidebar />)
    expectHidden()
    act(() => useProjectStore.getState().clearProject())
    expectVisible()
    expect(useSessionStore.getState().sessionProjectPath).toBe('/p')
  })

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

  it.each(['escape', 'outside', 'blur'] as const)(
    'holds the sidebar while the role menu portal is open and releases it after %s',
    async cancellation => {
      const user = userEvent.setup()
      useKeyboardStore.setState({ commandKeyPressed: true })
      render(
        <>
          <HoverSidebar />
          <button type="button">Score surface</button>
        </>
      )
      const outside = screen.getByRole('button', { name: 'Score surface' })
      const panel = screen.getByTestId('sidebar-popover')
      await user.click(
        screen.getByRole('button', {
          name: 'Switch performance role: PNDS Host',
        })
      )
      const menu = await screen.findByRole('menu')
      expect(panel.contains(menu)).toBe(false)
      releaseCommandKey()
      fireEvent.mouseLeave(panel)
      fireEvent.mouseEnter(menu)
      expectVisible()
      expect(panel).not.toHaveAttribute('inert')
      if (cancellation === 'escape') await user.keyboard('{Escape}')
      else if (cancellation === 'outside') {
        fireEvent.pointerDown(outside)
        act(() => outside.focus())
      } else fireEvent.blur(window)
      await waitFor(() =>
        expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      )
      if (cancellation === 'escape') {
        await waitFor(() =>
          expect(
            screen.getByRole('button', {
              name: 'Switch performance role: PNDS Host',
            })
          ).toHaveFocus()
        )
        expectVisible()
        await user.click(outside)
      }
      await waitFor(expectHidden)
      expect(panel).toHaveAttribute('inert')
      expect(commands.stopProject).not.toHaveBeenCalled()
    }
  )

  it('releases the pointer latch after moving from the role trigger through its portal into the score', async () => {
    const user = userEvent.setup()
    useKeyboardStore.setState({ commandKeyPressed: true })
    render(
      <>
        <HoverSidebar />
        <button type="button">Score surface</button>
      </>
    )
    const panel = screen.getByTestId('sidebar-popover')
    const outside = screen.getByRole('button', { name: 'Score surface' })
    const trigger = screen.getByRole('button', {
      name: 'Switch performance role: PNDS Host',
    })
    await user.click(trigger)
    const menu = await screen.findByRole('menu')
    expect(panel.contains(menu)).toBe(false)
    releaseCommandKey()

    // Native mouse transitions preserve React's relatedTarget path through
    // the portal. Trigger -> menu stays in the same React sidebar subtree.
    fireEvent.mouseOut(trigger, { relatedTarget: menu })
    fireEvent.mouseOver(menu, { relatedTarget: trigger })
    fireEvent.mouseOut(menu, { relatedTarget: outside })
    fireEvent.mouseOver(outside, { relatedTarget: menu })
    expectVisible()

    // Do not ask userEvent to move its pointer again: that would introduce
    // a second trigger -> outside transition and mask a stuck portal latch.
    fireEvent.pointerDown(outside)
    act(() => outside.focus())
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    )
    await waitFor(expectHidden)
    expect(panel).toHaveAttribute('inert')
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it.each(['outside focus', 'window blur'] as const)(
    'keeps manual folder tabs usable after the pointer leaves and releases on %s',
    async release => {
      const user = userEvent.setup()
      useKeyboardStore.setState({ commandKeyPressed: true })
      render(
        <>
          <HoverSidebar />
          <button type="button">Score surface</button>
        </>
      )
      const panel = screen.getByTestId('sidebar-popover')
      const outside = screen.getByRole('button', { name: 'Score surface' })
      const home = screen.getByRole('tab', { name: 'Home' })
      const utilities = screen.getByRole('tab', { name: 'Utilities' })
      await user.click(home)
      fireEvent.mouseOut(home, { relatedTarget: outside })
      fireEvent.mouseOver(outside, { relatedTarget: home })
      releaseCommandKey()

      expectVisible()
      expect(home).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      expect(home).toHaveFocus()
      expect(utilities).toHaveAttribute('tabindex', '-1')
      expect(home).toHaveAttribute('tabindex', '0')
      expect(home).toHaveAttribute('aria-selected', 'true')
      expect(utilities).toHaveAttribute('aria-selected', 'false')
      expectVisible()

      if (release === 'outside focus') {
        await user.click(outside)
      } else {
        fireEvent.blur(window)
      }
      await waitFor(expectHidden)
      expect(panel).toHaveAttribute('inert')
      expect(commands.preflightProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
      expect(commands.stopProject).not.toHaveBeenCalled()
    }
  )

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
      await screen.findByRole('button', { name: 'Reload' })
    ).toBeInTheDocument()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expectVisible()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(expectHidden)
  })

  it('keeps the other selected project visible after canceling replacement', async () => {
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
    const load = screen.getByRole('button', { name: 'Load' })
    fireEvent.click(load)
    expect(
      await screen.findByRole('button', { name: /click again to switch to/i })
    ).toBe(load)
    expect(load).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectVisible()
    expect(commands.stopProject).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Load' })).toBe(load)
    expect(load).toHaveAttribute('aria-pressed', 'false')
    expectVisible()
    expect(useProjectStore.getState().currentProject?.path).toBe('/b')
    expect(useSessionStore.getState().sessionProjectPath).toBe('/a')
    expect(commands.stopProject).not.toHaveBeenCalled()
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
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Mute' }), {
      pointerType: 'mouse',
    })
    const slider = screen.getByRole('slider', { name: 'Master Volume' })
    fireEvent.pointerDown(slider, { pointerId: 1, button: 0 })
    fireEvent.mouseLeave(screen.getByTestId('sidebar-popover'))
    expectHidden()
    expect(slider).toBeVisible()
    expect(slider).toBeEnabled()

    fireEvent.pointerUp(window, { pointerId: 1 })
    expectHidden()
  })

  it('keeps the other selected project visible after node settings close', async () => {
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
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expectVisible()
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
