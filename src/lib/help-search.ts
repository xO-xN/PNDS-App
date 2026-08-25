import type { HelpDocument } from './help-corpus'

/**
 * v1.3.0 (#53): the help center's in-memory full-text search. The index
 * is a flat list of the corpus's sections with pre-lowercased title and
 * body text — built once when the help window opens (milliseconds at the
 * corpus's scale), then `searchHelp` re-runs as a pure function on every
 * keystroke. Matching is case-insensitive SUBSTRING over plain text
 * (Chinese has no word boundaries to split on), and relevance is
 * hand-weighted, not learned: a document-title hit says the most about
 * intent and lands on the document's opening section, a section heading
 * next, then body frequency (capped, so one term repeated everywhere
 * cannot drown the ranking), plus a bonus when a section covers every
 * term of a multi-word query.
 */

/** One search result: where to jump and what to show in the hit list. */
export interface HelpSearchHit {
  docId: string
  docTitle: string
  /** The section's anchor id — the help window scrolls to this heading. */
  sectionId: string
  sectionTitle: string
  /** Plain-text context around the first match (… at cut edges). */
  snippet: string
}

interface HelpIndexEntry {
  docId: string
  docTitle: string
  sectionId: string
  sectionTitle: string
  /** Original-case body text — snippets quote it verbatim. */
  text: string
  docTitleLower: string
  sectionTitleLower: string
  textLower: string
  /**
   * The document's title (h1) section. Doc-title weight applies only
   * here: a title match lands the reader on the document's opening,
   * instead of flooding the hit list with every section of the doc.
   */
  isDocTitleSection: boolean
}

export interface HelpIndex {
  entries: readonly HelpIndexEntry[]
}

const DOC_TITLE_WEIGHT = 50
const SECTION_TITLE_WEIGHT = 20
const BODY_WEIGHT = 3
/** Body-frequency cap: repeated hits stop adding weight past this. */
const BODY_COUNT_CAP = 10
/** Boost for a section matching every term of a multi-term query. */
const ALL_TERMS_BONUS = 30
/** Characters of context on each side of a snippet's match. */
const SNIPPET_RADIUS = 40

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let at = haystack.indexOf(needle)
  while (at !== -1) {
    count += 1
    at = haystack.indexOf(needle, at + needle.length)
  }
  return count
}

/**
 * Flattens the corpus into the searchable section list, in corpus order
 * (the tie-break for equally-scored hits).
 */
export function buildHelpIndex(corpus: readonly HelpDocument[]): HelpIndex {
  const entries: HelpIndexEntry[] = []
  for (const document of corpus) {
    const docTitleLower = document.title.toLowerCase()
    let firstSection = true
    for (const section of document.sections) {
      entries.push({
        docId: document.id,
        docTitle: document.title,
        sectionId: section.id,
        sectionTitle: section.title,
        text: section.text,
        docTitleLower,
        sectionTitleLower: section.title.toLowerCase(),
        textLower: section.text.toLowerCase(),
        isDocTitleSection: firstSection && section.level === 1,
      })
      firstSection = false
    }
  }
  return { entries }
}

function buildSnippet(entry: HelpIndexEntry, terms: readonly string[]): string {
  const text = entry.text
  if (text === '') return ''

  let matchAt = -1
  for (const term of terms) {
    const at = entry.textLower.indexOf(term)
    if (at !== -1 && (matchAt === -1 || at < matchAt)) matchAt = at
  }

  if (matchAt === -1) {
    // Title-only hit: open with the section's own lead instead.
    const lead = text.slice(0, SNIPPET_RADIUS * 2)
    return lead.length < text.length ? `${lead}…` : lead
  }

  const start = Math.max(0, matchAt - SNIPPET_RADIUS)
  const end = Math.min(text.length, matchAt + SNIPPET_RADIUS)
  const window = text.slice(start, end)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return `${prefix}${window}${suffix}`
}

/**
 * The pure search seam: (index, query) → hits ranked by relevance.
 * Whitespace-separated terms, case-insensitive; a section surfaces when
 * any term matches it, and equal scores keep corpus order (stable sort).
 */
export function searchHelp(index: HelpIndex, query: string): HelpSearchHit[] {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .filter(term => term !== '')
    ),
  ]
  if (terms.length === 0) return []

  const scored: { entry: HelpIndexEntry; score: number }[] = []
  for (const entry of index.entries) {
    let score = 0
    let matchedTerms = 0
    for (const term of terms) {
      const docTitleHits = entry.isDocTitleSection
        ? countOccurrences(entry.docTitleLower, term)
        : 0
      const termScore =
        docTitleHits * DOC_TITLE_WEIGHT +
        countOccurrences(entry.sectionTitleLower, term) * SECTION_TITLE_WEIGHT +
        Math.min(countOccurrences(entry.textLower, term), BODY_COUNT_CAP) *
          BODY_WEIGHT
      if (termScore > 0) matchedTerms += 1
      score += termScore
    }
    if (matchedTerms === 0) continue
    if (matchedTerms === terms.length) score += ALL_TERMS_BONUS
    scored.push({ entry, score })
  }

  scored.sort((a, b) => b.score - a.score)

  return scored.map(({ entry }) => ({
    docId: entry.docId,
    docTitle: entry.docTitle,
    sectionId: entry.sectionId,
    sectionTitle: entry.sectionTitle,
    snippet: buildSnippet(entry, terms),
  }))
}
