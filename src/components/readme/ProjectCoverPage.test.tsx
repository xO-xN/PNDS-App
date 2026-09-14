import { render, screen } from '@/test/test-utils'
import { describe, it, expect } from 'vitest'
import type { ReadmeCoverPage } from '@/lib/readme-cover-page'
import { ProjectCoverPage } from './ProjectCoverPage'

const PAGE: ReadmeCoverPage = {
  title: '失语 III',
  composer: '@肖翔',
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

  // The user's hard spec, locked: the band's gap to the window bottom
  // equals the PNDS/composer row's gap to the window top. Both sides
  // must resolve the SAME --cover-edge-inset token (defined once on
  // the root) — this goes red the moment anyone hardcodes one side.
  it('mirrors the window-edge gaps through one shared inset token', () => {
    const { container } = render(<ProjectCoverPage page={PAGE} cover={null} />)

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('[--cover-edge-inset:9.5cqh]')
    expect(root.className).toContain('[--cover-band-h:min(24.3cqh,40cqw)]')
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
})
