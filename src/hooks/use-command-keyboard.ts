import { useEffect } from 'react'
import { useKeyboardStore } from '@/store/keyboard-store'
import { ungroupedProjectPaths, useProjectStore } from '@/store/project-store'
import { selectProject } from '@/lib/project-select'

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

/**
 * True while a Radix dialog or popup overlays the page — global Enter must
 * not fire underneath a confirm flow or select menu.
 */
export function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector(
      '[role="alertdialog"], [role="dialog"], [role="listbox"], [role="menu"]'
    )
  )
}

/**
 * v1.1.2 Cmd keyboard layer (spec issue #4): one registration at the shell
 * level, active in every window state — the shortcuts must not depend on
 * sidebar visibility.
 *
 * - ⌘ held → `commandKeyPressed` (badges + running-state sidebar peek)
 * - ⌘1..9 → select the Nth visible project via the same entry as a click
 *   (Cmd+0 stays the native "Actual Size" menu accelerator and is never
 *   consumed here)
 */
export function useCommandKeyboard(): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        useKeyboardStore.getState().setCommandKeyPressed(true)
        return
      }
      if (!event.metaKey || event.repeat) return
      if (!/^[1-9]$/.test(event.key)) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      const { trustedPaths, projectFolders } = useProjectStore.getState()
      const path = ungroupedProjectPaths(trustedPaths, projectFolders)[
        Number(event.key) - 1
      ]
      if (path) selectProject(path, 'keyboard')
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
