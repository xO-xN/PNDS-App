import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import {
  PROJECT_LIMIT_PER_DIRECTORY,
  useProjectStore,
} from '@/store/project-store'
import { useSessionStore, isSessionLive } from '@/store/session-store'
import { installAndOpenBundle, isBundlePath } from '@/lib/bundle-project'
import { importSetlistDirectory } from '@/lib/setlist-import'
import { DEFAULT_OSC_TARGET, loadPreferences } from '@/lib/preferences'

/**
 * Shared project flows (§4, §6.1, §7, §8):
 * - promptOpenProject: picker (directory or .pnds) → open/install
 * - openProject: open a path → history add → preflight
 * - startIfReady: starts when preflight passed and LAN is chosen
 * - restartSession: §8.3 full restart (used when mode/device/target change)
 *
 * v1.2.0 (spec issue #15): the first-open trust confirmation was removed —
 * the operator is the machine's owner, so opening a path goes straight to
 * preflight and lands in the project history.
 *
 * v1.2.0 (issue #16): the picker is one native panel accepting a project
 * directory OR a `.pnds` bundle file (the dialog plugin cannot combine
 * files and directories, hence the Rust NSOpenPanel command). A selected
 * bundle installs into the app-managed bundles/ dir and then flows through
 * the exact same open path as a directory project.
 */
export async function promptOpenProject(): Promise<void> {
  const result = await commands.pickProjectOrBundle(
    i18n.t('sidebar.addProject')
  )
  if (result.status === 'error') {
    logger.error('Project picker failed', { error: result.error })
    notifications.error(i18n.t('sidebar.pickFailed'))
    return
  }
  const selected = result.data
  if (!selected) return
  if (isBundlePath(selected)) {
    await installAndOpenBundle(selected)
    return
  }
  // v1.4.0 (#63): a directory holding a set.json is a setlist export —
  // one gesture imports the whole set. `false` (no set.json) falls
  // through to the normal open.
  if (await importSetlistDirectory(selected)) return
  await openProject(selected)
}

/** Opens a path: new entries join the history, then preflight runs.
 * Starting is always an explicit user action via the Load button
 * (SessionActionButton). */
export async function openProject(path: string): Promise<void> {
  const store = useProjectStore.getState()
  if (!store.recentProjectPaths.includes(path)) {
    // v1.1.2 T3: a newly imported project lands by the current view (spec
    // issue #4 新导入落点) — drilled into a folder it joins that folder's
    // end, at the top level it stays ungrouped. Every import entry (open
    // dialog / share a directory) funnels through here, so the rule lives
    // in one place. The store persists the index as part of each commit.
    //
    // v1.2.1 (issue #26): a full landing directory refuses the whole open
    // — nothing is added and preflight never runs, so the sidebar cannot
    // strand a selected project it cannot list.
    const added = store.addRecentProject(path)
    if (!added) {
      notifications.warning(
        i18n.t('sidebar.projectLimitReached', {
          limit: PROJECT_LIMIT_PER_DIRECTORY,
        })
      )
      return
    }
    if (store.activeFolderId) {
      // Cannot refuse: the landing folder had room when addRecentProject
      // checked it, and nothing ran in between.
      store.moveProjectToFolder(store.activeFolderId, path)
    }
  }
  await runPreflight(path)
}

/** Owns the whole selection flow, including asynchronous settings reads.
 * Callers do not manage pending highlights or compare paths after awaits. */
