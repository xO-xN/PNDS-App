import { isProtectedFolder, useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'

/**
 * v1.1.2 T6 (spec issue #10): the single rename trigger — ⌘R and the
 * Edit-menu item both land here so their semantics can never drift.
 *
 * Resolves what "rename the selected thing" means:
 * - session running (or stopping) → forbidden, silent no-op
 * - a selected project → that project, even inside a folder view — unless
 *   it is a bundled utility tool (v1.3.2: app content keeps its manifest
 *   name)
 * - no selection but drilled into a folder → the folder's name, unless it
 *   is protected (the Utilities folder keeps its name — v1.1.2 T7)
 * - nothing selected → silent no-op (no prompt, no action)
 */
export function startRename(): void {
  const status = useSessionStore.getState().sessionStatus
  if (status === 'ready' || status === 'stopping') return

  const project = useProjectStore.getState()
  if (project.currentProject) {
    if (project.utilityPaths.includes(project.currentProject.path)) return
    project.setRenameTarget({
      kind: 'project',
      path: project.currentProject.path,
    })
    return
  }
  if (project.activeFolderId) {
    startFolderRename(project.activeFolderId)
  }
}

/**
 * v1.2.2 (issue #28): rename a specific folder — the context menu's
 * "Rename" lands here with the same guards ⌘R applies: forbidden while a
 * session runs (or stops), never for the protected Utilities folder.
 */
export function startFolderRename(folderId: string): void {
  const status = useSessionStore.getState().sessionStatus
  if (status === 'ready' || status === 'stopping') return
  if (isProtectedFolder(folderId)) return
  useProjectStore.getState().setRenameTarget({ kind: 'folder', id: folderId })
}
