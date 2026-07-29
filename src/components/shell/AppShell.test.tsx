import { render, screen } from '@/test/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  beforeEach(() => {
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
    expect(screen.getByRole('heading', { name: 'PNDS' })).toBeInTheDocument()
  })

  it('shows the loading screen while the session starts (§10.3)', () => {
    useSessionStore.setState({ sessionStatus: 'starting' })
    render(<AppShell />)
    expect(screen.getByText(/starting project/i)).toBeInTheDocument()
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
    // Sidebar stays hidden until hovered
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
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
