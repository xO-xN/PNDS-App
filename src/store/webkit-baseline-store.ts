import { create } from 'zustand'

interface WebKitBaselineState {
  /** v1.4.2 (#110): the system WebKit sits below the Safari 16.4
   * baseline — the value is the detected Safari version, shown in the
   * dialog's details block; null = baseline met or probe unknown, no
   * prompt (the zero-disturbance half of the contract). Set by the
   * startup check in @/lib/webkit-baseline, rendered by
   * WebKitBaselineDialog (mounted in App outside AppShell, like the
   * close/quit confirms and the updater failure dialog). */
  belowBaselineVersion: string | null
  flagBelowBaseline: (version: string) => void
  clearBelowBaseline: () => void
}

export const useWebKitBaselineStore = create<WebKitBaselineState>()(set => ({
  belowBaselineVersion: null,
  flagBelowBaseline: version => set({ belowBaselineVersion: version }),
  clearBelowBaseline: () => set({ belowBaselineVersion: null }),
}))
