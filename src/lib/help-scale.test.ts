import { describe, it, expect } from 'vitest'
import { buildHelpCorpus, type RawHelpDocument } from './help-corpus'
import { buildHelpIndex, searchHelp } from './help-search'

const rawFiles = import.meta.glob<string>('../../docs/zh-CN/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

/** Real shipped source; buildHelpCorpus validates and orders the registered set. */
function readRealCorpus(): RawHelpDocument[] {
  return Object.entries(rawFiles).map(([file, markdown]) => {
    const path = file.slice('../../docs/zh-CN/'.length)
    return {
      id: path.replace(/\.md$/, '').replaceAll('/', '-').toLowerCase(),
      path,
      markdown,
    }
  })
}

describe('help corpus at real scale (#53)', () => {
  const corpus = buildHelpCorpus(readRealCorpus())
  const index = buildHelpIndex(corpus)

  it('places every shipped document and derives its own title', () => {
    expect(corpus).toHaveLength(34)
    expect(corpus.slice(0, 4).map(doc => doc.title)).toEqual([
      'PNDS App 使用教程',
      'PNDS 创作指南',
      '给工程写 README',
      'PNDS 参考手册',
    ])
    expect(corpus.find(doc => doc.id === 'modules-readme')?.title).toBe(
      '模块手册'
    )
    for (const document of corpus) {
      expect(document.title).not.toBe(document.id)
      expect(document.sections.length).toBeGreaterThan(0)
    }
  })

  it('indexes the full corpus in milliseconds', () => {
    const startedAt = performance.now()
    buildHelpIndex(buildHelpCorpus(readRealCorpus()))
    const elapsed = performance.now() - startedAt

    // Generous ceiling on purpose: the criterion is "milliseconds", not
    // a number to defend — the guard catches accidental O(n²) blowups.
    expect(elapsed).toBeLessThan(100)
  })

  it('answers real queries against the real corpus', () => {
    const manifestHits = searchHelp(index, 'performerPort')
    expect(manifestHits.length).toBeGreaterThan(0)
    expect(manifestHits.some(hit => hit.docId === 'reference-manifest')).toBe(
      true
    )

    const lanHits = searchHelp(index, '局域网')
    expect(lanHits.length).toBeGreaterThan(0)
    expect(lanHits[0]?.snippet.length ?? 0).toBeGreaterThan(0)
  })

  it('keeps the corpus inside the anchor-parity assumptions', () => {
    // splitSections reads ATX headings at column 0 only; rehype-slug
    // would also id setext headings and indented ATX, silently breaking
    // the anchor contract on any heading written that way. The corpus is
    // authored ATX-only — this pins that fact to the real files, so a
    // style drift fails here instead of dead-ending search jumps.
    for (const { id, markdown } of readRealCorpus()) {
      let inFence = false
      let previousWasText = false
      for (const line of markdown.split(/\r?\n/)) {
        if (/^( {0,3})(`{3,}|~{3,})/.test(line)) {
          inFence = !inFence
          previousWasText = false
          continue
        }
        if (!inFence) {
          if (/^ {1,6}#{1,6} /.test(line)) {
            throw new Error(
              `${id}: indented ATX heading breaks anchor parity: "${line}"`
            )
          }
          if (previousWasText && /^(=+|-+)\s*$/.test(line)) {
            throw new Error(
              `${id}: setext heading breaks anchor parity: "${line}"`
            )
          }
        }
        previousWasText = line.trim() !== ''
      }
    }
  })
})
