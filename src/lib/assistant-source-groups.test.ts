import { expect, it } from 'vitest'
import {
  consultedDocumentCount,
  groupDocumentSources,
} from './assistant-source-groups'
import type { AssistantSource } from './assistant-types'

it('groups ranges by document version and section without rewriting historical evidence', () => {
  const source: AssistantSource = {
    locale: 'en',
    docId: 'reference-manifest',
    sectionId: 'fields',
    title: 'Manifest · Fields',
    version: 'old',
    format: 'plainText',
    offset: 0,
    endOffset: 80,
  }
  const sources = [
    source,
    { ...source, format: 'markdown' as const, endOffset: 1200 },
    { ...source, sectionId: 'ports', title: 'Manifest · Ports' },
    { ...source, version: 'new' },
    { ...source, locale: 'zh-CN' as const },
  ]
  const before = structuredClone(sources)
  const groups = groupDocumentSources(sources)
  expect(consultedDocumentCount(sources)).toBe(3)
  expect(groups).toHaveLength(3)
  expect(groups[0]?.sections.map(ranges => ranges.length)).toEqual([2, 1])
  expect(sources).toEqual(before)
})
