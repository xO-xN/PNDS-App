import { useProjectStore } from '@/store/project-store'
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
 * v1.1.2 T6: drills the sidebar into a folder (the folder-card click).
 * A selection that would be invisible there — the project is not a member
 * of the folder — is dropped, so ⌘R and the number badges, which read the
 * visible view, can never act on a hidden card. A member selection stays
 * (renaming it inside the folder is the intended priority), and a running
 * session keeps its project so the top-level "current" marker survives
 * (rename is blocked while running anyway).
 */
export function drillIntoFolder(folderId: string): void {
  const project = useProjectStore.getState()
  const status = useSessionStore.getState().sessionStatus
  const folder = project.projectFolders.find(f => f.id === folderId)
  const selectionHidden =
    status !== 'ready' &&
    status !== 'stopping' &&
    project.currentProject !== null &&
    !folder?.projectPaths.includes(project.currentProject.path)
  if (selectionHidden) project.clearProject()
  project.setActiveFolderId(folderId)
}
