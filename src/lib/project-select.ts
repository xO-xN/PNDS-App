import { useProjectStore, visibleProjectPaths } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { openProject } from '@/lib/open-project'

/** Where a selection came from — the only behavioural difference:
 * clicking the current (idle) project clears the selection, keyboard
 * selection of it is a no-op (spec issue #4: 误按不取消当前选中). */
export type SelectSource = 'click' | 'keyboard'

/**
 * The single entry for selecting a project card (spec issue #4: 选中语义
 * 统一). Both the card click and the Cmd+number keyboard layer go through
 * here so the semantics can never drift:
 *
 * - busy (starting/stopping) → no-op
 * - the current project → click clears it while idle, keyboard never does
 * - session running → §8.3 switch confirmation (`pendingSwitchPath`)
 * - otherwise → preflight-only selection, starting stays explicit (§8)
 */
export function selectProject(path: string, source: SelectSource): void {
  const project = useProjectStore.getState()
  const status = useSessionStore.getState().sessionStatus
  if (status === 'starting' || status === 'stopping') return

  if (path === project.currentProject?.path) {
    if (project.pendingPreflightPath === path) return
    if (source === 'click' && status === 'idle') {
      project.clearProject()
    }
    return
  }

  if (status !== 'idle') {
    project.requestSwitch(path)
    return
  }

  if (project.pendingPreflightPath === path) return

  project.setPendingPreflight(path)
  void openProject(path).finally(() => {
    if (useProjectStore.getState().pendingPreflightPath === path) {
      useProjectStore.getState().setPendingPreflight(null)
    }
  })
}

/**
 * v1.1.2 T6: enters a folder view (folder-card click) or returns to the
 * top level (breadcrumb back, `null`). Folder views are exclusive — the
 * collapsed sidebar never shows outside projects — so opening or closing
 * one resets the selection: a card the view no longer shows must not stay
 * the ⌘R target. A live session keeps its project (it is not a selection
 * — the in-use dot and the top-level current marker read it, and rename
 * is blocked while running anyway).
 */
export function setActiveFolderView(folderId: string | null): void {
  const project = useProjectStore.getState()
  const status = useSessionStore.getState().sessionStatus
  if (
    status !== 'ready' &&
    status !== 'stopping' &&
    project.currentProject !== null
  ) {
    project.clearProject()
  }
  project.setActiveFolderId(folderId)
}

/**
 * v1.1.2 T7 (spec issue #4/#11): ⌘↓/⌘↑ — move the selection one project
 * along the current visible order, with the same semantics as clicking a
 * card (idle selects, a live session goes through the switch confirmation).
 * The ends clamp — the selection never wraps.
 *
 * When the current project sits inside a folder and the user is at the top
 * level, the move drills into that folder first and continues inside it
 * ("下一首曲子" mental model), so the target is computed from the folder's
 * own order before the drill resets an idle selection.
 */
export function moveProjectSelection(direction: 1 | -1): void {
  const status = useSessionStore.getState().sessionStatus
  if (status === 'starting' || status === 'stopping') return

  const project = useProjectStore.getState()
  const currentPath = project.currentProject?.path ?? null

  // Auto-drill: the move follows the current project into its folder.
  let viewFolderId = project.activeFolderId
  if (viewFolderId === null && currentPath !== null) {
    viewFolderId =
      project.projectFolders.find(folder =>
        folder.projectPaths.includes(currentPath)
      )?.id ?? null
  }
  const drilledIn =
    viewFolderId !== null && viewFolderId !== project.activeFolderId
  if (drilledIn) setActiveFolderView(viewFolderId)

  const visible = visibleProjectPaths(
    project.trustedPaths,
    project.projectFolders,
    viewFolderId
  )
  if (visible.length === 0) return

  // No current project in this view: enter from the corresponding end.
  const currentIndex = currentPath !== null ? visible.indexOf(currentPath) : -1
  const nextIndex =
    currentIndex === -1
      ? direction === 1
        ? 0
        : visible.length - 1
      : Math.min(Math.max(currentIndex + direction, 0), visible.length - 1)
  const nextPath = visible[nextIndex]
  if (nextPath === undefined) return

  if (nextPath === currentPath) {
    // Clamped at the end of the list — the selection does not move. But
    // the drill above reset an idle selection; restore it so following
    // the current project into its folder keeps it selected.
    if (
      drilledIn &&
      status === 'idle' &&
      useProjectStore.getState().currentProject === null
    ) {
      selectProject(nextPath, 'keyboard')
    }
    return
  }

  selectProject(nextPath, 'keyboard')
}
