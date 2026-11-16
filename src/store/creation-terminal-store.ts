import { projectTerminalTheme } from '@/lib/project-terminal-theme'
import { create } from 'zustand'
import { commands, expectOk } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationMergeStore } from '@/store/creation-merge-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import type {
  ProjectTerminalSurface,
  TerminalSurfaceState,
} from '@/lib/project-terminal-surface'

type Phase =
  | 'idle'
  | 'opening'
  | 'running'
  | 'eof'
  | 'exited'
  | 'error'
  | 'closing'
  | 'ended'
interface CreationTerminalState {
  identity: string | null
  sessionId: string | null
  phase: Phase
  error: string | null
  exitCode: number | null
  /** Includes an unconfirmed startup/cleanup owner, not just a live shell. */
  hasSession: boolean
  leavePending: boolean
}
export const useCreationTerminalStore = create<CreationTerminalState>()(() => ({
  identity: null,
  sessionId: null,
  phase: 'idle',
  error: null,
  exitCode: null,
  hasSession: false,
  leavePending: false,
}))
let surface: ProjectTerminalSurface | null = null
let parent: HTMLElement | null = null
let viewVisible = false
let request = 0
let opening: Promise<void> | null = null
let closing: Promise<boolean> | null = null
let failedEnd = false
let openIntent: { identity: string; revision: number } | null = null
const leaveRequests = new Set<object>()

/** Hold admission through the whole context change, including later I/O. */
export function blockCreationTerminalOpen(): () => void {
  const owner = {}
  leaveRequests.add(owner)
  useCreationTerminalStore.setState({ leavePending: true })
  return () => {
    leaveRequests.delete(owner)
    useCreationTerminalStore.setState({ leavePending: leaveRequests.size > 0 })
  }
}

export function canUseCreationTerminal(identity: string): boolean {
  const creation = useCreationStore.getState()
  const merge = useCreationMergeStore.getState()
  return (
    !useCreationTerminalStore.getState().leavePending &&
    creation.active &&
    !creation.opening &&
    creation.modePhase === 'idle' &&
    creation.workspace?.project.identity === identity &&
    creation.workspace.project.source === 'folder' &&
    !(
      merge.identity === identity &&
      (merge.candidate || merge.loading || merge.busy)
    ) &&
    !(
      creation.workspace.mergePending &&
      (merge.identity !== identity || merge.error)
    )
  )
}

/** Navigate/focus the existing terminal; creation remains lazy until its view mounts. */
export function showCreationTerminal(identity: string): boolean {
  if (!canUseCreationTerminal(identity)) return false
  useCreationReadingStore.getState().showTerminal()
  if (useCreationTerminalStore.getState().identity === identity)
    surface?.focus()
  return true
}

export async function openCreationTerminal(
  identity: string,
  host: HTMLElement
): Promise<void> {
  if (!canUseCreationTerminal(identity)) return
  const previous = useCreationTerminalStore.getState()
  if (previous.hasSession && previous.identity !== identity) return
  parent = host
  if (opening) return opening
  if (surface || previous.hasSession || closing) return
  const theme = projectTerminalTheme()
  failedEnd = false
  const token = ++request
  useCreationTerminalStore.setState({
    identity,
    sessionId: null,
    phase: 'opening',
    error: null,
    exitCode: null,
    hasSession: true,
  })
  const current = () =>
    token === request &&
    parent === host &&
    host.isConnected &&
    useCreationStore.getState().active &&
    useCreationStore.getState().workspace?.project.identity === identity
  const state = (value: TerminalSurfaceState) => {
    if (
      token !== request ||
      useCreationTerminalStore.getState().identity !== identity
    )
      return
    if (useCreationTerminalStore.getState().phase === 'closing' || failedEnd) {
      if ('exitCode' in value)
        useCreationTerminalStore.setState({ exitCode: value.exitCode })
      return
    }
    useCreationTerminalStore.setState({
      phase: value.status,
      sessionId: value.sessionId,
      exitCode: 'exitCode' in value ? value.exitCode : null,
      error: value.status === 'error' ? value.error : null,
    })
  }
  opening = (async () => {
    try {
      const { createProjectTerminalSurface } =
        await import('@/lib/project-terminal-surface')
      if (!current()) return
      const created = await createProjectTerminalSurface(
        host,
        identity,
        theme,
        state
      )
      if (!current()) {
        created.dispose()
        expectOk(
          await commands.closeProjectTerminal(identity, created.sessionId)
        )
        if (token === request)
          useCreationTerminalStore.setState({
            phase: 'ended',
            sessionId: null,
            hasSession: false,
          })
        return
      }
      surface = created
      created.setVisible(viewVisible)
      if (viewVisible) created.focus()
    } catch (error) {
      if (token !== request) return
      let sessionId = useCreationTerminalStore.getState().sessionId
      let hasSession = true
      try {
        const owned = expectOk(await commands.getProjectTerminal(identity))
        sessionId = owned?.id ?? null
        hasSession = !!owned
      } catch {
        // An unavailable query is not evidence that native ownership ended.
      }
      useCreationTerminalStore.setState({
        phase: 'error',
        error: String(error),
        sessionId,
        hasSession,
      })
    } finally {
      opening = null
      if (
        token === request &&
        useCreationTerminalStore.getState().phase === 'opening'
      )
        useCreationTerminalStore.setState({ phase: 'ended', hasSession: false })
    }
  })()
  return opening
}

