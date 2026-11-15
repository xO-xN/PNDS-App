import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor, within } from '@/test/test-utils'
import { commands, type Manifest } from '@/lib/tauri-bindings'
import { BOTTOM_BAR_ITEMS } from '@/lib/bottom-bar-items'
import { useCreationConsoleWindowStore } from '@/lib/creation-console-window'
import { useClientParticipationStore } from '@/store/client-participation-store'
import { useClientSidebarStore } from '@/store/client-sidebar-store'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useHostEntryStore } from '@/store/host-entry-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useProjectStore } from '@/store/project-store'
import { useProjectionStore } from '@/store/projection-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { DesktopBar } from './DesktopBar'

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'score',
  name: 'Score',
  version: '1',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 7008,
    monitorPort: 7009,
  },
  audio: {
    supportedModes: ['none'],
    defaultMode: 'none',
    synthdefs: [],
    scsynth: null,
    standaloneTarget: null,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  usePerformanceRoleStore.setState({ role: 'host' })
  useSessionStore.getState().resetSession()
  useSessionStore.setState({
    lanIp: '192.0.2.10',
    volume: 62,
    muted: false,
  })
  useCreationStore.setState({
    active: false,
    workspace: null,
    runtimeProject: null,
    modePhase: 'idle',
    modePlan: null,
    modeError: null,
    opening: false,
  })
  useCreationTestStore.setState({ expanded: false, manifest: null })
  useCreationConsoleWindowStore.setState({ open: false })
  useCreationCompileStore.setState({ busy: false, report: null, error: null })
  useCreationFilesStore.setState({
    pending: { compile: 0, refresh: 0, restart: 0 },
  })
  useSettingsStore.setState({
    settingsOpen: false,
    focusSection: null,
    hiddenBottomBarItems: [],
    hideBottomBarText: false,
    nodeNameSetting: 'Test Host',
  })
  useProjectStore.setState({
    currentProject: { path: '/score', manifest },
    preflightStatus: 'ready',
  })
  useProjectionStore.setState({ windowExists: false, known: true })
  useHostEntryStore.setState({
    snapshot: {
      status: 'unbound',
      url: null,
      error: null,
      portChanged: false,
    },
  })
  useClientParticipationStore.setState({
    snapshot: {
      revision: 0,
      phase: 'idle',
      address: null,
      host: null,
      activeHost: null,
      expectedHostId: null,
      pageUrl: null,
      error: null,
    },
  })
  useClientSidebarStore.setState({ choice: null, visible: false })
})

function hide(items: string[]) {
  act(() => useSettingsStore.getState().setHiddenBottomBarItems(items))
}

function connectClient() {
  const host = {
    protocolVersion: 1,
    hostId: 'stage',
    nodeName: 'Stage Mac',
    role: 'host' as const,
    performance: null,
  }
  usePerformanceRoleStore.setState({ role: 'client' })
  useClientParticipationStore.setState({
    snapshot: {
      revision: 1,
      phase: 'open',
      address: 'http://192.0.2.20:5210',
      host,
      activeHost: host,
      expectedHostId: host.hostId,
      pageUrl: 'http://127.0.0.1:51000/',
      error: null,
    },
  })
  useClientSidebarStore.setState({ visible: true })
}

