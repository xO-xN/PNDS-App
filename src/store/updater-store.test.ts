import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  bootFailureDialogRenderer,
  manualFailureDialogRenderer,
  useUpdaterStore,
} from './updater-store'

// The dialog renderers spread the toast renderers from @/lib/updater;
// sonner is stubbed (same mock as updater.test.ts) so the inherited toast
// branches assert without a <Toaster/>. The updater plugin itself is
// mocked globally in src/test/setup.ts; no path here reaches relaunch.
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

describe('updater-store (#60 failure dialog renderers)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUpdaterStore.setState({ failure: null })
  })

  it('escalates check and install failures to the dialog on both entries', () => {
    for (const renderer of [
      manualFailureDialogRenderer,
      bootFailureDialogRenderer,
    ]) {
      renderer.checkFailed('dns broke')
      expect(useUpdaterStore.getState().failure).toEqual({
        phase: 'check',
        reason: 'dns broke',
      })
      renderer.installFailed('network dropped')
      expect(useUpdaterStore.getState().failure).toEqual({
        phase: 'install',
        reason: 'network dropped',
      })
    }
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('manual renderer keeps the toast outcomes — available / up-to-date / installed', () => {
    manualFailureDialogRenderer.available('1.4.0', () => undefined)
    expect(toast.info).toHaveBeenCalledTimes(1)

    manualFailureDialogRenderer.upToDate()
    manualFailureDialogRenderer.installed(() => undefined)
    expect(toast.success).toHaveBeenCalledTimes(2)
  })

  it('boot renderer stays quiet on up-to-date but toasts an available update', () => {
    bootFailureDialogRenderer.upToDate()
    expect(toast.success).not.toHaveBeenCalled()

    bootFailureDialogRenderer.available('1.4.0', () => undefined)
    expect(toast.info).toHaveBeenCalledTimes(1)
  })

  it('the latest failure wins and clearUpdaterFailure closes the dialog', () => {
    useUpdaterStore.getState().showUpdaterFailure('check', 'first')
    useUpdaterStore.getState().showUpdaterFailure('install', 'second')
    expect(useUpdaterStore.getState().failure).toEqual({
      phase: 'install',
      reason: 'second',
    })

    useUpdaterStore.getState().clearUpdaterFailure()
    expect(useUpdaterStore.getState().failure).toBeNull()
  })
})
