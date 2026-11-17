import { create } from 'zustand'
import i18n from '@/i18n/config'
import {
  commands,
  type Manifest,
  type AudioMode,
  type GitMergeRuntimeOwner,
} from '@/lib/tauri-bindings'
import {
  DEFAULT_OSC_TARGET,
  loadPreferences,
  updateOscTarget,
} from '@/lib/preferences'
import {
  startCreationTest,
  startMergeCandidateTest,
  stopMergeCandidateTest,
} from '@/lib/session-flow'
import { stopAndReset } from '@/lib/open-project'
import { refreshMonitorFromDisk } from '@/lib/creation-runtime-updates'
import { isCreationWorkspacePath } from './creation-files-store'
import { useCreationStore, creationTransportError } from './creation-store'
import { mainSessionFacts, useSessionStore } from './session-store'

export interface MergeTestCandidate {
  identity: string
  id: string
  revision: number
  projectRoot: string
  canTest: boolean
  fast: boolean
}
interface CreationTestState {
  mergeCandidate: MergeTestCandidate | null
  mergeRuntime: GitMergeRuntimeOwner | null
  configureMergeCandidate: (candidate: MergeTestCandidate | null) => void
  setMergeCandidatePreparation: (prepare: (() => Promise<void>) | null) => void
  manifest: Manifest | null
  audioMode: AudioMode
  oscTarget: string
  refreshing: boolean
  loading: boolean
  initialized: boolean
  error: string | null
  expanded: boolean
  expansionRevision: number
  log: string[]
  runtimeError: string | null
  /** In-memory record for this workspace; only a ready runtime counts. */
  hasSuccessfulTest: boolean
  loadManifest: (quiet?: boolean) => Promise<void>
  setMode: (mode: AudioMode) => void
  setTarget: (target: string) => void
  setExpanded: (expanded: boolean) => void
  run: () => Promise<void>
  close: () => Promise<void>
  refresh: () => Promise<void>
  readLog: () => Promise<void>
}
const initial = () => ({
  mergeCandidate: null as MergeTestCandidate | null,
  mergeRuntime: null as GitMergeRuntimeOwner | null,
  manifest: null,
  audioMode: 'none' as AudioMode,
  oscTarget: DEFAULT_OSC_TARGET,
  refreshing: false,
  loading: false,
  initialized: false,
  error: null,
  expanded: false,
  expansionRevision: 0,
  log: [],
  runtimeError: null,
  hasSuccessfulTest: false,
})
let metadataRequest = 0
let mergeManifestPending = false
let logRequest = 0
let prepareMergeCandidate: (() => Promise<void>) | null = null
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
  configureMergeCandidate: mergeCandidate => {
    const previous = get().mergeCandidate
    const contentChanged =
      previous?.identity !== mergeCandidate?.identity ||
      previous?.id !== mergeCandidate?.id ||
      previous?.revision !== mergeCandidate?.revision
    if (contentChanged) {
      metadataRequest += 1
      mergeManifestPending = true
    }
    set({ mergeCandidate, ...(contentChanged ? { loading: false } : {}) })
    if (
      mergeManifestPending &&
      (!mergeCandidate || mergeCandidate.canTest) &&
      useCreationStore.getState().workspace
    ) {
      mergeManifestPending = false
      void get().loadManifest(true)
    }
  },
  setMergeCandidatePreparation: prepare => {
    prepareMergeCandidate = prepare
  },
  loadManifest: async (quiet = false) => {
    const workspace = useCreationStore.getState().workspace
    if (!workspace) return
    const merge = get().mergeCandidate
    if (merge && !merge.canTest) {
      mergeManifestPending = true
      return
    }
    mergeManifestPending = false
    const owns = workspaceOwner()
    const request = ++metadataRequest
    if (!quiet || !get().manifest) set({ loading: true })
    try {
      const result = merge
        ? await commands.getMergeCandidateManifest(
            merge.identity,
            merge.id,
            merge.revision
          )
        : await commands.getCreationManifest(workspace.project.identity)
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
      set({
        manifest,
        audioMode: mode,
        loading: false,
        ...(!quiet ? { error: null } : {}),
      })
    } catch (error) {
      if (owns?.() && request === metadataRequest) {
        if (quiet || (merge && !get().mergeCandidate?.canTest)) {
          mergeManifestPending = Boolean(merge)
          set({ loading: false })
        } else set({ manifest: null, loading: false, error: message(error) })
      }
    }
  },
  setMode: audioMode => set({ audioMode }),
  setTarget: oscTarget => set({ oscTarget }),
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
      const merge = get().mergeCandidate
      if (merge) await prepareMergeCandidate?.()
      if (!owns()) return
      const candidate = get().mergeCandidate
      if (
        merge &&
        (!candidate || candidate.id !== merge.id || !candidate.canTest)
      )
        throw new Error(i18n.t('creation.merge.testBlocked'))
      const manifest = candidate
        ? await startMergeCandidateTest(
            candidate,
            { audioMode, oscTarget },
            () => get().mergeCandidate?.id === candidate.id
          )
        : await startCreationTest(workspace.project.identity, {
            audioMode,
            oscTarget,
          })
      if (!owns()) return
      if (manifest) {
        if (manifestRequest === metadataRequest) set({ manifest })
        if (!candidate && audioMode === 'external')
          void updateOscTarget(manifest.id, oscTarget)
      }
    } catch (error) {
      if (owns()) set({ error: message(error) })
    }
  },
  close: async () => {
    const owns = workspaceOwner()
    try {
      const merge = get().mergeCandidate
      if (merge && get().mergeRuntime?.candidateId === merge.id)
        await stopMergeCandidateTest(merge.identity, merge.id)
      else await stopAndReset()
    } catch (error) {
      if (owns?.()) set({ error: message(error) })
    }
  },
  refresh: async () => {
    const owns = workspaceOwner()
    if (get().refreshing) return
    set({ refreshing: true })
    try {
      await refreshMonitorFromDisk()
    } catch (error) {
      if (owns?.()) set({ error: message(error) })
    } finally {
      if (owns?.()) set({ refreshing: false })
    }
  },
  readLog: async () => {
    const owns = workspaceOwner()
    if (!owns) return
    const session = useSessionStore.getState()
    const request = ++logRequest
    const checkpoint = mainSessionFacts.capture()
    const result = await commands.getSessionState().catch(() => null)
    if (
      !owns() ||
      request !== logRequest ||
      useSessionStore.getState().runId !== session.runId
    )
      return
    if (
      result?.status === 'ok' &&
      isCreationWorkspacePath(result.data.projectPath)
    ) {
      const choice = mainSessionFacts.accept({
        kind: 'reply',
        checkpoint,
        snapshot: result.data,
      })
      if (choice.source !== 'current')
        set({
          log: choice.snapshot.outputTail,
          runtimeError: choice.snapshot.error,
        })
    }
  },
}))

let identity: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (next !== identity) {
    identity = next
    metadataRequest += 1
    mergeManifestPending = false
    logRequest += 1
    useCreationTestStore.setState(initial())
  }
})
useSessionStore.subscribe(state => {
  if (
    useCreationStore.getState().active &&
    !useCreationTestStore.getState().mergeRuntime &&
    state.sessionStatus === 'ready' &&
    isCreationWorkspacePath(state.sessionProjectPath)
  )
    useCreationTestStore.setState({ hasSuccessfulTest: true })
  if (
    (state.sessionStatus === 'error' ||
      (state.sessionStatus === 'idle' && !state.commandPending)) &&
    useCreationTestStore.getState().expanded
  )
    useCreationTestStore.setState({ expanded: false })
  if (isCreationWorkspacePath(state.sessionProjectPath))
    useCreationTestStore.setState({
      log: state.outputTail,
      runtimeError: state.sessionError,
    })
  const owner = useCreationTestStore.getState().mergeRuntime
  if (
    owner &&
    state.sessionProjectPath !== owner.executionPath &&
    !state.commandPending
  )
    useCreationTestStore.setState({ mergeRuntime: null })
})