describe('bottom bar visibility', () => {
  it.each([false, true])(
    'keeps both fixed ends mounted with all optional items hidden in creation=%s',
    creation => {
      useCreationStore.setState({ active: creation })
      render(<DesktopBar />)
      const footer = screen.getByRole('contentinfo')
      const transport = footer.querySelector('.desktop-transport')
      const mode = footer.querySelector('[data-mode-switch]')
      expect(transport).not.toBeNull()
      expect(mode).not.toBeNull()

      hide([...BOTTOM_BAR_ITEMS, 'transport', 'mode'])
      expect(within(footer).getAllByRole('button')).toHaveLength(2)
      expect(footer.querySelector('.desktop-transport')).toBe(transport)
      expect(footer.querySelector('[data-mode-switch]')).toBe(mode)
      expect(transport).toBeVisible()
      expect(mode).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'Performance recordings' })
      ).not.toBeInTheDocument()

      hide(['transport', 'mode'])
      expect(footer.querySelector('.desktop-transport')).toBe(transport)
      expect(footer.querySelector('[data-mode-switch]')).toBe(mode)
      expect(screen.getByRole('button', { name: 'Audio' })).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Local network' })
      ).toBeVisible()
    }
  )

  it.each([
    [false, 'host', true, false, true, false],
    [true, 'host', true, true, false, false],
    [true, 'client', true, true, false, false],
    [false, 'client', false, false, false, true],
    [false, null, false, false, false, false],
  ] as const)(
    'preserves the applicable controls in creation=%s role=%s',
    (
      creation,
      role,
      hostControls,
      consoleControl,
      projection,
      clientSidebar
    ) => {
      if (role === 'client') connectClient()
      else usePerformanceRoleStore.setState({ role })
      useCreationStore.setState({ active: creation })
      render(<DesktopBar />)
      expect(!!screen.queryByRole('button', { name: 'Audio' })).toBe(
        hostControls
      )
      expect(
        !!screen.queryByRole('button', { name: 'Performance recordings' })
      ).toBe(hostControls)
      expect(!!screen.queryByRole('button', { name: 'Console' })).toBe(
        consoleControl
      )
      expect(!!screen.queryByTestId('open-projection-button')).toBe(projection)
      expect(!!document.getElementById('client-host-sidebar-button')).toBe(
        clientSidebar
      )
      expect(
        screen.getByRole('button', { name: 'Local network' })
      ).toBeVisible()
      expect(screen.getByRole('button', { name: 'Settings' })).toBeVisible()
    }
  )

  it('hides the client sidebar entry without changing its actual visibility or active participation', () => {
    connectClient()
    const snapshot = useClientParticipationStore.getState().snapshot
    render(<DesktopBar />)
    const footer = screen.getByRole('contentinfo')
    const transport = footer.querySelector('.desktop-transport')
    const mode = footer.querySelector('[data-mode-switch]')
    expect(
      screen.getByRole('button', { name: 'Host: Stage Mac' })
    ).toBeVisible()
    hide([...BOTTOM_BAR_ITEMS, 'transport', 'mode'])
    expect(within(footer).getAllByRole('button')).toHaveLength(2)
    expect(footer.querySelector('.desktop-transport')).toBe(transport)
    expect(footer.querySelector('[data-mode-switch]')).toBe(mode)
    expect(useClientSidebarStore.getState().visible).toBe(true)
    expect(useClientParticipationStore.getState().snapshot).toBe(snapshot)
    expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
  })

  it('does not change gain, running work, console or projection when hiding their entries', () => {
    useProjectionStore.setState({ windowExists: true })
    useSessionStore.setState({ projectionStarted: true })
    useCreationConsoleWindowStore.setState({ open: true })
    useCreationCompileStore.setState({ busy: true })
    const view = render(<DesktopBar />)
    hide([...BOTTOM_BAR_ITEMS])
    act(() => useCreationStore.setState({ active: true }))
    expect(useSessionStore.getState().volume).toBe(62)
    expect(useSessionStore.getState().muted).toBe(false)
    expect(useSessionStore.getState().projectionStarted).toBe(true)
    expect(useProjectionStore.getState().windowExists).toBe(true)
    expect(useCreationConsoleWindowStore.getState().open).toBe(true)
    expect(useCreationCompileStore.getState().busy).toBe(true)
    expect(commands.setMasterVolume).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.toggleCreationConsole).not.toHaveBeenCalled()
    expect(commands.closeCreationConsole).not.toHaveBeenCalled()
    expect(commands.toggleProjectionStart).not.toHaveBeenCalled()
    expect(commands.closeCreationProjection).not.toHaveBeenCalled()
    expect(commands.stopPerformanceRecording).not.toHaveBeenCalled()
    view.unmount()
  })

  it.each([
    ['audio', 'Audio'],
    ['network', 'Local network'],
    ['recording', 'Performance recordings'],
  ] as const)(
    'closes an open %s popup, releases the sidebar hold and stays closed after showing it again',
    async (item, label) => {
      const user = userEvent.setup()
      const onPopupOpenChange = vi.fn()
      render(<DesktopBar onPopupOpenChange={onPopupOpenChange} />)
      await user.click(screen.getByRole('button', { name: label }))
      expect(screen.getByRole('dialog')).toBeVisible()
      await waitFor(() =>
        expect(onPopupOpenChange).toHaveBeenLastCalledWith(true)
      )
      hide([item])
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
      expect(
        screen.queryByRole('button', { name: label })
      ).not.toBeInTheDocument()
      expect(onPopupOpenChange).toHaveBeenLastCalledWith(false)
      hide([])
      expect(screen.getByRole('button', { name: label })).toBeVisible()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(commands.stopPerformanceRecording).not.toHaveBeenCalled()
      expect(commands.stopProject).not.toHaveBeenCalled()
    }
  )

  it('releases an audio popup when its host-only branch disappears', async () => {
    const user = userEvent.setup()
    const onPopupOpenChange = vi.fn()
    render(<DesktopBar onPopupOpenChange={onPopupOpenChange} />)
    await user.click(screen.getByRole('button', { name: 'Audio' }))
    await waitFor(() =>
      expect(onPopupOpenChange).toHaveBeenLastCalledWith(true)
    )
    act(() => usePerformanceRoleStore.setState({ role: 'client' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onPopupOpenChange).toHaveBeenLastCalledWith(false)
    act(() => usePerformanceRoleStore.setState({ role: 'host' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
