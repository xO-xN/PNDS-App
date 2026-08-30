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
 * v1.3.3 (#84, user report): the built-in tools' concise display names
 * live in the RESOLUTION layer (builtin-utilities.ts →
 * projectDisplayName), never here — learning them into
 * manifestProjectNames at launch was undone the moment a tool's
 * preflight learned the formal manifest name back over it (the selected
 * card flipped to the truncating long name).
 */

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
 * Known edge: an install from before the v1.3.2 immutability guards that
 * deliberately purged a built-in tool AND every record of the offer sees
 * that tool return once on upgrade — the record cannot distinguish
 * "purged" from "never shipped here". Since the guards, tools cannot be
 * purged anymore, so the offer is genuinely one-time for new installs.
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
 * Best-effort guard registration when the registry lookup fails (or ships
 * nothing): Utilities members staged under a `<root>/utilities/<id>` path
 * are tools — only the seeding ever files into the folder, and every tool
 * root ends in `/utilities/<id>` (v1.3.1). Keeps the immutability guards
 * alive for that degraded launch; the next successful lookup re-resolves
 * the exact set.
 */
function registerFallbackUtilityPaths(): void {
  const utilities = useProjectStore
    .getState()
    .projectFolders.find(folder => folder.id === UTILITIES_FOLDER_ID)
  const paths = (utilities?.projectPaths ?? []).filter(path =>
    path.includes('/utilities/')
  )
  useProjectStore.getState().setUtilityPaths(paths)
}

/**
 * v1.3.3 (user request, #81): the Utilities folder's display order is the
 * registry order, FIXED — the tools are app content, not a curated list.
 * Installs seeded before a registry reorder keep their seeded order
 * forever (the seeding runs only when the folder is missing), so every
 * launch re-settles the folder's members into the registry order. Paths
 * outside the registry (none expected — only the seeding files into the
 * folder) keep their relative order at the end. A no-op settles nothing.
 */
function normalizeUtilityOrder(tools: BuiltinUtility[]): void {
  const folders = useProjectStore.getState().projectFolders
  const index = folders.findIndex(folder => folder.id === UTILITIES_FOLDER_ID)
  if (index === -1) return
  const folder = folders[index]
  if (!folder) return
  const rank = new Map(tools.map((tool, order) => [tool.path, order]))
  const ordered = [
    ...folder.projectPaths
      .filter(path => rank.has(path))
      .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)),
    ...folder.projectPaths.filter(path => !rank.has(path)),
  ]
  const settled =
    ordered.length === folder.projectPaths.length &&
    ordered.every((path, order) => path === folder.projectPaths[order])
  if (settled) return
  const next = [...folders]
  next[index] = { ...folder, projectPaths: ordered }
  useProjectStore.getState().setProjectFolders(next)
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
 * v1.3.1) and newly shipped tools are offered once (see
 * `offerNewUtilities`). v1.3.2 (user report after #75): the tools are app
 * content — once seeded, the store guards keep their position, Utilities
 * membership and history entry immutable from the UI. v1.3.3 (#81): the
 * member order is the registry order, fixed — each launch re-settles it
 * (see `normalizeUtilityOrder`). The folder is
 * pinned to the BOTTOM of the folder area: seeded last, and a launch also
 * migrates installs where it still sits elsewhere. Every mutation
 * persists through the store's structural actions.
 */
export async function ensureUtilitiesFolder(): Promise<void> {
  const result = await commands.builtinUtilities()
  if (result.status === 'error') {
    logger.warn('Failed to resolve the built-in utility tools', {
      error: result.error,
    })
    registerFallbackUtilityPaths()
    return
  }
  const tools = result.data
  if (tools.length === 0) {
    registerFallbackUtilityPaths()
    return
  }
  // v1.3.2 (user report after #75): register this launch's tool paths with
  // the store — every structural guard below (move / remove / reorder /
  // rename refusals) keys off the set. Recorded before the seeding flows
  // so their own commits (filing a tool into Utilities) pass the border
  // guard, while stale-root copies — not this launch's paths — stay
  // removable for the refresh below.
  useProjectStore.getState().setUtilityPaths(tools.map(tool => tool.path))

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
  normalizeUtilityOrder(tools)

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
