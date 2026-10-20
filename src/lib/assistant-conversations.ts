import type { AssistantMessage } from './assistant-types'
import { SUMMARY_FIELDS } from './assistant-context'

/** Topic markers are already persisted by schema 3. Each delimits one chat;
 * the original transcript remains the first chat, without rewriting old data. */
export function assistantConversations(messages: readonly AssistantMessage[]) {
  let current: { id: string | null; messages: AssistantMessage[] } = {
    id: null,
    messages: [],
  }
  const conversations = [current]
  for (const message of messages) {
    if (message.contextMarker?.type === 'topic') {
      current = { id: message.id, messages: [] }
      conversations.push(current)
    } else current.messages.push(message)
  }
  return conversations
}

export function conversationMessages(
  messages: readonly AssistantMessage[],
  id: string | null
): AssistantMessage[] {
  return (
    assistantConversations(messages).find(chat => chat.id === id)?.messages ??
    []
  )
}

/** Remove a whole chat and summaries whose evidence would no longer exist.
 * The next topic becomes the unmarked original when that original is deleted;
 * content IDs stay stable, and callers remap its session-only chat key. */
export function removeConversation(
  messages: readonly AssistantMessage[],
  id: string | null
) {
  const chats = assistantConversations(messages)
  const index = chats.findIndex(chat => chat.id === id)
  if (index < 0) return null
  const start =
    id === null ? 0 : messages.findIndex(message => message.id === id)
  const nextId = chats[index + 1]?.id
  const end = nextId
    ? messages.findIndex(message => message.id === nextId)
    : messages.length
  const promotedId = id === null ? (nextId ?? null) : null
  const removedIds = new Set(
    messages.slice(start, end).map(message => message.id)
  )
  if (promotedId) removedIds.add(promotedId)
  // References point backwards in persisted history, so one ordered pass also
  // removes summaries depending on an invalidated earlier summary.
  const remaining = messages.filter(message => {
    const marker = message.contextMarker
    if (
      marker?.type === 'summary' &&
      [
        ...marker.sourceIds,
        ...SUMMARY_FIELDS.flatMap(field =>
          marker.sections[field].flatMap(item => item.sourceIds)
        ),
      ].some(source => removedIds.has(source))
    )
      removedIds.add(message.id)
    return !removedIds.has(message.id)
  })
  const neighbor = (chats[index - 1] ?? chats[index + 1])?.id ?? null
  return {
    messages: remaining,
    removedIds,
    promotedId,
    neighborId: neighbor === promotedId ? null : neighbor,
  }
}

/** Insert into its own chat, even when a newer chat follows it in storage. */
export function appendConversationMessages(
  messages: readonly AssistantMessage[],
  id: string | null,
  additions: AssistantMessage[]
): AssistantMessage[] {
  const start =
    id === null ? -1 : messages.findIndex(message => message.id === id)
  if (id !== null && start < 0) return [...messages]
  const next = messages.findIndex(
    (message, index) => index > start && message.contextMarker?.type === 'topic'
  )
  const end = next < 0 ? messages.length : next
  return [...messages.slice(0, end), ...additions, ...messages.slice(end)]
}

/** A branch owns new IDs and display-only copies. No old execution authority
 * or references into a different chat are introduced by copying its prefix. */
export function forkConversationPrefix(prefix: readonly AssistantMessage[]) {
  const ids = new Map(prefix.map(message => [message.id, crypto.randomUUID()]))
  return structuredClone([...prefix]).flatMap(message => {
    const newId = ids.get(message.id)
    if (!newId) return []
    const marker = message.contextMarker
    if (marker?.type === 'summary') {
      const references = [
        ...marker.sourceIds,
        ...SUMMARY_FIELDS.flatMap(field =>
          marker.sections[field].flatMap(item => item.sourceIds)
        ),
      ]
      if (references.some(id => !ids.has(id))) return []
      marker.sourceIds = marker.sourceIds.map(id => ids.get(id) ?? id)
      for (const field of SUMMARY_FIELDS)
        for (const item of marker.sections[field])
          item.sourceIds = item.sourceIds.map(id => ids.get(id) ?? id)
    }
    return [
      {
        ...message,
        id: newId,
        status:
          message.status === 'pending'
            ? ('cancelled' as const)
            : message.status,
        proposals: message.proposals?.map(proposal => ({
          ...proposal,
          preview: 'historical' as const,
        })),
      },
    ]
  })
}
