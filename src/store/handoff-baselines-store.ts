import { create } from 'zustand'
import {
  commands,
  type CreationError,
  type HandoffBaselineCatalog,
  type HandoffReceipt,
  type HandoffComparison,
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
  compare: (id: string) => Promise<void>
  cancelComparison: () => void
  checkStale: () => Promise<void>
  load: () => Promise<void>
  retry: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
}
let generation = 0
let comparisonGeneration = 0
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
    compare: async id => {
      const identity = useCreationStore.getState().workspace?.project.identity
      if (!identity) return
      const ownerGeneration = generation
      const captured = ++comparisonGeneration
      const revision = useCreationFilesStore.getState().diskRevision
      const owns = () =>
        current(identity, ownerGeneration) && comparisonGeneration === captured
      set({
        selectedId: id,
        comparison: null,
        comparisonBusy: true,
        error: null,
        stale: false,
      })
      try {
        const result = await commands.compareHandoffBaseline(identity, id)
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
      } catch (error) {
        if (owns())
          set({ error: creationTransportError(error), comparisonBusy: false })
      }
    },
    cancelComparison: () => {
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
    retry: id =>
      operate(async identity => {
        const captured = generation
        const result = await commands.retryHandoffBaseline(identity, id)
        if (!current(identity, captured)) return
        if (result.status === 'error') throw result.error
        set({ receipt: result.data, error: result.data.baselineError })
        if (result.data.taskRecorded)
          useCreationHandoffStore.getState().settleReceipt(result.data)
      }),
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
    })
  }
})
