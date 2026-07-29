import { open } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import {
  DEFAULT_OSC_TARGET,
  isValidOscTarget,
  loadAudioPreferences,
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
    if (addrs.data.length === 1 && first) {
      useSessionStore.getState().setLanIp(first)
    }
  }
}

/**
 * Starts the session when everything is in place: preflight passed, an
 * audio mode is selected, and a LAN address is chosen (§7 requires an
 * explicit choice when several exist). No-op otherwise — the settings
 * card calls this again once the user picks an address.
 */
export async function startIfReady(): Promise<void> {
  const { currentProject, preflightStatus } = useProjectStore.getState()
  const { audioMode, lanIp, sessionStatus, oscTargetInput } =
    useSessionStore.getState()
  if (
    !currentProject ||
    preflightStatus !== 'ready' ||
    sessionStatus !== 'idle' ||
    !lanIp
  ) {
    return
  }
  // §6.6: external mode cannot start with an invalid target.
  const oscTarget = audioMode === 'external' ? oscTargetInput : null
  if (audioMode === 'external' && !isValidOscTarget(oscTargetInput)) {
    return
  }
  logger.info('Starting project', {
    path: currentProject.path,
    mode: audioMode,
    lanIp,
  })
  const result = await commands.startProject(
    currentProject.path,
    audioMode,
    lanIp,
    oscTarget
  )
  if (result.status === 'error') {
    useSessionStore.getState().failLocal(result.error)
  }
}

/** §8.3: any mode/device/target change is a full session restart. */
export async function restartSession(): Promise<void> {
  const { currentProject } = useProjectStore.getState()
  const { audioMode, lanIp, oscTargetInput } = useSessionStore.getState()
  if (!currentProject || !lanIp) return
  logger.info('Restarting session', {
    path: currentProject.path,
    mode: audioMode,
  })
  await commands.stopProject()
  const oscTarget = audioMode === 'external' ? oscTargetInput : null
  const result = await commands.startProject(
    currentProject.path,
    audioMode,
    lanIp,
    oscTarget
  )
  if (result.status === 'error') {
    useSessionStore.getState().failLocal(result.error)
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
  useProjectStore.getState().clearProject()
  useSessionStore.getState().resetSession()
}
