import { render, screen } from '@/test/test-utils'
import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from '@/store/project-store'
import { WelcomeScreen } from './WelcomeScreen'

/**
 * v1.2.0 (spec issue #15): the starting page is copy plus preflight
 * feedback. A central "Import Project" CTA (#31) was removed again before
 * the v1.2.2 release (user call: the hint copy carries the first-use
 * story) — importing lives in the list-tail entry and ⌘O only.
 */
describe('WelcomeScreen', () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      pendingPreflightPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('renders the three first-use tips and no add-project line (#69)', () => {
    render(<WelcomeScreen />)

    // Spec-final copy (#69): open from the sidebar, hold ⌘, see Help —
    // "add a new project" is gone as a first-use suggestion.
    expect(
      screen.getByText('Open a project from the left sidebar')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Hold the ⌘ key to quickly control the App')
    ).toBeInTheDocument()
    expect(
      screen.getByText('See Help for full documentation')
    ).toBeInTheDocument()
    expect(screen.queryByText(/adding a new project/i)).not.toBeInTheDocument()
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
