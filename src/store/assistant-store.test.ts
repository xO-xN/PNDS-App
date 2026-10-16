import { beforeEach, expect, it, vi } from 'vitest'
import { useAssistantStore } from './assistant-store'
import { commands, events } from '@/lib/tauri-bindings'
import { HELP_BOOKS } from '@/lib/help-corpus'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { conversationMessages } from '@/lib/assistant-conversations'

const corpus = HELP_BOOKS.flatMap(book =>
  book.documentIds.map(id => ({
    id,
    path: `${id}.md`,
    markdown: `# ${id}\n\n## Channels\nThe outputChannels declaration describes output routing.`,
  }))
)

beforeEach(async () => {
  useAssistantStore.getState().syncWorkspace(null)
  useAssistantStore.getState().syncWorkspace('workspace-one')
  await useAssistantStore.getState().refreshConfiguration()
  useAssistantStore.setState({ configured: true })
  vi.mocked(commands.beginAssistantRequest).mockImplementation(
    async (_identity, requestId) => ({
      status: 'ok',
      data: {
        requestId,
        model: 'chosen',
        baseUrl: 'https://model.example/v1',
        config: { model: 'chosen', baseUrl: 'https://model.example/v1' },
      },
    })
  )
  vi.mocked(commands.helpCorpus).mockResolvedValue({
    status: 'ok',
    data: corpus,
  })
  vi.mocked(commands.assistantModelTurn).mockResolvedValue({
    status: 'ok',
    data: { text: 'A documented answer.', toolCalls: [] },
  })
})

it('clears the composer on send and restores the submitted question on stop', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
  ) => void
  vi.mocked(commands.assistantModelTurn).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  useAssistantStore.getState().setInput('Keep the submitted question')
  const sending = useAssistantStore.getState().send()
  expect(useAssistantStore.getState().input).toBe('')
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.getState().stop()
  expect(useAssistantStore.getState().input).toBe('Keep the submitted question')
  finish({ status: 'ok', data: { text: 'Late', toolCalls: [] } })
  await sending
  expect(useAssistantStore.getState().messages.at(-1)?.status).toBe('cancelled')
})

it('can return to an older chat and continues only that chat while saving every chat', async () => {
  const store = useAssistantStore.getState
  useAssistantStore.setState({
    modelConfig: { model: 'chosen', baseUrl: 'https://model.example/v1' },
  })
  store().setInput('Original chat question')
  await store().send()
  store().newTopic()
  store().setInput('Separate chat question')
  await store().send()
  store().switchConversation(null)
  store().setInput('Continue the original chat')
  await store().send()
  const sent = vi.mocked(commands.assistantModelTurn).mock.calls.at(-1)?.[1]
  expect(JSON.stringify(sent)).toContain('Original chat question')
  expect(JSON.stringify(sent)).not.toContain('Separate chat question')
  await flushAssistantHistory()
  const saved = vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[2]
  expect(
    saved
      ?.filter(message => message.role === 'user')
      .map(message => message.text)
  ).toEqual([
    'Original chat question',
    'Continue the original chat',
    'Separate chat question',
  ])
})

it('editing a historical question forks at that point and preserves the original later discussion', async () => {
  const store = useAssistantStore.getState
  useAssistantStore.setState({
    modelConfig: { model: 'chosen', baseUrl: 'https://model.example/v1' },
  })
  for (const text of [
    'Opening decision',
    'Original follow-up',
    'Later discussion',
  ]) {
    store().setInput(text)
    await store().send()
  }
  const original = structuredClone(store().messages)
  store().beginEditing(original[2]?.id ?? 'missing-question')
  expect(store().input).toBe('Original follow-up')
  store().setInput('Edited follow-up')
  await store().send()
  expect(store().activeConversationId).not.toBeNull()
  const sent = JSON.stringify(
    vi.mocked(commands.assistantModelTurn).mock.calls.at(-1)?.[1]
  )
  expect(sent).toContain('Opening decision')
  expect(sent).toContain('Edited follow-up')
  expect(sent).not.toContain('Original follow-up')
  expect(sent).not.toContain('Later discussion')
  expect(store().messages.slice(0, original.length)).toEqual(original)
  expect(new Set(store().messages.map(message => message.id)).size).toBe(
    store().messages.length
  )
  store().switchConversation(null)
  expect(store().messages.slice(0, original.length)).toEqual(original)
})

