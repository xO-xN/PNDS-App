import { beforeEach as beforeHostTest } from 'vitest'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSettingsStore } from '@/store/settings-store'
import { useUpdaterStore } from '@/store/updater-store'
import { render, screen, act, fireEvent, waitFor } from '@/test/test-utils'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useClientParticipationStore } from '@/store/client-participation-store'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import { AppShell } from './AppShell'
import type {
  ClientSnapshot,
  Manifest,
  SessionSnapshot,
} from '@/lib/tauri-bindings'
// Existing workflows run after an explicit Host choice and node naming.
beforeHostTest(() => {
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
})

const readyManifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: [],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

const readySnapshot: SessionSnapshot = {
  status: 'ready',
  projectName: 'Inarticulate III',
  projectPath: '/p',
  audioMode: 'none',
  lanIp: '192.168.1.10',
  hostAddress: null,
  oscTarget: null,
  health: {
    status: 'ready',
    projectId: 'inarticulate-iii',
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

const idleRoleClient: ClientSnapshot = {
  revision: 0,
  phase: 'idle',
  address: null,
  host: null,
  expectedHostId: null,
  pageUrl: null,
  error: null,
}

function prepareRoleLaunch() {
  usePerformanceRoleStore.setState(usePerformanceRoleStore.getInitialState())
  useClientParticipationStore.setState({
    snapshot: idleRoleClient,
    error: null,
  })
  useSessionStore.getState().resetSession()
  vi.mocked(commands.getClientParticipation).mockResolvedValue({
    status: 'ok',
    data: idleRoleClient,
  })
  const idle = {
    ...readySnapshot,
    status: 'idle' as const,
    projectPath: null,
    projectName: null,
    health: null,
  }
  vi.mocked(commands.getSessionState).mockResolvedValue({
    status: 'ok',
    data: idle,
  })
  vi.mocked(commands.getCreationRuntime).mockResolvedValue({
    status: 'ok',
    data: { generation: '0', projectRoot: null, snapshot: idle },
  })
  vi.mocked(commands.commitCreationProject).mockResolvedValue({
    status: 'ok',
    data: { generation: '0', projectRoot: null, snapshot: idle },
  })
  const preferences = { theme: 'system', colorTheme: 'pond', language: 'en' }
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: preferences,
  })
  return preferences
}

