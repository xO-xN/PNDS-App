import i18n from '@/i18n/config'
import { notifications } from '@/lib/notifications'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerCreationParticipant } from '@/lib/creation-lifecycle'
import { commands } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import {
  initWindowState,
  toggleFullscreen,
  closeWindowWithFade,
  fadeInWindow,
  markQuitting,
  requestClose,
  requestQuit,
  quitNow,
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

  describe('requestClose (§v1.1.1 shared ⌘W / red-light close flow)', () => {
    beforeEach(() => {
      useSessionStore.setState({ sessionStatus: 'idle' })
      useWindowStore.setState({ confirmCloseOpen: false })
    })

    it('closes immediately without a confirm when no session is live', async () => {
      await requestClose()
      expect(useWindowStore.getState().confirmCloseOpen).toBe(false)
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.closeWindowWithFade).toHaveBeenCalledTimes(1)
    })

    it('opens the in-app confirm dialog instead of the native alert when live', async () => {
      useSessionStore.setState({ sessionStatus: 'ready' })
      await requestClose()
      expect(useWindowStore.getState().confirmCloseOpen).toBe(true)
      // The dialog's confirm button (CloseConfirmDialog) runs the stop+fade;
      // requestClose itself must not touch the session or the window yet.
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.closeWindowWithFade).not.toHaveBeenCalled()
    })

    it('also opens the dialog while a session is starting', async () => {
      useSessionStore.setState({ sessionStatus: 'starting' })
      await requestClose()
      expect(useWindowStore.getState().confirmCloseOpen).toBe(true)
      expect(commands.closeWindowWithFade).not.toHaveBeenCalled()
    })

    it('setConfirmCloseOpen closes the dialog (Esc / overlay / cancel)', () => {
      useWindowStore.getState().setConfirmCloseOpen(true)
      expect(useWindowStore.getState().confirmCloseOpen).toBe(true)
      useWindowStore.getState().setConfirmCloseOpen(false)
      expect(useWindowStore.getState().confirmCloseOpen).toBe(false)
    })
  })

  describe('requestQuit (v1.1.2 T7 ⌘Q flow)', () => {
    let unregister: (() => void) | undefined
    afterEach(() => unregister?.())
    beforeEach(() => {
      useSessionStore.setState({ sessionStatus: 'idle' })
      useWindowStore.setState({ quitConfirmOpen: false })
    })

    it('quits immediately — no dialog — when no session is live', async () => {
      await requestQuit()
      expect(useWindowStore.getState().quitConfirmOpen).toBe(false)
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.markQuitting).not.toHaveBeenCalled()
      expect(commands.quitApp).toHaveBeenCalledTimes(1)
    })

    it('keeps unsaved creation drafts behind a quit confirmation while idle', async () => {
      unregister = registerCreationParticipant({
        hasUnsavedChanges: () => true,
        unsavedCount: () => 2,
      })
      await requestQuit()
      expect(useWindowStore.getState().quitConfirmOpen).toBe(true)
      expect(commands.markQuitting).not.toHaveBeenCalled()
      expect(commands.quitApp).not.toHaveBeenCalled()
    })

    it('quits immediately from the error state too', async () => {
      useSessionStore.setState({ sessionStatus: 'error' })
      await requestQuit()
      expect(useWindowStore.getState().quitConfirmOpen).toBe(false)
      expect(commands.quitApp).toHaveBeenCalledTimes(1)
    })

    it('opens the in-app confirm dialog while a session runs', async () => {
      useSessionStore.setState({ sessionStatus: 'ready' })
      await requestQuit()
      expect(useWindowStore.getState().quitConfirmOpen).toBe(true)
      // The dialog's confirm button (QuitConfirmDialog) runs the stop+exit;
      // requestQuit itself must not quit underneath the prompt.
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.quitApp).not.toHaveBeenCalled()
    })

    it('also opens the dialog while a session is starting', async () => {
      useSessionStore.setState({ sessionStatus: 'starting' })
      await requestQuit()
      expect(useWindowStore.getState().quitConfirmOpen).toBe(true)
      expect(commands.quitApp).not.toHaveBeenCalled()
    })
  })
})

it('keeps native cleanup refusal retryable with accurate localized participation feedback', async () => {
  const notify = vi.spyOn(notifications, 'error').mockResolvedValue(undefined)
  await i18n.changeLanguage('zh-CN')
  try {
    vi.mocked(commands.quitApp).mockResolvedValueOnce({
      status: 'error',
      error: 'participation.errors.cleanupFailed',
    })
    expect(await quitNow()).toBe(false)
    expect(notify).toHaveBeenCalledWith(
      '池客资源尚未清理完成，请重试离开后再切换角色或退出。'
    )
    expect(await quitNow()).toBe(true)
  } finally {
    notify.mockRestore()
    await i18n.changeLanguage('en')
  }
})
