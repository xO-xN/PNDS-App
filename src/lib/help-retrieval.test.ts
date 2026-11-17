import { describe, expect, it } from 'vitest'
import cases from '@/test/fixtures/help-retrieval-cases.json'
import { buildHelpCorpus, type HelpTree } from './help-corpus'
import { buildHelpIndex, searchHelp } from './help-search'
import { AssistantDocuments } from './assistant-documents'

const files = import.meta.glob<string>('../../docs/{zh-CN,en}/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

for (const locale of ['zh-CN', 'en'] as const satisfies readonly HelpTree[]) {
  const prefix = `../../docs/${locale}/`
  const corpus = buildHelpCorpus(
    Object.entries(files)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, markdown]) => ({
        path: path.slice(prefix.length),
        id: path
          .slice(prefix.length)
          .replace(/\.md$/, '')
          .replaceAll('/', '-')
          .toLowerCase(),
        markdown,
        version: 'retrieval-fixture',
      }))
  )
  const index = buildHelpIndex(corpus)
  describe(`installed ${locale} concept and task retrieval`, () => {
    for (const sample of cases)
      for (const query of sample.queries[locale]) {
        it(`${sample.id}: ${query}`, () => {
          const hits = searchHelp(index, query).slice(0, 3)
          expect(
            hits.some(
              hit =>
                hit.docId === sample.docId &&
                new RegExp(sample.section[locale]).test(hit.sectionId)
            )
          ).toBe(true)
          expect(hits.every(hit => hit.snippet.length > 0)).toBe(true)
        })
      }
    it('returns no invented evidence for absent concepts', () => {
      expect(
        searchHelp(
          index,
          locale === 'en'
            ? 'What is pnds_quantum_235_missing?'
            : '什么是 pnds_quantum_235_missing？'
        )
      ).toEqual([])
    })
    it('provides exact Markdown targets and reuses search evidence during reading', () => {
      const documents = new AssistantDocuments(corpus, locale)
      const search = documents.execute(
        'search_help',
        { query: 'outputChannels' },
        'search'
      )
      const result = JSON.parse(search.content)
      const hit = result.hits[0]
      const section = corpus
        .find(doc => doc.id === hit.docId)
        ?.sections.find(section => section.id === hit.sectionId)
      expect(section).toBeDefined()
      for (const segment of hit.segments)
        expect(segment.markdown).toBe(
          section?.markdown.slice(segment.offset, segment.endOffset)
        )
      const read = documents.execute(
        'read_help_section',
        hit.readTarget,
        'read'
      )
      expect(read.reusedCharacters).toBeGreaterThan(0)
      for (const segment of JSON.parse(read.content).segments)
        expect(segment.markdown).toBe(
          section?.markdown.slice(segment.offset, segment.endOffset)
        )
      expect(search.sources.every(source => source.format === 'markdown')).toBe(
        true
      )
    })
  })
}
