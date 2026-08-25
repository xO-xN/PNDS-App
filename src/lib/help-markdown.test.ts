import { describe, it, expect } from 'vitest'
import { splitSections } from './help-markdown'

/**
 * v1.3.0 (#53): the help corpus's markdown structure pass. Splitting a
 * document into title + h2 sections is what the search index is built of
 * (hits carry the section anchor), and the anchors MUST be the ids the
 * rendered headings get (rehype-slug, same github-slugger algorithm,
 * every heading fed through in document order). The slug literals below
 * come from github-slugger itself, so the parity is pinned, not presumed.
 */

describe('help-markdown (#53)', () => {
  it('splits a document into the title section plus one section per h2', () => {
    const sections = splitSections(
      '# PNDS App 使用教程\n\n文档前言。\n\n## 1. 首次启动与权限授予\n\n打开应用。\n\n## 2. 工程管理\n\n左侧栏。'
    )

    expect(sections.map(s => [s.level, s.title])).toEqual([
      [1, 'PNDS App 使用教程'],
      [2, '1. 首次启动与权限授予'],
      [2, '2. 工程管理'],
    ])
    expect(sections.map(s => s.id)).toEqual([
      'pnds-app-使用教程',
      '1-首次启动与权限授予',
      '2-工程管理',
    ])
    expect(sections[0]?.markdown).toBe('文档前言。')
    expect(sections[1]?.markdown).toBe('打开应用。')
    expect(sections[0]?.text).toBe('文档前言。')
  })

  it('does not treat hash lines inside code fences as headings', () => {
    const sections = splitSections(
      [
        '# 标题',
        '',
        '```bash',
        '# a comment, not a heading',
        'export PERFORMER_PORT=6868',
        '```',
        '',
        '## 真节',
      ].join('\n')
    )

    expect(sections.map(s => s.title)).toEqual(['标题', '真节'])
    expect(sections[0]?.text).toContain('export PERFORMER_PORT=6868')
    expect(sections[0]?.text).not.toContain('```')
    expect(sections[0]?.text).toContain('a comment, not a heading')
  })

  it('folds h3+ headings into the enclosing h2 section', () => {
    const sections = splitSections(
      '# 标题\n\n## 二级\n\n### 三级甲\n\n内容甲\n\n#### 四级\n\n内容四'
    )

    expect(sections.map(s => s.title)).toEqual(['标题', '二级'])
    expect(sections[1]?.markdown).toContain('### 三级甲')
    expect(sections[1]?.markdown).toContain('#### 四级')
    expect(sections[1]?.text).toContain('内容甲')
    expect(sections[1]?.text).toContain('内容四')
  })

  it('disambiguates duplicate section titles the way the renderer will', () => {
    const sections = splitSections(
      '# 标题\n\n## 音频模式\n\nA\n\n## 音频模式\n\nB'
    )

    expect(sections.map(s => s.id)).toEqual(['标题', '音频模式', '音频模式-1'])
  })

  it('strips inline emphasis, code and link syntax from text', () => {
    const sections = splitSections(
      [
        '# 标题',
        '',
        '- **导入工程**：点击 `+ 导入工程` 按钮，见[音频模式](../reference/audio-modes.md)说明。',
      ].join('\n')
    )

    expect(sections[0]?.text).toBe(
      '- 导入工程：点击 + 导入工程 按钮，见音频模式说明。'
    )
  })
})
