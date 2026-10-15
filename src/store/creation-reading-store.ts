import { create } from 'zustand'
import type { ReactNode } from 'react'

export interface CreationReadingExtension {
  id: string
  title: string
  /** Trusted application UI supplied by a consumer, never model HTML. */
  content: ReactNode
}

interface CreationReadingState {
  owner: string | null
  view: 'discussion' | 'file' | 'handoff' | 'extension'
  returnMessageId: string | null
  extension: CreationReadingExtension | null
  syncWorkspace: (identity: string | null) => void
  showDiscussion: (messageId?: string) => void
  showFile: (messageId?: string) => void
  showHandoff: (messageId?: string) => void
  showExtension: (
    extension: CreationReadingExtension,
    messageId: string
  ) => void
}

export const useCreationReadingStore = create<CreationReadingState>(
  (set, get) => ({
    owner: null,
    view: 'discussion',
    returnMessageId: null,
    extension: null,
    syncWorkspace: owner => {
      if (owner !== get().owner)
        set({
          owner,
          view: 'discussion',
          returnMessageId: null,
          extension: null,
        })
    },
    showDiscussion: messageId =>
      set(state => ({
        view: 'discussion',
        returnMessageId: messageId ?? state.returnMessageId,
      })),
    showFile: messageId =>
      set(state => ({
        view: 'file',
        returnMessageId: messageId ?? state.returnMessageId,
      })),
    showHandoff: messageId =>
      set(state => ({
        view: 'handoff',
        returnMessageId: messageId ?? state.returnMessageId,
      })),
    showExtension: (extension, messageId) =>
      set({ view: 'extension', extension, returnMessageId: messageId }),
  })
)
