import { create } from 'zustand'
import type { AssistantHandoffSuggestion } from '@/lib/assistant-flow'
import { useCreationStore } from './creation-store'

interface SuggestedHandoff {
  identity: string
  suggestion: AssistantHandoffSuggestion
}
export const useAssistantHandoffStore = create<{
  items: Record<string, SuggestedHandoff>
  offer: (
    identity: string,
    messageId: string,
    suggestion: AssistantHandoffSuggestion
  ) => void
  dismiss: (messageId: string) => void
}>(set => ({
  items: {},
  offer: (identity, messageId, suggestion) =>
    set(state => ({
      items: { ...state.items, [messageId]: { identity, suggestion } },
    })),
  dismiss: messageId =>
    set(state => ({
      items: Object.fromEntries(
        Object.entries(state.items).filter(([id]) => id !== messageId)
      ),
    })),
}))
let owner: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (owner !== next) {
    owner = next
    useAssistantHandoffStore.setState({ items: {} })
  }
})
