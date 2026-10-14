import { hasOpenOverlay } from '@/hooks/use-command-keyboard'
import { useCreationStore } from '@/store/creation-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { isSessionBusy, useSessionStore } from '@/store/session-store'
import { useWindowStore } from '@/store/window-store'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { moveProjectSelection } from '@/lib/project-select'
import { canLoadSelectedProject } from '@/lib/session-flow'

const LOAD_SELECTED_PROJECT = 'pnds:load-selected-project'
let selectionRequests = 0

/** The main shell's mounted session button owns its replacement dialog. */
export function onPerformanceLoadRequest(submit: () => void): () => void {
  window.addEventListener(LOAD_SELECTED_PROJECT, submit)
  return () => window.removeEventListener(LOAD_SELECTED_PROJECT, submit)
}

function canLoadPerformanceProject(): boolean {
  return (
    selectionRequests === 0 &&
    canSelectPerformanceProject() &&
    canLoadSelectedProject()
  )
}

export async function canLoadFocusedPerformanceProject(): Promise<boolean> {
  return (
    canLoadPerformanceProject() &&
    (await canSelectFocusedPerformanceProject()) &&
    canLoadPerformanceProject()
  )
}

/** Native delivery requests the existing UI flow, including its confirmation. */
export async function loadPerformanceProject(): Promise<void> {
  if (!canLoadPerformanceProject()) return
  const epoch = useCreationStore.getState().epoch
  const selected = useProjectStore.getState().currentProject
  if (
    !(await canLoadFocusedPerformanceProject()) ||
    useCreationStore.getState().epoch !== epoch ||
    useProjectStore.getState().currentProject !== selected
  )
    return
  window.dispatchEvent(new Event(LOAD_SELECTED_PROJECT))
}

/** Native menu selection is allowed only in the available performance shell. */
function canSelectPerformanceProject(): boolean {
  const creation = useCreationStore.getState()
  const session = useSessionStore.getState()
  const windowState = useWindowStore.getState()
  return (
    !creation.active &&
    !creation.opening &&
    creation.modePhase === 'idle' &&
    !session.commandPending &&
    !isSessionBusy(session.sessionStatus) &&
    !windowState.confirmCloseOpen &&
    !windowState.quitConfirmOpen &&
    !useProjectStore.getState().confirmCloseProjectOpen &&
    !useSettingsStore.getState().settingsOpen &&
    !hasOpenOverlay()
  )
}

/** Menu availability fails closed if the focused App window cannot be resolved. */
export async function canSelectFocusedPerformanceProject(): Promise<boolean> {
  if (!canSelectPerformanceProject()) return false
  try {
    const focused = await commands.focusedWindowLabel()
    return (
      focused.status === 'ok' &&
      focused.data === 'main' &&
      canSelectPerformanceProject()
    )
  } catch (error) {
    logger.warn('Failed to query window focus for performance selection', {
      error,
    })
    return false
  }
}

/** The app menu owns these accelerators even when the monitor has focus. */
export async function selectPerformanceProject(
  direction: 1 | -1
): Promise<void> {
  if (!canSelectPerformanceProject()) return
  const epoch = useCreationStore.getState().epoch
  selectionRequests++
  try {
    if (
      !(await canSelectFocusedPerformanceProject()) ||
      useCreationStore.getState().epoch !== epoch
    )
      return
    useKeyboardStore.getState().setProjectSelectionRevealed(true)
    moveProjectSelection(direction)
  } finally {
    selectionRequests--
  }
}
