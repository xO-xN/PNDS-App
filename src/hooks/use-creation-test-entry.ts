import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { performerQrUrl } from '@/lib/performer-qr'

/** Creation invites real devices directly into the owned test, not the public waiting room. */
export function useCreationTestEntry() {
  const workspace = useCreationStore(state => state.workspace)
  const runtimeProject = useCreationStore(state => state.runtimeProject)
  const opening = useCreationStore(state => state.opening)
  const switching = useCreationStore(state => state.modePhase !== 'idle')
  const status = useSessionStore(state => state.sessionStatus)
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const pending = useSessionStore(state => state.commandPending)
  const matches =
    !!workspace &&
    (snapshot?.projectPath === workspace.project.root ||
      (runtimeProject?.root === workspace.project.root &&
        runtimeProject?.path === snapshot?.projectPath))
  const currentStatus = matches ? status : 'idle'
  const generation = snapshot?.runtimeGeneration ?? ''
  const url =
    matches &&
    !opening &&
    !switching &&
    !pending &&
    status === 'ready' &&
    generation
      ? performerQrUrl(snapshot)
      : null
  return { url, generation, status: currentStatus }
}
