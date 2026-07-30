import { open } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import {
  DEFAULT_OSC_TARGET,
  loadAudioPreferences,
  saveRecentProjects,
} from '@/lib/audio-prefs'

/**
 * Shared project flows (§4, §6.1, §7, §8):
 * - promptOpenProject: folder picker → trust gate → preflight → start
 * - openProject: click a known path → trust gate → preflight → start
 * - startIfReady: starts when preflight passed and LAN is chosen
 * - restartSession: §8.3 full restart (used when mode/device/target change)
 *
 * The trust confirmation dialog is rendered by WelcomeScreen, driven by
 * `pendingTrustPath` in the project store.
 */
export async function promptOpenProject(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: i18n.t('welcome.openProject'),
  })
  if (!selected) return
  await openProject(selected)
}

/** Opens a known path: trust gate, then preflight. Starting is always an
 * explicit user action via the Load button (SessionActionButton). */
export async function openProject(path: string): Promise<void> {
  if (!useProjectStore.getState().isTrusted(path)) {
    useProjectStore.getState().requestTrust(path)
    return
  }
  await runPreflight(path)
}

/** Confirms trust for the pending path, then preflights it. */
export async function confirmTrustAndOpen(): Promise<void> {
  const path = useProjectStore.getState().pendingTrustPath
  if (!path) return
  useProjectStore.getState().trustProject(path)
  useProjectStore.getState().requestTrust(null)
  void saveRecentPaths()
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
async function saveRecentPaths(): Promise<void> {
  void saveRecentProjects(useProjectStore.getState().trustedPaths)
}

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
