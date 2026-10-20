import { describe, expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  AssistantFlowError,
  type AssistantContinuation,
  type AssistantDependencies,
} from './assistant-flow'
import type { AssistantWireMessage, AssistantTurn } from './assistant-types'
import { contextDraft, parseContextDraft } from './model-context-settings'
import { commands, type ModelServiceConfig } from './tauri-bindings'
import { collectWholeProject } from './assistant-whole-project'

const raw = import.meta.glob<string>('../../docs/en/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const corpus = Object.entries(raw).map(([file, markdown]) => {
  const path = file.replace('../../docs/en/', '')
  return {
    id: path.replace(/\.md$/, '').replaceAll('/', '-').toLowerCase(),
    path,
    markdown,
  }
})
const config: ModelServiceConfig = {
  baseUrl: 'https://model.example/v1',
  model: 'unverified-model',
  context: {
    capacity: 1000000,
    inputTarget: 32000,
    maxOutput: 8192,
    reasoningReserve: 0,
    safetyMargin: 2048,
    tokenizer: 'unknown',
    source: 'manualUnverified',
  },
}
function setup() {
  const text =
    Array.from({ length: 40 }, (_, i) =>
      `// page ${i}\n`.padEnd(8192, 'x')
    ).join('') + '\nconst broken = true;'
  const project = {
    fingerprint: 'f',
    files: [
      { path: 'score.js', version: 'v1', bytes: text.length, reason: null },
    ],
  }
  const packets: AssistantWireMessage[][] = []
  const phases: string[] = []
  const request = {
    identity: 'owner',
    input: '修复 score.js 中 broken 的值，保留其他内容',
    history: [],
    locale: 'en' as const,
    signal: new AbortController().signal,
    isCurrent: () => true,
    expectedConfig: config,
    projectReading: true,
    project,
    onPhase: (phase: string) => phases.push(phase),
  }
  const deps: AssistantDependencies = {
    begin: async (_identity, requestId) => ({
      requestId,
      model: config.model,
      baseUrl: config.baseUrl,
      config,
    }),
    cancel: vi.fn(async () => undefined),
    corpus: async () => corpus,
    readProject: vi.fn<NonNullable<AssistantDependencies['readProject']>>(
      async (_identity, read) => {
        const endOffset = Math.min(read.offset + read.pageLength, text.length)
        return {
          path: 'score.js',
          version: 'v1',
          source: 'saved',
          text: text.slice(read.offset, endOffset),
          offset: read.offset,
          endOffset,
          totalCharacters: text.length,
          nextOffset: endOffset < text.length ? endOffset : null,
          startLine: 1,
          endLine: 1,
        }
      }
    ),
    turn: async (_id, messages) => {
      packets.push(structuredClone(messages))
      const i = packets.length - 1
      if (i <= 40)
        return {
          text: null,
          toolCalls: [
            {
              id: `r-${i}`,
              name: 'read_project_text',
              arguments: JSON.stringify({
                path: 'score.js',
                version: 'v1',
                offset: i * 8192,
                pageLength: 8192,
              }),
            },
          ],
        }
      if (i === 41)
        return {
          text: null,
          toolCalls: [
            {
              id: 'proposal',
              name: 'propose_text_change',
              arguments: JSON.stringify({
                path: 'score.js',
                version: 'v1',
                parameters: [],
                edits: [
                  {
                    oldText: 'const broken = true;',
                    newText: 'const broken = false;',
                  },
                ],
              }),
            },
          ],
        }
      return { text: '修改建议已准备，请确认后应用。', toolCalls: [] }
    },
  }
  return { text, project, packets, phases, request, deps }
}