/** A remount reuses the visit intent; only a new explicit visit may open. */
export function visitCreationTerminal(
  identity: string,
  host: HTMLElement,
  revision: number
): void {
  if (openIntent?.identity === identity && openIntent.revision >= revision)
    return
  if (revision < 1) return
  openIntent = { identity, revision }
  void openCreationTerminal(identity, host)
}

/** View retirement never claims that native jobs have ended. */
export function releaseCreationTerminalView(
  identity: string,
  host: HTMLElement
): void {
  queueMicrotask(() => {
    // StrictMode's setup/cleanup replay leaves the same host connected.
    if (
      parent !== host ||
      host.isConnected ||
      useCreationTerminalStore.getState().identity !== identity
    )
      return
    surface?.dispose()
    surface = null
    parent = null
  })
}

export function setCreationTerminalVisible(
  identity: string,
  visible: boolean
): void {
  if (useCreationStore.getState().workspace?.project.identity === identity)
    viewVisible = visible
  if (useCreationTerminalStore.getState().identity !== identity) return
  surface?.setVisible(visible)
  if (visible) surface?.focus()
  else surface?.terminal.blur()
}

/** Success means the native owner and all managed jobs were actually retired. */
export async function endCreationTerminal(identity: string): Promise<boolean> {
  if (
    useCreationTerminalStore.getState().hasSession &&
    useCreationTerminalStore.getState().identity !== identity
  )
    return false
  if (closing) return closing
  if (opening) await opening
  if (closing) return closing
  const owned = useCreationTerminalStore.getState()
  if (!owned.hasSession) return true
  if (owned.identity !== identity) return false
  failedEnd = false
  useCreationTerminalStore.setState({ phase: 'closing', error: null })
  const retire = () => {
    surface?.dispose()
    surface = null
    ++request
    failedEnd = false
    useCreationTerminalStore.setState({
      phase: 'ended',
      sessionId: null,
      error: null,
      hasSession: false,
    })
  }
  closing = (async () => {
    try {
      let sessionId = owned.sessionId
      if (!sessionId)
        sessionId =
          expectOk(await commands.getProjectTerminal(identity))?.id ?? null
      if (surface) await surface.close()
      else if (sessionId)
        expectOk(await commands.closeProjectTerminal(identity, sessionId))
      retire()
      return true
    } catch (error) {
      // A stale view can outlive an externally revoked native owner. Only an
      // authoritative None permits retiring it; query failure or another ID
      // never grants permission to signal that replacement session.
      try {
        if (expectOk(await commands.getProjectTerminal(identity)) === null) {
          retire()
          return true
        }
      } catch {
        // Preserve the cleanup failure without proof of native absence.
      }
      failedEnd = true
      useCreationTerminalStore.setState({
        phase: 'error',
        error: String(error),
        hasSession: true,
      })
      return false
    } finally {
      closing = null
    }
  })()
  return closing
}
