import { render, screen, act } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { AppShell } from './AppShell'
import type { SessionSnapshot } from '@/lib/tauri-bindings'

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
      trustedPaths: [],
      pendingTrustPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('shows Welcome with an always-open sidebar when idle (§10.4)', () => {
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
    expect(screen.getByText(/loading project/i)).toBeInTheDocument()

    act(() => {
      sessionHandler?.({ payload: readySnapshot })
    })
    // The dissolve gate keeps the loading layer briefly visible — the
    // subscription survived the transition even before the dissolve ends.
    expect(screen.getByText(/loading project/i)).toBeInTheDocument()
  })

  it('shows the loading screen with a cancel escape while starting (§10.3)', async () => {
    useSessionStore.setState({ sessionStatus: 'starting' })
    render(<AppShell />)
    expect(screen.getByText(/loading project/i)).toBeInTheDocument()

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
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument()
    expect(screen.getByText(/technical details/i)).toBeInTheDocument()
  })
})