describe('automatic working context', () => {
  it('keeps capacity for display in automatic mode while manual input limits require opt in', () => {
    const draft = contextDraft(config.context)
    expect(draft.mode).toBe('auto')
    expect(parseContextDraft(draft)).toMatchObject({
      mode: 'auto',
      capacity: 1000000,
      inputTarget: null,
      maxOutput: 8192,
    })
    expect(parseContextDraft({ ...draft, mode: 'manual' })).toMatchObject({
      mode: 'manual',
      inputTarget: 32000,
    })
    expect(parseContextDraft(contextDraft())).toBeUndefined()
  })

  it('accepts an informational capacity without adding output or input limits', () => {
    const draft = contextDraft()
    expect(parseContextDraft({ ...draft, capacity: '64000' })).toMatchObject({
      mode: 'auto',
      capacity: 64000,
      inputTarget: null,
      maxOutput: null,
    })
    expect(
      parseContextDraft({ ...draft, capacity: '128', maxOutput: '8192' })
    ).toMatchObject({ mode: 'auto', capacity: 128, maxOutput: 8192 })
    expect(() => parseContextDraft({ ...draft, capacity: '0' })).toThrow(
      'invalidContext'
    )
  })

  it('leaves output to the provider unless configured and requires explicit reserves for manual capacity', () => {
    const draft = contextDraft()
    expect(draft.maxOutput).toBe('')
    expect(
      parseContextDraft({ ...draft, tokenizer: 'o200kBase' })
    ).toMatchObject({
      maxOutput: null,
      reasoningReserve: 0,
    })
    expect(() =>
      parseContextDraft({ ...draft, mode: 'manual', capacity: '64000' })
    ).toThrow('invalidContext')
    expect(() =>
      parseContextDraft({ ...draft, reasoningReserve: '1024' })
    ).toThrow('invalidContext')
    expect(
      parseContextDraft({
        ...draft,
        mode: 'manual',
        capacity: '64000',
        maxOutput: '8192',
        reasoningReserve: '1024',
      })
    ).toMatchObject({ maxOutput: 8192, reasoningReserve: 1024 })
  })

  it('finishes a saved-file repair beyond 32 reads and 256 KiB, preserving full evidence and exact candidates across compaction', async () => {
    const { text, packets, phases, request, deps } = setup()
    const result = await runAssistantRequest(request, deps)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals?.[0]).toMatchObject({
      path: 'score.js',
      version: 'v1',
      sourceText: text,
      text: text.replace('const broken = true;', 'const broken = false;'),
    })
    expect(phases).toContain('compacting')
    expect(packets.length).toBe(43)
    for (const packet of packets) {
      expect(JSON.stringify(packet)).toContain(request.input)
      expect(
        new TextEncoder().encode(JSON.stringify(packet)).length
      ).toBeLessThan(512 * 1024)
      const callIds = new Set(
        packet.flatMap(message => message.toolCalls?.map(call => call.id) ?? [])
      )
      for (const message of packet.filter(message => message.role === 'tool'))
        expect(callIds.has(message.toolCallId ?? '')).toBe(true)
    }
    expect(JSON.stringify(packets.at(-1))).toContain('pendingUserReview')
  })

  it('collects a whole saved file beyond the former result budget and measures only the organized working packet', async () => {
    const { request, deps, text } = setup()
    vi.mocked(commands.assistantProjectRead).mockImplementation(
      async (owner, read) => ({
        status: 'ok',
        data: await (
          deps.readProject ??
          (() => {
            throw new Error('Missing fixture reader')
          })
        )(owner, read),
      })
    )
    vi.mocked(commands.measureAssistantContext).mockResolvedValue({
      status: 'ok',
      data: {
        characters: 1000,
        utf8Bytes: 1000,
        estimatedTokens: null,
        admissionEstimate: 300,
        tokenizer: 'unknown',
        capacity: null,
        effectiveInput: null,
        outputReserve: 8192,
        safetyMargin: 2048,
        parts: [],
        exceeded: null,
      },
    })
    const result = await collectWholeProject({
      owner: request.identity,
      config,
      input: request.input,
      history: [],
      snapshot: request.project,
      attachments: [],
      consumers: [],
      locale: 'en',
      check: () => undefined,
    })
    expect(result.consumer.text).toContain('workingCheckpoint')
    expect(
      result.consumer.sources?.reduce(
        (sum, source) => sum + (source.project?.text.length ?? 0),
        0
      )
    ).toBe(text.length)
    const packet = vi
      .mocked(commands.measureAssistantContext)
      .mock.calls.at(-1)?.[1]
    expect(
      new TextEncoder().encode(JSON.stringify(packet)).length
    ).toBeLessThan(256 * 1024)
  })

  it('automatically reduces context only after an explicit provider overflow, re-sends omitted ranges, and retains progress on manual retry', async () => {
    const { request, deps, phases } = setup()
    let checkpoint: AssistantContinuation | null = null
    const packets: AssistantWireMessage[][] = []
    const read = (id: string): AssistantTurn => ({
      text: '检查保存的代码。',
      toolCalls: [
        {
          id,
          name: 'read_project_text',
          arguments: JSON.stringify({
            path: 'score.js',
            version: 'v1',
            offset: 0,
            pageLength: 65536,
          }),
        },
      ],
    })
    deps.turn = vi.fn(async (_id, messages) => {
      packets.push(structuredClone(messages))
      if (packets.length === 1) return read('first')
      if (packets.length === 2)
        throw new AssistantFlowError('contextWindowExceeded')
      if (packets.length === 3) return read('reread')
      if (packets.length === 4) throw new AssistantFlowError('timeout')
      return { text: '接续完成。', toolCalls: [] }
    })
    const task = {
      ...request,
      onContinuation: (value: AssistantContinuation | null) => {
        checkpoint = value
      },
    }
    await expect(runAssistantRequest(task, deps)).rejects.toMatchObject({
      code: 'timeout',
    })
    expect(phases).toContain('compacting')
    expect(JSON.stringify(packets[2])).toContain('workingCheckpoint')
    expect((JSON.stringify(packets[2]) ?? '').length).toBeLessThan(
      (JSON.stringify(packets[1]) ?? '').length
    )
    const repeated = JSON.parse(
      packets[3]?.find(message => message.toolCallId === 'reread')?.content ??
        '{}'
    )
    expect(repeated.segments[0].text.length).toBeGreaterThan(0)
    expect(repeated.segments[0].reusedFrom).toBeUndefined()
    expect(checkpoint).not.toBeNull()
    const result = await runAssistantRequest(
      { ...task, continuation: checkpoint ?? undefined },
      deps
    )
    expect(result.text).toContain('接续完成。')
    expect(deps.readProject).toHaveBeenCalledTimes(2)
  })
})
