import { create } from 'zustand'
import { commands, type WindowStateSnapshot } from '@/lib/tauri-bindings'
import { ask } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { logger } from '@/lib/logger'
import { shouldConfirmClose, useSessionStore } from '@/store/session-store'
import { stopAndReset } from '@/lib/open-project'

/**
 * Window state mirror (§7.4): the Rust WindowManager owns fullscreen and
 * fade state; React only renders it. `pnds:window` events + one initial
 * `getWindowState()` keep this store in sync (single direction, never
 * the other way).
 */
interface WindowState {
  fullscreen: boolean
  showCustomTrafficLights: boolean
  /** Bumped on every fullscreen/fade transition (re-sync signal). */
  generation: number
  applyWindowSnapshot: (snapshot: WindowStateSnapshot) => void
}

export const useWindowStore = create<WindowState>()(set => ({
  fullscreen: false,
  showCustomTrafficLights: true,
  generation: 0,

  applyWindowSnapshot: snapshot =>
    set({
      fullscreen: snapshot.fullscreen,
      showCustomTrafficLights: snapshot.showCustomTrafficLights,
      generation: snapshot.generation,
    }),
}))

/** Initial sync on app mount. */
export function initWindowState(): void {
  void commands.getWindowState().then(result => {
    if (result.status === 'ok') {
      useWindowStore.getState().applyWindowSnapshot(result.data)
    }
  })
}

/** §7.4: the single fullscreen action — menu, ⌃⌘F and sidebar all call it. */
export async function toggleFullscreen(): Promise<void> {
  const result = await commands.toggleFullscreen()
  if (result.status === 'ok') {
    useWindowStore.getState().applyWindowSnapshot(result.data)
  } else {
    console.error('toggleFullscreen failed:', result.error)
  }
}

/** Red light / Close Window: fade out, then hide (Rust does the ramp). */
export async function closeWindowWithFade(): Promise<void> {
  const result = await commands.closeWindowWithFade()
  if (result.status === 'error') {
    console.error('closeWindowWithFade failed:', result.error)
  }
}

/**
 * §v1.1.1: the one close flow shared by the ⌘W menu item and the red
 * traffic-light button. With a live session (starting/ready) it confirms
 * first; on confirm it stops the session (score server + audio) and then
 * fades the window out and hides it. With no live session it just fades.
 * The app keeps running and the Dock icon reopens the window (§7.4).
 */
export async function requestClose(): Promise<void> {
  const { sessionStatus } = useSessionStore.getState()
  if (shouldConfirmClose(sessionStatus)) {
    const t = i18n.t.bind(i18n)
    const confirmed = await ask(t('close.confirmMessage'), {
      title: t('close.confirmTitle'),
      kind: 'warning',
      okLabel: t('close.stopAndHide'),
      cancelLabel: t('close.cancel'),
    })
    if (!confirmed) {
      logger.info('Close cancelled — session left running')
      return
    }
    await stopAndReset()
  }
  await closeWindowWithFade()
}

/** First show / dock reopen: fade in from transparent. */
export async function fadeInWindow(): Promise<void> {
  const result = await commands.fadeInWindow()
  if (result.status === 'error') {
    console.error('fadeInWindow failed:', result.error)
  }
}

/** ⌘Q path: cancel any in-flight fade so quit never waits. */
export async function markQuitting(): Promise<void> {
  const result = await commands.markQuitting()
  if (result.status === 'error') {
    console.error('markQuitting failed:', result.error)
  }
}
