import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import type { AssistantMessage } from '@/lib/assistant-types'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { useAssistantStore } from './assistant-store'
import { useAssistantProjectStore } from './assistant-project-store'

const first: AssistantMessage = {
  id: 'first',
  role: 'user',
  text: 'First question',
  sources: [],
  scope: 'platform',
  status: 'completed',
}
const topic = (id: string): AssistantMessage => ({
  ...first,
  id,
  role: 'assistant',
  contextMarker: { type: 'topic' },
})
const messages = [first, topic('second-chat'), { ...first, id: 'second' }]
const titles = { original: 'First custom name', 'second-chat': 'Second name' }
const history = (conversationTitles: Record<string, string> = titles) => ({
  epoch: 'epoch',
  projectKey: 'a'.repeat(64),
  appVersion: '1.7.0',
  messages,
  conversationTitles,
})

beforeEach(async () => {
  useAssistantStore.getState().syncWorkspace(null)
  await flushAssistantHistory()
  vi.clearAllMocks()
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: history(),
  })
  vi.mocked(commands.saveAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.clearAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: { ...history({}), epoch: 'cleared', messages: [] },
  })
  useAssistantProjectStore.setState({ planning: false, whole: null })
  useAssistantStore.getState().syncWorkspace('project')
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyBusy).toBe(false)
  )
  useAssistantStore.getState().setInput('Keep my draft')
})

it('saves a trimmed name for an empty original chat before publishing it without touching its draft', async () => {
  useAssistantStore.setState({
    messages: [],
    activeConversationId: null,
    conversationTitles: {},
  })
  let finish!: (
    result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const naming = useAssistantStore
    .getState()
    .renameConversation(null, '  空白聊天的名称  ')
  await vi.waitFor(() => expect(finish).toBeDefined())
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  expect(useAssistantStore.getState().historyBusy).toBe(true)
  finish({ status: 'ok', data: null })
  expect(await naming).toBe(true)
  expect(commands.saveAssistantHistory).toHaveBeenLastCalledWith(
    'project',
    'epoch',
    [],
    { original: '空白聊天的名称' }
  )
  expect(useAssistantStore.getState().conversationTitles).toEqual({
    original: '空白聊天的名称',
  })
  expect(useAssistantStore.getState().messages).toEqual([])
  expect(useAssistantStore.getState().input).toBe('Keep my draft')
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})

it.each(['io', 'staleHistory'] as const)(
  'keeps the previous names after a %s failure and permits only a valid retry',
  async failure => {
    vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
      status: 'error',
      error: { type: failure },
    })
    const before = useAssistantStore.getState()
    expect(await before.renameConversation('second-chat', 'New name')).toBe(
      false
    )
    expect(useAssistantStore.getState().conversationTitles).toEqual(titles)
    expect(useAssistantStore.getState().messages).toBe(before.messages)
    expect(useAssistantStore.getState().historyError).toBe(failure)
    expect(useAssistantStore.getState().historyBusy).toBe(false)
    expect(
      await useAssistantStore
        .getState()
        .renameConversation('second-chat', 'New name')
    ).toBe(failure === 'io')
    if (failure === 'staleHistory')
      expect(commands.saveAssistantHistory).toHaveBeenCalledTimes(1)
    else
      expect(useAssistantStore.getState().conversationTitles).toEqual({
        ...titles,
        'second-chat': 'New name',
      })
  }
)

it('rejects blank, multiline, control, overlong and missing-chat names without changing history', async () => {
  for (const title of [
    '',
    '  ',
    'line\nbreak',
    'control\u0085',
    'x'.repeat(121),
    '🎵'.repeat(61),
  ])
    expect(
      await useAssistantStore.getState().renameConversation(null, title)
    ).toBe(false)
  expect(
    await useAssistantStore.getState().renameConversation('missing', 'Name')
  ).toBe(false)
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  expect(useAssistantStore.getState().conversationTitles).toEqual(titles)
  expect(
    await useAssistantStore.getState().renameConversation(null, '🎵'.repeat(60))
  ).toBe(true)
})

