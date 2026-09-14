import { create } from 'zustand'

/**
 * v1.5.0 (#130): the projection window's EXISTENCE as the main window
 * knows it — driven exclusively by the ProjectionWindowEvent
 * (Rust-observed destruction, opener-announced creation; see
 * lib/events.ts). The ▶ gate button renders only while this is true,
 * and the ⌘⏎ menu entry rides it for enablement. The gate STATE itself
 * is session-scoped and lives in the session store's snapshot mirror —
 * this store is only the window fact.
 */
interface ProjectionState {
  /** True while the venue screen's window exists. */
  windowExists: boolean
  setWindowExists: (exists: boolean) => void
}

export const useProjectionStore = create<ProjectionState>()(set => ({
  windowExists: false,
  setWindowExists: exists => set({ windowExists: exists }),
}))
