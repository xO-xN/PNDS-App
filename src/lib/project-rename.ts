import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'

/**
 * v1.1.2 T6 (spec issue #10): the single rename trigger — ⌘R and the
 * Edit-menu item both land here so their semantics can never drift.
 *
 * Resolves what "rename the selected thing" means:
 * - session running (or stopping) → forbidden, silent no-op
 * - a selected project → that project, even inside a folder view
 * - no selection but drilled into a folder → the folder's name
 * - nothing selected → silent no-op (no prompt, no action)
 */
export function startRename(): void {
  const status = useSessionStore.getState().sessionStatus
  if (status === 'ready' || status === 'stopping') return

  const project = useProjectStore.getState()
  if (project.currentProject) {
    project.setRenameTarget({
      kind: 'project',
      path: project.currentProject.path,
    })
    return
  }
  if (project.activeFolderId) {
    project.setRenameTarget({ kind: 'folder', id: project.activeFolderId })
  }
}
