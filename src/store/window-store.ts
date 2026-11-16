import i18n from '@/i18n/config'
import { notifications } from '@/lib/notifications'
import { participationErrorText } from '@/lib/participation-errors'
import { create } from 'zustand'
import {
  commands,
  expectOk,
  type WindowStateSnapshot,
} from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { shouldConfirmClose, useSessionStore } from '@/store/session-store'
import { stopAndPersistAssistantHistory } from '@/store/assistant-store'
import {
  captureCreationDrafts,
  creationHasUnsavedChanges,
  prepareCreationQuit,
} from '@/lib/creation-lifecycle'
import {
  blockCreationTerminalOpen,
  useCreationTerminalStore,
} from '@/store/creation-terminal-store'

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

interface TerminalQuitIntent {
  token: Promise<number>
}
let terminalQuitIntent: TerminalQuitIntent | null = null

/** Only the captured intent may release its native quit barrier. */
function releaseTerminalQuit(owned = terminalQuitIntent): void {
  if (!owned) return
  if (terminalQuitIntent === owned) terminalQuitIntent = null
  void owned.token
    .then(async token =>
      expectOk(await commands.finishProjectTerminalQuit(token))
    )
    .catch(error =>
      logger.warn('Could not release terminal quit confirmation', { error })
    )
}

/** Ignored native events release only their own token, never the active dialog. */
export async function releaseUnclaimedTerminalQuit(
  token: number
): Promise<void> {
  const owned = terminalQuitIntent
  try {
    if (owned && (await owned.token) === token) return
    expectOk(await commands.finishProjectTerminalQuit(token))
  } catch (error) {
    logger.warn('Could not release an ignored terminal quit request', { error })
  }
}

export function prepareTerminalQuitConfirmation(): Promise<TerminalQuitIntent | null> | null {
  if (!terminalQuitIntent && !useCreationTerminalStore.getState().hasSession)
    return null
  const owned = terminalQuitIntent ?? {
    token: commands.beginProjectTerminalQuit().then(expectOk),
  }
  terminalQuitIntent = owned
  return owned.token.then(
    () => (terminalQuitIntent === owned ? owned : null),
    error => {
      if (terminalQuitIntent === owned) terminalQuitIntent = null
      throw error
    }
  )
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

  setQuitConfirmOpen: quitConfirmOpen => {
    if (!quitConfirmOpen) releaseTerminalQuit()
    set({ quitConfirmOpen })
  },
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
 * (not the predefined Quit) so live sessions and unsaved creation drafts
 * reach QuitConfirmDialog before the history drain and actual exit.
 */
export async function requestQuit(
  isCurrent: () => boolean = () => true
): Promise<void> {
  if (!isCurrent() || useWindowStore.getState().quitConfirmOpen) return
  const identity = useCreationTerminalStore.getState().identity
  const pending = prepareTerminalQuitConfirmation()
  if (pending) {
    try {
      const approval = await pending
      if (!approval) return
      if (
        !isCurrent() ||
        useCreationTerminalStore.getState().identity !== identity
      ) {
        releaseTerminalQuit(approval)
        return
      }
    } catch (error) {
      notifications.error(i18n.t('creation.terminal.endFailed'), String(error))
      return
    }
  }
  const { sessionStatus } = useSessionStore.getState()
  if (
    shouldConfirmClose(sessionStatus) ||
    creationHasUnsavedChanges() ||
    useCreationTerminalStore.getState().hasSession
  ) {
    useWindowStore.getState().setQuitConfirmOpen(true)
    return
  }
  await quitNow()
}

/**
 * Drain durable history and recheck draft ownership before marking quitting.
 * Rust's ExitRequested handler stops any session
 * that is still alive, so this path never orphans a score server.
 */
export async function quitNow(
  discardDrafts = false,
  approval: TerminalQuitIntent | null = null
): Promise<boolean> {
  const releaseTerminal = blockCreationTerminalOpen()
  try {
    if (
      useCreationTerminalStore.getState().hasSession ||
      (terminalQuitIntent && terminalQuitIntent !== approval)
    ) {
      await requestQuit()
      return false
    }
    if (creationHasUnsavedChanges() && !discardDrafts) {
      useWindowStore.getState().setQuitConfirmOpen(true)
      return false
    }
    const draftsUnchanged = captureCreationDrafts()
    if (!(await stopAndPersistAssistantHistory())) return false
    try {
      await prepareCreationQuit()
    } catch (error) {
      notifications.error(i18n.t('quit.saveFailed'), String(error))
      return false
    }
    if (
      !draftsUnchanged() ||
      (!discardDrafts && creationHasUnsavedChanges()) ||
      (terminalQuitIntent && terminalQuitIntent !== approval)
    ) {
      useWindowStore.getState().setQuitConfirmOpen(true)
      return false
    }
    // quit_app marks quitting and cancels fades itself. No extra await may
    // separate this last draft check from dispatching the actual exit.
    const result = await commands.quitApp()
    if (result.status === 'error') {
      console.error('quitApp failed:', result.error)
      const terminalPrefix = 'creation.terminal.exitFailed:'
      notifications.error(
        result.error.startsWith(terminalPrefix)
          ? i18n.t('creation.terminal.exitFailed', {
              detail: result.error.slice(terminalPrefix.length).trim(),
            })
          : result.error.startsWith('participation.errors.')
            ? participationErrorText(result.error)
            : i18n.t('recording.exitFailed')
      )
    }
    return (
      result.status === 'ok' && (!approval || terminalQuitIntent === approval)
    )
  } finally {
    releaseTerminal()
  }
}
