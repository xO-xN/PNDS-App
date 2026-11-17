import { useEffect, useState } from 'react'
import { commands, type DesktopDeviceStatus } from '@/lib/tauri-bindings'

const UNKNOWN: DesktopDeviceStatus = { audio: 'unknown', network: 'unknown' }

/** Refresh only visible chrome; stale requests cannot relabel a newly selected route. */
export function useDesktopDeviceStatus(
  outputDevice: string | null,
  lanIp: string | null,
  audioEnabled: boolean
): DesktopDeviceStatus {
  const key = JSON.stringify([outputDevice, lanIp, audioEnabled])
  const [result, setResult] = useState<{
    key: string
    status: DesktopDeviceStatus
  } | null>(null)
  useEffect(() => {
    let disposed = false
    let inFlight = false
    const refresh = async () => {
      if (disposed || inFlight || document.hidden) return
      inFlight = true
      try {
        const response = await commands.getDesktopDeviceStatus(
          outputDevice,
          lanIp,
          audioEnabled
        )
        if (!disposed)
          setResult({
            key,
            status: response.status === 'ok' ? response.data : UNKNOWN,
          })
      } catch {
        if (!disposed) setResult({ key, status: UNKNOWN })
      } finally {
        inFlight = false
      }
    }
    const requestRefresh = () => void refresh()
    requestRefresh()
    const timer = window.setInterval(requestRefresh, 3000)
    window.addEventListener('focus', requestRefresh)
    document.addEventListener('visibilitychange', requestRefresh)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('focus', requestRefresh)
      document.removeEventListener('visibilitychange', requestRefresh)
    }
  }, [outputDevice, lanIp, audioEnabled, key])
  return result?.key === key ? result.status : UNKNOWN
}
