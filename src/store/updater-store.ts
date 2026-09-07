import { create } from 'zustand'
import {
  bootToastRenderer,
  manualToastRenderer,
  type UpdaterRenderer,
} from '@/lib/updater'

/** Which lifecycle stage failed — the failure dialog's title keys off it.
 * The reason is the error text the lifecycle's typed outcomes carry. */
export type UpdaterFailurePhase = 'check' | 'install'

export interface UpdaterFailure {
  phase: UpdaterFailurePhase
  reason: string
}

interface UpdaterState {
  /** v1.4.0 (#60): the App-styled failure dialog is open with this
   * failure; null = closed. Set by the dialog renderers below, rendered
   * by UpdaterFailureDialog (mounted in App outside AppShell, like the
   * close/quit confirms). */
  failure: UpdaterFailure | null
  showUpdaterFailure: (phase: UpdaterFailurePhase, reason: string) => void
  clearUpdaterFailure: () => void
}

export const useUpdaterStore = create<UpdaterState>()(set => ({
  failure: null,
  showUpdaterFailure: (phase, reason) => set({ failure: { phase, reason } }),
  clearUpdaterFailure: () => set({ failure: null }),
}))

/** The second UpdaterRenderer pair (v1.4.0 #60): failure outcomes
 * escalate from silent/toast to the App-styled dialog — copyable error
 * text, open-Releases escape hatch — while every other outcome keeps the
 * toast renderers' behavior (available / installed toast, boot up-to-date
 * stays quiet). The lifecycle in @/lib/updater is untouched; the three
 * entries hand these in: app menu + Settings About (manual), boot
 * auto-check (boot). */
function withFailureDialog(base: UpdaterRenderer): UpdaterRenderer {
  return {
    ...base,
    checkFailed: reason =>
      useUpdaterStore.getState().showUpdaterFailure('check', reason),
    installFailed: reason =>
      useUpdaterStore.getState().showUpdaterFailure('install', reason),
  }
}

export const manualFailureDialogRenderer: UpdaterRenderer =
  withFailureDialog(manualToastRenderer)

export const bootFailureDialogRenderer: UpdaterRenderer =
  withFailureDialog(bootToastRenderer)
