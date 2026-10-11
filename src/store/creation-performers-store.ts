import { create } from 'zustand'
import type {
  PerformerConfig,
  PerformerPageStatus,
} from '@/lib/performer-protocol'

export interface CreationPerformer extends PerformerConfig {
  pageStatus: PerformerPageStatus
}
export const useCreationPerformersStore = create<{
  windows: CreationPerformer[]
  error: string | null
}>()(() => ({ windows: [], error: null }))