/** Captured handler for the shell-level session snapshot subscription. */
let sessionHandler: ((event: { payload: SessionSnapshot }) => void) | null

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUpdaterStore.setState({ available: null })
    useCreationStore.setState({
      modePhase: 'idle',
      modePlan: null,
      modeError: null,
      hoverPaused: false,
      modePointerInside: false,
      restoreModeFocus: false,
      active: false,
      workspace: null,
      recentPaths: [],
      lastCreationParent: null,
      opening: false,
      request: null,
      error: null,
    })
    sessionHandler = null
    vi.mocked(listen).mockImplementation((event, cb) => {
      if (event === 'session-snapshot-event') {
        // The generated event payload wraps the snapshot ({ snapshot });
        // this adapter lets the call sites below keep the flat shape.
        sessionHandler = (flat: { payload: SessionSnapshot }) =>
          (cb as (event: { payload: { snapshot: SessionSnapshot } }) => void)({
            payload: { snapshot: flat.payload },
          })
      }
      return Promise.resolve(() => {
        // mock unlisten
      })
    })
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      // v1.5.0 (#125): the README routing reads the whole selection
      // chain — a failed selection leaked from an earlier test would
      // reroute this test's main area to a project README.
      failedPreflightPath: null,
      activeFolderId: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    useCreationTestStore.setState({ previewVisibility: 'auto' })
    useWindowStore.setState({
      fullscreen: false,
      showCustomTrafficLights: true,
      generation: 0,
    })
  })

  it('enters creation from the idle sidebar with confirmation and returns to the idle home', async () => {
    render(<AppShell />)
    const entry = screen.getByRole('button', {
      name: 'Switch to creation mode',
    })
    fireEvent.click(entry)
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('armed')
    )
    expect(useCreationStore.getState().active).toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(entry)
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('armed')
    )
    expect(useCreationStore.getState().active).toBe(false)
    fireEvent.pointerDown(window)
    fireEvent.click(entry)
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('armed')
    )
    expect(useCreationStore.getState().active).toBe(false)
    fireEvent.click(entry)
    await screen.findByRole('heading', { name: 'Creation mode' })
    expect(document.querySelector('[data-creation-topbar]')).toHaveAttribute(
      'data-tauri-drag-region'
    )
    expect(
      screen.getByRole('button', { name: 'Open folder project' })
    ).toBeInTheDocument()
    const back = screen.getByRole('button', {
      name: 'Return to performance mode',
    })
    fireEvent.click(back)
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('armed')
    )
    fireEvent.click(back)
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('idle')
    )
    expect(useCreationStore.getState().active).toBe(false)
    expect(useCreationStore.getState().workspace).toBeNull()
    expect(document.querySelector('[data-creation-topbar]')).toBeNull()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('releases Client participation before entering the local creation home', async () => {
    const idleSnapshot: SessionSnapshot = {
      ...readySnapshot,
      status: 'idle',
      projectName: null,
      projectPath: null,
      audioMode: null,
      lanIp: null,
      health: null,
    }
    const runtime = {
      generation: '0',
      projectRoot: null,
      snapshot: idleSnapshot,
    }
    const participating: ClientSnapshot = {
      revision: 1,
      phase: 'open',
      address: 'http://192.168.1.2:5000/',
      host: {
        protocolVersion: 1,
        hostId: 'remote-host',
        nodeName: 'Remote stage',
        performance: {
          projectId: 'remote-project',
          performanceId: 'remote-run',
          projectName: 'Remote score',
          performerUrl: 'http://192.168.1.2:5000/',
          supportsPerformerUrl: true,
        },
      },
      expectedHostId: null,
      pageUrl: 'http://remote-project.localhost:51000/',
      error: null,
    }
    let finishLeave!: (
      result: Awaited<ReturnType<typeof commands.leaveClientPerformance>>
    ) => void
    vi.mocked(commands.leaveClientPerformance).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishLeave = resolve
        })
    )
    vi.mocked(commands.getSessionState).mockResolvedValueOnce({
      status: 'ok',
      data: idleSnapshot,
    })
    vi.mocked(commands.getCreationRuntime).mockResolvedValue({
      status: 'ok',
      data: runtime,
    })
    vi.mocked(commands.commitCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: runtime,
    })
    vi.mocked(commands.getClientParticipation).mockResolvedValueOnce({
      status: 'ok',
      data: participating,
    })
    usePerformanceRoleStore.getState().selectRole('client')
    useClientParticipationStore.setState({ snapshot: participating })
    // A local card left from an earlier Host visit must not be adopted.
    useProjectStore.setState({
      currentProject: { path: '/cached-local', manifest: readyManifest },
    })
    render(<AppShell />)
    const score = await screen.findByTitle('Performance score')
    const mode = screen.getByRole('button', { name: 'Switch to creation mode' })
    fireEvent.click(mode)
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('armed')
    )
    expect(commands.leaveClientPerformance).not.toHaveBeenCalled()
    expect(screen.getByTitle('Performance score')).toBe(score)
    fireEvent.click(mode)
    await waitFor(() =>
      expect(commands.leaveClientPerformance).toHaveBeenCalledOnce()
    )
    expect(useCreationStore.getState().active).toBe(false)
    expect(commands.prepareCreationProject).not.toHaveBeenCalled()
    await act(async () =>
      finishLeave({
        status: 'ok',
        data: {
          ...participating,
          revision: 100,
          phase: 'idle',
          pageUrl: null,
          host: null,
        },
      })
    )
    await screen.findByRole('heading', { name: 'Creation mode' })
    expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
    expect(useCreationStore.getState().workspace).toBeNull()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('keeps the live monitor document mounted when a different selected card enters creation', async () => {
    const runtime = {
      generation: '7',
      projectRoot: '/p',
      snapshot: readySnapshot,
    }
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: readySnapshot,
    })
    vi.mocked(commands.getCreationRuntime).mockResolvedValue({
      status: 'ok',
      data: runtime,
    })
    vi.mocked(commands.commitCreationProject).mockResolvedValue({
      status: 'ok',
      data: runtime,
    })
    vi.mocked(commands.prepareCreationProject).mockResolvedValue({
      status: 'ok',
      data: {
        project: {
          identity: 'running',
          root: '/p',
          source: 'folder',
          name: 'Inarticulate III',
        },
        files: [],
      },
    })
    useSessionStore.getState().applySnapshot(readySnapshot)
    useProjectStore.setState({
      currentProject: { path: '/other', manifest: readyManifest },
    })
    render(<AppShell />)
    const monitor = await screen.findByTitle('Project monitor')
    const src = monitor.getAttribute('src')
    expect(
      screen.getByRole('button', { name: 'Switch to creation mode' })
    ).toBeInTheDocument()
    await act(async () => {
      await useCreationStore.getState().enter()
    })
    expect(
      screen.getByRole('button', { name: 'Switch to another project' })
    ).toBeInTheDocument()
    expect(screen.getByTitle('Project monitor')).toBe(monitor)
    expect(monitor.getAttribute('src')).toBe(src)
    expect(document.querySelector('[data-creation-topbar]')).toHaveTextContent(
      'Inarticulate III'
    )
    expect(commands.prepareCreationProject).toHaveBeenCalledWith('/p')
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('shows the original rippling Welcome and first-use tips with the idle sidebar (§10.4)', () => {
    render(<AppShell />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).toBeInTheDocument()
    const logo = screen.getByTestId('welcome-logo-stage')
    expect(logo.querySelectorAll('[data-welcome-ring]')).toHaveLength(3)
    expect(screen.getByRole('main')).toHaveClass('desktop-performance-main')
    expect(
      screen.getByText('Open a project from the left sidebar')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Hold the ⌘ key to quickly control the App')
    ).toBeInTheDocument()
    expect(
      screen.getByText('See Help for full documentation')
    ).toBeInTheDocument()
  })

  it.each(['project', 'folder'] as const)(
    'keeps the original Welcome and naming gate over a cached %s before the Host is named',
    selection => {
      useSettingsStore.setState({ nodeNameSetting: '  ' })
      useProjectStore.setState(
        selection === 'project'
          ? { currentProject: { path: '/cached', manifest: readyManifest } }
          : {
              activeFolderId: 'f1',
              projectFolders: [{ id: 'f1', name: 'Gig', projectPaths: [] }],
            }
      )
      render(<AppShell />)

      expect(screen.getByTestId('welcome-logo-stage')).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Name this Host' })
      ).toBeVisible()
      expect(screen.queryByTestId('project-readme')).not.toBeInTheDocument()
      expect(screen.queryByTestId('folder-readme')).not.toBeInTheDocument()
      expect(screen.queryByTestId('add-project-button')).not.toBeInTheDocument()
      expect(commands.startProject).not.toHaveBeenCalled()
    }
  )

  it.each(['checking', 'error'] as const)(
    'shows the welcome update notice alongside %s preflight feedback',
    preflightStatus => {
      useUpdaterStore.setState({ available: '1.7.1' })
      useProjectStore.setState({
        preflightStatus,
        preflightError: preflightStatus === 'error' ? 'Port unavailable' : null,
      })
      render(<AppShell />)

      expect(screen.getByTestId('welcome-update-notice')).toHaveTextContent(
        'v1.7.1 is available'
      )
      if (preflightStatus === 'checking')
        expect(screen.getByText('Checking project…')).toBeInTheDocument()
      else
        expect(screen.getByRole('alert')).toHaveTextContent('Port unavailable')
    }
  )

  it('waits for role preferences without showing a role picker, then defaults to Host', async () => {
    const preferences = prepareRoleLaunch()
    let finish!: (
      result: Awaited<ReturnType<typeof commands.loadPreferences>>
    ) => void
    vi.mocked(commands.loadPreferences).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    render(<AppShell />)
    expect(usePerformanceRoleStore.getState().role).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'PNDS Host' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'PNDS Client' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Choose a role in the sidebar' })
    ).not.toBeInTheDocument()
    await act(async () => finish({ status: 'ok', data: preferences }))
    expect(
      await screen.findByRole('heading', {
        name: 'Hi! Welcome to PNDS',
      })
    ).toBeVisible()
    expect(usePerformanceRoleStore.getState().role).toBe('host')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  })

  it('restores a saved Client into idle connection controls without reconnecting or mounting media', async () => {
    const preferences = prepareRoleLaunch()
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { ...preferences, lastPerformanceRole: 'client' },
    })
    render(<AppShell />)
    expect(
      await screen.findByRole('heading', { name: 'Join a local performance' })
    ).toBeVisible()
    expect(usePerformanceRoleStore.getState()).toMatchObject({
      role: 'client',
      lastRole: 'client',
      preferencesRestored: true,
    })
    expect(useClientParticipationStore.getState().snapshot.phase).toBe('idle')
    expect(screen.queryByTestId('welcome-logo-stage')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Performance score')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Project monitor')).not.toBeInTheDocument()
    expect(commands.inspectClientHost).not.toHaveBeenCalled()
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
    expect(commands.refreshClientPerformance).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('falls back to Host when the role preference read fails', async () => {
    prepareRoleLaunch()
    vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
      status: 'error',
      error: 'unreadable preferences',
    })
    render(<AppShell />)
    await waitFor(() =>
      expect(usePerformanceRoleStore.getState().role).toBe('host')
    )
    expect(usePerformanceRoleStore.getState().lastRole).toBe('host')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  })

  it.each(['explicit', 'native-host', 'native-client'] as const)(
    'does not replace %s role ownership when startup preferences arrive late',
    async owner => {
      const preferences = prepareRoleLaunch()
      let finish!: (
        result: Awaited<ReturnType<typeof commands.loadPreferences>>
      ) => void
      vi.mocked(commands.loadPreferences).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve
          })
      )
      if (owner === 'native-client')
        vi.mocked(commands.getClientParticipation).mockResolvedValueOnce({
          status: 'ok',
          data: {
            ...idleRoleClient,
            revision: 2,
            phase: 'open',
            pageUrl: 'http://score.localhost:51000/',
          },
        })
      render(<AppShell />)
      if (owner === 'explicit')
        await act(async () => {
          await usePerformanceRoleStore.getState().commitRole('client')
        })
      else if (owner === 'native-host')
        act(() => sessionHandler?.({ payload: readySnapshot }))
      const expected = owner === 'native-host' ? 'host' : 'client'
      await waitFor(() =>
        expect(usePerformanceRoleStore.getState().role).toBe(expected)
      )
      await act(async () =>
        finish({
          status: 'ok',
          data: {
            ...preferences,
            lastPerformanceRole: expected === 'host' ? 'client' : 'host',
          },
        })
      )
      expect(usePerformanceRoleStore.getState().role).toBe(expected)
      if (owner === 'explicit')
        expect(usePerformanceRoleStore.getState().lastRole).toBe('client')
      expect(commands.startProject).not.toHaveBeenCalled()
      expect(commands.joinClientPerformance).not.toHaveBeenCalled()
    }
  )

  it('retains the saved Client choice through a completed Creation visit and returns idle', async () => {
    const preferences = prepareRoleLaunch()
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { ...preferences, lastPerformanceRole: 'client' },
    })
    render(<AppShell />)
    await screen.findByRole('heading', { name: 'Join a local performance' })
    const entry = screen.getByRole('button', {
      name: 'Switch to creation mode',
    })
    fireEvent.click(entry)
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('armed')
    )
    fireEvent.click(entry)
    await screen.findByRole('heading', { name: 'Creation mode' })
    expect(usePerformanceRoleStore.getState()).toMatchObject({
      role: null,
      lastRole: 'client',
    })
    const back = screen.getByRole('button', {
      name: 'Return to performance mode',
    })
    fireEvent.click(back)
    await waitFor(() =>
      expect(useCreationStore.getState().modePhase).toBe('armed')
    )
    fireEvent.click(back)
    await screen.findByRole('heading', { name: 'Join a local performance' })
    expect(usePerformanceRoleStore.getState()).toMatchObject({
      role: 'client',
      lastRole: 'client',
    })
    expect(useClientParticipationStore.getState().snapshot.phase).toBe('idle')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.joinClientPerformance).not.toHaveBeenCalled()
  })

  it('opens the idle preview by default, preserves an explicit close across reading pages and resets for another project', async () => {
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: {
        ...readySnapshot,
        status: 'idle',
        health: null,
        projectPath: null,
      },
    })
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'idle-preview',
          root: '/p',
          source: 'folder',
          name: 'Score',
        },
        files: [],
      },
    })
    render(<AppShell />)
    const hide = await screen.findByRole('button', {
      name: 'Hide test preview',
    })
    expect(document.querySelector('[data-app-frame]')).not.toHaveClass(
      'creation-preview-collapsed'
    )
    expect(
      document.querySelector('[data-creation-test-idle]')
    ).not.toHaveAttribute('hidden')
    expect(
      screen.getByRole('separator', { name: 'Discussion and monitor width' })
    ).toBeInTheDocument()
    await userEvent.click(hide)
    expect(
      screen.getByRole('button', { name: 'Show test preview' })
    ).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Git versions' }))
    expect(document.querySelector('[data-creation-test-idle]')).toHaveAttribute(
      'hidden'
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
    expect(document.querySelector('[data-creation-test-idle]')).toHaveAttribute(
      'hidden'
    )
    act(() => {
      useCreationStore.setState({
        workspace: {
          project: {
            identity: 'other-preview',
            root: '/other',
            source: 'folder',
            name: 'Other',
          },
          files: [],
        },
      })
    })
    expect(
      screen.getByRole('button', { name: 'Hide test preview' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('keeps the running preview mounted across visibility changes without offering manual check controls', async () => {
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: readySnapshot,
    })
    useSessionStore.getState().applySnapshot(readySnapshot)
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'live-preview',
          root: '/p',
          source: 'folder',
          name: 'Running',
        },
        files: [],
      },
    })
    render(<AppShell />)
    const monitor = await screen.findByTitle('Project monitor')
    const src = monitor.getAttribute('src')
    const host = screen.getByTestId('monitor-host')
    act(() =>
      useAssistantOverviewStore.setState({
        owner: 'live-preview',
        staticEvidence: {
          passed: false,
          issues: 3,
          revision: 0,
          stale: false,
        },
      })
    )
    for (const key of [
      'creation.debug.more',
      'creation.doctor.action',
      'creation.check.action',
    ])
      expect(
        screen.queryByRole('button', { name: i18n.t(key), hidden: true })
      ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: i18n.t('creation.debug.issues', { count: 3 }),
        hidden: true,
      })
    ).not.toBeInTheDocument()
    expect(
      document.querySelector(
        '[data-creation-doctor], [data-creation-controlled-check], .creation-debug-reports'
      )
    ).toBeNull()
    expect(
      screen.queryByRole('region', { name: 'Static Doctor', hidden: true })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Controlled check', hidden: true })
    ).not.toBeInTheDocument()
    expect(host).not.toHaveAttribute('inert')
    await userEvent.click(
      screen.getByRole('button', { name: 'Hide test preview' })
    )
    expect(host).toHaveAttribute('inert')
    expect(host).toHaveAttribute('aria-hidden', 'true')
    expect(host).not.toHaveAttribute('hidden')
    const focused = document.activeElement
    fireEvent.load(monitor)
    expect(document.activeElement).toBe(focused)
    act(() => useSessionStore.getState().applySnapshot(readySnapshot))
    expect(host).toHaveAttribute('data-preview-hidden', 'true')
    expect(screen.getByTitle('Project monitor')).toBe(monitor)
    expect(monitor.getAttribute('src')).toBe(src)
    await userEvent.click(
      screen.getByRole('button', { name: 'Show test preview' })
    )
    expect(host).not.toHaveAttribute('inert')
    expect(host).not.toHaveAttribute('aria-hidden')
    expect(screen.getByTitle('Project monitor')).toBe(monitor)
    expect(
      screen.getByRole('button', { name: 'Hide test preview' })
    ).toHaveFocus()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startCreationCheck).not.toHaveBeenCalled()
  })

  it('keeps the default preview open after a test returns to idle', async () => {
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: readySnapshot,
    })
    useSessionStore.getState().applySnapshot(readySnapshot)
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'auto-preview',
          root: '/p',
          source: 'folder',
          name: 'Running',
        },
        files: [],
      },
    })
    render(<AppShell />)
    await screen.findByRole('button', { name: 'Hide test preview' })
    await act(async () => {
      useSessionStore
        .getState()
        .applySnapshot({ ...readySnapshot, status: 'idle', health: null })
    })
    expect(
      screen.getByRole('button', { name: 'Hide test preview' })
    ).toBeInTheDocument()
    expect(
      document.querySelector('[data-creation-test-idle]')
    ).not.toHaveAttribute('hidden')
  })

  it('adjusts discussion width by keyboard and keeps the same running monitor across file reading', async () => {
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: readySnapshot,
    })
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null, assistantMonitorRatio: 0.4 },
    })
    vi.mocked(commands.readCreationFile).mockResolvedValue({
      status: 'ok',
      data: { kind: 'text', text: 'score content', version: 'v1' },
    })
    useSessionStore.getState().applySnapshot(readySnapshot)
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'split-test',
          root: '/p',
          name: 'Score',
          source: 'folder',
        },
        files: [
          { path: 'score.js', kind: 'text', category: 'pages', size: 10 },
        ],
      },
    })
    render(<AppShell />)
    const monitor = await screen.findByTitle('Project monitor')
    const src = monitor.getAttribute('src')
    const divider = screen.getByRole('separator', {
      name: 'Discussion and monitor width',
    })
    expect(divider).toHaveAttribute('aria-orientation', 'vertical')
    fireEvent.keyDown(divider, { key: 'ArrowLeft' })
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ assistantMonitorRatio: expect.any(Number) })
      )
    )
    const wider = Number(divider.getAttribute('aria-valuenow'))
    expect(wider).toBeGreaterThan(40)
    fireEvent.click(screen.getByRole('treeitem', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
    fireEvent.keyDown(divider, { key: 'Home' })
    expect(divider).toHaveAttribute('aria-valuenow', '40')
    expect(screen.getByTitle('Project monitor')).toBe(monitor)
    expect(monitor.getAttribute('src')).toBe(src)
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it.each(['submit', 'opening', 'mode switch'])(
    'keeps the expanded monitor during %s and restores the same document afterward',
    async gate => {
      vi.mocked(commands.getSessionState).mockResolvedValue({
        status: 'ok',
        data: readySnapshot,
      })
      useSessionStore.getState().applySnapshot(readySnapshot)
      useCreationStore.setState({
        active: true,
        workspace: {
          project: {
            identity: 'expand',
            root: '/p',
            source: 'folder',
            name: 'Running',
          },
          files: [],
        },
      })
      render(<AppShell />)
      const monitor = await screen.findByTitle('Project monitor')
      const src = monitor.getAttribute('src')
      const topbar = document.querySelector('[data-creation-topbar]')
      fireEvent.click(screen.getByRole('button', { name: 'Expand preview' }))
      expect(topbar).toBeVisible()
      expect(document.querySelector('[data-creation-topbar]')).toBe(topbar)
      expect(
        screen.getByRole('button', { name: 'Switch to another project' })
      ).toBeDisabled()
      expect(screen.getByTitle('Project monitor')).toBe(monitor)
      expect(monitor.getAttribute('src')).toBe(src)
      act(() => {
        if (gate === 'submit') {
          useSessionStore.setState({ commandPending: true })
        } else if (gate === 'opening') {
          useCreationStore.setState({ opening: true })
        } else {
          useCreationStore.setState({ modePhase: 'preparing' })
        }
      })
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(
        screen.getByRole('button', { name: 'Switch to another project' })
      ).toBeDisabled()
      expect(screen.getByTitle('Project monitor')).toBe(monitor)
      expect(monitor.getAttribute('src')).toBe(src)
      act(() => {
        useSessionStore.setState({ commandPending: false })
        useCreationStore.setState({ opening: false, modePhase: 'idle' })
      })
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(
        screen.getByRole('button', { name: 'Switch to another project' })
      ).toBeEnabled()
      expect(screen.getByTitle('Project monitor')).toBe(monitor)
      expect(monitor.getAttribute('src')).toBe(src)
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
    }
  )

  // v1.5.0 (#124/#125): the main area's README routing — a drilled-in
  // folder claims it for its 自述 (protected folders included, with the
  // app-maintained empty state); home and nothing selected keeps the
  // starting page.
  it('shows the folder README instead of the starting page when drilled into a user folder', () => {
    useProjectStore.setState({
      activeFolderId: 'f1',
      projectFolders: [
        { id: 'f1', name: 'Gig', projectPaths: [], intro: 'Spring tour set' },
      ],
    })

    render(<AppShell />)

    expect(screen.getByTestId('folder-readme')).toBeInTheDocument()
    expect(screen.getByText('Spring tour set')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('shows the protected Utilities folder’s 自述 when drilled in (#125)', () => {
    useProjectStore.setState({
      activeFolderId: 'utilities',
      projectFolders: [
        { id: 'utilities', name: 'Utilities', projectPaths: [] },
      ],
    })

    render(<AppShell />)

    expect(screen.getByTestId('folder-readme')).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).not.toBeInTheDocument()
  })

  it('keeps the start-page sidebar permanently visible in fullscreen (§7.4)', () => {
    // Windowed: sidebar present.
    const windowed = render(<AppShell />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    windowed.unmount()

    // Fullscreen: the start page KEEPS its sidebar (only loaded sessions
    // retract it); welcome fills the rest of the window.
    useWindowStore.setState({
      fullscreen: true,
      showCustomTrafficLights: false,
      generation: 1,
    })
    render(<AppShell />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).toBeInTheDocument()
  })

  it('subscribes to session events at shell level and survives transitions', () => {
    render(<AppShell />)
    expect(vi.mocked(listen)).toHaveBeenCalledWith(
      'session-snapshot-event',
      expect.any(Function)
    )

    // Welcome → Starting → Ready: the same subscription must keep working
    act(() => {
      sessionHandler?.({ payload: { ...readySnapshot, status: 'starting' } })
    })
    expect(screen.getByText(/cancel/i)).toBeInTheDocument()

    act(() => {
      sessionHandler?.({ payload: readySnapshot })
    })
    // The dissolve gate keeps the loading layer briefly visible — the
    // subscription survived the transition even before the dissolve ends.
    expect(screen.getByText(/cancel/i)).toBeInTheDocument()
  })

  it('shows the loading screen with a cancel escape while starting (§10.3)', async () => {
    useSessionStore.setState({ sessionStatus: 'starting' })
    render(<AppShell />)
    expect(screen.getByText(/cancel/i)).toBeInTheDocument()
    // The splash is reveal motion (Brutal exemption, see the stop-cover
    // test): its dissolve must fade, not snap, in every theme.
    expect(
      screen
        .getByRole('button', { name: /cancel/i })
        .closest('[data-reveal-motion]')
    ).not.toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: /cancel/i }).click()
    })
    expect(commands.stopProject).toHaveBeenCalled()
  })

  it('shows the monitor and hover zone without a title overlay when running', () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      lanIp: '192.168.1.10',
      health: {
        status: 'ready',
        projectId: 'inarticulate-iii',
        audioMode: 'none',
        audio: { status: 'disabled', target: null, error: null },
        scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
      },
    })
    render(<AppShell />)

    const monitor = screen.getByTitle('Project monitor')
    // #49/#54: the URL now always carries the theme and language
    // first-frame parameters.
    expect(monitor).toHaveAttribute(
      'src',
      'http://192.168.1.10:6869/?theme=pond&lang=en&pndsHostOrigin=http%3A%2F%2Flocalhost%3A3000'
    )
    expect(screen.getByTestId('monitor-host')).toHaveAccessibleName(
      'Inarticulate III'
    )
    expect(
      screen
        .getByTestId('monitor-host')
        .querySelector('[data-tauri-drag-region]')
    ).toBeNull()
    expect(screen.getByTestId('sidebar-hover-zone')).toBeInTheDocument()
    // Sidebar stays mounted for the slide animation but is visually hidden
    const popover = screen.getByTestId('sidebar-popover')
    expect(popover.className).toContain('opacity-0')
    expect(popover.className).toContain('pointer-events-none')
  })

  /** v1.2.3 (#39): opening another project while a session runs (any of the
   * five entry paths — they all funnel through openProject) selects +
   * preflights it and never drops the monitor view back to the welcome
   * screen. */
  it('keeps the monitor when another project is opened while running (#39)', async () => {
    const { openProject } = await import('@/lib/open-project')
    vi.mocked(commands.preflightProject).mockResolvedValue({
      status: 'ok',
      data: readyManifest,
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      sessionProjectPath: '/p',
      sessionLanIp: '192.168.1.10',
      lanIp: '10.0.0.5',
      health: {
        status: 'ready',
        projectId: 'inarticulate-iii',
        audioMode: 'none',
        audio: { status: 'disabled', target: null, error: null },
        scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
      },
    })
    useProjectStore.setState({
      currentProject: { path: '/p', manifest: readyManifest },
      recentProjectPaths: ['/p', '/q'],
      preflightStatus: 'ready',
    })
    // The mount-time restore must re-report the running session (the
    // default mock would answer with an idle snapshot and wipe it).
    vi.mocked(commands.getSessionState).mockResolvedValue({
      status: 'ok',
      data: readySnapshot,
    })
    render(<AppShell />)

    await openProject('/q')

    expect(commands.preflightProject).toHaveBeenCalledWith('/q')
    // The iframe still targets the SESSION's IP — the selection's seeded
    // lanIp (10.0.0.5) must never retarget or reload the live monitor.
    const monitor = screen.getByTitle('Project monitor')
    expect(monitor).toHaveAttribute(
      'src',
      'http://192.168.1.10:6869/?theme=pond&lang=en&pndsHostOrigin=http%3A%2F%2Flocalhost%3A3000'
    )
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
  })

  it('retracts a popped-out overlay sidebar when entering fullscreen (§7.4)', () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
      lanIp: '192.168.1.10',
      health: {
        status: 'ready',
        projectId: 'inarticulate-iii',
        audioMode: 'none',
        audio: { status: 'disabled', target: null, error: null },
        scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
      },
    })
    render(<AppShell />)
    // Pop the overlay sidebar in.
    fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
    const popover = screen.getByTestId('sidebar-popover')
    expect(popover.className).toContain('opacity-100')

    // Enter fullscreen: the overlay sidebar retracts instantly.
    act(() => {
      useWindowStore.setState({
        fullscreen: true,
        showCustomTrafficLights: false,
        generation: 1,
      })
    })
    // The remounted instance starts collapsed.
    const popover2 = screen.getByTestId('sidebar-popover')
    expect(popover2.className).toContain('opacity-0')
    expect(popover2.className).toContain('pointer-events-none')

    // In fullscreen the hover zone still pops the sidebar in.
    act(() => {
      fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
    })
    const afterHover = screen.getByTestId('sidebar-popover')
    expect(afterHover.className).toContain('opacity-100')
  })

  it('shows the error page with summary and details on failure (§10.3)', () => {
    useSessionStore.setState({
      sessionStatus: 'error',
      sessionError: 'Port 6868 is already in use.',
      outputTail: ['Error: bind EADDRINUSE'],
    })
    render(<AppShell />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Port 6868 is already in use.'
    )
    // v1.2.0 (issue #14): a port conflict additionally surfaces the occupant
    // block — the plain Retry stays exactly one, Release and Retry is its
    // own control.
    expect(screen.getByTestId('port-conflict-block')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^retry$/i })).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: /release and retry/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    expect(screen.getByText(/technical details/i)).toBeInTheDocument()
  })

  /// §9.3: Retry must open a NEW loading session, not resume the failed
  /// one. The loading screen is keyed by `runId`, so the logo canvas
  /// remounts and replays from its first stage with fresh colours.
  it('remounts the loading screen on a Retry out of error (§9.3, §10.3)', () => {
    render(<AppShell />)

    act(() => {
      sessionHandler?.({ payload: { ...readySnapshot, status: 'starting' } })
    })
    const firstRunId = useSessionStore.getState().runId
    const firstCanvas = document.querySelector('canvas')
    expect(firstCanvas).not.toBeNull()

    act(() => {
      sessionHandler?.({
        payload: {
          ...readySnapshot,
          status: 'error',
          health: null,
          error: 'Timed out waiting for the project to report ready (30s).',
          startupStage: 0,
        },
      })
    })
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(useSessionStore.getState().runId).toBe(firstRunId)

    act(() => {
      sessionHandler?.({
        payload: {
          ...readySnapshot,
          status: 'starting',
          health: null,
          startupStage: 1,
        },
      })
    })
    expect(useSessionStore.getState().runId).toBe(firstRunId + 1)
    const secondCanvas = document.querySelector('canvas')
    expect(secondCanvas).not.toBeNull()
    expect(secondCanvas).not.toBe(firstCanvas)
    expect(screen.getByText(/cancel/i)).toBeInTheDocument()
  })

  // ── v1.1.2: projectFolders preference restore (spec issue #4) ──

  it('restores the folder structure and membership from saved preferences', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
      status: 'ok',
      data: {
        theme: 'system',
        language: null,
        outputDevice: null,
        oscTargets: {},
        recentProjects: [
          '/Users/test/Inarticulate III',
          '/Users/test/PNDS Score 1',
        ],
        projectFolders: [
          {
            id: 'f1',
            name: 'Gig Friday',
            projectPaths: ['/Users/test/PNDS Score 1'],
          },
        ],
      },
    })

    render(<AppShell />)

    // The grouped project is hidden from the Home segment; the folder
    // segment renders with the persisted name.
    await waitFor(() =>
      expect(useProjectStore.getState().projectFolders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Gig Friday' }),
        ])
      )
    )
    const entries = screen.getAllByTestId('project-entry')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toHaveAttribute(
      'data-project-path',
      '/Users/test/Inarticulate III'
    )
  })

  // ── #147: persisted LAN choice restore (user report: every launch began
  // unselected, gating the Load button gray with no hint) ──

  it('seeds the session store from the persisted LAN choice at mount', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
      status: 'ok',
      data: {
        theme: 'system',
        language: null,
        outputDevice: null,
        oscTargets: {},
        recentProjects: [],
        lanIp: '192.168.11.31',
      },
    })

    render(<AppShell />)

    await waitFor(() =>
      expect(useSessionStore.getState().lanIp).toBe('192.168.11.31')
    )
  })

  it('re-fetches the session state when the webview becomes visible again', () => {
    render(<AppShell />)

    const callsBefore = vi.mocked(commands.getSessionState).mock.calls.length
    // An occluded WKWebView suspends JS; the queued pnds:session events
    // lag behind the backend. On regain the shell must catch up itself.
    document.dispatchEvent(new Event('visibilitychange'))

    expect(vi.mocked(commands.getSessionState).mock.calls.length).toBe(
      callsBefore + 1
    )
  })

  it('keeps the live monitor when an older mount restore arrives after ready', async () => {
    let resolveRestore!: (
      result: Awaited<ReturnType<typeof commands.getSessionState>>
    ) => void
    vi.mocked(commands.getSessionState)
      .mockResolvedValue({ status: 'ok', data: readySnapshot })
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveRestore = resolve
        })
      )
    render(<AppShell />)
    act(() => sessionHandler?.({ payload: readySnapshot }))
    const monitor = screen.getByTitle('Project monitor')

    await act(async () => {
      resolveRestore({
        status: 'ok',
        data: { ...readySnapshot, status: 'idle', health: null },
      })
    })

    expect(screen.getByTitle('Project monitor')).toBe(monitor)
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
  })

  it('does not update the store from a restore that finishes after unmount', async () => {
    let resolveRestore!: (
      result: Awaited<ReturnType<typeof commands.getSessionState>>
    ) => void
    vi.mocked(commands.getSessionState).mockReturnValueOnce(
      new Promise(resolve => {
        resolveRestore = resolve
      })
    )
    const { unmount } = render(<AppShell />)
    unmount()
    await act(async () => {
      resolveRestore({ status: 'ok', data: readySnapshot })
    })

    expect(useSessionStore.getState().sessionStatus).toBe('idle')
  })

  it('polls once a second while starting and stops polling after ready', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(commands.getSessionState)
        .mockResolvedValueOnce({
          status: 'ok',
          data: { ...readySnapshot, status: 'starting', health: null },
        })
        .mockResolvedValue({ status: 'ok', data: readySnapshot })
      const { unmount } = render(<AppShell />)
      await act(async () => {
        await Promise.resolve()
      })
      expect(useSessionStore.getState().sessionStatus).toBe('starting')
      await act(async () => {
        vi.advanceTimersByTime(999)
      })
      expect(commands.getSessionState).toHaveBeenCalledTimes(1)
      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(commands.getSessionState).toHaveBeenCalledTimes(2)
      expect(useSessionStore.getState().sessionStatus).toBe('ready')
      await act(async () => {
        vi.advanceTimersByTime(3000)
      })
      expect(commands.getSessionState).toHaveBeenCalledTimes(2)
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads a legacy preferences file (no projectFolders) without error', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
      status: 'ok',
      data: {
        theme: 'system',
        language: null,
        outputDevice: null,
        oscTargets: {},
        recentProjects: ['/Users/test/Inarticulate III'],
      },
    })

    render(<AppShell />)

    await screen.findByTestId('project-entry')
    expect(useProjectStore.getState().projectFolders).toEqual([])
    expect(useProjectStore.getState().projectFolders).toEqual([])
  })

  it('seeds the default Utilities folder from the built-in tools on a fresh index', async () => {
    const TOOLS = [
      '~/bundles/local-network-diagnostics-0.1.0',
      '~/bundles/multichannel-signal-generator-1.0.0',
    ]
    vi.mocked(commands.builtinUtilities).mockResolvedValue({
      status: 'ok',
      data: TOOLS.map(path => ({
        id: path.split('/').pop() ?? path,
        path,
        name: path,
      })),
    })

    render(<AppShell />)

    // The folder appears with the two installed tools as members.
    await waitFor(() =>
      expect(useProjectStore.getState().projectFolders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'utilities', projectPaths: TOOLS }),
        ])
      )
    )
    expect(screen.getByRole('tab', { name: 'Utilities' })).toBeInTheDocument()
    // Both tools are folder members, so the Home segment stays empty.
    expect(screen.queryByTestId('project-entry')).not.toBeInTheDocument()
    expect(useProjectStore.getState().recentProjectPaths).toEqual(TOOLS)
  })

  /** v1.3.0 (user report on the switch fade): stopping a live session
   * must dissolve the outgoing monitor under the StopCover (not cut to
   * a Welcome flash for the whole teardown), and the idle that follows
   * uncovers the next screen with a fade. A switch's `starting`
   * supersedes the cover with the loading splash directly. */
  describe('stop-transition cover (user report)', () => {
    it('keeps the monitor mounted under a fading cover while stopping', () => {
      // A REVEALED monitor (loadingDone via the ready-first escape
      // hatch — the real switch confirm happens long after the reveal).
      useSessionStore.setState({
        sessionStatus: 'ready',
        projectName: 'Inarticulate III',
        lanIp: '192.168.1.10',
        health: readySnapshot.health,
      })
      render(<AppShell />)

      act(() => {
        sessionHandler?.({
          payload: { ...readySnapshot, status: 'stopping' },
        })
      })

      // The outgoing page stays visible beneath the cover fading in —
      // never a Welcome flash during the teardown.
      expect(screen.getByTitle('Project monitor')).toBeInTheDocument()
      const cover = screen.getByTestId('stop-cover')
      expect(cover).toBeInTheDocument()
      // The cover is reveal motion: theme-variables.css exempts the
      // marker from Brutal's instant rule, so the fade survives there.
      expect(cover.hasAttribute('data-reveal-motion')).toBe(true)
      expect(
        screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
      ).not.toBeInTheDocument()
    })

    it('uncovers the Welcome with a fade when the stop lands on idle', async () => {
      useSessionStore.setState({
        sessionStatus: 'ready',
        projectName: 'Inarticulate III',
        lanIp: '192.168.1.10',
        health: readySnapshot.health,
      })
      render(<AppShell />)
      act(() => {
        sessionHandler?.({
          payload: { ...readySnapshot, status: 'stopping' },
        })
      })
      act(() => {
        sessionHandler?.({
          payload: { ...readySnapshot, status: 'idle', health: null },
        })
      })

      // Welcome mounts UNDER the still-covering layer...
      expect(
        screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
      ).toBeInTheDocument()
      expect(screen.getByTestId('stop-cover')).toBeInTheDocument()

      // ...and the fade end clears it.
      await waitFor(
        () => {
          expect(screen.queryByTestId('stop-cover')).not.toBeInTheDocument()
        },
        { timeout: 2000 }
      )
      expect(useSessionStore.getState().stopUncoverPending).toBe(false)
    })

    it('hands a switch through idle straight to the loading splash', async () => {
      useSessionStore.setState({
        sessionStatus: 'ready',
        projectName: 'Inarticulate III',
        lanIp: '192.168.1.10',
        health: readySnapshot.health,
      })
      render(<AppShell />)
      act(() => {
        sessionHandler?.({
          payload: { ...readySnapshot, status: 'stopping' },
        })
      })
      // The backend always crosses idle between stop and start. The
      // awaited act flushes the dissolve-gate reset (a queueMicrotask
      // in AppShell) before the next snapshot arrives.
      await act(async () => {
        sessionHandler?.({
          payload: { ...readySnapshot, status: 'idle', health: null },
        })
      })
      act(() => {
        sessionHandler?.({
          payload: {
            ...readySnapshot,
            status: 'starting',
            projectName: 'Next Project',
          },
        })
      })

      // The splash takes over; no cover, no monitor, no Welcome flash.
      expect(screen.queryByTestId('stop-cover')).not.toBeInTheDocument()
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()
      expect(screen.queryByTitle('Project monitor')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { name: 'Hi! Welcome to PNDS' })
      ).not.toBeInTheDocument()
    })
  })

  /** v1.3.0 (#50): the loading→monitor reveal gate, end to end at the
   * shell level. The splash must survive session-ready (it overlaps the
   * already-mounting monitor iframe), hold its final logo frame until
   * the iframe's OWN load event releases the gate, then cross-fade away
   * — never flipping an unloaded iframe on screen. */
  describe('AppShell reveal gate (#50)', () => {
    /** Minimal Canvas2D stub — enough for the logo animation loop to run
     * and redraw inside jsdom (which has no canvas implementation). */
    const canvasCtxStub = () =>
      ({
        canvas: { width: 600 },
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        fillStyle: '',
        globalAlpha: 1,
        font: '',
        textAlign: '',
        textBaseline: '',
      }) as unknown as CanvasRenderingContext2D

    /** Drive rAF one frame at a time, flushing the ready snapshot and
     * closure callback's React updates before advancing the next frame. */
    const driveFrames = async (frames: number) => {
      for (let i = 0; i < frames; i++) {
        await act(async () => {
          vi.advanceTimersByTime(16)
        })
      }
    }

    beforeEach(() => {
      // These scenarios inject their snapshots through sessionHandler.
      // Pin the short entrance they assert and prevent another test's
      // command mock from asynchronously restoring a different lifecycle.
      // Leave it pending: these tests exercise events, not restore failures.
      useSessionStore.setState({ audioMode: 'none' })
      vi.mocked(commands.getSessionState).mockReturnValue(
        new Promise(() => undefined)
      )
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        canvasCtxStub()
      )
      // raf + performance must be faked for the animation's frame math.
      vi.useFakeTimers({
        toFake: [
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'requestAnimationFrame',
          'performance',
          'Date',
        ],
      })
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('holds the splash over the mounting monitor until the iframe loads, then cross-fades', async () => {
      render(<AppShell />)

      // Cold-restore style: the ready snapshot arrives after mount, so the
      // dissolve gate is armed (no escape hatch).
      act(() => {
        sessionHandler?.({ payload: readySnapshot })
      })

      // The monitor iframe mounts BENEATH the splash — its load clock
      // starts with the splash, not after it.
      const monitor = screen.getByTitle('Project monitor')
      // Ready ≠ released: the splash is still up…
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()

      // …and stays up through the whole entrance + closure animation
      // (~50 + ~90 frames), holding its final frame: with the iframe not
      // yet loaded, nothing may flip the monitor in.
      await driveFrames(220)
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()

      // The iframe's load event releases the gate; the 400ms cross-fade
      // runs and unmounts the splash over the ALREADY-LOADED monitor.
      act(() => {
        fireEvent.load(monitor)
      })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(screen.queryByText(/cancel/i)).not.toBeInTheDocument()
      expect(screen.getByTitle('Project monitor')).toBeInTheDocument()
      expect(useSessionStore.getState().monitorLoaded).toBe(true)
    })

    it('holds even a completed closure when the iframe stalls, until the timeout backstop releases', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
      render(<AppShell />)
      act(() => {
        sessionHandler?.({ payload: readySnapshot })
      })

      // Animation completes; the iframe never loads.
      await driveFrames(220)
      expect(screen.getByText(/cancel/i)).toBeInTheDocument()

      // The backstop fires (MONITOR_REVEAL_TIMEOUT_MS from the mount),
      // releases the gate, and the cross-fade completes without the
      // iframe ever reporting readiness.
      await act(async () => {
        vi.advanceTimersByTime(10_000)
      })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(useSessionStore.getState().monitorLoadTimedOut).toBe(true)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/cancel/i)).not.toBeInTheDocument()
    })

    it('keeps the splash instance across the starting→ready handover (no entrance replay)', async () => {
      render(<AppShell />)

      // The normal open path: starting first…
      act(() => {
        sessionHandler?.({ payload: { ...readySnapshot, status: 'starting' } })
      })
      // …the entrance plays out and the composition HOLDS while waiting.
      await driveFrames(60)

      act(() => {
        sessionHandler?.({ payload: readySnapshot })
      })

      // If the splash remounted at the handover (branch switch), the
      // entrance would replay (~53 frames) BEFORE the ~94-frame closure —
      // 100 frames cannot reach closureDone then, and the release below
      // would never dissolve the splash. The preserved instance closes
      // directly from the held composition, so 100 frames suffice.
      await driveFrames(100)
      act(() => {
        fireEvent.load(screen.getByTitle('Project monitor'))
      })
      await act(async () => {
        vi.advanceTimersByTime(400)
      })

      expect(screen.queryByText(/cancel/i)).not.toBeInTheDocument()
      expect(screen.getByTitle('Project monitor')).toBeInTheDocument()
    })
  })
})

