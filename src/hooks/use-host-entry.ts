import { useEffect, useRef } from 'react'
import { commands } from '@/lib/tauri-bindings'
import { refreshLanAddresses } from '@/lib/lan-settings'
import { logger } from '@/lib/logger'
import { useCreationStore } from '@/store/creation-store'
import { useHostEntryStore } from '@/store/host-entry-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'

/** App-owned listener preparation survives every workspace and role. */
export function useHostEntry() {
  const restored = usePerformanceRoleStore(state => state.preferencesRestored)
  const lan = useSessionStore(state => state.lanIp)
  const addressesLoaded = useSessionStore(state => state.lanAddressesLoaded)
  const nodeName = useSettingsStore(state => state.nodeNameSetting)
  const role = usePerformanceRoleStore(state => state.role)
  const creation = useCreationStore(state => state.active)
  const lanRole = creation ? 'creation' : role
  const lanSync = useRef(Promise.resolve())
  useEffect(() => {
    if (restored && !addressesLoaded) refreshLanAddresses()
  }, [restored, addressesLoaded])
  useEffect(() => {
    if (!restored || !addressesLoaded) return
    let disposed = false
    let pending = false
    const read = async (prepare: boolean) => {
      if (pending) return
      pending = true
      try {
        const result = await (prepare
          ? commands.syncHostEntry(lan)
          : commands.getHostEntry())
        if (disposed) return
        if (result.status === 'ok') {
          useHostEntryStore.setState({ snapshot: result.data })
        } else {
          useHostEntryStore.setState(state => ({
            snapshot: {
              ...state.snapshot,
              status: 'error',
              error: result.error,
            },
          }))
        }
      } catch (error) {
        if (!disposed)
          useHostEntryStore.setState(state => ({
            snapshot: {
              ...state.snapshot,
              status: 'error',
              error: String(error),
            },
          }))
      } finally {
        pending = false
      }
    }
    void read(true)
    const timer = window.setInterval(() => void read(false), 2000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [restored, addressesLoaded, lan, nodeName])
  useEffect(() => {
    if (!restored || !addressesLoaded || !lanRole || !nodeName.trim()) return
    let disposed = false
    lanSync.current = lanSync.current.then(async () => {
      if (disposed) return
      try {
        const result = await commands.syncClientLan(lan, lanRole)
        if (!disposed && result.status === 'error')
          logger.warn('Could not update PNDS LAN discovery', {
            error: result.error,
          })
      } catch (error) {
        if (!disposed)
          logger.warn('Could not update PNDS LAN discovery', { error })
      }
    })
    return () => {
      disposed = true
    }
  }, [restored, addressesLoaded, lan, nodeName, lanRole])
}
