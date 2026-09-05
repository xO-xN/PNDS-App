import { useEffect } from 'react'
import { useKeyboardStore } from '@/store/keyboard-store'
import { useSettingsStore } from '@/store/settings-store'
import { visibleProjectPaths, useProjectStore } from '@/store/project-store'
import {
  moveFolderSelection,
  moveProjectSelection,
  selectProject,
} from '@/lib/project-select'
import { startRename } from '@/lib/project-rename'

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
 * v1.1.2 Cmd keyboard layer (spec issue #4): one registration at the shell
 * level, active in every window state — the shortcuts must not depend on
 * sidebar visibility.
 *
 * - ⌘ held → `commandKeyPressed` (badges + running-state sidebar peek)
 * - ⌘, → toggle the in-app settings panel (v1.2.0, issue #13)
 * - ⌘R → rename the selected project (folder name inside a folder view
 *   with nothing selected) via the same entry as the Edit-menu item
 * - ⌘↓/⌘↑ → move the selection along the visible order (clamped, no
 *   wrap; auto-drills into the current project's folder) via the same
 *   entry as a click
 * - ⌘→/⌘← → one folder view along the row (clamped, no wrap) via the
 *   same entry as a segment click — together with ⌘↓/⌘↑ the Cmd arrows
 *   navigate the folder/project grid. (Before v1.2.2 shipped they nudged
 *   the master volume; that role is gone, ⌘M keeps mute.)
 * - ⌘1..9 → select the Nth visible project via the same entry as a click,
 *   folder-aware (a drilled-in view numbers only the folder's members);
 *   pressing the selected project's number deselects it (v1.2.0, same
 *   as clicking the card). Cmd+0 stays the native "Actual Size" menu
 *   accelerator and is never consumed here
 */
export function useCommandKeyboard(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        useKeyboardStore.getState().setCommandKeyPressed(true)
        return
      }
      if (!event.metaKey || event.repeat) return
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
      // ⌘R must never fall through to the webview's page reload.
      if (event.code === 'KeyR') {
        if (isEditableTarget(event.target) || hasOpenOverlay()) return
        event.preventDefault()
        startRename()
        return
      }
      // v1.1.2 T7 (spec issue #4/#11): ⌘↓/⌘↑ next/previous project. Must
      // not fall through to the webview's scroll-to-end/beginning.
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (isEditableTarget(event.target) || hasOpenOverlay()) return
        event.preventDefault()
        moveProjectSelection(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      // ⌘←/⌘→ move one folder view along the row, wrapping at the ends
      // (v1.3.1 user report — the old clamp read as stuck, not as an
      // edge). Since v1.3.5 (#104) the ONLY keyboard folder switch: the
      // segments' bare ←/→ handler is gone. Text fields keep ⌘←/⌘→ as
      // line-start/end, and the row is not navigated under an overlay.
      // Web-layer on purpose — a menu accelerator would consume the key
      // even inside an input.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (isEditableTarget(event.target) || hasOpenOverlay()) return
        event.preventDefault()
        moveFolderSelection(event.key === 'ArrowRight' ? 1 : -1)
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
        useKeyboardStore.getState().setCommandKeyPressed(false)
      }
    }

    const handleBlur = () => {
      useKeyboardStore.getState().setCommandKeyPressed(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])
}
