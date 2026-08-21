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

/** Runs preflight and, on success, seeds session defaults (§6.1, §7). */
export async function runPreflight(path: string): Promise<void> {
  useProjectStore.getState().startPreflight()
  // v1.2.3 (#39/T4): with a live session preflight is select-only — no
  // reset (that would drop the monitor view and forge a frontend stop;
  // the backend preflight already spares the running session, issue
  // #37). The seeding below still runs so the settings card follows the
  // SELECTION's pending start config (v1.2.3 T4), except when the
  // running card itself was re-selected — the backend snapshot owns the
  // live config there (applySnapshot keeps it in sync).
  const live = isSessionLive(useSessionStore.getState().sessionStatus)
  if (!live) {
    useSessionStore.getState().resetSession()
  }
  const reselectedRunningCard =
    live && useSessionStore.getState().sessionProjectPath === path
  logger.info('Running project preflight', { path })
  const result = await commands.preflightProject(path)
  if (result.status === 'error') {
    useProjectStore.getState().preflightFailed(path, result.error)
    logger.warn('Preflight failed', { path, error: result.error })
    return
  }
  // v1.2.0 (issue #16): preflightSucceeded learns the manifest-declared
  // name and persists it when it is actually new — a reopen of an
  // already-known name saves nothing.
  useProjectStore.getState().preflightSucceeded(path, result.data)
  logger.info('Preflight passed', { project: result.data.name })
  if (reselectedRunningCard) return

  useSessionStore.getState().setAudioMode(result.data.audio.defaultMode)

  // §6.6: restore this project's last valid OSC target (app-local pref).
  const prefs = await loadPreferences()
  const savedTarget = prefs?.oscTargets?.[result.data.id]
  useSessionStore
    .getState()
    .setOscTargetInput(savedTarget ?? DEFAULT_OSC_TARGET)

  const addrs = await commands.listLanAddresses()
  if (addrs.status === 'ok') {
    useSessionStore.getState().setLanAddresses(addrs.data)
    const [first] = addrs.data
    if (first) {
      useSessionStore.getState().setLanIp(first)
    }
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
  if (!keepSelection) {
    useProjectStore.getState().clearProject()
  }
  useSessionStore.getState().resetSession()
}
