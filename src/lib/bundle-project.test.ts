import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useProjectStore } from '@/store/project-store'
import {
  installAndOpenBundle,
  drainPendingBundleOpens,
  reclaimIfManagedBundle,
} from './bundle-project'

/**
 * v1.2.0 (issue #16): `.pnds` open flows — install into the app-managed
 * bundles/ directory, then run the exact same open path as a directory
 * project (asserted via the preflight call openProject performs).
 */

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

const BUNDLE_PATH = '/Users/test/Demo Score-1.0.0.pnds'
const INSTALLED_PATH = '/bundles/demo-1.0.0'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.takePendingBundleOpens).mockReset()
  vi.mocked(commands.installBundle).mockReset()
  useProjectStore.setState({
    currentProject: null,
    recentProjectPaths: [],
    projectFolders: [],
    activeFolderId: null,
    preflightStatus: 'idle',
    preflightError: null,
  })
  vi.mocked(commands.installBundle).mockResolvedValue({
    status: 'ok',
    data: INSTALLED_PATH,
  })
  vi.mocked(commands.preflightProject).mockResolvedValue({
    status: 'ok',
    data: {
      schemaVersion: 1,
      id: 'demo',
      name: 'Demo Score',
      version: '1.0.0',
      description: null,
      scoreServer: {
        entry: 'server.js',
        workingDirectory: '.',
        performerPort: 6868,
        monitorPort: 6869,
      },
      audio: {
        defaultMode: 'internal',
        supportedModes: ['internal'],
        synthdefs: [],
        scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
        standaloneTarget: null,
      },
    },
  })
})

describe('installAndOpenBundle', () => {
  it('installs the bundle and opens the extracted directory like any project', async () => {
    await installAndOpenBundle(BUNDLE_PATH)

    expect(commands.installBundle).toHaveBeenCalledWith(BUNDLE_PATH)
    // openProject ran: the install dir entered the history and preflight
    // targeted it — the bundle path itself is never opened directly.
    expect(useProjectStore.getState().recentProjectPaths).toContain(
      INSTALLED_PATH
    )
    expect(commands.preflightProject).toHaveBeenCalledWith(INSTALLED_PATH)
  })

  it('reports an install failure and never opens anything', async () => {
    vi.mocked(commands.installBundle).mockResolvedValue({
      status: 'error',
      error: 'The bundle is missing pnds-bundle.json',
    })

    await installAndOpenBundle(BUNDLE_PATH)

    expect(notifications.error).toHaveBeenCalledWith(
      'Could not open the bundle',
      'The bundle is missing pnds-bundle.json'
    )
    expect(commands.preflightProject).not.toHaveBeenCalled()
    expect(useProjectStore.getState().recentProjectPaths).toEqual([])
  })
})

