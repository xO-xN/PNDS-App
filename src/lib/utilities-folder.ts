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
 * Runs after the preference restore on every launch. Membership edits are
 * never undone — the folder is only created when missing, so removing an
 * example from it (or from history) sticks across relaunches. Since v1.2.0
 * the folder is pinned to the BOTTOM of the folder area: seeded last, and
 * a launch also migrates installs where it still sits elsewhere.
 */
export async function ensureUtilitiesFolder(): Promise<void> {
  const store = useProjectStore.getState()
  const existing = store.projectFolders.find(
    folder => folder.id === UTILITIES_FOLDER_ID
  )
  if (!existing) {
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
    const seeded = [
      ...projectFolders,
      {
        id: UTILITIES_FOLDER_ID,
        name: 'Utilities',
        projectPaths: examplePaths,
      },
    ]
    useProjectStore.getState().setProjectFolders(seeded)
    void saveProjectIndex(recentProjectPaths, seeded)
    return
  }

  // Already present: pin it to the bottom when an older install still has
  // it elsewhere (v1.2.0 — it used to be seeded first). Last position is
  // the steady state, so nothing moves on subsequent launches.
  const folders = store.projectFolders
  if (folders[folders.length - 1]?.id === UTILITIES_FOLDER_ID) return
  const pinned = [
    ...folders.filter(folder => folder.id !== UTILITIES_FOLDER_ID),
    existing,
  ]
  useProjectStore.getState().setProjectFolders(pinned)
  void saveProjectIndex(store.recentProjectPaths, pinned)
}
