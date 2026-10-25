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
  offset: number
  endOffset: number
  totalCharacters: number
  /** Markdown coordinates; directly accepted by read_help_section. */
  readTarget: {
    docId: string
    sectionId: string
    offset: number
    pageLength: number
  }
  markdownOffset: number
  markdownEndOffset: number
  markdownTotalCharacters: number
}

interface HelpIndexEntry {
  docId: string
  docTitle: string
  sectionId: string
  sectionTitle: string
  /** Original-case body text — snippets quote it verbatim. */
  text: string
  markdown: string
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
        markdown: section.markdown,
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

const QUESTION_WORDS = new Set(
  'what where which how why is are do does the a an i to of for and or in with between can my its please'.split(
    ' '
  )
)

function queryTerms(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(
      /有什么区别|有什么|为什么|是什么|什么是|如何|怎样|怎么|请问|哪些|什么|的区别/g,
      ' '
    )
  const words =
    normalized.match(/[a-z][a-z0-9_.-]*|[\p{Script=Han}]+|\d+/gu) ?? []
  const segmenter =
    typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('zh', { granularity: 'word' })
      : null
  return [
    ...new Set(
      words.flatMap(word => {
        if (QUESTION_WORDS.has(word)) return []
        if (!segmenter || !/\p{Script=Han}/u.test(word)) return [word]
        return [
          word,
          ...Array.from(segmenter.segment(word), part => part.segment).filter(
            part => part.length > 1
          ),
        ]
      })
    ),
  ]
}

/** Routing metadata only: definitions remain in the installed Markdown. */
function preferredSource(
  query: string
): { doc: string; section?: RegExp } | null {
  const q = query.toLowerCase()
  if (/setlist/.test(q))
    return {
      doc: 'app-tutorial',
      section: /移交整场演出|transfer-a-whole-performance/,
    }
  if (/cli/.test(q) && /check|diagnostic|检查|诊断/.test(q))
    return {
      doc: 'app-tutorial',
      section:
        /静态工程诊断|临时副本运行检查|static-project-diagnostics|controlled-saved-copy-checks/,
    }
  if (
    /工程版本|project versions?/.test(q) &&
    /切换|恢复|switch|restore/.test(q)
  )
    return { doc: 'app-tutorial', section: /切换与恢复|switch-and-restore/ }
  if (/supercollider/.test(q) && /打开|open/.test(q))
    return { doc: 'app-tutorial', section: /supercollider/ }
  if (/synthdef|scsyndef|sclang/.test(q))
    return { doc: 'reference-supercollider' }
  if (/outputchannels/.test(q)) return { doc: 'reference-manifest' }
  if (/bus/.test(q))
    return { doc: 'reference-runtime-contract', section: /^7-/ }
  if (/osc/.test(q)) return { doc: 'reference-osc' }
  if (/音频模式|audio modes?|internal|external|\bnone\b/.test(q))
    return { doc: 'reference-audio-modes' }
  if (
    /monitor|performer/.test(q) &&
    /keyboard|pointer|touch|键盘|指针|触摸/.test(q)
  )
    return { doc: 'reference-page-interaction' }
  if (/monitor/.test(q) && /sync|view|同步|视图/.test(q))
    return { doc: 'modules-monitor-state' }
  if (/monitor|performer/.test(q) && /区别|difference|是什么|what/.test(q))
    return { doc: 'reference-runtime-contract', section: /^1-/ }
  if (/monitor\s+performer/.test(q))
    return { doc: 'reference-runtime-contract', section: /^1-/ }
  if (/共享包|shared packages?/.test(q))
    return { doc: 'reference-structure', section: /app-/ }
  if (/\.pnds/.test(q)) return { doc: 'reference-pnds-bundle' }
  if (/https/.test(q)) return { doc: 'reference-https' }
  if (/blank|classic/.test(q))
    return { doc: 'template-guide', section: /blank/ }
  if (/讨论.*工作|discussion.*work/.test(q))
    return {
      doc: 'app-tutorial',
      section: /使用装机文档问答|asking-about-installed/,
    }
  return null
}

function markdownTarget(entry: HelpIndexEntry, terms: readonly string[]) {
  const markdown = entry.markdown
  const lower = markdown.toLowerCase()
  const matches = terms.map(term => lower.indexOf(term)).filter(at => at >= 0)
  const at = matches.length ? Math.min(...matches) : 0
  const safe = (offset: number) =>
    offset > 0 &&
    /[\uD800-\uDBFF]/.test(markdown[offset - 1] ?? '') &&
    /[\uDC00-\uDFFF]/.test(markdown[offset] ?? '')
      ? offset - 1
      : offset
  const markdownOffset = safe(Math.max(0, at - SNIPPET_RADIUS))
  const markdownEndOffset = safe(Math.min(markdown.length, at + SNIPPET_RADIUS))
  const paragraphStart = markdown.lastIndexOf('\n\n', at)
  const offset = safe(
    Math.max(0, paragraphStart < 0 ? 0 : paragraphStart + 2, at - 200)
  )
  const paragraphEnd = markdown.indexOf('\n\n', at)
  return {
    markdownOffset,
    markdownEndOffset,
    markdownTotalCharacters: markdown.length,
    readTarget: {
      docId: entry.docId,
      sectionId: entry.sectionId,
      offset,
      pageLength: Math.max(
        64,
        Math.min(
          1200,
          (paragraphEnd < 0 ? markdown.length : paragraphEnd) - offset
        )
      ),
    },
  }
}

function buildSnippet(
  entry: HelpIndexEntry,
  terms: readonly string[]
): Pick<HelpSearchHit, 'snippet' | 'offset' | 'endOffset' | 'totalCharacters'> {
  const text = entry.text
  if (text === '')
    return { snippet: '', offset: 0, endOffset: 0, totalCharacters: 0 }

  let matchAt = -1
  for (const term of terms) {
    const at = entry.textLower.indexOf(term)
    if (at !== -1 && (matchAt === -1 || at < matchAt)) matchAt = at
  }

  if (matchAt === -1) {
    // Title-only hit: open with the section's own lead instead.
    const lead = text.slice(0, SNIPPET_RADIUS * 2)
    return {
      snippet: lead.length < text.length ? `${lead}…` : lead,
      offset: 0,
      endOffset: lead.length,
      totalCharacters: text.length,
    }
  }

  const start = Math.max(0, matchAt - SNIPPET_RADIUS)
  const end = Math.min(text.length, matchAt + SNIPPET_RADIUS)
  const window = text.slice(start, end)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return {
    snippet: `${prefix}${window}${suffix}`,
    offset: start,
    endOffset: end,
    totalCharacters: text.length,
  }
}

/**
 * The pure search seam: (index, query) → hits ranked by relevance.
 * Normalized words and exact identifiers match case-insensitively. Nonempty
 * sections rank by lexical relevance and a bounded concept-route preference;
 * equal scores retain corpus order. Only identical Markdown bodies fold.
 */
export function searchHelp(index: HelpIndex, query: string): HelpSearchHit[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return []
  const preferred = preferredSource(query)

  const scored: { entry: HelpIndexEntry; score: number }[] = []
  for (const entry of index.entries) {
    if (!entry.text.trim()) continue
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
    if (
      preferred?.doc === entry.docId &&
      (!preferred.section || preferred.section.test(entry.sectionId))
    )
      score += 100
    scored.push({ entry, score })
  }

  scored.sort((a, b) => b.score - a.score)

  const seen = new Set<string>()
  return scored
    .filter(({ entry }) => {
      const text = entry.markdown.replace(/\s+/g, ' ').trim()
      if (seen.has(text)) return false
      seen.add(text)
      return true
    })
    .map(({ entry }) => ({
      docId: entry.docId,
      docTitle: entry.docTitle,
      sectionId: entry.sectionId,
      sectionTitle: entry.sectionTitle,
      ...buildSnippet(entry, terms),
      ...markdownTarget(entry, terms),
    }))
}
