import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emit } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
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

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

const TUTORIAL_MD = [
  '# PNDS App 使用教程',
  '',
  '欢迎使用 PNDS，[模板仓库](https://github.com/xO-xN/PNDS-Template)在此。',
  '',
  '## 首次启动',
  '',
  '打开应用进入欢迎界面。',
  '',
  '## 端口与地址',
  '',
  'performer 页面端口 6868，monitor 页面端口 6869，',
  '模式区别见[音频模式](../reference/audio-modes.md)。',
].join('\n')

/** The same tutorial as the zh tree ships it — #68's locale-aware
 * fetch pairs the trees with the locales that ask for them. */
const TUTORIAL_MD_EN = [
  '# PNDS App Tutorial',
  '',
  'Welcome to PNDS.',
  '',
  '## First launch',
  '',
  'Open the app to reach the welcome screen.',
  '',
  '## Ports and addresses',
  '',
  'The performer page listens on 6868 and the monitor page on 6869; see [audio modes](../reference/audio-modes.md).',
].join('\n')

/** docs/-relative paths, as the Rust command ships them. */
function fixtureDocPath(id: string): string {
  if (id === 'app-tutorial') return 'app-tutorial.md'
  if (id === 'template-guide') return 'template-guide.md'
  if (id === 'reference-readme') return 'reference/README.md'
  return `reference/${id.replace('reference-', '')}.md`
}

/** The full manifest must ship (buildHelpCorpus validates), stubs suffice. */
const FIXTURE_DOCS = HELP_BOOKS.flatMap(book => [...book.documentIds]).map(
  id => ({
    id,
    path: fixtureDocPath(id),
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

  it('hot-swaps the corpus and the search index when the language switches (#68)', async () => {
    const enDocs = FIXTURE_DOCS.map(doc =>
      doc.id === 'app-tutorial'
        ? { ...doc, markdown: TUTORIAL_MD_EN }
        : { ...doc, markdown: `# ${doc.id}\n\nBody.` }
    )
    vi.mocked(commands.helpCorpus).mockImplementation(
      (locale: string) =>
        Promise.resolve(
          locale === 'zh-CN'
            ? { status: 'ok', data: FIXTURE_DOCS }
            : { status: 'ok', data: enDocs }
        ) as never
    )

    render(<HelpCenterApp />)

    // The boot fetch used the resolved UI locale (en in the test env)…
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'PNDS App Tutorial',
      })
    ).toBeInTheDocument()
    expect(commands.helpCorpus).toHaveBeenCalledWith('en')

    // …and a pushed locale swap hot-swaps the open document in place —
    // same doc id, now the zh tree's copy, without reopening anything.
    fireHelpEvent('pnds:help-locale', { locale: 'zh-CN' })
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'PNDS App 使用教程',
      })
    ).toBeInTheDocument()
    expect(commands.helpCorpus).toHaveBeenCalledWith('zh-CN')

    // The search index followed: a standing query answers from the
    // swapped (zh) corpus.
    const input = screen.getByPlaceholderText('搜索文档…')
    fireEvent.change(input, { target: { value: '端口' } })
    expect(
      await screen.findByRole('button', { name: /端口与地址/ })
    ).toBeInTheDocument()
  })

  it('surfaces an explicit error — never the other language — when a tree fails mid-switch (#68)', async () => {
    vi.mocked(commands.helpCorpus)
      .mockResolvedValueOnce({ status: 'ok', data: FIXTURE_DOCS })
      .mockResolvedValueOnce({
        status: 'error',
        error:
          'help document "reference-osc" is unreadable (looked in …/docs/zh-CN/reference/osc.md)',
      } as never)

    render(<HelpCenterApp />)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'PNDS App 使用教程',
      })
    ).toBeInTheDocument()

    // The zh tree is broken: the switch must land on the error state
    // (with Retry), not quietly keep or serve another language.
    fireHelpEvent('pnds:help-locale', { locale: 'zh-CN' })
    expect(await screen.findByText(/帮助内容加载失败/)).toBeInTheDocument()

    // Retry re-asks for the SAME locale — the base mock resolves again.
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'PNDS App 使用教程',
      })
    ).toBeInTheDocument()
    expect(commands.helpCorpus).toHaveBeenLastCalledWith('zh-CN')
  })

  it('announces readiness so a dropped boot-time target can be replayed', async () => {
    render(<HelpCenterApp />)

    await screen.findByPlaceholderText('Search the docs…')
    expect(emit).toHaveBeenCalledWith('pnds:help-ready')
  })

  it('navigates between documents on corpus links; external links leave via the system browser', async () => {
    render(<HelpCenterApp />)

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'PNDS App 使用教程',
      })
    ).toBeInTheDocument()

    // A cross-document link (the corpus's repo-root-style ../ form) opens
    // the target document in-window — never a webview navigation.
    fireEvent.click(screen.getByRole('link', { name: '音频模式' }))
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'reference-audio-modes',
      })
    ).toBeInTheDocument()

    // External links go to the system browser; the window stays put.
    fireEvent.click(screen.getByRole('button', { name: 'PNDS App 使用教程' }))
    fireEvent.click(await screen.findByRole('link', { name: '模板仓库' }))
    expect(openUrl).toHaveBeenCalledWith(
      'https://github.com/xO-xN/PNDS-Template'
    )
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'PNDS App 使用教程',
      })
    ).toBeInTheDocument()
  })
})