it('remaps reviewed summary sources inside a fork and restores all chats after reopening', async () => {
  const store = useAssistantStore.getState
  useAssistantStore.setState({
    modelConfig: { model: 'chosen', baseUrl: 'https://model.example/v1' },
  })
  store().setInput('A recorded decision')
  await store().send()
  const sourceId = store().messages[0]?.id ?? 'missing-source'
  useAssistantStore.setState(state => ({
    messages: [
      ...state.messages,
      {
        id: 'reviewed-summary',
        role: 'assistant',
        text: 'Reviewed summary',
        scope: 'platform',
        status: 'completed',
        sources: [],
        contextMarker: {
          type: 'summary',
          sourceIds: [sourceId],
          serviceKey: '["https://model.example/v1","chosen"]',
          sections: {
            userDecisions: [
              { text: 'Retain this decision', sourceIds: [sourceId] },
            ],
            assistantSuggestions: [],
            verifiedFacts: [],
            unverifiedFacts: [],
            openQuestions: [],
          },
        },
      },
    ],
  }))
  store().setInput('Follow-up')
  await store().send()
  const original = structuredClone(store().messages)
  store().beginEditing(original[3]?.id ?? 'missing-question')
  store().setInput('Changed follow-up')
  await store().send()
  const branchId = store().activeConversationId
  const branch = conversationMessages(store().messages, branchId)
  const summary = branch.find(
    message => message.contextMarker?.type === 'summary'
  )?.contextMarker
  expect(summary?.type).toBe('summary')
  if (summary?.type !== 'summary') throw new Error('Expected copied summary')
  expect(summary.sourceIds).toEqual([branch[0]?.id])
  expect(summary.sections.userDecisions[0]?.sourceIds).toEqual([branch[0]?.id])
  expect(branch[0]?.id).not.toBe(sourceId)
  await flushAssistantHistory()
  const saved =
    vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[2] ?? []
  store().syncWorkspace(null)
  vi.mocked(commands.loadAssistantHistory).mockResolvedValueOnce({
    status: 'ok',
    data: {
      epoch: 'reopened',
      projectKey: 'a'.repeat(64),
      appVersion: '1.6.5',
      messages: saved,
    },
  })
  store().syncWorkspace('workspace-one')
  await vi.waitFor(() => expect(store().historyState).toBe('ready'))
  expect(store().activeConversationId).toBe(branchId)
  expect(conversationMessages(store().messages, branchId).at(-2)?.text).toBe(
    'Changed follow-up'
  )
  store().switchConversation(null)
  expect(
    conversationMessages(store().messages, null).map(message => message.text)
  ).toEqual(original.map(message => message.text))
})

it('switching chats stops a request, preserves each draft and rejects the late response', async () => {
  const store = useAssistantStore.getState
  store().setInput('Original draft')
  store().newTopic()
  const newerId = store().activeConversationId
  let finish!: (
    value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
  ) => void
  vi.mocked(commands.assistantModelTurn).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  store().setInput('Question in newer chat')
  const sending = store().send()
  await vi.waitFor(() => expect(finish).toBeDefined())
  store().switchConversation(null)
  expect(store().input).toBe('Original draft')
  finish({ status: 'ok', data: { text: 'A late answer', toolCalls: [] } })
  await sending
  expect(
    store().messages.some(message => message.text === 'A late answer')
  ).toBe(false)
  store().switchConversation(newerId)
  expect(store().input).toBe('Question in newer chat')
  expect(conversationMessages(store().messages, newerId).at(-1)?.status).toBe(
    'cancelled'
  )
})

it('stopping retains produced text and input, and ignores the released cancelled reply', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
  ) => void
  vi.mocked(commands.assistantModelTurn)
    .mockResolvedValueOnce({
      status: 'ok',
      data: {
        text: 'Checking output routing.',
        toolCalls: [
          {
            id: 'search',
            name: 'search_help',
            arguments: '{"query":"outputChannels"}',
          },
        ],
      },
    })
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
  useAssistantStore.getState().setInput('Explain channels')
  const sending = useAssistantStore.getState().send()
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.getState().stop()
  await sending
  expect(useAssistantStore.getState().input).toBe('Explain channels')
  expect(useAssistantStore.getState().messages.at(-1)).toMatchObject({
    text: 'Checking output routing.',
    status: 'cancelled',
  })
  finish({ status: 'ok', data: { text: 'A late answer.', toolCalls: [] } })
  await Promise.resolve()
  expect(useAssistantStore.getState().messages.at(-1)?.text).toBe(
    'Checking output routing.'
  )
})

it('a switch away and back rejects the old generation and retains only the current conversation', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
  ) => void
  vi.mocked(commands.assistantModelTurn).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  useAssistantStore.getState().setInput('Old question')
  const sending = useAssistantStore.getState().send()
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.getState().syncWorkspace('workspace-two')
  useAssistantStore.getState().syncWorkspace('workspace-one')
  useAssistantStore.getState().setInput('New input')
  finish({ status: 'ok', data: { text: 'Old owner answer.', toolCalls: [] } })
  await sending
  expect(useAssistantStore.getState().messages).toEqual([])
  expect(useAssistantStore.getState().input).toBe('New input')
})

