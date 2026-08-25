import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { loadPreferences, updatePreferences } from '@/lib/preferences'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'

/**
 * Learns every tool's manifest-declared name up front, so the Utilities
 * entries read as "Local Network Diagnostics" & co. on a clean install —
 * before any of them has been opened and preflighted. The store merges
 * and persists when the names actually changed.
 */
function learnToolNames(tools: { path: string; name: string }[]): void {
  const names: Record<string, string> = {}
  for (const tool of tools) {
    if (tool.name) names[tool.path] = tool.name
  }
  useProjectStore.getState().upsertManifestProjectNames(names)
}

/**
 * Records tool paths this install has now offered, merging into the
 * persisted `offeredUtilities` set. A path stays recorded even after the
 * user removes the tool — that is what keeps the offer one-time.
 */
async function recordOfferedUtilities(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const prefs = await loadPreferences()
  if (!prefs) return
  const merged = [...new Set([...(prefs.offeredUtilities ?? []), ...paths])]
  await updatePreferences({ offeredUtilities: merged })
}

/**
 * v1.3.0 (issue #55 fix): merges tools an app update newly shipped into
 * an EXISTING Utilities folder. The v1.2.x folder seeding ran only when
 * the folder was missing, so an upgrade install kept its two-tool
 * membership and TND never appeared — although the bundle ships it.
 *
 * Offer-once rule: a tool gets its single offer when its path is neither
 * recorded in `offeredUtilities` nor known to the index (history or any
 * folder membership). Index presence backfills installs from before the
 * record existed: their seeded tools count as offered without being
 * touched, so only genuinely new tools join. A cap-refused history add
 * leaves the path unrecorded and retried on a later launch.
 *
 * Known edge: an install that deliberately purged a built-in tool from
 * history AND every folder before this record existed sees that tool
 * return once on upgrade — the record cannot distinguish "purged" from
 * "never shipped here". After the one-time offer, removals stick.
 */
async function offerNewUtilities(tools: { path: string }[]): Promise<void> {
  const prefs = await loadPreferences()
  if (!prefs) return
  const offered = new Set(prefs.offeredUtilities ?? [])
  const known = new Set(useProjectStore.getState().recentProjectPaths)
  for (const folder of useProjectStore.getState().projectFolders) {
    for (const path of folder.projectPaths) known.add(path)
  }

  const newlyOffered: string[] = []
  for (const tool of tools) {
    if (offered.has(tool.path)) continue
    if (known.has(tool.path)) {
      newlyOffered.push(tool.path)
      continue
    }
    const store = useProjectStore.getState()
    if (!store.addRecentProject(tool.path)) continue
    store.moveProjectToFolder(UTILITIES_FOLDER_ID, tool.path)
    newlyOffered.push(tool.path)
  }
  await recordOfferedUtilities(newlyOffered)
}

/**
 * v1.2.0 (issue #18): the built-in utility tools behind the default
 * Utilities folder. They ship UNPACKED with the app resources at stable
 * paths (`utilities/<id>/`, no version in the path) and run in place — the
 * backend returns each tool's path and manifest name in registry order.
 *
 * Runs after the preference restore on every launch. The folder is
 * created when missing with every tool the cap admits; when it already
 * exists, newly shipped tools are offered once (see
 * `offerNewUtilities`) and other membership edits are never undone, so
 * removing a tool from it (or from history) sticks across relaunches.
 * The folder is pinned to the BOTTOM of the folder area: seeded last,
 * and a launch also migrates installs where it still sits elsewhere.
 * Every mutation persists through the store's structural actions.
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
    // projects the sidebar can show. v1.2.1 (issue #26): an upgrade whose
    // top level already sits at the per-directory cap refuses the history
    // adds, and only the admitted tools become members, so the folder
    // never lists an entry the sidebar cannot show.
    const admitted: string[] = []
    for (const tool of tools) {
      if (store.addRecentProject(tool.path)) admitted.push(tool.path)
    }
    const { projectFolders } = useProjectStore.getState()
    useProjectStore.getState().setProjectFolders([
      ...projectFolders,
      {
        id: UTILITIES_FOLDER_ID,
        name: 'Utilities',
        projectPaths: admitted,
      },
    ])
    await recordOfferedUtilities(admitted)
    return
  }

  await offerNewUtilities(tools)

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
}
