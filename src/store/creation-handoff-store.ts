import { create } from 'zustand'
import {
  createHandoffFeedback,
  runHandoffOperation,
} from '@/lib/handoff-operation'
import i18n from '@/i18n/config'
import {
  commands,
  type CreationError,
  type HandoffDocument,
  type HandoffTask,
  type HandoffReview,
  type HandoffReceipt,
  type HandoffOperationProgress,
} from '@/lib/tauri-bindings'
import { isProjectReadme, projectReadmeLocale } from '@/lib/creation-readme'
import type { CreationParticipant } from '@/lib/creation-lifecycle'
import { creationTransportError, useCreationStore } from './creation-store'
import { isDraftDirty, useCreationFilesStore } from './creation-files-store'
import { handoffEntries } from '@/lib/creation-handoff-document'

export const HANDOFF_PATH = 'docs/creator-handoff.md'
interface PendingTask {
  task: HandoffTask
  readme: boolean
  originId?: string
  recordedSource?: boolean
  documentEdit?: HandoffDocument
}
interface HandoffState {
  pending: PendingTask[]
  activeId: string | null
  document: HandoffDocument | null
  documentEdit: string | null
  receiptOriginId: string | null
  busy: boolean
  conflict: boolean
  error: CreationError | null
  recorded: boolean
  draftChoice: boolean
  reviewDrafts: string | null
  review: HandoffReview | null
  receipt: HandoffReceipt | null
  operationProgress: HandoffOperationProgress | null
  offerReadmeSync: (path: string, version: string, locale: string) => void
  open: (id?: string, isCurrent?: () => boolean) => Promise<void>
  prepareTask: (
    task: Pick<HandoffTask, 'intent' | 'files' | 'acceptance'> &
      Partial<Pick<HandoffTask, 'id' | 'status'>>,
    isCurrent?: () => boolean,
    recordedSource?: boolean
  ) => Promise<void>
  edit: (update: Partial<HandoffTask>) => void
  editDocument: (text: string) => void
  resetDocumentEdit: () => void
  replaceTaskId: (id: string) => void
  cancel: () => void
  record: (mode?: 'save' | 'saved') => Promise<void>
  settleReceipt: (receipt: HandoffReceipt) => void
  clear: () => void
}
let epoch = 0
let captureController: AbortController | null = null
let captureFeedback: ReturnType<typeof createHandoffFeedback> | null = null
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
const hasWork = ({ task, documentEdit }: PendingTask) =>
  !!(task.intent || task.files.length || task.acceptance || documentEdit)

