import { create } from 'zustand'
import i18n from '@/i18n/config'
import {
  commands,
  type CreationError,
  type GitMergeCandidate,
  type GitMergeChoice,
  type GitMergeContent,
  type GitMergeSide,
  type Result,
} from '@/lib/tauri-bindings'
import type { TextBuffer } from '@/lib/text-buffer'
import { loadPreferences } from '@/lib/preferences'
import { notifications } from '@/lib/notifications'
import { registerCreationParticipant } from '@/lib/creation-lifecycle'
import { stopMergeCandidateTest } from '@/lib/session-flow'
import { useCreationTestStore } from './creation-test-store'
import { creationTransportError, useCreationStore } from './creation-store'
import { useCreationFilesStore } from './creation-files-store'
import { useCreationReadingStore } from './creation-reading-store'
import { useSessionStore } from './session-store'

export interface MergeDraft {
  text: string
  savedText: string
  version: string
  buffer: TextBuffer
  editorRevision: number
}

interface MergeState {
  identity: string | null
  candidate: GitMergeCandidate | null
  completed: GitMergeCandidate | null
  selectedPath: string | null
  drafts: Record<string, MergeDraft>
  contents: Record<string, GitMergeContent>
  view: 'edit' | 'diff'
  inspection: {
    commit: string
    label: string
    side: GitMergeSide | null
  } | null
  busy: boolean
  loading: boolean
  error: CreationError | null
  optionalApproval: { id: string; revision: number } | null
  attach: (identity: string) => void
  load: (identity: string) => Promise<void>
  refresh: () => Promise<void>
  prepare: (source: string, discard: boolean) => Promise<void>
  select: (path: string) => void
  setView: (view: 'edit' | 'diff') => void
  inspect: (inspection: MergeState['inspection']) => void
  read: (path: string, side: GitMergeSide) => Promise<GitMergeContent | null>
  edit: (path: string, text: string) => void
  saveAll: () => Promise<void>
  choose: (path: string, choice: GitMergeChoice) => Promise<void>
  rename: (name: string) => Promise<void>
  resume: () => Promise<void>
  reprepare: () => Promise<void>
  validate: () => Promise<void>
  cancel: () => Promise<void>
  finish: () => Promise<void>
  dismissError: () => void
  clear: () => void
}

let epoch = 0
let queue: Promise<unknown> = Promise.resolve()
let reads = 0
let configuredMerge = false
let stopAssistant: (() => Promise<void>) | null = null
interface MergeScope {
  identity: string
  epoch: number
}

function currentRuntime() {
  const session = useSessionStore.getState()
  return {
    status: session.sessionStatus,
    generation: session.latestSnapshot?.runtimeGeneration ?? null,
    runId: session.runId,
  }
}

export function registerMergeAssistantStop(stop: () => Promise<void>) {
  stopAssistant = stop
  return () => {
    if (stopAssistant === stop) stopAssistant = null
  }
}

function ok<T>(result: Result<T, CreationError>): T {
  if (result.status === 'error') throw result.error
  return result.data
}

function scope(): MergeScope {
  const state = useCreationMergeStore.getState()
  if (
    !state.identity ||
    useCreationStore.getState().workspace?.project.identity !== state.identity
  )
    throw new Error(i18n.t('creation.versions.ownerChanged'))
  return { identity: state.identity, epoch }
}

function current(owner: MergeScope): boolean {
  return (
    epoch === owner.epoch &&
    useCreationMergeStore.getState().identity === owner.identity &&
    useCreationStore.getState().workspace?.project.identity === owner.identity
  )
}

function candidate(): GitMergeCandidate {
  const value = useCreationMergeStore.getState().candidate
  if (!value) throw new Error(i18n.t('creation.merge.unavailable'))
  return value
}

function configureTest() {
  const state = useCreationMergeStore.getState()
  const value = state.candidate
  const root = useCreationStore.getState().workspace?.project.root
  if (!value && !configuredMerge) return
  configuredMerge = !!value
  useCreationTestStore.getState().setMergeCandidatePreparation(
    value
      ? async () => {
          await useCreationMergeStore.getState().validate()
        }
      : null
  )
  useCreationTestStore.getState().configureMergeCandidate(
    value && state.identity && root
      ? {
          identity: state.identity,
          id: value.id,
          revision: value.revision,
          projectRoot: root,
          fast: value.relation === 'fastForward',
          canTest:
            !state.busy &&
            value.phase === 'active' &&
            !value.assistantOwner &&
            !value.files.some(
              file =>
                file.conflict && file.conflict !== 'text' && !file.resolved
            ),
        }
      : null
  )
}

