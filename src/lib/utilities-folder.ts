import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { saveProjectIndex, saveProjectManifestNames } from '@/lib/audio-prefs'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'
import { upsertDisplayName } from '@/lib/display-names'

/**
 * Learns every tool's manifest-declared name up front, so the Utilities
 * entries read as "Local Network Diagnostics" & co. on a clean install —
 * before any of them has been opened and preflighted.
 */
function learnToolNames(tools: { path: string; name: string }[]): void {
  const store = useProjectStore.getState()
  let names = store.manifestProjectNames
  let learned = false
  for (const tool of tools) {
    if (tool.name && names[tool.path] !== tool.name) {
      names = upsertDisplayName(names, tool.path, tool.name)
      learned = true
    }
  }
  if (learned) {
    store.setManifestProjectNames(names)
    void saveProjectManifestNames(names)
  }
}

/**
 * v1.2.0 (issue #18): the built-in utility tools behind the default
 * Utilities folder. They ship UNPACKED with the app resources at stable
 * paths (`utilities/<id>/`, no version in the path) and run in place — the
 * backend returns each tool's path and manifest name in registry order.
 *
 * Runs after the preference restore on every launch. Membership edits are
 * never undone — the folder is only created when missing, so removing a
 * tool from it (or from history) sticks across relaunches, and app updates
 * swap the folder contents without ever stale-dating the entries. The
 * folder is pinned to the BOTTOM of the folder area: seeded last, and a
 * launch also migrates installs where it still sits elsewhere.
 */
export async function ensureUtilitiesFolder(): Promise<void> {
  const result = await commands.builtinUtilities()
  if (result.status === 'error') {
    logger.warn('Failed to resolve the built-in utility tools', {
      error: result.error,
    })
    return
  }
  const tools = result.data
  if (tools.length === 0) return
  learnToolNames(tools)

  const store = useProjectStore.getState()
  const existing = store.projectFolders.find(
    folder => folder.id === UTILITIES_FOLDER_ID
  )
  if (!existing) {
    // History and membership change together — the folder only ever holds
    // projects the sidebar can show (they are first-party built-in tools,
    // so opening them adds them to the history; preflight still runs on
    // open).
    for (const tool of tools) store.addRecentProject(tool.path)
    const { recentProjectPaths, projectFolders } = useProjectStore.getState()
    const seeded = [
      ...projectFolders,
      {
        id: UTILITIES_FOLDER_ID,
        name: 'Utilities',
        projectPaths: tools.map(tool => tool.path),
      },
    ]
    useProjectStore.getState().setProjectFolders(seeded)
    void saveProjectIndex(recentProjectPaths, seeded)
    return
  }

  // Already present: pin it to the bottom when an older install still has
  // it elsewhere (it used to be seeded first). Last position is the steady
  // state, so nothing moves on subsequent launches.
  const folders = useProjectStore.getState().projectFolders
  if (folders[folders.length - 1]?.id === UTILITIES_FOLDER_ID) return
  const pinned = [
    ...folders.filter(folder => folder.id !== UTILITIES_FOLDER_ID),
    existing,
  ]
  useProjectStore.getState().setProjectFolders(pinned)
  void saveProjectIndex(useProjectStore.getState().recentProjectPaths, pinned)
}
