import { describe, it, expect } from 'vitest'
import { splitSections } from './help-markdown'
import type { HelpDocument } from './help-corpus'
import { buildHelpIndex, searchHelp } from './help-search'

/**
 * v1.3.0 (#53): the help center's search seam — a pure (index, query) →
 * ranked hits function, so the help window can re-run it on every
 * keystroke. Matching is case-insensitive substring over the sections'
 * plain text (substring, not word matching: the corpus is Chinese).
 * Relevance is a worked example, not an implementation echo: a doc-title
 * match outranks a section-heading match, which outranks a body match,
 * and a section matching MORE of the query's terms outranks one piling
 * up hits of a single term.
 */

function doc(
  id: string,
  markdown: string,
  book: HelpDocument['book'] = 'reference'
): HelpDocument {
  const sections = splitSections(markdown)
  return {
    id,
    book,
    title: sections[0]?.title ?? id,
    path: `${id}.md`,
    markdown,
    sections,
  }
}

describe('help-search (#53)', () => {
  const corpus = [
    doc(
      'audio-modes',
      '# 音频模式\n\n## 概述\n\n正文不包含关键词。',
      'reference'
    ),
    doc('network', '# 网络\n\n## 音频路由\n\n正文不包含关键词。'),
    doc('bundle', '# 打包\n\n## 结构\n\n正文提到音频一次。'),
  ]
  const index = buildHelpIndex(corpus)

  it('ranks doc-title hits above section-heading hits above body hits', () => {
    const hits = searchHelp(index, '音频')

    expect(hits.map(hit => hit.docId)).toEqual([
      'audio-modes',
      'network',
      'bundle',
    ])
    expect(hits[0]).toMatchObject({
      docId: 'audio-modes',
      docTitle: '音频模式',
      sectionId: '音频模式',
      sectionTitle: '音频模式',
    })
    expect(hits[1]).toMatchObject({
      docId: 'network',
      sectionId: '音频路由',
      sectionTitle: '音频路由',
    })
    expect(hits[2]).toMatchObject({
      docId: 'bundle',
      sectionId: '结构',
      sectionTitle: '结构',
    })
  })

  it('matches case-insensitively across scripts', () => {
    const mixed = buildHelpIndex([
      doc('manifest', '# manifest.json\n\n## 字段\n\nperformerPort 是整数。'),
    ])

    expect(searchHelp(mixed, 'PERFORMERPORT')).toHaveLength(1)
    expect(searchHelp(mixed, 'performerport')).toHaveLength(1)
    expect(searchHelp(mixed, '字段')).toHaveLength(1)
  })

  it('ranks a section covering more query terms above single-term piles', () => {
    const mixed = buildHelpIndex([
      doc(
        'runtime',
        '# 运行契约\n\n## 启动\n\nperformer 端口由 manifest 声明。\n\n## 其他\n\n端口 端口 端口 无别的词。'
      ),
    ])

    const hits = searchHelp(mixed, 'performer 端口')

    expect(hits.map(hit => hit.sectionTitle)).toEqual(['启动', '其他'])
  })

  it('snippets carry the matched text with ellipses at both cut edges', () => {
    const long = '甲'.repeat(60) + '目标关键词' + '乙'.repeat(60)
    const single = buildHelpIndex([doc('long', `# 长文\n\n## 正文\n\n${long}`)])

    const [hit] = searchHelp(single, '目标关键词')

    expect(hit?.snippet).toContain('目标关键词')
    expect(hit?.snippet.startsWith('…')).toBe(true)
    expect(hit?.snippet.endsWith('…')).toBe(true)
  })

  it('returns nothing for empty or unmatched queries', () => {
    expect(searchHelp(index, '')).toEqual([])
    expect(searchHelp(index, '   ')).toEqual([])
    expect(searchHelp(index, '量子纠缠')).toEqual([])
  })
})
