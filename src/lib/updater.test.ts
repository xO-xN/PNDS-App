import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast, type Action, type ExternalToast } from 'sonner'
import {
  BOOT_UPDATE_CHECK_DELAY_MS,
  bootQuietRenderer,
  checkForUpdates,
  manualToastRenderer,
  openReleasesPage,
  performUpdateCheck,
  RELEASES_URL,
  startBootUpdateCheck,
  type UpdaterRenderer,
} from './updater'

// The updater plugin is mocked globally in src/test/setup.ts (check →
// null); each test below overrides it. Check-only (#121): there is no
// download/install/relaunch path left to mock — the opener plugin is
// stubbed so the Releases action can be asserted without IPC. sonner is
// stubbed so the default toast renderers can be asserted without
// mounting a <Toaster/>.
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

/** The only plugin surface the check-only lifecycle reads: an offered
 * update is its version, nothing else. */
function fakeUpdate(version = '1.4.3'): Update {
  return { version } as unknown as Update
}

function recordingRenderer(): UpdaterRenderer {
  return {
    available: vi.fn<(version: string) => void>(),
    upToDate: vi.fn<() => void>(),
    checkFailed: vi.fn<(reason: string) => void>(),
  }
}

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

beforeEach(() => {
  vi.clearAllMocks()
  // setup.ts seeded check → null; restore that base after per-test overrides.
  vi.mocked(check).mockReset().mockResolvedValue(null)
})

describe('performUpdateCheck (typed outcomes)', () => {
  it('resolves up-to-date when no update is offered', async () => {
    vi.mocked(check).mockResolvedValue(null)

    await expect(performUpdateCheck()).resolves.toEqual({
      kind: 'up-to-date',
    })
  })

  it('returns the offered version — no install continuation', async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate('1.4.3'))

    await expect(performUpdateCheck()).resolves.toEqual({
      kind: 'available',
      version: '1.4.3',
    })
  })

  it('maps a check rejection to check-failed with the error message', async () => {
    vi.mocked(check).mockRejectedValue(new Error('offline'))

    await expect(performUpdateCheck()).resolves.toEqual({
      kind: 'check-failed',
      reason: 'offline',
    })
  })
})

describe('openReleasesPage (the single check-only action)', () => {
  it('opens the Releases URL', async () => {
    await openReleasesPage()
    expect(openUrl).toHaveBeenCalledWith(RELEASES_URL)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('falls back to a generic toast when the opener fails', async () => {
    vi.mocked(openUrl).mockRejectedValueOnce(new Error('no default browser'))
    await openReleasesPage()
    expect(toast.error).toHaveBeenCalledWith('Something went wrong')
  })
})

describe('checkForUpdates (manual entry: menu / Settings)', () => {
  it('renders every outcome on the given renderer', async () => {
    const renderer = recordingRenderer()

    checkForUpdates(renderer)
    await vi.waitFor(() => expect(renderer.upToDate).toHaveBeenCalled())

    vi.mocked(check).mockResolvedValue(fakeUpdate())
    checkForUpdates(renderer)
    await vi.waitFor(() =>
      expect(renderer.available).toHaveBeenCalledWith('1.4.3')
    )

    vi.mocked(check).mockRejectedValue(new Error('dns broke'))
    checkForUpdates(renderer)
    await vi.waitFor(() => expect(renderer.checkFailed).toHaveBeenCalled())
    expect(vi.mocked(renderer.checkFailed).mock.calls[0]?.[0]).toBe('dns broke')
  })

  it('draws the default toast renderer with locale copy and a Releases action', async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate('1.4.3'))

    checkForUpdates()
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1))

    const infoCall = vi.mocked(toast.info).mock.calls[0]
    expect(infoCall?.[0]).toBe('Update Available')
    expect(infoCall?.[1]?.description).toBe('Version 1.4.3 is available')
    expect(actionOf(infoCall?.[1])?.label).toBe('Go to Releases')

    actionOf(infoCall?.[1])?.onClick(click())
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith(RELEASES_URL))
    // Check-only: nothing else may follow the action — no install, no
    // restart, no second toast.
    expect(toast.success).not.toHaveBeenCalled()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('toasts the up-to-date and check-failure outcomes by default', async () => {
    checkForUpdates()
    await vi.waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'Up to Date',
        expect.objectContaining({
          description: 'You are running the latest version',
        })
      )
    )

    vi.mocked(check).mockRejectedValue(new Error('no route'))
    checkForUpdates()
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Update Check Failed',
        expect.objectContaining({
          description: 'Could not check for updates: no route',
        })
      )
    )
  })
})

describe('startBootUpdateCheck (boot entry)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks after the boot delay and stays completely silent on every outcome', async () => {
    startBootUpdateCheck()
    expect(check).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_CHECK_DELAY_MS)
    expect(check).toHaveBeenCalledTimes(1)
    // Up-to-date: nothing renders.
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()

    // Offline (the venue norm): still nothing renders.
    vi.mocked(check).mockRejectedValue(new Error('offline'))
    startBootUpdateCheck()
    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_CHECK_DELAY_MS)
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('renders nothing on the default renderer even when an update is offered', async () => {
    vi.mocked(check).mockResolvedValue(fakeUpdate())

    startBootUpdateCheck()
    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_CHECK_DELAY_MS)
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1))
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('cancelling the returned handle prevents the check', async () => {
    const cancel = startBootUpdateCheck()
    cancel()

    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_CHECK_DELAY_MS * 2)
    expect(check).not.toHaveBeenCalled()
  })
})

describe('renderer pair', () => {
  it('bootQuietRenderer renders nothing on any outcome', () => {
    bootQuietRenderer.available('1.4.3')
    bootQuietRenderer.upToDate()
    bootQuietRenderer.checkFailed('offline')
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('manualToastRenderer surfaces the failure path the boot renderer swallows', () => {
    manualToastRenderer.checkFailed('offline')
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
