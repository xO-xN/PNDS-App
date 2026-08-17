import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { installAndOpenBundle } from '@/lib/bundle-project'
import {
  DEFAULT_OSC_TARGET,
  loadAudioPreferences,
  saveProjectIndex,
} from '@/lib/audio-prefs'

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
  if (selected.toLowerCase().endsWith('.pnds')) {
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
    // in one place.
    store.addRecentProject(path)
    if (store.activeFolderId) {
      store.moveProjectToFolder(store.activeFolderId, path)
    }
    // History and folder membership change together — save atomically.
    const { recentProjectPaths, projectFolders } = useProjectStore.getState()
    void saveProjectIndex(recentProjectPaths, projectFolders)
  }
  await runPreflight(path)
}

/** Runs preflight and, on success, seeds session defaults (§6.1, §7). */
export async function runPreflight(path: string): Promise<void> {
  useProjectStore.getState().startPreflight()
  useSessionStore.getState().resetSession()
  logger.info('Running project preflight', { path })
  const result = await commands.preflightProject(path)
  if (result.status === 'error') {
    useProjectStore.getState().preflightFailed(result.error)
    logger.warn('Preflight failed', { path, error: result.error })
    return
  }
  useProjectStore.getState().preflightSucceeded(path, result.data)
  logger.info('Preflight passed', { project: result.data.name })

  useSessionStore.getState().setAudioMode(result.data.audio.defaultMode)

  // §6.6: restore this project's last valid OSC target (app-local pref).
  const prefs = await loadAudioPreferences()
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
 */
export async function stopAndReset(): Promise<void> {
  const result = await commands.stopProject()
  if (result.status === 'error') {
    logger.warn('stopProject failed during reset', { error: result.error })
  }
  // stopProject resolves only after the backend has completed teardown and
  // emitted its final idle snapshot. Clear the selection here rather than in
  // the generic snapshot handler, because restart() also crosses the idle
  // barrier and must keep the selected project for the next start.
  useProjectStore.getState().clearProject()
  useSessionStore.getState().resetSession()
}