describe('creation parent startup restoration', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('en')
  })

  it.each([false, true])(
    'restores the saved creation parent into an open form while preserving a newer native pick: %s',
    async newerPick => {
      const preferences = await commands.loadPreferences()
      if (preferences.status === 'error') throw preferences.error
      let resolveLoad!: (result: typeof preferences) => void
      vi.mocked(commands.loadPreferences).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveLoad = resolve
          })
      )
      useCreationStore.setState({
        active: true,
        workspace: null,
        lastCreationParent: null,
        opening: false,
        request: null,
        modePhase: 'idle',
        error: null,
      })
      useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
      const user = userEvent.setup()
      render(<AppShell />)
      await user.click(screen.getByRole('button', { name: 'New project' }))
      expect(
        screen.getByRole('textbox', { name: 'Parent folder' })
      ).toHaveValue('')
      if (newerPick) {
        vi.mocked(open).mockResolvedValueOnce('/new-selection')
        await user.click(
          screen.getByRole('button', { name: 'Choose parent folder' })
        )
        await screen.findByDisplayValue('/new-selection')
        await waitFor(() =>
          expect(commands.savePreferences).toHaveBeenCalledWith(
            expect.objectContaining({ lastCreationParent: '/new-selection' })
          )
        )
      }
      await act(async () =>
        resolveLoad({
          status: 'ok',
          data: { ...preferences.data, lastCreationParent: '/saved-parent' },
        })
      )
      const expected = newerPick ? '/new-selection' : '/saved-parent'
      expect(
        screen.getByRole('textbox', { name: 'Parent folder' })
      ).toHaveValue(expected)
      expect(useCreationStore.getState().lastCreationParent).toBe(expected)
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await user.click(screen.getByRole('button', { name: 'New project' }))
      expect(
        screen.getByRole('textbox', { name: 'Parent folder' })
      ).toHaveValue(expected)
    }
  )
})
