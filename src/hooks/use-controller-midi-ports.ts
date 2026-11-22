import { useEffect, useState } from 'react'
import { commands, type ControllerMidiPort } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'

export function useControllerMidiPorts(visible: boolean) {
  const [ports, setPorts] = useState<ControllerMidiPort[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!visible) return
    let live = true
    const refresh = async () => {
      try {
        const result = await commands.getControllerMidiPorts()
        if (!live) return
        if (result.status === 'ok') {
          setPorts(result.data)
          setFailed(false)
        } else setFailed(true)
      } catch (error) {
        if (!live) return
        setFailed(true)
        logger.warn('Could not read MIDI controller input ports', {
          error: String(error),
        })
      }
    }
    void refresh()
    const watcher = setInterval(refresh, 400)
    return () => {
      live = false
      clearInterval(watcher)
    }
  }, [visible])
  return { ports, failed }
}
