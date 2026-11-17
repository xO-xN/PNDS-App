import { create } from 'zustand'
import i18n from '@/i18n/config'
import {
  createHandoffFeedback,
  runHandoffOperation,
} from '@/lib/handoff-operation'
import {
  commands,
  type CreationError,
  type HandoffBaselineCatalog,
  type HandoffReceipt,
  type HandoffComparison,
  type HandoffOperationProgress,
} from '@/lib/tauri-bindings'
import { creationTransportError, useCreationStore } from './creation-store'
import { useCreationHandoffStore } from './creation-handoff-store'
import { useCreationFilesStore } from './creation-files-store'

interface BaselinesState {
  catalog: HandoffBaselineCatalog | null
  busy: boolean
  error: CreationError | null
  receipt: HandoffReceipt | null
  comparison: HandoffComparison | null
  comparisonBusy: boolean
  selectedId: string | null
  stale: boolean
  operationProgress: HandoffOperationProgress | null
  compare: (id: string) => Promise<void>
  cancelComparison: () => void
  checkStale: () => Promise<void>
  load: () => Promise<void>
  retry: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}
let generation = 0
let comparisonController: AbortController | null = null
let comparisonGeneration = 0
let comparisonFeedback: ReturnType<typeof createHandoffFeedback> | null = null
let retryFeedback: ReturnType<typeof createHandoffFeedback> | null = null
const current = (identity: string, captured: number) =>
  captured === generation &&
  useCreationStore.getState().workspace?.project.identity === identity