describe('drainPendingBundleOpens', () => {
  it('serializes another open event behind an installation already in flight', async () => {
    let finishInstall!: (
      result: Awaited<ReturnType<typeof commands.installBundle>>
    ) => void
    vi.mocked(commands.takePendingBundleOpens)
      .mockResolvedValueOnce({ status: 'ok', data: ['/a.pnds'] })
      .mockResolvedValueOnce({ status: 'ok', data: ['/b.pnds'] })
    vi.mocked(commands.installBundle)
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishInstall = resolve
          })
      )
      .mockResolvedValueOnce({ status: 'ok', data: '/bundles/b-1.0.0' })

    const first = drainPendingBundleOpens()
    await vi.waitFor(() =>
      expect(commands.installBundle).toHaveBeenCalledTimes(1)
    )
    const second = drainPendingBundleOpens()
    await Promise.resolve()
    await Promise.resolve()
    const installsWhileFirstPending = vi.mocked(commands.installBundle).mock
      .calls.length
    finishInstall({ status: 'ok', data: INSTALLED_PATH })
    await Promise.all([first, second])

    expect(installsWhileFirstPending).toBe(1)
    expect(commands.installBundle).toHaveBeenNthCalledWith(2, '/b.pnds')
    expect(useProjectStore.getState().currentProject?.path).toBe(
      '/bundles/b-1.0.0'
    )
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it.each(['result', 'invoke'])(
    'continues the batch after an install %s failure and reports it',
    async failure => {
      vi.mocked(commands.takePendingBundleOpens).mockResolvedValueOnce({
        status: 'ok',
        data: ['/broken.pnds', BUNDLE_PATH],
      })
      if (failure === 'invoke') {
        vi.mocked(commands.installBundle).mockRejectedValueOnce(
          new Error('IPC unavailable')
        )
      } else {
        vi.mocked(commands.installBundle).mockResolvedValueOnce({
          status: 'error',
          error: 'IPC unavailable',
        })
      }

      await expect(drainPendingBundleOpens()).resolves.toBeUndefined()

      expect(notifications.error).toHaveBeenCalledWith(
        'Could not open the bundle',
        'IPC unavailable'
      )
      expect(commands.installBundle).toHaveBeenNthCalledWith(2, BUNDLE_PATH)
      expect(useProjectStore.getState().currentProject?.path).toBe(
        INSTALLED_PATH
      )
    }
  )

  it('recovers on the next open event after a rejected queue read', async () => {
    vi.mocked(commands.takePendingBundleOpens)
      .mockRejectedValueOnce(new Error('IPC unavailable'))
      .mockResolvedValueOnce({ status: 'ok', data: [BUNDLE_PATH] })

    await expect(drainPendingBundleOpens()).resolves.toBeUndefined()
    await drainPendingBundleOpens()

    expect(useProjectStore.getState().currentProject?.path).toBe(INSTALLED_PATH)
  })

  it('reinstalls repeated bundles without duplicating their Library entry or loading', async () => {
    vi.mocked(commands.takePendingBundleOpens).mockResolvedValueOnce({
      status: 'ok',
      data: [BUNDLE_PATH, BUNDLE_PATH],
    })

    await drainPendingBundleOpens()

    expect(commands.installBundle).toHaveBeenCalledTimes(2)
    expect(useProjectStore.getState().recentProjectPaths).toEqual([
      INSTALLED_PATH,
    ])
    expect(useProjectStore.getState().currentProject?.path).toBe(INSTALLED_PATH)
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('installs every queued path once (macOS double-click opens)', async () => {
    vi.mocked(commands.takePendingBundleOpens).mockResolvedValue({
      status: 'ok',
      data: ['/a.pnds', '/b.pnds'],
    })

    await drainPendingBundleOpens()

    expect(commands.installBundle).toHaveBeenCalledTimes(2)
    expect(commands.installBundle).toHaveBeenNthCalledWith(1, '/a.pnds')
    expect(commands.installBundle).toHaveBeenNthCalledWith(2, '/b.pnds')
    // The drain consumed the queue exactly once — the mount-time drain and
    // the live event never double-process the same file.
    expect(commands.takePendingBundleOpens).toHaveBeenCalledTimes(1)
  })

  it('swallows a queue read failure (logged, not thrown)', async () => {
    vi.mocked(commands.takePendingBundleOpens).mockResolvedValue({
      status: 'error',
      error: 'poisoned',
    })

    await expect(drainPendingBundleOpens()).resolves.toBeUndefined()
    expect(commands.installBundle).not.toHaveBeenCalled()
  })
})

describe('reclaimIfManagedBundle', () => {
  it('delegates every removed path to the backend guard', async () => {
    vi.mocked(commands.reclaimProjectBundle).mockResolvedValue({
      status: 'ok',
      data: true,
    })

    await reclaimIfManagedBundle(INSTALLED_PATH)
    expect(commands.reclaimProjectBundle).toHaveBeenCalledWith(INSTALLED_PATH)
  })

  it('never throws on reclaim failure (index removal already happened)', async () => {
    vi.mocked(commands.reclaimProjectBundle).mockResolvedValue({
      status: 'error',
      error: 'permission denied',
    })

    await expect(
      reclaimIfManagedBundle(INSTALLED_PATH)
    ).resolves.toBeUndefined()
    expect(notifications.error).not.toHaveBeenCalled()
  })
})
