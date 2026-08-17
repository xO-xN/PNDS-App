import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { WelcomeScreen } from './WelcomeScreen'

/**
 * v1.2.0 (spec issue #15): the starting page is copy-only — adding a
 * project lives in the sidebar's "+" button and runs straight to preflight
 * (no trust dialog anymore); what the screen still owns is the
 * checking/error preflight feedback.
 */
describe('WelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      pendingPreflightPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('renders the plain hint — no interactive open/add control', () => {
    render(<WelcomeScreen />)

    expect(
      screen.getByText('Start a PNDS Digital Score by adding a new project')
    ).toBeInTheDocument()
    expect(
      screen.getByText('or select a project on the left sidebar')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the checking feedback while preflight runs', () => {
    useProjectStore.setState({ preflightStatus: 'checking' })

    render(<WelcomeScreen />)

    expect(screen.getByText('Checking project…')).toBeInTheDocument()
  })

  it('shows a readable preflight error', () => {
    useProjectStore.setState({
      preflightStatus: 'error',
      preflightError:
        'manifest.json missing required field: scoreServer.monitorPort',
    })

    render(<WelcomeScreen />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'scoreServer.monitorPort'
    )
  })
})
