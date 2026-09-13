import { render, screen, fireEvent } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openUrl } from '@tauri-apps/plugin-opener'
import { commands } from '@/lib/tauri-bindings'
import { openHelpWindow } from '@/lib/help-window'
import { useProjectStore } from '@/store/project-store'
import i18n from '@/i18n/config'
import { ProjectReadme } from './ProjectReadme'

// The writing-rules pointer funnels into lib/help-window — stub the
// window lifecycle so the click asserts without IPC or a real window.
vi.mock('@/lib/help-window', () => ({
  openHelpWindow: vi.fn().mockResolvedValue(undefined),
}))

// Link clicks hand external URLs to the system browser — stub the
// opener so the click asserts without IPC.
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

/** A README exercising the render contract: GFM table, fenced code, and
 * raw HTML that must never become live markup. */
const GFM_FIXTURE = [
  '# Night Sky',
  '',
  'Two acts, one intermission.',
  '',
  '| Act | Piece |',
  '| --- | --- |',
  '| I | Drift |',
  '| II | Bloom |',
  '',
  '```bash',
  'node server.js',
  '```',
  '',
  '<img src="x" onerror="alert(1)"> trailing raw html',
].join('\n')

function mockReadme(data: string | null): void {
  vi.mocked(commands.readProjectReadme).mockResolvedValue({
    status: 'ok',
    data,
  })
}

/**
 * v1.5.0 (#125): the project's root README.md in the main area —
 * rendered by the help center's renderer (GFM as real structure, raw
 * HTML never live), with the empty state pointing at the writing rules.
 */
describe('ProjectReadme', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders GFM tables and fenced code blocks as structure', async () => {
    mockReadme(GFM_FIXTURE)

    render(<ProjectReadme path="/p" />)

    expect(
      await screen.findByRole('heading', { name: 'Night Sky' })
    ).toBeInTheDocument()
    await screen.findByRole('table')
    expect(screen.getByRole('cell', { name: 'Drift' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Bloom' })).toBeInTheDocument()
    const code = document.querySelector('pre code')
    expect(code?.textContent).toContain('node server.js')
  })

  it('never renders raw HTML as live markup', async () => {
    mockReadme(GFM_FIXTURE)

    const { container } = render(<ProjectReadme path="/p" />)

    await screen.findByRole('table')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    // The HTML's own text may survive as inert text — the contract is
    // that nothing parses into an element.
  })

  it('shows the empty state with a writing-rules pointer when there is no README', async () => {
    mockReadme(null)

    render(<ProjectReadme path="/p" />)

    expect(
      await screen.findByText('This project has no README.md yet.')
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'See the README writing rules in Help',
      })
    )
    expect(openHelpWindow).toHaveBeenCalledWith({
      kind: 'doc',
      docId: 'readme-guide',
    })
  })

  it('surfaces a readable read-failure state, not the no-README copy, when the read errors', async () => {
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'error',
      error: 'README.md is too large to render',
    })

    render(<ProjectReadme path="/p" />)

    expect(
      await screen.findByText("Could not read this project's README.md:")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/README\.md is too large to render/)
    ).toBeInTheDocument()
    expect(
      screen.queryByText('This project has no README.md yet.')
    ).not.toBeInTheDocument()
  })

  it('re-reads when the selection moves to another project', async () => {
    mockReadme('# First')

    const { rerender } = render(<ProjectReadme path="/a" />)
    expect(
      await screen.findByRole('heading', { name: 'First' })
    ).toBeInTheDocument()

    mockReadme('# Second')
    rerender(<ProjectReadme path="/b" />)
    expect(
      await screen.findByRole('heading', { name: 'Second' })
    ).toBeInTheDocument()
    expect(commands.readProjectReadme).toHaveBeenNthCalledWith(1, '/a', 'en')
    expect(commands.readProjectReadme).toHaveBeenNthCalledWith(2, '/b', 'en')
  })

  it('docks the preflight feedback alongside the README', async () => {
    mockReadme('# Night Sky')
    useProjectStore.setState({
      preflightStatus: 'error',
      preflightError: 'score server port taken',
    })

    render(<ProjectReadme path="/p" />)

    expect(screen.getByRole('alert')).toHaveTextContent('port taken')
    expect(
      await screen.findByRole('heading', { name: 'Night Sky' })
    ).toBeInTheDocument()
  })
  // User report after #127: a README's links must never navigate the
  // main webview — the relative language-switcher line once booted the
  // raw file full-screen and stranded the app. External URLs leave via
  // the system browser; relative references are dead no-ops.
  it('never navigates on README links: external to the browser, relative no-ops', async () => {
    mockReadme(
      [
        '# Night Sky',
        '',
        '[中文](README.zh-CN.md) | [releases](https://example.com/rel) | [notes](./PROJECT_HANDSOFF.md)',
      ].join('\n')
    )

    render(<ProjectReadme path="/p" />)
    const external = await screen.findByRole('link', { name: 'releases' })

    fireEvent.click(external)
    expect(openUrl).toHaveBeenCalledWith('https://example.com/rel')

    fireEvent.click(screen.getByRole('link', { name: '中文' }))
    fireEvent.click(screen.getByRole('link', { name: 'notes' }))
    expect(openUrl).toHaveBeenCalledTimes(1)
  })

  it('re-reads the locale variant when the UI language changes', async () => {
    mockReadme('# English')

    render(<ProjectReadme path="/p" />)
    expect(
      await screen.findByRole('heading', { name: 'English' })
    ).toBeInTheDocument()

    try {
      mockReadme('# 中文')
      await i18n.changeLanguage('zh-CN')
      expect(
        await screen.findByRole('heading', { name: '中文' })
      ).toBeInTheDocument()
      expect(commands.readProjectReadme).toHaveBeenLastCalledWith('/p', 'zh-CN')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
