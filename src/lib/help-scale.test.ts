import { describe, it, expect } from 'vitest'
import {
  buildHelpCorpus,
  HELP_BOOKS,
  type RawHelpDocument,
} from './help-corpus'
import { buildHelpIndex, searchHelp } from './help-search'

import appTutorial from '../../docs/app-tutorial.md?raw'
import templateGuide from '../../docs/template-guide.md?raw'
import referenceReadme from '../../docs/reference/README.md?raw'
import referenceDigitalScore from '../../docs/reference/digital-score.md?raw'
import referenceNetwork from '../../docs/reference/network.md?raw'
import referenceAudioModes from '../../docs/reference/audio-modes.md?raw'
import referenceRuntimeContract from '../../docs/reference/runtime-contract.md?raw'
import referenceStructure from '../../docs/reference/structure.md?raw'
import referenceManifest from '../../docs/reference/manifest.md?raw'
import referencePndsBundle from '../../docs/reference/pnds-bundle.md?raw'
import referenceSupercollider from '../../docs/reference/supercollider.md?raw'
import referenceOsc from '../../docs/reference/osc.md?raw'
import referenceP5js from '../../docs/reference/p5js.md?raw'

/**
 * v1.3.0 (#53): the real corpus, end to end, at full scale. The unit
 * seams run on fixtures; this one pulls the actual shipped docs/ files
 * (the same content the Rust command reads) and pins the acceptance
 * criteria that only hold at real scale: every document places, derives
 * a title, and the in-memory index builds in milliseconds — the help
 * window builds it when it opens, so it must never feel like loading.
 */

/** The shipped set, as raw text — one import per bundled document. */
const RAW_CORPUS: Record<string, string> = {
  'app-tutorial': appTutorial,
  'template-guide': templateGuide,
  'reference-readme': referenceReadme,
  'reference-digital-score': referenceDigitalScore,
  'reference-network': referenceNetwork,
  'reference-audio-modes': referenceAudioModes,
  'reference-runtime-contract': referenceRuntimeContract,
  'reference-structure': referenceStructure,
  'reference-manifest': referenceManifest,
  'reference-pnds-bundle': referencePndsBundle,
  'reference-supercollider': referenceSupercollider,
  'reference-osc': referenceOsc,
  'reference-p5js': referenceP5js,
}

/** id → docs/-relative path, mirroring the Rust-side document list. */
const DOC_PATHS: Record<string, string> = {
  'app-tutorial': 'app-tutorial.md',
  'template-guide': 'template-guide.md',
  'reference-readme': 'reference/README.md',
  'reference-digital-score': 'reference/digital-score.md',
  'reference-network': 'reference/network.md',
  'reference-audio-modes': 'reference/audio-modes.md',
  'reference-runtime-contract': 'reference/runtime-contract.md',
  'reference-structure': 'reference/structure.md',
  'reference-manifest': 'reference/manifest.md',
  'reference-pnds-bundle': 'reference/pnds-bundle.md',
  'reference-supercollider': 'reference/supercollider.md',
  'reference-osc': 'reference/osc.md',
  'reference-p5js': 'reference/p5js.md',
}

function readRealCorpus(): RawHelpDocument[] {
  return HELP_BOOKS.flatMap(book => [...book.documentIds]).map(id => {
    const markdown = RAW_CORPUS[id]
    const path = DOC_PATHS[id]
    if (markdown === undefined || path === undefined) {
      throw new Error(`no raw docs/ import wired for help document "${id}"`)
    }
    return { id, path, markdown }
  })
}

describe('help corpus at real scale (#53)', () => {
  const corpus = buildHelpCorpus(readRealCorpus())
  const index = buildHelpIndex(corpus)

  it('places every shipped document and derives its own title', () => {
    expect(corpus).toHaveLength(13)
    expect(corpus[0]?.title).toBe('PNDS App 使用教程')
    expect(corpus[1]?.title).toBe('PNDS Template 创作指南')
    expect(corpus[2]?.title).toBe('PNDS 参考手册')
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
