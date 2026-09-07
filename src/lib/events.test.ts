import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emitTo, listen } from '@tauri-apps/api/event'
import type { SessionSnapshot } from '@/lib/tauri-bindings'
import {
  emitHelpNavigate,
  emitHelpTheme,
  onHelpNavigate,
  onSessionSnapshot,
  onWindowFocus,
} from './events'

const snapshot: SessionSnapshot = {
  status: 'ready',
  projectName: 'Inarticulate III',
  projectPath: '/p',
  audioMode: 'internal',
  lanIp: '192.168.1.10',
  hostAddress: null,
  oscTarget: null,
  health: null,
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 4,
  channelPlan: null,
  outputDevice: null,
}

/**
 * The event layer's contract: generated names only (never hand-typed at
 * call sites), the wrapper payload unwrapped for the callback, and a
 * synchronous unsubscribe. The help protocol's emitTo names live here.
 */
describe('events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('onSessionSnapshot subscribes under the generated name and unwraps the payload', () => {
    const cb = vi.fn()
    onSessionSnapshot(cb)

    expect(listen).toHaveBeenCalledWith(
      'session-snapshot-event',
      expect.any(Function)
    )
    const [, handler] = vi.mocked(listen).mock.calls.at(0) ?? []
    if (typeof handler !== 'function') throw new Error('not captured')
    ;(handler as (event: { payload: { snapshot: SessionSnapshot } }) => void)({
      payload: { snapshot },
    })
    expect(cb).toHaveBeenCalledWith(snapshot)
  })

  it('the unsubscribe is synchronous — it resolves the unlisten promise internally', async () => {
    const off = vi.fn()
    vi.mocked(listen).mockResolvedValue(off)

    const unsubscribe = onWindowFocus(() => undefined)
    expect(off).not.toHaveBeenCalled()
    unsubscribe()
    // The unlisten promise settles on the next microtask.
    await Promise.resolve()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('help protocol emitTo keeps its name held in this module', () => {
    emitHelpNavigate({ kind: 'search' })
    expect(emitTo).toHaveBeenCalledWith('help', 'pnds:help-navigate', {
      kind: 'search',
    })
    emitHelpTheme('stage')
    expect(emitTo).toHaveBeenCalledWith('help', 'pnds:help-theme', {
      colorTheme: 'stage',
    })
  })

  it('onHelpNavigate subscribes under the protocol name and forwards the payload', () => {
    const cb = vi.fn()
    onHelpNavigate(cb)

    expect(listen).toHaveBeenCalledWith(
      'pnds:help-navigate',
      expect.any(Function)
    )
    const [, handler] = vi.mocked(listen).mock.calls.at(0) ?? []
    if (typeof handler !== 'function') throw new Error('not captured')
    ;(handler as (event: { payload: { kind: 'search' } }) => void)({
      payload: { kind: 'search' },
    })
    expect(cb).toHaveBeenCalledWith({ kind: 'search' })
  })
})
