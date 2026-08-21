import { useProjectStore, visibleProjectPaths } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { openProject } from '@/lib/open-project'
import type { ProjectFolder } from '@/lib/tauri-bindings'

/**
 * The single entry for selecting a project card (spec issue #4: 选中语义
 * 统一). Both the card click and the Cmd+number keyboard layer go through
 * here so the semantics can never drift:
 *
 * - the current project → cleared while idle (v1.2.0: Cmd+N pressing the
 *   selected project's number also deselects — click and keyboard no
 *   longer differ; a live session keeps its project)
 * - otherwise → preflight-only selection, starting stays explicit (§8)
 *
 * v1.2.3 (#39): selection is free while a session runs — selecting B never
 * touches A's session (no confirmation, no stop, no store reset; the Rust
 * preflight spares the running session, issue #37). Starting B while A
 * runs is confirmed at the Load button, not here.
 */
export function selectProject(path: string): void {
  const project = useProjectStore.getState()

  if (path === project.currentProject?.path) {
    if (project.pendingPreflightPath === path) return
    const status = useSessionStore.getState().sessionStatus
    if (status === 'idle') {
      project.clearProject()
    }
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

/** The folder-view stops in row order: the unfiled view first, then the
 * folders in display order (at most four stops under the #26 cap). */
function folderViewStops(folders: ProjectFolder[]): (string | null)[] {
  return [null, ...folders.map(folder => folder.id)]
}

/**
 * v1.2.2 (issue #28): ←/→ on the focused switch segment — the next folder
 * view along the row, wrapping at the ends (the row is short, so wrapping
 * beats clamping).
 */
export function nextFolderView(
  folders: ProjectFolder[],
  activeFolderId: string | null,
  direction: 1 | -1
): string | null {
  const viewIds = folderViewStops(folders)
  const currentIndex = Math.max(0, viewIds.indexOf(activeFolderId))
  const nextIndex = (currentIndex + direction + viewIds.length) % viewIds.length
  return viewIds[nextIndex] ?? null
}

/**
 * ⌘←/⌘→ — one folder view along the row, through the same entry as a
 * segment click. The ends clamp instead of wrapping (the ⌘↑/⌘↓ rule: the
 * arrows navigate a grid, never a ring), and a clamped press is a full
 * no-op — re-running the click entry would reset an idle selection even
 * though the view never moved.
 */
export function moveFolderSelection(direction: 1 | -1): void {
  const { projectFolders, activeFolderId } = useProjectStore.getState()
  const viewIds = folderViewStops(projectFolders)
  const currentIndex = Math.max(0, viewIds.indexOf(activeFolderId))
  const nextIndex = Math.min(
    Math.max(currentIndex + direction, 0),
    viewIds.length - 1
  )
  const next = viewIds[nextIndex] ?? null
  if (next !== activeFolderId) setActiveFolderView(next)
}

/**
 * v1.1.2 T7 (spec issue #4/#11): ⌘↓/⌘↑ — move the selection one project
 * along the CURRENT view's visible order, with the same semantics as
 * clicking a card (idle selects; a live session just keeps running
 * underneath, #39). The ends clamp — the selection never wraps, and the
 * move never leaves the view it was pressed in.
 */
export function moveProjectSelection(direction: 1 | -1): void {
  const project = useProjectStore.getState()
  const currentPath = project.currentProject?.path ?? null

  // v1.2.3 (user feedback on #39): the move acts on the CURRENT view —
  // never auto-drills back into the selected project's folder. Switching
  // to Home with ⌘←/→ and pressing ⌘↓ must select a Home project, not
  // bounce to wherever the selection lives.
  const visible = visibleProjectPaths(
    project.recentProjectPaths,
    project.projectFolders,
    project.activeFolderId
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
  if (nextPath === undefined || nextPath === currentPath) return

  selectProject(nextPath)
}
