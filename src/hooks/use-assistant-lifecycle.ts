import { useEffect } from 'react'
import { onModelConfigurationChanged } from '@/lib/events'
import { registerCreationParticipant } from '@/lib/creation-lifecycle'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import {
  stopAndPersistAssistantHistory,
  useAssistantStore,
} from '@/store/assistant-store'

/** Workspace lifecycle, independent of the currently visible reading surface. */
export function useAssistantLifecycle() {
  useEffect(() => {
    const off = onModelConfigurationChanged(() => {
      useAssistantProjectStore.getState().revoke()
      useAssistantStore.getState().stop()
      void useAssistantStore.getState().refreshConfiguration()
    })
    const unregister = registerCreationParticipant({
      cleanup: stopAndPersistAssistantHistory,
    })
    return () => {
      off()
      unregister()
      useAssistantStore.getState().stop()
    }
  }, [])
}
