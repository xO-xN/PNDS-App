import { create } from 'zustand'
import type { PublicEntrySnapshot } from '@/lib/tauri-bindings'

export const useHostEntryStore = create<{
  snapshot: PublicEntrySnapshot
}>(() => ({
  snapshot: { status: 'unbound', url: null, error: null, portChanged: false },
}))
