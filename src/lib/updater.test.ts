import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from 'react'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { toast, type Action, type ExternalToast } from 'sonner'
import {
  BOOT_UPDATE_CHECK_DELAY_MS,
  bootToastRenderer,
  checkForUpdates,
  manualToastRenderer,
  performUpdateCheck,
  startBootUpdateCheck,
  type UpdaterRenderer,
} from './updater'

// The updater plugin is mocked globally in src/test/setup.ts (check →
// null); each test below overrides it. relaunch has no global mock — the
// boot flow must never relaunch in a test — and sonner is stubbed so the
// default toast renderers can be asserted without mounting a <Toaster/>.
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

function fakeUpdate(
  overrides: {
    version?: string
    downloadAndInstall?: Update['downloadAndInstall']
  } = {}
): Update {
  return {
    version: '1.4.0',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Update
}

function recordingRenderer(): UpdaterRenderer {
  return {
    available: vi.fn<(version: string, install: () => void) => void>(),
    upToDate: vi.fn<() => void>(),
    checkFailed: vi.fn<(reason: string) => void>(),
    installed: vi.fn<(restart: () => void) => void>(),
    installFailed: vi.fn<(reason: string) => void>(),
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

  it('returns the available version and an install continuation that downloads and wires restart', async () => {
    const update = fakeUpdate()
    vi.mocked(check).mockResolvedValue(update)

    const outcome = await performUpdateCheck()
    expect(outcome).toMatchObject({ kind: 'available', version: '1.4.0' })
    if (outcome.kind !== 'available') return

    const installResult = await outcome.install()
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(installResult).toMatchObject({ kind: 'installed' })
    if (installResult.kind !== 'installed') return

    await installResult.restart()
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('maps a download failure to install-failed with the error message', async () => {
    const update = fakeUpdate({
      downloadAndInstall: vi
        .fn()
        .mockRejectedValue(new Error('network dropped')),
    })
    vi.mocked(check).mockResolvedValue(update)

    const outcome = await performUpdateCheck()
    if (outcome.kind !== 'available') return

    await expect(outcome.install()).resolves.toEqual({
      kind: 'install-failed',
      reason: 'network dropped',
    })
    expect(relaunch).not.toHaveBeenCalled()
  })

  it('maps a check rejection to check-failed with the error message', async () => {
    vi.mocked(check).mockRejectedValue(new Error('offline'))

    await expect(performUpdateCheck()).resolves.toEqual({
      kind: 'check-failed',
      reason: 'offline',
    })
  })
})

describe('checkForUpdates (manual entry: menu / Settings)', () => {
  it('renders every outcome on the given renderer and keeps the install → restart chain wired', async () => {
    const update = fakeUpdate()
    vi.mocked(check).mockResolvedValue(update)
    const renderer = recordingRenderer()

    checkForUpdates(renderer)
    await vi.waitFor(() => expect(renderer.available).toHaveBeenCalled())
    const availableCall = vi.mocked(renderer.available).mock.calls[0]
    expect(availableCall?.[0]).toBe('1.4.0')

    availableCall?.[1]()
    await vi.waitFor(() => expect(renderer.installed).toHaveBeenCalled())
    const restart = vi.mocked(renderer.installed).mock.calls[0]?.[0]

    restart?.()
    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(renderer.upToDate).not.toHaveBeenCalled()
    expect(renderer.installFailed).not.toHaveBeenCalled()
  })

  it('surfaces a restart failure on the install-failed render instead of dropping it', async () => {
    vi.mocked(relaunch).mockRejectedValue(new Error('relaunch denied'))
    vi.mocked(check).mockResolvedValue(fakeUpdate())
    const renderer = recordingRenderer()

    checkForUpdates(renderer)
    await vi.waitFor(() => expect(renderer.available).toHaveBeenCalled())
    vi.mocked(renderer.available).mock.calls[0]?.[1]()
    await vi.waitFor(() => expect(renderer.installed).toHaveBeenCalled())

    vi.mocked(renderer.installed).mock.calls[0]?.[0]()
    await vi.waitFor(() => expect(renderer.installFailed).toHaveBeenCalled())
    expect(vi.mocked(renderer.installFailed).mock.calls[0]?.[0]).toBe(
      'relaunch denied'
    )
  })

  it('renders up-to-date and check failures (the boot path stays quiet on those)', async () => {
    const renderer = recordingRenderer()

    checkForUpdates(renderer)
    await vi.waitFor(() => expect(renderer.upToDate).toHaveBeenCalled())

    vi.mocked(check).mockRejectedValue(new Error('dns broke'))
    checkForUpdates(renderer)
    await vi.waitFor(() => expect(renderer.checkFailed).toHaveBeenCalled())
    expect(vi.mocked(renderer.checkFailed).mock.calls[0]?.[0]).toBe('dns broke')
  })

  it('draws the default toast renderer with locale copy and a working install action', async () => {
    const update = fakeUpdate()
    vi.mocked(check).mockResolvedValue(update)

    checkForUpdates()
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1))

    const infoCall = vi.mocked(toast.info).mock.calls[0]
    expect(infoCall?.[0]).toBe('Update Available')
    expect(infoCall?.[1]?.description).toBe('Version 1.4.0 is available')
    expect(actionOf(infoCall?.[1])?.label).toBe('Install')

    actionOf(infoCall?.[1])?.onClick(click())
    await vi.waitFor(() =>
      expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    )
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    const doneCall = vi.mocked(toast.success).mock.calls[0]
    expect(doneCall?.[0]).toBe('Update Installed')
    expect(actionOf(doneCall?.[1])?.label).toBe('Restart')

    actionOf(doneCall?.[1])?.onClick(click())
    expect(relaunch).toHaveBeenCalledTimes(1)
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

  it('checks after the boot delay and renders the available toast with its install action', async () => {
    const update = fakeUpdate()
    vi.mocked(check).mockResolvedValue(update)

    startBootUpdateCheck()
    expect(check).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_CHECK_DELAY_MS)
    expect(check).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledTimes(1))

    const infoCall = vi.mocked(toast.info).mock.calls[0]
    expect(actionOf(infoCall?.[1])?.label).toBe('Install')
    actionOf(infoCall?.[1])?.onClick(click())
    await vi.waitFor(() =>
      expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    )
  })

  it('cancelling the returned handle prevents the check', async () => {
    const cancel = startBootUpdateCheck()
    cancel()

    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_CHECK_DELAY_MS * 2)
    expect(check).not.toHaveBeenCalled()
  })

  it('stays silent when up-to-date and when the check fails (network noise at boot)', async () => {
    startBootUpdateCheck()
    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_CHECK_DELAY_MS)
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1))
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()

    vi.mocked(check).mockRejectedValue(new Error('offline'))
    startBootUpdateCheck()
    await vi.advanceTimersByTimeAsync(BOOT_UPDATE_CHECK_DELAY_MS)
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('renderer pair', () => {
  it('bootToastRenderer renders available but stays quiet on the silent outcomes', () => {
    bootToastRenderer.available('1.4.0', () => undefined)
    expect(toast.info).toHaveBeenCalledTimes(1)

    bootToastRenderer.upToDate()
    bootToastRenderer.checkFailed('offline')
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('manualToastRenderer surfaces the failure paths the boot renderer swallows', () => {
    manualToastRenderer.checkFailed('offline')
    expect(toast.error).toHaveBeenCalledTimes(1)
    manualToastRenderer.installFailed('network dropped')
    expect(toast.error).toHaveBeenCalledTimes(2)
  })
})
