import { render, screen } from '@/test/test-utils'
import { describe, it, expect } from 'vitest'
import { BUILTIN_UTILITY_DISPLAY_NAMES } from '@/lib/builtin-utilities'
import { utilityIdFromPath } from '@/lib/builtin-utilities'
import zh from '../../../locales/zh-CN.json'
import en from '../../../locales/en.json'
import { UtilityIntro } from './UtilityIntro'

/**
 * v1.5.0 polish (user request): the built-in utilities' info page — the
 * cover page's composition in its minimal form. The spec is precise:
 * the alias as the title, the one-line intro below (no cover on the
 * band's left), plain "PNDS Utility" text in the header's right corner,
 * and nothing else (no composer/github pills, no empty-state pointer at
 * the README writing rules).
 */
describe('UtilityIntro', () => {
  it('resolves the registry id from a staged path, across staging roots', () => {
    expect(
      utilityIdFromPath(
        '/var/folders/tmp/AppSupport/utilities/multichannel-signal-generator'
      )
    ).toBe('multichannel-signal-generator')
    expect(
      utilityIdFromPath(
        '/Applications/PNDS.app/Resources/utilities/local-network-diagnostics'
      )
    ).toBe('local-network-diagnostics')
  })

  it('reads non-utility paths as null — projects keep the README panel', () => {
    expect(utilityIdFromPath('/Users/test/Inarticulate III')).toBeNull()
    // A folder that merely CONTAINS the word is not a staging path —
    // only the `<root>/utilities/<registry id>` shape counts.
    expect(utilityIdFromPath('/Users/test/utilities/my-own-tool')).toBeNull()
  })

  it('renders the alias title, the locale intro, and the PNDS Utility tag', () => {
    render(<UtilityIntro id="telematic-network-diagnostics" />)

    expect(
      screen.getByRole('heading', { name: 'Telematic Diagnostics' })
    ).toBeInTheDocument()
    expect(screen.getByText('PNDS Utility')).toBeInTheDocument()
    // The intro copy comes from the locale for the App's language (the
    // test i18n runs English): the one-sentence "what is this for".
    expect(
      screen.getByText(
        /^A diagnostic for the connection quality of a multi-site/u
      )
    ).toBeInTheDocument()
  })

  // Every registered tool renders the same page model with its own
  // alias and locale copy.
  it('renders Sensor Meter with its intro', () => {
    render(<UtilityIntro id="mobile-sensor-meter" />)

    expect(
      screen.getByRole('heading', { name: 'Sensor Meter' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^A live meter for the phones/u)
    ).toBeInTheDocument()
  })

  it('renders no cover image, no link pills, and no section label', () => {
    render(<UtilityIntro id="local-network-diagnostics" />)

    expect(screen.queryByTestId('cover-image')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cover-composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cover-github')).not.toBeInTheDocument()
    // The intro text stands alone in the band — no cover-format label.
    expect(screen.queryByTestId('cover-label')).not.toBeInTheDocument()
  })

  // Follow-up round: the corner tag carries the projects' pill
  // background, the diamond mark goes monochrome in the theme's ink,
  // and the band text centers on both axes.
  it('styles the PNDS Utility tag as a pill like the project cover', () => {
    render(<UtilityIntro id="local-network-diagnostics" />)

    expect(screen.getByTestId('cover-header-note')).toHaveTextContent(
      'PNDS Utility'
    )
    expect(screen.getByTestId('cover-header-note').className).toContain(
      'rounded-full'
    )
  })

  it('renders the diamond mark monochrome in the theme ink', () => {
    const { container } = render(
      <UtilityIntro id="local-network-diagnostics" />
    )
    const dots = [
      ...container.querySelectorAll<HTMLElement>(
        '[data-testid="cover-diamond"] span span'
      ),
    ]
    expect(dots).toHaveLength(4)
    for (const dot of dots) {
      expect(dot.style.backgroundColor).toBe('var(--pnds-text)')
    }
  })

  it('centers the band text on both axes', () => {
    render(<UtilityIntro id="local-network-diagnostics" />)

    const column = screen.getByTestId('cover-band-text')
    expect(column.className).toContain('items-center')
    expect(column.className).toContain('justify-center')
    expect(column.className).toContain('text-center')
  })

  // The intro copy is addressed by a DYNAMIC locale key
  // (`utilities.intro.<registry id>`), so nothing at compile time ties
  // the registry to the locale files — this pin does: a utility added
  // to the registry without both locale entries fails here, not as a
  // silently empty intro on some machine.
  it('has intro copy for every registry utility in BOTH locales', () => {
    // The locale modules are typed by their key sets, but a registry id
    // joined into a key is just a string to the compiler — the pin is
    // runtime: presence AND non-empty copy in both trees.
    const zhCopy = zh as Record<string, string>
    const enCopy = en as Record<string, string>
    for (const id of Object.keys(BUILTIN_UTILITY_DISPLAY_NAMES)) {
      const key = `utilities.intro.${id}`
      // A missing key reads as '' and fails the length gate.
      expect((zhCopy[key] ?? '').length).toBeGreaterThan(0)
      expect((enCopy[key] ?? '').length).toBeGreaterThan(0)
    }
  })
})
