import { describe, expect, it } from 'vitest'
import {
  AssistantReadEvidence,
  assistantSourceKey,
  readingCoverage,
  readPacket,
} from './assistant-reading-evidence'
import type { AssistantSource, AssistantWireMessage } from './assistant-types'

function saved(
  text: string,
  offset = 0,
  totalCharacters = offset + text.length,
  options: Partial<NonNullable<AssistantSource['project']>> = {}
): AssistantSource {
  const page = {
    path: 'score.js',
    version: 'v1',
    text,
    offset,
    endOffset: offset + text.length,
    totalCharacters,
    nextOffset:
      offset + text.length < totalCharacters ? offset + text.length : null,
    startLine: 1,
    endLine: 1,
    ...options,
  }
  return {
    docId: page.path,
    sectionId: `L${page.startLine}`,
    title: page.path,
    locale: 'en',
    version: page.version,
    offset: page.offset,
    endOffset: page.endOffset,
    totalCharacters: page.totalCharacters,
    format: 'plainText',
    project: page,
  }
}

function material(text: string, offset = 0, total = offset + text.length) {
  const id = 'a'.repeat(32)
  const version = 'b'.repeat(64)
  return {
    docId: id,
    sectionId: 'L1',
    title: 'Rules.txt',
    locale: 'en',
    version,
    offset,
    endOffset: offset + text.length,
    totalCharacters: total,
    format: 'plainText',
    material: {
      material: {
        id,
        version,
        name: 'Rules.txt',
        size: total,
        totalCharacters: total,
      },
      text,
      offset,
      endOffset: offset + text.length,
      totalCharacters: total,
      nextOffset: offset + text.length < total ? offset + text.length : null,
      startLine: 1,
      endLine: 1,
    },
  } satisfies AssistantSource
}

function help(offset = 0, endOffset = 2): AssistantSource {
  return {
    docId: 'reference-manifest',
    sectionId: 'fields',
    title: 'Manifest · Fields',
    locale: 'en',
    version: 'help-v1',
    offset,
    endOffset,
    totalCharacters: 4,
    format: 'markdown',
  }
}

function tool(value: unknown, id = 'read-1'): AssistantWireMessage {
  return {
    role: 'tool',
    toolCallId: id,
    contextKind: 'projectFragment',
    content: JSON.stringify(value),
  }
}

