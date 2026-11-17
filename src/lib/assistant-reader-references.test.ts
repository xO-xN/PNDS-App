import { describe, expect, it } from 'vitest'
import { AssistantDocuments } from './assistant-documents'
import { AssistantMaterialTools } from './assistant-materials'
import { AssistantProjectTools } from './assistant-project'
import { AssistantReadEvidence } from './assistant-reading-evidence'
import type { AssistantSource } from './assistant-types'
import type { AssistantProjectPage } from './tauri-bindings'
import type { HelpDocument } from './help-corpus'

function page(path = 'main.js'): AssistantProjectPage {
  return {
    path,
    version: 'saved-v1',
    text: 'const value = 1',
    offset: 0,
    endOffset: 15,
    totalCharacters: 15,
    nextOffset: null,
    startLine: 1,
    endLine: 1,
  }
}

const material = {
  id: 'a'.repeat(32),
  version: 'b'.repeat(64),
  name: 'Reference.js',
  size: 15,
  totalCharacters: 15,
}

const helpText = 'outputChannels selects the actual audio output. '.repeat(8)
const corpus: HelpDocument[] = [
  {
    id: 'reference-audio-modes',
    book: 'reference',
    path: 'reference/audio-modes.md',
    title: 'Audio modes',
    markdown: helpText,
    version: 'help-v1',
    sections: [
      {
        id: 'channels',
        title: 'Output channels',
        level: 2,
        text: helpText,
        markdown: helpText,
      },
    ],
  },
]

function admit(
  evidence: AssistantReadEvidence,
  sources: readonly AssistantSource[],
  toolCallId: string
) {
  evidence.record({
    sources,
    carrier: { kind: 'toolResult', toolCallId },
  })
}

