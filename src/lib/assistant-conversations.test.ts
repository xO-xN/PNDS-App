import { assert, describe, expect, it } from 'vitest'
import type { AssistantMessage } from './assistant-types'
import {
  assistantConversations,
  forkConversationPrefix,
  removeConversation,
} from './assistant-conversations'

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
const summary = (id: string, source: string): AssistantMessage => ({
  ...message(id),
  role: 'assistant',
  contextMarker: {
    type: 'summary',
    sourceIds: [source],
    serviceKey: 'fixture',
    sections: {
      userDecisions: [{ text: 'Decision', sourceIds: [source] }],
      assistantSuggestions: [],
      verifiedFacts: [],
      unverifiedFacts: [],
      openQuestions: [],
    },
  },
})

describe('single chat removal', () => {
  it('removes exactly a named topic and its messages without renumbering other topics', () => {
    const messages = [
      message('first'),
      topic('second-chat'),
      message('second'),
      topic('third-chat'),
      message('third'),
    ]
    const removed = removeConversation(messages, 'second-chat')
    assert(removed)
    expect(removed.messages).toEqual([messages[0], messages[3], messages[4]])
    expect(removed.neighborId).toBeNull()
    expect([...removed.removedIds]).toEqual(['second-chat', 'second'])
    expect(removeConversation(messages, 'missing')).toBeNull()
  })

  it('promotes only the next topic after deleting original and leaves no ghost chat', () => {
    const messages = [
      message('first'),
      topic('second-chat'),
      message('second'),
      topic('third-chat'),
      message('third'),
    ]
    const removed = removeConversation(messages, null)
    assert(removed)
    expect(removed.promotedId).toBe('second-chat')
    expect(removed.messages.map(item => item.id)).toEqual([
      'second',
      'third-chat',
      'third',
    ])
    expect(
      assistantConversations(removed.messages).map(chat => chat.id)
    ).toEqual([null, 'third-chat'])
    expect(removeConversation([message('only')], null)?.messages).toEqual([])
    expect(assistantConversations([])).toEqual([{ id: null, messages: [] }])
  })

  it('drops complete summaries with removed evidence, including dependent summaries, but preserves an independent fork', () => {
    const original = message('original')
    const reviewed = summary('reviewed', 'original')
    const fork = forkConversationPrefix([original, reviewed])
    const messages = [
      original,
      topic('other'),
      reviewed,
      summary('dependent', 'reviewed'),
      topic('fork'),
      ...fork,
    ]
    const removed = removeConversation(messages, null)
    assert(removed)
    expect(removed.messages).toEqual([topic('fork'), ...fork])
    expect([...removed.removedIds]).toEqual([
      'original',
      'other',
      'reviewed',
      'dependent',
    ])
  })
})