function accept(value: GitMergeCandidate | null) {
  useCreationMergeStore.setState(state => {
    if (
      value &&
      state.candidate?.id === value.id &&
      value.revision < state.candidate.revision
    )
      return {}
    const active = value?.phase === 'completed' ? null : value
    return {
      candidate: active,
      completed: value?.phase === 'completed' ? value : state.completed,
      selectedPath:
        active?.files.find(file => file.path === state.selectedPath)?.path ??
        active?.files.find(file => file.conflict && !file.resolved)?.path ??
        active?.files[0]?.path ??
        null,
      contents:
        active?.id === state.candidate?.id &&
        active?.revision === state.candidate?.revision
          ? state.contents
          : {},
      inspection: state.candidate?.id === active?.id ? state.inspection : null,
      optionalApproval:
        state.optionalApproval?.id === active?.id &&
        state.optionalApproval?.revision === active?.revision
          ? state.optionalApproval
          : null,
      drafts:
        active && state.candidate?.id === active.id
          ? Object.fromEntries(
              Object.entries(state.drafts).filter(
                ([path, draft]) =>
                  draft.text !== draft.savedText ||
                  active.files.some(
                    file => file.path === path && file.version === draft.version
                  )
              )
            )
          : {},
      error: null,
    }
  })
  configureTest()
}

async function flush(owner: MergeScope): Promise<void> {
  for (const [path, draft] of Object.entries(
    useCreationMergeStore.getState().drafts
  )) {
    if (draft.text === draft.savedText) continue
    if (!current(owner))
      throw new Error(i18n.t('creation.versions.ownerChanged'))
    const value = candidate()
    const saved = ok(
      await commands.saveCreationGitMergeText(
        owner.identity,
        value.id,
        value.revision,
        path,
        draft.version,
        draft.text
      )
    )
    if (!current(owner))
      throw new Error(i18n.t('creation.versions.ownerChanged'))
    accept(saved)
    const content = ok(
      await commands.getCreationGitMergeFile(
        owner.identity,
        saved.id,
        path,
        'result'
      )
    )
    if (!current(owner))
      throw new Error(i18n.t('creation.versions.ownerChanged'))
    useCreationMergeStore.setState(state => {
      const latest = state.drafts[path]
      return latest
        ? {
            drafts: {
              ...state.drafts,
              [path]: {
                ...latest,
                savedText: draft.text,
                version: content.version,
              },
            },
          }
        : {}
    })
  }
}

async function latest(owner: MergeScope): Promise<GitMergeCandidate> {
  const value = ok(await commands.getCreationGitMerge(owner.identity))
  if (!current(owner)) throw new Error(i18n.t('creation.versions.ownerChanged'))
  accept(value)
  return candidate()
}

function perform(
  action: (owner: MergeScope) => Promise<void>,
  visible = true
): Promise<void> {
  const owner = scope()
  const pending = queue
    .catch(() => undefined)
    .then(async () => {
      if (!current(owner)) return
      reads++
      useCreationMergeStore.setState({
        ...(visible ? { busy: true } : {}),
        error: null,
      })
      if (visible) configureTest()
      try {
        await action(owner)
      } catch (error) {
        if (current(owner)) {
          try {
            await latest(owner)
          } catch {
            /* Retain the last saved candidate and error. */
          }
        }
        if (current(owner))
          useCreationMergeStore.setState({
            error: creationTransportError(error),
          })
        throw error
      } finally {
        if (current(owner) && visible) {
          useCreationMergeStore.setState({ busy: false })
          configureTest()
        }
      }
    })
  queue = pending
  return pending
}

