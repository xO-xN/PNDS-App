import { expect, it, vi } from 'vitest'
import {
  buildAssistantMessages,
  runAssistantRequest,
  type AssistantDependencies,
} from './assistant-flow'
import { modelProfileKey } from './model-context-settings'
import {
  compactWorkingContext,
  contextBytes,
  WORKING_CONTEXT_BYTES,
} from './assistant-working-context'
import type { AssistantWireMessage } from './assistant-types'
import { HELP_BOOKS } from './help-corpus'

it('compacts old complete history rounds without truncating reasoning or mutating saved history', () => {
  const messages: AssistantWireMessage[] = [
    { role: 'system', content: 'Policy' },
    { role: 'user', content: 'Old question', contextKind: 'history' },
    {
      role: 'assistant',
      content: 'Old answer',
      reasoningContent: 'old'.repeat(100000),
      contextKind: 'history',
    },
    { role: 'user', content: 'Recent question', contextKind: 'history' },
    {
      role: 'assistant',
      content: 'Recent answer',
      reasoningContent: 'recent'.repeat(5000),
      contextKind: 'history',
    },
    { role: 'user', content: 'Original current goal', contextKind: 'input' },
  ]
  const saved = structuredClone(messages)
  expect(
    compactWorkingContext(messages, {
      sources: [],
      completedText: '',
      pendingCandidates: [],
      handoff: null,
    })
  ).toBe(true)
  expect(contextBytes(messages)).toBeLessThanOrEqual(WORKING_CONTEXT_BYTES)
  expect(messages.filter(message => message.contextKind === 'history')).toEqual(
    saved.slice(3, 5)
  )
  expect(messages.at(-1)?.content).toBe('Original current goal')
  expect(saved[2]?.reasoningContent).toHaveLength(300000)
})

it('returns reasoning only as protocol data and replays every completed tool turn', async () => {
  const packets: AssistantWireMessage[][] = []
  const text = vi.fn()
  const activity = vi.fn()
  const deps: AssistantDependencies = {
    begin: async (_owner, requestId) => ({
      requestId,
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: '# Guide\n\nLocal documentation.',
        }))
      ),
    turn: async (_id, messages) => {
      packets.push(structuredClone(messages))
      const index = packets.length
      return Object.assign(
        index < 3
          ? {
              text: null,
              toolCalls: [
                {
                  id: `search-${index}`,
                  name: 'search_help',
                  arguments: JSON.stringify({
                    query: index === 1 ? 'Guide' : 'documentation',
                  }),
                },
              ],
            }
          : { text: 'The local guide was checked.', toolCalls: [] },
        { reasoningContent: index === 2 ? '' : `private reasoning ${index}` }
      )
    },
  }
  const result = await runAssistantRequest(
    {
      identity: 'reasoning-fixture',
      input: 'Read the local guide',
      history: [],
      locale: 'en',
      signal: new AbortController().signal,
      isCurrent: () => true,
      onText: text,
      onActivity: activity,
    },
    deps
  )
  expect(packets[1]).toContainEqual(
    expect.objectContaining({
      role: 'assistant',
      reasoningContent: 'private reasoning 1',
    })
  )
  expect(packets[2]).toContainEqual(
    expect.objectContaining({ role: 'assistant', reasoningContent: '' })
  )
  expect(result).toMatchObject({
    text: 'The local guide was checked.',
    reasoningContent: 'private reasoning 3',
  })
  expect(JSON.stringify(text.mock.calls)).not.toContain('private reasoning')
  expect(JSON.stringify(activity.mock.calls)).not.toContain('private reasoning')
  const config = {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  }
  const contextServiceKey = modelProfileKey(config)
  const next = buildAssistantMessages(
    [
      {
        id: 'user',
        role: 'user',
        text: 'Read the local guide',
        sources: [],
        status: 'completed',
        scope: 'platform',
        contextServiceKey,
      },
      {
        id: 'reply',
        role: 'assistant',
        text: result.text,
        reasoningContent: result.reasoningContent,
        sources: [],
        status: 'completed',
        scope: 'platform',
        contextServiceKey,
      },
    ],
    'Next question',
    { owner: 'reasoning-fixture', config, projectReading: false }
  )
  expect(next).toContainEqual(
    expect.objectContaining({
      role: 'assistant',
      content: 'The local guide was checked.',
      reasoningContent: 'private reasoning 3',
    })
  )
})