describe('reader references admitted to the current packet', () => {
  it('isolates checkpoint help references from later reads and context replacement', () => {
    const evidence = new AssistantReadEvidence()
    const documents = new AssistantDocuments(corpus, 'en', evidence)
    const args = {
      docId: corpus[0]?.id,
      sectionId: 'channels',
      pageLength: 64,
    }
    const read = documents.execute('read_help_section', args, 'initial')
    evidence.record({
      sources: read.sources,
      helpReads: read.helpReads,
      carrier: { kind: 'toolResult', toolCallId: 'initial' },
    })
    const savedEvidence = new AssistantReadEvidence(evidence.view())
    const savedDocuments = documents.fork(savedEvidence)

    const later = documents.execute(
      'read_help_section',
      { ...args, offset: 64 },
      'later'
    )
    evidence.record({
      sources: later.sources,
      helpReads: later.helpReads,
      carrier: { kind: 'toolResult', toolCallId: 'later' },
    })
    evidence.replaceContext({ kind: 'packetReplaced' })
    expect(
      documents.execute('read_help_section', args, 'resent').returnedCharacters
    ).toBe(64)

    const savedRead = savedDocuments.execute('read_help_section', args, 'saved')
    expect(savedRead.reusedCharacters).toBe(64)
    expect(JSON.parse(savedRead.content).reusedRanges).toEqual([
      { offset: 0, endOffset: 64, toolCallId: 'initial' },
    ])
    expect(JSON.parse(savedRead.content).versionReferences).toEqual({
      'reference-audio-modes': 'initial',
    })
    const omitted = savedDocuments.execute(
      'read_help_section',
      { ...args, offset: 64 },
      'omitted'
    )
    expect(omitted.returnedCharacters).toBe(64)
    expect(omitted.reusedCharacters).toBe(0)
    expect(savedEvidence.view().references.hasToolResult('later')).toBe(false)
  })

  it('copies help read and search attempt budgets without sharing later increments', () => {
    const evidence = new AssistantReadEvidence()
    const documents = new AssistantDocuments(corpus, 'en', evidence)
    const args = {
      docId: corpus[0]?.id,
      sectionId: 'channels',
      pageLength: 64,
    }
    documents.execute('read_help_section', args, 'first-read')
    documents.execute(
      'search_help',
      { query: 'outputChannels' },
      'first-search'
    )
    const saved = documents.fork(new AssistantReadEvidence(evidence.view()))
    for (const reader of [documents, saved]) {
      expect(() =>
        reader.execute('read_help_section', args, 'second-read')
      ).not.toThrow()
      expect(() =>
        reader.execute(
          'search_help',
          { query: 'outputChannels' },
          'second-search'
        )
      ).not.toThrow()
      expect(() =>
        reader.execute('read_help_section', args, 'third-read')
      ).toThrow(expect.objectContaining({ code: 'noProgress' }))
      expect(() =>
        reader.execute(
          'search_help',
          { query: 'outputChannels' },
          'third-search'
        )
      ).toThrow(expect.objectContaining({ code: 'noProgress' }))
    }
  })

  it('isolates checkpoint project references from later reads and context replacement', async () => {
    const evidence = new AssistantReadEvidence()
    const tools = new AssistantProjectTools(
      'owner',
      {
        fingerprint: 'scope',
        files: ['initial.js', 'later.js'].map(path => ({
          path,
          version: 'saved-v1',
          bytes: 15,
          reason: null,
        })),
      },
      'en',
      { readProject: async (_, read) => page(read.path) },
      evidence
    )
    const initial = await tools.execute(
      'read_project_text',
      { path: 'initial.js' },
      'initial'
    )
    admit(evidence, initial.sources, 'initial')
    const savedEvidence = new AssistantReadEvidence(evidence.view())
    const savedTools = tools.fork(savedEvidence)
    const later = await tools.execute(
      'read_project_text',
      { path: 'later.js' },
      'later'
    )
    admit(evidence, later.sources, 'later')
    evidence.replaceContext({ kind: 'packetReplaced' })
    expect(
      (
        await tools.execute(
          'read_project_text',
          { path: 'initial.js' },
          'resent'
        )
      ).returnedCharacters
    ).toBe(15)
    const saved = await savedTools.execute(
      'read_project_text',
      { path: 'initial.js' },
      'saved'
    )
    expect(saved.reusedCharacters).toBe(15)
    expect(JSON.parse(saved.content).segments[0].reusedFrom).toBe('initial')
    const omitted = await savedTools.execute(
      'read_project_text',
      { path: 'later.js' },
      'omitted'
    )
    expect(omitted.returnedCharacters).toBe(15)
    expect(omitted.reusedCharacters).toBe(0)
  })

  it('copies the project distinct-file budget without sharing later paths', async () => {
    const evidence = new AssistantReadEvidence()
    const paths = Array.from({ length: 34 }, (_, index) => `${index}.js`)
    const tools = new AssistantProjectTools(
      'owner',
      {
        fingerprint: 'scope',
        files: paths.map(path => ({
          path,
          version: 'saved-v1',
          bytes: 15,
          reason: null,
        })),
      },
      'en',
      { readProject: async (_, read) => page(read.path) },
      evidence
    )
    for (const path of paths.slice(0, 31))
      await tools.execute('read_project_text', { path }, path)
    const saved = tools.fork(new AssistantReadEvidence(evidence.view()))
    await tools.execute('read_project_text', { path: paths[31] }, 'active-last')
    await saved.execute('read_project_text', { path: paths[32] }, 'saved-last')
    for (const reader of [tools, saved])
      await expect(
        reader.execute('read_project_text', { path: paths[33] }, 'over-budget')
      ).rejects.toMatchObject({ code: 'budgetExceeded' })
  })

  it('resends project text until admission and after packet replacement', async () => {
    const evidence = new AssistantReadEvidence()
    const tools = new AssistantProjectTools(
      'owner',
      {
        fingerprint: 'scope',
        files: [
          { path: 'main.js', version: 'saved-v1', bytes: 15, reason: null },
        ],
      },
      'en',
      { readProject: async () => page() },
      evidence
    )
    const args = { path: 'main.js' }
    await tools.execute('read_project_text', args, 'not-admitted')
    expect(evidence.view().references.hasToolResult('not-admitted')).toBe(false)
    const admitted = await tools.execute('read_project_text', args, 'read')
    expect(JSON.parse(admitted.content).segments).toEqual([page()])
    expect(admitted.returnedCharacters).toBe(15)
    admit(evidence, admitted.sources, 'read')

    const repeated = await tools.execute('read_project_text', args, 'repeat')
    expect(JSON.parse(repeated.content).segments[0]).toMatchObject({
      reusedFrom: 'read',
    })
    expect(repeated.returnedCharacters).toBe(0)
    expect(repeated.reusedCharacters).toBe(15)
    expect(repeated.sources[0]?.project?.text).toBe(page().text)

    evidence.replaceContext({ kind: 'packetReplaced' })
    const resent = await tools.execute('read_project_text', args, 'resent')
    expect(JSON.parse(resent.content).segments).toEqual([page()])
    expect(resent.returnedCharacters).toBe(15)
    expect(resent.reusedCharacters).toBe(0)
  })

  it('keeps the distinct-file budget across reference generations', async () => {
    const evidence = new AssistantReadEvidence()
    const paths = Array.from({ length: 33 }, (_, index) => `${index}.js`)
    const tools = new AssistantProjectTools(
      'owner',
      {
        fingerprint: 'scope',
        files: paths.map(path => ({
          path,
          version: 'saved-v1',
          bytes: 15,
          reason: null,
        })),
      },
      'en',
      { readProject: async (_, read) => page(read.path) },
      evidence
    )
    for (const path of paths.slice(0, 32)) {
      await tools.execute('read_project_text', { path }, path)
      evidence.replaceContext({ kind: 'packetReplaced' })
    }
    await expect(
      tools.execute('read_project_text', { path: paths[32] }, 'over-budget')
    ).rejects.toMatchObject({ code: 'budgetExceeded' })
  })

  it('resends material text and retains its version dependency after replacement', async () => {
    const evidence = new AssistantReadEvidence()
    let present = true
    const tools = new AssistantMaterialTools(
      'owner',
      'en',
      {
        listMaterials: async () => (present ? [material] : []),
        readMaterial: async () => {
          const range = page()
          return {
            material,
            text: range.text,
            offset: range.offset,
            endOffset: range.endOffset,
            totalCharacters: range.totalCharacters,
            nextOffset: range.nextOffset,
            startLine: range.startLine,
            endLine: range.endLine,
          }
        },
      },
      [],
      evidence
    )
    const args = { id: material.id, version: material.version }
    await tools.execute('read_creation_material', args, 'not-admitted')
    expect(evidence.view().references.hasToolResult('not-admitted')).toBe(false)
    const admitted = await tools.execute('read_creation_material', args, 'read')
    expect(JSON.parse(admitted.content).segments[0].text).toBe(page().text)
    admit(evidence, admitted.sources, 'read')
    const repeated = await tools.execute(
      'read_creation_material',
      args,
      'repeat'
    )
    expect(JSON.parse(repeated.content).segments[0]).toMatchObject({
      reusedFrom: 'read',
    })
    expect(repeated.returnedCharacters).toBe(0)
    expect(repeated.reusedCharacters).toBe(15)

    evidence.replaceContext({ kind: 'scopeRecovered' })
    const resent = await tools.execute('read_creation_material', args, 'resent')
    expect(JSON.parse(resent.content).segments[0].text).toBe(page().text)
    expect(JSON.parse(resent.content).segments[0]).not.toHaveProperty(
      'reusedFrom'
    )
    expect(resent.returnedCharacters).toBe(15)
    expect(tools.used).toEqual([{ id: material.id, version: material.version }])
    present = false
    await expect(tools.validate()).rejects.toMatchObject({
      code: 'projectScopeChanged',
    })
  })

  it('returns exact help bodies separately and gates range and version references', () => {
    const evidence = new AssistantReadEvidence()
    const documents = new AssistantDocuments(corpus, 'en', evidence)
    const args = {
      docId: corpus[0]?.id,
      sectionId: 'channels',
      pageLength: 64,
    }
    documents.execute('read_help_section', args, 'not-admitted')
    expect(evidence.view().references.hasToolResult('not-admitted')).toBe(false)
    const admitted = documents.execute('read_help_section', args, 'read')
    expect(admitted.returnedCharacters).toBe(64)
    expect(admitted.reusedCharacters).toBe(0)
    expect(JSON.parse(admitted.content).versions).toEqual({
      'reference-audio-modes': 'help-v1',
    })
    expect(admitted.helpReads).toEqual([
      { source: admitted.sources[0], text: helpText.slice(0, 64) },
    ])
    expect(admitted.sources[0]).not.toHaveProperty('text')
    evidence.record({
      sources: admitted.sources,
      helpReads: admitted.helpReads,
      carrier: { kind: 'toolResult', toolCallId: 'read' },
    })
    const repeated = documents.execute(
      'read_help_section',
      { ...args, offset: 1 },
      'repeat'
    )
    expect(repeated.reusedCharacters).toBe(63)
    expect(repeated.returnedCharacters).toBe(1)
    expect(JSON.parse(repeated.content).reusedRanges).toEqual([
      { offset: 1, endOffset: 64, toolCallId: 'read' },
    ])
    expect(JSON.parse(repeated.content).versionReferences).toEqual({
      'reference-audio-modes': 'read',
    })
    expect(repeated.helpReads.map(read => read.text)).toEqual([
      helpText.slice(64, 65),
    ])

    evidence.replaceContext({ kind: 'packetReplaced' })
    const resent = documents.execute('read_help_section', args, 'resent')
    expect(resent.returnedCharacters).toBe(64)
    expect(resent.reusedCharacters).toBe(0)
    expect(JSON.parse(resent.content)).not.toHaveProperty('versionReferences')
    expect(JSON.parse(resent.content).reusedRanges).toEqual([])
  })

  it('keeps search-attempt limits while resetting help read attempts', () => {
    const evidence = new AssistantReadEvidence()
    const documents = new AssistantDocuments(corpus, 'en', evidence)
    documents.execute('search_help', { query: 'outputChannels' }, 'search-1')
    documents.execute('search_help', { query: 'outputChannels' }, 'search-2')
    evidence.replaceContext({ kind: 'packetReplaced' })
    expect(() =>
      documents.execute('search_help', { query: 'outputChannels' }, 'search-3')
    ).toThrow(expect.objectContaining({ code: 'noProgress' }))
  })
})
