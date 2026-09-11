import { render, screen, fireEvent } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useProjectStore } from '@/store/project-store'
import { useUpdaterStore } from '@/store/updater-store'
import { RELEASES_URL } from '@/lib/updater'
import pndsIcon from '@/assets/pnds-icon.png'
import { WelcomeScreen } from './WelcomeScreen'

// The update notice's button funnels into lib/updater's
// openReleasesPage — stub the opener so the click asserts without IPC.
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

/**
 * v1.2.0 (spec issue #15): the starting page is copy plus preflight
 * feedback. A central "Import Project" CTA (#31) was removed again before
 * the v1.2.2 release (user call: the hint copy carries the first-use
 * story) — importing lives in the list-tail entry and ⌘O only.
 */
describe('WelcomeScreen', () => {
  beforeEach(() => {
    useUpdaterStore.setState({ available: null, failure: null })
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

  it('renders the rippling logo stage above the hero (#86)', () => {
    render(<WelcomeScreen />)

    // Decorative, so hidden from the a11y tree — but present: the
    // ported site art and its three phased ripple rings. The
    // data-welcome-logo hook is what Brutal's hide rule keys on
    // (theme-variables.css), so it must survive refactors.
    const stage = screen.getByTestId('welcome-logo-stage')
    expect(stage).toHaveAttribute('aria-hidden', 'true')
    expect(stage).toHaveAttribute('data-welcome-logo', '')
    const rings = stage.querySelectorAll('span')
    expect(rings).toHaveLength(3)
    // #122 defect 1: each ring carries data-welcome-ring — the
    // reduce-motion rule (App.css) keys on it to hide the rings
    // outright (an instant play with fill-mode none would otherwise
    // park them at their base style: a full-size static ring). The CSS
    // itself is human-verified in tauri dev, like the other motion
    // rules; this pins the hook it depends on.
    for (const ring of rings) {
      expect(ring).toHaveAttribute('data-welcome-ring', '')
    }
    const icon = stage.querySelector('img')
    expect(icon).toHaveAttribute('src', pndsIcon)
    expect(icon).toHaveAttribute('alt', '')
    // #122: the icon must not be draggable out of the app (saving a
    // bare image file). Attribute half — the WebKit enforcement half
    // (-webkit-user-drag in App.css) is human-verified in tauri dev.
    expect(icon).toHaveAttribute('draggable', 'false')
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

  // v1.4.3 (#121): the check-only update notice — one docked line plus a
  // Releases button, present for the whole session once any check
  // (boot or manual) found a version.
  it('shows the update notice with a Releases button when a version is available', () => {
    useUpdaterStore.getState().setUpdateAvailable('1.4.3')

    render(<WelcomeScreen />)

    expect(screen.getByTestId('welcome-update-notice')).toHaveTextContent(
      'v1.4.3 is available'
    )
    expect(
      screen.getByRole('button', { name: 'Go to Releases' })
    ).toBeInTheDocument()
  })

  it('opens the Releases page from the notice button', () => {
    useUpdaterStore.getState().setUpdateAvailable('1.4.3')

    render(<WelcomeScreen />)

    fireEvent.click(screen.getByRole('button', { name: 'Go to Releases' }))
    expect(openUrl).toHaveBeenCalledWith(RELEASES_URL)
  })

  it('keeps the notice docked under a preflight error without hiding it', () => {
    useUpdaterStore.getState().setUpdateAvailable('1.4.3')
    useProjectStore.setState({
      preflightStatus: 'error',
      preflightError: 'score server port taken',
    })

    render(<WelcomeScreen />)

    // Both docked residents coexist — the notice never replaces the
    // error the operator is currently acting on.
    expect(screen.getByTestId('welcome-update-notice')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('port taken')
  })
})