it('does not resave an unchanged name and keeps running or busy project work undisturbed', async () => {
  expect(
    await useAssistantStore.getState().renameConversation(null, titles.original)
  ).toBe(true)
  useAssistantStore.setState({ phase: 'responding' })
  expect(
    await useAssistantStore.getState().renameConversation(null, 'Name')
  ).toBe(false)
  expect(useAssistantStore.getState().phase).toBe('responding')
  useAssistantStore.setState({ phase: 'idle' })
  useAssistantProjectStore.setState({ planning: true })
  expect(
    await useAssistantStore.getState().renameConversation(null, 'Name')
  ).toBe(false)
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it('restores names from project history, leaves new chats unnamed, and clears old metadata', async () => {
  expect(useAssistantStore.getState().conversationTitles).toEqual(titles)
  useAssistantStore.getState().newTopic()
  const chat = useAssistantStore.getState().activeConversationId
  expect(chat).not.toBeNull()
  expect(useAssistantStore.getState().conversationTitles).toEqual(titles)
  await flushAssistantHistory()
  expect(
    vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[3]
  ).toEqual(titles)
  await useAssistantStore.getState().clearHistory()
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  vi.mocked(commands.loadAssistantHistory).mockResolvedValueOnce({
    status: 'ok',
    data: {
      epoch: 'legacy',
      projectKey: 'a'.repeat(64),
      appVersion: '1.7.0',
      messages,
    },
  })
  await useAssistantStore.getState().retryHistory()
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
  useAssistantStore.setState({ conversationTitles: titles })
  useAssistantStore.getState().syncWorkspace(null)
  expect(useAssistantStore.getState().conversationTitles).toEqual({})
})

it('preserves the promoted empty chat name when deleting original and removes only deleted aliases', async () => {
  useAssistantStore.setState({
    messages: [
      first,
      topic('second-chat'),
      topic('third-chat'),
      { ...first, id: 'third' },
    ],
    conversationTitles: { ...titles, 'third-chat': 'Third name' },
  })
  expect(await useAssistantStore.getState().deleteConversation(null)).toBe(true)
  expect(useAssistantStore.getState().conversationTitles).toEqual({
    original: 'Second name',
    'third-chat': 'Third name',
  })
  expect(
    vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[3]
  ).toEqual({
    original: 'Second name',
    'third-chat': 'Third name',
  })
  expect(
    await useAssistantStore.getState().deleteConversation('third-chat')
  ).toBe(true)
  expect(useAssistantStore.getState().conversationTitles).toEqual({
    original: 'Second name',
  })
})

it.each(['__proto__', 'constructor', 'toString'])(
  'promotes only an own custom name for a legacy %s topic ID',
  async id => {
    for (const named of [false, true]) {
      useAssistantStore.setState({
        messages: [first, topic(id)],
        activeConversationId: id,
        conversationTitles: named
          ? Object.fromEntries([[id, 'Legacy custom name']])
          : {},
      })
      expect(await useAssistantStore.getState().deleteConversation(null)).toBe(
        true
      )
      const expected = named ? { original: 'Legacy custom name' } : {}
      expect(useAssistantStore.getState().conversationTitles).toEqual(expected)
      expect(
        vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[3]
      ).toEqual(expected)
    }
  }
)

it('keeps retained publisher updates and drafts while persisting the renamed chat', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const naming = useAssistantStore
    .getState()
    .renameConversation(null, 'Renamed')
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.getState().setInput('Typed during save')
  useAssistantStore.setState(state => ({
    messages: state.messages.map(message =>
      message.id === 'second'
        ? { ...message, text: 'Updated proposal' }
        : message
    ),
  }))
  expect(
    await useAssistantStore
      .getState()
      .renameConversation('second-chat', 'Concurrent')
  ).toBe(false)
  finish({ status: 'ok', data: null })
  expect(await naming).toBe(true)
  await flushAssistantHistory()
  expect(useAssistantStore.getState().input).toBe('Typed during save')
  const saved = vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)
  expect(saved?.[2]).toContainEqual(
    expect.objectContaining({ id: 'second', text: 'Updated proposal' })
  )
  expect(saved?.[3]).toEqual({ ...titles, original: 'Renamed' })
})

it('does not publish a late rename result into a replacement workspace', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const naming = useAssistantStore
    .getState()
    .renameConversation(null, 'Old workspace name')
  await vi.waitFor(() => expect(finish).toBeDefined())
  vi.mocked(commands.loadAssistantHistory).mockResolvedValueOnce({
    status: 'ok',
    data: history({ original: 'Other workspace' }),
  })
  useAssistantStore.getState().syncWorkspace('other-project')
  finish({ status: 'ok', data: null })
  expect(await naming).toBe(false)
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyBusy).toBe(false)
  )
  expect(useAssistantStore.getState().conversationTitles).toEqual({
    original: 'Other workspace',
  })
})
