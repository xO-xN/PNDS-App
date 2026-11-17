import { useTranslation } from 'react-i18next'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import {
  compileUnavailableReason,
  selectCompileDraftPaths,
  useCreationCompileStore,
} from '@/store/creation-compile-store'
import { useSessionStore } from '@/store/session-store'

export function useCreationCompileAvailability(): string | null {
  useTranslation()
  const workspace = useCreationStore(state => state.workspace)
  const draftPaths = useCreationFilesStore(selectCompileDraftPaths)
  const busy = useCreationCompileStore(state => state.busy)
  const runtimeBusy = useSessionStore(
    state =>
      state.commandPending ||
      ['starting', 'stopping'].includes(state.sessionStatus)
  )
  return compileUnavailableReason(workspace, draftPaths, busy, runtimeBusy)
}
