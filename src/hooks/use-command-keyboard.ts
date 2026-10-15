import { useEffect } from 'react'
import { useKeyboardStore } from '@/store/keyboard-store'
import { useSettingsStore } from '@/store/settings-store'
import { visibleProjectPaths, useProjectStore } from '@/store/project-store'
import { selectProject, moveProjectSelection } from '@/lib/project-select'
import { startRename } from '@/lib/project-rename'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'

/**
 * True when a keyboard event originates from a text-editing target —
 * global shortcuts must not fight text input.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}

/** Overlay roles that block global shortcuts (any Radix modal/popup). */
const OVERLAY_ROLES = '[role="alertdialog"], [role="listbox"], [role="menu"]'

/**
 * True while a Radix dialog or popup overlays the page — global Enter must
 * not fire underneath a confirm flow or select menu.
 */
export function hasOpenOverlay(): boolean {
  return Boolean(document.querySelector(`[role="dialog"], ${OVERLAY_ROLES}`))
}

/** Shared eligibility for the native Escape accelerator and web fallback. */
export function canRestoreCreationWorkspace(): boolean {
  const creation = useCreationStore.getState()
  const windowState = useWindowStore.getState()
  return (
    creation.active &&
    useCreationTestStore.getState().expanded &&
    !creation.opening &&
    creation.modePhase === 'idle' &&
    !useSessionStore.getState().commandPending &&
    !useSettingsStore.getState().settingsOpen &&
    !windowState.confirmCloseOpen &&
    !windowState.quitConfirmOpen &&
    !hasOpenOverlay()
  )
}

/**
 * v1.2.0 (issue #13): true while an overlay OTHER than the settings panel
 * is open. ⌘, may toggle the settings panel itself (it must be closable
 * with ⌘, again) but must not stack it on top of another modal such as
 * the close/quit confirms.
 */
export function hasOpenOverlayBesidesSettings(): boolean {
  return Boolean(
    document.querySelector(
      `[role="dialog"]:not([data-settings-panel]), ${OVERLAY_ROLES}`
    )
  )
}

/**
 * v1.3.5 (#106): self-heal for a stuck ⌘-held state. The Meta keyup can
 * be swallowed when focus sits inside the out-of-process monitor iframe
 * at release — no main-frame keyup arrives, and the iframe's blur never
 * fires either — leaving `commandKeyPressed` stuck at true: badges that
 * won't clear and a sidebar peek that won't quit. Every heal below acts
 * only on that stuck-true state; a real hold never trips it. Native
 * selection reveal follows the same release/self-heal path (#202).
 */
function healStuckCommandKey(): void {
  const {
    commandKeyPressed,
    setCommandKeyPressed,
    projectSelectionRevealed,
    setProjectSelectionRevealed,
  } = useKeyboardStore.getState()
  if (commandKeyPressed) setCommandKeyPressed(false)
  if (projectSelectionRevealed) setProjectSelectionRevealed(false)
}

/** The pointer half of the self-heal: a mousemove/pointerdown whose
 * modifier report says Meta is UP is authoritative proof the key was
 * released — a real hold reports Meta down and changes nothing. */
function healIfPointerReportsMetaUp(event: MouseEvent): void {
  if (!event.getModifierState('Meta')) healStuckCommandKey()
}

/**
 * v1.1.2 Cmd keyboard layer (spec issue #4): one registration at the shell
 * level, active in every window state — the shortcuts must not depend on
 * sidebar visibility.
 *
 * - ⌘ held → `commandKeyPressed` (badges + running-state sidebar peek)
 * - ⌘, → toggle the in-app settings panel (v1.2.0, issue #13)
 * - ⌘R → rename the selected project (folder name inside a folder view
 *   with nothing selected) via the same entry as the Edit-menu item
 * - plain up/down project navigation is owned by Sidebar's capture boundary;
 *   monitor/projection arrows stay page-owned. Cmd+up/down remains a web
 *   alias; Cmd+Opt+up/down selection uses the native menu (#202).
 * - ⌘1..9 → select the Nth visible project via the same entry as a click,
 *   folder-aware (a drilled-in view numbers only the folder's members);
 *   pressing the selected project's number deselects it (v1.2.0, same
 *   as clicking the card). Cmd+0 stays the native "Actual Size" menu
 *   accelerator and is never consumed here
 * - stuck ⌘-held state self-heals (#106): the pointer's modifier report
 *   on mousemove/pointerdown, and any non-Meta keydown without the
 *   modifier, reset a store left claiming ⌘ is held
 */
