import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  AssistantFlowError,
  type AssistantContinuation,
  type AssistantDependencies,
} from './assistant-flow'
import { HELP_BOOKS } from './help-corpus'
import type { AssistantSource, AssistantWireMessage } from './assistant-types'
import { selectAssistantContext } from './assistant-context'
import {
  AssistantMaterialReadError,
  materialPageSource,
} from './assistant-materials'
import {
  deserializeAssistantContinuation,
  serializeAssistantContinuation,
} from './assistant-resume'
import { modelProfileKey } from './model-context-settings'
import type { AssistantRoundUsage } from './tauri-bindings'
import { handoffDraftInput } from './assistant-handoff'
import { createAssistantTaskChecksFixture } from '@/test/assistant-task-checks-fixture'

function harness(mode: 'discussion' | 'edit') {
  const material = {
    id: '1234567890abcdef1234567890abcdef',
    name: 'Pattern.js',
    version: 'a'.repeat(64),
    size: 128,
    totalCharacters: 128,
  }
  const catalog = [
    material,
    { ...material, id: 'b'.repeat(32), name: 'Other.js' },
  ]
  const packets: AssistantWireMessage[][] = []
  const project = { fingerprint: 'saved', files: [] }
  const deps: AssistantDependencies = {
    begin: async (_, requestId) => ({
      requestId,
      model: 'test',
      baseUrl: 'http://local',
    }),
    cancel: async () => undefined,
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nLocal contract.`,
        }))
      ),
    projectInventory: async () => project,
    task: async () => {
      const task = { id: 'task', mode, files: [] }
      const execute = vi.fn().mockResolvedValue('{}')
      return {
        task,
        checks: createAssistantTaskChecksFixture({
          identity: 'owner',
          mode,
          task: () => task,
          invokeProjectCheckTool: () => execute('run_project_check', {}),
        }),
        execute,
        close: async () => undefined,
      }
    },
    listMaterials: async () => catalog,
    readMaterial: async (_, read) => ({
      material,
      text: read.offset === 0 ? 'A'.repeat(64) : 'B'.repeat(64),
      offset: read.offset,
      endOffset: read.offset + 64,
      totalCharacters: 128,
      nextOffset: read.offset === 0 ? 64 : null,
      startLine: 1,
      endLine: 1,
    }),
    turn: async (_, messages) => {
      packets.push(structuredClone(messages))
      const index = packets.length
      return index === 1
        ? {
            text: '',
            toolCalls: [
              { id: 'list', name: 'list_creation_materials', arguments: '{}' },
            ],
          }
        : index === 2
          ? {
              text: '',
              toolCalls: [
                {
                  id: 'read',
                  name: 'read_creation_material',
                  arguments: JSON.stringify({
                    id: material.id,
                    version: material.version,
                    offset: 64,
                    pageLength: 64,
                  }),
                },
              ],
            }
          : mode === 'discussion'
            ? {
                text: null,
                toolCalls: [
                  {
                    id: 'answer',
                    name: 'complete_discussion',
                    arguments: JSON.stringify({
                      answer: 'I read the second range.',
                    }),
                  },
                ],
              }
            : { text: 'I read the second range.', toolCalls: [] }
    },
  }
  const request = {
    identity: 'owner',
    mode,
    input: 'Explain the supplied pattern.',
    history: [],
    locale: 'en' as const,
    signal: new AbortController().signal,
    isCurrent: () => true,
    projectReading: true,
    project,
  }
  return { material, catalog, packets, deps, request }
}

it.each(['discussion', 'edit'] as const)(
  'reads private material on demand in %s and sends only the requested actual page',
  async mode => {
    const h = harness(mode)
    const onSources = vi.fn<(sources: AssistantSource[]) => void>()
    const result = await runAssistantRequest(
      { ...h.request, onSources },
      h.deps
    )
    expect(h.packets).toHaveLength(3)
    expect(JSON.stringify(h.packets[0])).not.toContain(h.material.id)
    const listing = JSON.parse(
      h.packets[1]?.find(message => message.toolCallId === 'list')?.content ??
        '{}'
    )
    expect(listing.data.materials).toEqual(h.catalog)
    const read = JSON.parse(
      h.packets[2]?.find(message => message.toolCallId === 'read')?.content ??
        '{}'
    )
    expect(read.segments).toEqual([
      {
        material: h.material,
        text: 'B'.repeat(64),
        offset: 64,
        endOffset: 128,
        totalCharacters: 128,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      },
    ])
    expect(JSON.stringify(h.packets[2])).not.toContain('A'.repeat(64))
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.material).toEqual(read.segments[0])
    expect(result.sources[0]?.project).toBeUndefined()
    expect(onSources).toHaveBeenLastCalledWith(result.sources)
  }
)

it('requires actual complete material ranges before adopting the private source', async () => {
  const h = harness('edit')
  const execute = vi.fn().mockResolvedValue(JSON.stringify({ status: 'saved' }))
  h.deps.task = async () => {
    const task = { id: 'task', mode: 'edit' as const, files: [] }
    return {
      task,
      checks: createAssistantTaskChecksFixture({
        identity: 'owner',
        task: () => task,
        invokeProjectCheckTool: () => execute('run_project_check', {}),
      }),
      execute,
      close: async () => undefined,
    }
  }
  let turn = 0
  const read = (offset: number) => ({
    id: `read-${offset}`,
    name: 'read_creation_material',
    arguments: JSON.stringify({
      id: h.material.id,
      version: h.material.version,
      offset,
      pageLength: 64,
    }),
  })
  const adopt = (id: string) => ({
    id,
    name: 'adopt_creation_material',
    arguments: JSON.stringify({
      id: h.material.id,
      version: h.material.version,
      path: 'public/Pattern.js',
    }),
  })
  h.deps.turn = async (_, messages) => {
    h.packets.push(structuredClone(messages))
    switch (turn++) {
      case 0:
        return { text: '', toolCalls: [read(64)] }
      case 1:
        return { text: '', toolCalls: [adopt('incomplete')] }
      case 2:
        expect(
          JSON.parse(
            messages.find(message => message.toolCallId === 'incomplete')
              ?.content ?? '{}'
          )
        ).toMatchObject({ status: 'refused', reason: 'incompleteMaterialRead' })
        expect(execute).not.toHaveBeenCalled()
        return { text: '', toolCalls: [read(0)] }
      case 3:
        return { text: '', toolCalls: [adopt('complete')] }
      default:
        return { text: 'Adopted the complete source.', toolCalls: [] }
    }
  }
  await runAssistantRequest(
    {
      ...h.request,
      input: 'Integrate the supplied Pattern source into this score.',
    },
    h.deps
  )
  expect(execute).toHaveBeenCalledWith('adopt_creation_material', {
    id: h.material.id,
    version: h.material.version,
    path: 'public/Pattern.js',
  })
})

it('keeps removed material evidence out of history, including misclassified platform records', () => {
  const h = harness('discussion')
  const page = {
    material: h.material,
    text: 'B'.repeat(64),
    offset: 64,
    endOffset: 128,
    totalCharacters: 128,
    nextOffset: null,
    startLine: 1,
    endLine: 1,
  }
  const history = [
    {
      id: 'user',
      role: 'user' as const,
      text: 'Explain the pattern.',
      status: 'completed' as const,
      scope: 'platform' as const,
      sources: [],
    },
    {
      id: 'reply',
      role: 'assistant' as const,
      text: 'Private pattern facts.',
      status: 'completed' as const,
      scope: 'platform' as const,
      sources: [materialPageSource(page, 'en')],
    },
  ]
  expect(
    selectAssistantContext(history, undefined, h.request.project).recent
  ).toEqual([])
  expect(handoffDraftInput(history).input).not.toContain(
    'Private pattern facts.'
  )
})

it('preserves independent material evidence through durable checkpoints and refuses a removed material before another paid turn', async () => {
  const h = harness('discussion')
  h.deps.turn = async () => {
    throw new Error('provider unavailable')
  }
  // The durable facts remain after source text snapshots have been trimmed.
  const continuation = {
    taskId: 'task',
    projectFingerprint: 'saved',
    projectSnapshot: h.request.project,
    key: '',
    restored: true,
    messages: [
      {
        role: 'user' as const,
        content: 'Original request',
        contextKind: 'input' as const,
      },
    ],
    sources: [],
    materialEvidence: [{ id: h.material.id, version: h.material.version }],
    text: '',
    project: null,
    toolCalls: 1,
    toolCharacters: 64,
    callIds: ['old-read'],
    calls: [null],
    returnedCharacters: 64,
    reusedCharacters: 0,
    proposals: [],
    handoff: null,
  }
  const saved = deserializeAssistantContinuation(
    serializeAssistantContinuation(continuation)
  )
  expect(saved?.materialEvidence).toEqual(continuation.materialEvidence)
  h.catalog.length = 0
  expect(saved).not.toBeNull()
  if (!saved) throw new Error('Missing durable checkpoint')
  await expect(
    runAssistantRequest({ ...h.request, continuation: saved }, h.deps)
  ).rejects.toMatchObject({ code: 'projectScopeChanged' })
})

it.each([
  { route: 'handoff', change: 'removed' },
  { route: 'handoff', change: 'changed' },
  { route: 'work', change: 'removed' },
  { route: 'work', change: 'changed' },
] as const)(
  'revalidates selected-plan material evidence before retrying $route after the material is $change',
  async ({ route, change }) => {
    const h = harness(route === 'work' ? 'edit' : 'discussion')
    const turn = vi.fn(async () => {
      throw new Error('provider unavailable')
    })
    const read = vi.fn(h.deps.readMaterial)
    h.deps.turn = turn
    h.deps.readMaterial = read
    let checkpoint: AssistantContinuation | null = null
    const evidence = [{ id: h.material.id, version: h.material.version }]
    const request = {
      ...h.request,
      input: 'Use the selected fixed-pitch plan.',
      materialEvidence: evidence,
      ...(route === 'handoff'
        ? {
            purpose: 'handoffDraft' as const,
            handoffDraftSources: [
              {
                id: 'reply:selected-plan',
                kind: 'creator' as const,
                text: 'The creator selected this fixed-pitch plan.',
              },
            ],
          }
        : {}),
      onContinuation: (value: AssistantContinuation | null) => {
        if (value) checkpoint = value
      },
    }
    await expect(runAssistantRequest(request, h.deps)).rejects.toMatchObject({
      code: 'requestFailed',
    })
    expect(turn).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
    const saved = checkpoint as AssistantContinuation | null
    if (!saved) throw new Error('Missing selected-plan checkpoint')
    const restored = deserializeAssistantContinuation(
      serializeAssistantContinuation(saved)
    )
    expect(restored?.materialEvidence).toEqual(evidence)
    expect(restored?.sources).toEqual([])
    if (!restored) throw new Error('Missing durable selected-plan checkpoint')
    if (change === 'removed') h.catalog.length = 0
    else h.catalog[0] = { ...h.material, version: 'c'.repeat(64) }
    turn.mockClear()
    await expect(
      runAssistantRequest({ ...request, continuation: restored }, h.deps)
    ).rejects.toMatchObject({ code: 'projectScopeChanged' })
    expect(turn).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  }
)

it('reuses current material discussion history only after fresh validation and excludes it after removal', async () => {
  const h = harness('discussion')
  const source = materialPageSource(
    {
      material: h.material,
      text: 'B'.repeat(64),
      offset: 64,
      endOffset: 128,
      totalCharacters: 128,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    },
    'en'
  )
  const contextServiceKey = modelProfileKey({
    model: 'test',
    baseUrl: 'http://local',
  })
  const history = [
    {
      id: 'user',
      role: 'user' as const,
      text: 'Explain the pattern.',
      status: 'completed' as const,
      scope: 'project' as const,
      contextServiceKey,
      sources: [],
    },
    {
      id: 'reply',
      role: 'assistant' as const,
      text: 'Private pattern facts.',
      status: 'completed' as const,
      scope: 'project' as const,
      contextServiceKey,
      sources: [source],
    },
  ]
  h.deps.turn = async (_, messages) => {
    h.packets.push(structuredClone(messages))
    return {
      text: null,
      toolCalls: [
        {
          id: 'answer',
          name: 'complete_discussion',
          arguments: JSON.stringify({ answer: 'Done.' }),
        },
      ],
    }
  }
  const result = await runAssistantRequest({ ...h.request, history }, h.deps)
  expect(JSON.stringify(h.packets[0])).toContain('Private pattern facts.')
  expect(result.sources).toEqual([source])
  h.catalog.length = 0
  await runAssistantRequest({ ...h.request, history }, h.deps)
  expect(JSON.stringify(h.packets[1])).not.toContain('Private pattern facts.')
})

it.each(['missing', 'unreadable', 'invalidRange', 'versionConflict'] as const)(
  'returns an explicit %s refusal without a fabricated material source',
  async reason => {
    const h = harness('discussion')
    h.deps.readMaterial = async () => {
      throw new AssistantMaterialReadError(reason)
    }
    const result = await runAssistantRequest(h.request, h.deps)
    const refusal = JSON.parse(
      h.packets[2]?.find(message => message.toolCallId === 'read')?.content ??
        '{}'
    )
    expect(refusal).toMatchObject({ status: 'refused', reason })
    expect(result.sources).toEqual([])
    expect(JSON.stringify(h.packets[2])).not.toContain('B'.repeat(64))
  }
)

it('does not accept a page removed while reading or a late reply after project switch', async () => {
  const h = harness('discussion')
  const read = h.deps.readMaterial
  if (!read) throw new Error('Missing native material reader')
  h.deps.readMaterial = async (identity, page) => {
    const result = await read(identity, page)
    h.catalog.length = 0
    return result
  }
  const result = await runAssistantRequest(h.request, h.deps)
  expect(result.sources).toEqual([])
  expect(JSON.stringify(h.packets[2])).not.toContain('B'.repeat(64))
  const switched = harness('discussion')
  let current = true
  const switchedRead = switched.deps.readMaterial
  if (!switchedRead) throw new Error('Missing native material reader')
  switched.deps.readMaterial = async (identity, page) => {
    current = false
    return switchedRead(identity, page)
  }
  const onSources = vi.fn()
  await expect(
    runAssistantRequest(
      { ...switched.request, isCurrent: () => current, onSources },
      switched.deps
    )
  ).rejects.toMatchObject({ code: 'cancelled' })
  expect(onSources.mock.calls.every(([sources]) => sources.length === 0)).toBe(
    true
  )
})

it('compacts material reads within the common budget and resends omitted originals instead of dangling reuse references', async () => {
  const h = harness('discussion')
  h.material.size = 327680
  h.material.totalCharacters = 327680
  h.deps.readMaterial = async (_, read) => ({
    material: h.material,
    text: String.fromCharCode(65 + read.offset / 65536).repeat(65536),
    offset: read.offset,
    endOffset: read.offset + 65536,
    totalCharacters: 327680,
    nextOffset: read.offset + 65536 < 327680 ? read.offset + 65536 : null,
    startLine: 1,
    endLine: 1,
  })
  const offsets = [0, 65536, 131072, 196608, 262144, 0]
  h.deps.turn = async (_, messages) => {
    h.packets.push(structuredClone(messages))
    const offset = offsets[h.packets.length - 1]
    return offset === undefined
      ? { text: 'Read the requested ranges.', toolCalls: [] }
      : {
          text: '',
          toolCalls: [
            {
              id: `page-${h.packets.length}`,
              name: 'read_creation_material',
              arguments: JSON.stringify({
                id: h.material.id,
                version: h.material.version,
                offset,
                pageLength: 65536,
              }),
            },
          ],
        }
  }
  const usage: AssistantRoundUsage[] = []
  await runAssistantRequest(
    { ...h.request, onUsage: value => usage.push(value) },
    h.deps
  )
  const compacted = h.packets
    .flatMap(packet =>
      packet
        .filter(message => message.contextKind === 'summary')
        .map(message => JSON.parse(message.content ?? '{}'))
    )
    .find(value => value.workingCheckpoint)
  expect(compacted.workingCheckpoint.savedReadCoverage).toContainEqual({
    materialId: h.material.id,
    name: 'Pattern.js',
    version: h.material.version,
    offset: 0,
    endOffset: 262144,
    totalCharacters: 327680,
  })
  expect(compacted.workingCheckpoint.recentSavedText).toEqual([])
  const finalRead = JSON.parse(
    h.packets.at(-1)?.find(message => message.toolCallId === 'page-6')
      ?.content ?? '{}'
  )
  expect(finalRead.segments[0].text).toBe('A'.repeat(65536))
  expect(finalRead.segments[0].reusedFrom).toBeUndefined()
  expect(usage.at(-1)?.documentMetrics).toMatchObject({
    returnedCharacters: 393216,
    reusedCharacters: 0,
  })
})

it('adopts retained complete material after compaction while resending an omitted range', async () => {
  const h = harness('edit')
  h.material.size = 327680
  h.material.totalCharacters = 327680
  h.deps.readMaterial = async (_, read) => ({
    material: h.material,
    text: String.fromCharCode(65 + read.offset / 65536).repeat(65536),
    offset: read.offset,
    endOffset: read.offset + 65536,
    totalCharacters: 327680,
    nextOffset: read.offset + 65536 < 327680 ? read.offset + 65536 : null,
    startLine: 1,
    endLine: 1,
  })
  const execute = vi.fn().mockResolvedValue(JSON.stringify({ status: 'saved' }))
  h.deps.task = async () => {
    const task = { id: 'task', mode: 'edit' as const, files: [] }
    return {
      task,
      checks: createAssistantTaskChecksFixture({
        identity: 'owner',
        task: () => task,
        invokeProjectCheckTool: () => execute('run_project_check', {}),
      }),
      execute,
      close: async () => undefined,
    }
  }
  const offsets = [0, 65536, 131072, 196608, 262144, 0]
  h.deps.turn = async (_, messages) => {
    h.packets.push(structuredClone(messages))
    const turn = h.packets.length
    const offset = offsets[turn - 1]
    if (offset !== undefined)
      return {
        text: '',
        toolCalls: [
          {
            id: `read-${turn}`,
            name: 'read_creation_material',
            arguments: JSON.stringify({
              id: h.material.id,
              version: h.material.version,
              offset,
              pageLength: 65536,
            }),
          },
        ],
      }
    if (turn === 7) {
      expect(messages.some(message => message.contextKind === 'summary')).toBe(
        true
      )
      // The request still holds B's source page, but this packet omits its body.
      expect(JSON.stringify(messages)).not.toContain('B'.repeat(65536))
      const reread = JSON.parse(
        messages.find(message => message.toolCallId === 'read-6')?.content ??
          '{}'
      )
      expect(reread.segments[0].text).toBe('A'.repeat(65536))
      expect(reread.segments[0]).not.toHaveProperty('reusedFrom')
      return {
        text: '',
        toolCalls: [
          {
            id: 'adopt-complete',
            name: 'adopt_creation_material',
            arguments: JSON.stringify({
              id: h.material.id,
              version: h.material.version,
              path: 'public/Pattern.js',
            }),
          },
        ],
      }
    }
    expect(
      JSON.parse(
        messages.find(message => message.toolCallId === 'adopt-complete')
          ?.content ?? '{}'
      )
    ).toMatchObject({ status: 'saved' })
    return { text: 'Adopted the retained complete source.', toolCalls: [] }
  }

  await runAssistantRequest(h.request, h.deps)
  expect(execute).toHaveBeenCalledWith('adopt_creation_material', {
    id: h.material.id,
    version: h.material.version,
    path: 'public/Pattern.js',
  })
})

it('reduces material pages after provider context rejection and reports the actual remaining range', async () => {
  const h = harness('discussion')
  h.material.size = 131072
  h.material.totalCharacters = 131072
  const reads: number[] = []
  h.deps.readMaterial = async (_, read) => {
    reads.push(read.pageLength)
    return {
      material: h.material,
      text: 'A'.repeat(read.pageLength),
      offset: 0,
      endOffset: read.pageLength,
      totalCharacters: 131072,
      nextOffset: read.pageLength,
      startLine: 1,
      endLine: 1,
    }
  }
  h.deps.turn = async (_, messages) => {
    h.packets.push(structuredClone(messages))
    const turn = h.packets.length
    if (turn === 2) throw new AssistantFlowError('contextWindowExceeded')
    if (turn === 4)
      return {
        text: null,
        toolCalls: [
          {
            id: 'answer',
            name: 'complete_discussion',
            arguments: JSON.stringify({ answer: 'Read the reduced range.' }),
          },
        ],
      }
    return {
      text: '',
      toolCalls: [
        {
          id: `read-${turn}`,
          name: 'read_creation_material',
          arguments: JSON.stringify({
            id: h.material.id,
            version: h.material.version,
            offset: 0,
            pageLength: 65536,
          }),
        },
      ],
    }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(reads[0]).toBe(65536)
  expect(reads[1]).toBeGreaterThanOrEqual(64)
  expect(reads[1]).toBeLessThan(65536)
  const returned = JSON.parse(
    h.packets.at(-1)?.find(message => message.toolCallId === 'read-3')
      ?.content ?? '{}'
  ).segments[0]
  expect(returned).toMatchObject({
    offset: 0,
    endOffset: reads[1],
    nextOffset: reads[1],
    totalCharacters: 131072,
  })
  expect(returned.text.length).toBe(reads[1])
  expect(returned.reusedFrom).toBeUndefined()
})
