import i18n from '@/i18n/config'
import { onTerminalQuitRequested } from '@/lib/events'
import {
  commands,
  expectOk,
  type TerminalQuitRequestedEvent,
} from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTerminalStore } from '@/store/creation-terminal-store'
import {
  releaseUnclaimedTerminalQuit,
  requestQuit,
  useWindowStore,
} from '@/store/window-store'

/** Native Dock Quit shares the same creator confirmation as the App menu. */
export function attachTerminalQuitRequests(): () => void {
  let active = true
  let pending: string | null = null
  const receive = async ({
    identity,
    sessionId,
    token,
  }: TerminalQuitRequestedEvent) => {
    const project = useCreationStore.getState().workspace?.project
    const relevant = () => {
      const creation = useCreationStore.getState()
      const terminal = useCreationTerminalStore.getState()
      return (
        active &&
        creation.active &&
        creation.workspace?.project === project &&
        project?.identity === identity &&
        (!terminal.leavePending || useWindowStore.getState().quitConfirmOpen) &&
        (!terminal.hasSession || terminal.identity === identity) &&
        (!terminal.sessionId || terminal.sessionId === sessionId)
      )
    }
    const key = `${identity}\0${sessionId}`
    let ownsRequest = false
    try {
      if (
        !relevant() ||
        useWindowStore.getState().quitConfirmOpen ||
        pending === key
      )
        return
      pending = key
      ownsRequest = true
      const owner = expectOk(await commands.getProjectTerminal(identity))
      if (!relevant() || owner?.id !== sessionId) return
      if (!useCreationTerminalStore.getState().hasSession)
        useCreationTerminalStore.setState({
          identity,
          sessionId,
          hasSession: true,
          phase: 'error',
          error: i18n.t('creation.terminal.retainedOwner'),
          exitCode: owner.exitCode,
        })
      await requestQuit(relevant)
    } catch (error) {
      if (relevant())
        notifications.error(
          i18n.t('creation.terminal.endFailed'),
          String(error)
        )
    } finally {
      if (ownsRequest && pending === key) pending = null
      await releaseUnclaimedTerminalQuit(token)
    }
  }
  const off = onTerminalQuitRequested(request => {
    void receive(request)
  })
  return () => {
    active = false
    off()
  }
}
