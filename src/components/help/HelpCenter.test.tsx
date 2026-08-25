import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emit } from '@tauri-apps/api/event'
import { render, screen, fireEvent, waitFor, cleanup } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { HELP_BOOKS } from '@/lib/help-corpus'
import { HelpCenterApp } from './HelpCenter'

/**
 * v1.3.0 (#56): the help center window's component seam — the full user
 * flow the issue pins: type → live hits → click → the document opens,
 * scrolls to the hit section, and the terms stay marked. Plus the
 * browsing surface (sidebar over the whole corpus), the #51 anti-flash
 * reveal (the window is created hidden and this component reveals it
 * once content is ready — or once it has failed, never leaving it
 * invisible), and the events the main window sends (navigate target,
 * language switch).
 */

const eventHandlers = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>()
)
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: unknown) => void) => {
    eventHandlers.set(name, payload => handler({ payload }))
    return () => {
      eventHandlers.delete(name)
    }
  }),
  emit: vi.fn().mockResolvedValue(undefined),
}))

const TUTORIAL_MD = [
  '# PNDS App 使用教程',
  '',
  '欢迎使用 PNDS。',
  '',
  '## 首次启动',
  '',
  '打开应用进入欢迎界面。',
  '',
  '## 端口与地址',
  '',
  'performer 页面端口 6868，monitor 页面端口 6869。',
].join('\n')

/** The full manifest must ship (buildHelpCorpus validates), stubs suffice. */
const FIXTURE_DOCS = HELP_BOOKS.flatMap(book => [...book.documentIds]).map(
  id => ({
    id,
    markdown: id === 'app-tutorial' ? TUTORIAL_MD : `# ${id}\n\n正文。`,
  })
)

function fireHelpEvent(name: string, payload: unknown): void {
  eventHandlers.get(name)?.(payload)
}

describe('HelpCenterApp (#56)', () => {
  let restoreScrollIntoView: () => void

  beforeEach(() => {
    vi.mocked(commands.helpCorpus).mockResolvedValue({
      status: 'ok',
      data: FIXTURE_DOCS,
    })
    restoreScrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    restoreScrollIntoView()
    i18n.changeLanguage('en')
    delete document.documentElement.dataset.colorTheme
  })

  it('reveals the hidden window once the corpus is ready', async () => {
    render(<HelpCenterApp />)

    await waitFor(() =>
      expect(commands.fadeInWindow).toHaveBeenCalledWith('help')
    )
    expect(commands.fadeInWindow).toHaveBeenCalledTimes(1)
  })

  it('searches live, and a hit click opens the doc on its section with the terms marked', async () => {
    render(<HelpCenterApp />)

    const input = await screen.findByPlaceholderText('Search the docs…')
    fireEvent.change(input, { target: { value: '端口' } })

    const hit = await screen.findByRole('button', { name: /端口与地址/ })
    // The snippet in the hit list marks the matched term.
    expect(hit.querySelector('mark')?.textContent).toBe('端口')

    fireEvent.click(hit)

    // The document opened, on the hit section…
    const section = await screen.findByRole('heading', {
      level: 2,
      name: '端口与地址',
    })
    await waitFor(() => expect(section.scrollIntoView).toHaveBeenCalled())
    // …with the term marked in the body.
    expect(document.querySelectorAll('main mark').length).toBeGreaterThan(0)
  })

  it('lists every book and document in the sidebar and opens on click', async () => {
    render(<HelpCenterApp />)

    expect(await screen.findByText('User Tutorial')).toBeInTheDocument()
    expect(screen.getByText('Creator Guide')).toBeInTheDocument()
    expect(screen.getByText('Reference Manual')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'PNDS App 使用教程' }))
    expect(
      screen.getByRole('heading', { level: 1, name: 'PNDS App 使用教程' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'reference-osc' }))
    expect(
      screen.getByRole('heading', { level: 1, name: 'reference-osc' })
    ).toBeInTheDocument()
  })

  it('lands on the initial target — a doc page or the search box', async () => {
    render(
      <HelpCenterApp initialTarget={{ kind: 'doc', docId: 'app-tutorial' }} />
    )
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'PNDS App 使用教程',
      })
    ).toBeInTheDocument()

    cleanup()
    eventHandlers.clear()

    render(<HelpCenterApp initialTarget={{ kind: 'search' }} />)
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Search the docs…')).toHaveFocus()
    )
  })

  it('still reveals and offers retry when the corpus fails to load', async () => {
    vi.mocked(commands.helpCorpus)
      .mockRejectedValueOnce(new Error('unreadable') as never)
      .mockResolvedValueOnce({ status: 'ok', data: FIXTURE_DOCS })

    render(<HelpCenterApp />)

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument()
    await waitFor(() =>
      expect(commands.fadeInWindow).toHaveBeenCalledWith('help')
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'PNDS App 使用教程',
      })
    ).toBeInTheDocument()
  })

  it('follows navigation and locale events from the main window', async () => {
    render(<HelpCenterApp />)

    await screen.findByPlaceholderText('Search the docs…')

    fireHelpEvent('pnds:help-navigate', {
      kind: 'doc',
      docId: 'reference-manifest',
    })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'reference-manifest',
      })
    ).toBeInTheDocument()

    fireHelpEvent('pnds:help-locale', { locale: 'zh-CN' })
    await waitFor(() =>
      expect(screen.getByPlaceholderText('搜索文档…')).toBeInTheDocument()
    )

    // Live theme follow: the pushed color theme lands on the root node.
    fireHelpEvent('pnds:help-theme', { colorTheme: 'stage' })
    await waitFor(() =>
      expect(document.documentElement.dataset.colorTheme).toBe('stage')
    )
  })

  it('announces readiness so a dropped boot-time target can be replayed', async () => {
    render(<HelpCenterApp />)

    await screen.findByPlaceholderText('Search the docs…')
    expect(emit).toHaveBeenCalledWith('pnds:help-ready')
  })
})