describe('retained actual reading evidence', () => {
  it('assembles out-of-order adjacent pages and consistent overlaps exactly once', () => {
    const evidence = new AssistantReadEvidence([saved('cdef', 2, 6)])
    expect(evidence.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'incomplete',
      reason: 'gap',
      ranges: [{ offset: 2, endOffset: 6 }],
    })
    evidence.record({ sources: [saved('abc', 0, 6), saved('bcde', 1, 6)] })
    evidence.record({ sources: [saved('abc', 0, 6)] })
    expect(evidence.view().savedText('score.js', 'v1')).toEqual({
      status: 'complete',
      text: 'abcdef',
      totalCharacters: 6,
    })
    expect(evidence.view().sources).toHaveLength(3)
    expect(evidence.view().coverage).toEqual([
      expect.objectContaining({ offset: 0, endOffset: 6, totalCharacters: 6 }),
    ])
  })

  it.each([
    {
      sources: [saved('ab', 0, 6), saved('ef', 4, 6)],
      reason: 'gap',
    },
    {
      sources: [saved('ab', 0, 2), saved('c', 2, 3)],
      reason: 'inconsistentTotal',
    },
    {
      sources: [saved('abc', 0, 4), saved('Xd', 2, 4)],
      reason: 'conflictingOverlap',
    },
    {
      sources: [saved('abcd', 0, 4, { endOffset: 3 })],
      reason: 'invalidRange',
    },
  ])('does not prove full text from $reason', ({ sources, reason }) => {
    expect(
      new AssistantReadEvidence(sources).view().savedText('score.js', 'v1')
    ).toMatchObject({
      status: 'incomplete',
      reason,
    })
  })

  it('preserves same-key conflicting bodies in V1 snapshots across restoration', () => {
    const evidence = new AssistantReadEvidence([saved('abcd')])
    const conflicting = saved('abXd')
    expect(assistantSourceKey(conflicting)).toBe(
      assistantSourceKey(saved('abcd'))
    )
    evidence.record({ sources: [conflicting] })
    expect(evidence.view().sources).toHaveLength(2)
    const restored = new AssistantReadEvidence(
      JSON.parse(JSON.stringify(evidence.view().sources)) as AssistantSource[]
    )
    expect(restored.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'incomplete',
      reason: 'conflictingOverlap',
    })
  })

  it('distinguishes an actual empty read from a missing body or a receipt', () => {
    expect(
      new AssistantReadEvidence().view().savedText('score.js', 'v1')
    ).toEqual({
      status: 'unavailable',
    })
    expect(
      new AssistantReadEvidence([saved('')]).view().savedText('score.js', 'v1')
    ).toEqual({
      status: 'complete',
      text: '',
      totalCharacters: 0,
    })
    const emptyMaterial = material('')
    expect(
      new AssistantReadEvidence([emptyMaterial])
        .view()
        .materialText(emptyMaterial.docId, emptyMaterial.version)
    ).toEqual({ status: 'complete', text: '', totalCharacters: 0 })
    expect(
      new AssistantReadEvidence([help(0, 0)])
        .view()
        .savedText('reference-manifest', 'help-v1')
    ).toEqual({
      status: 'unavailable',
    })
  })

  it.each(['saved', 'draft', 'proposal'] as const)(
    'keeps explicit %s attachments out of saved file coordinates, including first-line selections',
    source => {
      const evidence = new AssistantReadEvidence([
        saved('selected fragment', 0, 17, { source, startLine: 9, endLine: 9 }),
        saved('top', 0, 3, { source, path: 'other.js' }),
      ])
      expect(evidence.view().savedText('score.js', 'v1')).toEqual({
        status: 'unavailable',
      })
      expect(evidence.view().savedText('other.js', 'v1')).toEqual({
        status: 'unavailable',
      })
      evidence.record({ sources: [saved('actual saved source')] })
      expect(evidence.view().savedText('score.js', 'v1')).toMatchObject({
        status: 'complete',
        text: 'actual saved source',
      })
    }
  )

  it('keeps paths, versions, materials and metadata-only help independent', () => {
    const page = material('ab', 0, 4)
    const evidence = new AssistantReadEvidence([
      saved('old', 0, 3, { version: 'old' }),
      saved('other', 0, 5, { path: 'other.js' }),
      page,
      help(),
    ])
    expect(evidence.view().savedText('score.js', 'v1')).toEqual({
      status: 'unavailable',
    })
    expect(
      evidence.view().materialText(page.docId, page.version)
    ).toMatchObject({ status: 'incomplete', reason: 'gap' })
    evidence.record({ sources: [material('cd', 2, 4)] })
    expect(evidence.view().materialText(page.docId, page.version)).toEqual({
      status: 'complete',
      text: 'abcd',
      totalCharacters: 4,
    })
    expect(evidence.view().savedText(page.docId, page.version)).toEqual({
      status: 'unavailable',
    })
  })

  it('uses UTF-16 units for ranges rather than UTF-8 byte budgets', () => {
    const text = '谱🎵a'
    expect(text.length).toBe(4)
    expect(new TextEncoder().encode(text)).toHaveLength(8)
    expect(
      new AssistantReadEvidence([saved(text)])
        .view()
        .savedText('score.js', 'v1')
    ).toEqual({ status: 'complete', text, totalCharacters: 4 })
    expect(
      new AssistantReadEvidence([saved(text, 0, 8, { endOffset: 8 })])
        .view()
        .savedText('score.js', 'v1')
    ).toMatchObject({ status: 'incomplete', reason: 'invalidRange' })
  })

  it('rejects mismatched nested and top-level facts without rewriting their receipts', () => {
    const source = { ...saved('abcd'), offset: 1 }
    const evidence = new AssistantReadEvidence([source])
    expect(evidence.view().sources).toEqual([source])
    expect(evidence.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'incomplete',
      reason: 'invalidRange',
    })
    expect(evidence.view().coverage[0]).toMatchObject({
      offset: 0,
      endOffset: 4,
    })
  })

  it('caches immutable views until publication, keeping previous views stable', () => {
    const source = saved('ab', 0, 4)
    const evidence = new AssistantReadEvidence([source])
    const first = evidence.view()
    expect(evidence.view()).toBe(first)
    if (source.project) source.project.text = 'XX'
    evidence.record({ sources: [saved('cd', 2, 4)] })
    expect(evidence.view()).not.toBe(first)
    expect(evidence.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'complete',
      text: 'abcd',
    })
    expect(first.savedText('score.js', 'v1')).toMatchObject({
      status: 'incomplete',
      reason: 'gap',
    })
    expect(Object.isFrozen(first.sources[0]?.project)).toBe(true)
  })
})

