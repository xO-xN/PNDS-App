import { commands, type BuiltinUtility } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { loadPreferences, updatePreferences } from '@/lib/preferences'
import { useProjectStore, UTILITIES_FOLDER_ID } from '@/store/project-store'

/**
 * True when an index path or a recorded offer refers to this tool. Tools
 * stage under `<root>/utilities/<id>` and the root moves between the
 * release app, a dev checkout, and a debug target dir — offers recorded
 * before v1.3.1 id-keying hold paths, so both spellings count.
 */
function refersToTool(entry: string, id: string): boolean {
  return entry === id || entry.endsWith(`/utilities/${id}`)
}

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
 * Records tool ids this install has now offered, merging into the
 * persisted `offeredUtilities` set. An id stays recorded even after the
 * user removes the tool — that is what keeps the offer one-time. Legacy
 * path entries ride along untouched; `refersToTool` reads both.
 */
async function recordOfferedUtilities(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const prefs = await loadPreferences()
  if (!prefs) return
  const merged = [...new Set([...(prefs.offeredUtilities ?? []), ...ids])]
  await updatePreferences({ offeredUtilities: merged })
}

/**
 * v1.3.1 (user report): dev and release builds stage the same tool at
 * different roots while sharing the preference domain, so the path-keyed
 * index double-listed every tool once both builds had run (six entries
 * for three tools). Tool identity is the registry id: every stale-root
 * copy leaves the index and a kept tool is re-materialized at the
 * current root — history presence for any indexed copy, Utilities
 * membership on top when a copy was a member.
 */
function refreshToolRoots(tools: BuiltinUtility[]): void {
  for (const tool of tools) {
    const before = useProjectStore.getState()
    const utilities = before.projectFolders.find(
      folder => folder.id === UTILITIES_FOLDER_ID
    )
    const isStaleCopy = (path: string) =>
      path !== tool.path && path.endsWith(`/utilities/${tool.id}`)
    const stale = [
      ...new Set([
        ...before.recentProjectPaths.filter(isStaleCopy),
        ...(utilities?.projectPaths.filter(isStaleCopy) ?? []),
      ]),
    ]
    if (stale.length === 0) continue
    const wasMember = (utilities?.projectPaths ?? []).some(isStaleCopy)
    for (const path of stale) {
      useProjectStore.getState().removeRecentProject(path)
    }
    // Cap discipline matches the offer path: a refused history add must
    // not leave the folder holding an unlisted path.
    const live = useProjectStore.getState()
    const indexed = live.addRecentProject(tool.path)
    if (indexed && wasMember) {
      live.moveProjectToFolder(UTILITIES_FOLDER_ID, tool.path)
    }
  }
}

/**
 * v1.3.0 (issue #55 fix): merges tools an app update newly shipped into
 * an EXISTING Utilities folder. The v1.2.x folder seeding ran only when
 * the folder was missing, so an upgrade install kept its two-tool
 * membership and TND never appeared — although the bundle ships it.
 *
 * Offer-once rule, keyed by tool id (v1.3.1: roots move between builds,
 * ids don't): a tool gets its single offer when its id is neither
 * recorded in `offeredUtilities` nor present in the index (either
 * spelling counts — `refersToTool`). A cap-refused history add leaves
 * the id unrecorded and retried on a later launch.
 *
 * Known edge: an install that deliberately purged a built-in tool from
 * history AND every folder before this record existed sees that tool
 * return once on upgrade — the record cannot distinguish "purged" from
 * "never shipped here". After the one-time offer, removals stick.
 */
async function offerNewUtilities(tools: BuiltinUtility[]): Promise<void> {
  const prefs = await loadPreferences()
  if (!prefs) return
  const isRecorded = (tool: BuiltinUtility) =>
    (prefs.offeredUtilities ?? []).some(entry => refersToTool(entry, tool.id))
  const known = new Set(
    [
      ...useProjectStore.getState().recentProjectPaths,
      ...useProjectStore
        .getState()
        .projectFolders.flatMap(folder => folder.projectPaths),
    ].filter(path => tools.some(tool => refersToTool(path, tool.id)))
  )

  const newlyOffered: string[] = []
  for (const tool of tools) {
    if (isRecorded(tool)) continue
    if (known.has(tool.path)) {
      newlyOffered.push(tool.id)
      continue
    }
    const store = useProjectStore.getState()
    if (!store.addRecentProject(tool.path)) continue
    store.moveProjectToFolder(UTILITIES_FOLDER_ID, tool.path)
    newlyOffered.push(tool.id)
  }
  await recordOfferedUtilities(newlyOffered)
}

/**
 * v1.2.0 (issue #18): the built-in utility tools behind the default
 * Utilities folder. They ship UNPACKED with the app resources at stable
 * paths (`utilities/<id>/`, no version in the path) and run in place — the
 * backend returns each tool's id, path, and manifest name in registry
 * order.
 *
 * Runs after the preference restore on every launch. The folder is
 * created when missing with every tool the cap admits; when it already
 * exists, stale-root copies are refreshed away (see `refreshToolRoots`,
 * v1.3.1), newly shipped tools are offered once (see
 * `offerNewUtilities`), and other membership edits are never undone, so
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
    const admittedIds: string[] = []
    for (const tool of tools) {
      if (store.addRecentProject(tool.path)) {
        admitted.push(tool.path)
        admittedIds.push(tool.id)
      }
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
    await recordOfferedUtilities(admittedIds)
    return
  }

  refreshToolRoots(tools)
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
