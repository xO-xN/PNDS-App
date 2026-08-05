import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import {
  initWindowState,
  toggleFullscreen,
  closeWindowWithFade,
  fadeInWindow,
  markQuitting,
  useWindowStore,
} from './window-store'

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
})
