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
