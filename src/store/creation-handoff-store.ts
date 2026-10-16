import { create } from 'zustand'
import i18n from '@/i18n/config'
import {
  commands,
  type CreationError,
  type HandoffDocument,
  type HandoffTask,
  type HandoffReview,
  type HandoffReceipt,
} from '@/lib/tauri-bindings'
import { isProjectReadme, projectReadmeLocale } from '@/lib/creation-readme'
import type { CreationParticipant } from '@/lib/creation-lifecycle'
import { creationTransportError, useCreationStore } from './creation-store'
import { isDraftDirty, useCreationFilesStore } from './creation-files-store'

export const HANDOFF_PATH = 'docs/creator-handoff.md'
interface PendingTask {
  task: HandoffTask
  readme: boolean
}
interface HandoffState {
  pending: PendingTask[]
  activeId: string | null
  document: HandoffDocument | null
  busy: boolean
  conflict: boolean
  error: CreationError | null
  recorded: boolean
  draftChoice: boolean
  reviewDrafts: string | null
  review: HandoffReview | null
  receipt: HandoffReceipt | null
  offerReadmeSync: (path: string, version: string, locale: string) => void
  open: (id?: string) => Promise<void>
  prepareTask: (
    task: Pick<HandoffTask, 'intent' | 'files' | 'acceptance'> &
      Partial<Pick<HandoffTask, 'id' | 'status'>>
  ) => Promise<void>
  edit: (update: Partial<HandoffTask>) => void
  cancel: () => void
  record: (mode?: 'save' | 'saved') => Promise<void>
  settleReceipt: (receipt: HandoffReceipt) => void
  clear: () => void
}
let epoch = 0
const owns = (identity: string, captured: number) =>
  captured === epoch &&
  useCreationStore.getState().workspace?.project.identity === identity
const emptyTask = (): HandoffTask => ({
  id: crypto.randomUUID(),
  intent: '',
  files: [],
  acceptance: '',
  status: 'pending',
})
const hasWork = ({ task }: PendingTask) =>
  !!(task.intent || task.files.length || task.acceptance)

