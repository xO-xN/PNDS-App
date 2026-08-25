import { create } from 'zustand'
import { commands, type WindowStateSnapshot } from '@/lib/tauri-bindings'
import { shouldConfirmClose, useSessionStore } from '@/store/session-store'

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
  /** §v1.1.1: the in-app close-confirm dialog is open (⌘W / red light with
   * a live session). Rendered by CloseConfirmDialog — replaces the native
   * macOS alert so the prompt matches the app's design system. */
  confirmCloseOpen: boolean
  /** v1.1.2 T7: the in-app quit-confirm dialog is open (⌘Q with a live
   * session). Rendered by QuitConfirmDialog, same design system. */
  quitConfirmOpen: boolean
  applyWindowSnapshot: (snapshot: WindowStateSnapshot) => void
  setConfirmCloseOpen: (open: boolean) => void
  setQuitConfirmOpen: (open: boolean) => void
}

export const useWindowStore = create<WindowState>()(set => ({
  fullscreen: false,
  showCustomTrafficLights: true,
  generation: 0,
  confirmCloseOpen: false,
  quitConfirmOpen: false,

  applyWindowSnapshot: snapshot =>
    set({
      fullscreen: snapshot.fullscreen,
      showCustomTrafficLights: snapshot.showCustomTrafficLights,
      generation: snapshot.generation,
    }),

  setConfirmCloseOpen: confirmCloseOpen => set({ confirmCloseOpen }),

  setQuitConfirmOpen: quitConfirmOpen => set({ quitConfirmOpen }),
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
 * traffic-light button. With a live session (starting/ready) it opens the
 * in-app confirm dialog; the dialog's Stop & Hide button stops the session
 * (score server + audio) and then fades the window out and hides it. With
 * no live session it fades immediately. The app keeps running and the Dock
 * icon reopens the window (§7.4).
 */
export async function requestClose(): Promise<void> {
  const { sessionStatus } = useSessionStore.getState()
  if (shouldConfirmClose(sessionStatus)) {
    useWindowStore.getState().setConfirmCloseOpen(true)
    return
  }
  await closeWindowWithFade()
}

/**
 * First show — the cold-start reveal (#51). The main window is created
 * hidden so its first visible frame is already themed; App.tsx calls
 * this once the saved theme has landed. Rust shows-and-fades a hidden
 * window and NO-OPs on an already-visible one (dev reloads must never
 * re-fade a live window).
 */
export async function fadeInWindow(): Promise<void> {
  // #56: null = the main window (the command's label default); the help
  // center passes its own label for its reveal.
  const result = await commands.fadeInWindow(null)
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

/**
 * v1.1.2 T7 (spec issue #11): the ⌘Q flow. The macOS menu item is custom
 * (not the predefined Quit) so this runs first: with a live session the
 * in-app confirm dialog opens (QuitConfirmDialog); without one the app
 * exits immediately.
 */
export async function requestQuit(): Promise<void> {
  const { sessionStatus } = useSessionStore.getState()
  if (shouldConfirmClose(sessionStatus)) {
    useWindowStore.getState().setQuitConfirmOpen(true)
    return
  }
  await quitNow()
}

/**
 * The actual exit: mark quitting (⌘Q never waits for a fade — §7.4), then
 * terminate the process. Rust's ExitRequested handler stops any session
 * that is still alive, so this path never orphans a score server.
 */
export async function quitNow(): Promise<void> {
  await markQuitting()
  const result = await commands.quitApp()
  if (result.status === 'error') {
    console.error('quitApp failed:', result.error)
  }
}
