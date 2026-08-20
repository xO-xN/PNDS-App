import { useProjectStore, visibleProjectPaths } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { openProject } from '@/lib/open-project'
import type { ProjectFolder } from '@/lib/tauri-bindings'

/**
 * The single entry for selecting a project card (spec issue #4: 选中语义
 * 统一). Both the card click and the Cmd+number keyboard layer go through
 * here so the semantics can never drift:
 *
 * - busy (starting/stopping) → no-op
 * - the current project → cleared while idle (v1.2.0: Cmd+N pressing the
 *   selected project's number also deselects — click and keyboard no
 *   longer differ; a live session keeps its project)
 * - session running → §8.3 switch confirmation (`pendingSwitchPath`)
 * - otherwise → preflight-only selection, starting stays explicit (§8)
 */
export function selectProject(path: string): void {
  const project = useProjectStore.getState()
  const status = useSessionStore.getState().sessionStatus
  if (status === 'starting' || status === 'stopping') return

  if (path === project.currentProject?.path) {
    if (project.pendingPreflightPath === path) return
    if (status === 'idle') {
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
 * v1.1.2 T6: enters a folder view (folder-segment click) or returns to
 * the unfiled default (`null`). Folder views are exclusive — the
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
 * v1.2.2 (issue #28): ←/→ on the focused switch segment — the next folder
 * view along the row. The unfiled view is the first stop, the folders
 * follow in display order, and the ends wrap (the row is short — at most
 * four stops under the #26 cap — so wrapping beats clamping).
 */
export function nextFolderView(
  folders: ProjectFolder[],
  activeFolderId: string | null,
  direction: 1 | -1
): string | null {
  const viewIds: (string | null)[] = [null, ...folders.map(folder => folder.id)]
  const currentIndex = Math.max(0, viewIds.indexOf(activeFolderId))
  const nextIndex = (currentIndex + direction + viewIds.length) % viewIds.length
  return viewIds[nextIndex] ?? null
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
    project.recentProjectPaths,
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
      selectProject(nextPath)
    }
    return
  }

  selectProject(nextPath)
}
