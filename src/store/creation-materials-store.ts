import { create } from 'zustand'

interface MaterialView {
  identity: string
  id?: string
  version?: string
}

/** Viewing intent only. Private text and persistence remain behind native commands. */
export const useCreationMaterialsStore = create<{
  request: MaterialView | null
  open: (identity: string, id?: string, version?: string) => void
  close: () => void
}>(set => ({
  request: null,
  open: (identity, id, version) => set({ request: { identity, id, version } }),
  close: () => set({ request: null }),
}))