export const useCreationMergeStore = create<MergeState>((set, get) => ({
  identity: null,
  candidate: null,
  completed: null,
  selectedPath: null,
  drafts: {},
  contents: {},
  view: 'edit',
  inspection: null,
  busy: false,
  loading: false,
  error: null,
  optionalApproval: null,
  attach: identity => {
    if (get().identity === identity) return
    epoch++
    reads++
    set({
      identity,
      candidate: null,
      completed: null,
      selectedPath: null,
      drafts: {},
      contents: {},
      view: 'edit',
      inspection: null,
      busy: false,
      loading: false,
      error: null,
      optionalApproval: null,
    })
    configureTest()
  },
  load: async identity => {
    get().attach(identity)
    const owner = scope()
    const request = ++reads
    if (!get().candidate) set({ loading: true })
    try {
      const value = ok(await commands.getCreationGitMerge(identity))
      if (current(owner) && request === reads) accept(value)
    } catch (error) {
      if (current(owner) && request === reads)
        set({ error: creationTransportError(error) })
    } finally {
      if (current(owner) && request === reads) set({ loading: false })
    }
  },
  refresh: async () => {
    const identity = get().identity
    if (identity) await get().load(identity)
  },
  prepare: (source, discard) =>
    perform(async owner => {
      const value = ok(
        await commands.prepareCreationGitMerge(owner.identity, source, discard)
      )
      if (current(owner)) accept(value)
    }),
  select: selectedPath => {
    set({ selectedPath, inspection: null })
    useCreationReadingStore.getState().showGit()
  },
  setView: view => set({ view }),
  inspect: inspection => set({ inspection }),
  read: async (path, side) => {
    const owner = scope(),
      value = candidate(),
      key = `${side}:${path}`
    const cached = get().contents[key]
    if (cached) return cached
    try {
      const content = ok(
        await commands.getCreationGitMergeFile(
          owner.identity,
          value.id,
          path,
          side
        )
      )
      const previous = get().drafts[path]
      const buffer =
        side === 'result' && content.text != null
          ? (previous?.buffer ??
            new (await import('@/lib/text-buffer')).TextBuffer(
              content.text,
              path
            ))
          : null
      if (
        !current(owner) ||
        get().candidate?.id !== value.id ||
        get().candidate?.revision !== value.revision
      )
        return null
      set(state => {
        const draft = state.drafts[path]
        const text = content.text
        return {
          contents: { ...state.contents, [key]: content },
          ...(buffer &&
          side === 'result' &&
          text != null &&
          (!draft || draft.text === draft.savedText)
            ? {
                drafts: {
                  ...state.drafts,
                  [path]: {
                    text,
                    savedText: text,
                    version: content.version,
                    buffer: draft?.buffer ?? buffer,
                    editorRevision:
                      (draft?.editorRevision ?? 0) +
                      Number(!!draft && draft.text !== text),
                  },
                },
              }
            : {}),
        }
      })
      return content
    } catch (error) {
      if (current(owner)) set({ error: creationTransportError(error) })
      return null
    }
  },
  edit: (path, text) =>
    set(state => {
      const draft = state.drafts[path],
        value = state.candidate
      if (
        !draft ||
        !value ||
        value.phase !== 'active' ||
        value.relation !== 'diverged' ||
        value.assistantOwner ||
        state.busy
      )
        return {}
      return { drafts: { ...state.drafts, [path]: { ...draft, text } } }
    }),
  saveAll: () => perform(flush),
  choose: (path, choice) =>
    perform(async owner => {
      await flush(owner)
      const value = candidate()
      const file = value.files.find(file => file.path === path)
      if (!file) return
      const saved = ok(
        await commands.chooseCreationGitMergeFile(
          owner.identity,
          value.id,
          value.revision,
          path,
          file.version,
          choice
        )
      )
      if (current(owner)) {
        set(state => {
          return {
            drafts: Object.fromEntries(
              Object.entries(state.drafts).filter(([key]) => key !== path)
            ),
          }
        })
        accept(saved)
      }
    }),
  rename: name =>
    perform(async owner => {
      const value = candidate()
      const saved = ok(
        await commands.renameCreationGitMerge(
          owner.identity,
          value.id,
          value.revision,
          name
        )
      )
      if (current(owner)) accept(saved)
    }, false),
  resume: () =>
    perform(async owner => {
      const value = candidate()
      const saved = ok(
        await commands.resumeCreationGitMerge(
          owner.identity,
          value.id,
          value.revision
        )
      )
      if (current(owner)) accept(saved)
    }),
  reprepare: () =>
    perform(async owner => {
      await stopAssistant?.()
      const value = await latest(owner)
      await stopMergeCandidateTest(owner.identity, value.id)
      const saved = ok(
        await commands.reprepareCreationGitMerge(
          owner.identity,
          value.id,
          value.revision
        )
      )
      if (current(owner)) accept(saved)
    }),
  validate: () =>
    perform(async owner => {
      await flush(owner)
      const value = candidate()
      const saved = ok(
        await commands.validateCreationGitMerge(
          owner.identity,
          value.id,
          value.revision
        )
      )
      if (current(owner)) accept(saved)
    }),
  cancel: () =>
    perform(async owner => {
      await stopAssistant?.()
      const value = await latest(owner)
      await stopMergeCandidateTest(owner.identity, value.id)
      ok(
        await commands.cancelCreationGitMerge(
          owner.identity,
          value.id,
          value.revision
        )
      )
      if (current(owner)) {
        accept(null)
        set({ drafts: {}, contents: {} })
        useCreationReadingStore.getState().gitChanged()
      }
    }),
  finish: () => {
    const reviewedRuntime = currentRuntime()
    return perform(async owner => {
      await stopAssistant?.()
      let value = await latest(owner)
      await stopMergeCandidateTest(owner.identity, value.id)
      const runtime = currentRuntime()
      if (runtime.status !== 'idle' && runtime.status !== 'error') {
        if (
          runtime.status !== 'ready' ||
          !runtime.generation ||
          runtime.generation !== reviewedRuntime.generation ||
          runtime.runId !== reviewedRuntime.runId
        )
          throw new Error(i18n.t('creation.merge.runtimeMismatch'))
        const stopped = await commands.stopProjectGeneration(runtime.generation)
        if (stopped.status === 'error') throw new Error(stopped.error)
        if (!stopped.data || currentRuntime().runId !== reviewedRuntime.runId)
          throw new Error(i18n.t('creation.merge.runtimeMismatch'))
        useSessionStore.getState().resetSession()
      }
      if (value.phase !== 'recovery') {
        await flush(owner)
        value = candidate()
        const valid = ok(
          await commands.validateCreationGitMerge(
            owner.identity,
            value.id,
            value.revision
          )
        )
        if (current(owner)) accept(valid)
        value = valid
        let warning = false
        try {
          const checked = ok(
            await commands.diagnoseMergeCandidate(
              owner.identity,
              value.id,
              value.revision
            )
          )
          warning =
            checked.diagnostics?.staticPassed === false ||
            ['failed', 'unavailable', 'cancelled'].includes(
              checked.compileStatus ?? ''
            ) ||
            (!!checked.tests && checked.tests.status !== 'passed')
        } catch {
          warning = true
        }
        if (
          warning &&
          (get().optionalApproval?.id !== value.id ||
            get().optionalApproval?.revision !== value.revision)
        ) {
          set({ optionalApproval: { id: value.id, revision: value.revision } })
          return
        }
      }
      const prefs = await loadPreferences()
      const feedback = `creation-merge:${owner.identity}:${value.id}`
      notifications.flow.step(feedback, i18n.t('creation.merge.publishing'))
      const drafts = useCreationFilesStore.getState().drafts
      let saved: GitMergeCandidate
      try {
        saved = ok(
          await (value.phase === 'recovery'
            ? commands.recoverCreationGitMerge(
                owner.identity,
                value.id,
                value.revision
              )
            : commands.finishCreationGitMerge(
                owner.identity,
                value.id,
                value.revision,
                prefs?.gitName?.trim() || 'PNDS Creator',
                prefs?.gitEmail?.trim() || ''
              ))
        )
      } catch (error) {
        if (current(owner))
          notifications.flow.fail(
            feedback,
            i18n.t('creation.merge.failed'),
            creationTransportError(error).detail
          )
        else notifications.flow.dismiss(feedback)
        throw error
      }
      if (!current(owner)) {
        notifications.flow.dismiss(feedback)
        return
      }
      accept(saved)
      useCreationReadingStore.getState().gitChanged()
      useCreationFilesStore.getState().discardCheckoutCopies(
        saved.files.map(file => file.path),
        drafts,
        false
      )
      const synced = await useCreationFilesStore
        .getState()
        .synchronizeSaved(owner.identity)
        .catch(() => false)
      if (current(owner)) {
        useCreationReadingStore.getState().showGit()
        if (synced && !saved.detail)
          notifications.flow.succeed(
            feedback,
            i18n.t('creation.merge.completed')
          )
        else
          notifications.flow.warn(
            feedback,
            synced
              ? i18n.t('creation.merge.completed')
              : i18n.t('creation.merge.completedSyncWarning'),
            saved.detail ?? undefined
          )
      } else notifications.flow.dismiss(feedback)
    })
  },
  dismissError: () => set({ error: null }),
  clear: () => {
    epoch++
    reads++
    set({
      identity: null,
      candidate: null,
      completed: null,
      selectedPath: null,
      drafts: {},
      contents: {},
      busy: false,
      loading: false,
      error: null,
      inspection: null,
      optionalApproval: null,
    })
    configureTest()
  },
}))

