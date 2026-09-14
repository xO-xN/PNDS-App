import { render, screen, fireEvent } from '@/test/test-utils'
import { describe, it, expect, vi } from 'vitest'
import { openUrl } from '@tauri-apps/plugin-opener'
import type { ReadmeCoverPage } from '@/lib/readme-cover-page'
import { ProjectCoverPage } from './ProjectCoverPage'

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
    // A true SIZE container — Tailwind's `@container` (inline-size
    // only) lets every cqh fall back to the viewport; inside the
    // projection window's zoom frame that divergence made the title's
    // fit squeeze its tracking in jumps and the band overrun the
    // panel's bottom (user report: 字间距突变、内容超出窗口). This
    // pins the container type the whole cq layout depends on.
    expect(root.className).toContain('[container-type:size]')
    expect(root.className).not.toContain('@container')
    expect(screen.getByTestId('cover-header').className).toContain(
      'pt-(--cover-edge-inset)'
    )
    expect(screen.getByTestId('cover-band').className).toContain(
      'bottom-(--cover-edge-inset)'
    )
    // The title reserves the band's full footprint above the inset,
    // so it rides directly on top of the band.
    expect(
      screen.getByTestId('cover-title').parentElement?.className
    ).toContain('calc(var(--cover-edge-inset)')
  })

  // The projection screen passes a roomier band (user request: 带内容
  // 上下增长); the override rides the SAME token inline, over the class
  // default — absent, the class default (the README panel's share) holds.
  it('overrides the band height token per embedding, defaulting to the class share', () => {
    const { rerender, container } = render(
      <ProjectCoverPage page={PAGE} cover={null} />
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--cover-band-h')).toBe('')

    rerender(
      <ProjectCoverPage
        page={PAGE}
        cover={null}
        bandHeight="min(34cqh,42cqw)"
        titleGaps={{ above: '4cqh', below: '7.5cqh' }}
      />
    )
    expect(root.style.getPropertyValue('--cover-band-h')).toBe(
      'min(34cqh,42cqw)'
    )
    // The class defaults stay as the non-override baseline — including
    // the title's breathing-room tokens (the layout's hard constants
    // became these so an embedding can widen the gaps).
    expect(root.className).toContain('[--cover-band-h:min(26cqh,42cqw)]')
    expect(root.className).toContain('[--cover-title-pt:2cqh]')
    expect(root.className).toContain('[--cover-title-pb-gap:4.5cqh]')
    expect(
      screen.getByTestId('cover-title').parentElement?.className
    ).toContain('pt-(--cover-title-pt)')
    expect(root.style.getPropertyValue('--cover-title-pt')).toBe('4cqh')
    expect(root.style.getPropertyValue('--cover-title-pb-gap')).toBe('7.5cqh')
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
