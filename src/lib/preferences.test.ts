import { describe, it, expect, vi, beforeEach } from 'vitest'
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
})

describe('updatePreferences — serialized save queue', () => {
  it('overlapping field patches never clobber each other', async () => {
    const disk = mockDisk({ theme: 'system' })

    // Both issued without awaiting the first — without serialization the
    // two load-modify-write cycles would race and one field would win.
    const first = updatePreferences({ sampleRate: 96000 })
    const second = updatePreferences({ language: 'zh-CN' })
    await Promise.all([first, second])

    expect(disk.read().sampleRate).toBe(96000)
    expect(disk.read().language).toBe('zh-CN')
  })

  it('merges per-project OSC targets without losing the other project', async () => {
    const disk = mockDisk({
      theme: 'system',
      oscTargets: { 'a-score': '127.0.0.1:3333' },
    })

    await updateOscTarget('b-score', '192.168.1.20:57120')

    expect(disk.read().oscTargets).toEqual({
      'a-score': '127.0.0.1:3333',
      'b-score': '192.168.1.20:57120',
    })
  })

  /// v1.2.3 (issue #38): colorTheme is patchable (the legacy `theme` field
  /// is not — a patch carrying it would be a compile error).
  it('patches colorTheme while the legacy theme field stays load-only', async () => {
    const disk = mockDisk({ theme: 'system', colorTheme: 'lavender' })

    await updatePreferences({ colorTheme: 'sand' })

    expect(disk.read().colorTheme).toBe('sand')
    expect(disk.read().theme).toBe('system')
  })

  it('a failed save hands the queue to the next save instead of stalling it', async () => {
    mockDisk({ theme: 'system' })
    vi.mocked(commands.savePreferences)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue({ status: 'ok', data: null })

    // The first save rejects; the second must still run to completion.
    await expect(updatePreferences({ language: 'en' })).rejects.toThrow(
      'disk full'
    )
    await updatePreferences({ sampleRate: 44100 })

    expect(commands.savePreferences).toHaveBeenCalledTimes(2)
    const lastCall = vi.mocked(commands.savePreferences).mock.calls[1]
    expect(lastCall?.[0]).toMatchObject({ sampleRate: 44100 })
  })

  it('writes nothing when the preferences file cannot be loaded', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'error',
      error: 'preferences unreadable',
    })

    await updatePreferences({ language: 'en' })

    expect(commands.savePreferences).not.toHaveBeenCalled()
  })
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