export const useHandoffBaselinesStore = create<BaselinesState>((set, get) => {
  const operate = async (operation?: (identity: string) => Promise<void>) => {
    const identity = useCreationStore.getState().workspace?.project.identity
    if (!identity || get().busy) return
    const captured = generation
    set({ busy: true, error: null })
    try {
      await operation?.(identity)
      if (!current(identity, captured)) return
      const result = await commands.listHandoffBaselines(identity)
      if (!current(identity, captured)) return
      set(
        result.status === 'ok'
          ? { catalog: result.data, busy: false }
          : { error: result.error, busy: false }
      )
    } catch (error) {
      if (current(identity, captured))
        set({ error: creationTransportError(error), busy: false })
    }
  }
  return {
    catalog: null,
    busy: false,
    error: null,
    receipt: null,
    comparison: null,
    comparisonBusy: false,
    selectedId: null,
    stale: false,
    operationProgress: null,
    compare: async id => {
      const identity = useCreationStore.getState().workspace?.project.identity
      if (!identity) return
      const ownerGeneration = generation
      const captured = ++comparisonGeneration
      const revision = useCreationFilesStore.getState().diskRevision
      const owns = () =>
        current(identity, ownerGeneration) && comparisonGeneration === captured
      comparisonFeedback?.dismiss()
      const feedback = createHandoffFeedback(owns, 'handoff.feedback.comparing')
      comparisonFeedback = feedback
      set({
        selectedId: id,
        operationProgress: null,
        comparison: null,
        comparisonBusy: true,
        error: null,
        stale: false,
      })
      try {
        comparisonController?.abort()
        const controller = new AbortController()
        comparisonController = controller
        const result = await runHandoffOperation(
          identity,
          controller.signal,
          operationProgress => {
            if (owns()) {
              set({ operationProgress })
              feedback.progress(operationProgress)
            }
          },
          operationId =>
            commands.compareHandoffBaseline(identity, id, operationId)
        )
        if (comparisonController === controller) comparisonController = null
        if (!owns()) return
        set(
          result.status === 'ok'
            ? {
                comparison: result.data,
                comparisonBusy: false,
                stale:
                  useCreationFilesStore.getState().diskRevision !== revision,
              }
            : { error: result.error, comparisonBusy: false }
        )
        if (result.status === 'ok')
          feedback.succeed('handoff.feedback.compared')
        else feedback.fail(result.error)
      } catch (error) {
        if (owns()) {
          feedback.fail(creationTransportError(error))
          set({ error: creationTransportError(error), comparisonBusy: false })
        }
      } finally {
        feedback.dismiss()
        if (comparisonFeedback === feedback) comparisonFeedback = null
      }
    },
    cancelComparison: () => {
      comparisonFeedback?.dismiss()
      comparisonFeedback = null
      comparisonController?.abort()
      comparisonController = null
      comparisonGeneration++
      set({
        comparisonBusy: false,
        comparison: null,
        selectedId: null,
        stale: false,
      })
    },
    checkStale: async () => {
      const comparison = get().comparison
      const identity = useCreationStore.getState().workspace?.project.identity
      if (!comparison || !identity || get().comparisonBusy) return
      const captured = comparisonGeneration
      const ownerGeneration = generation
      try {
        const result = await commands.handoffComparisonIsStale(
          identity,
          comparison.currentFingerprint
        )
        if (
          !current(identity, ownerGeneration) ||
          captured !== comparisonGeneration ||
          get().comparison !== comparison
        )
          return
        if (result.status === 'error') set({ error: result.error, stale: true })
        else if (result.data) set({ stale: true })
      } catch (error) {
        if (
          current(identity, ownerGeneration) &&
          captured === comparisonGeneration
        )
          set({ error: creationTransportError(error), stale: true })
      }
    },
    load: () => operate(),
    retry: async id => {
      const identity = useCreationStore.getState().workspace?.project.identity
      if (!identity || get().busy) return
      const captured = generation
      const feedback = createHandoffFeedback(
        () => current(identity, captured),
        'handoff.feedback.retrying'
      )
      retryFeedback = feedback
      const previous = get().receipt
      let receipt =
        previous?.baselineId === id &&
        previous.taskRecorded &&
        !previous.baselineError
          ? previous
          : null
      set({ busy: true, error: null })
      try {
        // A successful native receipt survives catalog failures. The same
        // button then retries only the read, never the completed publication.
        if (!receipt) {
          const result = await commands.retryHandoffBaseline(identity, id)
          if (!current(identity, captured)) return
          if (result.status === 'error') throw result.error
          receipt = result.data
          set({ receipt, error: receipt.baselineError })
          if (receipt.taskRecorded)
            useCreationHandoffStore.getState().settleReceipt(receipt)
        }
        if (receipt.taskRecorded)
          feedback.step(i18n.t('handoff.feedback.refreshing'))
        const refreshed = await commands.listHandoffBaselines(identity)
        if (!current(identity, captured)) return
        if (refreshed.status === 'error') {
          set({ error: refreshed.error })
          if (receipt.taskRecorded)
            feedback.warn('handoff.feedback.refreshFailed')
          else feedback.fail(receipt.baselineError ?? refreshed.error)
        } else {
          set({ catalog: refreshed.data })
          if (
            receipt.taskRecorded &&
            receipt.baselineId &&
            !receipt.baselineError
          )
            feedback.succeed('creation.handoff.recorded')
          else if (receipt.taskRecorded)
            feedback.warn(
              'creation.handoff.baselineFailed',
              receipt.baselineError?.detail
            )
          else
            feedback.fail(receipt.baselineError ?? { code: 'io', detail: '' })
        }
      } catch (error) {
        if (current(identity, captured)) {
          const failure = creationTransportError(error)
          set({ error: failure })
          if (receipt?.taskRecorded)
            feedback.warn('handoff.feedback.refreshFailed')
          else feedback.fail(failure)
        }
      } finally {
        feedback.dismiss()
        if (retryFeedback === feedback) retryFeedback = null
        if (current(identity, captured)) set({ busy: false })
      }
    },
    remove: id =>
      operate(async identity => {
        const captured = generation
        const result = await commands.deleteHandoffBaseline(identity, id)
        if (!current(identity, captured)) return
        if (result.status === 'error') throw result.error
        if (get().selectedId === id) get().cancelComparison()
      }),
  }
})
let owner: string | null = null
useCreationStore.subscribe(state => {
  const next = state.workspace?.project.identity ?? null
  if (owner !== next) {
    owner = next
    comparisonFeedback?.dismiss()
    comparisonFeedback = null
    retryFeedback?.dismiss()
    retryFeedback = null
    comparisonController?.abort()
    comparisonController = null
    generation++
    comparisonGeneration++
    useHandoffBaselinesStore.setState({
      catalog: null,
      busy: false,
      error: null,
      receipt: null,
      comparison: null,
      comparisonBusy: false,
      selectedId: null,
      stale: false,
      operationProgress: null,
    })
  }
})
