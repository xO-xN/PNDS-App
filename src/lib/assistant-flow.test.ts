/// <reference types="node" />
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AssistantFlowError,
  runAssistantRequest,
  type AssistantDependencies,
} from './assistant-flow'
import type { AssistantTurn, AssistantWireMessage } from './assistant-types'
import type { RawHelpDocument } from './help-corpus'
import { logger } from './logger'
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

  it('keeps the independent result-size limit even when pages fit the token and call budgets', async () => {
    let ordinal = 0
    const onSources = vi.fn()
    const deps = fixture(async () => ({
      text: null,
      toolCalls: [
        {
          id: `escaped-${ordinal}`,
          name: 'read_help_section',
          arguments: JSON.stringify({
            docId: 'reference-manifest',
            sectionId: 'json',
            offset: ordinal++ * 2000,
            pageLength: 2000,
          }),
        },
      ],
    }))
    deps.corpus = async () =>
      corpus.map(doc =>
        doc.id === 'reference-manifest'
          ? {
              ...doc,
              markdown: `# Manifest\n\n## JSON\n${'\\"'.repeat(20000)}`,
            }
          : doc
      )
    await expect(
      runAssistantRequest({ ...input(), onSources }, deps)
    ).rejects.toMatchObject({ code: 'toolCharactersExceeded' })
    expect(ordinal).toBeLessThanOrEqual(8)
    expect(onSources.mock.calls.at(-1)?.[0].length).toBeGreaterThan(0)
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
    'rejects untrusted %s arguments without a follow-up request',
    async (name, args) => {
      const turn = vi.fn().mockResolvedValue({
        text: null,
        toolCalls: [{ id: 'one', name, arguments: args }],
      })
      const deps = fixture(turn)
      await expect(runAssistantRequest(input(), deps)).rejects.toMatchObject({
        code: 'invalidTool',
      })
      expect(turn).toHaveBeenCalledTimes(1)
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
      runAssistantRequest({ ...input(), input: '大'.repeat(50000) }, deps)
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

  it('stops at the tool-call budget without an automatic retry', async () => {
    const warn = vi.spyOn(logger, 'warn')
    let call = 0
    const turn = vi.fn(async () => ({
      text: null,
      toolCalls: [
        {
          id: String(++call),
          name: 'search_help',
          arguments: JSON.stringify({ query: `absent-query-${call}` }),
        },
      ],
    }))
    await expect(
      runAssistantRequest(input(), fixture(turn))
    ).rejects.toMatchObject({ code: 'toolCallsExceeded' })
    expect(turn).toHaveBeenCalledTimes(9)
    expect(warn).toHaveBeenCalledWith('[assistant-budget] limit reached', {
      kind: 'toolCalls',
      used: 9,
      limit: 8,
    })
    warn.mockRestore()
  })

  it('allows a budget-aware model to finish at the tool limit and resets the budget for an explicit new request', async () => {
    let calls = 0
    const remaining: number[] = []
    const characters: number[] = []
    const turn = vi.fn<AssistantDependencies['turn']>(async (_id, messages) => {
      const policy = messages[0]?.content ?? ''
      const raw = policy.split('\nDocument tool budget: ')[1]
      const budget = raw ? JSON.parse(raw) : null
      remaining.push(budget?.remainingCalls ?? -1)
      characters.push(budget?.remainingResultCharacters ?? -1)
      if (budget?.remainingCalls === 0)
        return {
          text: 'No matching section was found; please narrow the question.',
          toolCalls: [],
        }
      return {
        text: null,
        toolCalls: [
          {
            id: `call-${++calls}`,
            name: 'search_help',
            arguments: JSON.stringify({ query: `absent-query-${calls}` }),
          },
        ],
      }
    })
    const deps = fixture(turn)
    await expect(runAssistantRequest(input(), deps)).resolves.toMatchObject({
      text: 'No matching section was found; please narrow the question.',
    })
    expect(remaining).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(characters).toEqual(
      remaining.map(
        (_, index) =>
          24000 -
          index *
            '{"locale":"en","offsetUnit":"utf16CodeUnits","hits":[]}'.length
      )
    )
    remaining.length = 0
    characters.length = 0
    await runAssistantRequest(input(), deps)
    expect(remaining).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(characters[0]).toBe(24000)
  })

  it('returns explicit short section offsets and stops at the independent tool-call budget', async () => {
    let offset = 0
    const supplied: AssistantWireMessage[][] = []
    const deps = fixture(async (_id, messages) => {
      supplied.push(structuredClone(messages))
      const current = offset
      offset += 1200
      return {
        text: null,
        toolCalls: [
          {
            id: `read-${current}`,
            name: 'read_help_section',
            arguments: JSON.stringify({
              docId: 'reference-manifest',
              sectionId: 'long-section',
              offset: current,
            }),
          },
        ],
      }
    })
    deps.corpus = async () =>
      corpus.map(doc =>
        doc.id === 'reference-manifest'
          ? {
              ...doc,
              markdown: `# Manifest\n\n## Long section\n${'x'.repeat(30000)}`,
            }
          : doc
      )
    await expect(runAssistantRequest(input(), deps)).rejects.toMatchObject({
      code: 'toolCallsExceeded',
    })
    expect(supplied).toHaveLength(9)
    const firstResult = supplied[1]?.find(
      message => message.role === 'tool'
    )?.content
    const section = JSON.parse(firstResult ?? '{}')
    expect(section.segments[0].markdown).toHaveLength(1200)
    expect(section.nextOffset).toBe(1200)
    expect(section.totalCharacters).toBeGreaterThan(1200)
    // The ninth call is rejected locally; all earlier pages stay complete.
    expect(
      supplied.at(-1)?.filter(message => message.role === 'tool')
    ).toHaveLength(8)
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
    const result = runAssistantRequest(
      { ...input(controller.signal), isCurrent: () => current, onText },
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
    expect(onText).toHaveBeenCalledExactlyOnceWith(
      'I am checking the audio declaration.'
    )
  })

  it('bounds the entire request and cancels the native session on timeout', async () => {
    vi.useFakeTimers()
    try {
      const deps = fixture(() => new Promise(() => undefined))
      const result = runAssistantRequest(input(), deps)
      const assertion = expect(result).rejects.toMatchObject({
        code: 'timeout',
      })
      await vi.advanceTimersByTimeAsync(120000)
      await assertion
      expect(deps.cancel).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows streamed text before completion and joins tool turns once', async () => {
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
    expect(onText).toHaveBeenLastCalledWith(
      'Checking the declaration.\n\nThe declared count'
    )
    progress('The declared count is not a hardware test.')
    finish({
      text: 'The declared count is not a hardware test.',
      toolCalls: [],
    })
    await expect(result).resolves.toMatchObject({
      text: 'Checking the declaration.\n\nThe declared count is not a hardware test.',
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