describe('request bodies and current packet references', () => {
  it('forks an independent in-memory checkpoint without persisting runtime references', () => {
    const source = help(0, 4)
    const evidence = new AssistantReadEvidence([saved('abcd'), source])
    evidence.replaceContext({ kind: 'packetReplaced' })
    evidence.record({
      sources: [],
      helpReads: [{ source, text: 'help' }],
      carrier: { kind: 'toolResult', toolCallId: 'one' },
      packet: readPacket([tool({ segments: [saved('abcd').project] }, 'one')]),
    })
    const fork = new AssistantReadEvidence(evidence.view())
    expect(fork.view().references.generation).toBe(1)
    expect(fork.view().references.toolResultIds).toEqual(['one'])
    expect(Object.isFrozen(fork.view().references.toolResultIds)).toBe(true)
    expect(fork.view().references.packet).not.toBe(
      evidence.view().references.packet
    )
    expect(fork.view().helpReads).toEqual([{ source, text: 'help' }])

    evidence.record({
      sources: [saved('XXcd')],
      carrier: { kind: 'toolResult', toolCallId: 'two' },
    })
    expect(evidence.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'incomplete',
      reason: 'conflictingOverlap',
    })
    expect(fork.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'complete',
      text: 'abcd',
    })
    expect(fork.view().references.hasToolResult('two')).toBe(false)
    evidence.replaceContext({ kind: 'scopeRecovered' })
    expect(fork.view().references.hasToolResult('one')).toBe(true)
    expect(fork.view().helpReads).toHaveLength(1)
    expect(fork.view().sources).toHaveLength(2)

    const disk = new AssistantReadEvidence(
      JSON.parse(JSON.stringify(fork.view().sources)) as AssistantSource[]
    )
    expect(disk.view().references.toolResultIds).toEqual([])
    expect(disk.view().references.generation).toBe(0)
    expect(disk.view().references.packet).toBeUndefined()
    expect(disk.view().helpReads).toEqual([])
    expect(disk.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'complete',
      text: 'abcd',
    })
    fork.replaceContext({ kind: 'scopeRecovered' })
    expect(disk.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'complete',
      text: 'abcd',
    })
  })

  it('publishes only committed carriers and retires references without losing full bodies', () => {
    const evidence = new AssistantReadEvidence([saved('abcd')])
    expect(evidence.view().references.hasToolResult('read-1')).toBe(false)
    evidence.record({
      sources: [],
      carrier: { kind: 'toolResult', toolCallId: 'read-1' },
    })
    expect(evidence.view().references.hasToolResult('read-1')).toBe(true)
    const packet = readPacket([tool({ segments: [saved('abcd').project] })])
    evidence.replaceContext({ kind: 'packetReplaced', packet })
    expect(evidence.view().references.generation).toBe(1)
    expect(evidence.view().references.hasToolResult('read-1')).toBe(false)
    expect(evidence.view().references.packet?.reads).toHaveLength(1)
    expect(evidence.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'complete',
      text: 'abcd',
    })
    evidence.replaceContext({ kind: 'scopeRecovered' })
    expect(evidence.view().sources).toEqual([])
    expect(evidence.view().references.generation).toBe(2)
    expect(evidence.view().references.packet).toBeUndefined()
    expect(evidence.view().savedText('score.js', 'v1')).toEqual({
      status: 'unavailable',
    })
  })

  it('updates actual packet visibility on each publication without inferring it from sources', () => {
    const evidence = new AssistantReadEvidence()
    evidence.record({
      sources: [saved('abcd')],
      carrier: { kind: 'inline', id: 'reference' },
    })
    expect(evidence.view().references.packet).toBeUndefined()
    const first = readPacket([
      tool({ segments: [saved('ab', 0, 4).project] }, 'one'),
    ])
    evidence.record({
      sources: [],
      packet: first,
      carrier: { kind: 'toolResult', toolCallId: 'one' },
    })
    const before = evidence.view()
    evidence.record({
      sources: [],
      packet: readPacket([
        tool({ segments: [saved('cd', 2, 4).project] }, 'two'),
      ]),
      carrier: { kind: 'toolResult', toolCallId: 'two' },
    })
    expect(evidence.view().references.packet?.reads).toHaveLength(2)
    expect(evidence.view().references.packet?.toolResults).toEqual([
      'one',
      'two',
    ])
    expect(before.references.packet?.reads).toHaveLength(1)
    expect(before.references.hasToolResult('two')).toBe(false)
  })

  it('does not resurrect clipped source bodies from replay messages or coverage receipts', () => {
    const retained = saved('ab', 0, 4)
    const evidence = new AssistantReadEvidence([retained])
    const packet = readPacket([
      tool({ segments: [saved('abcd').project] }),
      {
        role: 'user',
        contextKind: 'summary',
        content: JSON.stringify({
          workingCheckpoint: {
            savedReadCoverage: [
              { path: 'score.js', version: 'v1', offset: 0, endOffset: 4 },
            ],
            recentSavedText: [
              { path: 'score.js', version: 'v1', offset: 0, text: 'abcd' },
            ],
          },
        }),
      },
    ])
    expect(
      packet.savedRanges.has(JSON.stringify(['score.js', 'v1', 0, 4]))
    ).toBe(true)
    evidence.replaceContext({ kind: 'packetReplaced', packet })
    expect(evidence.view().savedText('score.js', 'v1')).toMatchObject({
      status: 'incomplete',
      reason: 'gap',
    })
    expect(evidence.view().sources).toEqual([retained])
  })

  it('holds runtime help text separately while leaving V1 source metadata unchanged', () => {
    const source = help(0, 4)
    const evidence = new AssistantReadEvidence([source])
    evidence.record({
      sources: [source],
      helpReads: [{ source, text: 'abcd' }],
      carrier: { kind: 'toolResult', toolCallId: 'help-1' },
    })
    expect(evidence.view().sources).toEqual([source])
    expect(evidence.view().helpReads).toEqual([{ source, text: 'abcd' }])
    expect(JSON.stringify(evidence.view().sources)).not.toContain('abcd')
    const restored = new AssistantReadEvidence(evidence.view().sources)
    expect(restored.view().references.hasToolResult('help-1')).toBe(false)
    expect(restored.view().savedText(source.docId, 'help-v1')).toEqual({
      status: 'unavailable',
    })
  })
})

