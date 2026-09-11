import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from 'react'
import { toast, type Action, type ExternalToast } from 'sonner'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  bootCheckRenderer,
  manualCheckRenderer,
  useUpdaterStore,
} from './updater-store'

// The store renderers spread the toast renderers from @/lib/updater;
// sonner is stubbed (same mock as updater.test.ts) so the inherited
// toast branches assert without a <Toaster/>, and the opener is stubbed
// so the available toast's Releases action asserts without IPC. The
// updater plugin itself is mocked globally in src/test/setup.ts; no
// path here downloads, installs, or relaunches anything (#121).
vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

/** Sonner types `action` as `Action | ReactNode`; the updater renderers
 * always pass an Action — narrow so assertions can reach label/onClick. */
function actionOf(options: ExternalToast | undefined): Action | undefined {
  const action = options?.action
  return action && typeof action === 'object' && 'onClick' in action
    ? action
    : undefined
}

/** Click argument for an Action's onClick — sonner hands the button
 * event; the updater's handlers ignore it. */
function click(): MouseEvent<HTMLButtonElement> {
  return {} as MouseEvent<HTMLButtonElement>
}

describe('updater-store (#121 check-only renderers)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUpdaterStore.setState({ available: null, failure: null })
  })

  it('manual: available persists into the store and toasts with a Releases action', () => {
    manualCheckRenderer.available('1.4.3')

    expect(useUpdaterStore.getState().available).toBe('1.4.3')
    expect(toast.info).toHaveBeenCalledTimes(1)
    const infoCall = vi.mocked(toast.info).mock.calls[0]
    expect(infoCall?.[0]).toBe('Update Available')
    expect(actionOf(infoCall?.[1])?.label).toBe('Go to Releases')

    actionOf(infoCall?.[1])?.onClick(click())
    expect(openUrl).toHaveBeenCalledWith(
      'https://github.com/xO-xN/PNDS-App/releases'
    )
  })

  it('manual: up-to-date confirms with a toast, check failure opens the dialog', () => {
    manualCheckRenderer.upToDate()
    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()

    manualCheckRenderer.checkFailed('dns broke')
    expect(useUpdaterStore.getState().failure).toEqual({ reason: 'dns broke' })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('boot: available persists silently; every other outcome renders nothing', () => {
    bootCheckRenderer.available('1.4.3')
    expect(useUpdaterStore.getState().available).toBe('1.4.3')
    expect(toast.info).not.toHaveBeenCalled()

    bootCheckRenderer.upToDate()
    bootCheckRenderer.checkFailed('offline')
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    // The failure dialog stays closed on the boot path — an offline
    // venue machine must never see a dialog.
    expect(useUpdaterStore.getState().failure).toBeNull()
  })

  it('the available state survives unrelated store churn (in-app persistence)', () => {
    useUpdaterStore.getState().setUpdateAvailable('1.4.3')

    // Failure/clear only touch the dialog slice, like a manual check
    // failing after the boot check already found a version.
    useUpdaterStore.getState().showUpdaterFailure('dns broke')
    useUpdaterStore.getState().clearUpdaterFailure()

    expect(useUpdaterStore.getState().available).toBe('1.4.3')
    expect(useUpdaterStore.getState().failure).toBeNull()
  })

  it('the latest failure wins and clearUpdaterFailure closes the dialog', () => {
    useUpdaterStore.getState().showUpdaterFailure('first')
    useUpdaterStore.getState().showUpdaterFailure('second')
    expect(useUpdaterStore.getState().failure).toEqual({ reason: 'second' })

    useUpdaterStore.getState().clearUpdaterFailure()
    expect(useUpdaterStore.getState().failure).toBeNull()
  })
})