export const useCreationHandoffStore = create<HandoffState>((set, get) => ({
  pending: [],
  activeId: null,
  document: null,
  documentEdit: null,
  receiptOriginId: null,
  busy: false,
  conflict: false,
  error: null,
  recorded: false,
  review: null,
  receipt: null,
  operationProgress: null,
  draftChoice: false,
  reviewDrafts: null,
  prepareTask: async (task, isCurrent, recordedSource = false) => {
    if (get().busy || isCurrent?.() === false) return
    const next = { ...emptyTask(), ...task }
    const existing = get().pending.find(
      item => item.task.id === next.id || item.originId === next.id
    )
    set(state => ({
      pending: existing
        ? state.pending
        : [
            ...state.pending,
            { task: next, readme: false, originId: next.id, recordedSource },
          ],
      recorded: false,
    }))
    await get().open(existing?.task.id ?? next.id, isCurrent)
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
  open: async (id, isCurrent) => {
    if (get().busy || isCurrent?.() === false) return
    const identity = useCreationStore.getState().workspace?.project.identity
    if (!identity) return
    const task = id
      ? get().pending.find(item => item.task.id === id)
      : get().pending.find(item => !item.readme)
    const next: PendingTask = task ?? { task: emptyTask(), readme: false }
    captureFeedback?.dismiss()
    captureFeedback = null
    const captured = ++epoch
    set(state => ({
      activeId: next.task.id,
      pending: task ? state.pending : [...state.pending, next],
      document: null,
      documentEdit: next.documentEdit?.text ?? null,
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
      if (isCurrent?.() === false) {
        set({ activeId: null, document: null, busy: false })
        return
      }
      set(
        result.status === 'ok'
          ? { document: result.data, busy: false }
          : { error: result.error, busy: false }
      )
    } catch (error) {
      if (owns(identity, captured))
        set(
          isCurrent?.() === false
            ? { activeId: null, document: null, busy: false }
            : { error: creationTransportError(error), busy: false }
        )
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
  editDocument: text => {
    const state = get()
    const document = state.document
    if (state.busy || !document) return
    set({
      documentEdit: text,
      review: null,
      pending: state.pending.map(item =>
        item.task.id === state.activeId
          ? {
              ...item,
              documentEdit: {
                text,
                version: item.documentEdit
                  ? item.documentEdit.version
                  : document.version,
              },
            }
          : item
      ),
    })
  },
  resetDocumentEdit: () => {
    if (get().busy) return
    set(state => ({
      documentEdit: null,
      review: null,
      pending: state.pending.map(item =>
        item.task.id === state.activeId
          ? { ...item, documentEdit: undefined }
          : item
      ),
    }))
  },
  replaceTaskId: id => {
    const state = get()
    const active = state.pending.find(item => item.task.id === state.activeId)
    if (
      state.busy ||
      !active ||
      (id &&
        !handoffEntries(state.document?.text ?? '').some(
          item => item.id === id
        ))
    )
      return
    const originId = active.originId ?? active.task.id
    const nextId = id || crypto.randomUUID()
    if (state.pending.some(item => item !== active && item.task.id === nextId))
      return
    set({
      activeId: nextId,
      review: null,
      pending: state.pending.map(item =>
        item === active
          ? {
              ...item,
              originId,
              recordedSource: false,
              task: { ...item.task, id: nextId, status: 'pending' },
            }
          : item
      ),
    })
  },
  cancel: () => {
    if (get().busy) {
      captureController?.abort()
      return
    }
    if (!get().busy) {
      captureFeedback?.dismiss()
      captureFeedback = null
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
    if (
      item.recordedSource &&
      !state.document.text.includes(`<!-- pnds-task:${item.task.id} -->`)
    )
      return
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
    captureFeedback?.dismiss()
    const captured = ++epoch
    const feedback = createHandoffFeedback(
      () => owns(identity, captured),
      state.review && !mode
        ? 'handoff.feedback.recording'
        : 'handoff.feedback.previewing'
    )
    captureFeedback = feedback
    let recordedReceipt: HandoffReceipt | null = null
    set({
      busy: true,
      error: null,
      draftChoice: false,
      operationProgress: null,
    })
    try {
      if (mode === 'save') {
        feedback.step(i18n.t('creation.saving'))
        for (const [path] of dirtyDrafts()) {
          await useCreationFilesStore.getState().save(path)
          if (!owns(identity, captured)) return
          const draft = useCreationFilesStore.getState().drafts[path]
          if (draft && (isDraftDirty(draft) || draft.error || draft.conflict)) {
            feedback.fail(
              draft.error ?? { code: 'versionConflict', detail: path }
            )
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
          feedback.fail({
            code: 'versionConflict',
            detail: i18n.t('creation.handoff.waitForSave'),
          })
          set({ busy: false, review: null, draftChoice: true })
          return
        }
      }
      if (
        Object.values(useCreationFilesStore.getState().drafts).some(
          draft => draft.saving || draft.renaming
        )
      ) {
        feedback.fail({
          code: 'versionConflict',
          detail: i18n.t('creation.handoff.waitForSave'),
        })
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
        feedback.step(i18n.t('handoff.feedback.previewing'))
        const preview = item.documentEdit
          ? await commands.previewCreationHandoffUpdate(
              identity,
              item.task,
              item.documentEdit
            )
          : await commands.previewCreationHandoff(identity, item.task)
        if (!owns(identity, captured)) return
        if (
          preview.status === 'error' &&
          preview.error.code === 'versionConflict'
        ) {
          feedback.fail(preview.error)
          const fresh = await commands.readCreationHandoff(identity)
          if (!owns(identity, captured)) return
          set(
            fresh.status === 'ok'
              ? {
                  document: fresh.data,
                  review: null,
                  conflict: true,
                  busy: false,
                  error: preview.error,
                }
              : { document: null, error: fresh.error, busy: false }
          )
          return
        }
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
        if (preview.status === 'ok')
          feedback.message('handoff.feedback.reviewReady')
        else feedback.fail(preview.error)
        return
      }
      const controller = new AbortController()
      captureController = controller
      const token = state.review.token
      const result = await runHandoffOperation(
        identity,
        controller.signal,
        operationProgress => {
          if (owns(identity, captured)) {
            set({ operationProgress })
            feedback.progress(operationProgress)
          }
        },
        operationId =>
          commands.confirmCreationHandoff(identity, token, operationId)
      )
      if (captureController === controller) captureController = null
      if (!owns(identity, captured)) return
      if (result.status === 'error') {
        feedback.fail(result.error)
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
        feedback.fail(
          receipt.baselineError ?? {
            code: 'io',
            detail: i18n.t('handoff.baselines.incomplete'),
          }
        )
        set({
          receipt,
          busy: false,
          error: receipt.baselineError,
          review: null,
        })
        return
      }
      recordedReceipt = receipt
      get().settleReceipt(receipt)
      feedback.step(i18n.t('handoff.feedback.refreshing'))
      const synchronized = await useCreationFilesStore.getState().poll()
      if (!owns(identity, captured)) return
      if (receipt.baselineError || !receipt.baselineId)
        feedback.warn(
          'creation.handoff.baselineFailed',
          receipt.baselineError?.detail
        )
      else if (!synchronized) feedback.warn('handoff.feedback.refreshFailed')
      else feedback.succeed('creation.handoff.recorded')
    } catch (error) {
      if (owns(identity, captured)) {
        if (recordedReceipt) feedback.warn('handoff.feedback.refreshFailed')
        else feedback.fail(creationTransportError(error))
        set({ error: creationTransportError(error), busy: false })
      }
    } finally {
      feedback.dismiss()
      if (captureFeedback === feedback) captureFeedback = null
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
        receiptOriginId:
          state.pending.find(item => same(item.task))?.originId ??
          receipt.task.id,
        ...(activeSettled
          ? {
              activeId: null,
              busy: false,
              document: null,
              documentEdit: null,
              conflict: false,
              review: null,
            }
          : {}),
      }
    })
  },
  clear: () => {
    captureFeedback?.dismiss()
    captureFeedback = null
    captureController?.abort()
    captureController = null
    epoch++
    set({
      pending: [],
      activeId: null,
      document: null,
      documentEdit: null,
      receiptOriginId: null,
      busy: false,
      conflict: false,
      error: null,
      recorded: false,
      review: null,
      receipt: null,
      operationProgress: null,
      draftChoice: false,
      reviewDrafts: null,
    })
  },
}))

export const creationHandoffParticipant: CreationParticipant = {
  draftsSnapshot: () => useCreationHandoffStore.getState().pending,
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
