import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import {
  saveProjectIndex,
  saveProjectManifestNames,
} from '@/lib/audio-prefs'
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
 * v1.2.0 (issue #18): sync the built-in utility tools behind the default
 * Utilities folder. The backend installs the staged `.pnds` resources into
 * the app-managed `bundles/` directory on first run and returns the tool
 * project paths (in registry order) plus any superseded-version installs
 * it reclaimed.
 *
 * Runs after the preference restore on every launch:
 *
 * - folder missing → seeded with the tool paths (pinned to the BOTTOM of
 *   the folder area) and added to the history;
 * - folder present → only version-bump bookkeeping: a tool whose previous
 *   version was a member gets its current path in the old slot, and
 *   reclaimed paths disappear from the folder and the history. A tool the
 *   user deliberately removed stays removed — nothing is re-added unless a
 *   superseded version was still a member.
 */
export async function ensureUtilitiesFolder(): Promise<void> {
  const result = await commands.syncBuiltinTools()
  if (result.status === 'error') {
    logger.warn('Failed to sync the built-in utility tools', {
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

  // Folder already present. Version-bump bookkeeping first: compute the
  // membership/history after pruning superseded paths and swapping in the
  // current ones, then pin the folder to the bottom when an older install
  // still has it elsewhere (it used to be seeded first).
  const stalePaths = new Set(tools.flatMap(tool => tool.supersededPaths))
  const folderPaths = existing.projectPaths.filter(path => !stalePaths.has(path))
  let membershipChanged = stalePaths.size > 0
  for (const tool of tools) {
    const wasMember =
      existing.projectPaths.includes(tool.path) ||
      tool.supersededPaths.some(path => existing.projectPaths.includes(path))
    if (!wasMember || folderPaths.includes(tool.path)) continue
    // The tool's previous version was a member — take over its slot so the
    // Utilities order survives registry version bumps.
    const slot = existing.projectPaths.findIndex(path =>
      tool.supersededPaths.includes(path)
    )
    if (slot >= 0 && slot <= folderPaths.length) {
      folderPaths.splice(slot, 0, tool.path)
    } else {
      folderPaths.push(tool.path)
    }
    membershipChanged = true
  }

  if (membershipChanged) {
    const { recentProjectPaths } = useProjectStore.getState()
    const prunedRecent = recentProjectPaths.filter(
      path => !stalePaths.has(path)
    )
    for (const tool of tools) {
      if (
        folderPaths.includes(tool.path) &&
        !prunedRecent.includes(tool.path)
      ) {
        prunedRecent.push(tool.path)
      }
    }
    useProjectStore.setState({ recentProjectPaths: prunedRecent })
  }

  // Rebuild with the Utilities folder pinned last. Last position is the
  // steady state, so nothing moves on subsequent launches.
  const folders = useProjectStore.getState().projectFolders
  const positionChanged =
    folders[folders.length - 1]?.id !== UTILITIES_FOLDER_ID
  if (!membershipChanged && !positionChanged) return
  const pinned = [
    ...folders.filter(folder => folder.id !== UTILITIES_FOLDER_ID),
    { ...existing, projectPaths: folderPaths },
  ]
  useProjectStore.getState().setProjectFolders(pinned)
  const { recentProjectPaths } = useProjectStore.getState()
  void saveProjectIndex(recentProjectPaths, pinned)
}
