import { describe, it, expect } from 'vitest'
import {
  buildHelpCorpus,
  HELP_BOOKS,
  type RawHelpDocument,
} from './help-corpus'

/**
 * v1.3.0 (#53): the help corpus loader seam. The Rust `help_corpus`
 * command hands over raw { id, markdown } documents (read straight from
 * the bundled docs); this pure builder is the single place that knows the
 * corpus's shape — which documents exist, which book each belongs to, the
 * display order, and the title (each document's own `#` heading). A
 * mismatch between what Rust shipped and the manifest here fails LOUDLY:
 * the help center must never silently hide a document it cannot place.
 */

const FIXTURES: RawHelpDocument[] = [
  {
    id: 'reference-osc',
    path: 'reference/osc.md',
    markdown: '# OSC 协议\n\n## target 注入\n\nApp 启动时注入 target。',
  },
  {
    id: 'app-tutorial',
    path: 'app-tutorial.md',
    markdown: '# PNDS App 使用教程\n\n## 首次启动\n\n打开应用。',
  },
  {
    id: 'template-guide',
    path: 'template-guide.md',
    markdown: '# PNDS Template 创作指南\n\n## 准备工作\n\nNode.js 24。',
  },
  {
    id: 'reference-readme',
    path: 'reference/README.md',
    markdown: '# PNDS 参考手册\n\n按问题检索。',
  },
  {
    id: 'modules-readme',
    path: 'modules/README.md',
    markdown: '# 模块手册\n\n逐个讲解模块用法。',
  },
  // The rest of the manifest as minimal stubs — the tests only exercise
  // ordering, placement and failure paths, not the stubs' content.
  ...[
    'modules-qr',
    'modules-players',
    'modules-theme-follow',
    'modules-locale-follow',
    'modules-audio',
  ].map(id => ({
    id,
    path: `modules/${id.replace('modules-', '')}.md`,
    markdown: `# ${id}\n\n正文。`,
  })),
  ...[
    'reference-digital-score',
    'reference-network',
    'reference-audio-modes',
    'reference-runtime-contract',
    'reference-structure',
    'reference-manifest',
    'reference-pnds-bundle',
    'reference-supercollider',
    'reference-p5js',
  ].map(id => ({
    id,
    path: `reference/${id.replace('reference-', '')}.md`,
    markdown: `# ${id}\n\n正文。`,
  })),
]

describe('help-corpus (#53)', () => {
  it('builds the corpus in manifest order with books, titles and sections', () => {
    const corpus = buildHelpCorpus(FIXTURES)

    expect(corpus).toHaveLength(19)
    expect(
      corpus.slice(0, 3).map(doc => [doc.id, doc.book, doc.title])
    ).toEqual([
      ['app-tutorial', 'tutorial', 'PNDS App 使用教程'],
      ['template-guide', 'creator-guide', 'PNDS Template 创作指南'],
      ['reference-readme', 'reference', 'PNDS 参考手册'],
    ])
    expect(corpus.slice(16).map(doc => [doc.id, doc.book, doc.title])).toEqual([
      ['modules-theme-follow', 'modules', 'modules-theme-follow'],
      ['modules-locale-follow', 'modules', 'modules-locale-follow'],
      ['modules-audio', 'modules', 'modules-audio'],
    ])
    expect(corpus[0]?.sections.map(s => s.id)).toEqual([
      'pnds-app-使用教程',
      '首次启动',
    ])
  })

  it('fails loudly when a manifest document is missing from the raw set', () => {
    expect(() =>
      buildHelpCorpus(FIXTURES.filter(doc => doc.id !== 'template-guide'))
    ).toThrow(/template-guide/)
  })

  it('fails loudly when the raw set carries a document outside the manifest', () => {
    expect(() =>
      buildHelpCorpus([
        ...FIXTURES,
        { id: 'stray-page', path: 'stray.md', markdown: '# 游离页' },
      ])
    ).toThrow(/stray-page/)
  })

  it('falls back to the document id as title when no h1 exists', () => {
    const corpus = buildHelpCorpus(
      FIXTURES.map(doc =>
        doc.id === 'reference-osc'
          ? { ...doc, markdown: '## 只有二级\n\n无一级标题。' }
          : doc
      )
    )

    expect(corpus.find(doc => doc.id === 'reference-osc')?.title).toBe(
      'reference-osc'
    )
  })

  it('declares the manifest as every shippable document with a book', () => {
    expect(HELP_BOOKS.map(book => [book.id, ...book.documentIds])).toEqual([
      ['tutorial', 'app-tutorial'],
      ['creator-guide', 'template-guide'],
      [
        'reference',
        'reference-readme',
        'reference-digital-score',
        'reference-network',
        'reference-audio-modes',
        'reference-runtime-contract',
        'reference-structure',
        'reference-manifest',
        'reference-pnds-bundle',
        'reference-supercollider',
        'reference-osc',
        'reference-p5js',
      ],
      [
        'modules',
        'modules-readme',
        'modules-qr',
        'modules-players',
        'modules-theme-follow',
        'modules-locale-follow',
        'modules-audio',
      ],
    ])
  })
})
