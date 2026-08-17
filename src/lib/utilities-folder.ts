import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { saveProjectIndex } from '@/lib/audio-prefs'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'

/**
 * v1.1.2 T7 (spec issue #11): seed the default Utilities folder from the
 * bundled example projects ("Local Network Diagnostics", "Multichannel
 * Signal Generator"), resolved by the backend (app-bundle resources in
 * release, the repository checkout in dev).
 *
 * Runs after the preference restore on every launch but only acts when the
 * folder does not exist yet, so later edits stick: removing an example
 * from the folder — or from history — is never undone by a relaunch.
 */
export async function ensureUtilitiesFolder(): Promise<void> {
  const store = useProjectStore.getState()
  if (store.projectFolders.some(f => f.id === UTILITIES_FOLDER_ID)) return

  const result = await commands.bundledExampleProjects()
  if (result.status === 'error') {
    logger.warn('Failed to resolve bundled example projects', {
      error: result.error,
    })
    return
  }
  const examplePaths = result.data
  if (examplePaths.length === 0) return

  // History and membership change together — the folder only ever holds
  // projects the sidebar can show (they are first-party bundled examples,
  // so opening them adds them to the history; preflight still runs on open).
  for (const path of examplePaths) store.addRecentProject(path)
  const { recentProjectPaths, projectFolders } = useProjectStore.getState()
  useProjectStore.getState().setProjectFolders([
    {
      id: UTILITIES_FOLDER_ID,
      name: 'Utilities',
      projectPaths: examplePaths,
    },
    ...projectFolders,
  ])
  void saveProjectIndex(
    recentProjectPaths,
    useProjectStore.getState().projectFolders
  )
}
