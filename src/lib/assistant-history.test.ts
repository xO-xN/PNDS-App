import { describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import {
  queueAssistantHistorySave,
  loadAssistantHistory,
  flushAssistantHistory,
} from './assistant-history'
import type { AssistantQuestion } from './tauri-bindings'
import type { AssistantMessage } from './assistant-types'

describe('serialized local conversation writes (#167)', () => {
  it('captures exact message content at enqueue and continues after a failed save', async () => {
    let first!: (
      result: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
    ) => void
    vi.mocked(commands.saveAssistantHistory).mockReturnValueOnce(
      new Promise(resolve => {
        first = resolve
      })
    )
    const messages: AssistantMessage[] = [
      {
        id: 'one',
        role: 'user',
        text: 'Captured content',
        status: 'completed',
        sources: [],
        scope: 'platform',
      },
    ]
    const titles = { original: 'Captured title' }
    const oldSave = queueAssistantHistorySave(
      'owner',
      'old-epoch',
      messages,
      titles
    )
    const failed = expect(oldSave).rejects.toMatchObject({ code: 'io' })
    messages[0] = {
      id: 'one',
      role: 'user',
      text: 'Changed later',
      status: 'completed',
      sources: [],
      scope: 'platform',
    }
    titles.original = 'Changed later'
    const later = queueAssistantHistorySave(
      'owner',
      'new-epoch',
      messages,
      titles
    )
    await vi.waitFor(() => expect(first).toBeDefined())
    first({ status: 'error', error: { type: 'io' } })
    await failed
    await later
    await flushAssistantHistory()
    expect(
      vi.mocked(commands.saveAssistantHistory).mock.calls.at(-2)?.[2]
    ).toEqual([expect.objectContaining({ text: 'Captured content' })])
    expect(
      vi.mocked(commands.saveAssistantHistory).mock.calls.at(-2)?.[3]
    ).toEqual({ original: 'Captured title' })
    expect(
      vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[3]
    ).toEqual({ original: 'Changed later' })
    expect(
      vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.slice(0, 2)
    ).toEqual(['owner', 'new-epoch'])
  })
})

it('hydrates only existing matching terminal question facts and deduplicates native task reads', async () => {
  const pending: AssistantQuestion = {
    id: 'question',
    taskId: 'task',
    scope: { chatId: 'original-chat', messageId: 'original-reply' },
    prompt: 'Who decides the ending?',
    options: [],
    recommendedOptionId: null,
    status: 'pending',
    answer: null,
  }
  const wrongScope = { ...pending, id: 'other-question' }
  const messages: AssistantMessage[] = ['original-reply', 'display-copy'].map(
    id => ({
      id,
      role: 'assistant',
      text: '',
      status: 'cancelled',
      sources: [],
      scope: 'project',
      questions: [pending, wrongScope],
    })
  )
  vi.mocked(commands.loadAssistantHistory).mockResolvedValueOnce({
    status: 'ok',
    data: {
      epoch: 'epoch',
      projectKey: 'a'.repeat(64),
      appVersion: '1.7.0',
      messages,
    },
  })
  vi.mocked(commands.getCreationAssistantQuestions).mockClear()
  vi.mocked(commands.getCreationAssistantQuestions).mockResolvedValueOnce({
    status: 'ok',
    data: [
      {
        ...pending,
        status: 'answered',
        answer: { optionId: null, text: 'Each performer.' },
      },
      {
        ...wrongScope,
        scope: { ...wrongScope.scope, chatId: 'different-chat' },
        status: 'cancelled',
      },
      { ...pending, id: 'deleted-question', status: 'cancelled' },
    ],
  })
  const loaded = await loadAssistantHistory('current-project')
  expect(
    commands.getCreationAssistantQuestions
  ).toHaveBeenCalledExactlyOnceWith('current-project', 'task')
  expect(loaded.messages.map(message => message.id)).toEqual([
    'original-reply',
    'display-copy',
  ])
  for (const message of loaded.messages) {
    expect(message.questions).toHaveLength(2)
    expect(message.questions?.[0]).toMatchObject({
      status: 'answered',
      answer: { text: 'Each performer.' },
      scope: pending.scope,
    })
    expect(message.questions?.[1]).toEqual(wrongScope)
  }
  expect(messages[0]?.questions?.[0]?.status).toBe('pending')
})