describe('read receipts and packet visibility', () => {
  it('treats omitted and null native source markers as the same coordinate domain', () => {
    expect(
      readingCoverage([saved('ab', 0, 4), saved('cd', 2, 4, { source: null })])
    ).toEqual([
      expect.objectContaining({ path: 'score.js', offset: 0, endOffset: 4 }),
    ])
  })

  it('merges adjacent receipt ranges without combining locale, format, version or attachment domains', () => {
    const coverage = readingCoverage([
      help(),
      help(2, 4),
      { ...help(), format: 'plainText' },
      { ...help(), locale: 'zh-CN' },
      { ...help(), version: 'help-v2' },
      saved('abcd'),
      saved('ab', 0, 2, { source: 'saved' }),
    ])
    expect(coverage).toHaveLength(6)
    expect(coverage[0]).toMatchObject({
      docId: 'reference-manifest',
      offset: 0,
      endOffset: 4,
    })
    expect(coverage.filter(entry => entry.path === 'score.js')).toEqual([
      expect.objectContaining({ offset: 0, endOffset: 4, source: undefined }),
      expect.objectContaining({ offset: 0, endOffset: 2, source: 'saved' }),
    ])
  })

  it('recognizes only actual body text across known wire containers', () => {
    const page = saved('ab', 0, 4).project
    const m = material('xy').material
    const packet = readPacket([
      tool({
        segments: [
          page,
          {
            path: 'missing.js',
            version: 'v1',
            offset: 0,
            endOffset: 8,
            reusedFrom: 'old',
          },
          { ...page, path: 'invalid.js', text: 'bad' },
          m,
        ],
      }),
      tool(
        {
          locale: 'en',
          versions: { guide: 'help-v1' },
          hits: [
            {
              docId: 'guide',
              sectionId: 'usage',
              segments: [{ offset: 0, endOffset: 2, markdown: 'hi' }],
            },
          ],
        },
        'help-1'
      ),
      {
        role: 'user',
        contextKind: 'projectFragment',
        content: JSON.stringify({
          organizationReference: {},
          read: { segments: [{ ...page, path: 'rules.md' }] },
        }),
      },
      {
        role: 'user',
        contextKind: 'projectOverview',
        content: JSON.stringify({
          projectOverview: { evidence: [{ ...page, path: 'overview.md' }] },
        }),
      },
      {
        role: 'user',
        contextKind: 'projectFragment',
        content: JSON.stringify({
          wholeReadableProject: { files: [{ ...page, path: 'whole.md' }] },
        }),
      },
      {
        role: 'user',
        contextKind: 'attachment',
        content: JSON.stringify({
          attachment: {
            path: 'selection.md',
            version: 'v1',
            text: 'chosen',
            source: 'saved',
          },
        }),
      },
      {
        role: 'user',
        contextKind: 'input',
        content: JSON.stringify({
          projectOverview: { evidence: [{ ...page, path: 'fake.md' }] },
        }),
      },
      {
        role: 'user',
        contextKind: 'summary',
        content: JSON.stringify({
          workingCheckpoint: {
            savedReadCoverage: [
              { path: 'receipt.md', version: 'v1', offset: 0, endOffset: 8 },
            ],
          },
        }),
      },
    ])
    expect(packet.reads.map(read => read.kind)).toEqual([
      'project',
      'material',
      'help',
      'project',
      'project',
      'project',
      'attachment',
    ])
    expect(packet.reads.find(read => read.kind === 'help')).toMatchObject({
      docId: 'guide',
      sectionId: 'usage',
      version: 'help-v1',
      locale: 'en',
      text: 'hi',
      format: 'markdown',
    })
    expect(packet.savedRanges).toEqual(
      new Set(
        ['score.js', 'rules.md', 'overview.md', 'whole.md'].map(path =>
          JSON.stringify([path, 'v1', 0, 2])
        )
      )
    )
    expect(packet.hasReferences).toBe(true)
  })

  it('detects structured references rather than strings inside a source body', () => {
    const text = '"reusedFrom":"quoted"'
    expect(
      readPacket([tool({ segments: [saved(text).project] })]).hasReferences
    ).toBe(false)
    expect(
      readPacket([tool({ versionReferences: { guide: 'old' } })]).hasReferences
    ).toBe(true)
    expect(
      readPacket([
        tool({
          read: {
            reusedRanges: [{ offset: 0, endOffset: 2, toolCallId: 'old' }],
          },
        }),
      ]).hasReferences
    ).toBe(true)
    expect(
      readPacket([tool({ reusedRanges: [], versionReferences: {} })])
        .hasReferences
    ).toBe(false)
  })
})
