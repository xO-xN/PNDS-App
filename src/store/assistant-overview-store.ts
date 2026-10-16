import { create } from 'zustand'
import {
  commands,
  type AssistantProjectOverview,
  type DiagnosticReport,
  type ModelServiceConfig,
} from '@/lib/tauri-bindings'
import type { AssistantContextConsumer } from '@/lib/assistant-types'
import type { HelpTree } from '@/lib/help-corpus'
import { overviewConsumer } from '@/lib/assistant-overview'
import { useCreationStore } from './creation-store'
import {
  useCreationFilesStore,
  isCreationWorkspacePath,
} from './creation-files-store'
import { useSessionStore } from './session-store'

interface TestEvidence {
  kind: 'manual' | 'controlled'
  status: string
  revision: number
  at: string
  stale?: boolean
}
interface OverviewState {
  owner: string | null
  overview: AssistantProjectOverview | null
  revision: number
  busy: boolean
  error: boolean
  stale: boolean
  staticEvidence: {
    passed: boolean
    issues: number
    revision: number
    stale: boolean
  } | null
  testEvidence: TestEvidence | null
  syncWorkspace: (owner: string | null) => void
  refresh: (owner: string) => Promise<AssistantProjectOverview | null>
  recordStatic: (
    owner: string,
    report: DiagnosticReport,
    revision: number
  ) => void
  markStaticStale: (owner: string) => void
  recordTest: (owner: string, evidence: TestEvidence) => void
  contextConsumer: (
    owner: string,
    config: ModelServiceConfig,
    locale: HelpTree
  ) => AssistantContextConsumer | null
}
let generation = 0
let pending: {
  owner: string
  revision: number
  promise: Promise<AssistantProjectOverview | null>
} | null = null
export const useAssistantOverviewStore = create<OverviewState>((set, get) => ({
  owner: null,
  overview: null,
  revision: 0,
  busy: false,
  error: false,
  stale: true,
  staticEvidence: null,
  testEvidence: null,
  contextConsumer: (owner, config, locale) => {
    const state = get()
    if (state.owner !== owner || !state.overview || state.stale) return null
    const revision = useCreationFilesStore.getState().revision
    return overviewConsumer(state.overview, owner, config, locale, {
      staticContract: state.staticEvidence
        ? {
            ...state.staticEvidence,
            stale:
              state.staticEvidence.stale ||
              state.staticEvidence.revision !== revision,
          }
        : null,
      recentTest: state.testEvidence
        ? {
            ...state.testEvidence,
            stale:
              state.testEvidence.stale ||
              state.testEvidence.revision !== revision,
          }
        : null,
    })
  },
  syncWorkspace: owner => {
    if (get().owner === owner) return
    generation++
    pending = null
    set({
      owner,
      overview: null,
      revision: 0,
      busy: false,
      error: false,
      stale: true,
      staticEvidence: null,
      testEvidence: null,
    })
  },
  refresh: owner => {
    if (get().owner !== owner) return Promise.resolve(null)
    const revision = useCreationFilesStore.getState().revision
    if (pending?.owner === owner && pending.revision === revision)
      return pending.promise
    const token = ++generation
    set({ busy: true, error: false })
    const promise = (async () => {
      try {
        const result = await commands.assistantProjectOverview(owner)
        if (get().owner !== owner || token !== generation) return null
        if (result.status === 'error') throw new Error('overview')
        const stale = revision !== useCreationFilesStore.getState().revision
        const changed =
          get().overview !== null &&
          get().overview?.snapshot.fingerprint !==
            result.data.snapshot.fingerprint
        const { staticEvidence, testEvidence } = get()
        set({
          overview: result.data,
          revision,
          busy: false,
          stale,
          ...(changed && staticEvidence
            ? { staticEvidence: { ...staticEvidence, stale: true } }
            : {}),
          ...(changed && testEvidence
            ? { testEvidence: { ...testEvidence, stale: true } }
            : {}),
        })
        return stale ? null : result.data
      } catch {
        if (get().owner === owner && token === generation)
          set({ busy: false, error: true, stale: true })
        return null
      }
    })()
    pending = { owner, revision, promise }
    void promise.finally(() => {
      if (pending?.promise === promise) pending = null
    })
    return promise
  },
  recordStatic: (owner, report, revision) => {
    if (get().owner === owner)
      set({
        staticEvidence: {
          passed: report.staticPassed,
          issues: report.issues.length,
          revision,
          stale: get().stale,
        },
      })
  },
  markStaticStale: owner => {
    const evidence = get().staticEvidence
    if (get().owner === owner && evidence)
      set({ staticEvidence: { ...evidence, stale: true } })
  },
  recordTest: (owner, evidence) => {
    if (get().owner === owner)
      set({
        testEvidence: { ...evidence, stale: evidence.stale ?? get().stale },
      })
  },
}))

useCreationStore.subscribe(state =>
  useAssistantOverviewStore
    .getState()
    .syncWorkspace(
      state.active ? (state.workspace?.project.identity ?? null) : null
    )
)
useCreationFilesStore.subscribe((state, previous) => {
  if (
    state.revision !== previous.revision ||
    (state.error !== previous.error && state.error !== null)
  )
    useAssistantOverviewStore.setState({ stale: true })
})
let startRevision: number | null = null
useSessionStore.subscribe((state, previous) => {
  const workspace = useCreationStore.getState().workspace
  if (
    !workspace ||
    !useCreationStore.getState().active ||
    !isCreationWorkspacePath(state.sessionProjectPath)
  )
    return
  if (
    state.sessionStatus === 'starting' &&
    previous.sessionStatus !== 'starting'
  )
    startRevision = useCreationFilesStore.getState().revision
  if (
    (state.sessionStatus === 'ready' || state.sessionStatus === 'error') &&
    (state.sessionStatus !== previous.sessionStatus ||
      state.runId !== previous.runId)
  ) {
    useAssistantOverviewStore
      .getState()
      .recordTest(workspace.project.identity, {
        kind: 'manual',
        status: state.sessionStatus,
        revision: startRevision ?? useCreationFilesStore.getState().revision,
        at: new Date().toISOString(),
      })
    startRevision = null
  }
})
