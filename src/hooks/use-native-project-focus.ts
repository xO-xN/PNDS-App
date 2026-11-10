import { useEffect, useRef } from 'react'
import { onWindowFocus } from '@/lib/events'
import type { NativeProjectTransport } from '@/lib/native-project-page'
import { useKeyboardStore } from '@/store/keyboard-store'
import { isGuestFocusPayload } from './use-guest-focus-gate'

/** The native document keeps the same meaningful-input and pointer-area gates
 * as an iframe. Only the current key window may perform the final native focus
 * handoff; a background heartbeat cannot activate another App window. */
export function useNativeProjectFocus(
  role: string,
  navigation: string,
  transport: React.RefObject<NativeProjectTransport | null>
) {
  const state = useRef({
    interacting: false,
    pointerInside: false,
    command: false,
  })
  const leave = useRef<number | null>(null)
  const refresh = useRef<() => void>(() => undefined)
  const message = (data: unknown) => {
    if (role !== 'monitor' || !isGuestFocusPayload(data)) return
    state.current.interacting = data.interacting
    refresh.current()
  }
  const input = (data: {
    command?: unknown
    pointerInside?: unknown
    interacting?: unknown
  }) => {
    if (role !== 'monitor') return
    if (typeof data.interacting === 'boolean')
      state.current.interacting = data.interacting
    if (typeof data.command === 'boolean') state.current.command = data.command
    if (typeof data.pointerInside === 'boolean') {
      if (leave.current !== null) window.clearTimeout(leave.current)
      leave.current = null
      if (data.pointerInside) state.current.pointerInside = true
      else if (state.current.pointerInside) {
        leave.current = window.setTimeout(() => {
          leave.current = null
          state.current.pointerInside = false
          refresh.current()
        }, 500)
      }
    }
    refresh.current()
  }
  useEffect(() => {
    if (role !== 'monitor') return
    const publish = () => {
      const { interacting, pointerInside, command } = state.current
      const available = !interacting && !pointerInside
      useKeyboardStore.getState().setCommandKeyPressed(command && available)
      if (available && !document.hidden) {
        const page = transport.current
        page?.postMessage({ type: 'pnds:host-focus', version: 1 }, page.origin)
      }
    }
    refresh.current = publish
    const visibility = () => {
      if (!document.hidden) publish()
    }
    const offFocus = onWindowFocus(publish)
    const heartbeat = window.setInterval(publish, 2000)
    window.addEventListener('focus', publish)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      offFocus()
      window.clearInterval(heartbeat)
      if (leave.current !== null) window.clearTimeout(leave.current)
      leave.current = null
      state.current = {
        interacting: false,
        pointerInside: false,
        command: false,
      }
      useKeyboardStore.getState().setCommandKeyPressed(false)
      refresh.current = () => undefined
      window.removeEventListener('focus', publish)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [role, navigation, transport])
  return { message, input }
}
