import type { HelpDocument, HelpTree } from './help-corpus'
import { buildHelpIndex, searchHelp, type HelpSearchHit } from './help-search'
import { AssistantFlowError, type AssistantSource } from './assistant-types'

export const DEFAULT_DOCUMENT_PAGE = 1200
export const MAX_DOCUMENT_PAGE = 2000
interface Range {
  offset: number
  endOffset: number
  toolCallId: string
}
interface Segment {
  offset: number
  endOffset: number
  markdown?: string
  text?: string
}

/** A request owns an immutable installed corpus. No private content or global
 * cache survives the request, language, app version or workspace generation. */
export class AssistantDocuments {
  private readonly index
  private readonly ranges = new Map<string, Range[]>()
  private readonly attempts = new Map<string, number>()
  private readonly searches = new Map<string, HelpSearchHit[]>()
  private readonly versions = new Map<string, string>()
  constructor(
    private readonly corpus: HelpDocument[],
    private readonly locale: HelpTree
  ) {
    this.index = buildHelpIndex(corpus)
  }

  private attempt(signature: string) {
    const count = (this.attempts.get(signature) ?? 0) + 1
    if (count > 2) throw new AssistantFlowError('noProgress')
    this.attempts.set(signature, count)
  }

  private range(
    docId: string,
    sectionId: string,
    format: 'markdown' | 'plainText',
    offset: number,
    endOffset: number,
    callId: string
  ) {
    const doc = this.corpus.find(doc => doc.id === docId)
    const section = doc?.sections.find(section => section.id === sectionId)
    if (!doc || !section) throw new AssistantFlowError('invalidTool')
    const text = format === 'markdown' ? section.markdown : section.text
    const version = doc.version ?? `${__APP_VERSION__}:unverified-fixture`
    const key = JSON.stringify([version, this.locale, docId, sectionId, format])
    const previous = this.ranges.get(key) ?? []
    const segments: Segment[] = []
    const reusedRanges: Range[] = []
    const sources: AssistantSource[] = []
    const append = (start: number, end: number) => {
      if (start === end) return
      segments.push({
        offset: start,
        endOffset: end,
        ...(format === 'markdown'
          ? { markdown: text.slice(start, end) }
          : { text: text.slice(start, end) }),
      })
      sources.push({
        docId,
        sectionId,
        title: `${doc.title} · ${section.title}`,
        locale: this.locale,
        version,
        offset: start,
        endOffset: end,
        totalCharacters: text.length,
        format,
      })
    }
    let cursor = offset
    for (const range of [...previous].sort((a, b) => a.offset - b.offset)) {
      if (range.endOffset <= cursor || range.offset >= endOffset) continue
      if (range.offset > cursor)
        append(cursor, Math.min(range.offset, endOffset))
      const start = Math.max(cursor, range.offset)
      const end = Math.min(endOffset, range.endOffset)
      if (start < end)
        reusedRanges.push({
          offset: start,
          endOffset: end,
          toolCallId: range.toolCallId,
        })
      cursor = Math.max(cursor, end)
    }
    if (cursor < endOffset) append(cursor, endOffset)
    this.ranges.set(key, [
      ...previous,
      ...segments.map(segment => ({
        offset: segment.offset,
        endOffset: segment.endOffset,
        toolCallId: callId,
      })),
    ])
    return {
      segments,
      reusedRanges,
      sources,
      version,
      returnedCharacters: segments.reduce(
        (sum, segment) => sum + segment.endOffset - segment.offset,
        0
      ),
      reusedCharacters: reusedRanges.reduce(
        (sum, range) => sum + range.endOffset - range.offset,
        0
      ),
    }
  }