it('does not duplicate a pending send and retries a failed question only after a new explicit send', async () => {
  vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
    status: 'error',
    error: { type: 'timeout' },
  })
  useAssistantStore.getState().setInput('A question')
  const sending = useAssistantStore.getState().send()
  await useAssistantStore.getState().send()
  await sending
  expect(useAssistantStore.getState().messages).toHaveLength(2)
  expect(useAssistantStore.getState().error).toBe('timeout')
  expect(useAssistantStore.getState().input).toBe('A question')
  const before = vi.mocked(commands.assistantModelTurn).mock.calls.length
  await Promise.resolve()
  expect(commands.assistantModelTurn).toHaveBeenCalledTimes(before)
  await useAssistantStore.getState().send()
  expect(useAssistantStore.getState().messages.at(-1)?.status).toBe('completed')
  expect(useAssistantStore.getState().input).toBe('')
  const last =
    vi.mocked(commands.assistantModelTurn).mock.calls.at(-1)?.[1] ?? []
  expect(last.filter(message => message.content === 'A question')).toHaveLength(
    1
  )
})

it('a corpus failure keeps the draft and failed record without automatically retrying', async () => {
  vi.mocked(commands.helpCorpus).mockResolvedValueOnce({
    status: 'error',
    error: 'not installed',
  })
  useAssistantStore.getState().setInput('Explain PNDS')
  const sending = useAssistantStore.getState().send()
  await sending
  expect(useAssistantStore.getState().input).toBe('Explain PNDS')
  expect(useAssistantStore.getState().phase).toBe('idle')
  expect(useAssistantStore.getState().error).toBe('corpusUnavailable')
  expect(useAssistantStore.getState().messages.at(-1)?.status).toBe('failed')
})

it('routes streamed text to the current turn, bounds history writes and saves the latest text on stop', async () => {
  let deliver!: (requestId: string, turnId: string, text: string) => void
  const off = vi.fn()
  const subscription = vi
    .spyOn(events.assistantTextEvent, 'listen')
    .mockImplementation(async cb => {
      deliver = (requestId, turnId, text) =>
        cb({
          event: 'assistant-text-event',
          id: 0,
          payload: { requestId, turnId, text },
        })
      return off
    })
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100)
  let requestId!: string
  let turnId!: string
  let finish!: (
    value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
  ) => void
  vi.mocked(commands.assistantModelTurn).mockImplementationOnce(
    (id, _messages, turn) => {
      requestId = id
      turnId = turn
      return new Promise(resolve => {
        finish = resolve
      })
    }
  )
  try {
    useAssistantStore.getState().setInput('Stream this answer')
    const sending = useAssistantStore.getState().send()
    await vi.waitFor(() => expect(finish).toBeDefined())
    await flushAssistantHistory()
    const writes = vi.mocked(commands.saveAssistantHistory).mock.calls.length
    deliver('other-request', turnId, 'Wrong request')
    deliver(requestId, 'other-turn', 'Wrong turn')
    expect(useAssistantStore.getState().messages.at(-1)?.text).toBe('')
    for (let count = 1; count <= 20; count++)
      deliver(requestId, turnId, `Partial ${count}`)
    expect(useAssistantStore.getState().messages.at(-1)).toMatchObject({
      text: 'Partial 20',
      status: 'pending',
    })
    await flushAssistantHistory()
    expect(
      vi.mocked(commands.saveAssistantHistory).mock.calls.length - writes
    ).toBe(1)
    useAssistantStore.getState().stop()
    await sending
    await flushAssistantHistory()
    expect(
      vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[2].at(-1)
    ).toMatchObject({ text: 'Partial 20', status: 'cancelled' })
    deliver(requestId, turnId, 'Late text')
    expect(useAssistantStore.getState().messages.at(-1)?.text).toBe(
      'Partial 20'
    )
    finish({ status: 'ok', data: { text: 'Late completion', toolCalls: [] } })
    await vi.waitFor(() => expect(off).toHaveBeenCalledOnce())
  } finally {
    subscription.mockRestore()
    clock.mockRestore()
  }
})

