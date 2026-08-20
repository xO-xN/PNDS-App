import { render, screen, fireEvent } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promptOpenProject } from '@/lib/open-project'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { WelcomeScreen } from './WelcomeScreen'

vi.mock('@/lib/open-project', () => ({
  promptOpenProject: vi.fn().mockResolvedValue(undefined),
}))

/**
 * v1.2.0 (spec issue #15): the starting page is copy plus preflight
 * feedback; adding a project ran through the sidebar only. v1.2.2 (issue
 * #31) reverses the copy-only stance: a central accent "Import Project"
 * CTA (same language as the Load button) makes the first import
 * discoverable without knowing the sidebar. It routes through the same
 * promptOpenProject as the list-tail "+" and ⌘O.
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

  describe('the central import CTA (v1.2.2, issue #31)', () => {
    it('renders between the subtitle and the hint block', () => {
      render(<WelcomeScreen />)

      const button = screen.getByTestId('welcome-import-button')
      expect(button).toHaveTextContent('Import Project')
      const subtitle = screen.getByText(
        'The Platform for Network Digital Score'
      )
      const hint = screen.getByText(
        'Start a PNDS Digital Score by adding a new project'
      )
      // #31: the CTA sits after the subtitle and before the hint copy.
      expect(
        subtitle.compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(
        hint.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_PRECEDING
      ).toBeTruthy()
    })

    it('opens the same import flow as the sidebar entry', () => {
      render(<WelcomeScreen />)

      fireEvent.click(screen.getByTestId('welcome-import-button'))

      expect(vi.mocked(promptOpenProject)).toHaveBeenCalledTimes(1)
    })

    it('disables while a session is busy, in both busy states', () => {
      for (const status of ['starting', 'stopping'] as const) {
        useSessionStore.setState({ sessionStatus: status })
        const { unmount } = render(<WelcomeScreen />)

        const button = screen.getByTestId('welcome-import-button')
        expect(button).toBeDisabled()
        fireEvent.click(button)
        expect(vi.mocked(promptOpenProject)).not.toHaveBeenCalled()

        unmount()
        useSessionStore.setState({ sessionStatus: 'idle' })
      }
    })
  })

  it('renders the plain hint copy alongside the CTA', () => {
    render(<WelcomeScreen />)

    expect(
      screen.getByText('Start a PNDS Digital Score by adding a new project')
    ).toBeInTheDocument()
    expect(
      screen.getByText('or select a project on the left sidebar')
    ).toBeInTheDocument()
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
