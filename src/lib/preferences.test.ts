import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '@/lib/logger'
import { isNodeConfigComplete, ROOM_GROUPS } from './preferences'
import { commands, type AppPreferences } from '@/lib/tauri-bindings'
import {
  updatePreferences,
  updateOscTarget,
  isValidOscTarget,
  loadPreferences,
} from './preferences'

type Disk = Partial<AppPreferences> & { theme: string }

/**
 * A tiny in-memory stand-in for the preferences file: loads return the
 * current disk contents, saves replace them — so the queue's
 * load-modify-write cycles are observable through what survives.
 */
function mockDisk(initial: Disk) {
  let disk: Disk = { ...initial }
  vi.mocked(commands.loadPreferences).mockImplementation(async () => ({
    status: 'ok',
    data: { ...disk } as AppPreferences,
  }))
  vi.mocked(commands.savePreferences).mockImplementation(async prefs => {
    disk = { ...prefs }
    return { status: 'ok', data: null }
  })
  return {
    read: (): Disk => disk,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('updatePreferences — serialized save queue', () => {
  it('overlapping field patches never clobber each other', async () => {
    const disk = mockDisk({ theme: 'system' })

    // Both issued without awaiting the first — without serialization the
    // two load-modify-write cycles would race and one field would win.
    const first = updatePreferences({ sampleRate: 96000 })
    const second = updatePreferences({ language: 'zh-CN' })
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])

    expect(disk.read().sampleRate).toBe(96000)
    expect(disk.read().language).toBe('zh-CN')
  })

  it('merges per-project OSC targets without losing the other project', async () => {
    const disk = mockDisk({
      theme: 'system',
      oscTargets: { 'a-score': '127.0.0.1:3333' },
    })

    await expect(
      updateOscTarget('b-score', '192.168.1.20:57120')
    ).resolves.toBe(true)

    expect(disk.read().oscTargets).toEqual({
      'a-score': '127.0.0.1:3333',
      'b-score': '192.168.1.20:57120',
    })
  })

  /// v1.2.3 (issue #38): colorTheme is patchable (the legacy `theme` field
  /// is not — a patch carrying it would be a compile error).
  it('patches colorTheme while the legacy theme field stays load-only', async () => {
    const disk = mockDisk({ theme: 'system', colorTheme: 'pond' })

    await updatePreferences({ colorTheme: 'sand' })

    expect(disk.read().colorTheme).toBe('sand')
    expect(disk.read().theme).toBe('system')
  })
})

describe.each([
  { name: 'field patch', save: () => updatePreferences({ language: 'zh-CN' }) },
  {
    name: 'OSC target',
    save: () => updateOscTarget('b-score', '192.168.1.20:57120'),
  },
])('$name save outcome', ({ save }) => {
  it.each(['returned error', 'rejected invoke'])(
    'reports %s as false, logs once without preference values, and continues the queue',
    async failure => {
      const disk = mockDisk({
        theme: 'system',
        language: 'en',
        hubToken: 'private-test-token',
        oscTargets: { 'a-score': '127.0.0.1:3333' },
      })
      if (failure === 'returned error') {
        vi.mocked(commands.savePreferences).mockResolvedValueOnce({
          status: 'error',
          error: 'disk full',
        })
      } else {
        vi.mocked(commands.savePreferences).mockRejectedValueOnce(
          new Error('disk full')
        )
      }
      // Both issued before completion: the second must load the old,
      // unmodified disk, not carry the failed patch into its successful save.
      const failed = save()
      const next = updatePreferences({ sampleRate: 44100 })
      await expect(Promise.all([failed, next])).resolves.toEqual([false, true])

      expect(disk.read()).toEqual({
        theme: 'system',
        language: 'en',
        hubToken: 'private-test-token',
        oscTargets: { 'a-score': '127.0.0.1:3333' },
        sampleRate: 44100,
      })
      expect(commands.savePreferences).toHaveBeenCalledTimes(2)
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        'Failed to save preferences',
        { error: 'disk full' }
      )
    }
  )

  it.each(['returned error', 'rejected invoke'])(
    'does not write or claim success after a load %s, and permits a later save',
    async failure => {
      const disk = mockDisk({ theme: 'system', language: 'en', oscTargets: {} })
      if (failure === 'returned error') {
        vi.mocked(commands.loadPreferences).mockResolvedValueOnce({
          status: 'error',
          error: 'preferences unreadable',
        })
      } else {
        vi.mocked(commands.loadPreferences).mockRejectedValueOnce(
          new Error('IPC unavailable')
        )
      }
      await expect(save()).resolves.toBe(false)
      expect(commands.savePreferences).not.toHaveBeenCalled()
      // loadPreferences owns this warning; saving must not log a duplicate.
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(vi.mocked(logger.warn).mock.calls[0]?.[0]).toBe(
        'Failed to load preferences'
      )
      await expect(updatePreferences({ sampleRate: 96000 })).resolves.toBe(true)
      expect(disk.read()).toMatchObject({ language: 'en', sampleRate: 96000 })
    }
  )
})

/** #51: the load wrapper's contract is "null on ANY failure" — a
 * rejecting invoke (IPC unavailable) must resolve to null, never surface
 * an unhandled rejection in fire-and-forget mount chains. */
describe('loadPreferences — failure contract', () => {
  it('returns null when the invoke rejects', async () => {
    vi.mocked(commands.loadPreferences).mockImplementation(() =>
      Promise.reject(new Error('ipc unavailable'))
    )
    await expect(loadPreferences()).resolves.toBeNull()
  })
})

describe('isValidOscTarget (§6.6: host:port, port 1-65535)', () => {
  it.each([
    ['127.0.0.1:3333', true],
    ['localhost:6868', true],
    ['192.168.1.20:57120', true],
    ['no-port', false],
    [':3333', false],
    ['two words:3333', false],
    ['host:NaN-port', false],
    ['host:0', false],
    ['host:65536', false],
  ])('%s → %s', (target, expected) => {
    expect(isValidOscTarget(target)).toBe(expected)
  })
})

describe('isNodeConfigComplete (#58: completeness only, never connectivity)', () => {
  it('is set only when all three fields hold non-blank values', () => {
    expect(isNodeConfigComplete('Node', 'wss://hub', 'token')).toBe(true)
    expect(isNodeConfigComplete(null, 'wss://hub', 'token')).toBe(false)
    expect(isNodeConfigComplete('Node', '', 'token')).toBe(false)
    expect(isNodeConfigComplete('Node', 'wss://hub', undefined)).toBe(false)
    // Whitespace-only counts as unset, mirroring the Rust resolver.
    expect(isNodeConfigComplete('  ', 'wss://hub', 'token')).toBe(false)
    expect(isNodeConfigComplete('Node', ' \t ', 'token')).toBe(false)
  })

  it('offers exactly the Room dropdown groups 1-3', () => {
    expect(ROOM_GROUPS).toEqual([1, 2, 3])
  })
})
