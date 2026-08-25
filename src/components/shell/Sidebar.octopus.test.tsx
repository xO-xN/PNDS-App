import { render, screen } from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
}))

/**
 * #71 (Brutal): the shelf octopus rides the settings footer — rendered
 * only under Brutal, anchored to the footer wrapper so it follows the
 * card's height changes in pure CSS, kept out of the project scroller,
 * and pointer-transparent. The shelf line landing on the card's top
 * edge (the OCTO_SHELF_OVERHANG_PX calibration) is dev-server visual
 * verification, not jsdom.
 */
describe('Sidebar octopus (issue #71: Brutal-only shelf illustration)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({ colorThemeSetting: 'lavender' })
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      pendingPreflightPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
    useSessionStore.getState().resetSession()
  })

  it('renders under Brutal, anchored to the settings footer', () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    render(<Sidebar variant="static" />)

    const octopus = screen.getByTestId('octo-sidebar')
    const footer = screen.getByTestId('settings-footer')
    // A direct child of the footer wrapper: absolute positioning against
    // that container is what carries the octopus along when the card's
    // height changes (audio mode / device row / volume).
    expect(octopus.parentElement).toBe(footer)
  })

  it('is absent from every other theme', () => {
    for (const colorTheme of ['lavender', 'sand', 'stage'] as const) {
      useSettingsStore.setState({ colorThemeSetting: colorTheme })
      const view = render(<Sidebar variant="static" />)
      expect(
        screen.queryByTestId('octo-sidebar'),
        `${colorTheme} must not render the octopus`
      ).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('never intercepts pointers', () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    render(<Sidebar variant="static" />)

    expect(screen.getByTestId('octo-sidebar').className).toContain(
      'pointer-events-none'
    )
  })

  it('stays out of the project scroller, in both variants', () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    for (const variant of ['static', 'overlay'] as const) {
      const view = render(<Sidebar variant={variant} />)
      expect(screen.getByTestId('project-list-scroll')).not.toContainElement(
        screen.getByTestId('octo-sidebar')
      )
      view.unmount()
    }
  })
})
