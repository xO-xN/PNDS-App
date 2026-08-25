import { splitSections, type HelpSection } from './help-markdown'

/**
 * v1.3.0 (#53): the help corpus loader. The Rust `help_corpus` command
 * reads the three Chinese docs (使用教程 / 创作指南 / 参考手册) raw from
 * the app resources — `docs/*.md` in the repository is the ONLY source,
 * shipped verbatim with no build-time conversion — and hands over
 * { id, markdown } pairs. This module is the single place that knows the
 * corpus's shape: which documents exist, which book each belongs to, the
 * display order (the reference manual follows its own README index), and
 * each document's title (its own `#` heading).
 *
 * A mismatch between the shipped set and HELP_BOOKS fails loudly — the
 * help center must never silently hide a document it cannot place, nor
 * show one nobody assigned a home.
 */

/** The three entry points the Help menu opens; also the sidebar's books. */
export type HelpBookId = 'tutorial' | 'creator-guide' | 'reference'

/** One help document exactly as the `help_corpus` command ships it. */
export interface RawHelpDocument {
  id: string
  /** docs/-relative path — the link-resolution base (#56 user report). */
  path: string
  markdown: string
}

/** A placed, parsed help document — what the index and window consume. */
export interface HelpDocument {
  id: string
  book: HelpBookId
  /** Display title: the document's `#` heading, falling back to its id. */
  title: string
  /** docs/-relative path — the base the corpus's markdown links resolve from. */
  path: string
  markdown: string
  sections: HelpSection[]
}

/**
 * The corpus manifest, in display order. The reference manual lists its
 * pages in the order its own README index answers questions; the ids are
 * the stable contract with the Rust-side document list
 * (src-tauri/src/commands/help.rs) and the bundle resources
 * (tauri.conf.json → help/…).
 */
export const HELP_BOOKS: readonly {
  id: HelpBookId
  documentIds: readonly string[]
}[] = [
  { id: 'tutorial', documentIds: ['app-tutorial'] },
  { id: 'creator-guide', documentIds: ['template-guide'] },
  {
    id: 'reference',
    documentIds: [
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
  },
]

/**
 * Places and parses the shipped documents into the ordered corpus.
 * Throws when the shipped set and the manifest disagree — either side
 * drifting (a renamed doc file, an unlisted new page) is an authoring
 * error to fix, not a document to hide.
 */
export function buildHelpCorpus(
  raw: readonly RawHelpDocument[]
): HelpDocument[] {
  const byId = new Map(raw.map(doc => [doc.id, doc]))
  const expected = HELP_BOOKS.flatMap(book =>
    book.documentIds.map(id => ({ book, id }))
  )

  const missing = expected.filter(({ id }) => !byId.has(id))
  if (missing.length > 0) {
    throw new Error(
      `Help corpus is missing documents: ${missing.map(({ id }) => id).join(', ')}`
    )
  }

  const known = new Set(expected.map(({ id }) => id))
  const unknown = [...byId.keys()].filter(id => !known.has(id))
  if (unknown.length > 0) {
    throw new Error(
      `Help corpus carries documents outside the manifest: ${unknown.join(', ')}`
    )
  }

  return expected.map(({ book, id }) => {
    const { markdown, path } = byId.get(id) as RawHelpDocument
    const sections = splitSections(markdown)
    const titleSection = sections.find(
      section => section.level === 1 && section.title !== ''
    )
    return {
      id,
      book: book.id,
      title: titleSection?.title ?? id,
      path,
      markdown,
      sections,
    }
  })
}