export function useCommandKeyboard(): void {
  useEffect(() => {
    // Capture before a mode control cancels its gesture: one Escape must
    // not cancel a switch and then also restore the expanded workspace.
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        canRestoreCreationWorkspace()
      ) {
        event.preventDefault()
        useCreationTestStore.getState().setExpanded(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        useKeyboardStore.getState().setCommandKeyPressed(true)
        return
      }
      // #106: a non-Meta keydown carrying no modifier while the store
      // says ⌘ is held is proof the Meta keyup was swallowed — heal.
      if (!event.metaKey) {
        healStuckCommandKey()
        return
      }
      if (event.repeat) return
      // v1.2.0 (issue #13): ⌘, toggles the settings panel — closable with
      // ⌘, again, never stacked on another modal. Once the app menu is
      // built its accelerator consumes the key first; this handler covers
      // the moments before that (and the jsdom tests).
      if (event.key === ',') {
        if (hasOpenOverlayBesidesSettings()) return
        event.preventDefault()
        useSettingsStore.getState().toggleSettings()
        return
      }
      if (
        (event.code === 'Backquote' || event.key === '`') &&
        useCreationStore.getState().active
      ) {
        if (
          useCreationStore.getState().modePhase !== 'idle' ||
          !useCreationStore.getState().workspace ||
          hasOpenOverlay() ||
          useCreationTestStore.getState().expanded
        )
          return
        event.preventDefault()
        const tests = useCreationTestStore.getState()
        tests.setTab(tests.tab === 'console' ? 'file' : 'console')
        return
      }
      // ⌘R must never fall through to the webview's page reload; in
      // creation ⌘S saves the active file draft (#154) — a version
      // conflict surfaces the reload-or-overwrite choice instead of
      // silently overwriting.
      if (
        useCreationStore.getState().active ||
        useCreationStore.getState().modePhase !== 'idle'
      ) {
        if (event.code === 'KeyR') event.preventDefault()
        if (event.code === 'KeyS' && useCreationStore.getState().active) {
          event.preventDefault()
          if (hasOpenOverlay()) return
          // Reused suggestion buffers own neither the active file nor its save action.
          if (
            event.target instanceof Element &&
            event.target.closest('[data-text-buffer]') &&
            !event.target.closest('[data-file-draft]')
          )
            return
          const path = useCreationFilesStore.getState().activePath
          if (path) void useCreationFilesStore.getState().save(path)
        }
        return
      }
      if (
        ['ArrowUp', 'ArrowDown'].includes(event.key) &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (
          isEditableTarget(event.target) ||
          hasOpenOverlay() ||
          useSessionStore.getState().commandPending
        )
          return
        event.preventDefault()
        moveProjectSelection(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.code === 'KeyR') {
        if (isEditableTarget(event.target) || hasOpenOverlay()) return
        event.preventDefault()
        startRename()
        return
      }
      if (!/^[1-9]$/.test(event.key)) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      const { recentProjectPaths, projectFolders, activeFolderId } =
        useProjectStore.getState()
      const path = visibleProjectPaths(
        recentProjectPaths,
        projectFolders,
        activeFolderId
      )[Number(event.key) - 1]
      if (path) selectProject(path)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        healStuckCommandKey()
      }
    }

    const handleBlur = () => {
      healStuckCommandKey()
    }

    window.addEventListener('keydown', handleEscape, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    // #106: pointer self-heal — the first main-frame mousemove/pointerdown
    // after a swallowed Meta keyup carries the true modifier state.
    window.addEventListener('mousemove', healIfPointerReportsMetaUp)
    window.addEventListener('pointerdown', healIfPointerReportsMetaUp)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('mousemove', healIfPointerReportsMetaUp)
      window.removeEventListener('pointerdown', healIfPointerReportsMetaUp)
    }
  }, [])
}