it('organizes only after an explicit action, keeps originals/input, and sends a reviewed summary as reference data', async () => {
  const config = { model: 'chosen', baseUrl: 'https://model.example/v1' }
  const messages = Array.from({ length: 5 }, (_, index) => [
    {
      id: `summary-u${index}`,
      role: 'user' as const,
      text: `决定 ${index}`,
      status: 'completed' as const,
      scope: 'platform' as const,
      sources: [],
      contextServiceKey: '["https://model.example/v1","chosen"]',
    },
    {
      id: `summary-a${index}`,
      role: 'assistant' as const,
      text: `建议 ${index}`,
      status: 'completed' as const,
      scope: 'platform' as const,
      sources: [],
      contextServiceKey: '["https://model.example/v1","chosen"]',
    },
  ]).flat()
  useAssistantStore.setState({
    modelConfig: config,
    messages,
    input: 'Keep this input',
    historyState: 'ready',
  })
  const sections = {
    userDecisions: [{ text: 'A user decision', sourceIds: ['summary-u0'] }],
    assistantSuggestions: [],
    verifiedFacts: [],
    unverifiedFacts: [],
    openQuestions: [],
  }
  vi.mocked(commands.assistantModelTurn).mockResolvedValueOnce({
    status: 'ok',
    data: { text: JSON.stringify(sections), toolCalls: [] },
  })
  await useAssistantStore.getState().organizeContext()
  expect(useAssistantStore.getState().input).toBe('Keep this input')
  expect(useAssistantStore.getState().messages).toHaveLength(10)
  expect(useAssistantStore.getState().summaryDraft?.sections).toEqual(sections)
  useAssistantStore.getState().acceptSummary()
  expect(useAssistantStore.getState().messages).toHaveLength(11)
  const original = useAssistantStore.getState().messages[0]
  expect(original?.text).toBe('决定 0')
  await useAssistantStore.getState().send()
  const sent = vi.mocked(commands.assistantModelTurn).mock.calls.at(-1)?.[1]
  expect(
    sent?.find(message => message.contextKind === 'summary')
  ).toMatchObject({
    role: 'user',
    content: expect.stringContaining('A user decision'),
  })
  expect(JSON.stringify(sent)).not.toContain('决定 0')
  expect(JSON.stringify(sent)).toContain('决定 4')
  await flushAssistantHistory()
})

it('new topic changes only the send boundary and rejects a late summary', async () => {
  const config = { model: 'chosen', baseUrl: 'https://model.example/v1' }
  const messages = Array.from({ length: 3 }, (_, index) => [
    {
      id: `topic-u${index}`,
      role: 'user' as const,
      text: `Old question ${index}`,
      status: 'completed' as const,
      scope: 'platform' as const,
      sources: [],
      contextServiceKey: '["https://model.example/v1","chosen"]',
    },
    {
      id: `topic-a${index}`,
      role: 'assistant' as const,
      text: `Old answer ${index}`,
      status: 'completed' as const,
      scope: 'platform' as const,
      sources: [],
      contextServiceKey: '["https://model.example/v1","chosen"]',
    },
  ]).flat()
  useAssistantStore.setState({
    modelConfig: config,
    messages,
    input: 'New input',
    historyState: 'ready',
  })
  let finish!: (
    value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
  ) => void
  vi.mocked(commands.assistantModelTurn).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const organizing = useAssistantStore.getState().organizeContext()
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.getState().newTopic()
  finish({ status: 'ok', data: { text: 'Late summary', toolCalls: [] } })
  await organizing
  expect(useAssistantStore.getState().summaryDraft).toBeNull()
  expect(useAssistantStore.getState().input).toBe('New input')
  expect(useAssistantStore.getState().messages).toHaveLength(7)
  await useAssistantStore.getState().send()
  const sent = vi.mocked(commands.assistantModelTurn).mock.calls.at(-1)?.[1]
  expect(JSON.stringify(sent)).not.toContain('Old question')
  await flushAssistantHistory()
})

it('stamps service identity and excludes earlier-service and unknown-origin history after a model switch', async () => {
  const configA = { baseUrl: 'https://model.example/v1', model: 'chosen' }
  const configB = { baseUrl: 'https://other.example/v1', model: 'other' }
  useAssistantStore.setState({
    modelConfig: configA,
    configured: true,
    input: 'Only service A knows this question',
    messages: [],
    historyState: 'ready',
  })
  await useAssistantStore.getState().send()
  expect(
    useAssistantStore
      .getState()
      .messages.every(
        message =>
          message.contextServiceKey === '["https://model.example/v1","chosen"]'
      )
  ).toBe(true)
  useAssistantStore.setState({ modelConfig: configB, input: 'Question for B' })
  vi.mocked(commands.beginAssistantRequest).mockImplementation(
    async (_owner, requestId) => ({
      status: 'ok',
      data: {
        requestId,
        model: configB.model,
        baseUrl: configB.baseUrl,
        config: configB,
      },
    })
  )
  await useAssistantStore.getState().send()
  const sent = vi.mocked(commands.assistantModelTurn).mock.calls.at(-1)?.[1]
  expect(JSON.stringify(sent)).not.toContain('Only service A')
  expect(JSON.stringify(sent)).toContain('Question for B')
  await flushAssistantHistory()
})
