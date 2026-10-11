import { create } from 'zustand'
import i18n from '@/i18n/config'
import { commands, type Manifest, type AudioMode } from '@/lib/tauri-bindings'
import {
  DEFAULT_OSC_TARGET,
  loadPreferences,
  updateOscTarget,
} from '@/lib/preferences'
import { startCreationTest } from '@/lib/session-flow'
import { stopAndReset } from '@/lib/open-project'
import { refreshMonitorFromDisk } from '@/lib/creation-runtime-updates'
import { isCreationWorkspacePath } from './creation-changes-store'
import { useCreationStore, creationTransportError } from './creation-store'
import { useSessionStore } from './session-store'

interface CreationTestState {
  manifest: Manifest | null
  audioMode: AudioMode
  oscTarget: string
  refreshing: boolean
  loading: boolean
  initialized: boolean
  error: string | null
  tab: 'file' | 'console'
  expanded: boolean
  expansionRevision: number
  log: string[]
  runtimeError: string | null
  loadManifest: () => Promise<void>
  setMode: (mode: AudioMode) => void
  setTarget: (target: string) => void
  setTab: (tab: 'file' | 'console') => void
  setExpanded: (expanded: boolean) => void
  run: () => Promise<void>
  close: () => Promise<void>
  refresh: () => Promise<void>
  readLog: () => Promise<void>
}
const initial = () => ({
  manifest: null,
  audioMode: 'none' as AudioMode,
  oscTarget: DEFAULT_OSC_TARGET,
  refreshing: false,
  loading: false,
  initialized: false,
  error: null,
  tab: 'file' as const,
  expanded: false,
  expansionRevision: 0,
  log: [],
  runtimeError: null,
})
let metadataRequest = 0
let logRequest = 0
function message(error: unknown): string {
  if (error instanceof Error) return error.message
  const detail = creationTransportError(error)
  return `${i18n.t(`creation.error.${detail.code}`)} ${detail.detail}`
}
function workspaceOwner(): (() => boolean) | null {
  const identity = useCreationStore.getState().workspace?.project.identity
  return identity
    ? () => useCreationStore.getState().workspace?.project.identity === identity
    : null
}
export const useCreationTestStore = create<CreationTestState>((set, get) => ({
  ...initial(),
  loadManifest: async () => {
    const workspace = useCreationStore.getState().workspace
    if (!workspace) return
    const owns = workspaceOwner()
    const request = ++metadataRequest
    set({ loading: true })
    try {
      const result = await commands.getCreationManifest(
        workspace.project.identity
      )
      if (!owns?.() || request !== metadataRequest) return
      if (result.status === 'error') throw result.error
      const manifest = result.data
      if (!get().initialized) {
        const prefs = await loadPreferences()
        if (!owns() || request !== metadataRequest) return
        const session = useSessionStore.getState()
        const applied =
          session.sessionStatus === 'ready' &&
          isCreationWorkspacePath(session.sessionProjectPath) &&
          session.latestSnapshot?.status === 'ready' &&
          session.latestSnapshot.projectPath === session.sessionProjectPath
            ? session.latestSnapshot
            : null
        set({
          audioMode: applied?.audioMode ?? manifest.audio.defaultMode,
          oscTarget:
            applied?.audioMode === 'external'
              ? (applied.oscTarget ?? DEFAULT_OSC_TARGET)
              : (prefs?.oscTargets?.[manifest.id] ?? DEFAULT_OSC_TARGET),
        })
        if (!session.lanAddressesLoaded) {
          const addresses = await commands.listLanAddresses()
          if (!owns() || request !== metadataRequest) return
          if (addresses.status === 'ok')
            useSessionStore.getState().setLanAddresses(addresses.data)
        }
        set({ initialized: true })
      }
      const mode = manifest.audio.supportedModes.includes(get().audioMode)
        ? get().audioMode
        : manifest.audio.defaultMode
      set({ manifest, audioMode: mode, loading: false, error: null })
    } catch (error) {
      if (owns?.() && request === metadataRequest)
        set({ manifest: null, loading: false, error: message(error) })
    }
  },
  setMode: audioMode => set({ audioMode }),
  setTarget: oscTarget => set({ oscTarget }),
  setTab: tab => set({ tab }),
  setExpanded: expanded =>
    set(state => ({
      expanded,
      expansionRevision: state.expansionRevision + 1,
    })),
  run: async () => {
    const workspace = useCreationStore.getState().workspace
    const owns = workspaceOwner()
    if (!workspace || !owns) return
    const { audioMode, oscTarget } = get()
    const manifestRequest = metadataRequest
    set({ error: null })
    try {
      const manifest = await startCreationTest(workspace.project.identity, {
        audioMode,
        oscTarget,
      })
      if (!owns()) return
      if (manifest) {
        if (manifestRequest === metadataRequest) set({ manifest })
        if (audioMode === 'external')
          void updateOscTarget(manifest.id, oscTarget)
      }
    } catch (error) {
      if (owns()) set({ error: message(error), tab: 'console' })
    }
  },
  close: async () => {
    const owns = workspaceOwner()
    try {
      await stopAndReset()
    } catch (error) {
      if (owns?.()) set({ error: message(error), tab: 'console' })
    }
  },
  refresh: async () => {
    const owns = workspaceOwner()
    if (get().refreshing) return
    set({ refreshing: true })
    try {
      await refreshMonitorFromDisk()
    } catch (error) {
      if (owns?.()) set({ error: message(error), tab: 'console' })
    } finally {
      if (owns?.()) set({ refreshing: false })
    }
  },
  readLog: async () => {
    const owns = workspaceOwner()
    if (!owns) return
    const session = useSessionStore.getState()
    const request = ++logRequest
    const result = await commands.getSessionState().catch(() => null)
    if (
      !owns() ||
      request !== logRequest ||
      useSessionStore.getState().runId !== session.runId ||
      useSessionStore.getState().snapshotRevision !== session.snapshotRevision
    )
      return
    if (
      result?.status === 'ok' &&
      isCreationWorkspacePath(result.data.projectPath)
    ) {
      useSessionStore.getState().applySnapshot(result.data)
      set({ log: result.data.outputTail, runtimeError: result.data.error })
    }
  },
}))

let identity: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (next !== identity) {
    identity = next
    metadataRequest += 1
    logRequest += 1
    useCreationTestStore.setState(initial())
  }
})
useSessionStore.subscribe(state => {
  if (
    state.sessionStatus !== 'ready' &&
    useCreationTestStore.getState().expanded
  )
    useCreationTestStore.setState({ expanded: false })
  if (isCreationWorkspacePath(state.sessionProjectPath))
    useCreationTestStore.setState({
      log: state.outputTail,
      runtimeError: state.sessionError,
      ...(state.sessionStatus === 'error' &&
      state.sessionError !== useCreationTestStore.getState().runtimeError
        ? { tab: 'console' }
        : {}),
    })
})
