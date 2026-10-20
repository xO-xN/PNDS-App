import { create } from 'zustand'
import type { PerformerRoster } from '@/lib/tauri-bindings'
import type {
  PerformerConfig,
  PerformerPageStatus,
} from '@/lib/performer-protocol'

export interface CreationPerformer extends PerformerConfig {
  pageStatus: PerformerPageStatus
  visible: boolean
}
export const useCreationPerformersStore = create<{
  windows: CreationPerformer[]
  error: string | null
  connections: PerformerRoster | null
  connectionStatus:
    | 'standby'
    | 'loading'
    | 'available'
    | 'unsupported'
    | 'unavailable'
}>()(() => ({
  windows: [],
  error: null,
  connections: null,
  connectionStatus: 'standby',
}))
