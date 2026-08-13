import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ask } from '@tauri-apps/plugin-dialog'
import { commands } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import {
  initWindowState,
  toggleFullscreen,
  closeWindowWithFade,
  fadeInWindow,
  markQuitting,
  requestClose,
  useWindowStore,
} from './window-store'

vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: vi.fn(),
}))

describe('window-store (§7.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWindowStore.setState({
      fullscreen: false,
      showCustomTrafficLights: true,
      generation: 0,
    })
  })

  it('initWindowState syncs the initial snapshot', async () => {
    vi.mocked(commands.getWindowState).mockResolvedValue({
      status: 'ok',
      data: { fullscreen: true, showCustomTrafficLights: false, generation: 7 },
    })
    initWindowState()
    await vi.waitFor(() => {
      expect(useWindowStore.getState().fullscreen).toBe(true)
      expect(useWindowStore.getState().showCustomTrafficLights).toBe(false)
      expect(useWindowStore.getState().generation).toBe(7)
    })
  })

  it('toggleFullscreen calls the single Rust action and applies the result', async () => {
    vi.mocked(commands.toggleFullscreen).mockResolvedValue({
      status: 'ok',
      data: { fullscreen: true, showCustomTrafficLights: false, generation: 2 },
    })
    await toggleFullscreen()
    expect(commands.toggleFullscreen).toHaveBeenCalledTimes(1)
    expect(useWindowStore.getState().fullscreen).toBe(true)
    expect(useWindowStore.getState().showCustomTrafficLights).toBe(false)
  })

  it('fullscreen never touches the monitor reload nonce (§7.2)', async () => {
    // The reload nonce lives in the session store; fullscreen must not
    // bump it (resize ≠ reload).
    const { useSessionStore } = await import('@/store/session-store')
    const before = useSessionStore.getState().monitorReloadNonce
    await toggleFullscreen()
    await toggleFullscreen()
    expect(useSessionStore.getState().monitorReloadNonce).toBe(before)
  })

  it('closeWindowWithFade, fadeInWindow and markQuitting hit the Rust side', async () => {
    await closeWindowWithFade()
    await fadeInWindow()
    await markQuitting()
    expect(commands.closeWindowWithFade).toHaveBeenCalledTimes(1)
    expect(commands.fadeInWindow).toHaveBeenCalledTimes(1)
    expect(commands.markQuitting).toHaveBeenCalledTimes(1)
  })

  it('applyWindowSnapshot updates the store from pnds:window events', () => {
    useWindowStore.getState().applyWindowSnapshot({
      fullscreen: false,
      showCustomTrafficLights: true,
      generation: 3,
    })
    expect(useWindowStore.getState().fullscreen).toBe(false)
    expect(useWindowStore.getState().showCustomTrafficLights).toBe(true)
  })

  describe('requestClose (§v1.1.1 shared ⌘W / red-light close flow)', () => {
    beforeEach(() => {
      useSessionStore.setState({ sessionStatus: 'idle' })
    })

    it('closes immediately without a confirm when no session is live', async () => {
      await requestClose()
      expect(ask).not.toHaveBeenCalled()
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.closeWindowWithFade).toHaveBeenCalledTimes(1)
    })

    it('a cancelled confirm leaves the session running and the window open', async () => {
      useSessionStore.setState({ sessionStatus: 'ready' })
      vi.mocked(ask).mockResolvedValue(false)
      await requestClose()
      expect(ask).toHaveBeenCalledTimes(1)
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.closeWindowWithFade).not.toHaveBeenCalled()
      expect(useSessionStore.getState().sessionStatus).toBe('ready')
    })

    it('a confirmed close stops the session, then fades and hides the window', async () => {
      useSessionStore.setState({ sessionStatus: 'ready' })
      vi.mocked(ask).mockResolvedValue(true)
      await requestClose()
      expect(ask).toHaveBeenCalledTimes(1)
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.closeWindowWithFade).toHaveBeenCalledTimes(1)
      // stopAndReset returns the session to idle.
      expect(useSessionStore.getState().sessionStatus).toBe('idle')
    })

    it('also confirms while a session is starting', async () => {
      useSessionStore.setState({ sessionStatus: 'starting' })
      vi.mocked(ask).mockResolvedValue(true)
      await requestClose()
      expect(ask).toHaveBeenCalledTimes(1)
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
    })
  })
})