export async function runPreflight(path: string): Promise<void> {
  const request = useProjectStore.getState().startPreflight(path)
  const ownsRequest = () => {
    const project = useProjectStore.getState()
    return (
      project.activePreflight === request &&
      project.recentProjectPaths.includes(path)
    )
  }
  // A live session stays running underneath free project selection (#39).
  const session = useSessionStore.getState()
  const live = isSessionLive(session.sessionStatus)
  const reselectedRunningCard = live && session.sessionProjectPath === path
  if (!live) {
    session.resetSession()
    // Keep the last prepared mode until the new request commits. If its
    // card is removed meanwhile, the previous selection remains usable.
    useSessionStore.getState().setAudioMode(session.audioMode)
  }
  logger.info('Running project preflight', { path })

  try {
    let result
    try {
      result = await commands.preflightProject(path)
    } catch (error) {
      if (!ownsRequest()) return
      const message = error instanceof Error ? error.message : String(error)
      useProjectStore.getState().preflightFailed(request, message)
      logger.warn('Preflight failed', { path, error: message })
      return
    }
    if (!ownsRequest()) return
    if (result.status === 'error') {
      useProjectStore.getState().preflightFailed(request, result.error)
      logger.warn('Preflight failed', { path, error: result.error })
      return
    }

    // Read before committing: readiness and settings belong to the same
    // request, so Load cannot use a new manifest with an old OSC target.
    const prefs = await loadPreferences()
    if (!ownsRequest()) return
    if (reselectedRunningCard) {
      // Fetch last so preference I/O cannot delay an already-read snapshot.
      const state = await commands.getSessionState().catch(error => {
        if (ownsRequest())
          logger.warn('Failed to restore running project state', {
            path,
            error,
          })
        return null
      })
      if (!ownsRequest()) return
      if (!useProjectStore.getState().preflightSucceeded(request, result.data))
        return
      if (state?.status === 'ok')
        useSessionStore.getState().applySnapshot(state.data)
    } else {
      const addrs = await commands.listLanAddresses().catch(error => {
        if (ownsRequest())
          logger.warn('Failed to list LAN addresses', { path, error })
        return null
      })
      if (!ownsRequest()) return
      if (!useProjectStore.getState().preflightSucceeded(request, result.data))
        return
      useSessionStore.getState().setAudioMode(result.data.audio.defaultMode)
      if (addrs?.status === 'ok')
        useSessionStore.getState().setLanAddresses(addrs.data)
    }
    useSessionStore
      .getState()
      .setOscTargetInput(
        prefs?.oscTargets?.[result.data.id] ?? DEFAULT_OSC_TARGET
      )
    logger.info('Preflight passed', { project: result.data.name })
  } finally {
    // Identity, not path: an A → B → A sequence has three owners.
    useProjectStore.getState().finishPreflight(request)
  }
}

/**
 * Stops the session and returns the project to a plain sidebar entry:
 * after this, the project is clickable again and re-running it goes
 * through preflight as usual (§8.2, §10.4).
 *
 * v1.2.3 (#39/T4): when a DIFFERENT card is selected (⌘W closing the
 * running project underneath a free selection), the selection survives —
 * its settings card turns into a ready-to-Load card (spec #35 story 11).
 */
export async function stopAndReset(): Promise<void> {
  // Read BEFORE the stop — the final idle snapshot clears sessionProjectPath.
  const stoppedSessionPath = useSessionStore.getState().sessionProjectPath
  const result = await commands.stopProject()
  if (result.status === 'error') {
    logger.warn('stopProject failed during reset', { error: result.error })
  }
  // stopProject resolves only after the backend has completed teardown and
  // emitted its final idle snapshot. Clear the selection here rather than in
  // the generic snapshot handler, because restart() also crosses the idle
  // barrier and must keep the selected project for the next start.
  const { currentProject } = useProjectStore.getState()
  const keepSelection =
    currentProject !== null &&
    stoppedSessionPath !== null &&
    currentProject.path !== stoppedSessionPath
  if (keepSelection && currentProject) {
    // The kept selection must be a USABLE card, not just a highlighted
    // one: resetSession() cleared its start config, so re-run the
    // preflight seeding (the backend is idle now — a plain reset-preflight
    // round-trip) to bring back the config rows and a live Load button.
    useSessionStore.getState().resetSession()
    await runPreflight(currentProject.path)
    return
  }
  useProjectStore.getState().clearProject()
  useSessionStore.getState().resetSession()
}
