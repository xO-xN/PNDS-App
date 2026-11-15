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
  duration: '6′32″',
  performers: 'A、B、C、D',
  contact: '@mail.com',
  composerUrl: null,
  githubUrl: null,
  websiteUrl: null,
  palette: ['#000000', '#c9d8b6', '#f1ecc3', '#57837b'],
  sectionLabel: '作品简介：',
  sectionMarkdown: '失语III 是为三个手机演奏者而作的数字乐谱作品。',
}

// A do-nothing ResizeObserver stand-in: its mere PRESENCE flips the
// cover title into the real-engine code path (the settle-gated reveal
// keys on `typeof ResizeObserver !== 'undefined'` — the same signal
// the component uses to detect jsdom's no-layout world).
class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
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

    expect(screen.getByText('PNDS池谱')).toBeInTheDocument()
    expect(screen.getByTestId('cover-composer')).toHaveTextContent('肖翔')
    expect(
      screen.getByRole('heading', { name: '失语 III' })
    ).toBeInTheDocument()
    expect(screen.getByTestId('cover-label')).toHaveTextContent('作品简介')
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

  it('keeps the four metadata positions and shows a dash when a value is missing', () => {
    render(<ProjectCoverPage page={{ ...PAGE, composer: null }} cover={null} />)

    expect(screen.getByTestId('cover-composer')).toHaveTextContent('—')
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

  it('normalizes the ripple cadence by title length — one crest stays one crest (follow-up report)', () => {
    // A fixed 0.16s per-glyph step on a LONG title smears the glyphs
    // across half the 5.2s cycle and the wave reads as random bobbing
    // (user report on the utility aliases); the step now normalizes so
    // the TOTAL spread caps at 0.8s whichever the length.
    const { container } = render(
      <ProjectCoverPage
        page={{ ...PAGE, title: 'Multichannel Gen' }}
        cover={null}
      />
    )
    const delays = [
      ...container.querySelectorAll<HTMLElement>('.cover-title-glyph'),
    ].map(span => parseFloat(span.style.animationDelay))
    expect(delays.length).toBeGreaterThan(10)
    // The first glyph rises first and later glyphs wait their turn.
    expect(delays[0]).toBe(0)
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i] ?? 0).toBeGreaterThan(delays[i - 1] ?? 0)
    }
    expect(Math.max(...delays)).toBeLessThanOrEqual(0.8 + 1e-9)

    // Short titles keep the original cadence: 0.16s per grapheme of
    // the TITLE (the space rides the index without a span, so the
    // span count is not the multiplier).
    const short = render(<ProjectCoverPage page={PAGE} cover={null} />)
    const shortDelays = [
      ...short.container.querySelectorAll<HTMLElement>('.cover-title-glyph'),
    ].map(span => parseFloat(span.style.animationDelay))
    expect(shortDelays[shortDelays.length - 1] ?? 0).toBeCloseTo(
      0.16 * (PAGE.title.length - 1),
      5
    )
  })

  it('re-creates the ripple spans on a title change — one shared animation timeline (skew report)', () => {
    // The skew mechanism (user report: 多选几次不同的工程，波纹逐渐杂乱):
    // an index-keyed span SURVIVES a selection change and its CSS
    // animation keeps the start time of the work that created it,
    // while spans for newly-reached indexes start now — a few
    // selections later the timelines have skewed arbitrarily. The
    // title rides the key, so a new title means a fresh element set.
    const view = render(<ProjectCoverPage page={PAGE} cover={null} />)
    const firstGlyph = () =>
      view.container.querySelector<HTMLElement>('.cover-title-glyph')

    const original = firstGlyph()
    // Re-rendering the SAME title keeps the elements (no needless
    // remount, no animation restart).
    view.rerender(<ProjectCoverPage page={PAGE} cover={null} />)
    expect(firstGlyph()).toBe(original)

    // A different title builds NEW elements — every glyph starts its
    // animation together.
    view.rerender(
      <ProjectCoverPage page={{ ...PAGE, title: 'Night Sky' }} cover={null} />
    )
    const switched = firstGlyph()
    expect(switched).not.toBe(original)
    // And back again — fresh once more, never the skewed survivor.
    view.rerender(<ProjectCoverPage page={PAGE} cover={null} />)
    expect(firstGlyph()).not.toBe(switched)
  })

  it('keeps joined-script titles whole (glyph splits would break letter joining)', () => {
    render(<ProjectCoverPage page={{ ...PAGE, title: 'موجة' }} cover={null} />)

    expect(
      screen.getByTestId('cover-title').querySelectorAll('.cover-title-glyph')
    ).toHaveLength(0)
  })

  // Round nine (reduce-motion report: the one post-paint plan change the
  // container fade normally masks shows as a hard jump without it): a
  // reduce-motion engine (ResizeObserver present, preference ON) never
  // paints the title until the world has been quiet — hidden at mount
  // behind the hold, fitted and revealed after it expires, and restored
  // if it unmounts still hidden.
  it('holds the title hidden behind the settle window and reveals it once quiet', () => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    try {
      const view = render(<ProjectCoverPage page={PAGE} cover={null} />)
      const title = screen.getByTestId('cover-title')
      expect(title.style.visibility).toBe('hidden')

      // Quiet world, hold expired: the reveal applies the plan (the
      // degenerate jsdom layout bails the fit — the reveal still shows).
      vi.advanceTimersByTime(200)
      expect(title.style.visibility).toBe('')

      view.unmount()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('restores the title if it unmounts while still behind the settle window', () => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    try {
      const view = render(<ProjectCoverPage page={PAGE} cover={null} />)
      const title = screen.getByTestId('cover-title')
      expect(title.style.visibility).toBe('hidden')

      view.unmount()
      expect(title.style.visibility).toBe('')
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  // Round nine follow-up (user report: 偏好关闭时 title 晚于构图出现):
  // with motion ALLOWED the entrance fade is itself the mask, so the
  // settle hold would be pure visible delay — the title must appear
  // synchronously, pre-paint, with no hold at all.
  it('reveals the title synchronously when motion is allowed — the fade masks late refits', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
    try {
      render(<ProjectCoverPage page={PAGE} cover={null} />)
      expect(screen.getByTestId('cover-title').style.visibility).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
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

  it('keeps metadata and Markdown links as readable, non-interactive audience text', () => {
    render(
      <ProjectCoverPage
        page={{
          ...PAGE,
          composerUrl: 'https://author.example',
          githubUrl: 'https://github.com/user/repo',
          websiteUrl: 'https://work.example',
          sectionMarkdown:
            'See [`docs/start.md`](docs/start.md), **the score**, and [notes][ref].\n\n[ref]: https://example.com\n\n[Website](https://work.example) · [Author](https://author.example)',
        }}
        cover={null}
      />
    )
    const body = screen.getByTestId('cover-band-text')
    expect(body.querySelector('code')).toHaveTextContent('docs/start.md')
    expect(body.querySelector('strong')).toHaveTextContent('the score')
    expect(body).toHaveTextContent('notes')
    expect(body).not.toHaveTextContent('](docs/start.md)')
    expect(body).not.toHaveTextContent('Website')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('cover-composer'))
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('keeps GFM structure while discarding active HTML and embedded images', () => {
    const { container } = render(
      <ProjectCoverPage
        page={{
          ...PAGE,
          sectionMarkdown:
            '| Voice | Part |\n| --- | --- |\n| One | A |\n\n![remote](https://example.com/a.png)\n\n<script>alert(1)</script>',
        }}
        cover={null}
      />
    )
    expect(screen.getByRole('cell', { name: 'One' })).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('updates the surface, palette and foreground zoom without replacing the title', () => {
    const { rerender } = render(<ProjectCoverPage page={PAGE} cover={null} />)
    const title = screen.getByTestId('cover-title')
    const root = screen.getByTestId('project-cover-page')
    const wash = root.style.getPropertyValue('--cover-fog-primary')
    expect(root.dataset.surface).toBe('app')
    rerender(
      <ProjectCoverPage
        page={{
          ...PAGE,
          palette: ['#ff0000', '#00ff00', '#0000ff', '#ffffff'],
        }}
        cover={null}
        surface="projection"
        zoom={110}
      />
    )
    expect(root.dataset.surface).toBe('projection')
    expect(root.style.getPropertyValue('--cover-zoom')).toBe('1.1')
    expect(root.style.getPropertyValue('--cover-fog-primary')).not.toBe(wash)
    expect(screen.getByTestId('cover-title')).toBe(title)
    expect(screen.getByTestId('cover-content-stage')).toContainElement(title)
  })
})

it('renders four two-line metadata fields as inert audience text', () => {
  render(<ProjectCoverPage page={PAGE} cover={null} />)
  const meta = screen.getByTestId('cover-metadata')
  expect(
    [...meta.querySelectorAll('dt')].map(node => node.textContent)
  ).toEqual(['Author', 'Duration', 'Performers', 'Contact'])
  expect(meta.querySelectorAll('dd')).toHaveLength(4)
  expect(screen.getByTestId('cover-duration')).toHaveTextContent('6′32″')
  expect(screen.getByTestId('cover-performers')).toHaveTextContent('A、B、C、D')
  expect(screen.getByTestId('cover-contact')).toHaveTextContent('@mail.com')
  expect(meta.querySelector('a')).toBeNull()
})
