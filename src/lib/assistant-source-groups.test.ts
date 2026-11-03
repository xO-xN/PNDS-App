import { expect, it } from 'vitest'
import {
  boundedAssistantSources,
  consultedDocumentCount,
  groupDocumentSources,
} from './assistant-source-groups'
import type { AssistantSource } from './assistant-types'
import { materialPageSource } from './assistant-materials'
import { selectAssistantContext } from './assistant-context'
import type { AssistantMessage } from './assistant-types'

function materialSource(id: string, version: string, offset = 0) {
  return materialPageSource(
    {
      material: {
        id,
        version,
        name: 'Design.txt',
        size: 200,
        totalCharacters: 200,
      },
      text: 'Exact saved material range.',
      offset,
      endOffset: offset + 27,
      totalCharacters: 200,
      nextOffset: offset + 27,
      startLine: 1,
      endLine: 1,
    },
    'en'
  )
}

function projectSources(count: number): AssistantSource[] {
  return Array.from({ length: count }, (_, index) => ({
    locale: 'en',
    docId: 'score.js',
    sectionId: `L${index + 1}`,
    title: `score.js:${index + 1}`,
    version: 'saved-version',
    format: 'plainText',
    offset: index * 100,
    endOffset: index * 100 + 100,
    project: {
      path: 'score.js',
      version: 'saved-version',
      text: 'Saved project range.',
      offset: index * 100,
      endOffset: index * 100 + 100,
      totalCharacters: count * 100,
      nextOffset: index === count - 1 ? null : index * 100 + 100,
      startLine: index + 1,
      endLine: index + 1,
    },
  }))
}

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

it('retains old material provenance after more than 256 newer project receipts', () => {
  const material = materialSource('a'.repeat(32), 'b'.repeat(64))
  const projects = projectSources(300)
  const sources = [material, ...projects]
  const before = structuredClone(sources)
  const bounded = boundedAssistantSources(sources)
  expect(bounded).toHaveLength(256)
  expect(bounded[0]).toBe(material)
  expect(bounded.slice(1)).toEqual(projects.slice(-255))
  expect(bounded.at(-1)).toBe(projects.at(-1))
  expect(sources).toEqual(before)
  const history: AssistantMessage[] = [
    {
      id: 'user',
      role: 'user',
      text: 'Implement the design.',
      status: 'completed',
      scope: 'project',
      sources: [],
    },
    {
      id: 'reply',
      role: 'assistant',
      text: 'Implemented.',
      status: 'completed',
      scope: 'project',
      sources: bounded,
    },
  ]
  const project = {
    fingerprint: 'saved-project',
    files: [
      {
        path: 'score.js',
        version: 'saved-version',
        bytes: 30000,
        reason: null,
      },
    ],
  }
  const available = material.material?.material
  if (!available) throw new Error('Missing material fixture')
  expect(
    selectAssistantContext(history, undefined, project, [available]).recent
  ).toHaveLength(2)
  expect(
    selectAssistantContext(history, undefined, project, []).recent
  ).toHaveLength(0)
})

it('reserves the latest exact receipt per material identity and version', () => {
  const id = 'a'.repeat(32)
  const first = materialSource(id, 'b'.repeat(64))
  const latest = materialSource(id, 'b'.repeat(64), 50)
  const nextVersion = materialSource(id, 'c'.repeat(64))
  const other = materialSource('d'.repeat(32), 'b'.repeat(64))
  const bounded = boundedAssistantSources([
    first,
    latest,
    nextVersion,
    other,
    ...projectSources(300),
  ])
  expect(bounded).toHaveLength(256)
  expect(bounded.slice(0, 3)).toEqual([latest, nextVersion, other])
  expect(bounded[0]).toBe(latest)
  expect(bounded).not.toContain(first)
  expect(bounded[0]?.offset).toBe(50)
  expect(bounded[0]?.material?.material.version).toBe('b'.repeat(64))
})

it('keeps smaller collections and defensively bounds oversized material records', () => {
  const sources = projectSources(3)
  expect(boundedAssistantSources(sources)).toEqual(sources)
  expect(boundedAssistantSources(sources)[0]).toBe(sources[0])
  const materials = Array.from({ length: 300 }, (_, index) =>
    materialSource(index.toString(16).padStart(32, '0'), 'b'.repeat(64))
  )
  expect(boundedAssistantSources(materials)).toEqual(materials.slice(-256))
})
