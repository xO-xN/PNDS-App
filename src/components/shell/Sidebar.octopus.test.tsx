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

  it('reserves the octopus zone below the card column — cards page above the art, transparent as ever', () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    useProjectStore.setState({ recentProjectPaths: ['/Users/test/Score 1'] })
    const brutalView = render(<Sidebar variant="static" />)

    // The reserve, not a card background, keeps the cards off the art:
    // the scroller surrenders the art's zone and the resting card owns
    // no background token of its own (hover:/active: are prefixed).
    expect(screen.getByTestId('project-list-scroll').style.marginBottom).toBe(
      '142px'
    )
    expect(
      screen
        .getByTestId('project-entry')
        .className.split(' ')
        .some(token => token.startsWith('bg-'))
    ).toBe(false)
    brutalView.unmount()

    useSettingsStore.setState({ colorThemeSetting: 'lavender' })
    render(<Sidebar variant="static" />)
    expect(screen.getByTestId('project-list-scroll').style.marginBottom).toBe(
      ''
    )
  })

  it('the import button keeps its column-tail seat — solid under Brutal, chip elsewhere', () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    const brutalView = render(<Sidebar variant="static" />)

    const button = screen.getByTestId('add-project-button')
    expect(screen.getByTestId('project-list-scroll')).toContainElement(button)
    expect(button.className).toContain('bg-(--pnds-card)')
    expect(button.className).toContain('border-(--pnds-text)')
    brutalView.unmount()

    // Outside Brutal the button stays the translucent chip it always
    // was, in the same seat.
    useSettingsStore.setState({ colorThemeSetting: 'lavender' })
    render(<Sidebar variant="static" />)
    const chip = screen.getByTestId('add-project-button')
    expect(screen.getByTestId('project-list-scroll')).toContainElement(chip)
    expect(chip.className).toContain('bg-(--pnds-text)/5')
  })
})
