import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import type { AssistantMessage } from '@/lib/assistant-types'
import { assistantConversations } from '@/lib/assistant-conversations'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { useAssistantStore } from './assistant-store'
import { useAssistantProjectStore } from './assistant-project-store'
import { useCreationReadingStore } from './creation-reading-store'

const message = (id: string): AssistantMessage => ({
  id,
  role: 'user',
  text: id,
  status: 'completed',
  scope: 'platform',
  sources: [],
})
const topic = (id: string): AssistantMessage => ({
  ...message(id),
  role: 'assistant',
  contextMarker: { type: 'topic' },
})
const messages = () => [
  message('first'),
  topic('second-chat'),
  message('second'),
  topic('third-chat'),
  message('third'),
]
const history = (items: AssistantMessage[] = messages()) => ({
  epoch: 'epoch',
  projectKey: 'a'.repeat(64),
  appVersion: '1.6.5',
  messages: items,
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
  useAssistantStore.getState().syncWorkspace('project')
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
  useAssistantProjectStore.setState({ planning: false, whole: null })
  useAssistantStore.setState({
    input: 'Current draft',
    activeConversationId: 'second-chat',
    editing: { messageId: 'second', previousInput: 'Earlier draft' },
    conversationDrafts: {
      original: {
        input: 'First draft',
        editing: { messageId: 'first', previousInput: 'First earlier draft' },
      },
      'third-chat': { input: 'Third draft', editing: null },
    },
  })
})

it('deletes another chat while preserving current input/editing and all retained drafts', async () => {
  const before = useAssistantStore.getState()
  expect(await before.deleteConversation('third-chat')).toBe(true)
  const after = useAssistantStore.getState()
  expect(after.messages.map(item => item.id)).toEqual([
    'first',
    'second-chat',
    'second',
  ])
  expect(after.activeConversationId).toBe('second-chat')
  expect(after.input).toBe(before.input)
  expect(after.editing).toEqual(before.editing)
  expect(after.conversationDrafts).toEqual({
    original: before.conversationDrafts.original,
  })
  expect(after.historicalMessageIds).toEqual(['first', 'second-chat', 'second'])
  expect(commands.clearAssistantHistory).not.toHaveBeenCalled()
  expect(commands.undoCreationAssistantTask).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('deletes the selected chat and restores its previous neighbor draft, including edit state', async () => {
  expect(
    await useAssistantStore.getState().deleteConversation('second-chat')
  ).toBe(true)
  const state = useAssistantStore.getState()
  expect(state.activeConversationId).toBeNull()
  expect(state.input).toBe('First draft')
  expect(state.editing).toEqual({
    messageId: 'first',
    previousInput: 'First earlier draft',
  })
  expect(state.conversationDrafts['second-chat']).toBeUndefined()
  expect(state.conversationDrafts['third-chat']?.input).toBe('Third draft')
})

it('promotes the next chat when deleting original, preserving its current draft and edit identity', async () => {
  const before = useAssistantStore.getState()
  expect(await before.deleteConversation(null)).toBe(true)
  const state = useAssistantStore.getState()
  expect(assistantConversations(state.messages).map(chat => chat.id)).toEqual([
    null,
    'third-chat',
  ])
  expect(state.activeConversationId).toBeNull()
  expect(state.input).toBe(before.input)
  expect(state.editing).toEqual(before.editing)
  expect(state.conversationDrafts.original).toBeUndefined()
  expect(state.conversationDrafts['third-chat']).toEqual(
    before.conversationDrafts['third-chat']
  )
})

it('restores the promoted neighbor draft when deleting current original and can start again after deleting all chats', async () => {
  useAssistantStore.getState().switchConversation(null)
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyBusy).toBe(false)
  )
  await useAssistantStore.getState().deleteConversation(null)
  expect(useAssistantStore.getState().input).toBe('Current draft')
  expect(useAssistantStore.getState().editing?.messageId).toBe('second')
  await useAssistantStore.getState().deleteConversation('third-chat')
  await useAssistantStore.getState().deleteConversation(null)
  expect(useAssistantStore.getState().messages).toEqual([])
  expect(useAssistantStore.getState().input).toBe('')
  expect(useAssistantStore.getState().editing).toBeNull()
  useAssistantStore.getState().newTopic()
  expect(useAssistantStore.getState().activeConversationId).not.toBeNull()
  await flushAssistantHistory()
})

it('queues deletion after previous saves and restores the saved deletion on reload', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  let disk = messages()
  vi.mocked(commands.saveAssistantHistory)
    .mockImplementationOnce(
      (_owner, _epoch, snapshot) =>
        new Promise(resolve => {
          finish = result => {
            disk = snapshot
            resolve(result)
          }
        })
    )
    .mockImplementation(async (_owner, _epoch, snapshot) => {
      disk = snapshot
      return { status: 'ok', data: null }
    })
  const saving = useAssistantStore.getState().persistHistory()
  await vi.waitFor(() => expect(finish).toBeDefined())
  const deleting = useAssistantStore.getState().deleteConversation('third-chat')
  expect(useAssistantStore.getState().historyBusy).toBe(true)
  expect(useAssistantStore.getState().messages).toHaveLength(5)
  expect(commands.saveAssistantHistory).toHaveBeenCalledTimes(1)
  finish({ status: 'ok', data: null })
  await saving
  expect(await deleting).toBe(true)
  expect(disk.map(item => item.id)).toEqual(['first', 'second-chat', 'second'])
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: history(disk),
  })
  await useAssistantStore.getState().retryHistory()
  expect(useAssistantStore.getState().messages.map(item => item.id)).toEqual(
    disk.map(item => item.id)
  )
})

