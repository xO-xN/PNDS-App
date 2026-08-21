import { render, screen, act, fireEvent } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { AppShell } from './AppShell'
import type { Manifest, SessionSnapshot } from '@/lib/tauri-bindings'

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
}

/** Captured handler for the shell-level pnds:session subscription. */
let sessionHandler: ((event: { payload: SessionSnapshot }) => void) | null

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionHandler = null
    vi.mocked(listen).mockImplementation((event, cb) => {
      if (event === 'pnds:session') {
        sessionHandler = cb as (event: { payload: SessionSnapshot }) => void
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
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
    useWindowStore.setState({
      fullscreen: false,
      showCustomTrafficLights: true,
      generation: 0,
    })
  })

  it('shows Welcome with an always-open sidebar when idle (§10.4)', () => {
    render(<AppShell />)
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).toBeInTheDocument()
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
      'pnds:session',
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

    await act(async () => {
      screen.getByRole('button', { name: /cancel/i }).click()
    })
    expect(commands.stopProject).toHaveBeenCalled()
  })

  it('shows the monitor with drag title and hover zone when running (§10.1)', () => {
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
    expect(monitor).toHaveAttribute('src', 'http://192.168.1.10:6869/')
    expect(screen.getByText('PNDS - Inarticulate III')).toBeInTheDocument()
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
    expect(monitor).toHaveAttribute('src', 'http://192.168.1.10:6869/')
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
    await screen.findByTestId('folder-segment')
    expect(screen.getByTestId('folder-name')).toHaveTextContent('Gig Friday')
    const entries = screen.getAllByTestId('project-entry')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toHaveAttribute(
      'data-project-path',
      '/Users/test/Inarticulate III'
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
    expect(screen.queryByTestId('folder-segment')).not.toBeInTheDocument()
    expect(useProjectStore.getState().projectFolders).toEqual([])
  })

  it('seeds the default Utilities folder from the built-in tools on a fresh index', async () => {
    const TOOLS = [
      '~/bundles/local-network-diagnostics-0.1.0',
      '~/bundles/multichannel-signal-generator-1.0.0',
    ]
    vi.mocked(commands.builtinUtilities).mockResolvedValue({
      status: 'ok',
      data: TOOLS.map(path => ({ path, name: path })),
    })

    render(<AppShell />)

    // The folder appears with the two installed tools as members.
    await screen.findByTestId('folder-segment')
    expect(screen.getByTestId('folder-name')).toHaveTextContent('Utilities')
    // Both tools are folder members, so the Home segment stays empty.
    expect(screen.queryByTestId('project-entry')).not.toBeInTheDocument()
    expect(useProjectStore.getState().recentProjectPaths).toEqual(TOOLS)
  })
})
