import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { updatePreferences } from '@/lib/preferences'
import { useProjectStore } from '@/store/project-store'
import { selectionIsRunningCard, useSessionStore } from '@/store/session-store'

/** Shared by the Node settings and the performance-card LAN selector. */
export function refreshLanAddresses(): void {
  void commands
    .listLanAddresses()
    .then(result => {
      if (result.status === 'error') {
        logger.warn('Failed to list LAN addresses', { error: result.error })
        return
      }
      useSessionStore.getState().setLanAddresses(result.data)
    })
    .catch(error => logger.warn('Failed to list LAN addresses', { error }))
}

/** Keep the current performance on its applied address until explicit restart. */
export function chooseLanAddress(ip: string): void {
  const session = useSessionStore.getState()
  session.setLanIp(ip)
  void updatePreferences({ lanIp: ip })
  if (
    selectionIsRunningCard(
      session,
      useProjectStore.getState().currentProject?.path
    )
  ) {
    session.setPendingChanges(true)
  }
}
