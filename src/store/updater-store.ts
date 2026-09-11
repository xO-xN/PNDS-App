import { create } from 'zustand'
import {
  bootQuietRenderer,
  manualToastRenderer,
  type UpdaterRenderer,
} from '@/lib/updater'

/** The App-styled failure dialog's payload: the error text the
 * lifecycle's typed outcome carries. Check-only (#121) removed the
 * install phase, so a failure is always a check failure. */
export interface UpdaterFailure {
  reason: string
}

interface UpdaterState {
  /** v1.4.3 (#121): version of the update a check found; null = none.
   * In-app persistent (not preferences) — the starting page's notice
   * reads it and survives navigating away and back; the next boot's
   * check re-derives it. */
  available: string | null
  setUpdateAvailable: (version: string) => void
  /** The App-styled failure dialog is open with this failure; null =
   * closed. Set by the manual renderer below, rendered by
   * UpdaterFailureDialog (mounted in App outside AppShell, like the
   * close/quit confirms). */
  failure: UpdaterFailure | null
  showUpdaterFailure: (reason: string) => void
  clearUpdaterFailure: () => void
}

export const useUpdaterStore = create<UpdaterState>()(set => ({
  available: null,
  setUpdateAvailable: version => set({ available: version }),
  failure: null,
  showUpdaterFailure: reason => set({ failure: { reason } }),
  clearUpdaterFailure: () => set({ failure: null }),
}))

/** The production UpdaterRenderer pair (v1.4.3 #121). Manual (app menu +
 * Settings About): full feedback — the available/up-to-date toasts, and
 * check failures escalate to the App-styled dialog (copyable error
 * text, open-Releases escape hatch). Boot: completely silent — even a
 * failure renders nothing (a venue that cannot reach GitHub is the
 * norm, not an error). Both persist an available update into the store
 * so the starting page's notice outlives the toast. */
export const manualCheckRenderer: UpdaterRenderer = {
  ...manualToastRenderer,
  available(version) {
    useUpdaterStore.getState().setUpdateAvailable(version)
    manualToastRenderer.available(version)
  },
  checkFailed: reason => useUpdaterStore.getState().showUpdaterFailure(reason),
}

export const bootCheckRenderer: UpdaterRenderer = {
  ...bootQuietRenderer,
  available: version => useUpdaterStore.getState().setUpdateAvailable(version),
}