  execute(name: string, args: Record<string, unknown>, callId: string) {
    const sources: AssistantSource[] = []
    let returnedCharacters = 0
    let reusedCharacters = 0
    let result: unknown
    const versions: Record<string, string> = {}
    const versionReferences: Record<string, string> = {}
    const announce = (docId: string, version: string) => {
      const key = JSON.stringify([this.locale, docId, version])
      const previous = this.versions.get(key)
      if (!previous) {
        this.versions.set(key, callId)
        versions[docId] = version
      } else if (previous !== callId) versionReferences[docId] = previous
    }
    const versionMetadata = () => ({
      ...(Object.keys(versions).length ? { versions } : {}),
      ...(Object.keys(versionReferences).length ? { versionReferences } : {}),
    })
    if (name === 'search_help') {
      if (
        Object.keys(args).length !== 1 ||
        typeof args.query !== 'string' ||
        !args.query.trim() ||
        args.query.length > 256
      )
        throw new AssistantFlowError('invalidTool')
      const signature = `search:${args.query.trim().toLowerCase()}`
      this.attempt(signature)
      const hits =
        this.searches.get(signature) ??
        searchHelp(this.index, args.query).slice(0, 3)
      this.searches.set(signature, hits)
      result = {
        locale: this.locale,
        offsetUnit: 'utf16CodeUnits',
        hits: hits.map(hit => {
          const range = this.range(
            hit.docId,
            hit.sectionId,
            'plainText',
            hit.offset,
            hit.endOffset,
            callId
          )
          announce(hit.docId, range.version)
          sources.push(...range.sources)
          returnedCharacters += range.returnedCharacters
          reusedCharacters += range.reusedCharacters
          return {
            docId: hit.docId,
            sectionId: hit.sectionId,
            title: hit.sectionTitle,
            offset: hit.offset,
            endOffset: hit.endOffset,
            totalCharacters: hit.totalCharacters,
            segments: range.segments,
            reusedRanges: range.reusedRanges,
            coverage: 'search-excerpt-only',
          }
        }),
        ...versionMetadata(),
      }
    } else if (name === 'read_help_section') {
      if (
        Object.keys(args).some(
          key => !['docId', 'sectionId', 'offset', 'pageLength'].includes(key)
        ) ||
        typeof args.docId !== 'string' ||
        typeof args.sectionId !== 'string'
      )
        throw new AssistantFlowError('invalidTool')
      const doc = this.corpus.find(doc => doc.id === args.docId)
      const section = doc?.sections.find(
        section => section.id === args.sectionId
      )
      const offset = args.offset ?? 0
      const pageLength = args.pageLength ?? DEFAULT_DOCUMENT_PAGE
      if (
        !doc ||
        !section ||
        typeof offset !== 'number' ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > section.markdown.length ||
        typeof pageLength !== 'number' ||
        !Number.isSafeInteger(pageLength) ||
        pageLength < 64 ||
        pageLength > MAX_DOCUMENT_PAGE
      )
        throw new AssistantFlowError('invalidTool')
      const bisects = (index: number) =>
        index > 0 &&
        /[\uD800-\uDBFF]/.test(section.markdown[index - 1] ?? '') &&
        /[\uDC00-\uDFFF]/.test(section.markdown[index] ?? '')
      if (bisects(offset)) throw new AssistantFlowError('invalidTool')
      let end = Math.min(offset + pageLength, section.markdown.length)
      if (bisects(end)) end--
      this.attempt(`read:${doc.id}:${section.id}:${offset}:${pageLength}`)
      const range = this.range(
        doc.id,
        section.id,
        'markdown',
        offset,
        end,
        callId
      )
      announce(doc.id, range.version)
      sources.push(...range.sources)
      returnedCharacters = range.returnedCharacters
      reusedCharacters = range.reusedCharacters
      result = {
        docId: doc.id,
        sectionId: section.id,
        title: section.title,
        locale: this.locale,
        ...versionMetadata(),
        offsetUnit: 'utf16CodeUnits',
        offset,
        endOffset: end,
        totalCharacters: section.markdown.length,
        nextOffset: end < section.markdown.length ? end : null,
        segments: range.segments,
        reusedRanges: range.reusedRanges,
        coverage: 'returned-ranges-only',
      }
    } else throw new AssistantFlowError('invalidTool')
    return {
      content: JSON.stringify(result),
      sources,
      returnedCharacters,
      reusedCharacters,
    }
  }
}
