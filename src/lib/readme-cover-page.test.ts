import { describe, it, expect } from 'vitest'
import {
  DEFAULT_COVER_PALETTE,
  parseReadmeCoverPage,
  type ReadmeCoverPage,
} from './readme-cover-page'

/** The canonical creator format, as shipped by Inarticulate III (zh). */
const CANONICAL = [
  '# 失语 III',
  '',
  '**中文** | [English](README.md)',
  '',
  'title: 失语 III',
  'composer: @肖翔',
  'composer_url: https://arthur.example',
  'github_url: https://github.com/user/repo',
  'color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]',
  '',
  '## 作品简介：',
  '',
  '失语III 是为三个手机演奏者而作的数字乐谱作品。',
  '演奏者通过手机触控屏幕上的“轨迹”来演奏。',
  '',
  '---',
  '',
  '## 关于作品',
  '',
  '本作品为 PNDS 工程。',
].join('\n')

/** The happy-path assertions need a parsed page, not `page!`. */
function parseOrThrow(markdown: string): ReadmeCoverPage {
  const page = parseReadmeCoverPage(markdown)
  if (page === null) throw new Error('expected the cover format')
  return page
}

/**
 * v1.5.0 (README cover page): the parser behind the panel — the
 * canonical format round-trips, every field has a documented fallback,
 * and anything that is not the format is a clean null so the panel
 * falls back to the legacy document view.
 */
describe('parseReadmeCoverPage', () => {
  it('parses the canonical format', () => {
    const page = parseOrThrow(CANONICAL)

    expect(page.title).toBe('失语 III')
    expect(page.composer).toBe('@肖翔')
    expect(page.composerUrl).toBe('https://arthur.example')
    expect(page.githubUrl).toBe('https://github.com/user/repo')
    expect(page.palette).toEqual(['#000000', '#c9d8b6', '#f1ecc3', '#57837b'])
    expect(page.sectionLabel).toBe('作品简介：')
    // The wrapped lines stay one markdown paragraph; the --- and the
    // boilerplate section behind it never reach the band.
    expect(page.sectionMarkdown).toBe(
      '失语III 是为三个手机演奏者而作的数字乐谱作品。\n演奏者通过手机触控屏幕上的“轨迹”来演奏。'
    )
  })

  it('falls back to the H1 when the metadata title is missing or blank', () => {
    const noTitle = CANONICAL.replace('title: 失语 III\n', '')
    expect(parseOrThrow(noTitle).title).toBe('失语 III')

    const blankTitle = CANONICAL.replace('title: 失语 III', 'title:')
    expect(parseOrThrow(blankTitle).title).toBe('失语 III')
  })

  it('is not the cover format without a metadata block (legacy docs)', () => {
    const legacy = [
      '# Night Sky',
      '',
      'Two acts, one intermission.',
      '',
      '## How to perform',
      '',
      'Tap to advance.',
    ].join('\n')
    expect(parseReadmeCoverPage(legacy)).toBeNull()
  })

  it('is not the cover format when metadata has no first section', () => {
    expect(parseReadmeCoverPage('title: 泼墨\n\nJust prose.')).toBeNull()
  })

  it('is not the cover format without any resolvable title', () => {
    const titleless = CANONICAL.replace('# 失语 III\n', '').replace(
      'title: 失语 III\n',
      ''
    )
    expect(parseReadmeCoverPage(titleless)).toBeNull()
  })

  it('ends the section at the next heading when no --- intervenes', () => {
    const noBreak = CANONICAL.replace('\n---\n', '\n')
    expect(noBreak).not.toContain('---')
    const page = parseOrThrow(noBreak)

    expect(page.sectionMarkdown).not.toContain('关于作品')
    expect(page.sectionMarkdown).not.toContain('PNDS 工程')
  })

  it('accepts metadata keys case-insensitively', () => {
    const page = parseOrThrow(
      CANONICAL.replace('title:', 'Title:').replace('composer:', 'Composer:')
    )
    expect(page.title).toBe('失语 III')
    expect(page.composer).toBe('@肖翔')
  })

  it('hides the pill when composer is absent or blank', () => {
    expect(
      parseOrThrow(CANONICAL.replace('composer: @肖翔\n', '')).composer
    ).toBeNull()
    expect(
      parseOrThrow(CANONICAL.replace('composer: @肖翔', 'composer:')).composer
    ).toBeNull()
  })

  it('drops link metadata that is not an http(s) URL', () => {
    const hostile = parseOrThrow(
      CANONICAL.replace(
        'composer_url: https://arthur.example',
        'composer_url: javascript:alert(1)'
      ).replace(
        'github_url: https://github.com/user/repo',
        'github_url: ftp://nope.example'
      )
    )
    expect(hostile.composerUrl).toBeNull()
    expect(hostile.githubUrl).toBeNull()

    const absent = parseOrThrow(
      CANONICAL.replace('composer_url: https://arthur.example\n', '').replace(
        'github_url: https://github.com/user/repo\n',
        ''
      )
    )
    expect(absent.composerUrl).toBeNull()
    expect(absent.githubUrl).toBeNull()
  })

  it('keeps the first four valid hexes, lowercased', () => {
    const page = parseOrThrow(
      CANONICAL.replace(
        'color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]',
        'color_palette: [#ABCDEF, #012345, #6789ab, #cdef01, #234567]'
      )
    )
    expect(page.palette).toEqual(['#abcdef', '#012345', '#6789ab', '#cdef01'])
  })

  it('falls back to the brand palette when fewer than four hexes are valid', () => {
    const sparse = parseOrThrow(
      CANONICAL.replace(
        'color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]',
        'color_palette: [#000000, not-a-color, #F1ECC3]'
      )
    )
    expect(sparse.palette).toEqual(DEFAULT_COVER_PALETTE)

    const absent = parseOrThrow(
      CANONICAL.replace(
        'color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]\n',
        ''
      )
    )
    expect(absent.palette).toEqual(DEFAULT_COVER_PALETTE)
  })
})

describe('parseReadmeCoverPage fences', () => {
  it('never treats fenced content as syntax', () => {
    const fenced = [
      '```markdown',
      '# not the h1',
      'title: fake',
      '## not the section',
      '---',
      '```',
      '',
      'title: 泼墨',
      'composer: @coco',
      '',
      '## 演奏说明：',
      '',
      '开头一段。',
      '',
      '```text',
      '## 也不是小节',
      '---',
      '```',
      '',
      '结尾一段。',
      '',
      '---',
      '',
      '## 关于作品',
    ].join('\n')

    const page = parseOrThrow(fenced)

    expect(page.title).toBe('泼墨')
    expect(page.composer).toBe('@coco')
    expect(page.sectionLabel).toBe('演奏说明：')
    // The inner fence (with its fake heading and break) survives as
    // body content; only the real --- ends the section.
    expect(page.sectionMarkdown).toContain('也不是小节')
    expect(page.sectionMarkdown).toContain('结尾一段。')
    expect(page.sectionMarkdown).not.toContain('关于作品')
  })
})