it.each(['io', 'staleHistory'] as const)(
  'retains the chat and drafts after %s save failure, with retry or explicit reload',
  async failure => {
    const before = useAssistantStore.getState()
    vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
      status: 'error',
      error: {
        type: failure,
      },
    })
    expect(await before.deleteConversation('second-chat')).toBe(false)
    const state = useAssistantStore.getState()
    expect(state.messages).toEqual(before.messages)
    expect(state.input).toBe(before.input)
    expect(state.editing).toEqual(before.editing)
    expect(state.conversationDrafts).toEqual(before.conversationDrafts)
    expect(state.historyBusy).toBe(false)
    expect(state.historyError).toBe(failure)
    if (failure === 'staleHistory') {
      expect(state.historySaveError).toBe('staleHistory')
      expect(await state.deleteConversation('second-chat')).toBe(false)
      expect(commands.saveAssistantHistory).toHaveBeenCalledTimes(1)
    } else expect(await state.deleteConversation('second-chat')).toBe(true)
  }
)

it.each([
  'responding',
  'reading',
  'compacting',
  'continuing',
  'pausing',
] as const)(
  'refuses deletion in %s without stopping the active request',
  async phase => {
    useAssistantStore.setState({ phase })
    expect(
      await useAssistantStore.getState().deleteConversation('third-chat')
    ).toBe(false)
    expect(useAssistantStore.getState().phase).toBe(phase)
    expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  }
)

it('refuses deletion during whole-project planning or unavailable history', async () => {
  useAssistantProjectStore.setState({ planning: true })
  expect(
    await useAssistantStore.getState().deleteConversation('third-chat')
  ).toBe(false)
  useAssistantProjectStore.setState({ planning: false })
  useAssistantStore.setState({ historyState: 'error' })
  expect(
    await useAssistantStore.getState().deleteConversation('third-chat')
  ).toBe(false)
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
})

it('does not overwrite a draft typed or retained proposal updated while deletion is saving', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const deleting = useAssistantStore.getState().deleteConversation('third-chat')
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.getState().setInput('Typed during save')
  useAssistantStore.setState(state => ({
    messages: state.messages.map(item =>
      item.id === 'second'
        ? { ...item, text: 'Updated retained message' }
        : item
    ),
  }))
  finish({ status: 'ok', data: null })
  expect(await deleting).toBe(true)
  await flushAssistantHistory()
  expect(useAssistantStore.getState().input).toBe('Typed during save')
  expect(
    vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[2]
  ).toContainEqual(
    expect.objectContaining({ id: 'second', text: 'Updated retained message' })
  )
})

it('ignores a late deletion result after switching workspace', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const deleting = useAssistantStore.getState().deleteConversation('third-chat')
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.getState().syncWorkspace('other-project')
  useAssistantStore.getState().setInput('Other project draft')
  finish({ status: 'ok', data: null })
  expect(await deleting).toBe(false)
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
  expect(useAssistantStore.getState().owner).toBe('other-project')
  expect(useAssistantStore.getState().messages).toHaveLength(5)
  expect(useAssistantStore.getState().input).toBe('Other project draft')
})

it('invalidates summaries and reading jumps depending on deleted messages without leaving an empty extension view', async () => {
  const source = messages()
  const summary: AssistantMessage = {
    ...message('summary'),
    role: 'assistant',
    contextMarker: {
      type: 'summary',
      sourceIds: ['first'],
      serviceKey: 'fixture',
      sections: {
        userDecisions: [{ text: 'Decided', sourceIds: ['first'] }],
        assistantSuggestions: [],
        verifiedFacts: [],
        unverifiedFacts: [],
        openQuestions: [],
      },
    },
  }
  useAssistantStore.setState({
    messages: [...source, summary],
    historicalMessageIds: [...source, summary].map(item => item.id),
  })
  useCreationReadingStore
    .getState()
    .showExtension({ id: 'extension', title: 'Result', content: null }, 'first')
  await useAssistantStore.getState().deleteConversation(null)
  expect(
    useAssistantStore.getState().messages.some(item => item.id === 'summary')
  ).toBe(false)
  expect(useAssistantStore.getState().historicalMessageIds).not.toContain(
    'summary'
  )
  expect(useCreationReadingStore.getState()).toMatchObject({
    view: 'discussion',
    returnMessageId: null,
    extension: null,
  })
})

it('keeps retained changes and exposes retry saving if a deletion fails after a publisher update', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const deleting = useAssistantStore.getState().deleteConversation('third-chat')
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.setState(state => ({
    messages: state.messages.map(item =>
      item.id === 'second'
        ? { ...item, text: 'Latest retained proposal' }
        : item
    ),
  }))
  await useAssistantStore.getState().persistHistory()
  expect(commands.saveAssistantHistory).toHaveBeenCalledTimes(1)
  finish({ status: 'error', error: { type: 'io' } })
  expect(await deleting).toBe(false)
  expect(useAssistantStore.getState().messages).toHaveLength(5)
  expect(useAssistantStore.getState().historySaveError).toBe('io')
  await useAssistantStore.getState().persistHistory()
  expect(
    vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[2]
  ).toContainEqual(
    expect.objectContaining({ id: 'second', text: 'Latest retained proposal' })
  )
  expect(
    vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[2]
  ).toContainEqual(expect.objectContaining({ id: 'third' }))
  expect(useAssistantStore.getState().historySaveError).toBeNull()
})
