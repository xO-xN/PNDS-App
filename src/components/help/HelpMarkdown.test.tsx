import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@/test/test-utils'
import { splitSections } from '@/lib/help-markdown'
import { HelpMarkdown } from './HelpMarkdown'

/**
 * v1.3.0 (#53): the help corpus's runtime renderer. It must turn the
 * corpus's markdown (GFM tables, fenced code) into real structure, and
 * — the load-bearing contract — the heading ids it emits must be the
 * very anchors the search index hands out, so a hit can scroll the help
 * window to its section. The parity test pins that: rendered heading ids
 * equal splitSections' ids on the same markdown, duplicate headings
 * included.
 */

const FIXTURE = [
  '# 帮助示例',
  '',
  '前言一段。',
  '',
  '## 端口分配',
  '',
  '| 页面 | 端口 |',
  '| --- | --- |',
  '| performer | 6868 |',
  '| monitor | 6869 |',
  '',
  '### 补充说明',
  '',
  '正文一句。',
  '',
  '## 命令行',
  '',
  '```bash',
  'git clone <repo>',
  '```',
  '',
  '## 端口分配',
  '',
  '重复标题的第二节。',
].join('\n')

function renderedHeadingIds(
  container: HTMLElement
): { level: number; id: string }[] {
  return Array.from(container.querySelectorAll('h1, h2, h3')).map(heading => ({
    level: Number(heading.tagName.slice(1)),
    id: heading.id,
  }))
}

describe('HelpMarkdown (#53)', () => {
  it('renders GFM tables with headers and cells', () => {
    render(<HelpMarkdown markdown={FIXTURE} />)

    const table = screen.getByRole('table')
    expect(
      within(table).getByRole('columnheader', { name: '页面' })
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('cell', { name: 'performer' })
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('cell', { name: '6869' })
    ).toBeInTheDocument()
  })

  it('renders fenced code blocks', () => {
    const { container } = render(<HelpMarkdown markdown={FIXTURE} />)

    const code = container.querySelector('pre code')
    expect(code).not.toBeNull()
    expect(code?.textContent).toContain('git clone <repo>')
  })

  it('gives headings the same anchors the search index hands out', () => {
    const { container } = render(<HelpMarkdown markdown={FIXTURE} />)

    const rendered = renderedHeadingIds(container)
    expect(rendered).toEqual([
      { level: 1, id: '帮助示例' },
      { level: 2, id: '端口分配' },
      { level: 3, id: '补充说明' },
      { level: 2, id: '命令行' },
      { level: 2, id: '端口分配-1' },
    ])

    const sections = splitSections(FIXTURE)
    const sectionAnchors = sections
      .filter(section => section.level <= 2)
      .map(section => section.id)
    expect(rendered.filter(h => h.level <= 2).map(h => h.id)).toEqual(
      sectionAnchors
    )
  })

  it('renders the corpus verbatim without a provider or props beyond markdown', () => {
    render(<HelpMarkdown markdown={'# 最小\n\n只有标题。'} />)

    expect(
      screen.getByRole('heading', { level: 1, name: '最小' })
    ).toHaveAttribute('id', '最小')
  })

  it('marks every occurrence of the highlight terms, case-insensitively', () => {
    const { container } = render(
      <HelpMarkdown
        markdown={'# 标题\n\n正文包含 Target 词与另一个 target 出现。'}
        highlightTerms={['target']}
      />
    )

    const marks = Array.from(container.querySelectorAll('mark'))
    expect(marks.map(mark => mark.textContent)).toEqual(['Target', 'target'])
  })

  it('highlights inside headings without disturbing their anchors', () => {
    render(
      <HelpMarkdown
        markdown={'# 端口分配\n\n正文。'}
        highlightTerms={['端口']}
      />
    )

    const heading = screen.getByRole('heading', { level: 1, name: '端口分配' })
    expect(heading).toHaveAttribute('id', '端口分配')
    expect(heading.querySelector('mark')?.textContent).toBe('端口')
  })

  it('renders without marks when no terms are given', () => {
    const { container } = render(<HelpMarkdown markdown={'目标关键词'} />)

    expect(container.querySelectorAll('mark')).toHaveLength(0)
  })
})
