/// <reference types="node" />
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AssistantFlowError,
  runAssistantRequest,
  type AssistantDependencies,
  type AssistantContinuation,
} from './assistant-flow'
import type { AssistantTurn, AssistantWireMessage } from './assistant-types'
import type { RawHelpDocument } from './help-corpus'
import { parseAssistantSummary } from './assistant-context'
import { modelProfileKey } from './model-context-settings'
import {
  projectPageSource,
  AssistantProjectReadError,
} from './assistant-project'

const documents = import.meta.glob<string>('../../docs/en/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const corpus: RawHelpDocument[] = Object.entries(documents).map(
  ([file, markdown]) => {
    const path = file.replace('../../docs/en/', '')
    return {
      id: path.replace(/\.md$/, '').replaceAll('/', '-').toLowerCase(),
      path,
      markdown,
    }
  }
)
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function service(turns: AssistantTurn[]) {
  const payloads: { model: string; messages: AssistantWireMessage[] }[] = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += String(chunk)
    payloads.push(JSON.parse(body))
    const turn = turns.shift()
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: turn?.toolCalls.length ? 'tool_calls' : 'stop',
            message: {
              role: 'assistant',
              content: turn?.text,
              tool_calls: turn?.toolCalls.map(call => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            },
          },
        ],
      })
    )
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(
    () =>
      new Promise(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  )
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`
  const deps: AssistantDependencies = {
    begin: async (_identity, requestId) => ({
      requestId,
      model: 'chosen-model',
      baseUrl: endpoint,
    }),
    corpus: async () => corpus,
    turn: async (_id, messages) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ model: 'chosen-model', messages }),
      })
      const body = await response.json()
      const message = body.choices[0].message
      return {
        text: message.content,
        toolCalls: (message.tool_calls ?? []).map(
          (call: {
            id: string
            function: { name: string; arguments: string }
          }) => ({
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          })
        ),
      }
    },
    cancel: vi.fn().mockResolvedValue(undefined),
  }
  return { deps, payloads }
}

describe('highest platform assistant request (#166)', () => {
  it('offers complex work only as a handoff preview without creating a task (#171)', async () => {
    const suggestion = {
      reason: 'Requires a new file and cross-file wiring',
      intent: 'Connect a new module',
      files: ['server.js', 'new.js'],
      knownProblems: 'Not implemented; preview adapter is absent',
      acceptance: 'Creator checks the two outputs',
    }
    const { deps } = await service([
      {
        text: null,
        toolCalls: [
          {
            id: 'handoff',
            name: 'propose_handoff',
            arguments: JSON.stringify(suggestion),
          },
        ],
      },
      {
        text: 'Would you like to hand this work to an external agent?',
        toolCalls: [],
      },
    ])
    const result = await runAssistantRequest(
      {
        identity: 'project',
        input: 'Add the module',
        history: [],
        locale: 'en',
        signal: new AbortController().signal,
        isCurrent: () => true,
        projectReading: true,
        project: { fingerprint: 'scope', files: [] },
      },
      deps
    )
    expect(result.handoff).toMatchObject(suggestion)
    expect(result.proposals).toBeUndefined()
  })
  it('offers one pending saved-text proposal through the same model HTTP workflow without writing (#208)', async () => {
    const source = 'const speed = 2;\n'
    const { deps } = await service([
      {
        text: null,
        toolCalls: [
          {
            id: 'read',
            name: 'read_project_text',
            arguments: '{"path":"score.js"}',
          },
        ],
      },
      {
        text: null,
        toolCalls: [
          {
            id: 'proposal',
            name: 'propose_text_change',
            arguments: JSON.stringify({
              path: 'score.js',
              version: 'v1',
              text: 'const speed = 3;\n',
              parameters: [],
            }),
          },
        ],
      },
      { text: 'Review this pending change.', toolCalls: [] },
    ])
    deps.readProject = async () => ({
      path: 'score.js',
      version: 'v1',
      text: source,
      source: null,
      offset: 0,
      endOffset: source.length,
      totalCharacters: source.length,
      nextOffset: null,
      startLine: 1,
      endLine: 2,
    })
    const result = await runAssistantRequest(
      {
        identity: 'project',
        input: 'Make it faster',
        history: [],
        locale: 'en',
        signal: new AbortController().signal,
        isCurrent: () => true,
        projectReading: true,
        project: {
          fingerprint: 'scope',
          files: [
            {
              path: 'score.js',
              version: 'v1',
              bytes: source.length,
              reason: null,
            },
          ],
        },
      },
      deps
    )
    expect(result.proposals?.[0]).toMatchObject({
      path: 'score.js',
      version: 'v1',
      sourceText: source,
      text: 'const speed = 3;\n',
    })
  })
  it('reads a large sketch in one page and prepares coordinated small patches without rewriting its contents', async () => {
    const sketch = `// ${'drawing '.repeat(3000)}\nconst tempo = 80;\n`
    const server = "const page = 'monitor.html';\n"
    const texts: Record<string, string> = {
      'public/monitor.js': sketch,
      'server.js': server,
    }
    const paths = Object.keys(texts)
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockResolvedValueOnce({
        text: null,
        toolCalls: paths.map((path, i) => ({
          id: `read-${i}`,
          name: 'read_project_text',
          arguments: JSON.stringify({ path }),
        })),
      })
      .mockRejectedValueOnce(new AssistantFlowError('outputTruncated'))
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [
          {
            id: 'sketch-patch',
            name: 'propose_text_change',
            arguments: JSON.stringify({
              path: paths[0],
              version: 'v1',
              edits: [
                { oldText: 'const tempo = 80;', newText: 'const tempo = 96;' },
              ],
              parameters: [],
            }),
          },
          {
            id: 'server-patch',
            name: 'propose_text_change',
            arguments: JSON.stringify({
              path: paths[1],
              version: 'v1',
              edits: [
                { oldText: 'monitor.html', newText: 'monitor-shell.html' },
              ],
              parameters: [],
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        text: 'Review each file, then run the project check.',
        toolCalls: [],
      })
    const deps = fixture(turn)
    deps.readProject = vi.fn(async (_owner, read) => {
      const text = texts[read.path] ?? ''
      expect(read.pageLength).toBeGreaterThanOrEqual(text.length)
      return {
        path: read.path,
        version: 'v1',
        text,
        offset: 0,
        endOffset: text.length,
        totalCharacters: text.length,
        nextOffset: null,
        startLine: 1,
        endLine: 3,
      }
    })
    let continuation: AssistantContinuation | null = null
    const request = {
      ...input(),
      projectReading: true,
      project: {
        fingerprint: 'scope',
        files: paths.map(path => ({
          path,
          version: 'v1',
          bytes: texts[path]?.length ?? 0,
          reason: null,
        })),
      },
      onContinuation: (value: AssistantContinuation | null) => {
        continuation = value
      },
    }
    await expect(runAssistantRequest(request, deps)).rejects.toMatchObject({
      code: 'outputTruncated',
    })
    const result = await runAssistantRequest(
      { ...request, continuation: continuation ?? undefined },
      deps
    )
    expect(deps.readProject).toHaveBeenCalledTimes(2)
    expect(result.proposals).toHaveLength(2)
    expect(result.proposals?.[0]?.text).toBe(sketch.replace('80;', '96;'))
    expect(result.proposals?.[1]?.text).toBe(
      server.replace('monitor.html', 'monitor-shell.html')
    )
  })
  it('sends unknown excluded sizes as unknown evidence, separately from empty saved text', async () => {
    const { deps, payloads } = await service([
      {
        text: null,
        toolCalls: [
          { id: 'inventory', name: 'list_project_files', arguments: '{}' },
        ],
      },
      {
        text: 'The binary size is unknown; the script is empty.',
        toolCalls: [],
      },
    ])
    await runAssistantRequest(
      {
        ...input(),
        projectReading: true,
        project: {
          fingerprint: 'saved',
          files: [
            {
              path: 'voice.scsyndef',
              bytes: null,
              version: null,
              reason: 'binary',
            },
            { path: 'empty.js', bytes: 0, version: 'empty', reason: null },
          ],
        },
      },
      deps
    )
    const evidence = JSON.parse(
      payloads[1]?.messages.find(message => message.toolCallId === 'inventory')
        ?.content ?? '{}'
    )
    expect(evidence.data.files[0].bytes).toBeNull()
    expect(evidence.data.files[1].bytes).toBe(0)
    expect(evidence.data.note).toContain('unknown, not an empty file')
  })

  it('reports a changed saved source as typed tool evidence without inventing its content (#168)', async () => {
    const { deps, payloads } = await service([
      {
        text: null,
        toolCalls: [
          {
            id: 'changed',
            name: 'read_project_text',
            arguments: '{"path":"score.js","version":"old"}',
          },
        ],
      },
      {
        text: 'The saved source changed; please clarify or read its new version.',
        toolCalls: [],
      },
    ])
    const config = {
      model: 'chosen-model',
      baseUrl: 'https://model.example/v1',
    }
    deps.begin = async (_owner, requestId) => ({ requestId, ...config, config })
    deps.readProject = async () => {
      throw new AssistantProjectReadError('versionConflict')
    }
    const result = await runAssistantRequest(
      {
        ...input(),
        expectedConfig: config,
        projectReading: true,
        project: {
          files: [
            { path: 'score.js', bytes: 10, version: 'current', reason: null },
          ],
          fingerprint: 'current',
        },
      },
      deps
    )
    expect(
      payloads[1]?.messages.find(message => message.toolCallId === 'changed')
        ?.content
    ).toContain('versionConflict')
    expect(result.sources).toEqual([])
  })
  it('sends the complete confirmed range, retains each source page and refuses a changed fingerprint before HTTP (#170)', async () => {
    const { deps, payloads } = await service([
      { text: 'The included saved range has two pages.', toolCalls: [] },
    ])
    const config = {
      model: 'chosen-model',
      baseUrl: 'https://model.example/v1',
    }
    const snapshot = {
      files: [{ path: 'long.js', bytes: 6, version: 'v1', reason: null }],
      fingerprint: 'v1',
    }
    const pages = [
      {
        path: 'long.js',
        version: 'v1',
        text: 'AAA',
        offset: 0,
        endOffset: 3,
        totalCharacters: 6,
        nextOffset: 3,
        startLine: 1,
        endLine: 1,
      },
      {
        path: 'long.js',
        version: 'v1',
        text: 'BBB',
        offset: 3,
        endOffset: 6,
        totalCharacters: 6,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      },
    ]
    deps.begin = async (_owner, requestId) => ({ requestId, ...config, config })
    deps.projectInventory = async () => snapshot
    const request = {
      ...input(),
      identity: 'owner',
      expectedConfig: config,
      projectReading: true,
      project: snapshot,
      wholeProjectFingerprint: 'v1',
      consumers: [
        {
          id: 'whole',
          kind: 'projectFragment' as const,
          owner: 'owner',
          serviceKey: modelProfileKey(config),
          authorized: true,
          text: JSON.stringify({ wholeReadableProject: pages }),
          sources: pages.map(page => projectPageSource(page, 'en')),
        },
      ],
    }
    const result = await runAssistantRequest(request, deps)
    expect(JSON.stringify(payloads[0]?.messages)).toContain('AAA')
    expect(JSON.stringify(payloads[0]?.messages)).toContain('BBB')
    expect(
      result.sources.map(source => [
        source.project?.offset,
        source.project?.text,
      ])
    ).toEqual([
      [0, 'AAA'],
      [3, 'BBB'],
    ])
    deps.projectInventory = async () => ({
      ...snapshot,
      fingerprint: 'changed',
    })
    await expect(
      runAssistantRequest(
        { ...request, signal: new AbortController().signal },
        deps
      )
    ).rejects.toMatchObject({ code: 'projectScopeChanged' })
    expect(payloads).toHaveLength(1)
  })
  it('mixes installed documents and authorized saved project pages in one observable request loop (#168)', async () => {
    const { deps, payloads } = await service([
      {
        text: null,
        toolCalls: [
          {
            id: 'project-read',
            name: 'read_project_text',
            arguments: JSON.stringify({ path: 'score.js' }),
          },
        ],
      },
      {
        text: null,
        toolCalls: [
          {
            id: 'help-search',
            name: 'search_help',
            arguments: JSON.stringify({ query: 'manifest' }),
          },
        ],
      },
      {
        text: 'The saved tempo is 80; the remaining files have not been read.',
        toolCalls: [],
      },
    ])
    const config = {
      model: 'chosen-model',
      baseUrl: 'https://model.example/v1',
    }
    deps.begin = async (_owner, requestId) => ({ requestId, ...config, config })
    deps.readProject = async () => ({
      path: 'score.js',
      version: 'saved-80',
      text: 'const tempo = 80;',
      offset: 0,
      endOffset: 17,
      totalCharacters: 17,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    })
    const result = await runAssistantRequest(
      {
        ...input(),
        expectedConfig: config,
        projectReading: true,
        project: {
          files: [
            { path: 'score.js', bytes: 17, version: 'saved-80', reason: null },
          ],
          fingerprint: 'scope-1',
        },
      },
      deps
    )
    expect(payloads).toHaveLength(3)
    expect(payloads[0]?.messages[0]?.content).toContain('saved project text')
    expect(
      payloads[1]?.messages.find(
        message => message.toolCallId === 'project-read'
      )?.content
    ).toContain('const tempo = 80;')
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        project: expect.objectContaining({
          path: 'score.js',
          version: 'saved-80',
          startLine: 1,
        }),
      })
    )
    expect(result.sources.some(source => !source.project)).toBe(true)
    expect(JSON.stringify(payloads)).not.toContain('UNSAVED-DRAFT')
  })
  it('requests only summary JSON without the conversational document-budget footer (#234)', async () => {
    const sections = {
      userDecisions: [{ text: '保留预算测试决定', sourceIds: ['summary-u'] }],
      assistantSuggestions: [],
      verifiedFacts: [],
      unverifiedFacts: [],
      openQuestions: [],
    }
    const { deps, payloads } = await service([
      { text: JSON.stringify(sections), toolCalls: [] },
    ])
    const result = await runAssistantRequest(
      { ...input(), purpose: 'summary' },
      deps
    )
    const policy = payloads[0]?.messages[0]?.content ?? ''
    expect(policy).not.toContain('Document tool budget:')
    expect(policy).not.toContain('The final line gives')
    expect(policy).toContain('Return only a JSON object')
    expect(parseAssistantSummary(result.text, ['summary-u'])).toEqual(sections)
    expect(payloads).toHaveLength(1)
  })

  it('organizes large escaped project pages instead of stopping at the old cumulative result budget', async () => {
    let ordinal = 0
    const deps = fixture(async () =>
      ordinal >= 4
        ? { text: 'Read all four saved pages.', toolCalls: [] }
        : {
            text: null,
            toolCalls: [
              {
                id: `page-${ordinal}`,
                name: 'read_project_text',
                arguments: JSON.stringify({
                  path: 'score.js',
                  offset: ordinal++ * 65536,
                  pageLength: 65536,
                }),
              },
            ],
          }
    )
    deps.readProject = async (_owner, read) => ({
      path: 'score.js',
      version: 'v1',
      text: '"'.repeat(65536),
      offset: read.offset,
      endOffset: read.offset + 65536,
      totalCharacters: 262144,
      nextOffset: read.offset + 65536,
      startLine: 1,
      endLine: 1,
    })
    await expect(
      runAssistantRequest(
        {
          ...input(),
          projectReading: true,
          project: {
            fingerprint: 'scope',
            files: [
              { path: 'score.js', version: 'v1', bytes: 262144, reason: null },
            ],
          },
        },
        deps
      )
    ).resolves.toMatchObject({ text: 'Read all four saved pages.' })
    expect(ordinal).toBe(4)
  })
  it('returns short bounded document pages and references overlapping text without resending it', async () => {
    const sent: AssistantWireMessage[][] = []
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockImplementation(async (_id, messages) => {
        sent.push(structuredClone(messages))
        const ordinal = sent.length
        return ordinal <= 3
          ? {
              text: null,
              toolCalls: [
                {
                  id: `page-${ordinal}`,
                  name: 'read_help_section',
                  arguments: JSON.stringify({
                    docId: 'reference-manifest',
                    sectionId: 'long-section',
                    offset: ordinal === 1 ? 0 : 600,
                    ...(ordinal === 1 ? {} : { pageLength: 1200 }),
                  }),
                },
              ],
            }
          : { text: 'Read only the supplied ranges.', toolCalls: [] }
      })
    const deps = fixture(turn)
    deps.corpus = async () =>
      corpus.map(doc =>
        doc.id === 'reference-manifest'
          ? {
              ...doc,
              markdown: `# Manifest\n\n## Long section\n${'x'.repeat(10000)}`,
            }
          : doc
      )
    const result = await runAssistantRequest(input(), deps)
    const tools = sent
      .at(-1)
      ?.filter(message => message.role === 'tool')
      .map(message => JSON.parse(message.content ?? '{}'))
    expect(tools?.[0]).toMatchObject({ offset: 0, nextOffset: 1200 })
    expect(tools?.[0].segments[0].markdown).toHaveLength(1200)
    expect(tools?.[1].segments[0]).toMatchObject({
      offset: 1200,
      endOffset: 1800,
    })
    expect(tools?.[1].reusedRanges).toContainEqual(
      expect.objectContaining({
        offset: 600,
        endOffset: 1200,
        toolCallId: 'page-1',
      })
    )
    expect(tools?.[2].segments).toEqual([])
    expect(JSON.stringify(tools?.[2])).not.toContain('xxxxx')
    expect(
      result.sources.every(
        source => source.version && source.endOffset !== undefined
      )
    ).toBe(true)
  })
  it('filters consumers and project-derived summaries through the current read scope and service identity', async () => {
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockResolvedValue({ text: 'Answer', toolCalls: [] })
    const consumer = {
      id: 'private',
      kind: 'attachment' as const,
      text: 'PRIVATE-ATTACHMENT',
      owner: 'owner',
      serviceKey: '["https://test.example","test"]',
      authorized: true,
    }
    await runAssistantRequest(
      { ...input(), consumers: [consumer], projectReading: false },
      fixture(turn)
    )
    expect(JSON.stringify(turn.mock.calls)).not.toContain('PRIVATE-ATTACHMENT')
    turn.mockClear()
    await runAssistantRequest(
      { ...input(), consumers: [consumer], projectReading: true },
      fixture(turn)
    )
    expect(turn.mock.calls[0]?.[1]).toContainEqual({
      role: 'user',
      content: 'PRIVATE-ATTACHMENT',
      contextKind: 'attachment',
    })
    turn.mockClear()
    await runAssistantRequest(
      {
        ...input(),
        consumers: [{ ...consumer, owner: 'other' }],
        projectReading: true,
      },
      fixture(turn)
    )
    expect(JSON.stringify(turn.mock.calls)).not.toContain('PRIVATE-ATTACHMENT')
    turn.mockClear()
    await runAssistantRequest(
      {
        ...input(),
        history: [
          {
            id: 'private-original',
            role: 'user',
            text: 'PRIVATE-ORIGINAL',
            scope: 'project',
            status: 'completed',
            sources: [],
            contextServiceKey: '["https://test.example","test"]',
          },
          {
            id: 'private-summary',
            role: 'assistant',
            text: 'PRIVATE-SUMMARY',
            scope: 'platform',
            status: 'completed',
            sources: [],
            contextServiceKey: '["https://test.example","test"]',
            contextMarker: {
              type: 'summary',
              sourceIds: ['private-original'],
              serviceKey: consumer.serviceKey,
              sections: {
                userDecisions: [
                  { text: 'PRIVATE-DERIVED', sourceIds: ['private-original'] },
                ],
                assistantSuggestions: [],
                verifiedFacts: [],
                unverifiedFacts: [],
                openQuestions: [],
              },
            },
          },
        ],
      },
      fixture(turn)
    )
    expect(JSON.stringify(turn.mock.calls)).not.toContain('PRIVATE-')
  })
  it('sends recent complete rounds while retaining all local messages and excluding project-derived pairs', async () => {
    const history = Array.from({ length: 10 }, (_, index) => [
      {
        id: `u-${index}`,
        role: 'user' as const,
        text: `Question ${index}`,
        status: 'completed' as const,
        scope: 'platform' as const,
        sources: [],
        contextServiceKey: '["https://test.example","test"]',
      },
      {
        id: `a-${index}`,
        role: 'assistant' as const,
        text: `Answer ${index}`,
        status: 'completed' as const,
        scope: 'platform' as const,
        sources: [],
        contextServiceKey: '["https://test.example","test"]',
      },
    ]).flat()
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockResolvedValue({ text: 'Recent answer', toolCalls: [] })
    await runAssistantRequest({ ...input(), history }, fixture(turn))
    const sent = turn.mock.calls[0]?.[1]
    expect(sent).toHaveLength(14)
    expect(JSON.stringify(sent)).not.toContain('Question 0')
    expect(JSON.stringify(sent)).toContain('Question 4')
    expect(history).toHaveLength(20)
  })
  it('reports each call separately and retains an incomplete round when usage is missing', async () => {
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [
          {
            id: 'usage-source',
            name: 'search_help',
            arguments: '{"query":"outputChannels"}',
          },
        ],
        usage: {
          inputTokens: 120,
          outputTokens: 10,
          cachedInputTokens: null,
          reasoningTokens: null,
        },
      })
      .mockResolvedValueOnce({ text: 'Documented answer', toolCalls: [] })
    const onUsage = vi.fn()
    await runAssistantRequest({ ...input(), onUsage }, fixture(turn))
    expect(onUsage.mock.calls.at(-1)?.[0]).toMatchObject({
      calls: [
        {
          inputTokens: 120,
          outputTokens: 10,
          cachedInputTokens: null,
          reasoningTokens: null,
        },
        null,
      ],
      complete: false,
    })
  })
  const input = (signal = new AbortController().signal) => ({
    identity: 'owner',
    input: 'Explain PNDS',
    history: [],
    locale: 'en' as const,
    signal,
    isCurrent: () => true,
  })
  const fixture = (
    turn: AssistantDependencies['turn']
  ): AssistantDependencies => ({
    corpus: async () => corpus,
    begin: async (_owner, requestId) => ({
      requestId,
      model: 'test',
      baseUrl: 'https://test.example',
    }),
    turn,
    cancel: vi.fn().mockResolvedValue(undefined),
  })

  it('reports incomplete installed documentation before starting a model request', async () => {
    const deps = fixture(vi.fn())
    deps.corpus = async () => []
    deps.begin = vi.fn(deps.begin)
    await expect(runAssistantRequest(input(), deps)).rejects.toMatchObject({
      code: 'corpusUnavailable',
    })
    expect(deps.begin).not.toHaveBeenCalled()
  })

  it('retains the sources already supplied to the model if a later turn fails', async () => {
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockResolvedValueOnce({
        text: 'Checking the contract.',
        toolCalls: [
          {
            id: 'one',
            name: 'search_help',
            arguments: '{"query":"outputChannels"}',
          },
        ],
      })
      .mockRejectedValueOnce(new AssistantFlowError('network'))
    const onSources = vi.fn()
    await expect(
      runAssistantRequest({ ...input(), onSources }, fixture(turn))
    ).rejects.toMatchObject({ code: 'network' })
    expect(onSources.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ docId: 'reference-manifest', locale: 'en' }),
      ])
    )
  })

  it.each([
    ['shell', '{}'],
    ['search_help', '{'],
    ['search_help', 'null'],
    ['search_help', '{"query":"outputChannels","path":"/private/project"}'],
    ['read_help_section', '{"docId":"../../secret","sectionId":"anything"}'],
    [
      'read_help_section',
      '{"docId":"reference-manifest","sectionId":"anything","pageLength":2001}',
    ],
    [
      'read_help_section',
      '{"docId":"reference-manifest","sectionId":"anything","pageLength":0}',
    ],
    [
      'read_help_section',
      '{"docId":"reference-manifest","sectionId":"unknown","offset":-1}',
    ],
  ])(
    'returns a corrective refusal for untrusted %s arguments without executing them',
    async (name, args) => {
      const turn = vi
        .fn()
        .mockResolvedValueOnce({
          text: null,
          toolCalls: [{ id: 'one', name, arguments: args }],
        })
        .mockImplementationOnce(async (_id, messages) => {
          const refusal = JSON.parse(messages.at(-1)?.content ?? '{}')
          expect(refusal.status).toBe('refused')
          expect(refusal.reason).toMatch(
            /unknownTool|invalidToolArguments|invalidDocumentReference/
          )
          return { text: 'The invalid operation did not run.', toolCalls: [] }
        })
      const deps = fixture(turn)
      const result = await runAssistantRequest(input(), deps)
      expect(result.text).toBe('The invalid operation did not run.')
      expect(result.sources).toEqual([])
      expect(turn).toHaveBeenCalledTimes(2)
      expect(deps.cancel).toHaveBeenCalled()
    }
  )

  it('stops repeated document calls with no progress', async () => {
    let id = 0
    const turn = vi.fn(async () => ({
      text: null,
      toolCalls: [
        {
          id: String(++id),
          name: 'search_help',
          arguments: JSON.stringify({
            query: id === 1 ? 'outputChannels' : ' OUTPUTCHANNELS ',
          }),
        },
      ],
    }))
    await expect(
      runAssistantRequest(input(), fixture(turn))
    ).rejects.toMatchObject({ code: 'noProgress' })
    expect(turn).toHaveBeenCalledTimes(3)
  })

  it('rejects oversized context before opening a paid request and excludes historical project data', async () => {
    const deps = fixture(
      vi.fn().mockResolvedValue({
        text: 'No local sources were needed for this greeting.',
        toolCalls: [],
      })
    )
    const begin = vi.fn(deps.begin)
    deps.begin = begin
    await expect(
      runAssistantRequest({ ...input(), input: '大'.repeat(200000) }, deps)
    ).rejects.toMatchObject({ code: 'contextBytesExceeded' })
    expect(begin).not.toHaveBeenCalled()
    const hidden = 'historical-private-file-snapshot'
    await runAssistantRequest(
      {
        ...input(),
        history: [
          {
            id: 'old',
            role: 'assistant',
            text: hidden,
            sources: [],
            contextServiceKey: '["https://test.example","test"]',
            status: 'completed',
            scope: 'project',
          },
        ],
      },
      deps
    )
    expect(JSON.stringify(vi.mocked(deps.turn).mock.calls)).not.toContain(
      hidden
    )
  })

  it('does not replay an attachment-bearing record even if a consumer incorrectly labels it as platform text', async () => {
    const turn = vi
      .fn()
      .mockResolvedValue({ text: 'A platform-only reply.', toolCalls: [] })
    await runAssistantRequest(
      {
        ...input(),
        history: [
          {
            id: 'snapshot',
            role: 'user',
            text: 'Private historical question',
            status: 'completed',
            scope: 'platform',
            sources: [],
            contextServiceKey: '["https://test.example","test"]',
            attachments: [
              {
                id: 'attachment',
                projectKey: 'a'.repeat(64),
                path: 'client.js',
                startLine: 1,
                endLine: 1,
                source: 'draft',
                version: 'old-disk-version',
                text: 'Private captured draft',
              },
            ],
          },
        ],
      },
      fixture(turn)
    )
    expect(JSON.stringify(turn.mock.calls)).not.toContain(
      'Private historical question'
    )
    expect(JSON.stringify(turn.mock.calls)).not.toContain(
      'Private captured draft'
    )
  })

  it('keeps a finite loop backstop when a model makes only unrelated searches', async () => {
    let call = 0
    const turn = vi.fn(async () => ({
      text: null,
      toolCalls: [
        {
          id: String(++call),
          name: 'search_help',
          arguments: JSON.stringify({ query: `absent-${call}` }),
        },
      ],
    }))
    await expect(
      runAssistantRequest(input(), fixture(turn))
    ).rejects.toMatchObject({ code: 'budgetExceeded' })
    expect(turn).toHaveBeenCalledTimes(128)
  })

  it('keeps produced text when stopped and ignores a released response from the old owner', async () => {
    let resolveTurn!: (turn: AssistantTurn) => void
    let waiting!: () => void
    const secondTurn = new Promise<void>(resolve => {
      waiting = resolve
    })
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockResolvedValueOnce({
        text: 'I am checking the audio declaration.',
        toolCalls: [
          {
            id: 'one',
            name: 'search_help',
            arguments: '{"query":"outputChannels"}',
          },
        ],
      })
      .mockImplementationOnce(() => {
        waiting()
        return new Promise(resolve => {
          resolveTurn = resolve
        })
      })
    const controller = new AbortController()
    let current = true
    const onText = vi.fn()
    const onActivity = vi.fn()
    const result = runAssistantRequest(
      {
        ...input(controller.signal),
        isCurrent: () => current,
        onText,
        onActivity,
      },
      fixture(turn)
    )
    await secondTurn
    current = false
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'cancelled' })
    resolveTurn({
      text: 'This late response must not be displayed.',
      toolCalls: [],
    })
    await Promise.resolve()
    expect(onText).toHaveBeenCalledExactlyOnceWith('')
    expect(onActivity).toHaveBeenLastCalledWith([
      'I am checking the audio declaration.',
    ])
  })

  it('keeps a long request active beyond two minutes until explicitly stopped', async () => {
    vi.useFakeTimers()
    try {
      const deps = fixture(() => new Promise(() => undefined))
      const controller = new AbortController()
      const result = runAssistantRequest(input(controller.signal), deps).then(
        () => 'completed',
        (error: AssistantFlowError) => error.code
      )
      await vi.advanceTimersByTimeAsync(300000)
      expect(deps.cancel).not.toHaveBeenCalled()
      controller.abort()
      expect(await result).toBe('cancelled')
      expect(deps.cancel).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('continues after a transport timeout with completed tools, original budgets and no incomplete streamed turn', async () => {
    vi.useFakeTimers()
    try {
      let continuation: AssistantContinuation | null = null
      const turn = vi
        .fn<AssistantDependencies['turn']>()
        .mockResolvedValueOnce({
          text: 'Checking routing.',
          toolCalls: [
            {
              id: 'read-once',
              name: 'search_help',
              arguments: '{"query":"outputChannels"}',
            },
          ],
        })
        .mockImplementationOnce((_id, _messages, onText) => {
          onText?.('Unfinished response must not become completed context.')
          throw new AssistantFlowError('timeout')
        })
        .mockResolvedValueOnce({
          text: 'The documented answer.',
          toolCalls: [],
        })
      const deps = fixture(turn)
      deps.begin = vi.fn(deps.begin)
      const request = {
        ...input(),
        onContinuation: (value: AssistantContinuation | null) => {
          continuation = value
        },
      }
      const first = runAssistantRequest(request, deps)
      const failure = expect(first).rejects.toMatchObject({
        code: 'timeout',
      })
      await vi.advanceTimersByTimeAsync(0)
      await failure
      expect(continuation).not.toBeNull()
      expect(continuation).toMatchObject({ activity: ['Checking routing.'] })
      const result = await runAssistantRequest(
        { ...request, continuation: continuation ?? undefined },
        deps
      )
      expect(result.text).toBe('The documented answer.')
      const payload = turn.mock.calls.at(-1)?.[1] ?? []
      expect(
        payload.filter(message => message.content === request.input)
      ).toHaveLength(1)
      expect(
        payload.some(
          message =>
            message.role === 'tool' && message.toolCallId === 'read-once'
        )
      ).toBe(true)
      expect(payload[0]?.content).toContain('"remainingCalls":255')
      expect(JSON.stringify(payload)).not.toContain('Unfinished response')
      expect(deps.begin).toHaveBeenCalledTimes(2)
      expect(turn.mock.calls[0]?.[0]).not.toBe(turn.mock.calls[2]?.[0])
      expect(continuation).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    'identity',
    'input',
    'locale',
    'projectReading',
    'expectedConfig',
    'project',
    'attachments',
  ] as const)(
    'rejects changed %s before starting a continuation session',
    async field => {
      let continuation: AssistantContinuation | null = null
      const deps = fixture(async () => {
        throw new AssistantFlowError('timeout')
      })
      deps.begin = vi.fn(deps.begin)
      const request = {
        ...input(),
        onContinuation: (value: AssistantContinuation | null) => {
          continuation = value
        },
      }
      await expect(runAssistantRequest(request, deps)).rejects.toMatchObject({
        code: 'timeout',
      })
      expect(continuation).not.toBeNull()
      const changed = {
        identity: 'another-owner',
        input: 'Another question',
        locale: 'zh-CN',
        projectReading: true,
        expectedConfig: { baseUrl: 'https://another.example', model: 'other' },
        project: { fingerprint: 'changed-saved-version', files: [] },
        attachments: [],
      }
      await expect(
        runAssistantRequest(
          {
            ...request,
            [field]: changed[field],
            continuation: continuation ?? undefined,
          },
          deps
        )
      ).rejects.toMatchObject({ code: 'projectScopeChanged' })
      expect(deps.begin).toHaveBeenCalledOnce()
    }
  )

  it('cannot reset the hard tool-call budget by continuing an interrupted task', async () => {
    let continuation: AssistantContinuation | null = null
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockResolvedValueOnce({
        text: null,
        toolCalls: [
          {
            id: 'first',
            name: 'search_help',
            arguments: '{"query":"outputChannels"}',
          },
        ],
      })
      .mockRejectedValueOnce(new AssistantFlowError('timeout'))
      .mockResolvedValueOnce({
        text: null,
        toolCalls: Array.from({ length: 256 }, (_, i) => ({
          id: `next-${i}`,
          name: 'search_help',
          arguments: JSON.stringify({ query: `unique-query-${i}` }),
        })),
      })
    const deps = fixture(turn)
    const request = {
      ...input(),
      onContinuation: (value: AssistantContinuation | null) => {
        continuation = value
      },
    }
    await expect(runAssistantRequest(request, deps)).rejects.toMatchObject({
      code: 'timeout',
    })
    expect(continuation).not.toBeNull()
    await expect(
      runAssistantRequest(
        { ...request, continuation: continuation ?? undefined },
        deps
      )
    ).rejects.toMatchObject({ code: 'toolCallsExceeded' })
    expect(turn).toHaveBeenCalledTimes(3)
  })

  it('bounds cumulative failed model attempts across continuations to the native and history limit', async () => {
    let continuation: AssistantContinuation | null = null
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockRejectedValue(new AssistantFlowError('timeout'))
    const deps = fixture(turn)
    deps.begin = vi.fn(deps.begin)
    const request = {
      ...input(),
      onContinuation: (value: AssistantContinuation | null) => {
        continuation = value
      },
    }
    for (let attempt = 0; attempt < 128; attempt++) {
      await expect(
        runAssistantRequest(
          { ...request, continuation: continuation ?? undefined },
          deps
        )
      ).rejects.toMatchObject({ code: 'timeout' })
    }
    await expect(
      runAssistantRequest(
        { ...request, continuation: continuation ?? undefined },
        deps
      )
    ).rejects.toMatchObject({ code: 'budgetExceeded' })
    expect(deps.begin).toHaveBeenCalledTimes(128)
    expect(turn).toHaveBeenCalledTimes(128)
  })

  it('streams the current reply separately from completed tool-turn commentary', async () => {
    let progress!: (text: string) => void
    let finish!: (turn: AssistantTurn) => void
    const turn = vi
      .fn<AssistantDependencies['turn']>()
      .mockResolvedValueOnce({
        text: 'Checking the declaration.',
        toolCalls: [
          {
            id: 'search',
            name: 'search_help',
            arguments: '{"query":"outputChannels"}',
          },
        ],
      })
      .mockImplementationOnce((_id, _messages, onText) => {
        if (!onText) throw new Error('Expected a streaming callback')
        progress = onText
        return new Promise(resolve => {
          finish = resolve
        })
      })
    const onText = vi.fn()
    const controller = new AbortController()
    const result = runAssistantRequest(
      { ...input(controller.signal), onText },
      fixture(turn)
    )
    await vi.waitFor(() => expect(progress).toBeDefined())
    progress('The declared count')
    expect(onText).toHaveBeenLastCalledWith('The declared count')
    progress('The declared count is not a hardware test.')
    finish({
      text: 'The declared count is not a hardware test.',
      toolCalls: [],
    })
    await expect(result).resolves.toMatchObject({
      text: 'The declared count is not a hardware test.',
    })
    const updates = onText.mock.calls.length
    progress('A queued partial event after completion')
    expect(onText).toHaveBeenCalledTimes(updates)
    controller.abort()
  })

  it('ignores streamed chunks after cancellation while preserving the partial answer', async () => {
    let progress!: (text: string) => void
    const deps = fixture((_id, _messages, onText) => {
      if (!onText) throw new Error('Expected a streaming callback')
      progress = onText
      return new Promise(() => undefined)
    })
    const onText = vi.fn()
    const controller = new AbortController()
    const result = runAssistantRequest(
      { ...input(controller.signal), onText },
      deps
    )
    await vi.waitFor(() => expect(progress).toBeDefined())
    progress('Partial answer')
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'cancelled' })
    progress('Late answer')
    expect(onText).toHaveBeenCalledExactlyOnceWith('Partial answer')
  })

  it('preserves a typed native failure without retrying the request', async () => {
    const turn = vi.fn().mockRejectedValue(new AssistantFlowError('network'))
    await expect(
      runAssistantRequest(input(), fixture(turn))
    ).rejects.toMatchObject({ code: 'network' })
    expect(turn).toHaveBeenCalledTimes(1)
  })

  it('cancels the known request token while credential preparation is still pending', async () => {
    let resolveBegin!: (session: {
      requestId: string
      model: string
      baseUrl: string
    }) => void
    let requestedToken = ''
    let entered!: () => void
    const preparing = new Promise<void>(resolve => {
      entered = resolve
    })
    const deps: AssistantDependencies = {
      corpus: async () => corpus,
      begin: (_identity, token) => {
        requestedToken = token
        entered()
        return new Promise(resolve => {
          resolveBegin = resolve
        })
      },
      turn: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new AbortController()
    const result = runAssistantRequest(
      {
        identity: 'owner',
        input: 'Explain channels',
        history: [],
        locale: 'en',
        signal: controller.signal,
        isCurrent: () => true,
      },
      deps
    )
    await preparing
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'cancelled' })
    expect(requestedToken).toBeTruthy()
    expect(deps.cancel).toHaveBeenCalledWith(requestedToken)
    expect(deps.turn).not.toHaveBeenCalled()
    resolveBegin({
      requestId: requestedToken,
      model: 'test',
      baseUrl: 'https://model.example',
    })
  })
  it('uses the installed corpus for multiple tool turns, derives actual sources and sends no project data', async () => {
    const { deps, payloads } = await service([
      {
        text: null,
        toolCalls: [
          {
            id: 'search-1',
            name: 'search_help',
            arguments: '{"query":"outputChannels"}',
          },
        ],
      },
      {
        text: null,
        toolCalls: [
          {
            id: 'read-1',
            name: 'read_help_section',
            arguments:
              '{"docId":"reference-manifest","sectionId":"manifest-structure"}',
          },
        ],
      },
      {
        text: 'The manifest declares the project audio configuration.',
        toolCalls: [],
      },
    ])
    // Use a real section anchor rather than tying the fixture to prose.
    const manifest = corpus.find(doc => doc.id === 'reference-manifest')
    if (!manifest) throw new Error('The shipped manifest document is missing')
    const { splitSections } = await import('./help-markdown')
    const section = splitSections(manifest.markdown).find(section =>
      section.text.includes('outputChannels')
    )
    if (!section) throw new Error('The shipped output declaration is missing')
    const originalTurn = deps.turn
    deps.turn = async (id, messages) => {
      const turn = await originalTurn(id, messages)
      if (turn.toolCalls[0]?.name === 'read_help_section')
        turn.toolCalls[0].arguments = JSON.stringify({
          docId: manifest.id,
          sectionId: section.id,
        })
      return turn
    }
    const result = await runAssistantRequest(
      {
        identity: 'native-identity-never-in-payload',
        input: 'How are output channels declared?',
        history: [],
        locale: 'en',
        signal: new AbortController().signal,
        isCurrent: () => true,
      },
      deps
    )
    expect(result.text).toContain('manifest')
    expect(result.sources).toContainEqual(
      expect.objectContaining({
        docId: 'reference-manifest',
        sectionId: section.id,
        title: expect.any(String),
        locale: 'en',
      })
    )
    expect(payloads).toHaveLength(3)
    expect(payloads.every(payload => payload.model === 'chosen-model')).toBe(
      true
    )
    const transmitted = JSON.stringify(payloads)
    expect(transmitted).toContain('outputChannels')
    expect(transmitted).not.toContain('native-identity-never-in-payload')
    expect(
      payloads[2]?.messages.filter(message => message.role === 'tool')
    ).toHaveLength(2)
  })
})
