import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationPerformersStore } from '@/store/creation-performers-store'
import { isCreationWorkspacePath } from '@/store/creation-files-store'

/** One sequential observer for all list surfaces, fenced across workspace/run
 * changes. A failed request clears old rows instead of presenting stale phones. */
export function setupPerformerConnections(): () => void {
  let key = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let revision = 0
  const sync = () => {
    const creation = useCreationStore.getState()
    const session = useSessionStore.getState()
    const identity = creation.workspace?.project.identity
    const active =
      creation.active &&
      identity &&
      session.sessionStatus === 'ready' &&
      isCreationWorkspacePath(session.sessionProjectPath)
    const nextKey = active ? `${identity}:${session.runId}` : ''
    if (nextKey === key) return
    key = nextKey
    const request = ++revision
    clearTimeout(timer)
    useCreationPerformersStore.setState({
      connections: null,
      connectionStatus: active ? 'loading' : 'standby',
    })
    if (!active || !identity) return
    const poll = async () => {
      try {
        const result = await commands.inspectCreationRuntime(identity, false)
        if (disposed || request !== revision) return
        useCreationPerformersStore.setState(
          result.status === 'ok' && result.data.passed
            ? {
                connections: result.data.performers,
                connectionStatus: result.data.performers
                  ? 'available'
                  : 'unsupported',
              }
            : { connections: null, connectionStatus: 'unavailable' }
        )
      } catch {
        if (disposed || request !== revision) return
        useCreationPerformersStore.setState({
          connections: null,
          connectionStatus: 'unavailable',
        })
      }
      if (!disposed && request === revision)
        timer = setTimeout(() => {
          void poll()
        }, 2000)
    }
    void poll()
  }
  const offCreation = useCreationStore.subscribe(sync)
  const offSession = useSessionStore.subscribe(sync)
  sync()
  return () => {
    disposed = true
    clearTimeout(timer)
    offCreation()
    offSession()
    useCreationPerformersStore.setState({
      connections: null,
      connectionStatus: 'standby',
    })
  }
}
