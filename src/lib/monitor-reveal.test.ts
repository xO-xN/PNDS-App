import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  monitorNavigationRevealed,
  MONITOR_REVEAL_TIMEOUT_MS,
} from './monitor-reveal'
import { useSessionStore } from '@/store/session-store'
import { logger } from '@/lib/logger'
import type { SessionSnapshot } from '@/lib/tauri-bindings'

const snapshot = (overrides: Partial<SessionSnapshot>): SessionSnapshot => ({
  status: 'idle',
  projectName: null,
  projectPath: null,
  audioMode: null,
  lanIp: null,
  oscTarget: null,
  health: null,
  error: null,
  outputTail: [],
  volume: 80,
  startupStage: 0,
  channelPlan: null,
  outputDevice: null,
  ...overrides,
})

/**
 * v1.3.0 (#50): the loading→monitor reveal gate. The three release
 * conditions the ticket names — session-ready alone must HOLD, the
 * iframe's own load event releases, the timeout backstop releases —
 * plus the flag lifecycle that re-arms the gate per navigation.
 */
describe('monitorNavigationRevealed (#50 release conditions)', () => {
  it('holds when the session is merely ready (no iframe signal, no timeout)', () => {
    expect(monitorNavigationRevealed(false, false)).toBe(false)
  })

  it('releases when the navigation reports its iframe loaded', () => {
    expect(monitorNavigationRevealed(true, false)).toBe(true)
  })

  it('releases when the timeout backstop fires', () => {
    expect(monitorNavigationRevealed(false, true)).toBe(true)
  })

  it('bounds the backstop wait at a fixed, generous threshold', () => {
    // Local monitor pages load in well under a second; the backstop
    // only catches true stalls — pin the constant so it can't drift
    // silently between the armer and the docs.
    expect(MONITOR_REVEAL_TIMEOUT_MS).toBe(10_000)
  })
})

describe('reveal gate lifecycle (session store)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSessionStore.setState({
      monitorReloadNonce: 0,
      monitorLoaded: false,
      monitorLoadTimedOut: false,
    })
  })

  it('markMonitorLoaded reports the current navigation ready', () => {
    useSessionStore.getState().markMonitorLoaded()
    expect(useSessionStore.getState().monitorLoaded).toBe(true)
  })

  it('markMonitorTimedOut releases and logs the backstop', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)

    useSessionStore.getState().markMonitorTimedOut()

    expect(useSessionStore.getState().monitorLoadTimedOut).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('reveal gate')
  })

  it('a monitor reload re-arms the gate (the fresh navigation waits again)', () => {
    useSessionStore.getState().markMonitorLoaded()
    expect(monitorNavigationRevealed(true, false)).toBe(true)

    useSessionStore.getState().bumpMonitorReload()

    const state = useSessionStore.getState()
    expect(state.monitorReloadNonce).toBe(1)
    expect(state.monitorLoaded).toBe(false)
    expect(state.monitorLoadTimedOut).toBe(false)
    expect(
      monitorNavigationRevealed(state.monitorLoaded, state.monitorLoadTimedOut)
    ).toBe(false)
  })

  it('every new run resets the gate; mid-run snapshots never re-arm it', () => {
    // A run reaches ready with the gate released…
    useSessionStore
      .getState()
      .applySnapshot(snapshot({ status: 'ready', projectPath: '/p' }))
    useSessionStore.getState().markMonitorLoaded()

    // …health-refresh snapshots (ready → ready) keep the released state…
    useSessionStore
      .getState()
      .applySnapshot(snapshot({ status: 'ready', projectPath: '/p' }))
    expect(useSessionStore.getState().monitorLoaded).toBe(true)

    // …only entering a NEW run (starting) re-arms it.
    useSessionStore
      .getState()
      .applySnapshot(snapshot({ status: 'starting', projectPath: '/q' }))
    expect(useSessionStore.getState()).toMatchObject({
      monitorLoaded: false,
      monitorLoadTimedOut: false,
    })
  })

  it('resetSession clears the gate with the rest of the run state', () => {
    useSessionStore.getState().markMonitorLoaded()
    useSessionStore.getState().resetSession()
    expect(useSessionStore.getState().monitorLoaded).toBe(false)
  })
})