registerCreationParticipant({
  prepareQuit: async () => {
    const state = useCreationMergeStore.getState()
    if (!state.candidate || !state.identity) return
    await stopAssistant?.()
    await stopMergeCandidateTest(state.identity, state.candidate.id)
    await state.saveAll()
  },
  saveActive: () => {
    const state = useCreationMergeStore.getState()
    if (!state.candidate) return false
    if (
      !state.busy &&
      !state.candidate.assistantOwner &&
      state.candidate.phase === 'active'
    )
      void state.saveAll().catch(() => undefined)
    return true
  },
  save: async () => {
    if (!useCreationMergeStore.getState().candidate) return true
    try {
      await useCreationMergeStore.getState().saveAll()
      return true
    } catch {
      return false
    }
  },
  cleanup: async () => {
    const state = useCreationMergeStore.getState()
    if (!state.candidate || !state.identity) return
    await stopAssistant?.()
    await stopMergeCandidateTest(state.identity, state.candidate.id)
    await state.saveAll()
    const value = await latest(scope())
    if (value.phase === 'active')
      accept(
        ok(
          await commands.pauseCreationGitMerge(
            state.identity,
            value.id,
            value.revision
          )
        )
      )
  },
})

useCreationStore.subscribe((state, previous) => {
  if (!state.workspace && previous.workspace)
    useCreationMergeStore.getState().clear()
})
