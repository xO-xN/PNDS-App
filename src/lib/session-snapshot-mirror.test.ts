import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { listen } from '@tauri-apps/api/event'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import {
  attachSessionSnapshotMirror,
  type SessionSnapshotMirror,
} from './session-snapshot-mirror'

type RestoreResult = Awaited<ReturnType<typeof commands.getSessionState>>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const idle: SessionSnapshot = {
  status: 'idle',
  projectName: null,
  projectPath: null,
  audioMode: 'none',
  lanIp: null,
  hostAddress: null,
  oscTarget: null,
  health: null,
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 0,
  channelPlan: null,
  outputDevice: null,
  projectionStarted: false,
  httpsEntry: { status: 'off', url: null, error: null },
  dnsMapping: { status: 'off', domain: null, ip: null, error: null },
}
const ready: SessionSnapshot = {
  ...idle,
  status: 'ready',
  projectName: 'Performance',
  projectPath: '/performance',
}

describe('session snapshot mirror', () => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const mirrors: SessionSnapshotMirror[] = []
  const unlisten = vi.fn()

  function publish(name: string, payload?: unknown) {
    listeners.get(name)?.forEach(receive => receive(payload))
  }

  function attach() {
    const onSnapshot = vi.fn()
    const onRestoreSettled = vi.fn()
    const mirror = attachSessionSnapshotMirror({
      onSnapshot,
      onRestoreSettled,
    })
    mirrors.push(mirror)
    return { ...mirror, onSnapshot, onRestoreSettled }
  }

  beforeEach(() => {
    listeners.clear()
    unlisten.mockClear()
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    vi.mocked(commands.getSessionState)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: idle })
    vi.mocked(listen).mockImplementation((name, handler) => {
      const receive = (payload: unknown) =>
        (handler as (event: { payload: unknown }) => void)({ payload })
      const entries = listeners.get(name as string) ?? new Set()
      entries.add(receive)
      listeners.set(name as string, entries)
      return Promise.resolve(() => {
        entries.delete(receive)
        unlisten()
      })
    })
  })

  afterEach(async () => {
    mirrors.splice(0).forEach(mirror => mirror.dispose())
    await Promise.resolve()
    vi.restoreAllMocks()
  })

  it('restores on mount, visibility and native focus, and receives live events', async () => {
    const mirror = attach()
    await Promise.resolve()
    expect(mirror.onSnapshot).toHaveBeenLastCalledWith(idle)
    expect(mirror.onRestoreSettled).toHaveBeenLastCalledWith(false)

    publish('session-snapshot-event', { snapshot: ready })
    expect(mirror.onSnapshot).toHaveBeenLastCalledWith(ready)
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    publish('window-focus-event')
    await Promise.resolve()
    expect(commands.getSessionState).toHaveBeenCalledTimes(3)
  })

  it('does not fetch for a hidden visibility event; native focus still catches up', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    attach()
    await Promise.resolve()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(commands.getSessionState).toHaveBeenCalledTimes(1)
    publish('window-focus-event')
    await Promise.resolve()
    expect(commands.getSessionState).toHaveBeenCalledTimes(2)
  })

  it.each(['ok', 'error', 'rejection'] as const)(
    'ignores an older request finishing with %s after a newer restore',
    async outcome => {
      const older = deferred<RestoreResult>()
      const newer = deferred<RestoreResult>()
      vi.mocked(commands.getSessionState)
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise)
      const mirror = attach()
      publish('window-focus-event')
      newer.resolve({ status: 'ok', data: ready })
      await Promise.resolve()

      if (outcome === 'rejection') older.reject(new Error('old IPC error'))
      else if (outcome === 'error')
        older.resolve({ status: 'error', error: 'old error' })
      else older.resolve({ status: 'ok', data: idle })
      await Promise.resolve()

      expect(mirror.onSnapshot.mock.calls).toEqual([[ready]])
      expect(mirror.onRestoreSettled.mock.calls).toEqual([[false]])
      expect(logger.warn).not.toHaveBeenCalled()
    }
  )

  it('keeps an event received during a restore, then confirms with a fresh read', async () => {
    const older = deferred<RestoreResult>()
    const catchUp = deferred<RestoreResult>()
    vi.mocked(commands.getSessionState)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(catchUp.promise)
    const mirror = attach()
    publish('session-snapshot-event', { snapshot: ready })
    older.resolve({ status: 'ok', data: idle })
    await Promise.resolve()

    expect(mirror.onSnapshot.mock.calls).toEqual([[ready]])
    expect(mirror.onRestoreSettled).toHaveBeenCalledWith(false)
    expect(commands.getSessionState).toHaveBeenCalledTimes(2)
    const current = { ...ready, volume: 65, projectionStarted: true }
    catchUp.resolve({ status: 'ok', data: current })
    await Promise.resolve()
    expect(mirror.onSnapshot.mock.calls).toEqual([[ready], [current]])
    expect(commands.getSessionState).toHaveBeenCalledTimes(2)
  })

  it('ignores a superseded response even while the newer request is pending', async () => {
    const older = deferred<RestoreResult>()
    const newer = deferred<RestoreResult>()
    vi.mocked(commands.getSessionState)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)
    const mirror = attach()
    mirror.restore()
    older.resolve({ status: 'ok', data: idle })
    await Promise.resolve()
    expect(mirror.onSnapshot).not.toHaveBeenCalled()
    expect(mirror.onRestoreSettled).not.toHaveBeenCalled()
    newer.resolve({ status: 'ok', data: ready })
    await Promise.resolve()
    expect(mirror.onSnapshot.mock.calls).toEqual([[ready]])
    expect(mirror.onRestoreSettled.mock.calls).toEqual([[false]])
  })

  it.each(['error', 'rejection'] as const)(
    'settles a current %s without erasing live state, and allows a later recovery',
    async outcome => {
      const pending = deferred<RestoreResult>()
      vi.mocked(commands.getSessionState).mockReturnValueOnce(pending.promise)
      const mirror = attach()
      publish('session-snapshot-event', { snapshot: ready })
      if (outcome === 'error')
        pending.resolve({ status: 'error', error: 'IPC unavailable' })
      else pending.reject(new Error('IPC unavailable'))
      await Promise.resolve()

      expect(mirror.onSnapshot.mock.calls).toEqual([[ready]])
      expect(mirror.onRestoreSettled.mock.calls).toEqual([[true]])
      expect(logger.warn).toHaveBeenCalledWith(
        'The session snapshot restore failed',
        { error: 'IPC unavailable' }
      )
      expect(commands.getSessionState).toHaveBeenCalledTimes(1)
      vi.mocked(commands.getSessionState).mockResolvedValue({
        status: 'ok',
        data: ready,
      })
      mirror.restore()
      await Promise.resolve()
      expect(mirror.onRestoreSettled.mock.calls).toEqual([[true], [false]])
    }
  )

  it.each(['ok', 'rejection'] as const)(
    'ignores late %s and queued callbacks after disposal, and removes listeners once',
    async outcome => {
      const pending = deferred<RestoreResult>()
      vi.mocked(commands.getSessionState).mockReturnValueOnce(pending.promise)
      const mirror = attach()
      const [queuedSession] = listeners.get('session-snapshot-event') ?? []
      const [queuedFocus] = listeners.get('window-focus-event') ?? []
      if (!queuedSession || !queuedFocus) throw new Error('Missing listeners')
      mirror.dispose()
      mirror.dispose()
      // Before asynchronous unlisten has completed, callbacks can still run.
      queuedSession({ snapshot: ready })
      queuedFocus(undefined)
      mirror.restore()
      document.dispatchEvent(new Event('visibilitychange'))
      if (outcome === 'ok') pending.resolve({ status: 'ok', data: ready })
      else pending.reject(new Error('late IPC error'))
      await Promise.resolve()

      expect(mirror.onSnapshot).not.toHaveBeenCalled()
      expect(mirror.onRestoreSettled).not.toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
      expect(commands.getSessionState).toHaveBeenCalledTimes(1)
      expect(unlisten).toHaveBeenCalledTimes(2)
      expect(listeners.get('session-snapshot-event')?.size).toBe(0)
      expect(listeners.get('window-focus-event')?.size).toBe(0)
    }
  )

  it('keeps request ordering and disposal independent for two instances', async () => {
    const pendingMain = deferred<RestoreResult>()
    const pendingProjection = deferred<RestoreResult>()
    vi.mocked(commands.getSessionState)
      .mockReturnValueOnce(pendingMain.promise)
      .mockReturnValueOnce(pendingProjection.promise)
    const main = attach()
    const projection = attach()
    pendingMain.resolve({ status: 'ok', data: ready })
    await Promise.resolve()
    expect(main.onSnapshot.mock.calls).toEqual([[ready]])
    expect(projection.onSnapshot).not.toHaveBeenCalled()
    pendingProjection.resolve({ status: 'ok', data: idle })
    await Promise.resolve()
    expect(projection.onSnapshot.mock.calls).toEqual([[idle]])

    main.dispose()
    await Promise.resolve()
    publish('session-snapshot-event', { snapshot: ready })
    expect(main.onSnapshot.mock.calls).toEqual([[ready]])
    expect(projection.onSnapshot.mock.calls).toEqual([[idle], [ready]])
  })
})