export const useCreationHandoffStore = create<HandoffState>((set, get) => ({
  pending: [],
  activeId: null,
  document: null,
  busy: false,
  conflict: false,
  error: null,
  recorded: false,
  review: null,
  receipt: null,
  draftChoice: false,
  reviewDrafts: null,
  prepareTask: async task => {
    if (get().busy) return
    const next = { ...emptyTask(), ...task }
    set(state => ({
      pending: state.pending.some(item => item.task.id === next.id)
        ? state.pending
        : [...state.pending, { task: next, readme: false }],
      recorded: false,
    }))
    await get().open(next.id)
  },
  offerReadmeSync: (path, version, locale) => {
    if (!isProjectReadme(path)) return
    const paths =
      useCreationStore.getState().workspace?.files.map(file => file.path) ?? []
    const source = projectReadmeLocale(path) ?? locale
    const target =
      source === 'zh-CN'
        ? paths.includes('README.en.md')
          ? 'README.en.md'
          : path !== 'README.md' && paths.includes('README.md')
            ? 'README.md'
            : 'README.en.md'
        : 'README.zh-CN.md'
    const task = {
      ...emptyTask(),
      intent: i18n.t('creation.handoff.syncIntent', { source: path, target }),
      files: [path, target],
      acceptance: i18n.t('creation.handoff.syncAcceptance', {
        source: path,
        target,
        version,
      }),
    }
    set(state => ({
      pending: [...state.pending, { task, readme: true }],
      recorded: false,
    }))
  },
  open: async id => {
    if (get().busy) return
    const identity = useCreationStore.getState().workspace?.project.identity
    if (!identity) return
    const task = id
      ? get().pending.find(item => item.task.id === id)
      : get().pending.find(item => !item.readme)
    const next = task ?? { task: emptyTask(), readme: false }
    const captured = ++epoch
    set(state => ({
      activeId: next.task.id,
      pending: task ? state.pending : [...state.pending, next],
      document: null,
      review: null,
      draftChoice: false,
      reviewDrafts: null,
      busy: true,
      conflict: false,
      error: null,
    }))
    try {
      const result = await commands.readCreationHandoff(identity)
      if (!owns(identity, captured)) return
      set(
        result.status === 'ok'
          ? { document: result.data, busy: false }
          : { error: result.error, busy: false }
      )
    } catch (error) {
      if (owns(identity, captured))
        set({ error: creationTransportError(error), busy: false })
    }
  },
  edit: update => {
    if (get().busy) return
    set(state => ({
      review: null,
      pending: state.pending.map(item =>
        item.task.id === state.activeId
          ? { ...item, task: { ...item.task, ...update, id: item.task.id } }
          : item
      ),
    }))
  },
  cancel: () => {
    if (!get().busy) {
      epoch++
      set({
        activeId: null,
        document: null,
        review: null,
        conflict: false,
        error: null,
      })
    }
  },
  record: async mode => {
    const state = get()
    const workspace = useCreationStore.getState().workspace
    const item = state.pending.find(item => item.task.id === state.activeId)
    if (!workspace || !item || state.busy || !state.document) return
    const dirtyDrafts = () =>
      Object.entries(useCreationFilesStore.getState().drafts).filter(
        ([, draft]) => isDraftDirty(draft)
      )
    const signature = () =>
      JSON.stringify(
        dirtyDrafts().map(([path, draft]) => [
          path,
          draft.text,
          draft.diskVersion,
        ])
      )
    if (
      !mode &&
      dirtyDrafts().length &&
      (!state.review || state.reviewDrafts !== signature())
    ) {
      set({ draftChoice: true, review: null })
      return
    }
    const identity = workspace.project.identity
    const captured = ++epoch
    set({ busy: true, error: null, draftChoice: false })
    try {
      if (mode === 'save') {
        for (const [path] of dirtyDrafts()) {
          await useCreationFilesStore.getState().save(path)
          if (!owns(identity, captured)) return
          const draft = useCreationFilesStore.getState().drafts[path]
          if (draft && (isDraftDirty(draft) || draft.error || draft.conflict)) {
            set({
              busy: false,
              review: null,
              draftChoice: true,
              error: draft.error ?? { code: 'versionConflict', detail: path },
            })
            return
          }
        }
        if (dirtyDrafts().length) {
          set({ busy: false, review: null, draftChoice: true })
          return
        }
      }
      if (
        Object.values(useCreationFilesStore.getState().drafts).some(
          draft => draft.saving || draft.renaming
        )
      ) {
        set({
          busy: false,
          error: {
            code: 'versionConflict',
            detail: i18n.t('creation.handoff.waitForSave'),
          },
        })
        return
      }
      if (!state.review || mode) {
        const preview = await commands.previewCreationHandoff(
          identity,
          item.task
        )
        if (!owns(identity, captured)) return
        set(
          preview.status === 'ok'
            ? {
                review: preview.data,
                reviewDrafts: signature(),
                document: preview.data.document,
                busy: false,
                conflict: false,
              }
            : { error: preview.error, busy: false }
        )
        return
      }
      const result = await commands.confirmCreationHandoff(
        identity,
        state.review.token
      )
      if (!owns(identity, captured)) return
      if (result.status === 'error') {
        if (result.error.code === 'versionConflict') {
          const fresh = await commands.readCreationHandoff(identity)
          if (!owns(identity, captured)) return
          set(
            fresh.status === 'ok'
              ? {
                  document: fresh.data,
                  review: null,
                  conflict: true,
                  busy: false,
                }
              : { document: null, error: fresh.error, busy: false }
          )
        } else set({ error: result.error, busy: false })
        return
      }
      const receipt = result.data
      if (!receipt.taskRecorded) {
        set({
          receipt,
          busy: false,
          error: receipt.baselineError,
          review: null,
        })
        return
      }
      get().settleReceipt(receipt)
      await useCreationFilesStore.getState().poll()
    } catch (error) {
      if (owns(identity, captured))
        set({ error: creationTransportError(error), busy: false })
    }
  },
  settleReceipt: receipt => {
    if (!receipt.taskRecorded) return
    const same = (task: HandoffTask) =>
      task.id === receipt.task.id &&
      task.intent === receipt.task.intent &&
      task.acceptance === receipt.task.acceptance &&
      task.status === receipt.task.status &&
      task.files.length === receipt.task.files.length &&
      task.files.every((path, index) => path === receipt.task.files[index])
    useCreationFilesStore.getState().handoffRecorded(receipt.document)
    set(state => {
      const activeSettled = state.pending.some(
        item => item.task.id === state.activeId && same(item.task)
      )
      return {
        pending: state.pending.filter(item => !same(item.task)),
        recorded: true,
        receipt,
        ...(activeSettled
          ? {
              activeId: null,
              busy: false,
              document: null,
              conflict: false,
              review: null,
            }
          : {}),
      }
    })
  },
  clear: () => {
    epoch++
    set({
      pending: [],
      activeId: null,
      document: null,
      busy: false,
      conflict: false,
      error: null,
      recorded: false,
      review: null,
      receipt: null,
      draftChoice: false,
      reviewDrafts: null,
    })
  },
}))

export const creationHandoffParticipant: CreationParticipant = {
  hasUnsavedChanges: () =>
    useCreationHandoffStore.getState().pending.some(hasWork),
  unsavedCount: () =>
    useCreationHandoffStore.getState().pending.filter(hasWork).length,
  confirmDiscard: async () => true,
}
let identity: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (next !== identity) {
    identity = next
    useCreationHandoffStore.getState().clear()
  }
})
