import { render, screen, fireEvent } from '@/test/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { ReadmeCoverPage } from '@/lib/readme-cover-page'
import { ProjectCoverPage } from './ProjectCoverPage'
import { planTitleFit } from './title-fit'

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

const PAGE: ReadmeCoverPage = {
  title: '失语 III',
  composer: '@肖翔',
  composerUrl: null,
  githubUrl: null,
  palette: ['#000000', '#c9d8b6', '#f1ecc3', '#57837b'],
  sectionLabel: '作品简介：',
  sectionMarkdown: '失语III 是为三个手机演奏者而作的数字乐谱作品。',
}

/**
 * v1.5.0 (README cover page): the composed title page — header (mark,
 * wordmark, composer pill), hairline, the huge title, and the band
 * (cover square + the first section). Presentational: every datum
 * comes from the parser, every failure mode is "element absent".
 */
describe('ProjectCoverPage', () => {
  it('renders the header, title, and band from the parsed page', () => {
    render(<ProjectCoverPage page={PAGE} cover={null} />)

    expect(screen.getByText('PNDS')).toBeInTheDocument()
    expect(screen.getByTestId('cover-composer')).toHaveTextContent('@肖翔')
    expect(
      screen.getByRole('heading', { name: '失语 III' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('cover-label')).toHaveTextContent('作品简介：')
    // The section body rides through the markdown renderer.
    expect(
      screen.getByText(/失语III 是为三个手机演奏者而作的数字乐谱作品/)
    ).toBeInTheDocument()
  })

  it('paints the diamond in the project palette, panel order', () => {
    render(<ProjectCoverPage page={PAGE} cover={null} />)

    const dots = screen
      .getByTestId('cover-diamond')
      .querySelectorAll(':scope > span > span')
    expect(dots).toHaveLength(4)
    // DOM order is palette order: left, top, right, bottom.
    expect(dots[0]).toHaveStyle({ backgroundColor: '#000000' })
    expect(dots[1]).toHaveStyle({ backgroundColor: '#c9d8b6' })
    expect(dots[2]).toHaveStyle({ backgroundColor: '#f1ecc3' })
    expect(dots[3]).toHaveStyle({ backgroundColor: '#57837b' })
  })

  it('mounts the cover image when one was read', () => {
    render(<ProjectCoverPage page={PAGE} cover="data:image/png;base64,QUJD" />)

    expect(screen.getByTestId('cover-image')).toHaveAttribute(
      'src',
      'data:image/png;base64,QUJD'
    )
  })

  it('renders the band text-only when no cover ships', () => {
    render(<ProjectCoverPage page={PAGE} cover={null} />)

    expect(screen.queryByTestId('cover-image')).not.toBeInTheDocument()
    expect(screen.getByTestId('cover-label')).toBeInTheDocument()
  })

  it('hides the composer pill when the project names none', () => {
    render(<ProjectCoverPage page={{ ...PAGE, composer: null }} cover={null} />)

    expect(screen.queryByTestId('cover-composer')).not.toBeInTheDocument()
  })

  it('ripples the title per glyph without changing its text', () => {
    render(
      <ProjectCoverPage
        page={{ ...PAGE, title: 'Inarticulate III' }}
        cover={null}
      />
    )

    const title = screen.getByTestId('cover-title')
    // The visible text survives the split (copy/selection still work).
    expect(title.textContent).toBe('Inarticulate III')
    // Spaces ride as plain text; every other grapheme gets a ripple span.
    expect(title.querySelectorAll('.cover-title-glyph')).toHaveLength(
      'Inarticulate III'.replaceAll(' ', '').length
    )
  })

  it('keeps joined-script titles whole (glyph splits would break letter joining)', () => {
    render(<ProjectCoverPage page={{ ...PAGE, title: 'موجة' }} cover={null} />)

    expect(
      screen.getByTestId('cover-title').querySelectorAll('.cover-title-glyph')
    ).toHaveLength(0)
  })

  // One pass, reading direction only: the column's scrollTop crawls
  // down after the opening hold (HOLD_MS), and the wheel takes over
  // on touch — the auto-drive stands down for its resume window.
  it(
    'auto-scrolls the band text downward only when it overflows, and the wheel pauses it',
    { timeout: 10000 },
    async () => {
      // jsdom has no layout: a section that "fits" (zero overflow)
      // never moves.
      const fitting = render(<ProjectCoverPage page={PAGE} cover={null} />)
      const still = screen.getByTestId('cover-band-text')
      await new Promise(resolve => setTimeout(resolve, 80))
      expect(still.scrollTop).toBe(0)
      fitting.unmount()

      // An overflowing column (content 620 vs viewport 400) crawls.
      const scrollHeight = vi
        .spyOn(Element.prototype, 'scrollHeight', 'get')
        .mockReturnValue(620)
      const clientHeight = vi
        .spyOn(Element.prototype, 'clientHeight', 'get')
        .mockReturnValue(400)
      try {
        render(<ProjectCoverPage page={PAGE} cover={null} />)
        const column = screen.getByTestId('cover-band-text')
        await vi.waitFor(() => expect(column.scrollTop).toBeGreaterThan(0), {
          timeout: 6000,
        })
        fireEvent.wheel(column)
        const held = column.scrollTop
        await new Promise(resolve => setTimeout(resolve, 150))
        expect(column.scrollTop).toBe(held)
      } finally {
        scrollHeight.mockRestore()
        clientHeight.mockRestore()
      }
    }
  )

  // The user's hard spec, locked: the band's gap to the window bottom
  // equals the PNDS/composer row's gap to the window top. Both sides
  // must resolve the SAME --cover-edge-inset token (defined once on
  // the root) — this goes red the moment anyone hardcodes one side.
  it('mirrors the window-edge gaps through one shared inset token', () => {
    const { container } = render(<ProjectCoverPage page={PAGE} cover={null} />)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('[--cover-edge-inset:5cqh]')
    expect(root.className).toContain('[--cover-band-h:min(26cqh,42cqw)]')
    // The cq reference frames are split per axis: the root is an
    // INLINE-SIZE container (`@container`) so cqw tracks the panel's
    // width, while cqh resolves against the embedding — the projection
    // stage box (a size container) or, in the app panel, the viewport
    // fallback, which IS the approved original look. A size-carrying
    // root re-referenced every cqh to the p-8-inset panel and shrank
    // the whole vertical rhythm (user report: app 端间距被扩大) — this
    // pins the per-axis frames the cq layout depends on.
    expect(root.className).toContain('@container')
    expect(root.className).not.toContain('[container-type:size]')
    expect(screen.getByTestId('cover-header').className).toContain(
      'pt-(--cover-edge-inset)'
    )
    expect(screen.getByTestId('cover-band').className).toContain(
      'bottom-(--cover-edge-inset)'
    )
    // The title reserves the band's full footprint above the inset,
    // so it rides directly on top of the band — in the ORIGINAL
    // hard constants (no override tokens left on this axis).
    const titleZone = screen.getByTestId('cover-title')
      .parentElement as HTMLElement
    expect(titleZone.className).toContain('calc(var(--cover-edge-inset)')
    expect(titleZone.className).toContain('pt-[2cqh]')
    expect(titleZone.className).toContain('_4.5cqh)]')
  })

  // The projection screen passes a roomier band (user request: 带内容
  // 上下增长) and a tighter edge inset (user request: title 与上下两部
  // 分的间距增大 — the one token that widens the centered title's
  // visible gaps symmetrically); both overrides ride the SAME tokens
  // inline, over the class defaults — absent, the class defaults (the
  // README panel's shares) hold.
  it('overrides the band and inset tokens per embedding, defaulting to the class shares', () => {
    const { rerender, container } = render(
      <ProjectCoverPage page={PAGE} cover={null} />
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--cover-band-h')).toBe('')
    expect(root.style.getPropertyValue('--cover-edge-inset')).toBe('')

    rerender(
      <ProjectCoverPage
        page={PAGE}
        cover={null}
        bandHeight="min(40cqh,42cqw)"
        edgeInset="2cqh"
      />
    )
    expect(root.style.getPropertyValue('--cover-band-h')).toBe(
      'min(40cqh,42cqw)'
    )
    expect(root.style.getPropertyValue('--cover-edge-inset')).toBe('2cqh')
    // The class defaults stay as the non-override baseline — the README
    // panel (no props) renders EXACTLY the stock composition, pinned
    // by these token defaults equal to the original hard constants.
    expect(root.className).toContain('[--cover-edge-inset:5cqh]')
    expect(root.className).toContain('[--cover-band-h:min(26cqh,42cqw)]')
  })

  it('opens the composer and github links in the system browser', () => {
    render(
      <ProjectCoverPage
        page={{
          ...PAGE,
          composerUrl: 'https://arthur.example',
          githubUrl: 'https://github.com/user/repo',
        }}
        cover={null}
      />
    )

    fireEvent.click(screen.getByTestId('cover-composer'))
    fireEvent.click(screen.getByTestId('cover-github'))
    expect(openUrl).toHaveBeenCalledWith('https://arthur.example')
    expect(openUrl).toHaveBeenCalledWith('https://github.com/user/repo')
  })

  it('keeps the pill inert and hides github without url metadata', () => {
    render(<ProjectCoverPage page={PAGE} cover={null} />)

    expect(screen.getByTestId('cover-composer').tagName).toBe('SPAN')
    expect(screen.queryByTestId('cover-github')).not.toBeInTheDocument()
  })
})

// v1.5.0 (projection user report: 某比例下 title 字间距突然过大且溢出):
// the title fit's branch math is pure and pinned here — the effect's
// measurement story (zone-based available, Range-based text width, and
// a MEASURED width-per-spacing slope replacing glyph counts: the ripple
// spans bill letter-spacing twice per glyph) lives in the component.
describe('planTitleFit', () => {
  it('keeps the design tracking when the title fits the column (boundary included)', () => {
    // designWidth === available still belongs to the design branch.
    const plan = planTitleFit({
      available: 1000,
      em: 100,
      designWidth: 1000,
      zeroWidth: 630,
      unitSlope: 10,
    })
    expect(plan).toEqual({ letterSpacing: '37px', textIndent: '37px' })
    expect(plan.fontSize).toBeUndefined()
  })

  it('squeezes by the measured slope, not the character count', () => {
    // The real projection numbers: "Splash Ink" bills 19 units for its
    // 10 characters (9 spanned glyphs × 2 + 1 space) — a count-based
    // squeeze would underfill by 90% and overflow.
    const plan = planTitleFit({
      available: 1142.4,
      em: 164,
      designWidth: 1445,
      zeroWidth: 838.3,
      unitSlope: 19,
    })
    expect(plan.letterSpacing).toBe(`${(1142.4 - 838.3) / 19}px`)
    expect(plan.textIndent).toBe(plan.letterSpacing)
    expect(plan.fontSize).toBeUndefined()
  })

  it('scales the type down when even zero tracking overflows', () => {
    const plan = planTitleFit({
      available: 500,
      em: 100,
      designWidth: 1000,
      zeroWidth: 600,
      unitSlope: 10,
    })
    expect(plan.letterSpacing).toBe('0px')
    expect(plan.textIndent).toBe('0px')
    expect(plan.fontSize).toBe(`${(100 * 500) / 600}px`)
  })

  // The physical relation designWidth = zeroWidth + 0.37em × slope
  // keeps the squeeze branch at or under the design tracking — the
  // guarantee the honest measurements restore: the broken fit used to
  // declare a physically overflowing title "fits" and render it at the
  // full 0.37em.
  it('never tracks wider than the design when the inputs are physical', () => {
    const em = 164
    const zeroWidth = 838.3
    const unitSlope = 19
    const designWidth = zeroWidth + 0.37 * em * unitSlope
    const plan = planTitleFit({
      available: designWidth - 2,
      em,
      designWidth,
      zeroWidth,
      unitSlope,
    })
    expect(parseFloat(plan.letterSpacing)).toBeLessThanOrEqual(0.37 * em)
  })
})
