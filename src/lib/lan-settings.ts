import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { updatePreferences } from '@/lib/preferences'
import { flagSessionConfigChange } from '@/lib/session-flow'
import { useSessionStore } from '@/store/session-store'

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

/** Keep the current run on its applied address until explicit restart. */
export function chooseLanAddress(ip: string): void {
  useSessionStore.getState().setLanIp(ip)
  void updatePreferences({ lanIp: ip })
  flagSessionConfigChange()
}
